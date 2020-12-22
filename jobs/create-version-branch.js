const _ = require('lodash')
const semver = require('semver')
const Log = require('gk-log')

const dbs = require('../lib/dbs')
const getConfig = require('../lib/get-config')
const getMessage = require('../lib/get-message')
const getInfos = require('../lib/get-infos')
const createBranch = require('../lib/create-branch')
const statsd = require('../lib/statsd')
const env = require('../lib/env')
const githubQueue = require('../lib/github-queue')
const upsert = require('../lib/upsert')
const {
  isPartOfMonorepo,
  getMonorepoGroup,
  getMonorepoGroupNameForPackage
} = require('../lib/monorepo')

const { getActiveBilling, getAccountNeedsMarketplaceUpgrade } = require('../lib/payments')
const { createTransformFunction, generateGitHubCompareURL, hasTooManyPackageJSONs } = require('../utils/utils')

const prContent = require('../content/update-pr')

module.exports = async function (
  {
    dependency,
    accountId,
    repositoryId,
    type,
    distTag,
    distTags,
    oldVersion,
    oldVersionResolved,
    versions
  }
) {
  // TODO: correctly handle beta versions, and hotfixes
  if (distTag !== 'latest') return
  // do not upgrade invalid versions
  if (!semver.validRange(oldVersion)) return

  let isMonorepo = false
  let monorepoGroupName = null
  let monorepoGroup = ''
  let relevantDependencies = []
  const version = distTags[distTag]
  const { installations, repositories } = await dbs()
  const logs = dbs.getLogsDb()
  const installation = await installations.get(accountId)
  const repository = await repositories.get(repositoryId)
  const log = Log({logsDb: logs, accountId, repoSlug: repository.fullName, context: 'create-version-branch'})
  log.info(`started for ${dependency} ${version}`, {dependency, type, version, oldVersion})

  if (hasTooManyPackageJSONs(repository)) {
    log.warn(`exited: repository has ${Object.keys(repository.packages).length} package.json files`)
    return
  }
  // if this dependency is part of a monorepo suite that usually gets released
  // all at the same time, check if we have update info for all the other
  // modules as well. If not, stop this update, the job started by the last
  // monorepo module will then update the whole lot.
  if (await isPartOfMonorepo(dependency)) {
    isMonorepo = true
    monorepoGroupName = await getMonorepoGroupNameForPackage(dependency)
    monorepoGroup = await getMonorepoGroup(monorepoGroupName)
    relevantDependencies = monorepoGroup.filter(dep =>
      !!JSON.stringify(repository.packages['package.json']).match(dep))

    log.info(`last of a monorepo publish, starting the full update for ${monorepoGroupName}`)
  }

  // Shrinkwrap should behave differently from regular lockfiles:
  //
  // If an npm-shrinkwrap.json exists, we bail if semver is satisfied and continue
  // if not. For the other two types of lockfiles (package-lock and yarn-lock),
  // we will in future check if gk-lockfile is found in the repo’s dev-dependencies,
  // if it is, Greenkeeper will continue (and the lockfiles will get updated),
  // if not, we bail as before and nothing happens (because without gk-lockfile,
  // the CI build wouldn‘t install anything new anyway).
  //
  // Variable name explanations:
  // - moduleLogFile: Lockfiles that get published to npm and that influence what
  //   gets installed on a user’s machine, such as `npm-shrinkwrap.json`.
  // - projectLockFile: lockfiles that don’t get published to npm and have no
  //   influence on the users’ dependency trees, like package-lock and yarn-lock
  //
  // See this issue for details: https://github.com/greenkeeperio/greenkeeper/issues/506

  function isTrue (x) {
    if (typeof x === 'object') {
      return !!x.length
    }
    return x
  }

  const satisfies = semver.satisfies(version, oldVersion)
  const hasModuleLockFile = repository.files && isTrue(repository.files['npm-shrinkwrap.json'])
  const hasProjectLockFile = repository.files && (isTrue(repository.files['package-lock.json']) || isTrue(repository.files['yarn.lock']))
  const usesGreenkeeperLockfile = repository.packages['package.json'] &&
    repository.packages['package.json'].devDependencies &&
    _.some(_.pick(repository.packages['package.json'].devDependencies, 'greenkeeper-lockfile'))
  // Bail if it’s in range and the repo uses shrinkwrap
  if (satisfies && hasModuleLockFile) {
    log.info(`exited: ${dependency} ${version} satisfies semver & repository has a module lockfile (shrinkwrap type)`)
    return
  }

  // If the repo does not use greenkeeper-lockfile, there’s no point in continuing because the lockfiles
  // won’t get updated without it
  if (satisfies && hasProjectLockFile && !usesGreenkeeperLockfile) {
    log.info(`exited: ${dependency} ${version} satisfies semver & repository has a project lockfile (*-lock type), and does not use gk-lockfile`)
    return
  }

  // Some users may want to keep the legacy behaviour where all lockfiles are only ever updated on out-of-range updates.
  const config = getConfig(repository)
  log.info(`config for ${repository.fullName}`, {config})
  const onlyUpdateLockfilesIfOutOfRange = _.get(config, 'lockfiles.outOfRangeUpdatesOnly') === true
  if (satisfies && hasProjectLockFile && onlyUpdateLockfilesIfOutOfRange) {
    log.info(`exited: ${dependency} ${version} satisfies semver & repository has a project lockfile (*-lock type) & lockfiles.outOfRangeUpdatesOnly is true`)
    return
  }

  let billing = null
  if (!env.IS_ENTERPRISE) {
    billing = await getActiveBilling(accountId)
    if (repository.private) {
      if (!billing || await getAccountNeedsMarketplaceUpgrade(accountId)) {
        log.warn('exited: payment required')
        return
      }
    }
  }

  const [owner, repo] = repository.fullName.split('/')
  if (_.includes(config.ignore, dependency) ||
      (relevantDependencies.length && _.intersection(config.ignore, relevantDependencies).length === relevantDependencies.length)) {
    log.warn(`exited: ${dependency} ${version} ignored by user config`, { config })
    return
  }
  const installationId = installation.installation
  const ghqueue = githubQueue(installationId)
  const { default_branch: base } = await ghqueue.read(github => github.repos.get({ owner, repo }))
  log.info('github: using default branch', {defaultBranch: base})

  let group, newBranch, dependencyKey
  if (isMonorepo) {
    dependencyKey = monorepoGroupName
    group = relevantDependencies
    newBranch = `${config.branchPrefix}monorepo.${monorepoGroupName}-${version}`
  } else {
    dependencyKey = dependency
    group = [dependency]
    newBranch = `${config.branchPrefix}${dependency}-${version}`
  }
  log.info(`branch name ${newBranch} created`)

  async function createTransformsArray (group, json) {
    return Promise.all(group.map(async depName => {
      const types = Object.keys(json).filter(type => {
        if (Object.keys(json[type]).includes(depName)) return type
      })
      if (!types.length) return
      const dependencyType = types[0]

      if (_.includes(config.ignore, depName)) return

      const oldPkgVersion = _.get(json, [dependencyType, depName])
      if (!oldPkgVersion) {
        log.warn('exited: could not find old package version', {newVersion: version, json})
        return null
      }

      if (semver.ltr(version, oldPkgVersion)) { // no downgrades
        log.warn(`exited: ${dependency} ${version} would be a downgrade from ${oldPkgVersion}`, {newVersion: version, oldVersion: oldPkgVersion})
        return null
      }

      const commitMessageKey = !satisfies && dependencyType === 'dependencies'
        ? 'dependencyUpdate'
        : 'devDependencyUpdate'
      const commitMessageValues = { dependency: depName, version }
      let commitMessage = getMessage(config.commitMessages, commitMessageKey, commitMessageValues)

      if (!satisfies && openPR) {
        await upsert(repositories, openPR._id, {
          comments: [...(openPR.comments || []), version]
        })
        commitMessage += getMessage(config.commitMessages, 'closes', {number: openPR.number})
      }
      log.info('commit message created', {commitMessage})
      return {
        transform: createTransformFunction(dependencyType, depName, version, log),
        path: 'package.json',
        message: commitMessage
      }
    }))
  }

  const openPR = await findOpenPR()

  const transforms = _.compact(await createTransformsArray(group, repository.packages['package.json']))
  const sha = await createBranch({
    installationId,
    owner,
    repo,
    branch: base,
    newBranch,
    path: 'package.json',
    transforms
  })
  if (sha) {
    log.success(`github: branch ${newBranch} created`, {sha})
  }

  if (!sha) { // no branch was created
    log.error('github: no branch was created')
    return
  }

  // TODO: previously we checked the default_branch's status
  // this failed when users used [ci skip]
  // or the repo was freshly set up
  // the commit didn't have a status then
  // https://github.com/greenkeeperio/greenkeeper/issues/59
  // new strategy: we just don't do anything for now
  // in the future we can check at this very moment
  // how many unprocessed branches are lying around
  // and create an issue telling the user to enable CI

  await upsert(repositories, `${repositoryId}:branch:${sha}`, {
    type: 'branch',
    sha,
    base,
    head: newBranch,
    dependency,
    monorepoGroupName,
    version,
    oldVersion,
    oldVersionResolved,
    dependencyType: type,
    repositoryId,
    accountId,
    processed: !satisfies
  })

  // nothing to do anymore
  // the next action will be triggered by the status event
  if (satisfies) {
    log.info('dependency satisfies version range, no action required')
    return
  }

  const diffBase = openPR
    ? _.get(openPR, 'comments.length')
      ? _.last(openPR.comments)
      : openPR.version
    : oldVersionResolved

  const { dependencyLink, release, diffCommits } = await getInfos({
    installationId,
    dependency,
    monorepoGroupName,
    version,
    diffBase,
    versions
  })

  const bodyDetails = _.compact(['\n', release, diffCommits]).join('\n')

  const compareURL = generateGitHubCompareURL(repository.fullName, base, newBranch)

  if (openPR) {
    await ghqueue.write(github => github.issues.createComment({
      owner,
      repo,
      number: openPR.number,
      body: `## Version **${version}** just got published. \n[Update to this version instead 🚀](${compareURL}) ${bodyDetails}`
    }))

    statsd.increment('pullrequest_comments')
    log.info(`github: commented on already open PR for ${dependency}`, {openPR})
    return
  }

  const title = `Update ${dependencyKey} to the latest version 🚀`

  // Inform monthly paying customers about the new yearly plan
  const adExpiredBy = 1530741600000 // Date.parse("July 5, 2018")
  const today = Date.now()
  const yearlyBillingAd = (today <= adExpiredBy) && billing && (billing.plan === 'org' || billing.plan === 'personal')

  const body = prContent({
    dependencyLink,
    oldVersionResolved,
    version,
    dependency,
    release,
    diffCommits,
    monorepoGroupName,
    type,
    yearlyBillingAd,
    orgName: owner
  })

  // verify pull requests commit
  await ghqueue.write(github => github.repos.createStatus({
    sha,
    owner,
    repo,
    state: 'success',
    context: 'greenkeeper/verify',
    description: 'Greenkeeper verified pull request',
    target_url: 'https://greenkeeper.io/verify.html'
  }))
  log.info('github: set greenkeeper/verify status')

  const createdPr = await createPr({
    ghqueue,
    title,
    body,
    base,
    head: newBranch,
    owner,
    repo,
    log
  })

  if (createdPr) {
    log.success(`github: pull request for ${dependency} ${version} created`, {pullRequest: createdPr})
  } else {
    log.error(`github: pull request for ${dependency} ${version} could not be created`)
    return
  }

  statsd.increment('update_pullrequests')

  await upsert(repositories, `${repositoryId}:pr:${createdPr.id}`, {
    type: 'pr',
    repositoryId,
    accountId,
    version,
    oldVersion,
    dependency: dependencyKey,
    initial: false,
    merged: false,
    number: createdPr.number,
    state: createdPr.state
  })

  if (config.label !== false) {
    await ghqueue.write(github => github.issues.addLabels({
      number: createdPr.number,
      labels: [config.label],
      owner,
      repo
    }))
  }

  async function findOpenPR () {
    const openPR = _.get(
      await repositories.query('pr_open_by_dependency', {
        key: [repositoryId, dependencyKey],
        include_docs: true
      }),
      'rows[0].doc'
    )

    if (!openPR) return false
    log.info(`database: found open PR for ${dependencyKey}`, {openPR})

    const pr = await ghqueue.read(github => github.pullRequests.get({
      owner,
      repo,
      number: openPR.number
    }))
    if (pr.state === 'open') return openPR

    await upsert(repositories, openPR._id, _.pick(pr, ['state', 'merged']))
    return false
  }
}

async function createPr ({ ghqueue, title, body, base, head, owner, repo, log }) {
  try {
    return await ghqueue.write(github => github.pullRequests.create({
      title,
      body,
      base,
      head,
      owner,
      repo
    }))
  } catch (err) {
    if (err.code !== 422) throw err
    const allPrs = await ghqueue.read(github => github.pullRequests.getAll({
      base,
      head: owner + ':' + head,
      owner,
      repo
    }))

    if (allPrs.length > 0) {
      log.warn('queue: retry sending pull request to github')
      return allPrs.shift()
    }
  }
}

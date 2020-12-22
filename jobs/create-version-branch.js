const _ = require('lodash')
const semver = require('semver')
const Log = require('gk-log')

const dbs = require('../lib/dbs')
const getConfig = require('../lib/get-config')
const {getMessage, getPrTitle} = require('../lib/get-message')
const getInfos = require('../lib/get-infos')
const createBranch = require('../lib/create-branch')
const statsd = require('../lib/statsd')
const env = require('../lib/env')
const githubQueue = require('../lib/github-queue')
const upsert = require('../lib/upsert')
const {
  isPartOfMonorepo,
  getMonorepoGroup,
  getMonorepoGroupNameForPackage,
  isDependencyIgnoredInGroups
} = require('../lib/monorepo')
const { getActiveBilling, getAccountNeedsMarketplaceUpgrade } = require('../lib/payments')
const { createTransformFunction,
  generateGitHubCompareURL,
  hasTooManyPackageJSONs
} = require('../utils/utils')

const prContent = require('../content/update-pr')

module.exports = async function (
  {
    dependency,
    accountId,
    repositoryId,
    type,
    version,
    oldVersion,
    oldVersionResolved,
    versions
  }
) {
  // do not upgrade invalid versions
  if (!semver.validRange(oldVersion)) return
  let isMonorepo = false
  let monorepoGroupName = null
  let monorepoGroup = ''
  let relevantDependencies = []

  const { installations, repositories, npm } = await dbs()
  const logs = dbs.getLogsDb()
  const installation = await installations.get(accountId)
  const repoDoc = await repositories.get(repositoryId)
  const log = Log({logsDb: logs, accountId, repoSlug: repoDoc.fullName, context: 'create-version-branch'})
  log.info(`started for ${dependency} ${version}`, {dependency, type, version, oldVersion})

  if (hasTooManyPackageJSONs(repoDoc)) {
    log.warn(`exited: repository has ${Object.keys(repoDoc.packages).length} package.json files`)
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
      !!JSON.stringify(repoDoc.packages['package.json']).match(dep))

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
  // - moduleLockFile: Lockfiles that get published to npm and that influence what
  //   gets installed on a user’s machine, such as `npm-shrinkwrap.json`.
  // - projectLockFile: lockfiles that don’t get published to npm and have no
  //   influence on the users’ dependency trees, like package-lock and yarn-lock
  //
  // See this issue for details: https://github.com/greenkeeperio/greenkeeper/issues/506

  // this is a good candidate for a utils function :)
  function isTrue (x) {
    if (typeof x === 'object') {
      return !!x.length
    }
    return x
  }

  const satisfies = semver.satisfies(version, oldVersion)
  const hasModuleLockFile = repoDoc.files && isTrue(repoDoc.files['npm-shrinkwrap.json'])

  // Bail if it’s in range and the repo uses shrinkwrap
  if (satisfies && hasModuleLockFile) {
    log.info(`exited: ${dependency} ${version} satisfies semver & repository has a module lockfile (shrinkwrap type)`)
    return
  }

  // Some users may want to keep the legacy behaviour where all lockfiles are only ever updated on out-of-range updates.
  const config = getConfig(repoDoc)
  log.info(`config for ${repoDoc.fullName}`, {config})
  const onlyUpdateLockfilesIfOutOfRange = _.get(config, 'lockfiles.outOfRangeUpdatesOnly') === true

  let processLockfiles = true
  if (onlyUpdateLockfilesIfOutOfRange && satisfies) processLockfiles = false

  let billing = null
  if (!env.IS_ENTERPRISE) {
    billing = await getActiveBilling(accountId)
    if (repoDoc.private) {
      if (!billing || await getAccountNeedsMarketplaceUpgrade(accountId)) {
        log.warn('exited: payment required')
        return
      }
    }
  }

  const [owner, repo] = repoDoc.fullName.split('/')

  // Bail if the dependency is ignored in a group (yes, group configs make no sense in a non-monorepo, but we respect it anyway)
  if (config.groups && isDependencyIgnoredInGroups(config.groups, 'package.json', dependency)) {
    log.warn(`exited: ${dependency} ${version} ignored by groups config`, { config })
    return
  }
  // Bail if the dependency is ignored globally
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

      // get version for each dependency
      const npmDoc = await npm.get(depName)
      const latestDependencyVersion = npmDoc['distTags']['latest']

      if (semver.ltr(latestDependencyVersion, oldPkgVersion)) { // no downgrades
        log.warn(`exited: ${dependency} ${latestDependencyVersion} would be a downgrade from ${oldPkgVersion}`, {newVersion: latestDependencyVersion, oldVersion: oldPkgVersion})
        return null
      }

      const commitMessageKey = !satisfies && dependencyType === 'dependencies'
        ? 'dependencyUpdate'
        : 'devDependencyUpdate'
      const commitMessageValues = { dependency: depName, version: latestDependencyVersion }
      let commitMessage = getMessage(config.commitMessages, commitMessageKey, commitMessageValues)

      if (!satisfies && openPR) {
        await upsert(repositories, openPR._id, {
          comments: [...(openPR.comments || []), latestDependencyVersion]
        })
        commitMessage += getMessage(config.commitMessages, 'closes', {number: openPR.number})
      }
      log.info('commit message created', {commitMessage})

      return {
        transform: createTransformFunction(dependencyType, depName, latestDependencyVersion, log),
        path: 'package.json',
        message: commitMessage
      }
    }))
  }

  const openPR = await findOpenPR()

  const transforms = _.compact(_.flatten(await createTransformsArray(group, repoDoc.packages['package.json'])))
  const lockFileCommitMessage = getMessage(config.commitMessages, 'lockfileUpdate')
  const sha = await createBranch({
    installationId,
    owner,
    repoName: repo,
    repoDoc,
    branch: base,
    newBranch,
    path: 'package.json',
    transforms,
    processLockfiles,
    lockFileCommitMessage
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

  const compareURL = generateGitHubCompareURL(repoDoc.fullName, base, newBranch)

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

  const title = getPrTitle({
    version: 'basicPR',
    dependency: dependencyKey,
    prTitles: config.prTitles})

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
    log.warn('Could not create PR', { err })
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

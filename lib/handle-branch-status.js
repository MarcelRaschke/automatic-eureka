const _ = require('lodash')
const Log = require('gk-log')

const { getInfos, getFormattedDependencyURL } = require('./get-infos')
const openIssue = require('./open-issue')
const statsd = require('./statsd')
const upsert = require('./upsert')
const dbs = require('./dbs')
const githubQueue = require('./github-queue')
const { generateGitHubCompareURL } = require('../utils/utils')

module.exports = async function (
  { installationId, accountId, repository, branchDoc, combined }
) {
  const { repositories, npm } = await dbs()
  const logs = dbs.getLogsDb()
  const log = Log({ logsDb: logs, accountId, repoSlug: repository.full_name, context: 'handle-branch-status' })
  const [owner, repo] = repository.full_name.split('/')
  const repositoryId = String(repository.id)
  const {
    purpose,
    dependency,
    monorepoGroupName,
    version,
    oldVersionResolved,
    base,
    head,
    dependencyType
  } = branchDoc
  const packageUpdateList = branchDoc.packageUpdateList || `The \`${dependencyType.replace('ies', 'y')}\` **${dependency}** was updated from \`${oldVersionResolved}\` to \`${version}\`.`
  const ghqueue = githubQueue(installationId)

  log.info('started', { branchDoc: { purpose,
    dependency,
    monorepoGroupName,
    version,
    oldVersionResolved } })

  const dependencyKey = monorepoGroupName || dependency
  const issue = _.get(
    await repositories.query('issue_open_by_dependency', {
      key: [repositoryId, dependencyKey],
      include_docs: true
    }),
    'rows[0].doc'
  )
  const { number } = issue || {}

  const change = {
    statuses: combined.statuses,
    processed: true,
    state: combined.state
  }

  if (!issue && combined.state === 'success') {
    try {
      await ghqueue.write(github => github.gitdata.deleteRef({
        owner,
        repo,
        ref: 'heads/' + head
      }))
    } catch (e) {
      if (e.status !== 422) throw e
    }

    await upsert(
      repositories,
      branchDoc._id,
      Object.assign(
        {
          referenceDeleted: true
        },
        change
      )
    )
    return
  }

  branchDoc = await upsert(repositories, branchDoc._id, change)

  const compareURL = generateGitHubCompareURL(repository.full_name, base, head)

  if (purpose === 'pin') {
    if (!issue) throw new Error('Inconsistent state')

    await ghqueue.write(github => github.issues.createComment({
      owner,
      repo,
      number,
      body: combined.state === 'success'
        ? `After pinning ${branchDoc.group ? `group **${branchDoc.group}** ` : ''}to **${version}** your tests are passing again. [Downgrade this dependency 📌](${compareURL}).`
        : `After pinning ${branchDoc.group ? `group **${branchDoc.group}** ` : ''}to **${version}** your tests are still failing. The reported issue _might_ not affect your project. These imprecisions are caused by inconsistent test results.`
    }))

    log.info(`Created issue comment: Pin dependency to version ${version}`)

    statsd.increment('issue_comments')

    return
  }

  const { versions } = await npm.get(dependency)
  const diffBase = issue
    ? _.get(issue, 'comments.length') ? _.last(issue.comments) : issue.version
    : oldVersionResolved

  const repositoryURL = _.get(versions, `['${version}'].repository.url`, '')
  const dependencyLink = getFormattedDependencyURL({ repositoryURL })
  const { release, diffCommits } = await getInfos({
    installationId,
    dependency,
    monorepoGroupName,
    version,
    diffBase,
    versions
  })

  if (!issue && combined.state === 'failure') {
    await openIssue({
      installationId,
      owner,
      repo,
      repositoryId,
      accountId,
      version,
      dependency: dependencyKey,
      dependencyType,
      oldVersionResolved,
      base,
      head,
      dependencyLink,
      release,
      diffCommits,
      statuses: combined.statuses,
      monorepoGroupName,
      packageUpdateList
    })

    log.info('Created failure issue')
    return
  }
  const bodyDetails = _.compact(['\n', release, diffCommits]).join('\n')
  const commitAmount = packageUpdateList.match(/was updated from/g).length
  const failureCommentBody = (packageUpdateList + `\n\n**Your tests are still failing with ${commitAmount <= 1 ? 'this version' : 'these versions'}.** [Compare changes](${compareURL})\n${bodyDetails}`).trim()

  if (combined.state === 'failure') {
    if (hasVersionComment(issue, version)) {
      return
    }
    await ghqueue.write(github => github.issues.createComment({
      owner,
      repo,
      number,
      body: failureCommentBody
    }))

    statsd.increment('issue_comments')

    await upsert(repositories, issue._id, {
      comments: [...(issue.comments || []), version]
    })

    log.info('Commented on open issue: tests are still failing.')
    return
  }

  const successCommentBody = `${packageUpdateList}\n\nYour tests ${branchDoc.group ? `for group **${branchDoc.group}** ` : ''}are passing again with this update. [Explicitly upgrade ${branchDoc.group ? `**${branchDoc.group}** ` : ''}to ${commitAmount <= 1 ? 'this version' : 'these versions'} 🚀](${compareURL})\n\n${bodyDetails}`.trim()

  await ghqueue.write(github => github.issues.createComment({
    owner,
    repo,
    number,
    body: successCommentBody
  }))
  log.info('Commented on issue: tests are passing again.')

  statsd.increment('issue_comments')

  // Not closing the issue, so decision whether to explicitly upgrade or just close is with the user
  // await github.issues.update({owner, repo, number, state: 'closed'})

  function hasVersionComment (issue, version) {
    if (!issue.version && !issue.comments) {
      log.error('no version information on issue document', { issue })
      return false
    }
    return issue.version === version || (issue.comments && issue.comments.includes(version))
  }
}

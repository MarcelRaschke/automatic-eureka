const statsd = require('./statsd')
const githubQueue = require('./github-queue')

const { getNewLockfile } = require('../lib/lockfile')
const { getLockfilePath } = require('../utils/utils')

const Log = require('gk-log')
const dbs = require('../lib/dbs')

global.Promise = require('bluebird')

module.exports = async (
  {
    installationId,
    newBranch,
    branch,
    owner,
    repoName,
    repoDoc,
    message,
    transforms,
    path,
    transform,
    processLockfiles,
    lockFileCommitMessage
  }
) => {
  if (!transforms) transforms = [{ transform, path, message }]
  const ghqueue = githubQueue(installationId)
  let contents = {}

  const commits = (await Promise.mapSeries(transforms, async (
    { path, transform, message, create },
    index
  ) => {
    let blob = {}
    try {
      if (contents[path]) {
        blob.content = contents[path]
      } else {
        if (path === 'README.md') {
          blob = await ghqueue.read(github => github.repos.getReadme({ owner, repo: repoName, ref: branch }))
          path = blob.path
        } else {
          blob = await ghqueue.read(github => github.repos.getContent({
            owner,
            repo: repoName,
            path,
            ref: branch
          }))
        }
      }
    } catch (e) {
      if (e.code !== 404) throw e
      if (!create) return
    }
    let oldContent
    if (contents[path]) {
      oldContent = contents[path]
    } else {
      oldContent = blob.content ? Buffer.from(blob.content, 'base64').toString() : ''
    }

    contents[path] = await transform(oldContent, path)
    if (!contents[path] || contents[path] === oldContent) return
    return { path, content: contents[path], message, index }
  })).filter(c => c)

  if (commits.length === 0) return

  /*
  After processing all the transforms and checking whether they generated any commits,
  we check each commit whether it affected a `package.json`, and generate its lockfile,
  if applicable.

  Note that there are no transforms for these commits. They are added on to the end of
  the commits array and receive an index value, but that doesn’t correspond to an index
  of the transforms array.

  Transforms array:
  ['readme', 'travis', 'package.json', 'yay/package.json']
  Commit array with lockfiles:
  ['readme', 'travis', 'package.json', 'yay/package.json', 'package-lock.json', 'yay/package-lock.json']

  */
  if (processLockfiles && repoDoc && repoDoc.files) {
    const logs = dbs.getLogsDb()
    const log = Log({logsDb: logs, accountId: repoDoc.accountId, repoSlug: repoDoc.fullName, context: 'create-branch'})
    for (const commit of commits) {
      // continue skips the current iteration but continues with the for loop as a whole
      if (!commit.path.includes('package.json')) continue
      const lockfilePath = getLockfilePath(repoDoc.files, commit.path)

      if (!lockfilePath) continue
      log.info('starting lockfile update', {lockfilePath})
      const updatedPackageFile = repoDoc.packages[commit.path]
      const oldLockfile = await ghqueue.read(github => github.repos.getContent({ path: lockfilePath, owner, repo: repoName }))
      const oldLockfileContent = Buffer.from(oldLockfile.content, 'base64')
      log.info('received existing lockfile from GitHub', {oldLockfile})
      const isNpm = lockfilePath.includes('package-lock.json')
      try {
        const {ok, contents} = await getNewLockfile(JSON.stringify(updatedPackageFile), JSON.stringify(oldLockfileContent), isNpm)
        if (ok) {
          // !ok means the old and new lockfile are the same, so we don’t make a commit
          log.info('new lockfile contents produced', {contents})
          statsd.increment('lockfiles')
          commits.push({
            path: lockfilePath,
            content: contents,
            message: lockFileCommitMessage,
            index: commits.length
          })
        }
      } catch (e) {
        log.error('error fetching updated lockfile from exec server', {e})
      }
    }
  }

  const head = await ghqueue.read(github => github.gitdata.getReference({
    owner,
    repo: repoName,
    ref: `heads/${branch}`
  }))

  const createCommits = async (sha, { path, content, message, index }) => {
    const newTree = await ghqueue.write(github => github.gitdata.createTree({
      owner,
      repo: repoName,
      base_tree: sha,
      tree: [{ path, content, mode: '100644', type: 'blob' }]
    }))

    const commit = await ghqueue.write(github => github.gitdata.createCommit({
      owner,
      repo: repoName,
      message,
      tree: newTree.sha,
      parents: [sha]
    }))
    /*
      .created is written back into the original transform which is still used
      after create-branch is called from wherever, create-initial-branch for example. So after
      create-branch returns its SHA to create-initial-branch, the latter can check whether, for
      example, travis.yml or readme.md were modified. This is then passed into create-pr or
      whatever else sends messages to humans, where we can then notify them which files were
      MODIFIED (so the key is actually a misnomer).

      ⚠️ Lockfiles only have commits, not transforms, so when they try to write back to their
      transform, they can’t, because there is none. That’s why we check whether there’s something at
      every index we want to update.
    */
    if (transforms[index]) {
      transforms[index].created = true
    }

    return commit.sha
  }

  const sha = await Promise.reduce(commits, createCommits, head.object.sha)

  try {
    await ghqueue.write(github => github.gitdata.createReference({
      owner,
      repo: repoName,
      sha,
      ref: 'refs/heads/' + newBranch
    }))
  } catch (err) {
    if (!err.message.includes('already exists')) throw err

    const branch = await ghqueue.read(github => github.repos.getBranch({
      owner,
      repo: repoName,
      branch: newBranch
    }))

    if (branch.commit.committer.type !== 'Bot') throw err

    return branch.commit.sha
  }

  statsd.increment('branches')

  return sha
}

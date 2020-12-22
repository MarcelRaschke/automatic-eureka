const updatedAt = require('./updated-at')
const _ = require('lodash')

async function getInvalidConfigIssueNumber (repositories, repositoryId) {
  return _.get(
    await repositories.query('open_invalid_config_issue', {
      key: repositoryId,
      include_docs: true
    }),
    'rows[0].doc.number'
  )
}
async function invalidConfigFile ({repoDoc, config, repositories, repository, repositoryId, details, log, isBlockingInitialPR = false}) {
  log.warn('validation of greenkeeper.json failed', {error: details, greenkeeperJson: repoDoc.greenkeeper})
  // reset greenkeeper config in repoDoc to the previous working version and start an 'invalid-config-file' job
  _.set(repoDoc, ['greenkeeper'], config)
  await updateDoc(repositories, repository, repoDoc)
  // If the config file is invalid, open an issue with validation errors and don’t do anything else in this file:
  // - no initial branch should be created (?)
  // - no initial subgroup branches should (or can be) be created
  // - no branches need to be deleted (we can’t be sure the changes are valid)

  return {
    data: {
      name: 'invalid-config-file',
      messages: _.map(details, 'formattedMessage'),
      errors: details,
      repositoryId,
      accountId: repoDoc.accountId,
      isBlockingInitialPR
    }
  }
}

function updateDoc (repositories, repository, repoDoc) {
  // Danger: this function receives inconsistent inputs from create-initial-branch.js,
  // where a repoDoc is used in place of a repository object.
  // Problem: repository keys are snake_case, repoDoc are camelCase!
  // We handle this with the ||
  return repositories.put(
    updatedAt(
      Object.assign(repoDoc, {
        private: repository.private,
        fullName: repository.full_name || repository.fullName,
        fork: repository.fork,
        hasIssues: repository.has_issues || repository.hasIssues
      })
    )
  )
}

module.exports = {
  invalidConfigFile,
  getInvalidConfigIssueNumber
}

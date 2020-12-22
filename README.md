***
☝️ **Important announcement:** Greenkeeper will be saying goodbye 👋 and passing the torch to Snyk on June 3rd, 2020! New installations are no longer possible. [Find out how to migrate to Snyk and more at greenkeeper.io](https://greenkeeper.io)
***

<div align="center">
  <img src="https://user-images.githubusercontent.com/391124/36849148-8a73f484-1d63-11e8-8f2b-d7ffa940cb31.jpg" alt="Greenkeeper" align="center" />
</div>
<div align="center">
  <a href="https://greenkeeper.io/">
    <img src="https://badges.greenkeeper.io/greenkeeperio/greenkeeper.svg"
      alt="Greenkeeper badge" />
  </a>
  <a href="https://greenkeeper-slack.herokuapp.com/">
    <img src="https://greenkeeper-slack.herokuapp.com/badge.svg"
      alt="Slack" />
  </a>
  <a href="https://travis-ci.org/greenkeeperio/greenkeeper">
    <img src="https://travis-ci.org/greenkeeperio/greenkeeper.svg?branch=master"
      alt="Build Status" />
  </a>
  <a href="https://david-dm.org/greenkeeperio/greenkeeper/master">
    <img src="https://david-dm.org/greenkeeperio/greenkeeper/master.svg"
      alt="Dependency Status" />
  </a>
  <a href="https://david-dm.org/greenkeeperio/greenkeeper/master?type=dev">
    <img src="https://david-dm.org/greenkeeperio/greenkeeper/master/dev-status.svg"
      alt="devDependency Status" />
  </a>
  <a href="https://github.com/feross/standard">
    <img src="https://img.shields.io/badge/code%20style-standard-brightgreen.svg?style=flat"
      alt="js-standard-style" />
  </a>
  <a href="https://github.com/semantic-release/semantic-release">
    <img src="https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg"
      alt="semantic-release" />
  </a>
</div>
<div align="center">
  <h3>
    <a href="https://greenkeeper.io/">
      Website
    </a>
    <span> | </span>
    <a href="https://blog.greenkeeper.io/">
      Blog
    </a>
    <span> | </span>
    <a href="https://github.com/greenkeeperio/greenkeeper/blob/master/CONTRIBUTING.md">
      Contributing
    </a>
    <span> | </span>
    <a href="https://greenkeeper.io/faq.html">
      FAQ
    </a>
    <span> | </span>
    <a href="https://greenkeeper.io/docs.html">
      General Documentation
    </a>
  </h3>
</div>
<div align="center">
  <strong>Greenkeeper brings you safety & consistency with automatic updates and **real-time monitoring for npm dependencies**. Let a bot send you informative and actionable issues so you can easily keep your software up to date and in working condition.</strong>
</div>
<div align="center">
  Join over **10000 projects on GitHub that trust Greenkeeper** to warn them before dependency updates break their builds.
</div>
<details>
<summary>Who else is using it? Anyone I know?</summary>

Well, we’re helping out these fine folks, for example:

- [lodash](https://lodash.com)
- [PouchDB](https://pouchdb.com/)
- [Karma](https:/github.com/karma-runner/karma)
- [request](https://www.npmjs.com/package/request)
- [Google’s AMP](https://github.com/ampproject/amphtml)
- [Modernizr](https://modernizr.com)
- [standard](https://www.npmjs.com/package/standard)
- [webtorrent](https://www.npmjs.com/package/webtorrent)
- [mustache.js](https://github.com/janl/mustache.js)
- [FreeCodeCamp](https://freecodecamp.com)
- [HTML5 Boilerplate](https://github.com/h5bp/html5-boilerplate)

And many thousands more!

</details>

<details>
<summary>Tell me more about how Greenkeeper works, please!</summary>

No problem! Greenkeeper sits between npm and GitHub, observing all of the modules you depend on. When they get updated, your project gets a new branch with that update. Your CI tests kick in, and we watch them to see whether they pass.

Based on the test results and your current version definitions we will open up clear, actionable issues for you. If there’s nothing for you to do, we won’t nag you, but if a dependency *does* break your software, you’ll know immediately, and can get started on fixing the problem.

And if a you’ve got stuff to do, we understand. Sometimes you simply have to make a pragmatic trade-off between fixing your build for the breaking update or just pinning the working version so you can get back to it later. Our bot can respect that, and will let you pin the last working version of the dependency in the issue thread:

| **Screenshot - Pinning dependencies** |
|---|
| ![Choosing repositories](https://cdn-images-1.medium.com/max/1600/0*T11jS2wNKlbQVbgC.) |

</details>

<details>
<summary>I found a critical bug, who do I talk to?</summary>

If you’ve discovered a security-related bug in Greenkeeper or related services, **please disclose it to us confidentially** by emailing us at support@greenkeeper.io

If you find any, **don’t share security vulnerabilities publicly** (in a GitHub issue for example), always keep these conversations with us confidential so we have a chance to get things fixed before anyone exploits the bug.
</details>

---

<details>
<summary>Jobs Service Documentation</summary>

This is the core service of Greenkeeper. It takes care of the dependency update logic and the related pull request/issue creation.

## Job Types
> 🚨🚧 The following documentation might be outdated. We are currently working on improving this section.

### github-event

The `github-event` job gets created by our [hooks](https://github.com/greenkeeperio/hooks) service.
It's answering all incoming webhooks from GitHub and creates this job with the full payload from github as `job.data`.
It only adds one additional `type` property to it with the name of the webhook event.

#### github-event:integration_installation

Depending on `action` a new entry is added/removed to/from the installations database.
All repositories are requested from GitHub to sync them with our database.
All repositories with a package.json receive their initial pull request (`create-initial-branch`).

#### github-event:integration_installation_repositories

Depending on `action` entries are added/removed to/from the repositories database.
Added repositories with a package.json receive their initial pull request (`create-initial-branch`).

#### github-event:push

The package.json contents are retrieved, parsed and synced to our database.

#### github-event:status

If the status affects a Greenkeeper pull_request the results are recorded in our repositories database with all metadata.

If the status of a branch is `failing`, it will create a new branch to pin to the last working version `create-pin-branch`.
When the status for that pin branch is coming, an issue is created with `create-issue`.
If that issue already exists and it's still failing it will comment `comment-issue`, but if it's
succeeding it will close that issue with `close-issue`.

#### github-event:pull_request

When an initial Greenkeeper pull request is merged the repository gets enabled (`enable-repository`).

When a Greenkeeper pull request is merged older/included pull requests for the same dependency are closed (`delete-older-branches`).
Unmergeable Greenkeeper pull requests get "rebased" (`rebase-unmergeable-branches`).

### registry-change

The `registry-change` job gets created by our [changes](https://github.com/greenkeeperio/changes) service.
It's listening for changes from npm and creates this job with the full payload from npm as `job.data`.

It figures out whether the change actually contains a new version, and on which dist-tag. It stores the versions in our npm database.

It figures out who is depending on the dependency that changed and schedules branch creation jobs for enabled ones. (`create-version-branch`)

### create-pin-branch

Creates a branch for a dependency, pinning to the version before.

### create-issue

Creates an issue with the information that a dependency is failing.

### comment-issue

Comments to an issue that a dependency is still failing.

### close-issue

Closes an issue because the dependency is no longer failing.

### create-version-branch

Used to be package-bump with our oAuth App.

If there are no tests detected, or the update is outside of the version range triggers `create-version-pr` right away.

### create-version-pr

Used to be package-send-pr with our oAuth App.

### delete-branches

Deletes all branches related to a dependency which version is less or equal to the specified one.

### create-initial-branch

Used to be package-pin with our oAuth App.

### enable-repository

Used to happen inside webservice with our oAuth App.

### delete-older-branches

Used to happen inside pull-request-close with our oAuth App.

### rebase-unmergeable-branches

Used to happen inside pull-request-close with our oAuth App.

## documents

### installations
```js
{
  _id: '8422',  // github account id
  installation: 10, // installation id,
  plan: 'free', // plan
  login: 'finnp', // github name
  type: 'User' // 'User' or 'Organization'
}
```

###  repositories
#### type: repository
```js
{
    _id: '111', // String(repo.id),
    type: 'repository',
    enabled: false,
    accountId: '8422', // account id (key for installations)
    fullName: 'greenkeeperio/jobs',
    private: true,
    fork: false,
    hasIssues: true,
    packages: {
          'package.json': {}
    }
}
```

#### type:branch
```js
{
  _id: '111:branch:deadbeefdeadbeef', // repositoryId + sha
  type: 'branch',
  purpose: undefined, // can be 'pin', otherwise not defined
  sha: 'deadbeefdeadbeef',
  base: 'master', // base branch
  head: 'greenkeeper-lodash-8.0.0', // branch name
  dependency: 'lodash',
  version: '8.0.0',
  oldVersion: '~7.0.0',
  oldVersionResolved: '7.0.0',
  dependencyType: 'devDependencies',
  repositoryId: '111',
  accountId: '8422',
  processed: true, // the branch was processed
  referenceDeleted: true, // the branch reference was deleted
  state: 'failure', // ci status
  updated_at: '2016-09-28T15:07:03.022Z'
}
```

#### type:pr
```js
{
  _id: '111:pr:6', // repositoryId, PrId
  type: 'pr',
  repositoryId: 11,
  accountId: 42
  initial: true, // is this an initial pull request?
  number: 6,
  head: 'greenkeeper-lodash-8.0.0', // branch name
  state: 'open', // 'closed'
  merged: true,
  updated_at, '2016-09-28T15:07:03.022Z'
}
```

#### type:issue
```js
{
  _id: '111:issue:6',
  type: 'issue',
  repositoryId: '111',
  dependency: 'lodash',
  version: '1.0.0',
  number: 6,
  state: 'open',
  updated_at
}
```

</details>

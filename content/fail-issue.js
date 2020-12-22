const _ = require('lodash')
const md = require('./template')
const { generateGitHubCompareURL } = require('../utils/utils')

const notDevDependency = ({dependency}) => md`
${dependency} is a direct dependency of this project, and **it is very likely causing it to break**. If other packages depend on yours, this update is probably also breaking those in turn.
`

const devDependency = ({dependency, dependencyType}) => md`
${dependency} is a ${dependencyType.replace(/ies$/, 'y')} of this project. It **might not break your production code or affect downstream projects**, but probably breaks your build or test tools, which may **prevent deploying or publishing**.
`

const ciStatuses = ({statuses}) => md`
<details>
<summary>Status Details</summary>

${statuses.map(status => `- ${status.state === 'success' ? '✅' : '❌'} **${status.context}** ${status.description} [Details](${status.target_url})`)}
</details>
`

module.exports = ({version, dependencyLink, owner, repo, base, head, dependency, oldVersionResolved, dependencyType, statuses, release, diffCommits, monorepoGroupName}) => {
  const compareURL = generateGitHubCompareURL(`${owner}/${repo}`, base, head)
  return md`
${_.isEmpty(monorepoGroupName)
    ? `## Version **${version}** of **${dependency}** was just published.`
    : `## Version **${version}** of the **${monorepoGroupName}** packages was just published.`}

<table>
  <tr>
    <th align=left>
      Branch
    </th>
    <td>
      <a href="${compareURL}">Build failing 🚨</a>
    </td>
  </tr>
  <tr>
    <th align=left>
      ${_.isEmpty(monorepoGroupName)
    ? 'Dependency'
    : 'Monorepo release group'
}
    </th>
    <td>
      <a target=_blank href=${dependencyLink}>${monorepoGroupName || dependency}</a>
    </td>
  </tr>
  <tr>
    <th align=left>
      Current Version
    </td>
    <td>
      ${oldVersionResolved}
    </td>
  </tr>
  <tr>
    <th align=left>
      Type
    </td>
    <td>
      ${dependencyType.replace(/ies$/, 'y')}
    </td>
  </tr>
</table>

This version is **covered** by your **current version range** and after updating it in your project **the build failed**.

${!_.isEmpty(monorepoGroupName) && `This monorepo update includes releases of one or more dependencies which all belong to the [${monorepoGroupName} group definition](https://github.com/greenkeeperio/monorepo-definitions).`
}

${
  dependencyType === 'dependencies'
    ? notDevDependency({dependency})
    : devDependency({dependency, dependencyType})
}

${_.get(statuses, 'length') && ciStatuses({statuses})}

---

${_.compact([release, diffCommits])}


<details>
<summary>FAQ and help</summary>

There is a collection of [frequently asked questions](https://greenkeeper.io/faq.html). If those don’t help, you can always [ask the humans behind Greenkeeper](https://github.com/greenkeeperio/greenkeeper/issues/new).
</details>

---


Your [Greenkeeper](https://greenkeeper.io) Bot :palm_tree:
`
}

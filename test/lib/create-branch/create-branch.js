const nock = require('nock')

const createBranch = require('../../../lib/create-branch')
const { createTransformFunction } = require('../../../utils/utils')
const dbs = require('../../../lib/dbs')

nock.disableNetConnect()
nock.enableNetConnect('localhost')

describe('create branch', async () => {
  test('change one file (package.json)', async () => {
    const gitHubNock = nock('https://api.github.com')
      .post('/app/installations/123/access_tokens')
      .optionally()
      .reply(200, {
        token: 'secret'
      })
      .get('/rate_limit')
      .optionally()
      .reply(200, {})
      .get('/repos/owner/repo/contents/package.json')
      .query({ ref: 'master' })
      .reply(200, {
        type: 'file',
        content: Buffer.from('testdata').toString('base64')
      })
      .get('/repos/owner/repo/git/refs/heads/master')
      .reply(200, {
        object: {
          sha: '123abc'
        }
      })
      .post('/repos/owner/repo/git/trees', {
        tree: [
          {
            path: 'package.json',
            content: 'TESTDATA',
            mode: '100644',
            type: 'blob'
          }
        ],
        base_tree: '123abc'
      })
      .reply(201, {
        sha: 'def456'
      })
      .post('/repos/owner/repo/git/commits', {
        message: 'new commit',
        tree: 'def456',
        parents: ['123abc']
      })
      .reply(201, {
        sha: '789beef'
      })
      .post('/repos/owner/repo/git/refs', {
        ref: 'refs/heads/testBranch',
        sha: '789beef'
      })
      .reply(201)

    const sha = await createBranch({
      installationId: 123,
      owner: 'owner',
      repoName: 'repo',
      branch: 'master',
      newBranch: 'testBranch',
      path: 'package.json',
      transform: oldPkg => oldPkg.toUpperCase(),
      message: 'new commit'
    })

    expect(sha).toEqual('789beef')
    expect(gitHubNock.isDone()).toBeTruthy()
  })

  test('change multiple files (package.json, readme.md)', async () => {
    const gitHubNock = nock('https://api.github.com')
      .post('/app/installations/123/access_tokens')
      .optionally()
      .reply(200, {
        token: 'secret'
      })
      .get('/rate_limit')
      .optionally()
      .reply(200, {})
      .get('/repos/owner/repo/readme?ref=master')
      .reply(200, {
        path: 'readme.md',
        content: Buffer.from('TESTDATA').toString('base64')
      })
      .get('/repos/owner/repo/contents/package.json')
      .query({ ref: 'master' })
      .reply(200, {
        type: 'file',
        content: Buffer.from('testdata').toString('base64')
      })
      .get('/repos/owner/repo/git/refs/heads/master')
      .reply(200, {
        object: {
          sha: '123abc2'
        }
      })
      .post('/repos/owner/repo/git/trees', {
        tree: [
          {
            path: 'package.json',
            content: 'TESTDATA',
            mode: '100644',
            type: 'blob'
          }
        ],
        base_tree: '123abc2'
      })
      .reply(201, {
        sha: 'def457'
      })
      .post('/repos/owner/repo/git/trees', {
        tree: [
          {
            path: 'readme.md',
            content: 'testdata',
            mode: '100644',
            type: 'blob'
          }
        ],
        base_tree: '789beef2'
      })
      .reply(201, {
        sha: '890abc'
      })
      .post('/repos/owner/repo/git/commits', {
        message: 'pkg',
        tree: 'def457',
        parents: ['123abc2']
      })
      .reply(201, {
        sha: '789beef2'
      })
      .post('/repos/owner/repo/git/commits', {
        message: 'readme',
        tree: '890abc',
        parents: ['789beef2']
      })
      .reply(201, {
        sha: '789beef2'
      })
      .post('/repos/owner/repo/git/refs', {
        ref: 'refs/heads/testBranch',
        sha: '789beef2'
      })
      .reply(201)

    const sha = await createBranch({
      installationId: 123,
      owner: 'owner',
      repoName: 'repo',
      branch: 'master',
      newBranch: 'testBranch',
      transforms: [
        {
          path: 'package.json',
          message: 'pkg',
          transform: oldPkg => oldPkg.toUpperCase()
        },
        {
          path: 'README.md',
          message: 'readme',
          transform: (old, path) => path === 'readme.md' && old.toLowerCase()
        }
      ]
    })

    expect(sha).toEqual('789beef2')
    expect(gitHubNock.isDone()).toBeTruthy()
  })

  const testThreeData = {
    'package.json': {
      dependencies: {
        react: '1.0.0'
      }
    },
    'backend/package.json': {
      dependencies: {
        react: '1.0.0'
      }
    }
  }

  test('change multiple monorepo files (package.json, backend/package.json)', async () => {
    expect.assertions(13)

    const gitHubNock = nock('https://api.github.com')
      .post('/app/installations/123/access_tokens')
      .optionally()
      .reply(200, {
        token: 'secret'
      })
      .get('/rate_limit')
      .optionally()
      .reply(200, {})
      .get('/repos/owner/repo/contents/package.json')
      .query({ ref: 'master' })
      .reply(200, {
        type: 'file',
        content: Buffer.from(JSON.stringify(testThreeData['package.json'])).toString('base64')
      })
      .get('/repos/owner/repo/contents/backend/package.json')
      .query({ ref: 'master' })
      .reply(200, {
        type: 'file',
        content: Buffer.from(JSON.stringify(testThreeData['backend/package.json'])).toString('base64')
      })
      .get('/repos/owner/repo/git/refs/heads/master')
      .reply(200, {
        object: {
          sha: '123abc2'
        }
      })
      .post('/repos/owner/repo/git/trees')
      .reply(201, (uri, requestBody) => {
        expect(JSON.parse(requestBody).tree[0].path).toEqual('package.json')
        expect(JSON.parse(requestBody).tree[0].content).toEqual('{"dependencies":{"react":"2.0.0"}}')
        return { sha: 'def457' }
      })
      .post('/repos/owner/repo/git/trees')
      .reply(201, (uri, requestBody) => {
        expect(JSON.parse(requestBody).tree[0].path).toEqual('backend/package.json')
        expect(JSON.parse(requestBody).tree[0].content).toEqual('{"dependencies":{"react":"2.0.0"}}')
        return { sha: 'def458' }
      })
      .post('/repos/owner/repo/git/commits')
      .reply(201, (uri, requestBody) => {
        expect(JSON.parse(requestBody).tree).toEqual('def457')
        expect(JSON.parse(requestBody).parents[0]).toEqual('123abc2')
        expect(JSON.parse(requestBody).message).toEqual('pkg')
        return { sha: '789beef1' }
      })
      .post('/repos/owner/repo/git/commits')
      .reply(201, (uri, requestBody) => {
        expect(JSON.parse(requestBody).tree).toEqual('def458')
        expect(JSON.parse(requestBody).parents[0]).toEqual('789beef1')
        expect(JSON.parse(requestBody).message).toEqual('pkg2')
        return { sha: '789beef2' }
      })
      .post('/repos/owner/repo/git/refs')
      .reply(201, (uri, requestBody) => {
        expect(JSON.parse(requestBody).sha).toEqual('789beef2')
      })

    const sha = await createBranch({
      installationId: 123,
      owner: 'owner',
      repoName: 'repo',
      branch: 'master',
      newBranch: 'testBranch',
      transforms: [
        {
          path: 'package.json',
          message: 'pkg',
          transform: (old, path) => createTransformFunction('dependencies', 'react', '2.0.0', console)(old)
        },
        {
          path: 'backend/package.json',
          message: 'pkg2',
          transform: (old, path) => createTransformFunction('dependencies', 'react', '2.0.0', console)(old)
        }
      ]
    })

    expect(gitHubNock.isDone()).toBeTruthy()
    expect(sha).toEqual('789beef2')
  })

  const testFourData = {
    'package.json': {
      dependencies: {
        standard: '1.0.0'
      }
    },
    'backend/package.json': {
      dependencies: {
        standard: '1.0.0'
      }
    }
  }

  test('generate new greenkeeper.json and change multiple monorepo files (package.json, backend/package.json)', async () => {
    expect.assertions(18)

    const gitHubNock = nock('https://api.github.com')
      .post('/app/installations/123/access_tokens')
      .optionally()
      .reply(200, {
        token: 'secret'
      })
      .get('/rate_limit')
      .optionally()
      .reply(200, {})
      .get('/repos/owner/repo/contents/greenkeeper.json')
      .query({ ref: 'master' })
      .reply(404, {
        message: 'Not Found'
      })
      .get('/repos/owner/repo/contents/package.json')
      .query({ ref: 'master' })
      .reply(200, {
        type: 'file',
        content: Buffer.from(JSON.stringify(testFourData['package.json'])).toString('base64')
      })
      .get('/repos/owner/repo/contents/backend/package.json')
      .query({ ref: 'master' })
      .reply(200, {
        type: 'file',
        content: Buffer.from(JSON.stringify(testFourData['backend/package.json'])).toString('base64')
      })
      .get('/repos/owner/repo/git/refs/heads/master')
      .reply(200, {
        object: {
          sha: '123abc2'
        }
      })
      .post('/repos/owner/repo/git/trees')
      .reply(201, (uri, requestBody) => {
        expect(JSON.parse(requestBody).tree[0].path).toEqual('greenkeeper.json')
        expect(JSON.parse(requestBody).tree[0].content).toEqual('{"lol":"wat"}')
        return { sha: 'def456' }
      })
      .post('/repos/owner/repo/git/trees')
      .reply(201, (uri, requestBody) => {
        expect(JSON.parse(requestBody).tree[0].path).toEqual('package.json')
        expect(JSON.parse(requestBody).tree[0].content).toEqual('{"dependencies":{"standard":"2.0.0"}}')
        return { sha: 'def457' }
      })
      .post('/repos/owner/repo/git/trees')
      .reply(201, (uri, requestBody) => {
        expect(JSON.parse(requestBody).tree[0].path).toEqual('backend/package.json')
        expect(JSON.parse(requestBody).tree[0].content).toEqual('{"dependencies":{"standard":"2.0.0"}}')
        return { sha: 'def458' }
      })
      .post('/repos/owner/repo/git/commits')
      .reply(201, (uri, requestBody) => {
        expect(JSON.parse(requestBody).tree).toEqual('def456')
        expect(JSON.parse(requestBody).parents[0]).toEqual('123abc2')
        expect(JSON.parse(requestBody).message).toEqual('config')
        return { sha: '789beef0' }
      })
      .post('/repos/owner/repo/git/commits')
      .reply(201, (uri, requestBody) => {
        expect(JSON.parse(requestBody).tree).toEqual('def457')
        expect(JSON.parse(requestBody).parents[0]).toEqual('789beef0')
        expect(JSON.parse(requestBody).message).toEqual('pkg')
        return { sha: '789beef1' }
      })
      .post('/repos/owner/repo/git/commits')
      .reply(201, (uri, requestBody) => {
        expect(JSON.parse(requestBody).tree).toEqual('def458')
        expect(JSON.parse(requestBody).parents[0]).toEqual('789beef1')
        expect(JSON.parse(requestBody).message).toEqual('pkg2')
        return { sha: '789beef2' }
      })
      .post('/repos/owner/repo/git/refs')
      .reply(201, (uri, requestBody) => {
        expect(JSON.parse(requestBody).sha).toEqual('789beef2')
      })

    const payload = {
      installationId: 123,
      owner: 'owner',
      repoName: 'repo',
      branch: 'master',
      newBranch: 'testBranch',
      transforms: [
        {
          path: 'greenkeeper.json',
          message: 'config',
          transform: () => '{"lol":"wat"}',
          create: true
        },
        {
          path: 'package.json',
          message: 'pkg',
          transform: (old, path) => createTransformFunction('dependencies', 'standard', '2.0.0', console)(old)
        },
        {
          path: 'backend/package.json',
          message: 'pkg2',
          transform: (old, path) => createTransformFunction('dependencies', 'standard', '2.0.0', console)(old)
        }
      ]
    }

    const sha = await createBranch(payload)

    expect(gitHubNock.isDone()).toBeTruthy()
    expect(sha).toEqual('789beef2')
  })

  const testFiveData = {
    'package.json': {
      dependencies: {
        'flowers': '1.0.0',
        'flowers-pink': '1.0.0',
        'flowers-yellow': '1.0.0',
        'flowers-purple': '1.0.0'
      }
    }
  }

  test('handle monorepo-release', async () => {
    expect.assertions(15)

    const gitHubNock = nock('https://api.github.com')
      .post('/app/installations/123/access_tokens')
      .optionally()
      .reply(200, {
        token: 'secret'
      })
      .get('/rate_limit')
      .optionally()
      .reply(200)
      .get('/repos/bee/repo/contents/package.json?ref=master')
      .reply(200, {
        type: 'file',
        content: Buffer.from(JSON.stringify(testFiveData['package.json'])).toString('base64')
      })
      .get('/repos/bee/repo/git/refs/heads/master')
      .reply(200, {
        object: {
          sha: '123abc2'
        }
      })
      .post('/repos/bee/repo/git/trees')
      .reply(201, (uri, requestBody) => {
        expect(JSON.parse(requestBody).tree[0].path).toEqual('package.json')
        const expectedContent = {
          dependencies: {
            flowers: '2.0.0',
            'flowers-pink': '1.0.0',
            'flowers-yellow': '1.0.0',
            'flowers-purple': '1.0.0'
          }
        }
        expect(JSON.parse(requestBody).tree[0].content).toEqual(JSON.stringify(expectedContent))
        return { sha: 'def456' }
      })
      .post('/repos/bee/repo/git/trees')
      .reply(201, (uri, requestBody) => {
        expect(JSON.parse(requestBody).tree[0].path).toEqual('package.json')
        const expectedContent = {
          dependencies: {
            flowers: '2.0.0',
            'flowers-pink': '2.0.0',
            'flowers-yellow': '1.0.0',
            'flowers-purple': '1.0.0'
          }
        }
        expect(JSON.parse(requestBody).tree[0].content).toEqual(JSON.stringify(expectedContent))
        return { sha: 'def457' }
      })
      .post('/repos/bee/repo/git/trees')
      .reply(201, (uri, requestBody) => {
        expect(JSON.parse(requestBody).tree[0].path).toEqual('package.json')
        const expectedContent = {
          dependencies: {
            flowers: '2.0.0',
            'flowers-pink': '2.0.0',
            'flowers-yellow': '2.0.0',
            'flowers-purple': '1.0.0'
          }
        }
        expect(JSON.parse(requestBody).tree[0].content).toEqual(JSON.stringify(expectedContent))
        return { sha: 'def458' }
      })
      .post('/repos/bee/repo/git/trees')
      .reply(201, (uri, requestBody) => {
        expect(JSON.parse(requestBody).tree[0].path).toEqual('package.json')
        const expectedContent = {
          dependencies: {
            flowers: '2.0.0',
            'flowers-pink': '2.0.0',
            'flowers-yellow': '2.0.0',
            'flowers-purple': '2.0.0'
          }
        }
        expect(JSON.parse(requestBody).tree[0].content).toEqual(JSON.stringify(expectedContent))
        return { sha: 'def459' }
      })
      .post('/repos/bee/repo/git/commits')
      .reply(201, (uri, requestBody) => {
        expect(JSON.parse(requestBody).message).toEqual('flowers')
        return { sha: '789beef0' }
      })
      .post('/repos/bee/repo/git/commits')
      .reply(201, (uri, requestBody) => {
        expect(JSON.parse(requestBody).message).toEqual('flowers-pink')
        return { sha: '789beef1' }
      })
      .post('/repos/bee/repo/git/commits')
      .reply(201, (uri, requestBody) => {
        expect(JSON.parse(requestBody).message).toEqual('flowers-yellow')
        return { sha: '789beef2' }
      })
      .post('/repos/bee/repo/git/commits')
      .reply(201, (uri, requestBody) => {
        expect(JSON.parse(requestBody).message).toEqual('flowers-purple')
        return { sha: '789beef3' }
      })
      .post('/repos/bee/repo/git/refs')
      .reply(201, (uri, requestBody) => {
        expect(JSON.parse(requestBody).sha).toEqual('789beef3')
      })

    const payload = {
      installationId: 123,
      owner: 'bee',
      repoName: 'repo',
      branch: 'master',
      newBranch: 'flowersBranch',
      transforms: [
        {
          path: 'package.json',
          message: 'flowers',
          transform: (old, path) => createTransformFunction('dependencies', 'flowers', '2.0.0', console)(old)
        },
        {
          path: 'package.json',
          message: 'flowers-pink',
          transform: (old, path) => createTransformFunction('dependencies', 'flowers-pink', '2.0.0', console)(old)
        },
        {
          path: 'package.json',
          message: 'flowers-yellow',
          transform: (old, path) => createTransformFunction('dependencies', 'flowers-yellow', '2.0.0', console)(old)
        },
        {
          path: 'package.json',
          message: 'flowers-purple',
          transform: (old, path) => createTransformFunction('dependencies', 'flowers-purple', '2.0.0', console)(old)
        }
      ]
    }

    const sha = await createBranch(payload)
    expect(sha).toEqual('789beef3')

    expect(gitHubNock.isDone()).toBeTruthy()
  })

  const testSixData = {
    'package.json': {
      dependencies: {
        'flowers-pink': '1.0.0',
        'flowers-purple': '1.0.0'
      }
    },
    'backend/package.json': {
      dependencies: {
        'flowers': '1.0.0',
        'flowers-pink': '1.0.0',
        'flowers-yellow': '1.0.0',
        'flowers-purple': '1.0.0'
      }
    }
  }

  test('handle monorepo-release and change multiple monorepo files (package.json, backend/package.json)', async () => {
    expect.assertions(33)

    const gitHubNock = nock('https://api.github.com')
      .post('/app/installations/123/access_tokens')
      .optionally()
      .reply(200, {
        token: 'secret'
      })
      .get('/rate_limit')
      .optionally()
      .reply(200, {})
      .get('/repos/owner/repo/contents/package.json')
      .query({ ref: 'master' })
      .reply(200, {
        type: 'file',
        content: Buffer.from(JSON.stringify(testSixData['package.json'])).toString('base64')
      })
      .get('/repos/owner/repo/contents/backend/package.json')
      .query({ ref: 'master' })
      .reply(200, {
        type: 'file',
        content: Buffer.from(JSON.stringify(testSixData['backend/package.json'])).toString('base64')
      })
      .get('/repos/owner/repo/git/refs/heads/master')
      .reply(200, {
        object: {
          sha: '123abc2'
        }
      })
      .post('/repos/owner/repo/git/trees')
      .reply(201, (uri, requestBody) => {
        expect(JSON.parse(requestBody).tree[0].path).toEqual('package.json')
        const expectedContent = {
          dependencies: {
            'flowers-pink': '2.0.0',
            'flowers-purple': '1.0.0'
          }
        }
        expect(JSON.parse(requestBody).tree[0].content).toEqual(JSON.stringify(expectedContent))
        return { sha: 'def450' }
      })
      .post('/repos/owner/repo/git/trees')
      .reply(201, (uri, requestBody) => {
        expect(JSON.parse(requestBody).tree[0].path).toEqual('package.json')
        const expectedContent = {
          dependencies: {
            'flowers-pink': '2.0.0',
            'flowers-purple': '2.0.0'
          }
        }
        expect(JSON.parse(requestBody).tree[0].content).toEqual(JSON.stringify(expectedContent))
        return { sha: 'def451' }
      })
      .post('/repos/owner/repo/git/trees')
      .reply(201, (uri, requestBody) => {
        expect(JSON.parse(requestBody).tree[0].path).toEqual('backend/package.json')
        const expectedContent = {
          dependencies: {
            'flowers': '2.0.0',
            'flowers-pink': '1.0.0',
            'flowers-yellow': '1.0.0',
            'flowers-purple': '1.0.0'
          }
        }
        expect(JSON.parse(requestBody).tree[0].content).toEqual(JSON.stringify(expectedContent))
        return { sha: 'def452' }
      })
      .post('/repos/owner/repo/git/trees')
      .reply(201, (uri, requestBody) => {
        expect(JSON.parse(requestBody).tree[0].path).toEqual('backend/package.json')
        const expectedContent = {
          dependencies: {
            'flowers': '2.0.0',
            'flowers-pink': '2.0.0',
            'flowers-yellow': '1.0.0',
            'flowers-purple': '1.0.0'
          }
        }
        expect(JSON.parse(requestBody).tree[0].content).toEqual(JSON.stringify(expectedContent))
        return { sha: 'def453' }
      })
      .post('/repos/owner/repo/git/trees')
      .reply(201, (uri, requestBody) => {
        expect(JSON.parse(requestBody).tree[0].path).toEqual('backend/package.json')
        const expectedContent = {
          dependencies: {
            'flowers': '2.0.0',
            'flowers-pink': '2.0.0',
            'flowers-yellow': '2.0.0',
            'flowers-purple': '1.0.0'
          }
        }
        expect(JSON.parse(requestBody).tree[0].content).toEqual(JSON.stringify(expectedContent))
        return { sha: 'def454' }
      })
      .post('/repos/owner/repo/git/trees')
      .reply(201, (uri, requestBody) => {
        expect(JSON.parse(requestBody).tree[0].path).toEqual('backend/package.json')
        const expectedContent = {
          dependencies: {
            'flowers': '2.0.0',
            'flowers-pink': '2.0.0',
            'flowers-yellow': '2.0.0',
            'flowers-purple': '2.0.0'
          }
        }
        expect(JSON.parse(requestBody).tree[0].content).toEqual(JSON.stringify(expectedContent))
        return { sha: 'def455' }
      })
      .post('/repos/owner/repo/git/commits')
      .reply(201, (uri, requestBody) => {
        expect(JSON.parse(requestBody).tree).toEqual('def450')
        expect(JSON.parse(requestBody).parents[0]).toEqual('123abc2')
        expect(JSON.parse(requestBody).message).toEqual('flowers-pink')
        return { sha: '789beef0' }
      })
      .post('/repos/owner/repo/git/commits')
      .reply(201, (uri, requestBody) => {
        expect(JSON.parse(requestBody).tree).toEqual('def451')
        expect(JSON.parse(requestBody).parents[0]).toEqual('789beef0')
        expect(JSON.parse(requestBody).message).toEqual('flowers-purple')
        return { sha: '789beef1' }
      })
      .post('/repos/owner/repo/git/commits')
      .reply(201, (uri, requestBody) => {
        expect(JSON.parse(requestBody).tree).toEqual('def452')
        expect(JSON.parse(requestBody).parents[0]).toEqual('789beef1')
        expect(JSON.parse(requestBody).message).toEqual('flowers')
        return { sha: '789beef2' }
      })
      .post('/repos/owner/repo/git/commits')
      .reply(201, (uri, requestBody) => {
        expect(JSON.parse(requestBody).tree).toEqual('def453')
        expect(JSON.parse(requestBody).parents[0]).toEqual('789beef2')
        expect(JSON.parse(requestBody).message).toEqual('flowers-pink')
        return { sha: '789beef3' }
      })
      .post('/repos/owner/repo/git/commits')
      .reply(201, (uri, requestBody) => {
        expect(JSON.parse(requestBody).tree).toEqual('def454')
        expect(JSON.parse(requestBody).parents[0]).toEqual('789beef3')
        expect(JSON.parse(requestBody).message).toEqual('flowers-yellow')
        return { sha: '789beef4' }
      })
      .post('/repos/owner/repo/git/commits')
      .reply(201, (uri, requestBody) => {
        expect(JSON.parse(requestBody).tree).toEqual('def455')
        expect(JSON.parse(requestBody).parents[0]).toEqual('789beef4')
        expect(JSON.parse(requestBody).message).toEqual('flowers-purple')
        return { sha: '789beef5' }
      })
      .post('/repos/owner/repo/git/refs')
      .reply(201, (uri, requestBody) => {
        expect(JSON.parse(requestBody).sha).toEqual('789beef5')
      })

    const payload = {
      installationId: 123,
      owner: 'owner',
      repoName: 'repo',
      branch: 'master',
      newBranch: 'testBranch',
      transforms: [
        {
          path: 'package.json',
          message: 'flowers-pink',
          transform: (old, path) => createTransformFunction('dependencies', 'flowers-pink', '2.0.0', console)(old)
        },
        {
          path: 'package.json',
          message: 'flowers-purple',
          transform: (old, path) => createTransformFunction('dependencies', 'flowers-purple', '2.0.0', console)(old)
        },
        {
          path: 'backend/package.json',
          message: 'flowers',
          transform: (old, path) => createTransformFunction('dependencies', 'flowers', '2.0.0', console)(old)
        },
        {
          path: 'backend/package.json',
          message: 'flowers-pink',
          transform: (old, path) => createTransformFunction('dependencies', 'flowers-pink', '2.0.0', console)(old)
        },
        {
          path: 'backend/package.json',
          message: 'flowers-yellow',
          transform: (old, path) => createTransformFunction('dependencies', 'flowers-yellow', '2.0.0', console)(old)
        },
        {
          path: 'backend/package.json',
          message: 'flowers-purple',
          transform: (old, path) => createTransformFunction('dependencies', 'flowers-purple', '2.0.0', console)(old)
        }
      ]
    }

    const sha = await createBranch(payload)

    expect(gitHubNock.isDone()).toBeTruthy()
    expect(sha).toEqual('789beef5')
  })
})

describe('create branch with lockfiles', () => {
  test('change one file (package.json) and generate its lockfile', async () => {
    const packageFileContents = { devDependencies: {
      'jest': '1.1.1'
    } }
    const updatedPackageFileContents = { devDependencies: {
      'jest': '1.2.0'
    } }
    const gitHubNock = nock('https://api.github.com')
      .post('/app/installations/123/access_tokens')
      .optionally()
      .reply(200, {
        token: 'secret'
      })
      .get('/rate_limit')
      .optionally()
      .reply(200, {})
      .get('/repos/owner/repo/contents/package.json')
      .query({ ref: 'master' })
      .reply(200, {
        type: 'file',
        content: Buffer.from(JSON.stringify(packageFileContents)).toString('base64')
      })
      .get('/repos/owner/repo/contents/package-lock.json')
      .reply(200, {
        type: 'file',
        path: 'package-lock.json',
        name: 'package-lock.json',
        content: Buffer.from(JSON.stringify(packageFileContents)).toString('base64')
      })
      .get('/repos/owner/repo/git/refs/heads/master')
      .reply(200, {
        object: {
          sha: '123abc'
        }
      })
      // First tree and commit for package.json
      .post('/repos/owner/repo/git/trees', {
        tree: [
          {
            path: 'package.json',
            content: JSON.stringify(updatedPackageFileContents),
            mode: '100644',
            type: 'blob'
          }
        ],
        base_tree: '123abc'
      })
      .reply(201, {
        sha: 'def456'
      })
      .post('/repos/owner/repo/git/commits', {
        message: 'new commit',
        tree: 'def456',
        parents: ['123abc']
      })
      .reply(201, {
        sha: '789beef'
      })
      // Second tree and commit for package-lock.json
      .post('/repos/owner/repo/git/trees', {
        tree: [
          {
            path: 'package-lock.json',
            content: '{"devDependencies":{"jest": {"version": "1.2.0"}}}',
            mode: '100644',
            type: 'blob'
          }
        ],
        base_tree: '789beef'
      })
      .reply(201, {
        sha: 'lol999'
      })
      .post('/repos/owner/repo/git/commits', {
        message: 'Updated lockfile package-lock.json, yay',
        tree: 'lol999',
        parents: ['789beef']
      })
      .reply(201, {
        sha: 'finalsha123'
      })
      .post('/repos/owner/repo/git/refs', {
        ref: 'refs/heads/testBranch',
        sha: 'finalsha123'
      })
      .reply(201)

    nock('http://localhost:1234')
      .post('/', (body) => {
        expect(body.packageJson).toEqual('{"devDependencies":{"jest":"1.2.0"}}')
        expect(typeof body.type).toBe('string')
        expect(typeof body.packageJson).toBe('string')
        expect(typeof body.lock).toBe('string')
        expect(body).toMatchSnapshot()
        return true
      })
      .reply(200, () => {
        return {
          ok: true,
          contents: '{"devDependencies":{"jest": {"version": "1.2.0"}}}'
        }
      })

    const sha = await createBranch({
      installationId: 123,
      owner: 'owner',
      repoName: 'repo',
      branch: 'master',
      newBranch: 'testBranch',
      path: 'package.json',
      transform: oldPkg => JSON.stringify(updatedPackageFileContents),
      message: 'new commit',
      processLockfiles: true,
      commitMessageTemplates: { 'lockfileUpdate': 'Updated lockfile ${lockfilePath}, yay' }, // eslint-disable-line no-template-curly-in-string
      repoDoc: {
        _id: 'one-lockfile-old-syntax',
        accountId: '124',
        fullName: 'finnp/one-lockfile-old-syntax',
        private: false,
        files: {
          'package.json': ['package.json'],
          'package-lock.json': ['package-lock.json'],
          'npm-shrinkwrap.json': [],
          'yarn.lock': [],
          'pnpm-lock.yaml': []
        },
        packages: {
          'package.json': {
            devDependencies: {
              'jest': '1.0.0'
            }
          }
        }
      }
    })

    expect(sha).toEqual('finalsha123')
    expect(gitHubNock.isDone()).toBeTruthy()
  })

  test('change one file (package.json) and generate its lockfile (yarn)', async () => {
    const packageFileContents = { devDependencies: {
      'jest': '1.1.1'
    } }
    const updatedPackageFileContents = { devDependencies: {
      'jest': '1.2.0'
    } }
    const gitHubNock = nock('https://api.github.com')
      .post('/app/installations/123/access_tokens')
      .optionally()
      .reply(200, {
        token: 'secret'
      })
      .get('/rate_limit')
      .optionally()
      .reply(200, {})
      .get('/repos/owner/yarn-repo/contents/package.json')
      .query({ ref: 'master' })
      .reply(200, {
        type: 'file',
        content: Buffer.from(JSON.stringify(packageFileContents)).toString('base64')
      })
      .get('/repos/owner/yarn-repo/contents/yarn.lock')
      .reply(200, {
        type: 'file',
        path: 'yarn.lock',
        name: 'yarn.lock',
        content: Buffer.from(JSON.stringify(packageFileContents)).toString('base64')
      })
      .get('/repos/owner/yarn-repo/git/refs/heads/master')
      .reply(200, {
        object: {
          sha: '123abc'
        }
      })
      // First tree and commit for package.json
      .post('/repos/owner/yarn-repo/git/trees', {
        tree: [
          {
            path: 'package.json',
            content: JSON.stringify(updatedPackageFileContents),
            mode: '100644',
            type: 'blob'
          }
        ],
        base_tree: '123abc'
      })
      .reply(201, {
        sha: 'def456'
      })
      .post('/repos/owner/yarn-repo/git/commits', {
        message: 'new commit',
        tree: 'def456',
        parents: ['123abc']
      })
      .reply(201, {
        sha: '789beef'
      })
      // Second tree and commit for yarn.lock
      .post('/repos/owner/yarn-repo/git/trees', {
        tree: [
          {
            path: 'yarn.lock',
            content: '{"devDependencies":{"jest": {"version": "1.2.0"}}}',
            mode: '100644',
            type: 'blob'
          }
        ],
        base_tree: '789beef'
      })
      .reply(201, {
        sha: 'lol999'
      })
      .post('/repos/owner/yarn-repo/git/commits', {
        message: 'Updated lockfile yarn.lock, yay',
        tree: 'lol999',
        parents: ['789beef']
      })
      .reply(201, {
        sha: 'finalsha123'
      })
      .post('/repos/owner/yarn-repo/git/refs', {
        ref: 'refs/heads/testBranch',
        sha: 'finalsha123'
      })
      .reply(201)

    nock('http://localhost:1234')
      .post('/', (body) => {
        expect(body.packageJson).toEqual('{"devDependencies":{"jest":"1.2.0"}}')
        expect(typeof body.type).toBe('string')
        expect(typeof body.packageJson).toBe('string')
        expect(typeof body.lock).toBe('string')
        expect(body).toMatchSnapshot()
        return true
      })
      .reply(200, () => {
        return {
          ok: true,
          contents: '{"devDependencies":{"jest": {"version": "1.2.0"}}}'
        }
      })

    const sha = await createBranch({
      installationId: 123,
      owner: 'owner',
      repoName: 'yarn-repo',
      branch: 'master',
      newBranch: 'testBranch',
      path: 'package.json',
      transform: oldPkg => JSON.stringify(updatedPackageFileContents),
      message: 'new commit',
      processLockfiles: true,
      commitMessageTemplates: { 'lockfileUpdate': 'Updated lockfile ${lockfilePath}, yay' }, // eslint-disable-line no-template-curly-in-string
      repoDoc: {
        _id: 'yarn-lockfile',
        accountId: '124',
        fullName: 'finnp/yarn-lockfile',
        private: false,
        files: {
          'package.json': ['package.json'],
          'package-lock.json': [],
          'npm-shrinkwrap.json': [],
          'yarn.lock': ['yarn.lock'],
          'pnpm-lock.yaml': []
        },
        packages: {
          'package.json': {
            devDependencies: {
              'jest': '1.0.0'
            }
          }
        }
      }
    })

    expect(sha).toEqual('finalsha123')
    expect(gitHubNock.isDone()).toBeTruthy()
  })

  test('change two files (package.json, frontend/package.json) and generate their lockfiles', async () => {
    const packageFileContents = { devDependencies: {
      'jest': '1.1.1'
    } }
    const updatedPackageFileContents = { devDependencies: {
      'jest': '1.2.0'
    } }
    const gitHubNock = nock('https://api.github.com')
      .post('/app/installations/123/access_tokens')
      .optionally()
      .reply(200, {
        token: 'secret'
      })
      .get('/rate_limit')
      .optionally()
      .reply(200, {})
      .get('/repos/owner/repo/contents/package.json')
      .query({ ref: 'master' })
      .reply(200, {
        type: 'file',
        content: Buffer.from(JSON.stringify(packageFileContents)).toString('base64')
      })
      .get('/repos/owner/repo/contents/frontend/package.json')
      .query({ ref: 'master' })
      .reply(200, {
        type: 'file',
        content: Buffer.from(JSON.stringify(packageFileContents)).toString('base64')
      })
      .get('/repos/owner/repo/contents/package-lock.json')
      .reply(200, {
        type: 'file',
        path: 'package-lock.json',
        name: 'package-lock.json',
        content: Buffer.from(JSON.stringify(packageFileContents)).toString('base64')
      })
      .get('/repos/owner/repo/contents/frontend/package-lock.json')
      .reply(200, {
        type: 'file',
        path: 'frontend/package-lock.json',
        name: 'frontend/package-lock.json',
        content: Buffer.from(JSON.stringify(packageFileContents)).toString('base64')
      })
      .get('/repos/owner/repo/git/refs/heads/master')
      .reply(200, {
        object: {
          sha: 'root-sha'
        }
      })
      // First tree and commit for package.json
      .post('/repos/owner/repo/git/trees', {
        tree: [
          {
            path: 'package.json',
            content: JSON.stringify(updatedPackageFileContents),
            mode: '100644',
            type: 'blob'
          }
        ],
        base_tree: 'root-sha'
      })
      .reply(201, {
        sha: '1-tree'
      })
      .post('/repos/owner/repo/git/commits', {
        message: 'new commit',
        tree: '1-tree',
        parents: ['root-sha']
      })
      .reply(201, {
        sha: '1-commit'
      })
      // Second tree and commit for frontend/package.json
      .post('/repos/owner/repo/git/trees', {
        tree: [
          {
            path: 'frontend/package.json',
            content: JSON.stringify(updatedPackageFileContents),
            mode: '100644',
            type: 'blob'
          }
        ],
        base_tree: '1-commit'
      })
      .reply(201, {
        sha: '2-tree'
      })
      .post('/repos/owner/repo/git/commits', {
        message: 'new commit',
        tree: '2-tree',
        parents: ['1-commit']
      })
      .reply(201, {
        sha: '2-commit'
      })
      // Third tree and commit for frontend/package-lock.json
      .post('/repos/owner/repo/git/trees', {
        tree: [
          {
            path: 'frontend/package-lock.json',
            content: '{"devDependencies":{"jest": {"version": "1.2.0"}}}',
            mode: '100644',
            type: 'blob'
          }
        ],
        base_tree: '2-commit'
      })
      .reply(201, {
        sha: '3-tree'
      })
      .post('/repos/owner/repo/git/commits', {
        message: 'Updated lockfile frontend/package-lock.json, yay',
        tree: '3-tree',
        parents: ['2-commit']
      })
      .reply(201, {
        sha: '3-commit'
      })
      // Fourth tree and commit for package-lock.json
      .post('/repos/owner/repo/git/trees', {
        tree: [
          {
            path: 'package-lock.json',
            content: '{"devDependencies":{"jest": {"version": "1.2.0"}}}',
            mode: '100644',
            type: 'blob'
          }
        ],
        base_tree: '3-commit'
      })
      .reply(201, {
        sha: '4-tree'
      })
      .post('/repos/owner/repo/git/commits', {
        message: 'Updated lockfile package-lock.json, yay',
        tree: '4-tree',
        parents: ['3-commit']
      })
      .reply(201, {
        sha: 'finalsha123'
      })
      .post('/repos/owner/repo/git/refs', {
        ref: 'refs/heads/testBranch',
        sha: 'finalsha123'
      })
      .reply(201)

    nock('http://localhost:1234')
      .post('/', (body) => {
        expect(body.packageJson).toEqual(JSON.stringify(updatedPackageFileContents))
        expect(typeof body.type).toBe('string')
        expect(typeof body.packageJson).toBe('string')
        expect(typeof body.lock).toBe('string')
        expect(body).toMatchSnapshot()
        return true
      })
      .reply(200, () => {
        return {
          ok: true,
          contents: '{"devDependencies":{"jest": {"version": "1.2.0"}}}'
        }
      })
      .post('/', (body) => {
        expect(body.packageJson).toEqual(JSON.stringify(updatedPackageFileContents))
        expect(typeof body.type).toBe('string')
        expect(typeof body.packageJson).toBe('string')
        expect(typeof body.lock).toBe('string')
        expect(body).toMatchSnapshot()
        return true
      })
      .reply(200, () => {
        return {
          ok: true,
          contents: '{"devDependencies":{"jest": {"version": "1.2.0"}}}'
        }
      })

    const sha = await createBranch({
      installationId: 123,
      owner: 'owner',
      repoName: 'repo',
      branch: 'master',
      newBranch: 'testBranch',
      transforms: [
        {
          path: 'package.json',
          transform: oldPkg => JSON.stringify(updatedPackageFileContents),
          message: 'new commit'
        }, {
          path: 'frontend/package.json',
          transform: oldPkg => JSON.stringify(updatedPackageFileContents),
          message: 'new commit'
        }
      ],
      processLockfiles: true,
      commitMessageTemplates: { 'lockfileUpdate': 'Updated lockfile ${lockfilePath}, yay' }, // eslint-disable-line no-template-curly-in-string
      repoDoc: {
        _id: 'one-lockfile-old-syntax',
        accountId: '124',
        fullName: 'finnp/one-lockfile-old-syntax',
        private: false,
        files: {
          'package.json': ['package.json', 'frontend/package.json'],
          'package-lock.json': ['package-lock.json', 'frontend/package-lock.json'],
          'npm-shrinkwrap.json': [],
          'yarn.lock': [],
          'pnpm-lock.yaml': []
        },
        packages: {
          'package.json': {
            devDependencies: {
              'jest': '1.0.0'
            }
          },
          'frontend/package.json': {
            devDependencies: {
              'jest': '1.0.0'
            }
          }
        }
      }
    })

    expect(sha).toEqual('finalsha123')
    expect(gitHubNock.isDone()).toBeTruthy()
  })

  test('change a package.json and generate its lockfile for pnpm', async () => {
    const packageFileContents = { devDependencies: {
      'jest': '1.1.1'
    } }
    const updatedPackageFileContents = { devDependencies: {
      'jest': '1.2.0'
    } }
    const gitHubNock = nock('https://api.github.com')
      .post('/app/installations/123/access_tokens')
      .optionally()
      .reply(200, {
        token: 'secret'
      })
      .get('/rate_limit')
      .optionally()
      .reply(200)
      .get('/repos/owner/repo/contents/package.json')
      .query({ ref: 'master' })
      .reply(200, {
        type: 'file',
        content: Buffer.from(JSON.stringify(packageFileContents)).toString('base64')
      })
      .get('/repos/owner/repo/contents/pnpm-lock.yaml')
      .reply(200, {
        type: 'file',
        path: 'pnpm-lock.yaml',
        name: 'pnpm-lock.yaml',
        content: Buffer.from(JSON.stringify(packageFileContents)).toString('base64')
      })
      .get('/repos/owner/repo/git/refs/heads/master')
      .reply(200, {
        object: {
          sha: '123abc'
        }
      })
      // First tree and commit for package.json
      .post('/repos/owner/repo/git/trees', {
        tree: [
          {
            path: 'package.json',
            content: JSON.stringify(updatedPackageFileContents),
            mode: '100644',
            type: 'blob'
          }
        ],
        base_tree: '123abc'
      })
      .reply(201, {
        sha: 'def456'
      })
      .post('/repos/owner/repo/git/commits', {
        message: 'new commit',
        tree: 'def456',
        parents: ['123abc']
      })
      .reply(201, {
        sha: '789beef'
      })
      // Second tree and commit for pnpm-lock.yaml
      .post('/repos/owner/repo/git/trees', {
        tree: [
          {
            path: 'pnpm-lock.yaml',
            content: '{"devDependencies":{"jest": {"version": "1.2.0"}}}',
            mode: '100644',
            type: 'blob'
          }
        ],
        base_tree: '789beef'
      })
      .reply(201, {
        sha: 'lol999'
      })
      .post('/repos/owner/repo/git/commits', {
        message: 'Updated lockfile pnpm-lock.yaml, yay',
        tree: 'lol999',
        parents: ['789beef']
      })
      .reply(201, {
        sha: 'finalsha123'
      })
      .post('/repos/owner/repo/git/refs', {
        ref: 'refs/heads/testBranch',
        sha: 'finalsha123'
      })
      .reply(201)

    nock('http://localhost:1234')
      .post('/', (body) => {
        expect(body.packageJson).toEqual(JSON.stringify(updatedPackageFileContents))
        expect(body.type).toEqual('pnpm')
        expect(typeof body.packageJson).toBe('string')
        expect(typeof body.lock).toBe('string')
        expect(body).toMatchSnapshot()
        return true
      })
      .reply(200, () => {
        return {
          ok: true,
          contents: '{"devDependencies":{"jest": {"version": "1.2.0"}}}'
        }
      })

    const sha = await createBranch({
      installationId: 123,
      owner: 'owner',
      repoName: 'repo',
      branch: 'master',
      newBranch: 'testBranch',
      transforms: [
        {
          path: 'package.json',
          transform: oldPkg => JSON.stringify(updatedPackageFileContents),
          message: 'new commit'
        }
      ],
      processLockfiles: true,
      commitMessageTemplates: { 'lockfileUpdate': 'Updated lockfile ${lockfilePath}, yay' }, // eslint-disable-line no-template-curly-in-string
      repoDoc: {
        _id: 'one-lockfile-pnpm',
        accountId: '124',
        fullName: 'finnp/one-lockfile-pnpm',
        private: false,
        files: {
          'package.json': ['package.json'],
          'package-lock.json': [],
          'npm-shrinkwrap.json': [],
          'yarn.lock': [],
          'pnpm-lock.yaml': ['pnpm-lock.yaml']
        },
        packages: {
          'package.json': {
            devDependencies: {
              'jest': '1.0.0'
            }
          }
        }
      }
    })

    expect(sha).toEqual('finalsha123')
    expect(gitHubNock.isDone()).toBeTruthy()
  })

  test('don’t generate the same lockfile multiple times', async () => {
    // multiple commits to the same package file should only result in a single lockfile update,
    // meaning a single exec server request and a single github tree update plus commit
    expect.assertions(8)
    const packageFileContents = { devDependencies: {
      'jest': '1.1.1',
      'west': '1.1.1'
    } }
    const updatedPackageFileContents1 = { devDependencies: {
      'jest': '1.2.0',
      'west': '1.1.1'
    } }
    const updatedPackageFileContents2 = { devDependencies: {
      'jest': '1.2.0',
      'west': '1.5.0'
    } }
    const gitHubNock = nock('https://api.github.com')
      .post('/app/installations/123/access_tokens')
      .optionally()
      .reply(200, {
        token: 'secret'
      })
      .get('/rate_limit')
      .optionally()
      .reply(200, {})
      .get('/repos/owner/repo/contents/package.json')
      .query({ ref: 'master' })
      .reply(200, {
        type: 'file',
        content: Buffer.from(JSON.stringify(packageFileContents)).toString('base64')
      })
      .get('/repos/owner/repo/contents/package-lock.json')
      .reply(200, {
        type: 'file',
        path: 'package-lock.json',
        name: 'package-lock.json',
        content: Buffer.from(JSON.stringify(packageFileContents)).toString('base64')
      })
      .get('/repos/owner/repo/git/refs/heads/master')
      .reply(200, {
        object: {
          sha: 'root-sha'
        }
      })
      // First tree and commit for package.json
      .post('/repos/owner/repo/git/trees', {
        tree: [
          {
            path: 'package.json',
            content: JSON.stringify(updatedPackageFileContents1),
            mode: '100644',
            type: 'blob'
          }
        ],
        base_tree: 'root-sha'
      })
      .reply(201, {
        sha: '1-tree'
      })
      .post('/repos/owner/repo/git/commits', {
        message: 'new commit',
        tree: '1-tree',
        parents: ['root-sha']
      })
      .reply(201, {
        sha: '1-commit'
      })
      // Second tree and commit for package.json
      .post('/repos/owner/repo/git/trees', {
        tree: [
          {
            path: 'package.json',
            content: JSON.stringify(updatedPackageFileContents2),
            mode: '100644',
            type: 'blob'
          }
        ],
        base_tree: '1-commit'
      })
      .reply(201, {
        sha: '2-tree'
      })
      .post('/repos/owner/repo/git/commits', {
        message: 'new commit',
        tree: '2-tree',
        parents: ['1-commit']
      })
      .reply(201, {
        sha: '2-commit'
      })
      // Third tree and commit for package-lock.json
      .post('/repos/owner/repo/git/trees', {
        tree: [
          {
            path: 'package-lock.json',
            content: '{"devDependencies":{"jest": {"version": "1.2.0"}, "west": {"version": "1.5.0"}}}',
            mode: '100644',
            type: 'blob'
          }
        ],
        base_tree: '2-commit'
      })
      .reply(201, {
        sha: '3-tree'
      })
      .post('/repos/owner/repo/git/commits', {
        message: 'Updated lockfile package-lock.json, yay',
        tree: '3-tree',
        parents: ['2-commit']
      })
      .reply(201, {
        sha: 'finalsha123'
      })
      .post('/repos/owner/repo/git/refs', {
        ref: 'refs/heads/testBranch',
        sha: 'finalsha123'
      })
      .reply(201)

    const execNock = nock('http://localhost:1234')
      .post('/', (body) => {
        expect(body.packageJson).toEqual(JSON.stringify(updatedPackageFileContents2))
        expect(typeof body.type).toBe('string')
        expect(typeof body.packageJson).toBe('string')
        expect(typeof body.lock).toBe('string')
        expect(body).toMatchSnapshot()
        return true
      })
      .reply(200, () => {
        return {
          ok: true,
          contents: '{"devDependencies":{"jest": {"version": "1.2.0"}, "west": {"version": "1.5.0"}}}'
        }
      })

    const sha = await createBranch({
      installationId: 123,
      owner: 'owner',
      repoName: 'repo',
      branch: 'master',
      newBranch: 'testBranch',
      transforms: [
        {
          path: 'package.json',
          transform: oldPkg => JSON.stringify(updatedPackageFileContents1),
          message: 'new commit'
        }, {
          path: 'package.json',
          transform: oldPkg => JSON.stringify(updatedPackageFileContents2),
          message: 'new commit'
        }
      ],
      processLockfiles: true,
      commitMessageTemplates: { 'lockfileUpdate': 'Updated lockfile ${lockfilePath}, yay' }, // eslint-disable-line no-template-curly-in-string
      repoDoc: {
        _id: 'one-lockfile-old-syntax',
        accountId: '124',
        fullName: 'finnp/one-lockfile-old-syntax',
        private: false,
        files: {
          'package.json': ['package.json'],
          'package-lock.json': ['package-lock.json'],
          'npm-shrinkwrap.json': [],
          'yarn.lock': [],
          'pnpm-lock.yaml': []
        },
        packages: {
          'package.json': {
            devDependencies: {
              'jest': '1.0.0',
              'west': '1.0.0'
            }
          }
        }
      }
    })

    expect(sha).toEqual('finalsha123')
    expect(gitHubNock.isDone()).toBeTruthy()
    expect(execNock.isDone()).toBeTruthy()
  })

  test('handle exec server 500 gracefully', async () => {
    const packageFileContents = { devDependencies: {
      'jest': '1.1.1'
    } }
    const updatedPackageFileContents = { devDependencies: {
      'jest': '1.2.0'
    } }
    const gitHubNock = nock('https://api.github.com')
      .post('/app/installations/123/access_tokens')
      .optionally()
      .reply(200, {
        token: 'secret'
      })
      .get('/rate_limit')
      .optionally()
      .reply(200, {})
      .get('/repos/owner/repo/contents/package.json')
      .query({ ref: 'master' })
      .reply(200, {
        type: 'file',
        content: Buffer.from(JSON.stringify(packageFileContents)).toString('base64')
      })
      .get('/repos/owner/repo/contents/package-lock.json')
      .reply(200, {
        type: 'file',
        path: 'package-lock.json',
        name: 'package-lock.json',
        content: Buffer.from(JSON.stringify(packageFileContents)).toString('base64')
      })
      .get('/repos/owner/repo/git/refs/heads/master')
      .reply(200, {
        object: {
          sha: '123abc'
        }
      })
      // First and only tree and commit for package.json
      .post('/repos/owner/repo/git/trees', {
        tree: [
          {
            path: 'package.json',
            content: JSON.stringify(updatedPackageFileContents),
            mode: '100644',
            type: 'blob'
          }
        ],
        base_tree: '123abc'
      })
      .reply(201, {
        sha: 'def456'
      })
      .post('/repos/owner/repo/git/commits', {
        message: 'new commit',
        tree: 'def456',
        parents: ['123abc']
      })
      .reply(201, {
        sha: 'finalsha123'
      })
      // No tree and commit for lockfile, because lockfile server didn’t return a lockfile!
      .post('/repos/owner/repo/git/refs', {
        ref: 'refs/heads/testBranch',
        sha: 'finalsha123'
      })
      .reply(201)

    nock('http://localhost:1234')
      .post('/', (body) => {
        expect(body.packageJson).toEqual(JSON.stringify(updatedPackageFileContents))
        expect(typeof body.type).toBe('string')
        expect(typeof body.packageJson).toBe('string')
        expect(typeof body.lock).toBe('string')
        expect(body).toMatchSnapshot()
        return true
      })
      .reply(500)

    const sha = await createBranch({
      installationId: 123,
      owner: 'owner',
      repoName: 'repo',
      branch: 'master',
      newBranch: 'testBranch',
      path: 'package.json',
      transform: oldPkg => JSON.stringify(updatedPackageFileContents),
      message: 'new commit',
      processLockfiles: true,
      commitMessageTemplates: { 'lockfileUpdate': 'Updated lockfile ${lockfilePath}, yay' }, // eslint-disable-line no-template-curly-in-string
      repoDoc: {
        _id: 'one-lockfile-old-syntax',
        accountId: '124',
        fullName: 'finnp/one-lockfile-old-syntax',
        private: false,
        files: {
          'package.json': ['package.json'],
          'package-lock.json': ['package-lock.json'],
          'npm-shrinkwrap.json': [],
          'yarn.lock': [],
          'pnpm-lock.yaml': []
        },
        packages: {
          'package.json': {
            devDependencies: {
              'jest': '^1.0.0'
            }
          }
        }
      }
    })

    expect(sha).toEqual('finalsha123')
    expect(gitHubNock.isDone()).toBeTruthy()
  })

  test('change one file (package.json) and generate its lockfile with tokens', async () => {
    const { tokens, 'token-audits': tokenAudits } = await dbs() // eslint-disable-line
    await tokens.put({
      _id: '124',
      tokens: {
        'one-lockfile-with-token': {
          npm: '12345',
          github: '54321'
        }
      }
    })

    const packageFileContents = { devDependencies: {
      'jest': '1.1.1'
    } }
    const updatedPackageFileContents = { devDependencies: {
      'jest': '1.2.0'
    } }
    const gitHubNock = nock('https://api.github.com')
      .post('/app/installations/123/access_tokens')
      .optionally()
      .reply(200, {
        token: 'secret'
      })
      .get('/rate_limit')
      .optionally()
      .reply(200, {})
      .get('/repos/owner/repo/contents/package.json')
      .query({ ref: 'master' })
      .reply(200, {
        type: 'file',
        content: Buffer.from(JSON.stringify(packageFileContents)).toString('base64')
      })
      .get('/repos/owner/repo/contents/package-lock.json')
      .reply(200, {
        type: 'file',
        path: 'package-lock.json',
        name: 'package-lock.json',
        content: Buffer.from(JSON.stringify(packageFileContents)).toString('base64')
      })
      .get('/repos/owner/repo/git/refs/heads/master')
      .reply(200, {
        object: {
          sha: '123abc'
        }
      })
      // First tree and commit for package.json
      .post('/repos/owner/repo/git/trees', {
        tree: [
          {
            path: 'package.json',
            content: JSON.stringify(updatedPackageFileContents),
            mode: '100644',
            type: 'blob'
          }
        ],
        base_tree: '123abc'
      })
      .reply(201, {
        sha: 'def456'
      })
      .post('/repos/owner/repo/git/commits', {
        message: 'new commit',
        tree: 'def456',
        parents: ['123abc']
      })
      .reply(201, {
        sha: '789beef'
      })
      // Second tree and commit for package-lock.json
      .post('/repos/owner/repo/git/trees', {
        tree: [
          {
            path: 'package-lock.json',
            content: '{"devDependencies":{"jest": {"version": "1.2.0"}}}',
            mode: '100644',
            type: 'blob'
          }
        ],
        base_tree: '789beef'
      })
      .reply(201, {
        sha: 'lol999'
      })
      .post('/repos/owner/repo/git/commits', {
        message: 'Updated lockfile package-lock.json, yay',
        tree: 'lol999',
        parents: ['789beef']
      })
      .reply(201, {
        sha: 'finalsha123'
      })
      .post('/repos/owner/repo/git/refs', {
        ref: 'refs/heads/testBranch',
        sha: 'finalsha123'
      })
      .reply(201)

    nock('http://localhost:1234')
      .post('/', (body) => {
        expect(body.packageJson).toEqual('{"devDependencies":{"jest":"1.2.0"}}')
        expect(typeof body.type).toBe('string')
        expect(typeof body.packageJson).toBe('string')
        expect(typeof body.lock).toBe('string')
        expect(typeof body.repositoryTokens).toBe('string')

        expect(body).toMatchSnapshot()
        return true
      })
      .reply(200, () => {
        return {
          ok: true,
          contents: '{"devDependencies":{"jest": {"version": "1.2.0"}}}'
        }
      })

    const sha = await createBranch({
      installationId: 123,
      owner: 'owner',
      repoName: 'repo',
      branch: 'master',
      newBranch: 'testBranch',
      path: 'package.json',
      transform: oldPkg => JSON.stringify(updatedPackageFileContents),
      message: 'new commit',
      processLockfiles: true,
      commitMessageTemplates: { 'lockfileUpdate': 'Updated lockfile ${lockfilePath}, yay' }, // eslint-disable-line no-template-curly-in-string
      repoDoc: {
        _id: 'one-lockfile-with-token',
        accountId: '124',
        fullName: 'finnp/one-lockfile-with-token',
        private: false,
        files: {
          'package.json': ['package.json'],
          'package-lock.json': ['package-lock.json'],
          'npm-shrinkwrap.json': [],
          'yarn.lock': [],
          'pnpm-lock.yaml': []
        },
        packages: {
          'package.json': {
            devDependencies: {
              'jest': '1.0.0'
            }
          }
        }
      }
    })

    expect(sha).toEqual('finalsha123')
    expect(gitHubNock.isDone()).toBeTruthy()

    const audit = await tokenAudits.allDocs()
    expect(audit.rows).toHaveLength(1)
    expect(audit.rows[0].id).toMatch(/123:one-lockfile-with-token:/)
    expect(audit.rows[0].id).toMatch(/read/)

    tokenAudits.remove(audit.rows[0].id)
  })
})

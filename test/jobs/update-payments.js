const dbs = require('../../lib/dbs')
const removeIfExists = require('../helpers/remove-if-exists')

describe('update-payments', async () => {
  beforeAll(async() => {
    const { repositories, installations } = await dbs()

    await installations.put({
      _id: '111',
      installation: 11,
      plan: 'free'
    })

    await repositories.put({
      _id: '1_update-payments',
      accountId: '111',
      fullName: 'finnp/private1',
      enabled: true,
      private: true
    })
    await repositories.put({
      _id: '2_update-payments',
      accountId: '111',
      fullName: 'finnp/private2',
      enabled: true,
      private: true
    })
    await repositories.put({
      _id: '3_update-payments',
      accountId: '111',
      fullName: 'finnp/public',
      enabled: true,
      private: false
    })
    await repositories.put({
      _id: '4',
      accountId: '11',
      fullName: 'other/private',
      enabled: true,
      private: true
    })
  })

  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
  })

  afterAll(async () => {
    const { repositories, installations } = await dbs()
    await Promise.all([
      removeIfExists(repositories, '1_update-payments', '2_update-payments', '3_update-payments', '4'),
      removeIfExists(installations, '111')
    ])
  })

  test('update stripe', async () => {
    expect.assertions(3)

    // To mock only specific modules, use require.requireActual to restore the original modules,
    // then overwrite the one you want to mock
    jest.mock('../../lib/payments', () => {
      const payments = require.requireActual('../../lib/payments')
      payments.getActiveBilling = async() => {
        return {
          plan: 'personal',
          stripeSubscriptionId: 'stripe123',
          stripeItemId: 'si123'
        }
      }
      return payments
    })

    jest.mock('stripe', key => key => {
      return {
        subscriptionItems: {
          update: (stripeItemId, {quantity}) => {
            expect(quantity).toBe(2)
            expect(stripeItemId).toEqual('si123')
          }
        }
      }
    })
    const updatePayments = require('../../jobs/update-payments')

    const newJob = await updatePayments({ accountId: '111' })
    expect(newJob).toBeFalsy()
  })

  test('ignore if stripeSubscriptionId is missing', async () => {
    expect.assertions(1)

    jest.mock('../../lib/payments', () => {
      const payments = require.requireActual('../../lib/payments')
      payments.getActiveBilling = async() => {
        return {
          plan: 'org'
        }
      }
      return payments
    })

    jest.mock('stripe', key => key => {
      return {
        subscriptionItems: {
          update: (stripeItemId, {quantity}) => {
            console.log('fail: stripe was called')
            expect(false).toBeFalsy()
          }
        }
      }
    })
    const updatePayments = require('../../jobs/update-payments')

    const newJob = await updatePayments({ accountId: '111' })
    expect(newJob).toBeFalsy()
  })
})

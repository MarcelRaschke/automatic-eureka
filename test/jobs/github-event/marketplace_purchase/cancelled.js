const { test, tearDown } = require('tap')
const dbs = require('../../../../lib/dbs')
const worker = require('../../../../jobs/github-event/marketplace_purchase/cancelled')
const removeIfExists = require('../../../remove-if-exists.js')

test('marketplace canceled', async t => {
  t.test('change entry in payments database to `free`', async t => {
    const { payments } = await dbs()
    await payments.put({
      _id: '444',
      plan: 'team'
    })

    const newJobs = await worker({
      marketplace_purchase: {
        account: {
          type: 'Organization',
          id: 444,
          login: 'GitHub'
        },
        plan: {
          id: 9,
          name: 'Team',
          description: 'A really, super professional-grade CI solution',
          monthly_price_in_cents: 9999,
          yearly_price_in_cents: 11998,
          price_model: 'flat-rate',
          unit_name: null,
          bullets: [
            'This is the first bullet of the plan',
            'This is the second bullet of the plan'
          ]
        }
      }
    })

    t.notOk(newJobs, 'no new job scheduled')

    const payment = await payments.get('444')
    t.is(payment.plan, 'free', 'plan: free')
    t.end()
  })
})

tearDown(async () => {
  const { payments } = await dbs()
  await removeIfExists(payments, '444')
})

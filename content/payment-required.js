const md = require('./template')

module.exports = () =>
  md`🚨 You privatised your repo. 🚨

  Hello!
  You have set your repository to private. From now on Greenkeeper is no longer free. We have disabled your repo for now.
  Please enter your payment information at [account.greenkeeper.io](https://account.greenkeeper.io).
 For pricing information, please visit [https://greenkeeper.io/#pricing](https://greenkeeper.io/#pricing).
`

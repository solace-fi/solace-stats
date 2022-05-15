// bundles outputs of trackers and writes to more easily consumable forms

const { getProvider, s3GetObjectPromise, s3PutObjectPromise, snsPublishError, withBackoffRetries, formatTimestamp, fetchBlock } = require("./../utils/utils")
const ethers = require('ethers')
const BN = ethers.BigNumber
const formatUnits = ethers.utils.formatUnits

async function analytics_bundle(records) {
  var [uwp, markets, community, staking, xslocker, swc, positions, series] = records
  let res = {
    markets: markets,
    uwp: uwp,
    xslocker: xslocker,
    community: community,
    swc: swc,
    positions: positions,
    series: series
  }
  var r = JSON.stringify(res)
  await s3PutObjectPromise({ Bucket: 'stats-cache.solace.fi', Key: 'analytics-stats.json', Body: r, ContentType: "application/json" })
  return res
}
exports.analytics_bundle = analytics_bundle

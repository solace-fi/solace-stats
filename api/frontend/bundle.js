// bundles outputs of trackers and writes to more easily consumable forms

const { getProvider, s3GetObjectPromise, s3PutObjectPromise, snsPublishError, withBackoffRetries, formatTimestamp, fetchBlock } = require("./../utils/utils")
const ethers = require('ethers')
const BN = ethers.BigNumber
const formatUnits = ethers.utils.formatUnits

async function bundle(records) {
  var [uwp, markets, community, swcv1, swcv2, staking] = records
  var res = {}
  res.globalStakedSolace = staking.global.solaceStaked
  res.averageStakingAPR = staking.global.apr
  res.uwp = sumUWPs(uwp)
  res.coverLimit = sumCoverLimits(swcv1, swcv2)
  var r = JSON.stringify(res)
  await s3PutObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'public/frontend-stats.json', Body: r, ContentType: "application/json" })
  return res
}
exports.bundle = bundle

function sumUWPs(uwps) {
  var s = 0
  var uwp_ethereum = uwps['1'].trim().split('\n')
  var row = uwp_ethereum[uwp_ethereum.length-1].trim().split(',')
  s += (
    (row[3] - 0) + // dai
    (row[4] - 0) + // usdc
    (row[5] - 0) + // usdt
    (row[6] - 0) + // frax
    ((row[7] - 0 + (row[8] - 0)) * (row[13] - 0) + (row[10] - 0) * (row[16] - 0)) + // eth
    ((row[9] - 0) * (row[14] - 0)) + // wbtc
    ((row[11] - 0) * (row[17] - 0)) * 2 + // slp
    ((row[12] - 0) * (row[15] - 0)) // solace
  )

  var uwp_aurora = uwps['1313161554'].trim().split('\n')
  var row = uwp_aurora[uwp_aurora.length-1].trim().split(',')
  s += (
    (row[3] - 0) + // dai
    (row[4] - 0) + // usdc
    (row[5] - 0) + // usdt
    (row[6] - 0) + // frax
    ((row[7] - 0 + (row[8] - 0)) * (row[14] - 0)) + // eth
    ((row[9] - 0) * (row[15] - 0)) + // wbtc
    ((row[10] - 0) * (row[16] - 0)) + // wnear
    ((row[11] - 0) * (row[17] - 0)) + // aurora
    ((row[12] - 0) * (row[19] - 0)) * 2 + // tlp
    ((row[13] - 0) * (row[18] - 0)) // solace
  )

  var uwp_polygon = uwps['137'].trim().split('\n')
  var row = uwp_polygon[uwp_polygon.length-1].trim().split(',')
  s += (
    (row[3] - 0) + // dai
    (row[4] - 0) + // usdc
    (row[5] - 0) + // usdt
    (row[6] - 0) + // frax
    ((row[9] - 0) * (row[13] - 0)) + // eth
    ((row[10] - 0) * (row[14] - 0)) + // wbtc
    ((row[7] - 0 + (row[8] - 0)) * (row[15] - 0)) + // matic
    ((row[11] - 0) * (row[17] - 0)) * 2 + // guni
    ((row[12] - 0) * (row[16] - 0)) // solace
  )

  return s
}

function sumCoverLimits(swcv1, swcv2) {
  var s = BN.from(0)
  for(var swc of [swcv1, swcv2]) {
    var history = swc.history
    var latest = history[history.length-1]
    s = s.add(latest.coverLimit)
  }
  return parseFloat(formatUnits(s))
}

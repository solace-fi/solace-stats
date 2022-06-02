// bundles outputs of trackers and writes to more easily consumable forms

const { getProvider, s3GetObjectPromise, s3PutObjectPromise, snsPublishError, withBackoffRetries, formatTimestamp, fetchBlock } = require("./../utils/utils")
const ethers = require('ethers')
const BN = ethers.BigNumber
const formatUnits = ethers.utils.formatUnits

async function frontend_bundle(records) {
  var [uwp, markets, community, staking, xslocker, swc, positions, series] = records
  var {ethereum_v1, polygon_v2, fantom_v2} = swc
  var res = {}
  res.globalStakedSolace = staking.global.solaceStaked
  res.averageStakingAPR = staking.global.apr
  res.uwp = sumUWPs(uwp)
  var [coverLimit, activePolicies, totalPolicies] = aggregatePolicies(ethereum_v1, polygon_v2, fantom_v2)
  res.coverLimit = coverLimit
  res.activePolicies = activePolicies
  res.totalPolicies = totalPolicies
  var r = JSON.stringify(res)
  await s3PutObjectPromise({ Bucket: 'stats-cache.solace.fi', Key: 'frontend-stats.json', Body: r, ContentType: "application/json" })
  return res
}
exports.frontend_bundle = frontend_bundle

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

  var uwp_fantom = uwps['250'].trim().split('\n')
  var row = uwp_fantom[uwp_fantom.length-1].trim().split(',')
  s += (
    (row[3] - 0) + // dai
    (row[4] - 0) + // usdc
    (row[5] - 0) + // usdt
    (row[6] - 0) + // frax
    ((row[7] - 0) * (row[12] - 0)) + // weth
    ((row[8] - 0) * (row[13] - 0)) + // wbtc
    ((row[9] - 0 + (row[10] - 0)) * (row[14] - 0)) + // ftm
    ((row[11] - 0) * (row[15] - 0)) // solace
  )

  return s
}

function aggregatePolicies(ethereum_v1, polygon_v2, fantom_v2) {
  var cl = BN.from(0)
  var ap = 0
  var tp = 0
  for(var swc of [ethereum_v1, polygon_v2, fantom_v2]) {
    var history = swc.history
    var latest = history[history.length-1]
    cl = cl.add(latest.coverLimit)
    tp += swc.policies.length
    for(var policy of swc.policies) {
      if(BN.from(policy.coverLimit).gt("0")) ap++
    }
  }
  cl = parseFloat(formatUnits(cl))
  return [cl, ap, tp]
}

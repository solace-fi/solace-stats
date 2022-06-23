// tracks policies in all networks over time

const { getProvider, getMulticallProvider, s3GetObjectPromise, s3PutObjectPromise, snsPublishError, withBackoffRetries, formatTimestamp, fetchBlock } = require("./../utils/utils")

const { track_ethereum_v3 } = require("./ethereum_v3")
const { track_aurora_v3 } = require("./aurora_v3")
const { track_polygon_v3 } = require("./polygon_v3")
const { track_fantom_v3 } = require("./fantom_v3")

async function track_policies() {
  return new Promise(async (resolve) => {
    console.log('start tracking all policies')
    let [ethereum_v3, aurora_v3, polygon_v3, fantom_v3] = await Promise.all([
      track_ethereum_v3(),
      track_aurora_v3(),
      track_polygon_v3(),
      track_fantom_v3(),
    ])
    console.log('done tracking all policies')
    let res = {ethereum_v3, aurora_v3, polygon_v3, fantom_v3}
    resolve(res)
  })
}
exports.track_policies = track_policies

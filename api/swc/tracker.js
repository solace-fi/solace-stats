// tracks policies in all networks over time

const { getProvider, getMulticallProvider, s3GetObjectPromise, s3PutObjectPromise, snsPublishError, withBackoffRetries, formatTimestamp, fetchBlock } = require("./../utils/utils")

const { track_ethereum_v1 } = require("./ethereum_v1")
const { track_polygon_v2 } = require("./polygon_v2")
const { track_fantom_v2 } = require("./fantom_v2")

async function track_policies() {
  return new Promise(async (resolve) => {
    console.log('start tracking all policies')
    let [ethereum_v1, polygon_v2, fantom_v2] = await Promise.all([
      track_ethereum_v1(),
      track_polygon_v2(),
      track_fantom_v2(),
    ])
    console.log('done tracking all policies')
    let res = {ethereum_v1, polygon_v2, fantom_v2}
    resolve(res)
  })
}
exports.track_policies = track_policies

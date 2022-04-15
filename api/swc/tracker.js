// tracks policies in all networks over time

const { getProvider, getMulticallProvider, s3GetObjectPromise, s3PutObjectPromise, snsPublishError, withBackoffRetries, formatTimestamp, fetchBlock } = require("./../utils/utils")

const { track_swcv1 } = require("./swcv1")
const { track_swcv2 } = require("./swcv2")

async function track_policies() {
  return new Promise(async (resolve) => {
    console.log('start tracking all policies')
    let [swcv1, swcv2] = await Promise.all([
      track_swcv1(),
      track_swcv2()
    ])
    console.log('done tracking all policies')
    let res = {swcv1, swcv2}
    resolve(res)
  })
}
exports.track_policies = track_policies

// tracks uwp in all networks over time

const { getProvider, s3GetObjectPromise, s3PutObjectPromise, snsPublishError, withBackoffRetries, formatTimestamp, fetchBlock } = require("./../utils/utils")

const { track_uwp_mainnet } = require("./mainnet")
const { track_uwp_aurora } = require("./aurora")
const { track_uwp_polygon } = require("./polygon")

async function track_uwp() {
  return new Promise(async (resolve) => {
    console.log('start tracking all uwp')
    let [uwp_mainnet, uwp_aurora, uwp_polygon] = await Promise.all([
      track_uwp_mainnet(),
      track_uwp_aurora(),
      track_uwp_polygon(),
    ])
    let res = JSON.stringify({
      "1":uwp_mainnet,
      "1313161554":uwp_aurora,
      "137":uwp_polygon
    })
    await Promise.all([
      s3PutObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'output/uwp/all.json', Body: res, ContentType: "application/json" }),
      s3PutObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'public/uwp/all.json', Body: res, ContentType: "application/json" })
    ])
    console.log('done tracking all uwp')
    resolve(res)
  })
}
exports.track_uwp = track_uwp

// tracks uwp in all networks over time

const { getProvider, s3GetObjectPromise, s3PutObjectPromise, snsPublishError, withBackoffRetries, formatTimestamp, fetchBlock } = require("./../utils/utils")

const { track_uwp_ethereum } = require("./ethereum")
const { track_uwp_aurora } = require("./aurora")
const { track_uwp_polygon } = require("./polygon")
const { track_uwp_fantom } = require("./fantom")

async function track_uwp() {
  return new Promise(async (resolve) => {
    console.log('start tracking all uwp')
    let [uwp_ethereum, uwp_aurora, uwp_polygon, uwp_fantom] = await Promise.all([
      track_uwp_ethereum(),
      track_uwp_aurora(),
      track_uwp_polygon(),
      track_uwp_fantom(),
    ])
    let r = {
      "1":uwp_ethereum,
      "1313161554":uwp_aurora,
      "137":uwp_polygon,
      "250":uwp_fantom,
    }
    let res = JSON.stringify(r)
    await Promise.all([
      s3PutObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'output/uwp/all.json', Body: res, ContentType: "application/json" }),
      s3PutObjectPromise({ Bucket: 'stats-cache.solace.fi', Key: 'uwp/all.json', Body: res, ContentType: "application/json" })
    ])
    console.log('done tracking all uwp')
    resolve(r)
  })
}
exports.track_uwp = track_uwp

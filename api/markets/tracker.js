// tracks markets in all networks over time

const { getProvider, s3GetObjectPromise, s3PutObjectPromise, snsPublishError, withBackoffRetries, formatTimestamp, fetchBlock } = require("./../utils/utils")

const { track_markets_mainnet } = require("./mainnet")
const { track_markets_aurora } = require("./aurora")
const { track_markets_polygon } = require("./polygon")

async function track_markets() {
  return new Promise(async (resolve) => {
    console.log('start tracking all markets')
    let [markets_mainnet, markets_aurora, markets_polygon] = await Promise.all([
      track_markets_mainnet(),
      track_markets_aurora(),
      track_markets_polygon(),
    ])
    let res = JSON.stringify({
      "1":markets_mainnet,
      "1313161554":markets_aurora,
      "137":markets_polygon
    })
    await Promise.all([
      s3PutObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'output/markets/all.json', Body: res, ContentType: "application/json" }),
      s3PutObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'public/markets/all.json', Body: res, ContentType: "application/json" })
    ])
    console.log('done tracking all markets')
    resolve(res)
  })
}
exports.track_markets = track_markets

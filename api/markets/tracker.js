// tracks markets in all networks over time

const { getProvider, s3GetObjectPromise, s3PutObjectPromise, snsPublishError, withBackoffRetries, formatTimestamp, fetchBlock } = require("./../utils/utils")

const { track_markets_ethereum } = require("./ethereum")
const { track_markets_aurora } = require("./aurora")
const { track_markets_polygon } = require("./polygon")
const { track_markets_fantom } = require("./fantom")

async function track_markets() {
  return new Promise(async (resolve) => {
    console.log('start tracking all markets')
    let [markets_ethereum, markets_aurora, markets_polygon, markets_fantom] = await Promise.all([
      track_markets_ethereum(),
      track_markets_aurora(),
      track_markets_polygon(),
      track_markets_fantom(),
    ])
    let res = {
      "1":markets_ethereum,
      "1313161554":markets_aurora,
      "137":markets_polygon,
      "250":markets_fantom,
    }
    let r = JSON.stringify(res)
    await Promise.all([
      s3PutObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'output/markets/all.json', Body: r, ContentType: "application/json" }),
      s3PutObjectPromise({ Bucket: 'stats-cache.solace.fi', Key: 'markets/all.json', Body: r, ContentType: "application/json" })
    ])
    console.log('done tracking all markets')
    resolve(res)
  })
}
exports.track_markets = track_markets

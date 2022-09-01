// tracks stats over time

const { snsPublishError, s3GetObjectPromise } = require("./utils/utils")
const { track_uwp } = require("./uwp/tracker")
const { track_markets } = require("./markets/tracker")
const { track_community } = require("./community/tracker")
const { trackStaking } = require("./staking/tracker")
const { getXsLocks } = require("./xsLocker/get")
const { track_policies } = require("./spi/tracker")
const { track_native_uwp } = require("./native_uwp/tracker")
const { track_volatility } = require("./volatility/tracker")
const { frontend_bundle } = require("./frontend/bundle")
const { analytics_bundle } = require("./analytics/bundle")

// Define headers
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PUT,DELETE"
}

async function track() {
  var res = await Promise.all([
    track_uwp(),
    track_markets(),
    track_community(),
    trackStaking(),
    getXsLocks(),
    track_policies(),
    s3GetObjectPromise({Bucket:'risk-data.solace.fi.data', Key:'positions-cache.json'}).then(JSON.parse),
    s3GetObjectPromise({Bucket:'risk-data.solace.fi.data', Key:'current-rate-data/series.json'}).then(JSON.parse),
    track_native_uwp(),
    track_volatility(),
  ])
  await Promise.all([
    frontend_bundle(res),
    analytics_bundle(res),
  ])
  return res
}

// Lambda handler
exports.handler = async function(event) {
  try {
    await track()
    return {
      statusCode: 200,
      headers: headers
    }
  } catch (e) {
    await snsPublishError(event, e)
    return {
      statusCode: 500,
      headers: headers
    }
  }
}

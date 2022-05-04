// tracks stats over time

const { snsPublishError } = require("./utils/utils")
const { track_uwp } = require("./uwp/tracker")
const { track_markets } = require("./markets/tracker")
const { track_community } = require("./community/tracker")
const { track_swcv1 } = require("./swc/swcv1")
const { track_swcv2 } = require("./swc/swcv2")
const { trackStaking } = require("./staking/tracker")
const { bundle } = require("./frontend/bundle")

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
    track_swcv1(),
    track_swcv2(),
    trackStaking()
  ])
  await bundle(res)
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

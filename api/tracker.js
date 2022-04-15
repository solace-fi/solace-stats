// tracks stats over time

const { snsPublishError } = require("./utils/utils")
const { track_uwp } = require("./uwp/tracker")
const { track_markets } = require("./markets/tracker")
const { track_community } = require("./community/tracker")
const { track_swcv1 } = require("./swc/swcv1")
const { track_swcv2 } = require("./swc/swcv2")

// Define headers
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PUT,DELETE"
}

async function track() {
  return await Promise.all([
    track_uwp(),
    track_markets(),
    track_community(),
    track_swcv1(),
    track_swcv2()
  ])
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

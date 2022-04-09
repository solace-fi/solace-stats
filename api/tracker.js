// tracks stats over time

const { snsPublishError } = require("./utils/utils")
const { track_uwp_mainnet } = require("./uwp/mainnet")
const { track_uwp_aurora } = require("./uwp/aurora")
const { track_uwp_polygon } = require("./uwp/polygon")
const { track_markets_mainnet } = require("./markets/mainnet")
const { track_markets_aurora } = require("./markets/aurora")
const { track_markets_polygon } = require("./markets/polygon")

// Define headers
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PUT,DELETE"
}

async function track() {
  return await Promise.all([
    track_uwp_mainnet(),
    track_uwp_aurora(),
    track_uwp_polygon(),
    track_markets_mainnet(),
    track_markets_aurora(),
    track_markets_polygon(),
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

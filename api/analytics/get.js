// an all in one endpoint for all information for the analytics dashboard

const { s3GetObjectPromise, snsPublishError } = require("./../utils/utils")
const { getXsLocks } = require("./../xsLocker/get")

// Define headers
const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PUT,DELETE"
}

async function handle() {
  let [xslocker, markets, uwp, community] = await Promise.all([
    getXsLocks(),
    s3GetObjectPromise({Bucket:'stats.solace.fi.data', Key:'public/markets/all.json'}).then(JSON.parse),
    s3GetObjectPromise({Bucket:'stats.solace.fi.data', Key:'public/uwp/all.json'}).then(JSON.parse),
    s3GetObjectPromise({Bucket:'stats.solace.fi.data', Key:'public/community/followers.csv'})
  ])
  let res = {
    markets: markets,
    uwp: uwp,
    xslocker: xslocker,
    community: community
  }
  return JSON.stringify(res)
}

// Lambda handler
exports.handler = async function(event) {
  try {
    let res = await handle()
    return {
      statusCode: 200,
      headers: headers,
      body: res
    }
  } catch (e) {
    switch(e.name) {
      case "InputError":
        return {
          statusCode: 400,
          headers: headers,
          body: e.stack
        }
        break
      default:
        await snsPublishError(event, e)
        return {
          statusCode: 500,
          headers: headers,
          body: "internal server error"
        }
    }
  }
}

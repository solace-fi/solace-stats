const { s3GetObjectPromise, snsPublishError } = require("./utils/utils")

// Define headers
const headers = {
  "Content-Type": "text/html",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PUT,DELETE"
}

// Lambda handler
exports.handler = async function(event) {
  try {
    var res = await s3GetObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'index.html' })
    return {
      statusCode: 200,
      headers: headers,
      body: res
    }
  } catch (e) {
    await snsPublishError(event, e)
    return {
      statusCode: 500,
      headers: headers,
      body: "internal server error"
    }
  }
}

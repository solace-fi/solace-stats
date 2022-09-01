// Define headers
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PUT,DELETE"
}

// Lambda handler
exports.handler = async function(event) {
  return {
    statusCode: 200,
    headers: headers
  }
}

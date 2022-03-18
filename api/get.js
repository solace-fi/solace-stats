const fs = require('fs')

// Define headers
const headers = {
  "Content-Type": "text/html",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PUT,DELETE"
}

// Lambda handler
exports.handler = async function(event) {
  return {
    statusCode: 200,
    headers: headers,
    body: fs.readFileSync('api/index.html').toString()
  }
}

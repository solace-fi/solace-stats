const body = `<ul>
<li><a href="/SOLACE/totalSupply/">SOLACE total supply</a></li>
<li><a href="/SOLACE/circulatingSupply/">SOLACE circulating supply</a></li>
<li><a href="/xSOLACE/totalSupply/">xSOLACE total supply</a></li>
<li><a href="/xSOLACE/circulatingSupply/">xSOLACE circulating supply</a></li>
</ul>`

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
    body: body
  }
}

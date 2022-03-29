const { S3, snsPublishError } = require("./../utils")

// Lambda handler
exports.handler = async function(event) {
  return new Promise(async (resolve,reject) => {
    // Define headers
    var headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PUT,DELETE"
    }

    try {
      if(!event || !event["queryStringParameters"] || !event["queryStringParameters"]["f"]) {
        resolve({
          statusCode: 404,
          headers: headers,
          body: "not found"
        })
        return
      }
      var params = { Bucket: 'stats.solace.fi.data', Key: `public/${event["queryStringParameters"]["f"]}` }
      S3.getObject(params, async (err,data) => {
        if(err) {
          err.stack = `FS Could not S3 get ${JSON.stringify(params)}\n${err.stack}`
          console.error(err)
          e = err
          await snsPublishError(event, err)
          if(err.statusCode == 404) {
            resolve({
              statusCode: 404,
              headers: headers,
              body: "not found"
            })
          } else { throw err }
        } else {
          res = data['Body'].toString()
          if(!!data.ContentType) headers["Content-Type"] = data.ContentType
          resolve({
            statusCode: 200,
            headers: headers,
            body: res
          })
        }
      })
    } catch (e) {
      await snsPublishError(event, e)
      resolve({
        statusCode: 500,
        headers: headers,
        body: "internal server error"
      })
    }
  })
}

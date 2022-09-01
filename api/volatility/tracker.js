// tracks uwp of native in all networks over time

const axios = require('axios')
const { s3GetObjectPromise, s3PutObjectPromise } = require("./../utils/utils")

async function track_volatility() {
  return new Promise(async (resolve) => {
    console.log('start tracking volatility')

    // fetch metadata
    var metadata = {
      url: "https://api.solace.fi/volatility/?tickers=SOLACE,AURORA,ETH,PLY,TRI,BSTN&window=365&terms=5",
      timestamp: 0,
    }
    try {
      metadata = await s3GetObjectPromise({ Bucket: "stats.solace.fi.data", Key: "volatility/metadata.json" }).then(JSON.parse)
    } catch(e) {}

    // cache or nah
    var cacheDelay = 1000*60*60*24 // only cache every 24 hours
    var now = new Date().valueOf()
    var elapsed = now - metadata.timestamp
    if(elapsed < cacheDelay) {
      resolve(null)
      return
    }

    // try get axios
    var res
    try {
      res = await axios.get(metadata.url)
      if(Object.keys(res.data.data).length == 0) throw "empty"
    } catch(e) {
      resolve(null)
      return
    }

    // write
    metadata.timestamp = now
    metadata = JSON.stringify(metadata)
    res = JSON.stringify(res.data)
    await Promise.all([
      s3PutObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'volatility/metadata.json', Body: metadata, ContentType: "application/json" }),
      s3PutObjectPromise({ Bucket: 'stats-cache.solace.fi', Key: 'volatility.json', Body: res, ContentType: "application/json" })
    ])

    console.log('done tracking volatility')
    resolve(null)
  })
}
exports.track_volatility = track_volatility

// tracks uwp of native in all networks over time

const { s3PutObjectPromise } = require("./../utils/utils")

const { track_native_uwp_goerli } = require("./goerli")

async function track_native_uwp() {
  return new Promise(async (resolve) => {
    console.log('start tracking all uwp')
    let [uwp_goerli] = await Promise.all([
      track_native_uwp_goerli(),
    ])
    let r = {
      "5":uwp_goerli,
    }
    let res = JSON.stringify(r)
    await Promise.all([
      s3PutObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'output/native_uwp/all.json', Body: res, ContentType: "application/json" }),
      s3PutObjectPromise({ Bucket: 'stats-cache.solace.fi', Key: 'native_uwp/all.json', Body: res, ContentType: "application/json" })
    ])
    console.log('done tracking all uwp')
    resolve(r)
  })
}
exports.track_native_uwp = track_native_uwp

// tracks premiums of native in all networks over time

const { s3PutObjectPromise } = require("./../utils/utils")

const { track_native_premiums_goerli } = require("./goerli")

async function track_native_premiums() {
  return new Promise(async (resolve) => {
    console.log('start tracking all native premiums')
    let [premiums_goerli] = await Promise.all([
      track_native_premiums_goerli(),
    ])
    let r = {
      "5":premiums_goerli,
    }
    let res = JSON.stringify(r)
    await Promise.all([
      s3PutObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'output/native_premiums/all.json', Body: res, ContentType: "application/json" }),
      s3PutObjectPromise({ Bucket: 'stats-cache.solace.fi', Key: 'native_premiums/all.json', Body: res, ContentType: "application/json" })
    ])
    console.log('done tracking all native premiums')
    resolve(r)
  })
}
exports.track_native_premiums = track_native_premiums

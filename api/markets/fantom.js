// tracks markets in fantom over time

const { getProvider, s3GetObjectPromise, s3PutObjectPromise, snsPublishError, withBackoffRetries, formatTimestamp, fetchBlock } = require("./../utils/utils")
const { fetchReservesOrZero, calculateUniswapV2PriceOrZero } = require("./../utils/priceUtils")
const ethers = require('ethers')
const BN = ethers.BigNumber
const formatUnits = ethers.utils.formatUnits

var initialized = false
var provider
var pools = {}

// creates a csv of pool stats over time
// reads and writes to s3 checkpoint to save time
async function createCSV() {
  // from scratch
  var csv = `block number,block timestamp,block timestring,price solace/usd,reserve solace, reserve usd\n`
  var startBlock = 39550000
  var endBlock = await provider.getBlockNumber()
  var blockStep = 10000
  // checkpoint
  await s3GetObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'output/markets/fantom.csv'}).then(res => {
    csv = res
    var rows = csv.split('\n')
    var lastBlock = rows[rows.length-2].split(',')[0]-0
    startBlock = lastBlock + blockStep
  }).catch(()=>{})
  console.log(`markets fantom: querying block range (${startBlock}, ${endBlock}, ${blockStep}) (${(endBlock-startBlock)/blockStep})`)
  // fetch info for a given block
  function createRowPromise(blockTag) {
    return new Promise(async (resolve,reject) => {
      var block = await fetchBlock(provider, blockTag)
      var suPrice = 0.0
      var sReserves = 0.0
      var uReserves = 0.0
      var row = `${blockTag},${block.timestamp},${formatTimestamp(block.timestamp)},${suPrice},${sReserves},${uReserves}\n`
      resolve(row)
    })
  }
  // loop across blocks
  var rows = []
  for(var bt = startBlock; bt < endBlock; bt += blockStep) {
    rows.push(await createRowPromise(bt))
  }
  rows.push(await createRowPromise(endBlock))
  csv = `${csv}${rows.join('')}`
  return csv
}

async function prefetch() {
  if(initialized) return

  [provider, uniV2PairAbi] = await Promise.all([
    getProvider(250),
    s3GetObjectPromise({Bucket: 'stats.solace.fi.data', Key: 'abi/other/UniswapV2Pair.json'}, cache=true),
  ])
  pools = {}
  initialized = true
}

async function track_markets_fantom() {
  return new Promise(async (resolve) => {
    console.log('start tracking markets fantom')
    await prefetch()
    var csv = await createCSV()
    await Promise.all([
      s3PutObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'output/markets/fantom.csv', Body: csv, ContentType: "text/csv" }),
      s3PutObjectPromise({ Bucket: 'stats-cache.solace.fi', Key: 'markets/fantom.csv', Body: csv, ContentType: "text/csv" })
    ])
    console.log('done tracking markets fantom')
    resolve(csv)
  })
}
exports.track_markets_fantom = track_markets_fantom

// tracks markets in aurora over time

const { getProvider, s3GetObjectPromise, s3PutObjectPromise, snsPublishError, withBackoffRetries, formatTimestamp, fetchBlock } = require("./../utils/utils")
const { fetchReservesOrZero, calculateUniswapV2PriceOrZero } = require("./../utils/priceUtils")
const ethers = require('ethers')
const BN = ethers.BigNumber
const formatUnits = ethers.utils.formatUnits

const CHAIN_ID_AURORA = 1313161554
var initialized = false
var provider
var pools = {}

// creates a csv of pool stats over time
// reads and writes to s3 checkpoint to save time
async function createCSV() {
  // from scratch
  var csv = `block number,block timestamp,block timestring,price solace/usd,reserve solace, reserve usd\n`
  var startBlock = 59035386
  var endBlock = await provider.getBlockNumber()
  var blockStep = 10000
  // checkpoint
  await s3GetObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'output/markets/aurora.csv'}).then(res => {
    csv = res
    var rows = csv.trim().split('\n')
    var lastBlock = rows[rows.length-1].split(',')[0]-0
    startBlock = lastBlock + blockStep
  }).catch(()=>{})
  console.log(`markets aurora: querying block range (${startBlock}, ${endBlock}, ${blockStep}) (${(endBlock-startBlock)/blockStep})`)
  // fetch info for a given block
  function createRowPromise(blockTag) {
    return new Promise(async (resolve,reject) => {
      console.log(`queued ${blockTag}`)
      var [block, snReserves, unReserves] = await Promise.all([
        fetchBlock(provider, blockTag),
        fetchReservesOrZero(pools["SOLACE-WNEAR"], blockTag),//.then(r=>snReserves=r)
        fetchReservesOrZero(pools["USDC-WNEAR"], blockTag)//.then(r=>unReserves=r)
      ])
      var snPrice = calculateUniswapV2PriceOrZero(snReserves._reserve0, snReserves._reserve1, false, 18, 24)
      var unPrice = calculateUniswapV2PriceOrZero(unReserves._reserve0, unReserves._reserve1, true, 6, 24)
      var suPrice = snPrice * unPrice
      var sReserves = formatUnits(snReserves._reserve0, 18)
      var uReserves = (formatUnits(snReserves._reserve1, 24) - 0) * unPrice
      var row = `${blockTag},${block.timestamp},${formatTimestamp(block.timestamp)},${suPrice},${sReserves},${uReserves}\n`
      console.log(`finished ${blockTag}\n${row}`)
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
    getProvider(CHAIN_ID_AURORA),
    s3GetObjectPromise({Bucket: 'stats.solace.fi.data', Key: 'abi/other/UniswapV2Pair.json'}, cache=true),
  ])
  pools = {
    "USDC-WNEAR": new ethers.Contract("0x20F8AeFB5697B77E0BB835A8518BE70775cdA1b0", uniV2PairAbi, provider), // trisolaris usdc-wnear
    "SOLACE-WNEAR": new ethers.Contract("0xdDAdf88b007B95fEb42DDbd110034C9a8e9746F2", uniV2PairAbi, provider), // trisolaris solace-wnear
  }
  initialized = true
}

async function track_markets_aurora() {
  return new Promise(async (resolve) => {
    console.log('start tracking markets aurora')
    await prefetch()
    var csv = await createCSV()
    await Promise.all([
      s3PutObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'output/markets/aurora.csv', Body: csv, ContentType: "text/csv" }),
      s3PutObjectPromise({ Bucket: 'stats-cache.solace.fi', Key: 'markets/aurora.csv', Body: csv, ContentType: "text/csv" })
    ])
    console.log('done tracking markets aurora')
    resolve(csv)
  })
}
exports.track_markets_aurora = track_markets_aurora

// tracks markets in mainnet over time

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
  var startBlock = 13706126
  var endBlock = await provider.getBlockNumber()
  var blockStep = 1000
  // checkpoint
  await s3GetObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'output/markets/mainnet.csv'}).then(res => {
    csv = res
    var rows = csv.split('\n')
    var lastBlock = rows[rows.length-2].split(',')[0]-0
    startBlock = lastBlock + blockStep
  }).catch(()=>{})
  console.log(`querying block range (${startBlock}, ${endBlock}, ${blockStep}) (${(endBlock-startBlock)/blockStep})`)
  // fetch info for a given block
  function createRowPromise(blockTag) {
    return new Promise(async (resolve,reject) => {
      console.log(`queued ${blockTag}`)
      var [block, reserves] = await Promise.all([
        fetchBlock(provider, blockTag),
        fetchReservesOrZero(pools["SOLACE-USDC"], blockTag)
      ])
      var price = calculateUniswapV2PriceOrZero(reserves._reserve0, reserves._reserve1, false, 18, 6)
      var row = `${blockTag},${block.timestamp},${formatTimestamp(block.timestamp)},${price},${formatUnits(reserves._reserve0,18)},${formatUnits(reserves._reserve1,6)}\n`
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
    getProvider(1),
    s3GetObjectPromise({Bucket: 'stats.solace.fi.data', Key: 'abi/other/UniswapV2Pair.json'}, cache=true),
  ])
  pools = {
    "SOLACE-USDC": new ethers.Contract("0x9C051F8A6648a51eF324D30C235da74D060153aC", uniV2PairAbi, provider), // sushi solace-usdc
  }
  initialized = true
}

async function track_markets_mainnet() {
  console.log('start tracking markets mainnet')
  await prefetch()
  var csv = await createCSV()
  await Promise.all([
    s3PutObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'output/markets/mainnet.csv', Body: csv, ContentType: "text/csv" }),
    s3PutObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'public/markets/mainnet.csv', Body: csv, ContentType: "text/csv" })
  ])
  console.log('done tracking markets mainnet')
}
exports.track_markets_mainnet = track_markets_mainnet

// tracks markets in polygon over time

const { getProvider, s3GetObjectPromise, s3PutObjectPromise, snsPublishError, withBackoffRetries, formatTimestamp, fetchBlock } = require("./../utils/utils")
const { fetchUniswapV3PriceOrZero, fetchBalanceOrZero } = require("./../utils/priceUtils")
const ethers = require('ethers')
const BN = ethers.BigNumber
const formatUnits = ethers.utils.formatUnits

var tokenList = [
  {address: "0x45c32fA6DF82ead1e2EF74d17b76547EDdFaFF89", symbol: "FRAX", decimals: 18},
  {address: "0x501acE9c35E60f03A2af4d484f49F9B1EFde9f40", symbol: "SOLACE", decimals: 18}
]
var initialized = false
var provider
var tokenDict = {}
var pools = {}

// creates a csv of pool stats over time
// reads and writes to s3 checkpoint to save time
async function createCSV() {
  // from scratch
  var csv = `block number,block timestamp,block timestring,price solace/usd,reserve solace,reserve usd\n`
  var startBlock = 25672669
  var endBlock = await provider.getBlockNumber()
  var blockStep = 10000
  // checkpoint
  await s3GetObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'output/markets/polygon.csv'}).then(res => {
    csv = res
    var rows = csv.split('\n')
    var lastBlock = rows[rows.length-2].split(',')[0]-0
    startBlock = lastBlock + blockStep
  }).catch(()=>{})
  console.log(`markets polygon: querying block range (${startBlock}, ${endBlock}, ${blockStep}) (${(endBlock-startBlock)/blockStep})`)
  // fetch info for a given block
  function createRowPromise(blockTag) {
    return new Promise(async (resolve,reject) => {
      console.log(`queued ${blockTag}`)
      var [block, price, s, f] = await Promise.all([
        fetchBlock(provider, blockTag),
        fetchUniswapV3PriceOrZero(pools["FRAX-SOLACE"], false, 18, 18, blockTag),
        fetchBalanceOrZero(tokenDict["SOLACE"].contract, pools["FRAX-SOLACE"].address, blockTag),
        fetchBalanceOrZero(tokenDict["FRAX"].contract, pools["FRAX-SOLACE"].address, blockTag)
      ])
      var row = `${blockTag},${block.timestamp},${formatTimestamp(block.timestamp)},${price},${formatUnits(s,18)},${formatUnits(f,18)}\n`
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

  [provider, erc20Abi, uniV3PoolAbi] = await Promise.all([
    getProvider(137),
    s3GetObjectPromise({Bucket: 'stats.solace.fi.data', Key: 'abi/other/ERC20.json'}, cache=true),
    s3GetObjectPromise({Bucket: 'stats.solace.fi.data', Key: 'abi/other/UniswapV3Pool.json'}, cache=true),
  ])
  for(var i = 0; i < tokenList.length; ++i) {
    tokenList[i].contract = new ethers.Contract(tokenList[i].address, erc20Abi, provider)
    tokenDict[tokenList[i].symbol] = tokenList[i]
  }
  pools = {
    "FRAX-SOLACE": new ethers.Contract("0x85Efec4ee18a06CE1685abF93e434751C3cb9bA9", uniV3PoolAbi, provider), // uniswap v3 frax-solace
  }
  initialized = true
}

async function track_markets_polygon() {
  return new Promise(async (resolve) => {
    console.log('start tracking markets polygon')
    await prefetch()
    var csv = await createCSV()
    await Promise.all([
      s3PutObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'output/markets/polygon.csv', Body: csv, ContentType: "text/csv" }),
      s3PutObjectPromise({ Bucket: 'stats-cache.solace.fi', Key: 'markets/polygon.csv', Body: csv, ContentType: "text/csv" })
    ])
    console.log('done tracking markets polygon')
    resolve(csv)
  })
}
exports.track_markets_polygon = track_markets_polygon

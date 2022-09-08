// tracks markets in fantom over time

const { getProvider, s3GetObjectPromise, s3PutObjectPromise, snsPublishError, withBackoffRetries, formatTimestamp, fetchBlock } = require("./../utils/utils")
const { fetchUniswapV2PriceOrZero, fetchBalanceOrZero, fetchBalancerPoolTokenInfo } = require("./../utils/priceUtils")
const ethers = require('ethers')
const BN = ethers.BigNumber
const formatUnits = ethers.utils.formatUnits

const CHAIN_ID_FANTOM = 250
var initialized = false
var provider
var pools = {}
const BALANCER_POOL_ID = "0x8D827C4F1C88141BC8F75AC1FFE1C201E09B07BB0002000000000000000004CC"

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
    var rows = csv.trim().split('\n')
    var lastBlock = rows[rows.length-1].split(',')[0]-0
    startBlock = lastBlock + blockStep
  }).catch(()=>{})
  console.log(`markets fantom: querying block range (${startBlock}, ${endBlock}, ${blockStep}) (${(endBlock-startBlock)/blockStep})`)
  // fetch info for a given block
  function createRowPromise(blockTag) {
    return new Promise(async (resolve,reject) => {
      var [block, wftmPrice, wethWftmPrice, bals] = await Promise.all([
        fetchBlock(provider, blockTag),
        fetchUniswapV2PriceOrZero(pools["USDC-WFTM"], true, 6, 18, blockTag),
        fetchUniswapV2PriceOrZero(pools["WFTM-WETH"], true, 18, 18, blockTag),
        fetchBalancerPoolTokenInfo(pools["balancer"], BALANCER_POOL_ID, blockTag),
      ])
      var ethPrice = wethWftmPrice * wftmPrice
      var [priceBalancer, sResBalancer, eResBalancer, eValue] = [0.0, 0.0, 0.0, 0.0]
      try {
        sResBalancer = parseFloat(formatUnits(bals.balances[0]))
        eResBalancer = parseFloat(formatUnits(bals.balances[1]))
        eValue = eResBalancer * ethPrice
        priceBalancer = eValue * (80 / 20) / sResBalancer
      } catch(e) {}
      var row = `${blockTag},${block.timestamp},${formatTimestamp(block.timestamp)},${priceBalancer},${sResBalancer},${eValue}\n`
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

  [provider, uniV2PairAbi, balancerVaultAbi] = await Promise.all([
    getProvider(CHAIN_ID_FANTOM),
    s3GetObjectPromise({Bucket: 'stats.solace.fi.data', Key: 'abi/other/UniswapV2Pair.json'}, cache=true),
    s3GetObjectPromise({Bucket: 'stats.solace.fi.data', Key: 'abi/other/BalancerVault.json'}, cache=true),
  ])
  pools = {
    "USDC-WFTM": new ethers.Contract("0x2b4C76d0dc16BE1C31D4C1DC53bF9B45987Fc75c", uniV2PairAbi, provider), // spookyswap usdc-wftm
    "WFTM-WETH": new ethers.Contract("0xf0702249F4D3A25cD3DED7859a165693685Ab577", uniV2PairAbi, provider), // spookyswap wftm-weth
    "balancer": new ethers.Contract("0x20dd72Ed959b6147912C2e529F0a0C651c33c9ce", balancerVaultAbi, provider), // beethoven vault
  }
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

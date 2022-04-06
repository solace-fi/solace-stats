// tracks assets in polygon uwp over time

//const { getProvider, s3GetObjectPromise, s3PutObjectPromise, snsPublishError } = require("./api/utils")
//const { withBackoffRetries, formatTimestamp, fetchBlock, fetchBalances, fetchBalanceOrZero, fetchSupplyOrZero, fetchUniswapV2PriceOrZero, fetchUniswapV3PriceOrZero } = require("./api/uwp/utils")
const { getProvider, s3GetObjectPromise, s3PutObjectPromise, snsPublishError } = require("./../utils")
const { withBackoffRetries, formatTimestamp, fetchBlock, fetchBalances, fetchBalanceOrZero, fetchSupplyOrZero, fetchUniswapV2PriceOrZero, fetchUniswapV3PriceOrZero } = require("./utils")
const ethers = require('ethers')
const BN = ethers.BigNumber
const formatUnits = ethers.utils.formatUnits

const UWP_ADDRESS = "0xd1108a800363C262774B990e9DF75a4287d5c075"

var tokenList = [
  {address: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063", symbol: "DAI", decimals: 18},
  {address: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", symbol: "USDC", decimals: 6},
  {address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", symbol: "USDT", decimals: 6},
  {address: "0x45c32fA6DF82ead1e2EF74d17b76547EDdFaFF89", symbol: "FRAX", decimals: 18},
  {address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", symbol: "MATIC", decimals: 18},
  {address: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", symbol: "WMATIC", decimals: 18},
  {address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", symbol: "WETH", decimals: 18},
  {address: "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6", symbol: "WBTC", decimals: 8},
  {address: "0x38e7e05Dfd9fa3dE80dB0e7AC03AC57Fa832C78A", symbol: "G-UNI", decimals: 18},
  {address: "0x501acE9c35E60f03A2af4d484f49F9B1EFde9f40", symbol: "SOLACE", decimals: 18}
]
var initialized = false
var provider
var tokenDict = {}
var pools
var guni
var solace
var frax
var tokensToPrice = ["WETH", "WBTC", "WMATIC", "SOLACE", "G-UNI (wo SOLACE)"]

async function fetchGuniPrice(blockTag) {
  return new Promise(async (resolve, reject) => {
    var [guniSupply, guniFraxBalance] = await Promise.all([
      fetchSupplyOrZero(tokenDict["G-UNI"].contract, blockTag),
      fetchBalanceOrZero(tokenDict["FRAX"].contract, fraxSolacePool, blockTag)
    ])
    var guniPriceWoSolace = (guniSupply.eq(0) || guniFraxBalance.eq(0)) ? 0.0 : ((formatUnits(guniFraxBalance, 18) - 0) / (formatUnits(guniSupply, 18) - 0))
    resolve(guniPriceWoSolace)
  })
}

async function fetchPrices(blockTag) {
  return new Promise(async (resolve, reject) => {
    var [wethPrice, wbtcPrice, wmaticPrice, solacePrice, guniPriceWoSolace] = await Promise.all([
      fetchUniswapV2PriceOrZero(pools["USDC-WETH"], true, 6, 18, blockTag),
      fetchUniswapV2PriceOrZero(pools["WBTC-USDC"], false, 8, 6, blockTag),
      fetchUniswapV2PriceOrZero(pools["WMATIC-USDC"], false, 18, 6, blockTag),
      fetchUniswapV3PriceOrZero(pools["FRAX-SOLACE"], false, 18, 18, blockTag),
      fetchGuniPrice(blockTag)
    ])
    resolve([wethPrice, wbtcPrice, wmaticPrice, solacePrice, guniPriceWoSolace])
  })
}

// creates a csv of pool stats over time
// reads and writes to s3 checkpoint to save time
async function createCSV() {
  // from scratch
  var csv = `block number,block timestamp,block timestring,${tokenList.map(token => `balance ${token.symbol}`).join(',')},${tokensToPrice.map(sym=>`price ${sym}`).join(',')}\n`
  var startBlock = 24531719
  var endBlock = await provider.getBlockNumber()
  var blockStep = 10000
  // checkpoint
  await s3GetObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'output/uwp_polygon.csv'}).then(res => {
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
      var [block, balances, prices] = await Promise.all([
        fetchBlock(provider, blockTag),
        fetchBalances(tokenList, UWP_ADDRESS, blockTag),
        fetchPrices(blockTag)
      ])
      var row = `${blockTag},${block.timestamp},${formatTimestamp(block.timestamp)},${balances.join(',')},${prices.join(',')}\n`
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

  [provider, erc20Abi, uniV2PairAbi, uniV3PoolAbi] = await Promise.all([
    getProvider(137),
    s3GetObjectPromise({Bucket: 'stats.solace.fi.data', Key: 'abi/other/ERC20.json'}, cache=true),
    s3GetObjectPromise({Bucket: 'stats.solace.fi.data', Key: 'abi/other/UniswapV2Pair.json'}, cache=true),
    s3GetObjectPromise({Bucket: 'stats.solace.fi.data', Key: 'abi/other/UniswapV3Pool.json'}, cache=true),
  ])
  //tokens2 = tokenList.map(token => new ethers.Contract(token.address, erc20Abi, provider))
  for(var i = 0; i < tokenList.length; ++i) {
    tokenList[i].contract = new ethers.Contract(tokenList[i].address, erc20Abi, provider)
    tokenDict[tokenList[i].symbol] = tokenList[i]
  }
  pools = {
    "USDC-WETH": new ethers.Contract("0x853Ee4b2A13f8a742d64C8F088bE7bA2131f670d", uniV2PairAbi, provider), // quickswap usdc-eth
    "WBTC-USDC": new ethers.Contract("0xF6a637525402643B0654a54bEAd2Cb9A83C8B498", uniV2PairAbi, provider), // quickswap wbtc-usdc
    "WMATIC-USDC": new ethers.Contract("0xcd353F79d9FADe311fC3119B841e1f456b54e858", uniV2PairAbi, provider), // sushiswap wmatic-usdc
    "FRAX-SOLACE": new ethers.Contract("0x85Efec4ee18a06CE1685abF93e434751C3cb9bA9", uniV3PoolAbi, provider), // uniswap v3 frax-solace
  }
  fraxSolacePool = "0x85Efec4ee18a06CE1685abF93e434751C3cb9bA9"
  initialized = true
}

async function track_uwp_polygon() {
  console.log('start tracking uwp polygon')
  await prefetch()
  var csv = await createCSV()
  await Promise.all([
    s3PutObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'output/uwp_polygon.csv', Body: csv }),
    s3PutObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'public/uwp_polygon.csv', Body: csv })
  ])
  console.log('done tracking uwp polygon')
}
exports.track_uwp_polygon = track_uwp_polygon

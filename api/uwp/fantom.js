// tracks assets in fantom uwp over time

const { getProvider, s3GetObjectPromise, s3PutObjectPromise, snsPublishError, withBackoffRetries, formatTimestamp, fetchBlock } = require("./../utils/utils")
const { fetchBalances, fetchBalanceOrZero, fetchSupplyOrZero, fetchReservesOrZero, fetchUniswapV2PriceOrZero, fetchUniswapV3PriceOrZero, fetchBalancerPoolTokenInfo } = require("./../utils/priceUtils")
const ethers = require('ethers')
const BN = ethers.BigNumber
const formatUnits = ethers.utils.formatUnits

const CHAIN_ID_FANTOM = 250
const UWP_ADDRESS = "0x2971f45c0952437934B3F055C401241e5C339F93"

var tokenList = [
  {address: "0x8D11eC38a3EB5E956B052f67Da8Bdc9bef8Abf3E", symbol: "DAI", decimals: 18},
  {address: "0x04068DA6C83AFCFA0e13ba15A6696662335D5B75", symbol: "USDC", decimals: 6},
  {address: "0x049d68029688eAbF473097a2fC38ef61633A3C7A", symbol: "USDT", decimals: 6},
  {address: "0xdc301622e621166BD8E82f2cA0A26c13Ad0BE355", symbol: "FRAX", decimals: 18},
  {address: "0x74b23882a30290451A17c44f4F05243b6b58C76d", symbol: "WETH", decimals: 18},
  {address: "0x321162Cd933E2Be498Cd2267a90534A804051b11", symbol: "WBTC", decimals: 8},
  {address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", symbol: "FTM", decimals: 18},
  {address: "0x21be370D5312f44cB42ce377BC9b8a0cEF1A4C83", symbol: "WFTM", decimals: 18},
  {address: "0x501acE9c35E60f03A2af4d484f49F9B1EFde9f40", symbol: "SOLACE", decimals: 18},
  {address: "0x8D827C4f1c88141BC8f75aC1Ffe1C201E09b07BB", symbol: "SOLACE-WETH BPT", decimals: 18}
]
var initialized = false
var provider
var tokenDict = {}
var pools
var tokensToPrice = ["WETH", "WBTC", "FTM", "SOLACE"]
const BALANCER_POOL_ID = "0x8D827C4F1C88141BC8F75AC1FFE1C201E09B07BB0002000000000000000004CC";

async function fetchPrices(blockTag) {
  return new Promise(async (resolve, reject) => {
    var [wftmPrice, wethWftmPrice, wbtcWftmPrice, bals, supply] = await Promise.all([
      fetchUniswapV2PriceOrZero(pools["USDC-WFTM"], true, 6, 18, blockTag),
      fetchUniswapV2PriceOrZero(pools["WFTM-WETH"], true, 18, 18, blockTag),
      fetchUniswapV2PriceOrZero(pools["WFTM-WBTC"], true, 18, 8, blockTag),
      fetchBalancerPoolTokenInfo(pools["balancer"], BALANCER_POOL_ID, blockTag),
      fetchSupplyOrZero(tokenDict["SOLACE-WETH BPT"].contract, blockTag),
    ])
    var wethPrice = wethWftmPrice * wftmPrice
    var wbtcPrice = wbtcWftmPrice * wftmPrice
    var [solacePrice, priceBalancer, sResBalancer, eResBalancer, eValue] = [0.0, 0.0, 0.0, 0.0, 0.0]
    try {
      sResBalancer = parseFloat(formatUnits(bals.balances[0]))
      eResBalancer = parseFloat(formatUnits(bals.balances[1]))
      eValue = eResBalancer * wethPrice
      solacePrice = eValue * (80 / 20) / sResBalancer
      priceBalancer = eValue / parseFloat(formatUnits(supply))
    } catch(e) {}
    resolve([wethPrice, wbtcPrice, wftmPrice, solacePrice, priceBalancer])
  })
}

// creates a csv of pool stats over time
// reads and writes to s3 checkpoint to save time
async function createCSV() {
  // from scratch
  var csv = `block number,block timestamp,block timestring,${tokenList.map(token => `balance ${token.symbol}`).join(',')},${tokensToPrice.map(sym=>`price ${sym}`).join(',')}\n`
  var startBlock = 39550000
  var endBlock = await provider.getBlockNumber()
  var blockStep = 10000
  // checkpoint
  await s3GetObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'output/uwp/fantom.csv'}).then(res => {
    csv = res
    var rows = csv.trim().split('\n')
    var lastBlock = rows[rows.length-1].split(',')[0]-0
    startBlock = lastBlock + blockStep
  }).catch(()=>{})
  console.log(`uwp fantom: querying block range (${startBlock}, ${endBlock}, ${blockStep}) (${(endBlock-startBlock)/blockStep})`)
  // fetch info for a given block
  function createRowPromise(blockTag) {
    return new Promise(async (resolve,reject) => {
      console.log(`queued ${blockTag}`)
      var [block, balances, prices] = await Promise.all([
        fetchBlock(provider, blockTag),
        fetchBalances(provider, tokenList, UWP_ADDRESS, blockTag),
        fetchPrices(blockTag),
      ])
      var row = `${blockTag},${block.timestamp},${formatTimestamp(block.timestamp)},${balances.slice(0,balances.length-1).join(',')},${prices.slice(0,prices.length-1).join(',')},${balances[balances.length-1]},${prices[prices.length-1]}\n`
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

  [provider, erc20Abi, uniV2PairAbi, balancerVaultAbi] = await Promise.all([
    getProvider(CHAIN_ID_FANTOM),
    s3GetObjectPromise({Bucket: 'stats.solace.fi.data', Key: 'abi/other/ERC20.json'}, cache=true),
    s3GetObjectPromise({Bucket: 'stats.solace.fi.data', Key: 'abi/other/UniswapV2Pair.json'}, cache=true),
    s3GetObjectPromise({Bucket: 'stats.solace.fi.data', Key: 'abi/other/BalancerVault.json'}, cache=true),
  ])
  for(var i = 0; i < tokenList.length; ++i) {
    tokenList[i].contract = new ethers.Contract(tokenList[i].address, erc20Abi, provider)
    tokenDict[tokenList[i].symbol] = tokenList[i]
  }
  pools = {
    "USDC-WFTM": new ethers.Contract("0x2b4C76d0dc16BE1C31D4C1DC53bF9B45987Fc75c", uniV2PairAbi, provider), // spookyswap usdc-wftm
    "WFTM-WETH": new ethers.Contract("0xf0702249F4D3A25cD3DED7859a165693685Ab577", uniV2PairAbi, provider), // spookyswap wftm-weth
    "WFTM-WBTC": new ethers.Contract("0xFdb9Ab8B9513Ad9E419Cf19530feE49d412C3Ee3", uniV2PairAbi, provider), // spookyswap wftm-wbtc
    "balancer": new ethers.Contract("0x20dd72Ed959b6147912C2e529F0a0C651c33c9ce", balancerVaultAbi, provider), // beethoven vault
  }
  initialized = true
}

async function track_uwp_fantom() {
  return new Promise(async (resolve) => {
    console.log('start tracking uwp fantom')
    await prefetch()
    var csv = await createCSV()
    await Promise.all([
      s3PutObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'output/uwp/fantom.csv', Body: csv, ContentType: "text/csv" }),
      s3PutObjectPromise({ Bucket: 'stats-cache.solace.fi', Key: 'uwp/fantom.csv', Body: csv, ContentType: "text/csv" })
    ])
    console.log('done tracking uwp fantom')
    resolve(csv)
  })
}
exports.track_uwp_fantom = track_uwp_fantom

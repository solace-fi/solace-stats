// tracks assets in ethereum uwp over time

const { getProvider, s3GetObjectPromise, s3PutObjectPromise, snsPublishError, withBackoffRetries, formatTimestamp, fetchBlock } = require("./../utils/utils")
const { fetchBalances, fetchBalanceOrZero, fetchSupplyOrZero, fetchReservesOrZero, fetchUniswapV2PriceOrZero, fetchUniswapV3PriceOrZero, fetchScpPpsOrZero } = require("./../utils/priceUtils")
const ethers = require('ethers')
const BN = ethers.BigNumber
const formatUnits = ethers.utils.formatUnits

const UWP_ADDRESS = "0x5efC0d9ee3223229Ce3b53e441016efC5BA83435"

var tokenList = [
  {address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", symbol: "DAI", decimals: 18},
  {address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", decimals: 6},
  {address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", symbol: "USDT", decimals: 6},
  {address: "0x853d955aCEf822Db058eb8505911ED77F175b99e", symbol: "FRAX", decimals: 18},
  {address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", symbol: "ETH", decimals: 18},
  {address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", symbol: "WETH", decimals: 18},
  {address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", symbol: "WBTC", decimals: 8},
  {address: "0x501AcEe83a6f269B77c167c6701843D454E2EFA0", symbol: "SCP", decimals: 18},
  {address: "0x9C051F8A6648a51eF324D30C235da74D060153aC", symbol: "SLP", decimals: 18},
  {address: "0x501acE9c35E60f03A2af4d484f49F9B1EFde9f40", symbol: "SOLACE", decimals: 18}
]
var initialized = false
var provider
var tokenDict = {}
var scp
var pools

var tokensToPrice = ["ETH", "WBTC", "SOLACE", "SCP", "SLP (wo SOLACE)"]

async function fetchPrices(blockTag) {
  return new Promise(async (resolve, reject) => {
    var [wethPrice, wbtcPrice, solacePrice, solaceRes, slpSupply, scpPPS] = await Promise.all([
      fetchUniswapV2PriceOrZero(pools["USDC-WETH"], true, 6, 18, blockTag),
      fetchUniswapV2PriceOrZero(pools["WBTC-DAI"], false, 8, 18, blockTag),
      fetchUniswapV2PriceOrZero(pools["SOLACE-USDC"], false, 18, 6, blockTag),
      fetchReservesOrZero(pools["SOLACE-USDC"], blockTag),
      fetchSupplyOrZero(pools["SOLACE-USDC"], blockTag),
      fetchScpPpsOrZero(scp, blockTag)
    ])
    var slpPriceWoSolace = (slpSupply.eq(0) || solaceRes._reserve0.eq(0) || solaceRes._reserve1.eq(0)) ? 0.0 : ((formatUnits(solaceRes._reserve1, 6) - 0) / (formatUnits(slpSupply, 18) - 0))
    var scpPrice = scpPPS.eq(0) ? 0.0 : ((formatUnits(scpPPS, 18) - 0) * wethPrice)
    resolve([wethPrice, wbtcPrice, solacePrice, scpPrice, slpPriceWoSolace])
  })
}

// creates a csv of pool stats over time
// reads and writes to s3 checkpoint to save time
async function createCSV() {
  // from scratch
  var csv = `block number,block timestamp,block timestring,${tokenList.map(token => `balance ${token.symbol}`).join(',')},${tokensToPrice.map(sym=>`price ${sym}`).join(',')}\n`
  var startBlock = 13700287
  var endBlock = await provider.getBlockNumber()
  var blockStep = 1000
  // checkpoint
  await s3GetObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'output/uwp/ethereum.csv'}).then(res => {
    csv = res
    var rows = csv.trim().split('\n')
    var lastBlock = rows[rows.length-1].split(',')[0]-0
    startBlock = lastBlock + blockStep
  }).catch(()=>{})
  console.log(`uwp ethereum: querying block range (${startBlock}, ${endBlock}, ${blockStep}) (${(endBlock-startBlock)/blockStep})`)
  // fetch info for a given block
  function createRowPromise(blockTag) {
    return new Promise(async (resolve,reject) => {
      console.log(`queued ${blockTag}`)
      var [block, balances, prices] = await Promise.all([
        fetchBlock(provider, blockTag),
        fetchBalances(provider, tokenList, UWP_ADDRESS, blockTag),
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

  [provider, erc20Abi, vaultAbi, uniV2PairAbi] = await Promise.all([
    getProvider(1),
    s3GetObjectPromise({Bucket: 'stats.solace.fi.data', Key: 'abi/other/ERC20.json'}, cache=true),
    s3GetObjectPromise({Bucket: 'stats.solace.fi.data', Key: 'abi/Vault.json'}, cache=true),
    s3GetObjectPromise({Bucket: 'stats.solace.fi.data', Key: 'abi/other/UniswapV2Pair.json'}, cache=true),
  ])
  for(var i = 0; i < tokenList.length; ++i) {
    tokenList[i].contract = new ethers.Contract(tokenList[i].address, erc20Abi, provider)
    tokenDict[tokenList[i].symbol] = tokenList[i]
  }
  scp = new ethers.Contract("0x501AcEe83a6f269B77c167c6701843D454E2EFA0", vaultAbi, provider)
  pools = {
    "USDC-WETH": new ethers.Contract("0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc", uniV2PairAbi, provider), // uni v2 usdc-eth
    "WBTC-DAI": new ethers.Contract("0x231B7589426Ffe1b75405526fC32aC09D44364c4", uniV2PairAbi, provider), // uni v2 wbtc-dai
    "SOLACE-USDC": new ethers.Contract("0x9C051F8A6648a51eF324D30C235da74D060153aC", uniV2PairAbi, provider), // sushi solace-usdc
  }
  initialized = true
}

async function track_uwp_ethereum() {
  return new Promise(async (resolve) => {
    console.log('start tracking uwp ethereum')
    await prefetch()
    var csv = await createCSV()
    await Promise.all([
      s3PutObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'output/uwp/ethereum.csv', Body: csv, ContentType: "text/csv" }),
      s3PutObjectPromise({ Bucket: 'stats-cache.solace.fi', Key: 'uwp/ethereum.csv', Body: csv, ContentType: "text/csv" })
    ])
    console.log('done tracking uwp ethereum')
    resolve(csv)
  })
}
exports.track_uwp_ethereum = track_uwp_ethereum

// tracks assets in aurora uwp over time

const { getProvider, s3GetObjectPromise, s3PutObjectPromise, snsPublishError, withBackoffRetries, formatTimestamp, fetchBlock } = require("./../utils/utils")
const { fetchBalances, fetchBalanceOrZero, fetchSupplyOrZero, fetchReservesOrZero, fetchUniswapV2PriceOrZero, fetchUniswapV3PriceOrZero } = require("./../utils/priceUtils")
const ethers = require('ethers')
const BN = ethers.BigNumber
const formatUnits = ethers.utils.formatUnits

const UWP_ADDRESS = "0x4A6B0f90597e7429Ce8400fC0E2745Add343df78"

var tokenList = [
  {address: "0xe3520349F477A5F6EB06107066048508498A291b", symbol: "DAI", decimals: 18},
  {address: "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802", symbol: "USDC", decimals: 6},
  {address: "0x4988a896b1227218e4A686fdE5EabdcAbd91571f", symbol: "USDT", decimals: 6},
  {address: "0xDA2585430fEf327aD8ee44Af8F1f989a2A91A3d2", symbol: "FRAX", decimals: 18},
  {address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", symbol: "ETH", decimals: 18},
  {address: "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB", symbol: "WETH", decimals: 18},
  {address: "0xf4eb217ba2454613b15dbdea6e5f22276410e89e", symbol: "WBTC", decimals: 8},
  {address: "0xC42C30aC6Cc15faC9bD938618BcaA1a1FaE8501d", symbol: "WNEAR", decimals: 24},
  {address: "0x8BEc47865aDe3B172A928df8f990Bc7f2A3b9f79", symbol: "AURORA", decimals: 18},
  {address: "0xdDAdf88b007B95fEb42DDbd110034C9a8e9746F2", symbol: "TLP", decimals: 18},
  {address: "0x501acE9c35E60f03A2af4d484f49F9B1EFde9f40", symbol: "SOLACE", decimals: 18}
]
var initialized = false
var provider
var tokenDict = {}
var pools
var tokensToPrice = ["WETH", "WBTC", "WNEAR", "AURORA", "SOLACE", "TLP (wo SOLACE)"]

async function fetchPrices(blockTag) {
  return new Promise(async (resolve, reject) => {
    var [wnearPrice, wethWnearPrice, wbtcWnearPrice, auroraWethPrice, solaceWnearPrice, tlpRes, tlpWnearBal, tlpSupply] = await Promise.all([
      fetchUniswapV2PriceOrZero(pools["USDC-WNEAR"], true, 6, 24, blockTag),
      fetchUniswapV2PriceOrZero(pools["WNEAR-WETH"], true, 24, 18, blockTag),
      fetchUniswapV2PriceOrZero(pools["WNEAR-WBTC"], true, 24, 8, blockTag),
      fetchUniswapV2PriceOrZero(pools["AURORA-WETH"], false, 18, 18, blockTag),
      fetchUniswapV2PriceOrZero(pools["SOLACE-WNEAR"], false, 18, 24, blockTag),
      fetchReservesOrZero(pools["SOLACE-WNEAR"], blockTag),
      fetchBalanceOrZero(tokenDict["WNEAR"].contract, pools["SOLACE-WNEAR"].address, blockTag),
      fetchSupplyOrZero(tokenDict["TLP"].contract, blockTag)
    ])
    var wethPrice = wethWnearPrice * wnearPrice
    var wbtcPrice = wbtcWnearPrice * wnearPrice
    var auroraPrice = auroraWethPrice * wethPrice
    var solacePrice = solaceWnearPrice * wnearPrice
    var tlpWnearPrice = (tlpRes._reserve0.eq(0) || tlpRes._reserve1.eq(0) || tlpSupply.eq(0)) ? 0.0 : ((formatUnits(tlpWnearBal, 24) - 0) / (formatUnits(tlpSupply, 18) - 0))
    var tlpPrice = tlpWnearPrice * wnearPrice
    resolve([wethPrice, wbtcPrice, wnearPrice, auroraPrice, solacePrice, tlpPrice])
  })
}

// creates a csv of pool stats over time
// reads and writes to s3 checkpoint to save time
async function createCSV() {
  // from scratch
  var csv = `block number,block timestamp,block timestring,${tokenList.map(token => `balance ${token.symbol}`).join(',')},${tokensToPrice.map(sym=>`price ${sym}`).join(',')}\n`
  var startBlock = 59109323
  var endBlock = await provider.getBlockNumber()
  var blockStep = 10000
  // checkpoint
  await s3GetObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'output/uwp/aurora.csv'}).then(res => {
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

  [provider, erc20Abi, uniV2PairAbi] = await Promise.all([
    getProvider(1313161554),
    s3GetObjectPromise({Bucket: 'stats.solace.fi.data', Key: 'abi/other/ERC20.json'}, cache=true),
    s3GetObjectPromise({Bucket: 'stats.solace.fi.data', Key: 'abi/other/UniswapV2Pair.json'}, cache=true),
  ])
  for(var i = 0; i < tokenList.length; ++i) {
    tokenList[i].contract = new ethers.Contract(tokenList[i].address, erc20Abi, provider)
    tokenDict[tokenList[i].symbol] = tokenList[i]
  }
  pools = {
    "USDC-WNEAR": new ethers.Contract("0x20F8AeFB5697B77E0BB835A8518BE70775cdA1b0", uniV2PairAbi, provider), // trisolaris usdc-wnear
    "WNEAR-WETH": new ethers.Contract("0x63da4DB6Ef4e7C62168aB03982399F9588fCd198", uniV2PairAbi, provider), // trisolaris wnear-weth
    "WNEAR-WBTC": new ethers.Contract("0xbc8A244e8fb683ec1Fd6f88F3cc6E565082174Eb", uniV2PairAbi, provider), // trisolaris  wnear-wbtc
    "AURORA-WETH": new ethers.Contract("0x5eeC60F348cB1D661E4A5122CF4638c7DB7A886e", uniV2PairAbi, provider), // trisolaris aurora-weth
    "SOLACE-WNEAR": new ethers.Contract("0xdDAdf88b007B95fEb42DDbd110034C9a8e9746F2", uniV2PairAbi, provider), // trisolaris solace-wnear
  }
  initialized = true
}

async function track_uwp_aurora() {
  return new Promise(async (resolve) => {
    console.log('start tracking uwp aurora')
    await prefetch()
    var csv = await createCSV()
    await Promise.all([
      s3PutObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'output/uwp/aurora.csv', Body: csv, ContentType: "text/csv" }),
      s3PutObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'public/uwp/aurora.csv', Body: csv, ContentType: "text/csv" })
    ])
    console.log('done tracking uwp aurora')
    resolve(csv)
  })
}
exports.track_uwp_aurora = track_uwp_aurora

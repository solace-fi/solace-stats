// tracks assets in goerli uwp over time

const { getProvider, getMulticallProvider, s3GetObjectPromise, s3PutObjectPromise, snsPublishError, withBackoffRetries, formatTimestamp, fetchBlock, multicallChunked } = require("./../utils/utils")
const { fetchBalances, fetchBalanceOrZero, fetchSupplyOrZero, fetchReservesOrZero, fetchUniswapV2PriceOrZero, fetchUniswapV3PriceOrZero, fetchScpPpsOrZero } = require("./../utils/priceUtils")
const ethers = require('ethers')
const multicall = require('ethers-multicall')
const BN = ethers.BigNumber
const formatUnits = ethers.utils.formatUnits

const UWP_ADDRESS                       = "0x501ACEb41708De16FbedE3b31f3064919E9d7F23";
const UWE_ADDRESS                       = "0x501ACE809013C8916CAAe439e9653bc436172919";
const ONE_ETHER = BN.from("1000000000000000000")
const CHAIN_ID = 5

var initialized = false
var provider
var mcProvider
var uwpAbi
var erc20Abi
var oracleAbi

async function fetchPoolStats(mcProvider, tokenList, uwpAddress, blockTag) {
  // setup multicall
  var promises = []
  // token calls
  for(var i = 0; i < tokenList.length; ++i) {
    var tokenContract = new multicall.Contract(tokenList[i].address, erc20Abi)
    promises.push(tokenContract.balanceOf(uwpAddress))
    var oneToken = BN.from(10).pow(tokenList[i].decimals)
    var oracleContract = new multicall.Contract(tokenList[i].oracle, oracleAbi)
    promises.push(oracleContract.valueOfTokens(tokenList[i].address, oneToken))
  }
  // uwp calls
  var uwpContract = new multicall.Contract(uwpAddress, uwpAbi)
  promises.push(uwpContract.totalSupply())
  promises.push(uwpContract.valueOfShares(ONE_ETHER))
  // make multicall
  var results = []
  try {
    results = await multicallChunked(mcProvider, promises, blockTag, 50)
  } catch(e) {
    for(var i = 0; i < promises.length; ++i) results.push(BN.from(0))
  }
  // token calls
  var tokenStats = {}
  for(var i = 0; i < tokenList.length; ++i) {
    tokenStats[tokenList[i].symbol] = {
      balance: formatUnits(results[i*2], tokenList[i].decimals),
      price: formatUnits(results[i*2+1], 18)
    }
  }
  // uwp calls
  var poolStats = {
    supply: formatUnits(results[results.length-2], 18),
    valuePerShare: formatUnits(results[results.length-1], 18),
  }
  return {tokenStats, poolStats}
}

// creates a json object of pool stats over time
// reads and writes to s3 checkpoint to save time
async function createHistory() {
  // from scratch
  var history = []
  var startBlock = 7471443
  var endBlock = await provider.getBlockNumber()
  var blockStep = 1000
  var tokenList = JSON.parse(await s3GetObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'native_uwp/tokenList.json' }, cache=false))[CHAIN_ID]
  // checkpoint
  await s3GetObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'output/native_uwp/goerli.json'}).then(res => {
    history = JSON.parse(res)
    history.sort((a,b)=>a.timestamp-b.timestamp)
    if(history.length > 0) {
      var lastBlock = history[history.length-1].blockNumber
      startBlock = lastBlock + blockStep
    }
  }).catch(()=>{})
  console.log(`uwp goerli: querying block range (${startBlock}, ${endBlock}, ${blockStep}) (${(endBlock-startBlock)/blockStep})`)
  // fetch info for a given block
  function createRowPromise(blockTag) {
    return new Promise(async (resolve,reject) => {
      console.log(`queued ${blockTag}`)
      var [block, stats] = await Promise.all([
        fetchBlock(provider, blockTag),
        fetchPoolStats(mcProvider, tokenList, UWP_ADDRESS, blockTag),
      ]);
      var row = {
        blockNumber: blockTag,
        timestamp: block.timestamp,
        timestring: formatTimestamp(block.timestamp),
        tokens: stats.tokenStats,
        pool: stats.poolStats
      }
      console.log(`finished ${blockTag}\n${row}`)
      resolve(row)
    })
  }
  // loop across blocks
  for(var bt = startBlock; bt < endBlock; bt += blockStep) {
    history.push(await createRowPromise(bt))
  }
  history.push(await createRowPromise(endBlock))
  return history
}

async function prefetch() {
  if(initialized) return

  [provider, mcProvider, uwpAbi, erc20Abi, oracleAbi] = await Promise.all([
    getProvider(CHAIN_ID),
    getMulticallProvider(CHAIN_ID),
    s3GetObjectPromise({Bucket: 'stats.solace.fi.data', Key: 'abi/native/UnderwritingPool.json'}, cache=true).then(JSON.parse),
    s3GetObjectPromise({Bucket: 'stats.solace.fi.data', Key: 'abi/other/ERC20.json'}, cache=true).then(JSON.parse),
    s3GetObjectPromise({Bucket: 'stats.solace.fi.data', Key: 'abi/interfaces/native/IPriceOracle.json'}, cache=true).then(JSON.parse),
  ])
  initialized = true
}

async function track_native_uwp_goerli() {
  return new Promise(async (resolve) => {
    console.log('start tracking native uwp goerli')
    await prefetch()
    let history = await createHistory()
    let res = JSON.stringify(history)
    await Promise.all([
      s3PutObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'output/native_uwp/goerli.json', Body: res, ContentType: "application/json" }),
      s3PutObjectPromise({ Bucket: 'stats-cache.solace.fi', Key: 'native_uwp/goerli.json', Body: res, ContentType: "application/json" })
    ])
    console.log('done tracking native uwp goerli')
    resolve(history)
  })
}
exports.track_native_uwp_goerli = track_native_uwp_goerli

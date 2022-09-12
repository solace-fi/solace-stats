// tracks premiums of native in goerli over time

const { getProvider, getMulticallProvider, s3GetObjectPromise, s3PutObjectPromise, snsPublishError, withBackoffRetries, formatTimestamp, fetchBlock, fetchEvents, multicallChunked } = require("./../utils/utils")
const ethers = require('ethers')
const multicall = require('ethers-multicall')
const BN = ethers.BigNumber
const formatUnits = ethers.utils.formatUnits

const UWP_ADDRESS                       = "0x501ACEb41708De16FbedE3b31f3064919E9d7F23";
const UWE_ADDRESS                       = "0x501ACE809013C8916CAAe439e9653bc436172919";
const REVENUE_ROUTER_ADDRESS            = "0x501AcE0e8D16B92236763E2dEd7aE3bc2DFfA276";
const UNDERWRITING_LOCKER_ADDRESS       = "0x501ACeC465fEbc1b1b936Bdc937A9FD28F6E6E7E";
const ONE_ETHER = BN.from("1000000000000000000")
const CHAIN_ID_GOERLI = 5
const ONE_WEEK = 604800

var initialized = false
var provider
var mcProvider
var uwpAbi
var uweAbi

async function tryGetStats(uwpMC, uweMC, blockTag) {
  try {
    var [pps, bal, ts] = await multicallChunked(mcProvider, [
      uwpMC.valueOfShares(ONE_ETHER),
      uwpMC.balanceOf(UWE_ADDRESS),
      uweMC.totalSupply()
    ], blockTag)
    var uwpPerUwe = formatUnits(ts.gt(0)
      ? bal.mul(ONE_ETHER).div(ts)
      : BN.from(0)
    )
    pps = formatUnits(pps)
    return [pps, uwpPerUwe]
  } catch(e) {
    return ["0.0", "0.0"]
  }
}

// creates a json object of pool stats over time
// reads and writes to s3 checkpoint to save time
async function createHistory() {
  // from scratch
  var startBlock = 7471443
  var endBlock = await provider.getBlockNumber()
  var history = { history: [], lastScannedBlock: startBlock-1 }
  // checkpoint
  await s3GetObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'output/native_premiums/goerli.json'}).then(res => {
    history = JSON.parse(res)
    history.history.sort((a,b)=>a.epochStartTimestamp-b.epochStartTimestamp)
    startBlock = history.lastScannedBlock + 1
  }).catch(()=>{})
  console.log(`uwp goerli: querying block range (${startBlock}, ${endBlock}) (${(endBlock-startBlock)})`)

  // fetch events
  var uwpMC = new multicall.Contract(UWP_ADDRESS, uwpAbi);
  var uwe = new ethers.Contract(UWE_ADDRESS, uweAbi, provider)
  var uweMC = new multicall.Contract(UWE_ADDRESS, uweAbi);
  var events = await fetchEvents(uwe, uwe.filters.Transfer(UNDERWRITING_LOCKER_ADDRESS, REVENUE_ROUTER_ADDRESS, null), startBlock, endBlock)
  events.sort((a,b)=>a.blockNumber-b.blockNumber)
  // parse events
  for(var i = 0; i < events.length; ++i) {
    var blockTag = events[i].blockNumber
    var [block, stats] = await Promise.all([
      provider.getBlock(blockTag),
      tryGetStats(uwpMC, uweMC, blockTag),
    ])
    var epochStartTimestamp = Math.floor(block.timestamp / ONE_WEEK) * ONE_WEEK
    var uweAmount = formatUnits(events[i].args.value)
    history.history.push({
      epochStartTimestamp,
      uweAmount,
      uwpValuePerShare: stats[0],
      uwpPerUwe: stats[1]
    })
  }
  history.lastScannedBlock = endBlock
  return history
}

async function prefetch() {
  if(initialized) return

  [provider, mcProvider, uwpAbi, uweAbi] = await Promise.all([
    getProvider(CHAIN_ID_GOERLI),
    getMulticallProvider(CHAIN_ID_GOERLI),
    s3GetObjectPromise({Bucket: 'stats.solace.fi.data', Key: 'abi/native/UnderwritingPool.json'}, cache=true).then(JSON.parse),
    s3GetObjectPromise({Bucket: 'stats.solace.fi.data', Key: 'abi/native/UnderwritingEquity.json'}, cache=true).then(JSON.parse),
  ])
  initialized = true
}

async function track_native_premiums_goerli() {
  return new Promise(async (resolve) => {
    console.log('start tracking native premiums goerli')
    await prefetch()
    let history = await createHistory()
    let res = JSON.stringify(history)
    await Promise.all([
      s3PutObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'output/native_premiums/goerli.json', Body: res, ContentType: "application/json" }),
      s3PutObjectPromise({ Bucket: 'stats-cache.solace.fi', Key: 'native_premiums/goerli.json', Body: res, ContentType: "application/json" })
    ])
    console.log('done tracking native premiums goerli')
    resolve(history)
  })
}
exports.track_native_premiums_goerli = track_native_premiums_goerli

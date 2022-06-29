// tracks policies in ethereum over time

const { getProvider, getMulticallProvider, s3GetObjectPromise, s3PutObjectPromise, snsPublishError, withBackoffRetries, formatTimestamp, fetchBlock, fetchEvents } = require("./../utils/utils")
const { fetchReservesOrZero, calculateUniswapV2PriceOrZero } = require("./../utils/priceUtils")
const ethers = require('ethers')
const BN = ethers.BigNumber
const formatUnits = ethers.utils.formatUnits

var initialized = false
var provider
var spi
var scp

const SPI_ADDRESS = "0x501ACeB72d62C9875825b71d9f78a27780B5624d"
const SPI_DEPLOY_BLOCK = 14999363

const SCP_ADDRESS = "0x501ACE72166956F57b44dbBcc531A8E741449997"

const PREMIUM_POOL_ADDRESS = "0x88fdDCe9aD3C5A12c06B597F0948F8EafFC3862d"
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

// fetches the timestamp of a given block number
// repeat calls come from cache
var blockCache = {}
async function fetchBlockInfo(blockNumber) {
  if(blockNumber == 'latest') blockNumber = await provider.getBlockNumber()
  if(blockCache.hasOwnProperty(blockNumber)) return blockCache[blockNumber]
  else {
    let block = await provider.getBlock(blockNumber)
    blockCache[blockNumber] = {
      timestamp: block.timestamp
    }
    return blockCache[blockNumber]
  }
}

async function createHistory() {
  // from scratch
  var history = []
  var policies = []
  var startBlock = SPI_DEPLOY_BLOCK
  var latestBlock
  // checkpoint
  await s3GetObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'output/spi/ethereum_v3.json'}).then(res => {
    console.log('using checkpoint')
    res = JSON.parse(res)
    history = res.history
    policies = res.policies
    if(history.length > 0) {
      latestBlock = history[history.length-1]
      startBlock = Math.max((res.latestSearchedBlock+1)||0, (latestBlock.blockNumber+1)||0)
    }
    else throw ""
  }).catch(async()=>{
    console.log('starting from scratch')
    var deployBlock = await fetchBlockInfo(SPI_DEPLOY_BLOCK)
    latestBlock = {
      blockNumber: SPI_DEPLOY_BLOCK,
      timestamp: deployBlock.timestamp,
      timestring: formatTimestamp(deployBlock.timestamp),
      policyCount: "0",
      policyCountInactive: "0",
      depositsMade: "0",
      premiumsCharged: "0",
      coverLimit: "0",
    }
    history.push({...latestBlock})
  })

  // fetch new events
  var endBlock = await provider.getBlockNumber()
  var latestSearchedBlock = endBlock;
  var events = await Promise.all([
    fetchEvents(spi, "PolicyCreated", startBlock, endBlock),
    fetchEvents(spi, "PolicyUpdated", startBlock, endBlock),
    fetchEvents(spi, "PolicyCanceled", startBlock, endBlock),
    fetchEvents(scp, "Transfer", startBlock, endBlock),
  ])
  events = flattenArrays(events).sort(sortEvents)

  // cache block infos
  let blockNumbers = [... new Set(events.map(event => event.blockNumber))]
  blockNumbers.push(endBlock)
  blockNumbers.sort()
  await Promise.all(blockNumbers.map(fetchBlockInfo))
  // loop over new events
  for(var i = 0; i < events.length; ) {
    var blockNumber = events[i].blockNumber
    // loop over events from the same block
    for(; i < events.length && events[i].blockNumber == blockNumber; ++i) {
      // process next event
      var event = events[i]
      var eventName = event.event

      async function getPolicyByPolicyholder(policyholder) {
        var query = policies.filter(policy => policy.policyholder == policyholder)
        if(query.length > 1) throw "uhh"
        if(query.length == 1) return query[0]
        var policyID = (await spi.policyOf(policyholder, {blockTag: blockNumber})).toString()
        if(policyID == "0") return undefined
        var [coverLimit, bal, balnr] = await Promise.all([
          spi.coverLimitOf(policyID, {blockTag: blockNumber}).then(r=>r.toString()),
          scp.balanceOf(policyholder, {blockTag: blockNumber}),
          scp.balanceOfNonRefundable(policyholder, {blockTag: blockNumber}),
        ])
        var depositsMade = bal.sub(balnr).toString()
        var policy = {policyID, policyholder, coverLimit, depositsMade, premiumsCharged: "0"}
        policies.push(policy)
        latestBlock.coverLimit = BN.from(latestBlock.coverLimit).add(coverLimit).toString()
        latestBlock.policyCount = BN.from(latestBlock.policyCount).add(1).toString()
        return policy
      }

      async function getPolicyByPolicyID(policyID) {
        var query = policies.filter(policy => policy.policyID == policyID)
        if(query.length > 1) throw "uhh"
        if(query.length == 1) return query[0]
        var [coverLimit, policyholder] = await Promise.all([
          spi.coverLimitOf(policyID, {blockTag: blockNumber}).then(cl=>cl.toString()),
          spi.ownerOf(policyID, {blockTag: blockNumber})
        ])
        var [bal, balnr] = await Promise.all([
          scp.balanceOf(policyholder, {blockTag: blockNumber}),
          scp.balanceOfNonRefundable(policyholder, {blockTag: blockNumber}),
        ])
        var depositsMade = bal.sub(balnr).toString()
        var policy = {policyID, policyholder, coverLimit, depositsMade, premiumsCharged: "0"}
        policies.push(policy)
        latestBlock.coverLimit = BN.from(latestBlock.coverLimit).add(coverLimit).toString()
        latestBlock.policyCount = BN.from(latestBlock.policyCount).add(1).toString()
        return policy
      }

      if(eventName == "PolicyCreated") {
        var policyID = event.args.policyID.toString()
        await getPolicyByPolicyID(policyID)
      } else if(eventName == "PolicyUpdated") {
        var policyID = event.args.policyID.toString()
        var policy = await getPolicyByPolicyID(policyID)
        var oldCoverLimit = policy.coverLimit
        var newCoverLimit = await spi.coverLimitOf(policyID, {blockTag: blockNumber})
        policy.coverLimit = newCoverLimit.toString()
        latestBlock.coverLimit = BN.from(latestBlock.coverLimit).sub(oldCoverLimit).add(newCoverLimit).toString()
      } else if(eventName == "PolicyCanceled") {
        var policyID = event.args.policyID.toString()
        var policy = await getPolicyByPolicyID(policyID)
        var oldCoverLimit = policy.coverLimit
        var newCoverLimit = BN.from(0)
        policy.coverLimit = newCoverLimit.toString()
        latestBlock.coverLimit = BN.from(latestBlock.coverLimit).sub(oldCoverLimit).add(newCoverLimit).toString()
      } else if(eventName == "Transfer") {
        if(event.args.from == ZERO_ADDRESS) {
          // mint
          var policy = await getPolicyByPolicyholder(event.args.to)
          if(!!policy) policy.depositsMade = BN.from(policy.depositsMade).add(event.args.value).toString()
          latestBlock.depositsMade = BN.from(latestBlock.depositsMade).add(event.args.value).toString()
        } else if(event.args.to == ZERO_ADDRESS || event.args.to == PREMIUM_POOL_ADDRESS) {
          // burn
          var policy = await getPolicyByPolicyholder(event.args.from)
          if(!!policy) policy.premiumsCharged = BN.from(policy.premiumsCharged).add(event.args.value).toString()
          latestBlock.premiumsCharged = BN.from(latestBlock.premiumsCharged).add(event.args.value).toString()
        }
      }
    }
    // add data point to history
    latestBlock.blockNumber = blockNumber
    var timestamp = (await fetchBlockInfo(blockNumber)).timestamp
    latestBlock.timestamp = timestamp
    latestBlock.timestring = formatTimestamp(timestamp)
    history.push({...latestBlock})
  }
  return {history, policies, latestSearchedBlock}
}

// given an array of arrays, returns all elements of all arrays in a single array
function flattenArrays(arrs) {
  var arr = []
  arrs.forEach(a => arr = arr.concat(a))
  return arr
}

// when passed into an event[].sort(sortEvents), sorts the events into chronological order
function sortEvents(a,b) {
  if(a.blockNumber > b.blockNumber) return 1
  if(a.blockNumber < b.blockNumber) return -1
  if(a.logIndex > b.logIndex) return 1
  if(a.logIndex < b.logIndex) return -1
  return 0
}

async function prefetch() {
  if(initialized) return
  [provider, spiABI, scpABI] = await Promise.all([
    getProvider(1),
    s3GetObjectPromise({Bucket:'stats.solace.fi.data', Key:'abi/products/SolaceCoverProductV3.json'}, cache=true),
    s3GetObjectPromise({Bucket:'stats.solace.fi.data', Key:'abi/payment/SCP.json'}, cache=true),
  ])
  spi = new ethers.Contract(SPI_ADDRESS, spiABI, provider)
  scp = new ethers.Contract(SCP_ADDRESS, scpABI, provider)
  initialized = true
}

async function track_ethereum_v3() {
  return new Promise(async (resolve) => {
    console.log('start tracking spi ethereum v3')
    await prefetch()
    var ethereum_v3 = await createHistory()
    var res = JSON.stringify(ethereum_v3)
    await Promise.all([
      s3PutObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'output/spi/ethereum_v3.json', Body: res, ContentType: "application/json" }),
      s3PutObjectPromise({ Bucket: 'stats-cache.solace.fi', Key: 'spi/ethereum_v3.json', Body: res, ContentType: "application/json" })
    ])
    console.log('done tracking spi ethereum v3')
    resolve(ethereum_v3)
  })
}
exports.track_ethereum_v3 = track_ethereum_v3

//var res
//track_ethereum_v3().then(r=>{res=r;console.log(res)}).catch(console.error)

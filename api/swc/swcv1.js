// tracks policies in mainnet over time

const { getProvider, getMulticallProvider, s3GetObjectPromise, s3PutObjectPromise, snsPublishError, withBackoffRetries, formatTimestamp, fetchBlock } = require("./../utils/utils")
const { fetchReservesOrZero, calculateUniswapV2PriceOrZero } = require("./../utils/priceUtils")
const ethers = require('ethers')
const BN = ethers.BigNumber
const formatUnits = ethers.utils.formatUnits

var initialized = false
var provider
var swc

const SWC_ADDRESS = "0x501ACEbe29eabc346779BcB5Fd62Eaf6Bfb5320E"
const SWC_DEPLOY_BLOCK = 14214331

// fetch events that occurred in a contract with the given event name between startBlock and endBlock
async function fetchEvents(contract, eventName, startBlock, endBlock) {
  return new Promise(async (resolve,reject) => {
    if(endBlock == 'latest') endBlock = await provider.getBlockNumber()
    try {
      var events = await contract.queryFilter(eventName, startBlock, endBlock)
      resolve(events)
      return
    } catch(e) {
      if(JSON.parse(e.body).error.code != -32602) {
        reject(e)
        return
      }
      // log response size exceeded. recurse down
      var midBlock = Math.floor((startBlock+endBlock)/2)
      var [left, right] = await Promise.all([
        fetchEvents(contract, eventName, startBlock, midBlock),
        fetchEvents(contract, eventName, midBlock+1, endBlock),
      ])
      var res = left.concat(right)
      resolve(res)
    }
  })
}

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
  var startBlock = SWC_DEPLOY_BLOCK
  var latestBlock
  // checkpoint
  await s3GetObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'output/swc/swcv1.json'}).then(res => {
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
    var deployBlock = await fetchBlockInfo(SWC_DEPLOY_BLOCK)
    latestBlock = {
      blockNumber: SWC_DEPLOY_BLOCK,
      timestamp: deployBlock.timestamp,
      timestring: formatTimestamp(deployBlock.timestamp),
      policyCount: "0",
      policyCountInactive: "0",
      depositsMade: "0",
      premiumsCharged: "0",
      rewardPointsEarned: "0",
      coverLimit: "0",
    }
    history.push({...latestBlock})
  })

  // fetch new events
  var endBlock = await provider.getBlockNumber()
  var latestSearchedBlock = endBlock;
  var events = await Promise.all([
    fetchEvents(swc, "DepositMade", startBlock, endBlock),
    fetchEvents(swc, "WithdrawMade", startBlock, endBlock),
    fetchEvents(swc, "PolicyCreated", startBlock, endBlock),
    fetchEvents(swc, "PolicyUpdated", startBlock, endBlock),
    fetchEvents(swc, "PolicyDeactivated", startBlock, endBlock),
    fetchEvents(swc, "PremiumCharged", startBlock, endBlock),
    fetchEvents(swc, "PremiumPartiallyCharged", startBlock, endBlock),
    fetchEvents(swc, "ReferralRewardsEarned", startBlock, endBlock)
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
        var policyID = (await swc.policyOf(policyholder, {blockTag: blockNumber})).toString()
        var coverLimit = (await swc.coverLimitOf(policyID, {blockTag: blockNumber})).toString()
        var policy = {policyID, policyholder, coverLimit, depositsMade: "0", premiumsCharged: "0", rewardPointsEarned: "0"}
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
          swc.coverLimitOf(policyID, {blockTag: blockNumber}).then(cl=>cl.toString()),
          swc.ownerOf(policyID, {blockTag: blockNumber})
        ])
        var policy = {policyID, policyholder, coverLimit, depositsMade: "0", premiumsCharged: "0", rewardPointsEarned: "0"}
        policies.push(policy)
        latestBlock.coverLimit = BN.from(latestBlock.coverLimit).add(coverLimit).toString()
        latestBlock.policyCount = BN.from(latestBlock.policyCount).add(1).toString()
        return policy
      }

      if(eventName == "DepositMade") {
        var policy = await getPolicyByPolicyholder(event.args.policyholder)
        policy.depositsMade = BN.from(policy.depositsMade).add(event.args.amount).toString()
        latestBlock.depositsMade = BN.from(latestBlock.depositsMade).add(event.args.amount).toString()
      } else if(eventName == "WithdrawMade") {
        var policy = await getPolicyByPolicyholder(event.args.policyholder)
        policy.depositsMade = BN.from(policy.depositsMade).sub(event.args.amount).toString()
        latestBlock.depositsMade = BN.from(latestBlock.depositsMade).sub(event.args.amount).toString()
      } else if(eventName == "PolicyCreated") {
        await getPolicyByPolicyID(event.args.policyID)
      } else if(eventName == "PolicyUpdated") {
        var policyID = event.args.policyID.toString()
        var policy = await getPolicyByPolicyID(policyID)
        var oldCoverLimit = policy.coverLimit
        var newCoverLimit = await swc.coverLimitOf(policyID, {blockTag: blockNumber})
        policy.coverLimit = newCoverLimit.toString()
        latestBlock.coverLimit = BN.from(latestBlock.coverLimit).sub(oldCoverLimit).add(newCoverLimit).toString()
      } else if(eventName == "PolicyDeactivated") {
        var policyID = event.args.policyID.toString()
        var policy = await getPolicyByPolicyID(policyID)
        var oldCoverLimit = policy.coverLimit
        var newCoverLimit = BN.from(0)
        policy.coverLimit = newCoverLimit.toString()
        latestBlock.coverLimit = BN.from(latestBlock.coverLimit).sub(oldCoverLimit).add(newCoverLimit).toString()
      } else if(eventName == "PremiumCharged") {
        var amount = event.args.amount
        var policyholder = event.args.policyholder
        var policy = await getPolicyByPolicyholder(event.args.policyholder)
        policy.premiumsCharged = BN.from(policy.premiumsCharged).add(amount).toString()
        latestBlock.premiumsCharged = BN.from(latestBlock.premiumsCharged).add(amount).toString()
      } else if(eventName == "PremiumPartiallyCharged") {
        var actualPremium = event.args.actualPremium
        var chargedPremium = event.args.chargedPremium
        var policyholder = event.args.policyholder
        var policy = await getPolicyByPolicyholder(event.args.policyholder)
        policy.premiumsCharged = BN.from(policy.premiumsCharged).add(chargedPremium).toString()
        latestBlock.premiumsCharged = BN.from(latestBlock.premiumsCharged).add(chargedPremium).toString()
        // also calls PolicyDeactivated
      } else if(eventName == "ReferralRewardsEarned") {
        // note that when activating your policy with a referral code, ReferralRewardsEarned is emitted before PolicyCreated
        var policy = await getPolicyByPolicyholder(event.args.rewardEarner)
        var rewardPointsEarned = event.args.rewardPointsEarned
        policy.rewardPointsEarned = BN.from(policy.rewardPointsEarned).add(rewardPointsEarned).toString()
        latestBlock.rewardPointsEarned = BN.from(latestBlock.rewardPointsEarned).add(rewardPointsEarned).toString()
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
  [provider, swcABI] = await Promise.all([
    getProvider(1),
    s3GetObjectPromise({Bucket:'stats.solace.fi.data', Key:'abi/products/SolaceCoverProduct.json'}, cache=true)
  ])
  swc = new ethers.Contract(SWC_ADDRESS, swcABI, provider)
  initialized = true
}

async function track_swcv1() {
  return new Promise(async (resolve) => {
    console.log('start tracking swc v1')
    await prefetch()
    var swcv1 = await createHistory()
    var res = JSON.stringify(swcv1)
    await Promise.all([
      s3PutObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'output/swc/swcv1.json', Body: res, ContentType: "application/json" }),
      s3PutObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'public/swc/swcv1.json', Body: res, ContentType: "application/json" })
    ])
    console.log('done tracking swc v1')
    resolve(swcv1)
  })
}
exports.track_swcv1 = track_swcv1

//var res
//track_swcv1().then(r=>{res=r;console.log(res)}).catch(console.error)

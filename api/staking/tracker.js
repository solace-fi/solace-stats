const { getProvider, getMulticallProvider, s3GetObjectPromise, s3PutObjectPromise, snsPublishError, range, sortBNs, filterYN } = require("./../utils/utils")
const { getXsLocks, getXsLocksOfChain } = require("./../xsLocker/get")
const ethers = require('ethers')
const BN = ethers.BigNumber
const formatUnits = ethers.utils.formatUnits
const multicall = require('ethers-multicall')

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

let deployments = {
  [1]: { // ethereum
    xslockerAddress: "0x501Ace47c5b0C2099C4464f681c3fa2ECD3146C1",
    stakingRewardsAddress: "0x501ace3D42f9c8723B108D4fBE29989060a91411"
  },
  [1313161554]: { // aurora
    xslockerAddress: "0x501Ace47c5b0C2099C4464f681c3fa2ECD3146C1",
    stakingRewardsAddress: "0x501ace3D42f9c8723B108D4fBE29989060a91411"
  },
  [137]: { // polygon
    xslockerAddress: "0x501Ace47c5b0C2099C4464f681c3fa2ECD3146C1",
    stakingRewardsAddress: "0x501ace3D42f9c8723B108D4fBE29989060a91411"
  },
  [250]: { // fantom
    xslockerAddress: "0x501Ace47c5b0C2099C4464f681c3fa2ECD3146C1",
    stakingRewardsAddress: "0x501ace3D42f9c8723B108D4fBE29989060a91411"
  },
}

var initialized = false
async function prefetch() {
  if(initialized) return

  let [_, xsLockerAbi, stakingRewardsAbi] = await Promise.all([
    s3GetObjectPromise({Bucket:'stats.solace.fi.data',Key:'providers.json'}, cache=true),
    await s3GetObjectPromise({Bucket:'stats.solace.fi.data',Key:'abi/staking/xsLocker.json'}, cache=true),
    await s3GetObjectPromise({Bucket:'stats.solace.fi.data',Key:'abi/staking/StakingRewards.json'}, cache=true)
  ])

  let chainIDs = Object.keys(deployments).map(chainID=>chainID-0)
  let providers = await Promise.all(chainIDs.map(getProvider))
  for(var i = 0; i < chainIDs.length; ++i) {
    let chainID = chainIDs[i]
    deployments[chainID].provider = providers[i]
    deployments[chainID].xslocker = new ethers.Contract(deployments[chainID].xslockerAddress, xsLockerAbi, providers[i])
    deployments[chainID].stakingRewards = new ethers.Contract(deployments[chainID].stakingRewardsAddress, stakingRewardsAbi, providers[i])
  }
  initialized = true
}

async function handler() {
  var d = {}
  var chainIDs = Object.keys(deployments);
  var stakingPerChain = await Promise.all(chainIDs.map(trackStakingSingleChain))
  var gs = {
    solaceStaked: 0,
    valueStaked: 0,
    numLocks: 0,
    apr: 0, // individual lock apr may be up to 2.5x this
    rewardPerSecond: 0
  }
  for(var i = 0; i < chainIDs.length; ++i) {
    d[chainIDs[i]] = stakingPerChain[i]
    gs.solaceStaked += parseFloat(stakingPerChain[i].solaceStaked)
    gs.valueStaked += parseFloat(stakingPerChain[i].valueStaked)
    gs.numLocks += parseInt(stakingPerChain[i].numLocks)
    gs.apr += parseFloat(stakingPerChain[i].apr)
    gs.rewardPerSecond += parseFloat(stakingPerChain[i].rewardPerSecond)
  }
  gs.solaceStaked = gs.solaceStaked.toString()
  gs.valueStaked = gs.valueStaked.toString()
  gs.numLocks = gs.numLocks.toString()
  gs.apr = (gs.apr/chainIDs.length).toString()
  gs.rewardPerSecond = (gs.rewardPerSecond/chainIDs.length).toString()
  d['global'] = gs
  return d
}

async function trackStakingSingleChain(chainID) {
  var {provider, xslocker, stakingRewards} = deployments[chainID]

  var [xslocks, rewardPerSecond, valueStaked] = await Promise.all([
    getXsLocksOfChain(chainID),
    stakingRewards.rewardPerSecond(), // across all locks
    stakingRewards.valueStaked() // across all locks
  ])
  var totalSolaceStaked = BN.from(0)
  for(var xslock of xslocks) totalSolaceStaked = totalSolaceStaked.add(xslock.amount)

  const apr = totalSolaceStaked.gt(0)
    ? rewardPerSecond.mul(BN.from(31536000)).mul(BN.from(100)).div(totalSolaceStaked)
    : BN.from(0)

  return {
    solaceStaked: formatUnits(totalSolaceStaked, 18),
    valueStaked: formatUnits(valueStaked, 18),
    numLocks: xslocks.length.toString(),
    apr: apr.toString(), // individual lock apr may be up to 2.5x this
    rewardPerSecond: formatUnits(rewardPerSecond, 18)
  }
}

async function trackStaking() {
  return new Promise(async (resolve) => {
    console.log('start tracking staking')
    await prefetch()
    var staking = await handler()
    var res = JSON.stringify(staking)
    await Promise.all([
      s3PutObjectPromise({ Bucket: 'stats-cache.solace.fi', Key: 'staking.json', Body: res, ContentType: "application/json" })
    ])
    console.log('done tracking staking')
    resolve(staking)
  })
}
exports.trackStaking = trackStaking
/*
var staking
trackStaking().then(r=>{staking=r;console.log(r)}).catch(console.error)
prefetch().then(console.log).catch(console.error)
*/

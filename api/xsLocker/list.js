const { getProvider, getMulticallProvider, s3GetObjectPromise, snsPublishError, range, sortBNs } = require("./../utils/utils")
const ethers = require('ethers')
const BN = ethers.BigNumber
const formatUnits = ethers.utils.formatUnits
const multicall = require('ethers-multicall')

// Define headers
const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PUT,DELETE"
}

const CHAIN_IDS = [1,1313161554,137] // mainnet, aurora, polygon
const XSLOCKER_ADDRESS = "0x501Ace47c5b0C2099C4464f681c3fa2ECD3146C1"

async function getXsLocks(chainID) {
  let [mcProvider, xsLockerABI] = await Promise.all([
    getMulticallProvider(chainID),
    s3GetObjectPromise({Bucket:'stats.solace.fi.data',Key:'abi/staking/xsLocker.json'}, cache=true).then(JSON.parse)
  ])
  let provider = mcProvider._provider
  let blockTag = await provider.getBlockNumber()
  let xsLocker = new ethers.Contract(XSLOCKER_ADDRESS, xsLockerABI, provider)
  let xsLockerMC = new multicall.Contract(XSLOCKER_ADDRESS, xsLockerABI)
  let supply = (await xsLocker.totalSupply()).toNumber()
  let indices = range(0, supply)
  let xslockIDs = await mcProvider.all(indices.map(index => xsLockerMC.tokenByIndex(index)), {blockTag:blockTag})
  xslockIDs.sort(sortBNs)
  let xslocks = await mcProvider.all(xslockIDs.map(xslockID => xsLockerMC.locks(xslockID)), {blockTag:blockTag})
  xslocks = indices.map(i => {
    return {
      xsLockID: xslockIDs[i].toString(),
      amount: xslocks[i].amount.toString(),
      end: xslocks[i].end.toString()
    }
  })
  return xslocks
}

async function handle() {
  let chainResults = await Promise.all(CHAIN_IDS.map(getXsLocks))
  let res = {}
  for(var i = 0; i < CHAIN_IDS.length; ++i) {
    res[CHAIN_IDS[i]+""] = chainResults[i]
  }
  return JSON.stringify(res)
}

async function prefetch() {
  await s3GetObjectPromise({Bucket:'stats.solace.fi.data',Key:'abi/staking/xsLocker.json'}, cache=true)
}

// Lambda handler
exports.handler = async function(event) {
  try {
    await prefetch()
    let res = await handle()
    return {
      statusCode: 200,
      headers: headers,
      body: res
    }
  } catch (e) {
    switch(e.name) {
      case "InputError":
        return {
          statusCode: 400,
          headers: headers,
          body: e.stack
        }
        break
      default:
        await snsPublishError(event, e)
        return {
          statusCode: 500,
          headers: headers,
          body: "internal server error"
        }
    }
  }
}

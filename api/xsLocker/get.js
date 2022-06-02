const { getProvider, getMulticallProvider, s3GetObjectPromise, snsPublishError, range, sortBNs } = require("./../utils/utils")
const ethers = require('ethers')
const BN = ethers.BigNumber
const formatUnits = ethers.utils.formatUnits
const multicall = require('ethers-multicall')

const CHAIN_IDS = [1,1313161554,137,250] // ethereum, aurora, polygon, fantom
const XSLOCKER_ADDRESS = "0x501Ace47c5b0C2099C4464f681c3fa2ECD3146C1"

async function getXsLocksOfChain(chainID) {
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
  let [xslocks, owners] = await Promise.all([
    mcProvider.all(xslockIDs.map(xslockID => xsLockerMC.locks(xslockID)), {blockTag:blockTag}),
    mcProvider.all(xslockIDs.map(xslockID => xsLockerMC.ownerOf(xslockID)), {blockTag:blockTag})
  ])
  xslocks = indices.map(i => {
    return {
      xslockID: xslockIDs[i].toString(),
      owner: owners[i],
      amount: xslocks[i].amount.toString(),
      end: xslocks[i].end.toString()
    }
  })
  return xslocks
}
exports.getXsLocksOfChain = getXsLocksOfChain

async function getXsLocks() {
  return new Promise(async (resolve) => {
    // get locks as object
    let chainResults = await Promise.all(CHAIN_IDS.map(getXsLocksOfChain))
    let res = {}
    for(var i = 0; i < CHAIN_IDS.length; ++i) {
      res[CHAIN_IDS[i]+""] = chainResults[i]
    }
    resolve(res)
  })
}
exports.getXsLocks = getXsLocks

async function handle(event) {
  // Define headers
  let headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PUT,DELETE"
  }
  let obj = await getXsLocks()
  // default: return as json
  if(!event || !event["queryStringParameters"] || !event["queryStringParameters"]["format"] || event["queryStringParameters"]["format"] != "csv") {
    return [headers, JSON.stringify(obj)]
  }
  // optionally return as csv
  else {
    headers["Content-Type"] = "text/csv"
    return [headers, jsonToCsv(obj)]
  }
}

function jsonToCsv(obj) {
  let s = `chainID,xslockID,owner,amount,end\n`
  CHAIN_IDS.forEach(chainID => {
    obj[chainID].forEach(xslock => {
      s = `${s}${chainID},${xslock.xslockID},${xslock.owner},${formatUnits(xslock.amount,18)},${formatEnd(xslock.end)}\n`
    })
  })
  return s
}

function formatEnd(end) {
  let time = new Date(parseInt(end) * 1000)
  let y = `${time.getUTCFullYear()}`
  let m = `${time.getUTCMonth()+1}`
  if(m.length == 1) m = `0${m}`
  let d = `${time.getUTCDate()}`
  if(d.length == 1) d = `0${d}`
  let s = `${y}-${m}-${d}`
  return s
}

async function prefetch() {
  await s3GetObjectPromise({Bucket:'stats.solace.fi.data',Key:'abi/staking/xsLocker.json'}, cache=true)
}

// Lambda handler
exports.handler = async function(event) {
  try {
    await prefetch()
    let [headers, res] = await handle(event)
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

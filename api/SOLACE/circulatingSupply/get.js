const { getProvider, getMulticallProvider, s3GetObjectPromise, snsPublishError, multicallChunked } = require("./../../utils/utils")
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

const CHAIN_IDS = [1,1313161554,137,250] // ethereum, aurora, polygon, fantom
const ALL_CHAINS = ["sum","all","1","1313161554","137","250"]
const SOLACE_ADDRESS = "0x501acE9c35E60f03A2af4d484f49F9B1EFde9f40"
const ERC20ABI = [{"inputs":[],"name":"totalSupply","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"account","type":"address"}],"name":"balanceOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"}]

function verifyChainID(params) {
  if(!params) return "sum"
  var chainID = params["chainid"] || params["chainId"] || params["chainID"]
  if(!chainID) return "sum"
  chainID = chainID.toLowerCase()
  if(!ALL_CHAINS.includes(chainID)) throw { name: "InputError", stack: `chainID '${chainID}' not recognized`}
  return chainID
}

async function getCirculatingSupply(chainID) {
  var [skipAddresses, mcProvider] = await Promise.all([
    s3GetObjectPromise({Bucket: 'stats.solace.fi.data', Key: 'SOLACE/circulatingSupply/skip_addresses.json'}, cache=true).then(JSON.parse),
    getMulticallProvider(chainID)
  ])
  var solace = new multicall.Contract(SOLACE_ADDRESS, ERC20ABI)
  var err;
  for(var i = 0; i < 5; ++i) {
    try {
      var requests = []
      requests.push(solace.totalSupply())
      var skipAddresses2 = Object.keys(skipAddresses[chainID+""])
      skipAddresses2.forEach(addr => requests.push(solace.balanceOf(addr)));
      var results = await multicallChunked(mcProvider, requests, "latest", 200)
      var supply = results[0]
      for(var i = 1; i < results.length; ++i) {
        supply = supply.sub(results[i])
      }
      return supply
    } catch(e) {
      err = e
    }
  }
  throw err
}

async function handle(event) {
  var chainID = verifyChainID(event["queryStringParameters"])
  if(chainID == "sum" || chainID == "all") {
    var promises = CHAIN_IDS.map(getCirculatingSupply)
    var supplies = await Promise.all(promises)
    if(chainID == "sum") {
      var sum = BN.from(0)
      supplies.forEach(supply => sum = sum.add(supply))
      return formatUnits(sum, 18)
    } else {
      var res = {}
      for(var i = 0; i < CHAIN_IDS.length; ++i) {
        res[CHAIN_IDS[i]+""] = formatUnits(supplies[i], 18)
      }
      return JSON.stringify(res)
    }
  } else {
    var supply = await getCirculatingSupply(chainID-0)
    return formatUnits(supply, 18)
  }
}

async function prefetch() {
  await Promise.all([
    s3GetObjectPromise({Bucket: 'stats.solace.fi.data', Key: 'providers.json'}, cache=true),
    s3GetObjectPromise({Bucket: 'stats.solace.fi.data', Key: 'SOLACE/circulatingSupply/skip_addresses.json'}, cache=false)
  ])
}

// Lambda handler
exports.handler = async function(event) {
  try {
    await prefetch()
    var res = await handle(event)
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

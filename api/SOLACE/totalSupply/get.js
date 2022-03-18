const { getProvider, s3GetObjectPromise, snsPublishError } = require("./../../utils")
const ethers = require('ethers')
const BN = ethers.BigNumber
const formatUnits = ethers.utils.formatUnits

// Define headers
const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PUT,DELETE"
}

const CHAIN_IDS = [1,137,1313161554] // mainnet, polygon, aurora
const ALL_CHAINS = ["sum","all","1","137","1313161554"]
const SOLACE_ADDRESS = "0x501acE9c35E60f03A2af4d484f49F9B1EFde9f40"

function verifyChainID(params) {
  var chainID = params["chainid"] || params["chainId"] || params["chainID"]
  if(!chainID) throw { name: "InputError", message: "chainID not found"}
  chainID = chainID.toLowerCase()
  if(!ALL_CHAINS.includes(chainID)) throw { name: "InputError", message: `chainID '${chainID}' not recognized`}
  return chainID
}

async function getTotalSupply(chainID) {
  var [erc20Abi, provider] = await Promise.all([
    s3GetObjectPromise({Bucket: 'stats.solace.fi.data', Key: 'abi/other/ERC20.json'}, cache=true).then(JSON.parse),
    getProvider(chainID)
  ])
  var solace = new ethers.Contract(SOLACE_ADDRESS, erc20Abi, provider)
  let supply = await solace.totalSupply()
  return supply
}

async function handle(event) {
  var chainID = verifyChainID(event["queryStringParameters"])
  if(chainID == "sum" || chainID == "all") {
    var promises = CHAIN_IDS.map(getTotalSupply)
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
    var supply = await getTotalSupply(chainID)
    return formatUnits(supply, 18)
  }
}

async function prefetch() {
  await Promise.all([
    s3GetObjectPromise({Bucket: 'stats.solace.fi.data', Key: 'alchemy_key.txt'}, cache=true),
    s3GetObjectPromise({Bucket: 'stats.solace.fi.data', Key: 'abi/other/ERC20.json'}, cache=true)
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
          body: e.message
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

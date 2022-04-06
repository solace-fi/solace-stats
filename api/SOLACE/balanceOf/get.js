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
const ERC20ABI = [{"inputs":[],"name":"totalSupply","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"account","type":"address"}],"name":"balanceOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"}]

function verifyChainID(params) {
  if(!params) return "sum"
  var chainID = params["chainid"] || params["chainId"] || params["chainID"]
  if(!chainID) return "sum"
  chainID = chainID.toLowerCase()
  if(!ALL_CHAINS.includes(chainID)) throw { name: "InputError", stack: `chainID '${chainID}' not recognized`}
  return chainID
}

function verifyAccount(params) {
  if(!params) throw { name: "InputError", stack: 'account not given'}
  var account = params["account"]
  if(!account) throw { name: "InputError", stack: 'account not given'}
  if(!ethers.utils.isAddress(account)) throw { name: "InputError", stack: `'${account}' is not a valid account`}
  return account
}

async function getBalanceOf(chainID, account) {
  var [provider] = await Promise.all([
    getProvider(chainID)
  ])
  var solace = new ethers.Contract(SOLACE_ADDRESS, ERC20ABI, provider)
  var bal = await solace.balanceOf(account)
  return bal
}

async function handle(event) {
  var chainID = verifyChainID(event["queryStringParameters"])
  var account = verifyAccount(event["queryStringParameters"])
  if(chainID == "sum" || chainID == "all") {
    var promises = CHAIN_IDS.map(chain => getBalanceOf(chain, account))
    var balances = await Promise.all(promises)
    if(chainID == "sum") {
      var sum = BN.from(0)
      balances.forEach(bal => sum = sum.add(bal))
      return formatUnits(sum, 18)
    } else {
      var res = {}
      for(var i = 0; i < CHAIN_IDS.length; ++i) {
        res[CHAIN_IDS[i]+""] = formatUnits(balances[i], 18)
      }
      return JSON.stringify(res)
    }
  } else {
    var bal = await getBalanceOf(chainID-0, account)
    return formatUnits(bal, 18)
  }
}

// Lambda handler
exports.handler = async function(event) {
  try {
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

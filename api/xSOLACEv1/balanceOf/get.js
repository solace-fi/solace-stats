const { getProvider, s3GetObjectPromise, snsPublishError } = require("./../../utils/utils")
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

const XSOLACE_V1_ADDRESS = "0x501AcE5aC3Af20F49D53242B6D208f3B91cfc411"
const ERC20ABI = [{"inputs":[],"name":"totalSupply","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"account","type":"address"}],"name":"balanceOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"}]

function verifyAccount(params) {
  if(!params) throw { name: "InputError", stack: 'account not given'}
  var account = params["account"]
  if(!account) throw { name: "InputError", stack: 'account not given'}
  if(!ethers.utils.isAddress(account)) throw { name: "InputError", stack: `'${account}' is not a valid account`}
  return account
}

async function getBalanceOf(account) {
  var [provider] = await Promise.all([
    getProvider(1)
  ])
  var xsolacev1 = new ethers.Contract(XSOLACE_V1_ADDRESS, ERC20ABI, provider)
  var err;
  for(var i = 0; i < 5; ++i) {
    try {
      var bal = await xsolacev1.balanceOf(account)
      return bal
    } catch(e) {
      err = e
    }
  }
  throw err
}

async function handle(event) {
  var account = verifyAccount(event["queryStringParameters"])
  var bal = await getBalanceOf(account)
  return formatUnits(bal, 18)
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

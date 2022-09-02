const { getProvider, getMulticallProvider, s3GetObjectPromise, snsPublishError, findDeployBlock, withBackoffRetries, fetchEvents, formatUnitsFull, multicallChunked, range } = require("./../utils/utils")
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

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

const ERC20ABI = [{"inputs":[],"name":"totalSupply","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"account","type":"address"}],"name":"balanceOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"decimals","outputs":[{"internalType":"uint8","name":"","type":"uint8"}],"stateMutability":"view","type":"function"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"from","type":"address"},{"indexed":true,"internalType":"address","name":"to","type":"address"},{"indexed":false,"internalType":"uint256","name":"value","type":"uint256"}],"name":"Transfer","type":"event"}]

function verifyChainID(params) {
  if(!params) throw { name: "InputError", stack: 'chainID not given'}
  var chainID = params["chainid"] || params["chainId"] || params["chainID"]
  if(!chainID) throw { name: "InputError", stack: 'chainID not given'}
  return chainID
}

function verifyToken(params) {
  if(!params) throw { name: "InputError", stack: 'token not given'}
  var token = params["token"]
  if(!token) throw { name: "InputError", stack: 'token not given'}
  if(!ethers.utils.isAddress(token)) throw { name: "InputError", stack: `'${token}' is not a valid token`}
  return token
}

async function getHolders(chainID, token) {
  // step 0: setup
  var [provider, mcProvider] = await Promise.all([
    getProvider(chainID),
    getMulticallProvider(chainID)
  ])
  var contract = new ethers.Contract(token, ERC20ABI, provider)
  var mcContract = new multicall.Contract(token, ERC20ABI)
  // step 1: fetch vars
  var [decimals, deployBlock, blockNumber] = await Promise.all([
    contract.decimals(),
    findDeployBlock(provider, token),
    provider.getBlockNumber()
  ])
  // step 2: get transfer events since deployment
  var events = await fetchEvents(contract, "Transfer", deployBlock, blockNumber)
  // step 3: get holders from transfers
  var holderSet = new Set()
  events.forEach((event) => {
    if(event.args.from != ZERO_ADDRESS) holderSet.add(event.args.from)
    if(event.args.to != ZERO_ADDRESS) holderSet.add(event.args.to)
  })
  var holders = Array.from(holderSet)
  // step 4: get balances
  var balances = await multicallChunked(mcProvider, holders.map(holder => mcContract.balanceOf(holder)), "latest", 200)
  var holders2 = range(0, holders.length).map(i => { return {holder: holders[i], balance: formatUnitsFull(balances[i])} })
  // step 5: filter and sort
  holders2 = holders2.filter((a) => a.balance > 0)
  holders2 = holders2.sort((a,b) => b.balance - a.balance)
  // step 6: format and return
  var s = '[\n'
  for(var i = 0; i < holders2.length; ++i) {
    s = `${s}  \{"account": "${holders2[i].holder}", "balance": ${holders2[i].balance}\}${i < holders2.length-1 ? ',' : ''}\n`
  }
  s = `${s}]`
  return s
}

async function handle(event) {
  var chainID = verifyChainID(event["queryStringParameters"])
  var token = verifyToken(event["queryStringParameters"])
  var holders = await getHolders(chainID-0, token)
  return holders
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

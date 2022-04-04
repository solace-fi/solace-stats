const { getMulticallProvider, s3GetObjectPromise, snsPublishError } = require("./../utils")
const ethers = require('ethers')
const BN = ethers.BigNumber
const formatUnits = ethers.utils.formatUnits
//import { Contract, Provider } from 'ethers-multicall';
const multicall = require('ethers-multicall')

// Define headers
const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PUT,DELETE"
}

const CHAIN_IDS = [1,137,1313161554] // mainnet, polygon, aurora
const XSLOCKER_ADDRESS = "0x501Ace47c5b0C2099C4464f681c3fa2ECD3146C1"
const XSOLACE_ADDRESS = "0x501ACe802447B1Ed4Aae36EA830BFBde19afbbF9"
const ERC20ABI = [{"inputs":[],"name":"totalSupply","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"account","type":"address"}],"name":"balanceOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"}]
const ERC721ABI = [{"inputs":[{"internalType":"uint256","name":"tokenId","type":"uint256"}],"name":"ownerOf","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"index","type":"uint256"}],"name":"tokenByIndex","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"totalSupply","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"}]

function range(start, stop) {
  start = BN.from(start).toNumber()
  stop = BN.from(stop).toNumber()
  var arr = [];
  for(var i = start; i < stop; ++i) {
    arr.push(i);
  }
  return arr;
}

async function getVotePowers(chainID) {
  var mcProvider = await getMulticallProvider(chainID)
  var blockTag = await mcProvider._provider.getBlockNumber()
  var xslocker = new multicall.Contract(XSLOCKER_ADDRESS, ERC721ABI)
  var [supply] = await mcProvider.all([xslocker.totalSupply()], {blockTag:blockTag})
  var tokenIDs = await mcProvider.all(range(0, supply).map(index => xslocker.tokenByIndex(index)), {blockTag:blockTag})
  var owners = await mcProvider.all(tokenIDs.map(tokenID => xslocker.ownerOf(tokenID)), {blockTag:blockTag})
  owners = [... new Set(owners)]
  var xsolace = new multicall.Contract(XSOLACE_ADDRESS, ERC20ABI)
  var balances = await mcProvider.all(owners.map(account => xsolace.balanceOf(account)), {blockTag:blockTag})
  var votePowers = {}
  for(var i = 0; i < owners.length; ++i) {
    votePowers[owners[i]] = balances[i]
  }
  return votePowers
}

async function handle() {
  var votePowers = await Promise.all(CHAIN_IDS.map(getVotePowers))
  var votePowersAgg = {}
  for(var i = 0; i < votePowers.length; ++i) {
    var accounts = Object.keys(votePowers[i])
    for(var j = 0; j < accounts.length; ++j) {
      var acc = accounts[j]
      var vp = votePowersAgg[acc]
      var vp2 = votePowers[i][acc]
      votePowersAgg[acc] = (!vp) ? vp2 : vp.add(vp2)
    }
  }
  var accounts = Object.keys(votePowersAgg)
  var votePowersList = []
  for(var i = 0; i < accounts.length; ++i) {
    votePowersList.push({"account":accounts[i],"balance":votePowersAgg[accounts[i]]})
  }
  votePowersList.sort((a,b) => b.balance.sub(a.balance))
  return `{\n    ${votePowersList.map(vp => `"${vp.account}": ${formatUnits(vp.balance, 18)}`).join(',\n    ')}\n}`
}

// Lambda handler
exports.handler = async function(event) {
  try {
    var res = await handle()
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

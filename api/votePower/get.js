const { getMulticallProvider, s3GetObjectPromise, snsPublishError, multicallChunked, range } = require("./../utils/utils")
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

const CHAIN_IDS = [1,1313161554,137,250] // ethereum, aurora, polygon, fantom
const XSLOCKER_ADDRESS = "0x501Ace47c5b0C2099C4464f681c3fa2ECD3146C1"
const XSOLACE_ADDRESS = "0x501ACe802447B1Ed4Aae36EA830BFBde19afbbF9"
const ERC20ABI = [{"inputs":[],"name":"totalSupply","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"account","type":"address"}],"name":"balanceOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"}]
const ERC721ABI = [{"inputs":[{"internalType":"uint256","name":"tokenId","type":"uint256"}],"name":"ownerOf","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"index","type":"uint256"}],"name":"tokenByIndex","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"totalSupply","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"}]

async function getVotePowers(chainID) {
  var mcProvider = await getMulticallProvider(chainID)
  var blockTag = await mcProvider._provider.getBlockNumber()
  let xslocker = new ethers.Contract(XSLOCKER_ADDRESS, ERC721ABI, mcProvider._provider)
  var xslockerMC = new multicall.Contract(XSLOCKER_ADDRESS, ERC721ABI)
  var supply = await xslocker.totalSupply({blockTag:blockTag})
  var tokenIDs = await multicallChunked(mcProvider, range(0, supply).map(index => xslockerMC.tokenByIndex(index)), blockTag, 100)
  var owners = await multicallChunked(mcProvider, tokenIDs.map(tokenID => xslockerMC.ownerOf(tokenID)), blockTag, 100)
  owners = [... new Set(owners)]
  var xsolace = new multicall.Contract(XSOLACE_ADDRESS, ERC20ABI)
  var balances = await multicallChunked(mcProvider, owners.map(account => xsolace.balanceOf(account)), blockTag, 50)
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

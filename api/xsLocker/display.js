const { getProvider, getMulticallProvider, s3GetObjectPromise, snsPublishError, range, sortBNs } = require("./../utils/utils")
const ethers = require('ethers')
const BN = ethers.BigNumber
const formatUnits = ethers.utils.formatUnits
const multicall = require('ethers-multicall')

// Define headers
const headers = {
  "Content-Type": "text/html",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PUT,DELETE"
}

const CHAIN_IDS = [1,1313161554,137] // mainnet, aurora, polygon
const CHAIN_NAMES = [
  '<a href="https://etherscan.io/address/0x501Ace47c5b0C2099C4464f681c3fa2ECD3146C1"><h2>Ethereum</h2></a>',
  '<a href="https://aurorascan.dev/address/0x501Ace47c5b0C2099C4464f681c3fa2ECD3146C1"><h2>Aurora</h2></a>',
  '<a href="https://polygonscan.com/address/0x501Ace47c5b0C2099C4464f681c3fa2ECD3146C1"><h2>Polygon</h2></a>',
]
const XSLOCKER_ADDRESS = "0x501Ace47c5b0C2099C4464f681c3fa2ECD3146C1"

let sumAmountAllChains = BN.from(0)

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
  let s = '<pre>        id:       SOLACE | Expiration\n--------------------------------------\n'
  let xslocks = await mcProvider.all(xslockIDs.map(xslockID => xsLockerMC.locks(xslockID)), {blockTag:blockTag})
  let sumAmountChain = BN.from(0)
  indices.forEach(i => {
    sumAmountChain = sumAmountChain.add(xslocks[i].amount)
    sumAmountAllChains = sumAmountAllChains.add(xslocks[i].amount)
    s = `${s}${formatNumber(xslockIDs[i])}: ${formatAmount(xslocks[i].amount, 18)} | ${formatEnd(xslocks[i].end)}\n`
  })
  s = `${s}--------------------------------------\n     total: ${formatAmount(sumAmountChain, 18)}\n</pre>`
  return s
}

function formatNumber(n) {
  var s = n.toString();
  while(s.length < 10) s = ' ' + s;
  return s;
}

function formatAmount(amount, decimals) {
  var d = BN.from(1);
  for(var i = 0; i < decimals; ++i) d = d.mul(10);
  var s = amount.div(d).toNumber().toLocaleString();
  while(s.length < 12) s = ' ' + s;
  return s;
}

function formatEnd(end) {
  var d = Date.now();
  var e = BN.from(end).toNumber()*1000;
  if(d >= e) return "0";
  return (new Date(e).toDateString()).substring(4);
}

async function handle() {
  sumAmountAllChains = BN.from(0)
  let chainResults = await Promise.all(CHAIN_IDS.map(getXsLocks))
  s = `<html><h1>xSOLACE Locks</h1><br/><br/>`
  for(let i = 0; i < CHAIN_IDS.length; ++i) {
    s = `${s}${CHAIN_NAMES[i]}${chainResults[i]}<br/>`
  }
  s = `${s}<pre>all chains: ${formatAmount(sumAmountAllChains, 18)}\n</pre>`
  s = `${s}</html>`
  return s
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

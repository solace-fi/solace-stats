//const { getProvider, s3GetObjectPromise, s3PutObjectPromise, snsPublishError } = require("./api/utils")
const ethers = require('ethers')
const BN = ethers.BigNumber
const formatUnits = ethers.utils.formatUnits
//var exports = {}

const ETH_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"

// returns a promise that resolves after a specified wait time
async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
exports.delay = delay

// returns the result of a given function call
// gracefully handles request timeouts and retries
const MIN_RETRY_DELAY = 10000
const RETRY_BACKOFF_FACTOR = 2
const MAX_RETRY_DELAY = 100000
async function withBackoffRetries(f, retryCount = 7, jitter = 10000) {
  return new Promise(async (resolve, reject) => {
    //await delay(Math.floor(Math.random() * jitter))
    let nextWaitTime = MIN_RETRY_DELAY
    let i = 0
    while (true) {
      try {
        var res = await f()
        resolve(res)
        break
      } catch (error) {
        i++
        if(!error.toString().toLowerCase().includes("timeout")) {
          reject(error)
          break
        }
        if (i >= retryCount) {
          console.log('timeout. over max retries')
          reject(error)
          break
        }
        console.log('timeout. retrying')
        await delay(nextWaitTime + Math.floor(Math.random() * jitter))
        nextWaitTime = Math.min(MAX_RETRY_DELAY, RETRY_BACKOFF_FACTOR * nextWaitTime)
      }
    }
  })
}
exports.withBackoffRetries = withBackoffRetries

// formats a unix timestamp (in seconds) to UTC string representation
// mm:dd:yyyy hh:mm:ss
function formatTimestamp(timestamp) {
  var d = new Date(timestamp * 1000)
  return `${d.getUTCMonth()+1}/${d.getUTCDate()}/${d.getUTCFullYear()} ${d.getUTCHours()}:${d.getUTCMinutes()}:${d.getUTCSeconds()}`
}
exports.formatTimestamp = formatTimestamp

// fetch a block
async function fetchBlock(provider, blockTag) {
  return new Promise((resolve, reject) => {
    withBackoffRetries(() => provider.getBlock(blockTag)).then(resolve)
  })
}
exports.fetchBlock = fetchBlock

// returns the balance of a holder for a list of tokens
// result is an array
// each element will be a decimal formatted string eg [ "1.2" ]
async function fetchBalances(tokenList, holder, blockTag) {
  function createBalancePromise(i) {
    return new Promise((resolve, reject) => {
      withBackoffRetries(() => ((tokenList[i].address == ETH_ADDRESS)
        ? provider.getBalance(holder, blockTag=blockTag)
        : tokenList[i].contract.balanceOf(holder, {blockTag:blockTag})
      )).then(bal => { resolve(formatUnits(bal, tokenList[i].decimals)) }).catch(() => { resolve("0.0") })
    })
  }
  var promises = []
  for(var i = 0; i < tokenList.length; ++i) {
    promises.push(createBalancePromise(i))
  }
  return Promise.all(promises)
}
exports.fetchBalances = fetchBalances

// fetch the total supply of a token
// if the token does not exist returns 0
async function fetchSupplyOrZero(token, blockTag) {
  return new Promise((resolve, reject) => {
    withBackoffRetries(() => token.totalSupply({blockTag:blockTag})).then(resolve).catch(()=>{resolve(BN.from(0))})
  })
}
exports.fetchSupplyOrZero = fetchSupplyOrZero

// fetch the token balance of a holder
// if the token does not exist returns 0
async function fetchBalanceOrZero(token, holder, blockTag) {
  return new Promise((resolve, reject) => {
    withBackoffRetries(() => token.balanceOf(holder, {blockTag:blockTag})).then(resolve).catch(()=>{resolve(BN.from(0))})
  })
}
exports.fetchBalanceOrZero = fetchBalanceOrZero

// fetch the price per share of solace capital provider token
// if the token does not exist returns 0
async function fetchScpPpsOrZero(scp, blockTag) {
  return new Promise((resolve, reject) => {
    withBackoffRetries(() => scp.pricePerShare({blockTag:blockTag})).then(resolve).catch(()=>{resolve(BN.from(0))})
  })
}
exports.fetchScpPpsOrZero = fetchScpPpsOrZero

// fetch the reserves of a uniswap v2 pair (and forks)
// if the pool does not exist returns 0
async function fetchReservesOrZero(pair, blockTag) {
  return new Promise((resolve, reject) => {
    withBackoffRetries(() => pair.getReserves({blockTag:blockTag})).then(resolve).catch(()=>{resolve({_reserve0:BN.from(0),_reserve1:BN.from(0)})})
  })
}
exports.fetchReservesOrZero = fetchReservesOrZero

// fetch the price of a token in a uniswap v3 pool
async function fetchUniswapV2PriceOrZero(pair, oneZero, decimals0, decimals1, blockTag) {
  return new Promise((resolve, reject) => {
    withBackoffRetries(() => pair.getReserves({blockTag:blockTag})).then(reserves => {
      if(reserves._reserve0.eq(0) || reserves._reserve1.eq(0)) resolve(0.0)
      else {
        var amt0 = (formatUnits(reserves._reserve0, decimals0) - 0)
        var amt1 = (formatUnits(reserves._reserve1, decimals1) - 0)
        // oneZero == true -> price of token 1 in terms of token 0
        var price = oneZero ? amt0/amt1 : amt1/amt0
        resolve(price)
      }
    }).catch(()=>{resolve(0.0)})
  })
}
exports.fetchUniswapV2PriceOrZero = fetchUniswapV2PriceOrZero

const ONE_ETHER = BN.from("1000000000000000000")
const x192 = BN.from("0x01000000000000000000000000000000000000000000000000")
// fetch the price of a token in a uniswap v3 pool
async function fetchUniswapV3PriceOrZero(pool, oneZero, decimals0, decimals1, blockTag) {
  return new Promise((resolve, reject) => {
    withBackoffRetries(() => pool.slot0({blockTag:blockTag})).then(slot0 => {
      var price = formatUnits(
        slot0.sqrtPriceX96.mul(slot0.sqrtPriceX96)
        .mul(ONE_ETHER)
        .mul(decimalsToAmount(decimals0))
        .div(decimalsToAmount(decimals1))
        .div(x192),
      18) - 0
      // oneZero == true -> price of token 1 in terms of token 0
      if(price != 0.0 && !oneZero) price = 1/price
      resolve(price)
    }).catch(()=>{resolve(0.0)})
  })
}
exports.fetchUniswapV3PriceOrZero = fetchUniswapV3PriceOrZero

function decimalsToAmount(decimals) {
  decimals = BN.from(decimals).toNumber()
  var s = '1'
  for(var i = 0; i < decimals; ++i) s += '0'
  return BN.from(s)
}

// Load the AWS SDK for Node.js
const AWS = require('aws-sdk')
// Set region
AWS.config.update({region: 'us-west-2'})
// Create S3 service
const S3 = new AWS.S3({apiVersion: '2006-03-01'})
exports.AWS = AWS
exports.S3 = S3

const ethers = require('ethers')
const BN = ethers.BigNumber
const multicall = require('ethers-multicall')

var s3_cache = {}

// retrieves an object from S3 with optional caching
// returns a promise representing the request
async function s3GetObjectPromise(params, cache=false) {
  return new Promise((resolve,reject) => {
    try {
      if(cache &&
        Object.keys(s3_cache).includes(params["Bucket"]) &&
        Object.keys(s3_cache[params["Bucket"]]).includes(params["Key"])
      ) resolve(s3_cache[params["Bucket"]][params["Key"]])
      S3.getObject(params, (err,data) => {
        if(err) {
          err.stack = `Could not S3 get ${JSON.stringify(params)}\n${err.stack}`
          reject(err)
        } else {
          var res = data['Body'].toString()
          if(!Object.keys(s3_cache).includes(params["Bucket"])) s3_cache[params["Bucket"]] = {}
          s3_cache[params["Bucket"]][params["Key"]] = res
          resolve(res)
        }
      })
    } catch(err) {
      err.stack = `Could not S3 get ${JSON.stringify(params)}\n${err.stack}`
      reject(err)
    }
  })
}
exports.s3GetObjectPromise = s3GetObjectPromise

// puts an object into S3
// returns a promise representing the request
async function s3PutObjectPromise(params) {
  return new Promise((resolve,reject) => {
    try {
      S3.putObject(params, (err,data) => {
        if(err) {
          var params2 = { Bucket: params.Bucket, Key: params.Key }
          err.stack = `Could not S3 put ${JSON.stringify(params2)}\n${err.stack}`
          reject(err)
        } else resolve(data)
      })
    } catch(e) {
      var params2 = { Bucket: params.Bucket, Key: params.Key }
      err.stack = `Could not S3 put ${JSON.stringify(params2)}\n${err.stack}`
      reject(err)
    }
  })
}
exports.s3PutObjectPromise = s3PutObjectPromise

// publishes a message to SNS
// returns a promise representing the request
async function snsPublishMessage(msg) {
  var params = {
    Message: msg,
    TopicArn: "arn:aws:sns:us-west-2:151427405638:DeadLetterSnsTopic"
  }
  return new AWS.SNS({apiVersion: '2010-03-31'}).publish(params).promise()
}
exports.snsPublishMessage = snsPublishMessage

// formats an error message then publishes it to SNS
// returns a promise representing the request
async function snsPublishError(event, err) {
  var msg = `The following error occurred in the solace-stats api\n${event["headers"]["X-Forwarded-Proto"]}://${event["headers"]["Host"]}${event["path"]} params=${JSON.stringify(event["queryStringParameters"])} :\n${err.stack || err.toString()}`
  return snsPublishMessage(msg)
}
exports.snsPublishError = snsPublishError

// gets an ethers provider for a given chainID
async function getProvider(chainID) {
  const ALCHEMY_CHAINS = [1,4,5,42,137,80001]
  var chainNum = chainID - 0
  if(ALCHEMY_CHAINS.includes(chainNum)) {
    var alchemyKey = (await s3GetObjectPromise({
      Bucket: 'stats.solace.fi.data',
      Key: 'alchemy_key.txt'
    }, cache=true)).trim()
    return new ethers.providers.AlchemyProvider(chainNum, alchemyKey)
  } else if(chainNum == 1313161554) {
    return new ethers.providers.JsonRpcProvider("https://mainnet.aurora.dev")
  } else if(chainNum == 1313161555) {
    return new ethers.providers.JsonRpcProvider("https://testnet.aurora.dev")
  } else throw { name: 'UnknownError', stack: `Could not create an ethers provider for chainID '${chainNum}'`}
}
exports.getProvider = getProvider

// gets a multicall provider for a given chainID
async function getMulticallProvider(chainID) {
  const prov = await getProvider(chainID)
  var mcProvider = new multicall.Provider(prov)
  await mcProvider.init()
  var chainNum = chainID - 0
  if(chainNum == 1313161554) mcProvider._multicallAddress = "0xdc1522872E440cF9cD48E237EAFEfaa5F157Ca1d"
  if(chainNum == 1313161555) mcProvider._multicallAddress = "0x8f81207F59A4f86d68608fF90b259A0927242967"
  return mcProvider
}
exports.getMulticallProvider = getMulticallProvider

// Load the AWS SDK for Node.js
const AWS = require('aws-sdk')
// Set region
AWS.config.update({region: 'us-west-2'})
// Create S3 service
const S3 = new AWS.S3({apiVersion: '2006-03-01'})

const ethers = require('ethers')
const BN = ethers.BigNumber

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
        if(err) reject('\ns3GetObjectPromise\n'+err.toString())
        else {
          var res = data['Body'].toString()
          if(!Object.keys(s3_cache).includes(params["Bucket"])) s3_cache[params["Bucket"]] = {}
          s3_cache[params["Bucket"]][params["Key"]] = res
          resolve(res)
        }
      })
    } catch(e) {
      reject('\ns3GetObjectPromise\n'+e.stack)
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
        if(err) reject('\ns3PutObjectPromise\n'+err.toString())
        else resolve(data)
      })
    } catch(e) {
      reject('\ns3PutObjectPromise\n'+err.toString())
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
  var msg = `The following error occurred in ${event["headers"]["X-Forwarded-Proto"]}://${event["headers"]["Host"]}${event["path"]} params=${JSON.stringify(event["queryStringParameters"])} :\n${err.stack}`
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
  } else throw { name: 'UnknownError', message: `Could not create an ethers provider for chainID '${chainNum}'`}
}
exports.getProvider = getProvider

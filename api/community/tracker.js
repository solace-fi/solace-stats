// tracks markets in all networks over time

const { s3GetObjectPromise, s3PutObjectPromise, snsPublishError, withBackoffRetries, formatTimestamp, delay } = require("./../utils/utils")
const axios = require('axios')
const Discord = require('discord.js');

var initialized = false
var config

async function fetchCsv() {
  // from scratch
  let csv = "timestamp,timestring,twitter followers, discord followers\n"
  // checkpoint
  await (s3GetObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'output/community/followers.csv'}, cache=false).then(res => {
    csv = res
  }).catch(()=>{}))
  return csv
}

async function track_twitter() {
  let url = `https://api.twitter.com/2/users/${config.twitter.userID}?user.fields=public_metrics`
  let params = {headers: {Authorization: config.twitter.bearerToken}}
  let res = await axios.get(url, params)
  return res.data.data.public_metrics.followers_count
}

async function track_discord() {
  let client = new Discord.Client();
  await client.login(config.discord.token)
  let guild = await client.guilds.fetch(config.discord.guildID)
  for(let i = 0; i < 50 && !guild.available; ++i) { await delay(500) } // may take time to fetch data
  return guild.memberCount
}

async function prefetch() {
  if(initialized) return
  let res = await s3GetObjectPromise({Bucket: 'stats.solace.fi.data', Key: 'community/config.json'}, cache=true)
  config = JSON.parse(res)
  initialized = true
}

async function track_community() {
  return new Promise(async (resolve) => {
    console.log('start tracking community')
    await prefetch()
    let timestamp = Math.floor(Date.now()/1000)
    let timestring = formatTimestamp(timestamp)
    let [csv, twitterFollowers, discordFollowers] = await Promise.all([
      fetchCsv(),
      track_twitter(),
      track_discord()
    ])
    let res = `${csv}${timestamp},${timestring},${twitterFollowers},${discordFollowers}\n`
    await Promise.all([
      s3PutObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'output/community/followers.csv', Body: res, ContentType: "text/csv" }),
      s3PutObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'public/community/followers.csv', Body: res, ContentType: "text/csv" })
    ])
    console.log('done tracking community')
    resolve(res)
  })
}
exports.track_community = track_community

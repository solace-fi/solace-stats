// tracks markets in all networks over time

const { s3GetObjectPromise, s3PutObjectPromise, snsPublishError, withBackoffRetries, formatTimestamp, delay } = require("./../utils/utils")
const axios = require('axios')
const Discord = require('discord.js');

var initialized = false
var config

async function fetchHistory() {
  // from scratch
  let arr = []
  // checkpoint
  await (s3GetObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'output/community/followers.json'}, cache=false).then(res => {
    arr = JSON.parse(res)
  }).catch(()=>{}))
  return arr
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
    let [history, twitterFollowers, discordFollowers] = await Promise.all([
      fetchHistory(),
      track_twitter(),
      track_discord()
    ])
    history.push({
      timestamp: timestamp,
      timestring: timestring,
      Twitter: twitterFollowers,
      Discord: discordFollowers
    })
    history = JSON.stringify(history)
    await Promise.all([
      s3PutObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'output/community/followers.json', Body: history, ContentType: "application/json" }),
      s3PutObjectPromise({ Bucket: 'stats.solace.fi.data', Key: 'public/community/followers.json', Body: history, ContentType: "application/json" })
    ])
    console.log('done tracking community')
    resolve(history)
  })
}
exports.track_community = track_community

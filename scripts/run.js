import fs from "node:fs/promises";
import fetch from "node-fetch";

// Use Twitter API v2 endpoint
const API = "https://api.twitter.com/2";

const {
  X_BEARER,
  ACTOR_USER_ID,
  TARGET_USERNAME = "SpoilSarahXO",
  RTLIST_PATH = "RTLIST",
  TAGLIST_PATH = "TAGLIST",
} = process.env;

if (!X_BEARER) { console.error("Missing X_BEARER"); process.exit(1); }
if (!ACTOR_USER_ID) { console.error("Missing ACTOR_USER_ID"); process.exit(1); }

const headers = {
  Authorization: `Bearer ${X_BEARER}`,
  "Content-Type": "application/json"
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function xGet(path) {
  const r = await fetch(`${API}${path}`, { headers });
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}

async function xPost(path, body) {
  const r = await fetch(`${API}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`POST ${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}

async function readLines(file) {
  try {
    const txt = await fs.readFile(file, "utf8");
    return txt.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function fill(s, ctx) {
  return s.replaceAll("{handle}", ctx.handle).replaceAll("{url}", ctx.url);
}

function isoNow() {
  return new Date().toISOString();
}

async function resolveUserId(username) {
  const data = await xGet(`/users/by/username/${encodeURIComponent(username)}?user.fields=id,username`);
  return data?.data?.id;
}

async function latestOriginalTweets(userId, max = 1) {
  const qs = new URLSearchParams({
    "exclude": "retweets,replies",
    "max_results": "5",
    "tweet.fields": "created_at"
  });
  const data = await xGet(`/users/${userId}/tweets?${qs.toString()}`);
  return data?.data ?? [];
}

function minutesSince(iso) {
  const t = new Date(iso).getTime();
  const d = Date.now() - t;
  return d / 60000;
}

async function retweet(actorUserId, tweetId) {
  try {
    await xPost(`/users/${actorUserId}/retweets`, { tweet_id: tweetId });
    return true;
  } catch (e) {
    const msg = String(e);
    if (msg.includes("403")) return false; // already retweeted or forbidden
    if (msg.includes("429")) { console.error("Rate limited"); return false; }
    throw e;
  }
}

async function reply(text, inReplyToId) {
  return xPost(`/tweets`, { text, reply: { in_reply_to_tweet_id: inReplyToId } });
}

async function main() {
  console.log(`[${isoNow()}] Start`);

  const targetId = await resolveUserId(TARGET_USERNAME);
  if (!targetId) { console.error(`User not found: ${TARGET_USERNAME}`); process.exit(1); }

  const [rtList, tagList] = await Promise.all([readLines(RTLIST_PATH), readLines(TAGLIST_PATH)]);
  if (!rtList.length) { console.error("RTLIST is empty"); process.exit(1); }
  if (!tagList.length) { console.error("TAGLIST is empty"); process.exit(1); }

  const tweets = await latestOriginalTweets(targetId, 1);
  if (!tweets.length) { console.log("No tweets found"); return; }

  const t = tweets[0];
  const ageMin = minutesSince(t.created_at);

  // Only act on fresh tweets (<= 6 minutes old) to avoid duplicates on cron runs
  if (ageMin > 6) {
    console.log(`Latest tweet ${t.id} is ${ageMin.toFixed(1)} min old. Skipping.`);
    return;
  }

  const url = `https://twitter.com/${TARGET_USERNAME}/status/${t.id}`;

  // 1) Retweet
  await retweet(ACTOR_USER_ID, t.id);
  console.log(`Retweeted ${t.id}`);

  // 2) Two replies with small delay
  const c1 = fill(pickRandom(rtList), { handle: TARGET_USERNAME, url });
  await sleep(1500);
  await reply(c1, t.id);
  console.log("Reply 1 posted");

  const c2 = fill(pickRandom(tagList), { handle: TARGET_USERNAME, url });
  await sleep(1500);
  await reply(c2, t.id);
  console.log("Reply 2 posted");

  console.log("Done");
}

main().catch(e => { console.error(e); process.exit(1); });

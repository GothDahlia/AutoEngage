// scripts/run.js
import fs from "node:fs/promises";
import path from "node:path";
import fetch from "node-fetch";
import crypto from "node:crypto";

const API = "https://api.twitter.com/2";

const {
  X_CONSUMER_KEY,
  X_CONSUMER_SECRET,
  X_ACCESS_TOKEN,
  X_ACCESS_TOKEN_SECRET,
  ACTOR_USER_ID,
  TARGET_USERNAME = "SpoilSarahXO",
  RTLIST_PATH = "RTLIST",
  TAGLIST_PATH = "TAGLIST",
} = process.env;

for (const k of ["X_CONSUMER_KEY","X_CONSUMER_SECRET","X_ACCESS_TOKEN","X_ACCESS_TOKEN_SECRET","ACTOR_USER_ID"]) {
  if (!process.env[k]) { console.error(`Missing ${k}`); process.exit(1); }
}

const enc = (v) => encodeURIComponent(v).replace(/[!*()']/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function oauthHeader(method, url, queryParams = {}) {
  const oauth = {
    oauth_consumer_key: X_CONSUMER_KEY,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now()/1000).toString(),
    oauth_token: X_ACCESS_TOKEN,
    oauth_version: "1.0",
  };
  const all = { ...queryParams, ...oauth };
  const paramStr = Object.keys(all).sort().map(k => `${enc(k)}=${enc(all[k])}`).join("&");
  const baseStr = [method.toUpperCase(), enc(url.split("?")[0]), enc(paramStr)].join("&");
  const signingKey = `${enc(X_CONSUMER_SECRET)}&${enc(X_ACCESS_TOKEN_SECRET)}`;
  const signature = crypto.createHmac("sha1", signingKey).update(baseStr).digest("base64");
  const hdr = "OAuth " + Object.keys({ ...oauth, oauth_signature: signature }).sort()
    .map(k => `${enc(k)}="${enc(k === "oauth_signature" ? signature : oauth[k])}"`).join(", ");
  return hdr;
}

function buildUrl(pathname, params) {
  const qs = new URLSearchParams(params || {});
  return `${API}${pathname}${qs.toString() ? `?${qs}` : ""}`;
}

async function xGet(pathname, params = {}) {
  const url = buildUrl(pathname, params);
  const r = await fetch(url, { headers: { Authorization: oauthHeader("GET", url, params) } });
  if (!r.ok) throw new Error(`GET ${pathname} -> ${r.status} ${await r.text()}`);
  return r.json();
}

async function xPost(pathname, bodyObj = {}, params = {}) {
  const url = buildUrl(pathname, params);
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: oauthHeader("POST", url, params), "Content-Type": "application/json" },
    body: JSON.stringify(bodyObj)
  });
  if (!r.ok) throw new Error(`POST ${pathname} -> ${r.status} ${await r.text()}`);
  return r.json();
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function readLines(file) { try { const t = await fs.readFile(file, "utf8"); return t.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);} catch {return [];} }
function pickRandom(list){return list[Math.floor(Math.random()*list.length)];}
function fill(s, ctx){return s.replaceAll("{handle}", ctx.handle).replaceAll("{url}", ctx.url);}

const stateDir = ".state";
const stateFile = path.join(stateDir, `last_id_${TARGET_USERNAME}.txt`);
async function readSinceId(){ try{ return (await fs.readFile(stateFile,"utf8")).trim(); } catch{ return ""; } }
async function writeSinceId(id){ await fs.mkdir(stateDir,{recursive:true}); await fs.writeFile(stateFile, String(id)); }

async function resolveUserId(username){
  const d = await xGet(`/users/by/username/${encodeURIComponent(username)}`, { "user.fields":"id,username" });
  return d?.data?.id;
}

async function fetchNewestSince(userId, sinceId){
  const params = {
    exclude: "retweets,replies",
    "max_results": "1",
    "tweet.fields": "created_at"
  };
  if (sinceId) params.since_id = sinceId;
  const d = await xGet(`/users/${userId}/tweets`, params);
  return d?.data ?? [];
}

async function retweet(actorUserId, tweetId){
  try{ await xPost(`/users/${actorUserId}/retweets`, { tweet_id: tweetId }); return true; }
  catch(e){ const s=String(e); if(s.includes("403")||s.includes("429")) return false; throw e; }
}

async function reply(text, inReplyToId){
  return xPost(`/tweets`, { text, reply:{ in_reply_to_tweet_id: inReplyToId } });
}

async function main(){
  console.log(`[${new Date().toISOString()}] Start`);
  const targetId = await resolveUserId(TARGET_USERNAME);
  if (!targetId){ console.error("Target not found"); process.exit(1); }

  const [rtList, tagList] = await Promise.all([readLines(RTLIST_PATH), readLines(TAGLIST_PATH)]);
  if (!rtList.length || !tagList.length){ console.error("RTLIST or TAGLIST empty"); process.exit(1); }

  const prev = await readSinceId();
  const tweets = await fetchNewestSince(targetId, prev);

  if (!tweets.length){
    console.log(prev ? "No new tweets since_id" : "No tweets");
    return;
  }

  // genau 1 Eintrag wegen max_results=1
  const t = tweets[0];
  await writeSinceId(t.id);

  const url = `https://twitter.com/${TARGET_USERNAME}/status/${t.id}`;

  await retweet(ACTOR_USER_ID, t.id);
  console.log(`Retweeted ${t.id}`);

  const c1 = fill(pickRandom(rtList), { handle: TARGET_USERNAME, url });
  await sleep(1200);
  await reply(c1, t.id);
  console.log("Reply 1 posted");

  const c2 = fill(pickRandom(tagList), { handle: TARGET_USERNAME, url });
  await sleep(1200);
  await reply(c2, t.id);
  console.log("Reply 2 posted");
}

main().catch(e => { console.error(e); process.exit(1); });

import { google } from "googleapis";
import OAuth2 from "google-auth-library";
import fetch from "node-fetch";

const pat = /(https?:\/\/(?:x\.com|twitter\.com)\/[A-Za-z0-9_]+\/status\/(\d+))/g;

async function gmailList(auth, q) {
  const gmail = google.gmail({ version: "v1", auth });
  const res = await gmail.users.messages.list({ userId: "me", q });
  return res.data.messages || [];
}

async function gmailGet(auth, id) {
  const gmail = google.gmail({ version: "v1", auth });
  const res = await gmail.users.messages.get({ userId: "me", id, format: "full" });
  const parts = res.data.payload.parts || [];
  let body = "";
  for (const p of parts) {
    if (p.body?.data) body += Buffer.from(p.body.data, "base64").toString("utf8");
  }
  const snippet = res.data.snippet || "";
  return body + "\n" + snippet;
}

async function tweepyCompat(endpoint, payload) {
  const r = await fetch(`https://api.twitter.com/2${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.X_BEARER}`
    },
    body: JSON.stringify(payload)
  });
  return r.json();
}

async function retweet(userId, tweetId) {
  return tweepyCompat(`/users/${userId}/retweets`, { tweet_id: tweetId });
}

async function reply(text, inReplyTo) {
  return tweepyCompat(`/tweets`, { text, reply: { in_reply_to_tweet_id: String(inReplyTo) } });
}

export default async function handler(req, res) {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  const { OAuth2Client } = OAuth2;
  const oAuth2Client = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  oAuth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  const msgs = await gmailList(oAuth2Client, process.env.GMAIL_QUERY || "newer_than:2m");
  const seen = new Set();
  let actions = 0;

  for (const m of msgs) {
    if (seen.has(m.id)) continue;
    const raw = await gmailGet(oAuth2Client, m.id);
    const ids = new Set();
    for (const match of raw.matchAll(pat)) ids.add(match[2]);
    for (const tid of ids) {
      await retweet(process.env.SECONDARY_USER_ID, tid);
      await reply(process.env.HASH_LIST || "#A #B", tid);
      await reply(process.env.AT_LIST || "@x @y", tid);
      actions++;
    }
    seen.add(m.id);
  }
  res.status(200).json({ processed: msgs.length, actions });
}

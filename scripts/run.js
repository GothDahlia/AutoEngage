import { google } from "googleapis";
import fetch from "node-fetch";

const pat=/(https?:\/\/(?:x\.com|twitter\.com)\/[A-Za-z0-9_]+\/status\/(\d+))/g;

async function gmailList(auth,q){
  const gmail=google.gmail({version:"v1",auth});
  const r=await gmail.users.messages.list({userId:"me",q});
  return r.data.messages||[];
}
async function gmailGet(auth,id){
  const gmail=google.gmail({version:"v1",auth});
  const r=await gmail.users.messages.get({userId:"me",id,format:"full"});
  const parts=r.data.payload.parts||[];
  let body="";
  for(const p of parts){ if(p.body?.data) body+=Buffer.from(p.body.data,"base64").toString("utf8"); }
  return body+"\n"+(r.data.snippet||"");
}
async function xPost(endpoint,payload){
  const r=await fetch(`https://api.twitter.com/2${endpoint}`,{
    method:"POST",
    headers:{ "Content-Type":"application/json", "Authorization":`Bearer ${process.env.X_BEARER}` },
    body:JSON.stringify(payload)
  });
  if(!r.ok) throw new Error(await r.text());
  return r.json();
}
async function retweet(uid,tid){ return xPost(`/users/${uid}/retweets`,{tweet_id:tid}); }
async function reply(text,tid){ return xPost(`/tweets`,{text,reply:{in_reply_to_tweet_id:String(tid)}}); }

async function main(){
  const oAuth2Client=new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID,process.env.GOOGLE_CLIENT_SECRET);
  oAuth2Client.setCredentials({refresh_token:process.env.GOOGLE_REFRESH_TOKEN});
  const msgs=await gmailList(oAuth2Client,process.env.GMAIL_QUERY||"newer_than:5m");
  for(const m of msgs){
    const raw=await gmailGet(oAuth2Client,m.id);
    const ids=new Set(); for(const mt of raw.matchAll(pat)) ids.add(mt[2]);
    for(const tid of ids){
      await retweet(process.env.SECONDARY_USER_ID,tid);
      if(process.env.HASH_LIST) await reply(process.env.HASH_LIST,tid);
      if(process.env.AT_LIST) await reply(process.env.AT_LIST,tid);
    }
  }
}
main().catch(e=>{ console.error(e); process.exit(1); });

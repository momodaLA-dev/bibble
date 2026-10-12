import { initializeApp,getApps,getApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { initializeAppCheck,ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js";
import { getDatabase,ref,set,update,onValue,get } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";
import * as configMod from "./firebase-config.js";
import { UNDERCOVER_PAIRS } from "./undercover-data.js";

const app=getApps().length?getApp():initializeApp(configMod.firebaseConfig);
if(configMod.appCheckSiteKey)initializeAppCheck(app,{provider:new ReCaptchaEnterpriseProvider(configMod.appCheckSiteKey),isTokenAutoRefreshEnabled:true});
const db=getDatabase(app),$=s=>document.querySelector(s);
const roomId=new URLSearchParams(location.search).get("room")||Array.from({length:5},()=>"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random()*32)]).join("");
const base=`undercoverRooms/${roomId}`;let players={},meta={},votes={};
if(!new URLSearchParams(location.search).get("room"))history.replaceState({},"",`undercover.html?room=${roomId}`);
$("#ucRoomCode").textContent=roomId;
const mobileUrl=`${location.origin}${location.pathname.replace(/undercover\.html$/,"undercover-mobile.html")}?room=${roomId}`;
$("#ucJoinUrl").textContent=mobileUrl;
new QRCode($("#ucQr"),{text:mobileUrl,width:210,height:210});

const ms=await get(ref(db,`${base}/meta`));
if(!ms.exists())await set(ref(db,`${base}/meta`),{status:"waiting",createdAt:Date.now()});
else await update(ref(db,`${base}/meta`),{status:"waiting"});

onValue(ref(db,`${base}/players`),s=>{players=s.val()||{};renderLobby();renderOrder();renderVotes();});
onValue(ref(db,`${base}/votes`),s=>{votes=s.val()||{};renderVotes();});
onValue(ref(db,`${base}/meta`),s=>{meta=s.val()||{};renderState();});

function show(id){["ucLobby","ucDescribe","ucVoting","ucResult"].forEach(x=>$("#"+x).classList.toggle("hidden",x!==id));}
function esc(v){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function playerEntries(){return Object.entries(players).sort((a,b)=>(a[1].joinedAt||0)-(b[1].joinedAt||0));}
function renderLobby(){
  const arr=playerEntries();$("#ucPlayerCount").textContent=`${arr.length} 人`;
  $("#ucLobbyPlayers").innerHTML=arr.map(([,p])=>`<span class="pill">👤 ${esc(p.name||"玩家")}</span>`).join("");
}
function renderState(){
  if(meta.status==="waiting"){show("ucLobby");return;}
  if(meta.status==="describe"){show("ucDescribe");$("#ucCategoryLabel").textContent=`題目類別：${meta.category||"聖經"}`;renderOrder();return;}
  if(meta.status==="voting"){show("ucVoting");renderVotes();return;}
  if(meta.status==="result"){show("ucResult");renderResult();return;}
}
async function start(){
  const entries=playerEntries();if(entries.length<3){alert("至少需要 3 位玩家。");return;}
  const cat=$("#ucCategory").value;
  const pool=cat==="all"?UNDERCOVER_PAIRS:UNDERCOVER_PAIRS.filter(x=>x.category===cat);
  const pair=pool[Math.floor(Math.random()*pool.length)];
  const ids=entries.map(([id])=>id);
  for(let i=ids.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[ids[i],ids[j]]=[ids[j],ids[i]];}
  let n=$("#ucUndercoverCount").value==="auto"?(ids.length>=7?2:1):Number($("#ucUndercoverCount").value);
  n=Math.min(n,Math.max(1,ids.length-2));
  const under=new Set(ids.slice(0,n));
  const order=[...ids].sort(()=>Math.random()-.5);
  const u={votes:null,secrets:null};
  entries.forEach(([id])=>{
    u[`players/${id}/voted`]=false;
    u[`secrets/${id}`]={word:under.has(id)?pair.undercover:pair.civilian,category:pair.category};
  });
  u.meta={...meta,status:"describe",pairId:pair.id,category:pair.category,civilian:pair.civilian,undercover:pair.undercover,undercoverIds:[...under],order,startedAt:Date.now()};
  await update(ref(db,base),u);
}
function renderOrder(){
  const order=meta.order||[];$("#ucOrder").innerHTML=order.map((id,i)=>`<div class="uc-order-row"><strong>${i+1}</strong><span>${esc(players[id]?.name||"玩家")}</span></div>`).join("");
}
async function openVote(){await update(ref(db,`${base}/meta`),{status:"voting",voteStartedAt:Date.now()});}
function tally(){
  const count={};Object.values(votes).forEach(v=>{if(v?.targetId)count[v.targetId]=(count[v.targetId]||0)+1;});return count;
}
function renderVotes(){
  if(!$("#ucVoteBars"))return;
  const count=tally(),arr=playerEntries(),total=Object.keys(votes).length;
  $("#ucVoteProgress").textContent=`${total} / ${arr.length} 已投票`;
  $("#ucVoteBars").innerHTML=arr.map(([id,p])=>`<div class="uc-vote-row"><span>${esc(p.name||"玩家")}</span><div><i style="width:${arr.length?((count[id]||0)/arr.length*100):0}%"></i></div><strong>${count[id]||0}</strong></div>`).join("");
}
async function reveal(){
  const arr=playerEntries();if(Object.keys(votes).length<arr.length&&!confirm("還有人尚未投票，仍要公布結果嗎？"))return;
  const count=tally(),max=Math.max(0,...Object.values(count)),top=Object.keys(count).filter(id=>(count[id]||0)===max);
  const under=new Set(meta.undercoverIds||[]);
  const caught=top.length===1&&under.has(top[0]);
  await update(ref(db,`${base}/meta`),{status:"result",topVoted:top,caught,resultAt:Date.now()});
}
function renderResult(){
  const top=meta.topVoted||[],caught=!!meta.caught,under=new Set(meta.undercoverIds||[]);
  $("#ucResultIcon").textContent=caught?"🎉":"🕵️";
  $("#ucResultTitle").textContent=caught?"平民抓到臥底！":top.length>1?"平票，臥底躲過一劫！":"臥底成功躲過！";
  $("#ucResultDetail").textContent=top.length?`最高票：${top.map(id=>players[id]?.name||"玩家").join("、")}`:"沒有有效票數";
  $("#ucRevealWords").innerHTML=`<div><small>平民詞</small><strong>${esc(meta.civilian||"")}</strong></div><div><small>臥底詞</small><strong>${esc(meta.undercover||"")}</strong></div><div><small>臥底</small><strong>${[...under].map(id=>esc(players[id]?.name||"玩家")).join("、")}</strong></div>`;
  const count=tally(),arr=playerEntries();
  $("#ucFinalVotes").innerHTML=arr.map(([id,p])=>`<div class="uc-vote-row"><span>${esc(p.name||"玩家")}</span><div><i style="width:${arr.length?((count[id]||0)/arr.length*100):0}%"></i></div><strong>${count[id]||0}</strong></div>`).join("");
}
async function again(){const u={votes:null,secrets:null};playerEntries().forEach(([id])=>u[`players/${id}/voted`]=false);u.meta={status:"waiting",createdAt:meta.createdAt||Date.now()};await update(ref(db,base),u);}
$("#ucStartBtn").onclick=start;$("#ucVoteBtn").onclick=openVote;$("#ucRevealBtn").onclick=reveal;$("#ucAgainBtn").onclick=again;
$("#ucNewRoomBtn").onclick=()=>location.href=`undercover.html?room=${Array.from({length:5},()=>"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random()*32)]).join("")}`;

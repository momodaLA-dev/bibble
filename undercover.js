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
  const entries=playerEntries();
  if(entries.length<3){alert("至少需要 3 位玩家。");return;}

  const undercoverCount=Number($("#ucUndercoverCount").value||1);
  const blankCount=Number($("#ucBlankCount").value||0);

  if(undercoverCount<1||undercoverCount>10){alert("臥底人數請選擇 1～10 位。");return;}
  if(blankCount<0||blankCount>10){alert("白板人數請選擇 0～10 位。");return;}
  const civilianCount=entries.length-undercoverCount-blankCount;
  if(civilianCount<=0){
    alert("至少要保留 1 位平民玩家。");
    return;
  }
  if(civilianCount<=undercoverCount){
    alert(`平民人數必須大於臥底人數。目前平民 ${civilianCount} 位、臥底 ${undercoverCount} 位。`);
    return;
  }

  const cat=$("#ucCategory").value;
  const pool=cat==="all"?UNDERCOVER_PAIRS:UNDERCOVER_PAIRS.filter(x=>x.category===cat);
  const pair=pool[Math.floor(Math.random()*pool.length)];

  const shuffled=entries.map(([id])=>id);
  for(let i=shuffled.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];
  }

  const undercoverIds=shuffled.slice(0,undercoverCount);
  const blankIds=shuffled.slice(undercoverCount,undercoverCount+blankCount);
  const undercoverSet=new Set(undercoverIds);
  const blankSet=new Set(blankIds);

  const u={votes:null,secrets:null};
  entries.forEach(([id],index)=>{
    u[`players/${id}/voted`]=false;
    u[`players/${id}/spoken`]=false;
    u[`players/${id}/playerNumber`]=index+1;
    u[`players/${id}/role`]=blankSet.has(id)?"blank":undercoverSet.has(id)?"undercover":"civilian";
    u[`secrets/${id}`]={
      word:blankSet.has(id)?"":undercoverSet.has(id)?pair.undercover:pair.civilian,
      category:blankSet.has(id)?"":pair.category,
      role:blankSet.has(id)?"blank":undercoverSet.has(id)?"undercover":"civilian",
      playerNumber:index+1
    };
  });

  u.meta={
    ...meta,status:"describe",pairId:pair.id,category:pair.category,
    civilian:pair.civilian,undercover:pair.undercover,
    undercoverIds,blankIds,undercoverCount,blankCount,
    playerCount:entries.length,startedAt:Date.now()
  };
  await update(ref(db,base),u);
}
function renderOrder(){
  const arr=playerEntries();
  const spokenCount=arr.filter(([,p])=>p.spoken).length;
  if($("#ucSpeechProgress"))$("#ucSpeechProgress").textContent=`${spokenCount} / ${arr.length} 已發言`;
  $("#ucOrder").innerHTML=arr.map(([id,p],i)=>{
    const num=Number(p.playerNumber||i+1);
    return `<div class="uc-number-light ${p.spoken?"done":""}" title="${esc(p.name||"玩家")}">
      <strong>${num}</strong>
      <small>${esc(p.name||"玩家")}</small>
    </div>`;
  }).join("");
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
  const blanks=new Set(meta.blankIds||[]);
  $("#ucRevealWords").innerHTML=`<div><small>平民詞</small><strong>${esc(meta.civilian||"")}</strong></div><div><small>臥底詞</small><strong>${esc(meta.undercover||"")}</strong></div><div><small>臥底</small><strong>${[...under].map(id=>esc(players[id]?.name||"玩家")).join("、")||"無"}</strong></div><div><small>白板</small><strong>${[...blanks].map(id=>esc(players[id]?.name||"玩家")).join("、")||"無"}</strong></div>`;
  const count=tally(),arr=playerEntries();
  $("#ucFinalVotes").innerHTML=arr.map(([id,p])=>`<div class="uc-vote-row"><span>${esc(p.name||"玩家")}</span><div><i style="width:${arr.length?((count[id]||0)/arr.length*100):0}%"></i></div><strong>${count[id]||0}</strong></div>`).join("");
}
async function again(){
  const u={votes:null,secrets:null};
  playerEntries().forEach(([id])=>{
    u[`players/${id}/voted`]=false;
    u[`players/${id}/spoken`]=false;
    u[`players/${id}/playerNumber`]=null;
    u[`players/${id}/role`]=null;
  });
  u.meta={status:"waiting",createdAt:meta.createdAt||Date.now()};
  await update(ref(db,base),u);
}
$("#ucStartBtn").onclick=start;$("#ucVoteBtn").onclick=openVote;$("#ucRevealBtn").onclick=reveal;$("#ucAgainBtn").onclick=again;
$("#ucNewRoomBtn").onclick=()=>location.href=`undercover.html?room=${Array.from({length:5},()=>"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random()*32)]).join("")}`;

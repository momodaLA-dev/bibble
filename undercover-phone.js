import { initializeApp,getApps,getApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { initializeAppCheck,ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js";
import { getDatabase,ref,set,update,onValue,get,onDisconnect } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";
import * as configMod from "./firebase-config.js";
import { UNDERCOVER_PAIRS } from "./undercover-data.js";

const app=getApps().length?getApp():initializeApp(configMod.firebaseConfig);
if(configMod.appCheckSiteKey)initializeAppCheck(app,{provider:new ReCaptchaEnterpriseProvider(configMod.appCheckSiteKey),isTokenAutoRefreshEnabled:true});
const db=getDatabase(app),$=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const randomRoom=()=>Array.from({length:5},()=>"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random()*32)]).join("");
const makeId=()=>crypto?.randomUUID?crypto.randomUUID():`p_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
const qs=new URLSearchParams(location.search);

let roomId=qs.get("room")||"";
let playerId=roomId?sessionStorage.getItem(`ucp_player_${roomId}`):null;
let playerName=roomId?sessionStorage.getItem(`ucp_name_${roomId}`)||"":"";
let isHost=false,meta={},players={},votes={},secret=null;
let unMeta=null,unPlayers=null,unVotes=null,unSecret=null;

function fillCounts(){
  ["upUndercoverCount","upLobbyUndercover"].forEach(id=>{
    const el=$("#"+id);if(!el)return;el.innerHTML="";
    for(let i=1;i<=10;i++){const o=document.createElement("option");o.value=i;o.textContent=`${i} 位`;if(i===1)o.selected=true;el.appendChild(o);}
  });
  ["upBlankCount","upLobbyBlank"].forEach(id=>{
    const el=$("#"+id);if(!el)return;el.innerHTML="";
    for(let i=0;i<=10;i++){const o=document.createElement("option");o.value=i;o.textContent=`${i} 位`;if(i===0)o.selected=true;el.appendChild(o);}
  });
}
fillCounts();

function show(id){["upEntry","upLobby","upDescribe","upVote","upResult"].forEach(x=>$("#"+x).classList.toggle("hidden",x!==id));}
function esc(v){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function playerEntries(){return Object.entries(players).sort((a,b)=>(a[1].joinedAt||0)-(b[1].joinedAt||0));}
function currentJoinUrl(){return `${location.origin}${location.pathname}?room=${roomId}`;}

async function createRoom(){
  const name=$("#upName").value.trim().slice(0,12);
  if(!name){$("#upEntryMsg").textContent="請先輸入名字";return;}
  roomId=randomRoom();playerId=makeId();playerName=name;isHost=true;
  const category=$("#upCategory").value;
  const undercoverCount=Number($("#upUndercoverCount").value||1);
  const blankCount=Number($("#upBlankCount").value||0);
  const now=Date.now();
  await set(ref(db,`undercoverRooms/${roomId}`),{
    meta:{status:"waiting",hostId:playerId,categorySetting:category,undercoverCountSetting:undercoverCount,blankCountSetting:blankCount,createdAt:now},
    players:{[playerId]:{name,joinedAt:now,voted:false,spoken:false}}
  });
  sessionStorage.setItem(`ucp_player_${roomId}`,playerId);
  sessionStorage.setItem(`ucp_name_${roomId}`,playerName);
  const pr=ref(db,`undercoverRooms/${roomId}/players/${playerId}`);
  onDisconnect(pr).remove();
  history.replaceState({},"",`undercover-phone.html?room=${roomId}`);
  bindRoom();show("upLobby");
}
async function joinRoom(codeOverride){
  const code=(codeOverride||$("#upRoomInput").value||roomId).trim().toUpperCase();
  const name=$("#upName").value.trim().slice(0,12);
  if(!code){$("#upEntryMsg").textContent="請輸入房號";return;}
  if(!name){$("#upEntryMsg").textContent="請先輸入名字";return;}
  const rr=ref(db,`undercoverRooms/${code}`),snap=await get(rr);
  if(!snap.exists()){$("#upEntryMsg").textContent="找不到這個房間";return;}
  const data=snap.val();
  if(data.meta?.status!=="waiting"){$("#upEntryMsg").textContent="這局已經開始";return;}
  roomId=code;playerId=makeId();playerName=name;isHost=false;
  sessionStorage.setItem(`ucp_player_${roomId}`,playerId);
  sessionStorage.setItem(`ucp_name_${roomId}`,playerName);
  const pr=ref(db,`undercoverRooms/${roomId}/players/${playerId}`);
  await set(pr,{name,joinedAt:Date.now(),voted:false,spoken:false});
  onDisconnect(pr).remove();
  history.replaceState({},"",`undercover-phone.html?room=${roomId}`);
  bindRoom();show("upLobby");
}

function bindRoom(){
  unMeta?.();unPlayers?.();unVotes?.();unSecret?.();
  const base=`undercoverRooms/${roomId}`;
  unMeta=onValue(ref(db,`${base}/meta`),async s=>{meta=s.val()||{};isHost=meta.hostId===playerId;await renderState();});
  unPlayers=onValue(ref(db,`${base}/players`),s=>{players=s.val()||{};renderLobby();renderNumbers();renderVoteButtons();renderVoteProgress();});
  unVotes=onValue(ref(db,`${base}/votes`),s=>{votes=s.val()||{};renderVoteProgress();renderVoteButtons();});
  if(playerId)unSecret=onValue(ref(db,`${base}/secrets/${playerId}`),s=>{secret=s.val()||null;if(meta.status==="describe")renderDescribe();});
}

function renderLobby(){
  if(!roomId)return;
  const arr=playerEntries();
  $("#upRoomCode").textContent=roomId;
  $("#upPlayerCount").textContent=`${arr.length} 人`;
  $("#upLobbyPlayers").innerHTML=arr.map(([,p],i)=>`<span class="pill">${i+1}. ${esc(p.name||"玩家")}</span>`).join("");
  $("#upHostSettings").classList.toggle("hidden",!isHost);
  $("#upStartBtn").classList.toggle("hidden",!isHost);
  if(isHost){
    $("#upLobbyCategory").value=meta.categorySetting||"all";
    $("#upLobbyUndercover").value=String(meta.undercoverCountSetting||1);
    $("#upLobbyBlank").value=String(meta.blankCountSetting||0);
  }
  const u=Number(meta.undercoverCountSetting||1),b=Number(meta.blankCountSetting||0),c=arr.length-u-b;
  $("#upLobbyRule").textContent=`目前設定：${u} 位臥底、${b} 位白板、${Math.max(0,c)} 位平民。開始條件：平民人數必須大於臥底。`;
  $("#upStartBtn").disabled=arr.length<3;
  const url=currentJoinUrl();$("#upJoinLink").textContent=url;
  const qr=$("#upQr");
  if(qr&&window.QRCode&&qr.dataset.room!==roomId){qr.innerHTML="";qr.dataset.room=roomId;new QRCode(qr,{text:url,width:180,height:180});}
}

async function saveHostSettings(){
  if(!isHost)return;
  await update(ref(db,`undercoverRooms/${roomId}/meta`),{
    categorySetting:$("#upLobbyCategory").value,
    undercoverCountSetting:Number($("#upLobbyUndercover").value||1),
    blankCountSetting:Number($("#upLobbyBlank").value||0)
  });
}
["upLobbyCategory","upLobbyUndercover","upLobbyBlank"].forEach(id=>$("#"+id)?.addEventListener("change",saveHostSettings));

async function startGame(){
  if(!isHost)return;
  const entries=playerEntries();
  if(entries.length<3){$("#upLobbyMsg").textContent="至少需要 3 位玩家";return;}
  const undercoverCount=Number($("#upLobbyUndercover").value||1);
  const blankCount=Number($("#upLobbyBlank").value||0);
  const civilianCount=entries.length-undercoverCount-blankCount;
  if(civilianCount<=0){$("#upLobbyMsg").textContent="至少要保留 1 位平民玩家";return;}
  if(civilianCount<=undercoverCount){
    $("#upLobbyMsg").textContent=`無法開始：平民 ${civilianCount} 位，必須大於臥底 ${undercoverCount} 位。`;
    return;
  }
  const cat=$("#upLobbyCategory").value;
  const pool=cat==="all"?UNDERCOVER_PAIRS:UNDERCOVER_PAIRS.filter(x=>x.category===cat);
  if(!pool.length){$("#upLobbyMsg").textContent="這個分類目前沒有題目";return;}
  const pair=pool[Math.floor(Math.random()*pool.length)];
  const ids=entries.map(([id])=>id);
  for(let i=ids.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[ids[i],ids[j]]=[ids[j],ids[i]];}
  const underIds=ids.slice(0,undercoverCount),blankIds=ids.slice(undercoverCount,undercoverCount+blankCount);
  const under=new Set(underIds),blank=new Set(blankIds),u={votes:null,secrets:null};
  entries.forEach(([id],index)=>{
    const role=blank.has(id)?"blank":under.has(id)?"undercover":"civilian";
    u[`players/${id}/voted`]=false;u[`players/${id}/spoken`]=false;u[`players/${id}/playerNumber`]=index+1;u[`players/${id}/role`]=role;
    u[`secrets/${id}`]={role,playerNumber:index+1,category:role==="blank"?"":pair.category,word:role==="blank"?"":role==="undercover"?pair.undercover:pair.civilian};
  });
  u.meta={...meta,status:"describe",pairId:pair.id,category:pair.category,civilian:pair.civilian,undercover:pair.undercover,
    undercoverIds:underIds,blankIds,undercoverCount,blankCount,playerCount:entries.length,startedAt:Date.now()};
  await update(ref(db,`undercoverRooms/${roomId}`),u);
}

async function renderState(){
  if(!meta.status)return;
  if(meta.status==="waiting"){show("upLobby");renderLobby();return;}
  if(meta.status==="describe"){show("upDescribe");renderDescribe();return;}
  if(meta.status==="voting"){show("upVote");renderVoteButtons();renderVoteProgress();return;}
  if(meta.status==="result"){show("upResult");renderResult();return;}
}
function renderNumbers(){
  if(!$("#upNumberBoard"))return;
  const arr=playerEntries(),spoken=arr.filter(([,p])=>p.spoken).length;
  $("#upSpeechProgress").textContent=`${spoken} / ${arr.length} 已發言`;
  $("#upNumberBoard").innerHTML=arr.map(([,p],i)=>`<div class="uc-number-light ${p.spoken?"done":""}"><strong>${p.playerNumber||i+1}</strong><small>${esc(p.name||"玩家")}</small></div>`).join("");
}
function renderDescribe(){
  const p=players[playerId]||{};
  $("#upPlayerNumber").textContent=secret?.playerNumber||p.playerNumber||"--";
  hideSecret();
  renderNumbers();
  $("#upSpokenBtn").disabled=!!p.spoken;$("#upSpokenBtn").textContent=p.spoken?"✅ 已發言":"✅ 發言完畢";
  $("#upOpenVoteBtn").classList.toggle("hidden",!isHost);
  $("#upDescribeMsg").textContent=secret?.role==="blank"?"你是白板；按住查看時秘密區仍會保持空白。":"按住「查看身分」才會顯示秘密詞，放開立即隱藏。";
}
function showSecret(){
  $("#upSecretPeek").classList.remove("uc-secret-hidden");
  const blank=secret?.role==="blank";
  $("#upCategoryLabel").textContent=blank?"":`類別：${secret?.category||"聖經"}`;
  $("#upSecretWord").textContent=blank?"":(secret?.word||"");
}
function hideSecret(){
  $("#upSecretPeek").classList.add("uc-secret-hidden");
  $("#upCategoryLabel").textContent="";
  $("#upSecretWord").textContent="";
}
async function markSpoken(){
  if(!playerId||meta.status!=="describe")return;
  await update(ref(db,`undercoverRooms/${roomId}/players/${playerId}`),{spoken:true,spokenAt:Date.now()});
  $("#upDescribeMsg").textContent="已發言，大螢幕／所有手機上的你的號碼會暗掉。";
}
async function openVote(){if(isHost)await update(ref(db,`undercoverRooms/${roomId}/meta`),{status:"voting",voteStartedAt:Date.now()});}
function renderVoteButtons(){
  const box=$("#upVoteButtons");if(!box||meta.status!=="voting")return;
  const mine=votes[playerId];
  box.innerHTML=playerEntries().filter(([id])=>id!==playerId).map(([id,p])=>`<button class="secondary full" data-up-vote="${id}" ${mine?"disabled":""}>${p.playerNumber||""}. ${esc(p.name||"玩家")}</button>`).join("");
  box.querySelectorAll("[data-up-vote]").forEach(b=>b.addEventListener("click",()=>vote(b.dataset.upVote)));
  if(mine)$("#upVoteMsg").textContent=`你已投給 ${players[mine.targetId]?.name||"玩家"}`;
  $("#upRevealResultBtn").classList.toggle("hidden",!isHost);
}
function renderVoteProgress(){
  if(!$("#upVoteProgress"))return;
  $("#upVoteProgress").textContent=`${Object.keys(votes).length} / ${playerEntries().length} 已投票`;
}
async function vote(targetId){
  if(votes[playerId])return;
  await set(ref(db,`undercoverRooms/${roomId}/votes/${playerId}`),{targetId,at:Date.now()});
  await update(ref(db,`undercoverRooms/${roomId}/players/${playerId}`),{voted:true});
}
function tally(){const c={};Object.values(votes).forEach(v=>{if(v?.targetId)c[v.targetId]=(c[v.targetId]||0)+1;});return c;}
async function revealResult(){
  if(!isHost)return;
  const count=tally(),max=Math.max(0,...Object.values(count)),top=Object.keys(count).filter(id=>(count[id]||0)===max);
  const under=new Set(meta.undercoverIds||[]),caught=top.length===1&&under.has(top[0]);
  await update(ref(db,`undercoverRooms/${roomId}/meta`),{status:"result",topVoted:top,caught,resultAt:Date.now()});
}
function renderResult(){
  const under=new Set(meta.undercoverIds||[]),blank=new Set(meta.blankIds||[]);
  const role=blank.has(playerId)?"blank":under.has(playerId)?"undercover":"civilian";
  $("#upResultIcon").textContent=role==="blank"?"⬜":role==="undercover"?"🕵️":"🎭";
  $("#upResultTitle").textContent=meta.caught?"平民抓到臥底！":"本局結束";
  $("#upMyRole").textContent=`你的身分：${role==="blank"?"白板":role==="undercover"?"臥底":"平民"}`;
  $("#upResultWords").innerHTML=`<div><small>平民詞</small><strong>${esc(meta.civilian||"")}</strong></div><div><small>臥底詞</small><strong>${esc(meta.undercover||"")}</strong></div>`;
  $("#upResultPeople").textContent=`臥底：${[...under].map(id=>players[id]?.name||"玩家").join("、")||"無"}｜白板：${[...blank].map(id=>players[id]?.name||"玩家").join("、")||"無"}`;
  $("#upAgainBtn").classList.toggle("hidden",!isHost);
}
async function again(){
  if(!isHost)return;
  const u={votes:null,secrets:null};
  playerEntries().forEach(([id])=>{u[`players/${id}/voted`]=false;u[`players/${id}/spoken`]=false;u[`players/${id}/playerNumber`]=null;u[`players/${id}/role`]=null;});
  u.meta={status:"waiting",hostId:playerId,categorySetting:meta.categorySetting||"all",undercoverCountSetting:meta.undercoverCountSetting||1,blankCountSetting:meta.blankCountSetting||0,createdAt:meta.createdAt||Date.now()};
  await update(ref(db,`undercoverRooms/${roomId}`),u);
}
async function copyLink(){try{await navigator.clipboard.writeText(currentJoinUrl());$("#upLobbyMsg").textContent="已複製加入連結";}catch{$("#upLobbyMsg").textContent="請長按上方連結複製";}}

$("#upCreateBtn").onclick=createRoom;
$("#upJoinBtn").onclick=()=>joinRoom();
$("#upStartBtn").onclick=startGame;
$("#upCopyBtn").onclick=copyLink;
$("#upOpenVoteBtn").onclick=openVote;
$("#upRevealResultBtn").onclick=revealResult;
$("#upAgainBtn").onclick=again;
$("#upSpokenBtn").onclick=markSpoken;
const revealBtn=$("#upRevealBtn");
["pointerdown","touchstart","mousedown"].forEach(ev=>revealBtn.addEventListener(ev,e=>{e.preventDefault();showSecret();}));
["pointerup","pointercancel","pointerleave","touchend","touchcancel","mouseup"].forEach(ev=>revealBtn.addEventListener(ev,e=>{e.preventDefault();hideSecret();}));
window.addEventListener("blur",hideSecret);
document.addEventListener("visibilitychange",()=>{if(document.hidden)hideSecret();});

(async()=>{
  if(roomId){
    const snap=await get(ref(db,`undercoverRooms/${roomId}`));
    if(!snap.exists()){roomId="";history.replaceState({},"","undercover-phone.html");show("upEntry");return;}
    if(playerId){
      playerName=sessionStorage.getItem(`ucp_name_${roomId}`)||"";
      bindRoom();
    }else{
      $("#upRoomInput").value=roomId;
      $("#upEntryMsg").textContent="輸入名字後按「加入房間」";
      show("upEntry");
    }
  }else show("upEntry");
})();
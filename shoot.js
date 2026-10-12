import { initializeApp,getApps,getApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { initializeAppCheck,ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js";
import { getDatabase,ref,set,update,onValue,get,onChildAdded,runTransaction } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";
import * as configMod from "./firebase-config.js";

const app=getApps().length?getApp():initializeApp(configMod.firebaseConfig);
if(configMod.appCheckSiteKey)initializeAppCheck(app,{provider:new ReCaptchaEnterpriseProvider(configMod.appCheckSiteKey),isTokenAutoRefreshEnabled:true});
const db=getDatabase(app),$=s=>document.querySelector(s);
const roomId=new URLSearchParams(location.search).get("room")||Array.from({length:5},()=>"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random()*32)]).join("");
const base=`shootRooms/${roomId}`;let players={},meta={},aims={},targetTimer=null,endTimer=null,uiTimer=null,shotUnsub=null;

if(!new URLSearchParams(location.search).get("room"))history.replaceState({},"",`shoot.html?room=${roomId}`);
$("#shootRoomCode").textContent=roomId;
const mobileUrl=`${location.origin}${location.pathname.replace(/shoot\.html$/,"shoot-mobile.html")}?room=${roomId}`;
$("#shootJoinUrl").textContent=mobileUrl;
new QRCode($("#shootQr"),{text:mobileUrl,width:210,height:210});

async function ensureRoom(){
  const ms=await get(ref(db,`${base}/meta`));
  if(!ms.exists())await set(ref(db,`${base}/meta`),{status:"waiting",target:{x:50,y:50},createdAt:Date.now()});
  else await update(ref(db,`${base}/meta`),{status:"waiting"});
}
await ensureRoom();

onValue(ref(db,`${base}/players`),s=>{players=s.val()||{};renderLobby();renderScoreboard();renderCrosshairs();});
onValue(ref(db,`${base}/aims`),s=>{aims=s.val()||{};renderCrosshairs();});
onValue(ref(db,`${base}/meta`),s=>{
  meta=s.val()||{};
  if(meta.status==="playing"){show("shootGame");positionTarget();startHostTimers();}
  else if(meta.status==="ended"){stopTimers();show("shootEnd");renderFinal();}
  else show("shootLobby");
});

function show(id){["shootLobby","shootGame","shootEnd"].forEach(x=>$("#"+x).classList.toggle("hidden",x!==id));}
function renderLobby(){
  const list=Object.values(players);
  $("#shootPlayerCount").textContent=`${list.length} 人`;
  $("#shootLobbyPlayers").innerHTML=list.map(p=>`<span class="pill">🎯 ${esc(p.name||"玩家")}</span>`).join("");
}
function esc(v){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function renderScoreboard(){
  const arr=Object.entries(players).sort((a,b)=>(b[1].score||0)-(a[1].score||0));
  $("#shootScoreboard").innerHTML=arr.map(([id,p],i)=>`<div class="shoot-score-row"><b>${i+1}. ${esc(p.name||"玩家")}</b><strong>${p.score||0}</strong></div>`).join("");
}
function renderFinal(){
  const arr=Object.values(players).sort((a,b)=>(b.score||0)-(a.score||0));
  $("#shootFinalRanking").innerHTML=arr.map((p,i)=>`<div class="rank-row"><span>${i===0?"🏆":i===1?"🥈":i===2?"🥉":"#"+(i+1)} ${esc(p.name||"玩家")}</span><strong>${p.score||0} 分</strong></div>`).join("");
}
function positionTarget(){
  const t=meta.target||{x:50,y:50},el=$("#shootTarget");
  el.style.left=`${t.x}%`;el.style.top=`${t.y}%`;
}
function renderCrosshairs(){
  const box=$("#shootCrosshairs");box.innerHTML="";
  Object.entries(players).forEach(([id,p],i)=>{
    const a=aims[id]||{x:50,y:50},el=document.createElement("div");
    el.className="shoot-crosshair";el.style.left=`${a.x}%`;el.style.top=`${a.y}%`;el.textContent="✚";
    el.dataset.name=p.name||"玩家";box.appendChild(el);
  });
}
function randomTarget(){
  const x=15+Math.random()*70,y=18+Math.random()*64;
  update(ref(db,`${base}/meta`),{target:{x:Number(x.toFixed(1)),y:Number(y.toFixed(1)),movedAt:Date.now()}});
}
function startHostTimers(){
  if(targetTimer)return;
  const speed=Number(meta.speedMs||2200);
  targetTimer=setInterval(randomTarget,speed);
  uiTimer=setInterval(()=>{
    const ms=Math.max(0,Number(meta.endsAt||Date.now())-Date.now());
    $("#shootTimer").textContent=`⏱ ${(ms/1000).toFixed(1)} 秒`;
    if(ms<=0)finish();
  },100);
  if(!shotUnsub){
    shotUnsub=onChildAdded(ref(db,`${base}/shots`),snap=>handleShot(snap.key,snap.val()));
  }
}
function stopTimers(){clearInterval(targetTimer);clearInterval(endTimer);clearInterval(uiTimer);targetTimer=endTimer=uiTimer=null;if(shotUnsub){shotUnsub();shotUnsub=null;}}
async function start(){
  if(!Object.keys(players).length){alert("請至少有 1 位玩家加入。");return;}
  const duration=Number($("#shootDuration").value),speedMs=Number($("#shootSpeed").value),now=Date.now();
  const u={shots:null,aims:null};
  Object.keys(players).forEach(id=>u[`players/${id}/score`]=0);
  u.meta={...meta,status:"playing",startsAt:now,endsAt:now+duration*1000,duration,speedMs,target:{x:50,y:50,movedAt:now}};
  await update(ref(db,base),u);
}
async function finish(){if(meta.status!=="playing")return;await update(ref(db,`${base}/meta`),{status:"ended",endedAt:Date.now()});}
async function handleShot(key,shot){
  if(!shot||shot.scored||meta.status!=="playing")return;
  const t=meta.target||{x:50,y:50},dx=Number(shot.x)-Number(t.x),dy=Number(shot.y)-Number(t.y),d=Math.sqrt(dx*dx+dy*dy);
  let pts=d<=6?100:d<=12?60:d<=20?30:0;
  const shotRef=ref(db,`${base}/shots/${key}`);
  const tx=await runTransaction(shotRef,current=>current&&current.scored?undefined:{...current,scored:true,points:pts});
  if(!tx.committed)return;
  if(pts>0)await runTransaction(ref(db,`${base}/players/${shot.playerId}/score`),v=>(Number(v)||0)+pts);
  showMarker(shot.x,shot.y,pts);
}
function showMarker(x,y,pts){
  const el=document.createElement("div");el.className=`shoot-marker ${pts?"hit":"miss"}`;el.style.left=`${x}%`;el.style.top=`${y}%`;el.textContent=pts?`+${pts}`:"×";
  $("#shootMarkers").appendChild(el);setTimeout(()=>el.remove(),900);
}
async function again(){stopTimers();await update(ref(db,base),{shots:null,aims:null,"meta/status":"waiting"});}
$("#shootStartBtn").onclick=start;
$("#shootAgainBtn").onclick=again;
$("#shootNewRoomBtn").onclick=()=>location.href=`shoot.html?room=${Array.from({length:5},()=>"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random()*32)]).join("")}`;

import { initializeApp,getApps,getApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { initializeAppCheck,ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js";
import { getDatabase,ref,set,update,onValue,get,onDisconnect,push } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";
import * as configMod from "./firebase-config.js";
const app=getApps().length?getApp():initializeApp(configMod.firebaseConfig);
if(configMod.appCheckSiteKey)initializeAppCheck(app,{provider:new ReCaptchaEnterpriseProvider(configMod.appCheckSiteKey),isTokenAutoRefreshEnabled:true});
const db=getDatabase(app),$=s=>document.querySelector(s),roomId=new URLSearchParams(location.search).get("room");
if(!roomId){document.body.innerHTML="<main class='glass mobile-card'><h2>找不到房號</h2></main>";throw new Error("room");}
$("#smRoom").textContent=roomId;
let pid=sessionStorage.getItem(`shoot_player_${roomId}`)||null,name=sessionStorage.getItem(`shoot_name_${roomId}`)||"",x=50,y=50,motion=false,lastSend=0,meta={};
function show(id){["smJoin","smWait","smPlay","smEnd"].forEach(v=>$("#"+v).classList.toggle("hidden",v!==id));}
async function join(){
  const n=$("#smName").value.trim().slice(0,12);if(!n){$("#smMsg").textContent="請輸入名字";return;}
  const ms=await get(ref(db,`shootRooms/${roomId}/meta`));if(!ms.exists()){$("#smMsg").textContent="房間不存在";return;}
  if(ms.val().status!=="waiting"){$("#smMsg").textContent="遊戲已開始";return;}
  pid=crypto.randomUUID?.()||`p_${Date.now()}_${Math.random().toString(36).slice(2)}`;name=n;
  sessionStorage.setItem(`shoot_player_${roomId}`,pid);sessionStorage.setItem(`shoot_name_${roomId}`,name);
  const pr=ref(db,`shootRooms/${roomId}/players/${pid}`);await set(pr,{name,score:0,joinedAt:Date.now()});onDisconnect(pr).remove();
  $("#smWelcome").textContent=name;show("smWait");
}
onValue(ref(db,`shootRooms/${roomId}/meta`),async s=>{
  meta=s.val()||{};if(!pid){show("smJoin");return;}
  if(meta.status==="waiting"){show("smWait");return;}
  if(meta.status==="playing"){show("smPlay");tick();return;}
  if(meta.status==="ended"){show("smEnd");const p=(await get(ref(db,`shootRooms/${roomId}/players/${pid}`))).val();$("#smFinal").textContent=`${name}：${p?.score||0} 分`;return;}
});
onValue(ref(db,`shootRooms/${roomId}/players`),s=>{const all=s.val()||{},p=pid?all[pid]:null;if(p)$("#smScore").textContent=`分數：${p.score||0}`;});
function tick(){const ms=Math.max(0,Number(meta.endsAt||Date.now())-Date.now());$("#smTimer").textContent=`⏱ ${(ms/1000).toFixed(1)} 秒`;if(meta.status==="playing")requestAnimationFrame(tick);}
function updateUi(){x=Math.max(0,Math.min(100,x));y=Math.max(0,Math.min(100,y));$("#smCross").style.left=`${x}%`;$("#smCross").style.top=`${y}%`;$("#smCoord").textContent=`${Math.round(x)}%, ${Math.round(y)}%`;sendAim();}
function sendAim(force=false){if(!pid)return;const now=Date.now();if(!force&&now-lastSend<90)return;lastSend=now;update(ref(db,`shootRooms/${roomId}/aims/${pid}`),{x:Number(x.toFixed(1)),y:Number(y.toFixed(1)),at:now});}
async function enableMotion(){
  try{
    if(typeof DeviceOrientationEvent!=="undefined"&&typeof DeviceOrientationEvent.requestPermission==="function"){const r=await DeviceOrientationEvent.requestPermission();if(r!=="granted")throw new Error("denied");}
    window.addEventListener("deviceorientation",e=>{if(!motion)return;const g=Number(e.gamma||0),b=Number(e.beta||0);x=50+g*1.25;y=50+(b-45)*.9;updateUi();});
    motion=true;$("#smMotionBtn").textContent="✅ 動作控制已啟用";
  }catch{$("#smHitMsg").textContent="無法啟用動作感應，可改用下方方向按鈕。";}
}
async function fire(){
  if(!pid||meta.status!=="playing")return;sendAim(true);
  const sr=push(ref(db,`shootRooms/${roomId}/shots`));await set(sr,{playerId:pid,x:Number(x.toFixed(1)),y:Number(y.toFixed(1)),at:Date.now(),scored:false});
  navigator.vibrate?.(35);$("#smHitMsg").textContent="🪨 已投出！";
}
$$("[data-dir]").forEach(b=>b.addEventListener("click",()=>{const d=b.dataset.dir;if(d==="left")x-=8;if(d==="right")x+=8;if(d==="up")y-=8;if(d==="down")y+=8;if(d==="center"){x=50;y=50}updateUi();}));
$("#smJoinBtn").onclick=join;$("#smMotionBtn").onclick=enableMotion;$("#smFireBtn").onclick=fire;
if(pid){name=sessionStorage.getItem(`shoot_name_${roomId}`)||"";$("#smWelcome").textContent=name;}

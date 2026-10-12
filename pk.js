import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js";
import { getDatabase, ref, set, update, onValue, get, onDisconnect, runTransaction } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";
import * as configMod from "./firebase-config.js";

const app=getApps().length?getApp():initializeApp(configMod.firebaseConfig);
if(configMod.appCheckSiteKey){
  initializeAppCheck(app,{provider:new ReCaptchaEnterpriseProvider(configMod.appCheckSiteKey),isTokenAutoRefreshEnabled:true});
}
const db=getDatabase(app);
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];

const COLOR_HEX={blue:"#3b82f6",red:"#ef4444",green:"#22c55e",black:"#111827",yellow:"#facc15"};
const COLOR_NAME={blue:"藍色",red:"紅色",green:"綠色",black:"黑色",yellow:"黃色"};
const DIFF={
  easy:{label:"簡單",mult:1.00,ai:[0.65,0.78],pool:["光","愛","信","恩","道","羊"]},
  normal:{label:"普通",mult:1.15,ai:[0.72,0.85],pool:["平安","盼望","生命","真理","恩典","福音"]},
  hard:{label:"困難",mult:1.30,ai:[0.80,0.92],pool:["伯利恆","加利利","拿撒勒","約書亞","撒母耳","以利亞"]},
  heaven:{label:"上天堂",mult:1.50,ai:[0.88,1.00],pool:["尼布甲尼撒","撒馬利亞人","亞哈隨魯王","耶路撒冷城","加利利海邊","亞利馬太人","尼尼微大城","十二個門徒","生命樹的果"]}
};

const randomRoom=()=>Array.from({length:5},()=>"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random()*32)]).join("");
const makeId=()=>crypto?.randomUUID?crypto.randomUUID():`p_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
const qs=new URLSearchParams(location.search);

let roomId=qs.get("room")||"";
let playerId=roomId?sessionStorage.getItem(`inkpk_player_${roomId}`):null;
let playerName=roomId?sessionStorage.getItem(`inkpk_name_${roomId}`)||"":"";
let isHost=false,meta={},players={},subs={},selectedColor="",drawSubmitted=false,drawTimer=null;
let tctx=null,dctx=null,pointerDown=false,strokePoints=0,battleTimer=null,battleBusy=false;

function show(id){["pkEntry","pkLobby","pkDraw","pkWait","pkBattle","pkEnd"].forEach(x=>$("#"+x).classList.toggle("hidden",x!==id));}
function diffInfo(k){return DIFF[k]||DIFF.easy;}
function completionFactor(v){return Math.max(.70,Math.min(1,Number(v||0)));}
function defenseFactor(v){return .90+Math.max(0,Math.min(1,Number(v||0)))*.10;}
function colorMult(a,d){
  if(a==="black")return d==="yellow"?1.4:1.5;
  if(d==="black")return 1.5;
  if(a==="yellow")return 1.0;
  if(d==="yellow"&&["blue","red","green"].includes(a))return .5;
  const beats={blue:"red",red:"green",green:"blue"};
  if(beats[a]===d)return 1.4;
  if(beats[d]===a)return .8;
  return 1;
}
function attackFactor(a,d,completion,dm){return Math.min(1.80,colorMult(a,d)*completionFactor(completion)*Number(dm||1));}
function svgGlyph(text,color){
  const safe=String(text||"光").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]));
  const len=[...String(text||"")].length,size=len<=1?220:len<=2?135:len<=4?86:len<=7?58:46;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><rect width="320" height="320" rx="18" fill="white"/><text x="160" y="166" text-anchor="middle" dominant-baseline="middle" font-size="${size}" font-weight="900" font-family="sans-serif" fill="${COLOR_HEX[color]||"#111"}">${safe}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

async function createRoom(){
  const name=$("#pkName").value.trim().slice(0,12);
  if(!name){$("#pkEntryMsg").textContent="請先輸入名字";return;}
  roomId=randomRoom();playerId=makeId();playerName=name;isHost=true;
  const difficulty=$("#pkDifficulty").value,di=diffInfo(difficulty),now=Date.now();
  const roomRef=ref(db,`inkpkMobile/${roomId}`);
  await set(roomRef,{
    meta:{status:"waiting",hostId:playerId,difficulty,difficultyLabel:di.label,difficultyMult:di.mult,createdAt:now},
    players:{[playerId]:{name,joinedAt:now,ai:false}}
  });
  sessionStorage.setItem(`inkpk_player_${roomId}`,playerId);
  sessionStorage.setItem(`inkpk_name_${roomId}`,playerName);
  const pr=ref(db,`inkpkMobile/${roomId}/players/${playerId}`);
  onDisconnect(pr).remove();
  history.replaceState({},"",`pk.html?room=${roomId}`);
  bindRoom();show("pkLobby");
}
async function joinRoom(codeOverride){
  const code=(codeOverride||$("#pkRoomInput").value||roomId).trim().toUpperCase();
  const name=$("#pkName").value.trim().slice(0,12);
  if(!code){$("#pkEntryMsg").textContent="請輸入房號";return;}
  if(!name){$("#pkEntryMsg").textContent="請先輸入名字";return;}
  const rr=ref(db,`inkpkMobile/${code}`);
  const snap=await get(rr);
  if(!snap.exists()){$("#pkEntryMsg").textContent="找不到這個房間";return;}
  const data=snap.val(),humanCount=Object.values(data.players||{}).filter(p=>!p.ai).length;
  if(data.meta?.status!=="waiting"){$("#pkEntryMsg").textContent="這局已經開始";return;}
  if(humanCount>=2){$("#pkEntryMsg").textContent="這個房間已有兩位真人";return;}
  roomId=code;playerId=makeId();playerName=name;isHost=false;
  sessionStorage.setItem(`inkpk_player_${roomId}`,playerId);
  sessionStorage.setItem(`inkpk_name_${roomId}`,playerName);
  const pr=ref(db,`inkpkMobile/${roomId}/players/${playerId}`);
  await set(pr,{name,joinedAt:Date.now(),ai:false});
  onDisconnect(pr).remove();
  history.replaceState({},"",`pk.html?room=${roomId}`);
  bindRoom();show("pkLobby");
}

let unMeta=null,unPlayers=null,unSubs=null;
function bindRoom(){
  unMeta?.();unPlayers?.();unSubs?.();
  const base=`inkpkMobile/${roomId}`;
  unMeta=onValue(ref(db,`${base}/meta`),async snap=>{
    meta=snap.val()||{};
    isHost=meta.hostId===playerId;
    await renderState();
  });
  unPlayers=onValue(ref(db,`${base}/players`),snap=>{
    players=snap.val()||{};
    renderLobby();
    if(["battle","ended"].includes(meta.phase||meta.status))renderBattle();
  });
  unSubs=onValue(ref(db,`${base}/submissions`),async snap=>{
    subs=snap.val()||{};
    if(isHost&&meta.status==="playing"&&meta.phase==="draw")await hostTryStartBattle();
    if(["battle","ended"].includes(meta.phase||""))renderBattle();
  });
}
function renderLobby(){
  if(!roomId)return;
  $("#pkRoomCode").textContent=roomId;
  const humans=Object.entries(players).filter(([,p])=>!p.ai);
  $("#pkPlayerCount").textContent=`${humans.length} / 2`;
  $("#pkLobbyPlayers").innerHTML=Object.entries(players).map(([,p])=>`<span class="pill">${p.ai?"🤖":"👤"} ${escapeHtml(p.name||"玩家")}</span>`).join("");
  $("#pkDifficultyLabel").textContent=`難度：${meta.difficultyLabel||diffInfo(meta.difficulty).label}｜${Number(meta.difficultyMult||1).toFixed(2)}×`;
  $("#pkStartBtn").classList.toggle("hidden",!isHost);
  $("#pkStartBtn").disabled=humans.length<1;
  $("#pkStartBtn").textContent=humans.length===1?"開始：真人 vs AI":"開始：真人 vs 真人";
  const url=`${location.origin}${location.pathname}?room=${roomId}`;
  $("#pkJoinLink").textContent=url;
  const qr=$("#pkQr");if(qr&&!qr.dataset.done&&window.QRCode){qr.dataset.done="1";new QRCode(qr,{text:url,width:180,height:180});}
}
function escapeHtml(v){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}

async function startGame(){
  if(!isHost)return;
  const base=`inkpkMobile/${roomId}`,humans=Object.entries(players).filter(([,p])=>!p.ai);
  if(humans.length<1||humans.length>2)return;
  const di=diffInfo(meta.difficulty),char=di.pool[Math.floor(Math.random()*di.pool.length)],now=Date.now();
  const u={"players/__ai__":null,submissions:null};
  let ids=humans.map(([id])=>id);
  if(humans.length===1){
    const colors=Object.keys(COLOR_HEX),color=colors[Math.floor(Math.random()*colors.length)];
    const [lo,hi]=di.ai,completion=Number((lo+Math.random()*(hi-lo)).toFixed(4));
    const alo=Math.max(.60,lo-.05),ahi=Math.min(1,hi+.03),accuracy=Number((alo+Math.random()*(ahi-alo)).toFixed(4));
    u["players/__ai__"]={name:"AI 電腦",joinedAt:now+1,ai:true,inkColor:color};
    u["submissions/__ai__"]={name:"AI 電腦",color,completion,accuracy,power:100,image:svgGlyph(char,color),submittedAt:now+1,ai:true};
    ids.push("__ai__");
  }
  u.meta={
    ...meta,status:"playing",phase:"draw",char,drawEndsAt:now+15000,winner:"",
    playerIds:ids,hp:{},maxHp:{},clash:0,vsAI:humans.length===1
  };
  await update(ref(db,base),u);
}

async function renderState(){
  if(!meta.status)return;
  if(meta.status==="waiting"){show("pkLobby");renderLobby();return;}
  if(meta.status==="playing"&&meta.phase==="draw"){
    if(!subs[playerId]){show("pkDraw");beginDraw();}else{show("pkWait");renderWait();}
    return;
  }
  if(meta.phase==="battle"){show("pkBattle");renderBattle();if(isHost&&!battleTimer)startBattleLoop();return;}
  if(meta.phase==="ended"||meta.status==="ended"){show("pkEnd");renderEnd();return;}
}
function beginDraw(){
  if($("#pkDraw").dataset.round===String(meta.drawEndsAt))return;
  $("#pkDraw").dataset.round=String(meta.drawEndsAt);
  selectedColor="";drawSubmitted=false;strokePoints=0;
  $$("[data-pk-color]").forEach(b=>b.classList.remove("active"));
  $("#pkDrawTitle").textContent=`${meta.difficultyLabel||"簡單"}｜請描寫「${meta.char||"光"}」`;
  $("#pkTargetWord").textContent=meta.char||"光";
  $("#pkColorHint").textContent="請先選筆色／屬性，再開始描寫。";
  setupCanvas(meta.char||"光");
  const end=Number(meta.drawEndsAt||Date.now()+15000);
  clearInterval(drawTimer);
  const tick=()=>{
    const ms=Math.max(0,end-Date.now());
    $("#pkDrawTimer").textContent=`⏱ ${(ms/1000).toFixed(1)} 秒`;
    if(ms<=0){clearInterval(drawTimer);drawTimer=null;submitDrawing();}
  };
  tick();drawTimer=setInterval(tick,100);
}
function setupCanvas(text){
  const t=$("#pkTemplateCanvas"),d=$("#pkDrawCanvas");
  tctx=t.getContext("2d",{willReadFrequently:true});dctx=d.getContext("2d",{willReadFrequently:true});
  tctx.clearRect(0,0,320,320);dctx.clearRect(0,0,320,320);
  tctx.fillStyle="rgba(20,30,45,.20)";tctx.textAlign="center";tctx.textBaseline="middle";
  const chars=[...String(text)],lines=[];
  if(chars.length<=4)lines.push(chars.join(""));
  else if(chars.length<=8){const c=Math.ceil(chars.length/2);lines.push(chars.slice(0,c).join(""),chars.slice(c).join(""));}
  else{const p=Math.ceil(chars.length/3);lines.push(chars.slice(0,p).join(""),chars.slice(p,p*2).join(""),chars.slice(p*2).join(""));}
  const longest=Math.max(...lines.map(x=>[...x].length),1);
  let size=chars.length<=1?250:chars.length<=2?145:chars.length<=4?82:chars.length<=8?60:46;if(longest>6)size=Math.min(size,52);
  const lh=size*1.18,total=lh*lines.length;tctx.font=`900 ${size}px "Microsoft JhengHei","PingFang TC",sans-serif`;
  lines.forEach((line,i)=>tctx.fillText(line,160,160-total/2+lh*(i+.5)+4));
  updateDrawStats();
}
function point(e){const r=$("#pkDrawCanvas").getBoundingClientRect();return{x:(e.clientX-r.left)/r.width*320,y:(e.clientY-r.top)/r.height*320};}
function pointerStart(e){if(drawSubmitted)return;if(!selectedColor){$("#pkColorHint").textContent="請先選顏色再描寫";return;}e.preventDefault();pointerDown=true;const p=point(e);dctx.beginPath();dctx.moveTo(p.x,p.y);}
function pointerMove(e){if(!pointerDown||drawSubmitted)return;e.preventDefault();const p=point(e);dctx.strokeStyle=COLOR_HEX[selectedColor];dctx.lineWidth=18;dctx.lineCap="round";dctx.lineJoin="round";dctx.lineTo(p.x,p.y);dctx.stroke();strokePoints++;if(strokePoints%6===0)updateDrawStats();}
function pointerEnd(){if(!pointerDown)return;pointerDown=false;updateDrawStats();}
function evaluate(){
  if(!tctx||!dctx)return{completion:0,accuracy:1,power:100};
  const ti=tctx.getImageData(0,0,320,320).data,di=dctx.getImageData(0,0,320,320).data;
  let template=0,covered=0,ink=0;
  for(let y=0;y<320;y+=3)for(let x=0;x<320;x+=3){const i=(y*320+x)*4,T=ti[i+3]>20,D=di[i+3]>20;if(T)template++;if(D){ink++;if(T)covered++;}}
  const completion=template?covered/template:0,accuracy=ink?covered/ink:1;
  // 評分以畫面上方顯示的目標字樣所對應之模板為唯一基準。
  const power=Math.max(20,Math.min(200,100+completion*100-(1-accuracy)*100));
  return{completion:Math.max(0,Math.min(1,completion)),accuracy:Math.max(0,Math.min(1,accuracy)),power};
}
function updateDrawStats(){const r=evaluate();$("#pkInkScore").textContent=Math.round(r.power);$("#pkCompletion").textContent=`${Math.round(r.completion*100)}%`;$("#pkAccuracy").textContent=`${Math.round(r.accuracy*100)}%`;}
async function submitDrawing(){
  if(drawSubmitted||!playerId)return;if(!selectedColor)selectColor("blue");drawSubmitted=true;clearInterval(drawTimer);
  const r=evaluate(),canvas=$("#pkDrawCanvas");let image="";try{image=canvas.toDataURL("image/webp",.62)}catch{image=canvas.toDataURL("image/png")}
  await update(ref(db,`inkpkMobile/${roomId}`),{
    [`players/${playerId}/inkColor`]:selectedColor,
    [`submissions/${playerId}`]:{name:playerName,color:selectedColor,completion:Number(r.completion.toFixed(4)),accuracy:Number(r.accuracy.toFixed(4)),power:Number(r.power.toFixed(2)),image,submittedAt:Date.now()}
  });
  show("pkWait");renderWait();
}
function renderWait(){
  const s=subs[playerId];if(s)$("#pkWaitStats").textContent=`完整度 ${Math.round(s.completion*100)}%・準確度 ${Math.round(s.accuracy*100)}%｜對戰 HP 固定 100`;
  $("#pkWaitMsg").textContent=meta.vsAI?"AI 已準備，正在進入對戰…":"等待對手完成…";
}

async function hostTryStartBattle(){
  if(!isHost||meta.phase!=="draw")return;
  const ids=Array.isArray(meta.playerIds)?meta.playerIds:[];
  if(ids.length!==2)return;
  const latest=(await get(ref(db,`inkpkMobile/${roomId}/submissions`))).val()||{};
  if(!latest[ids[0]]||!latest[ids[1]])return;
  const hp={[ids[0]]:100,[ids[1]]:100};
  await update(ref(db,`inkpkMobile/${roomId}/meta`),{phase:"battle",hp,maxHp:{...hp},clash:0});
}
function renderBattle(){
  const ids=Array.isArray(meta.playerIds)?meta.playerIds:[],enemyId=ids.find(id=>id!==playerId),me=players[playerId]||{},en=players[enemyId]||{},sm=subs[playerId]||{},se=subs[enemyId]||{};
  if(!enemyId)return;
  const myHp=Number(meta.hp?.[playerId]??100),enHp=Number(meta.hp?.[enemyId]??100);
  $("#pkMeName").textContent=playerName||me.name||"我";$("#pkEnemyName").textContent=en.name||"對手";
  $("#pkMeColor").style.background=COLOR_HEX[sm.color||me.inkColor]||"#999";$("#pkEnemyColor").style.background=COLOR_HEX[se.color||en.inkColor]||"#999";
  $("#pkMeHp").style.width=`${Math.max(0,myHp)}%`;$("#pkEnemyHp").style.width=`${Math.max(0,enHp)}%`;
  $("#pkMeHpText").textContent=`${Math.max(0,Math.round(myHp))} / 100`;$("#pkEnemyHpText").textContent=`${Math.max(0,Math.round(enHp))} / 100`;
  if(sm.image)$("#pkMeGlyph").src=sm.image;if(se.image)$("#pkEnemyGlyph").src=se.image;
  const dm=Number(meta.difficultyMult||1),am=attackFactor(sm.color, se.color, sm.completion, dm),ae=attackFactor(se.color, sm.color, se.completion, dm);
  const dmMe=defenseFactor(sm.accuracy),dmEn=defenseFactor(se.accuracy);
  $("#pkMeStats").textContent=`攻擊 ${am.toFixed(2)}×｜防禦 ${dmMe.toFixed(2)}｜完整度 ${Math.round(Number(sm.completion||0)*100)}%`;
  $("#pkEnemyStats").textContent=`攻擊 ${ae.toFixed(2)}×｜防禦 ${dmEn.toFixed(2)}｜完整度 ${Math.round(Number(se.completion||0)*100)}%`;
  $("#pkClashNo").textContent=`第 ${Number(meta.clash||0)+1} 擊`;
}
function startBattleLoop(){
  clearInterval(battleTimer);
  battleTimer=setInterval(async()=>{
    if(battleBusy||!isHost)return;battleBusy=true;
    try{
      const base=`inkpkMobile/${roomId}`,ms=(await get(ref(db,`${base}/meta`))).val()||{};
      if(ms.phase!=="battle"){clearInterval(battleTimer);battleTimer=null;return;}
      const ps=(await get(ref(db,`${base}/players`))).val()||{},ss=(await get(ref(db,`${base}/submissions`))).val()||{};
      const [a,b]=ms.playerIds||[];if(!a||!b||!ss[a]||!ss[b])return;
      let ha=Number(ms.hp?.[a]??100),hb=Number(ms.hp?.[b]??100),dm=Number(ms.difficultyMult||1);
      const fa=attackFactor(ss[a].color,ss[b].color,ss[a].completion,dm),fb=attackFactor(ss[b].color,ss[a].color,ss[b].completion,dm);
      const da=8*fa/defenseFactor(ss[b].accuracy),dbb=8*fb/defenseFactor(ss[a].accuracy);
      hb=Math.max(0,hb-da);ha=Math.max(0,ha-dbb);const clash=Number(ms.clash||0)+1;
      const u={hp:{[a]:ha,[b]:hb},clash};let winner="";
      if(ha<=0||hb<=0||clash>=40){winner=ha<=0&&hb<=0?"draw":ha<=0?b:hb<=0?a:ha===hb?"draw":ha>hb?a:b;u.phase="ended";u.status="ended";u.winner=winner;}
      await update(ref(db,`${base}/meta`),u);
      $("#pkBattleMsg").textContent=`💥 本次傷害：${players[a]?.name||"左"} → ${da.toFixed(1)}；${players[b]?.name||"右"} → ${dbb.toFixed(1)}`;
      if(winner){clearInterval(battleTimer);battleTimer=null;}
    }finally{battleBusy=false;}
  },850);
}
function renderEnd(){
  clearInterval(battleTimer);battleTimer=null;
  const winner=meta.winner;
  $("#pkEndIcon").textContent=winner==="draw"?"🤝":winner===playerId?"🏆":"💥";
  $("#pkEndTitle").textContent=winner==="draw"?"平手！":winner===playerId?"你獲勝！":"對手獲勝";
  $("#pkEndDetail").textContent=`難度 ${meta.difficultyLabel||""}｜雙方固定 100 HP｜共 ${Number(meta.clash||0)} 次碰撞`;
  $("#pkAgainBtn").classList.toggle("hidden",!isHost);
}
async function playAgain(){
  if(!isHost)return;
  const base=`inkpkMobile/${roomId}`,u={submissions:null,"players/__ai__":null};
  for(const [id,p] of Object.entries(players))if(!p.ai){u[`players/${id}/inkColor`]=null;}
  u.meta={...meta,status:"waiting",phase:null,char:null,winner:"",hp:{},maxHp:{},clash:0,playerIds:[]};
  await update(ref(db,base),u);
}

function selectColor(c){selectedColor=c;$$("[data-pk-color]").forEach(b=>b.classList.toggle("active",b.dataset.pkColor===c));$("#pkColorHint").textContent=`目前筆色：${COLOR_NAME[c]}`;}
async function copyLink(){const t=$("#pkJoinLink").textContent;try{await navigator.clipboard.writeText(t);$("#pkLobbyMsg").textContent="已複製加入連結";}catch{$("#pkLobbyMsg").textContent="請長按上方連結複製";}}

$("#pkCreateBtn").addEventListener("click",createRoom);
$("#pkJoinBtn").addEventListener("click",()=>joinRoom());
$("#pkStartBtn").addEventListener("click",startGame);
$("#pkCopyBtn").addEventListener("click",copyLink);
$("#pkAgainBtn").addEventListener("click",playAgain);
$("#pkClearBtn").addEventListener("click",()=>{if(dctx){dctx.clearRect(0,0,320,320);strokePoints=0;updateDrawStats();}});
$$("[data-pk-color]").forEach(b=>b.addEventListener("click",()=>selectColor(b.dataset.pkColor)));
const dc=$("#pkDrawCanvas");
dc.addEventListener("pointerdown",pointerStart);dc.addEventListener("pointermove",pointerMove);["pointerup","pointercancel","pointerleave"].forEach(ev=>dc.addEventListener(ev,pointerEnd));

(async()=>{
  if(roomId){
    const snap=await get(ref(db,`inkpkMobile/${roomId}`));
    if(!snap.exists()){roomId="";history.replaceState({},"","pk.html");show("pkEntry");return;}
    if(playerId){
      playerName=sessionStorage.getItem(`inkpk_name_${roomId}`)||"";
      bindRoom();
      const ms=snap.val()?.meta||{};isHost=ms.hostId===playerId;
      await renderState();
    }else{
      $("#pkRoomInput").value=roomId;
      $("#pkEntryMsg").textContent="輸入名字後按「加入房間」";
      show("pkEntry");
    }
  }else show("pkEntry");
})();

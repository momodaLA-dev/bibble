import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js";
import { getDatabase, ref, set, update, onValue, get, onDisconnect, runTransaction } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";
import * as configMod from "./firebase-config.js";

const app = getApps().length ? getApp() : initializeApp(configMod.firebaseConfig);
if (configMod.appCheckSiteKey) {
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(configMod.appCheckSiteKey),
    isTokenAutoRefreshEnabled: true
  });
}
const db = getDatabase(app);
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const roomId=new URLSearchParams(location.search).get("room");
if(!roomId){document.body.innerHTML='<main class="glass mobile-card"><h2>找不到房號</h2><p>請重新掃描大螢幕上的 QR Code。</p></main>';throw new Error("Missing room")}

$("#roomLabel").textContent=roomId;
let playerId=sessionStorage.getItem(`bible_player_${roomId}`)||null;
let playerName=sessionStorage.getItem(`bible_name_${roomId}`)||"";
let selectedTeam=sessionStorage.getItem(`bible_team_${roomId}`)||null;
let roomMode="online",teamNames={A:"A隊",B:"B隊"},currentIndex=-1,votedIndex=null,timerId=null;
let motionEnabled=false,lastDir="stop",lastSentAt=0;
let phoneOxX=50, phoneOxAnimId=null, phoneOxLastFrame=0, phoneOxQuestionIndex=-1;
let phoneOxLeft="O", phoneOxRight="X";
let chainPhoneX=50,chainAnimId=null,chainLastFrame=0,chainOwnState={};
let chainShakeProgress=0,chainLastShakeAt=0,chainLastAccel=0;
let dodgeBaselineBeta=null,dodgeBaselineGamma=null,dodgeMotionOn=false,dodgeLastAccel=0;
let dodgeCurrentRound=0,dodgeSubmittedRound=0,dodgeOwnState={},dodgeTiltArmed=true;

const show=id=>["join","waiting","vote","ox","chain","dodge","ttt","end"].forEach(x=>$("#"+x).classList.toggle("hidden",x!==id));
const makeId=()=>crypto?.randomUUID?crypto.randomUUID():`p_${Date.now()}_${Math.random().toString(36).slice(2,9)}`;

$("#joinBtn").addEventListener("click",joinGame);
$("#nameInput").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();joinGame()}});
$("#pickA").addEventListener("click",()=>pickTeam("A"));
$("#pickB").addEventListener("click",()=>pickTeam("B"));
["A","B","C","D"].forEach(k=>$("#vote"+k).addEventListener("click",()=>cast(k)));
["A","B","C","D"].forEach(k=>$("#tttVote"+k)?.addEventListener("click",()=>submitTttAnswer(k)));
$("#tttBuzzBtn")?.addEventListener("click",submitTttBuzz);
$$("#tttMobileBoard button").forEach(b=>b.addEventListener("click",()=>selectTttCell(Number(b.dataset.cell))));
$("#enableMotionBtn").addEventListener("click",enableMotion);
$("#moveLeftBtn").addEventListener("pointerdown",()=>sendDir("left",true));
$("#moveRightBtn").addEventListener("pointerdown",()=>sendDir("right",true));
["#moveLeftBtn","#moveRightBtn"].forEach(sel=>{["pointerup","pointercancel","pointerleave"].forEach(ev=>$(sel).addEventListener(ev,()=>sendDir("stop",true)));});
$("#stopMoveBtn").addEventListener("click",()=>sendDir("stop",true));
$("#chainEnableMotionBtn")?.addEventListener("click",enableChainMotion);
$("#chainLeftBtn")?.addEventListener("pointerdown",()=>sendDir("left",true));
$("#chainRightBtn")?.addEventListener("pointerdown",()=>sendDir("right",true));
["#chainLeftBtn","#chainRightBtn"].forEach(sel=>{["pointerup","pointercancel","pointerleave"].forEach(ev=>$(sel)?.addEventListener(ev,()=>sendDir("stop",true)));});
$("#chainStopBtn")?.addEventListener("click",()=>sendDir("stop",true));
$("#chainBreakTap")?.addEventListener("click",()=>registerChainShake(true));
$("#dodgeEnableMotionBtn")?.addEventListener("click",enableDodgeMotion);
$$("[data-dodge]").forEach(b=>b.addEventListener("click",()=>submitDodgeAction(b.dataset.dodge)));

function pickTeam(t){selectedTeam=t;sessionStorage.setItem(`bible_team_${roomId}`,t);$("#pickA").classList.toggle("active",t==="A");$("#pickB").classList.toggle("active",t==="B");}
function refreshModeUi(){
  const team=roomMode==="team"||roomMode==="ttt",ox=roomMode==="ox";
  $("#teamPicker").classList.toggle("hidden",!team);
  $("#modeHint").textContent=roomMode==="team"?"⚔️ 這是兩隊競賽：輸入名字後選擇隊伍。":roomMode==="ttt"?"⭕❌ 九宮格答題戰：先選 A隊／B隊；每回合系統會隨機抽一人選格。":roomMode==="chain"?"⛓️ 鎖鏈逃脫：左右傾斜躲開鎖鏈；被纏住後快速左右甩動手機掙脫。":roomMode==="dodge"?"💨 極限閃避：看螢幕箭頭，用手機上下左右傾斜，或做小幅度跳躍動作。撞到就出局。":ox?"🕹️ 這是 OX 走位搶答：加入後用手機傾斜控制小人物。":"📱 這是手機多人模式：輸入名字後加入個人競賽。";
  $("#pickA").textContent=teamNames.A||"A隊";$("#pickB").textContent=teamNames.B||"B隊";
  if(selectedTeam)pickTeam(selectedTeam);
  $("#myTeam").classList.toggle("hidden",!team);
  if(team&&selectedTeam)$("#myTeam").textContent=`所屬隊伍：${teamNames[selectedTeam]||selectedTeam}`;
}

async function joinGame(){
  const name=$("#nameInput").value.trim().slice(0,12);
  if(!name){$("#joinMsg").textContent="請先輸入名字";return}
  const m=await get(ref(db,`rooms/${roomId}/meta`));
  if(!m.exists()){$("#joinMsg").textContent="房間不存在";return}
  const meta=m.val();roomMode=meta.mode||"online";teamNames=meta.teamNames||teamNames;refreshModeUi();
  if(meta.status!=="waiting"){$("#joinMsg").textContent="這局已開始，請等待下一局";return}
  if((roomMode==="team"||roomMode==="ttt")&&!selectedTeam){$("#joinMsg").textContent="請先選擇 A隊或 B隊";return}
  playerId=makeId();playerName=name;
  sessionStorage.setItem(`bible_player_${roomId}`,playerId);sessionStorage.setItem(`bible_name_${roomId}`,playerName);
  const pr=ref(db,`rooms/${roomId}/players/${playerId}`);
  await set(pr,{name:playerName,score:0,team:(roomMode==="team"||roomMode==="ttt")?selectedTeam:null,joinedAt:Date.now()});
  onDisconnect(pr).remove();
  $("#welcome").textContent=`歡迎 ${playerName}`;refreshModeUi();show("waiting");
}

onValue(ref(db,`rooms/${roomId}/meta`),async s=>{
  const m=s.val();if(!m)return;
  roomMode=m.mode||"online";teamNames=m.teamNames||teamNames;refreshModeUi();
  if(!playerId){show("join");return}
  if(m.status==="waiting"){
    $("#welcome").textContent=`歡迎 ${playerName}`;
    $("#waitText").textContent="已加入房間，等待主持人開始。";
    show("waiting");return;
  }
  if(["playing","revealed"].includes(m.status)){
    currentIndex=Number(m.currentIndex);
    if(roomMode==="ox")await renderOx(m);
    else if(roomMode==="chain")await renderChainMobile(m);
    else if(roomMode==="dodge")await renderDodgeMobile(m);
    else if(roomMode==="ttt")await renderTttMobile(m);
    else await renderVote(m);
    return;
  }
  if(m.status==="ended"){
    clearTimer();const p=(await get(ref(db,`rooms/${roomId}/players/${playerId}`))).val();
    $("#myScore").textContent=p?`${p.score||0} 分`:"遊戲結束";
    if((roomMode==="team"||roomMode==="ttt")&&p?.team){$("#teamResult").classList.remove("hidden");$("#teamResult").textContent=`${teamNames[p.team]||p.team}｜個人累積 ${p.score||0} 分`;}else $("#teamResult").classList.add("hidden");
    show("end");
  }
});


async function renderTttMobile(m){
  clearTimer();
  const t=m.ttt||{};
  const board=Array.from({length:9},(_,i)=>t.board?.[`c${i}`]||"");
  const names=m.teamNames||{A:"A隊",B:"B隊"};
  const phase=t.phase||"pick";
  const isPicker=phase==="pick"&&t.pickerId===playerId&&t.turnTeam===selectedTeam;

  $("#tttMobilePhase").textContent=`${names.A||"A隊"} = ⭕　｜　${names.B||"B隊"} = ❌`;
  $("#tttBuzzBtn").classList.add("hidden");
  $("#tttMobileQuestionBox").classList.add("hidden");

  $$("#tttMobileBoard button").forEach((b,i)=>{
    const v=board[i];
    b.textContent=v==="A"?"⭕":v==="B"?"❌":String(i+1);
    b.disabled=!!v||!isPicker;
    b.classList.toggle("team-a",v==="A");
    b.classList.toggle("team-b",v==="B");
  });

  if(phase==="pick"){
    if(isPicker){
      $("#tttMobileTitle").textContent="🎲 你被抽中了！請選一格";
      $("#tttMobileMsg").textContent="只能選目前空白的格子；之前雙方都答錯的空格也可以再次攻擊。";
    }else if(t.turnTeam===selectedTeam){
      $("#tttMobileTitle").textContent=`輪到 ${names[selectedTeam]||selectedTeam}`;
      $("#tttMobileMsg").textContent=`本回合由 ${t.pickerName||"隊友"} 選格，請等待。`;
    }else{
      $("#tttMobileTitle").textContent=`目前是 ${names[t.turnTeam]||t.turnTeam} 回合`;
      $("#tttMobileMsg").textContent="等待對方選格。";
    }
    show("ttt"); return;
  }

  if(phase==="won"){
    $("#tttMobileTitle").textContent=t.winner===selectedTeam?"🏆 你們隊獲勝！":"本局結束";
    $("#tttMobileMsg").textContent=`勝隊：${names[t.winner]||t.winner}`;
    show("ttt"); return;
  }

  if(phase==="tiebreakBuzz"){
    $("#tttMobileTitle").textContent="⚡ 平手搶答決勝";
    $("#tttMobileMsg").textContent="看到按鈕就搶！最快的人先回答。";
    $("#tttBuzzBtn").classList.remove("hidden");
    $("#tttBuzzBtn").disabled=false;
    show("ttt"); return;
  }

  const qi=Number(t.questionIndex||0);
  const q=(await get(ref(db,`rooms/${roomId}/questions/${qi}`))).val();
  if(!q){$("#tttMobileTitle").textContent="找不到題目";show("ttt");return;}
  $("#tttMobileQuestion").textContent=q.question;
  ["A","B","C","D"].forEach((k,i)=>{
    const b=$("#tttVote"+k);
    b.textContent=`${k}\n${q.choices?.[i]||""}`;
    b.disabled=true;
  });
  $("#tttMobileQuestionBox").classList.remove("hidden");

  let canAnswer=false;
  if(["answer","steal"].includes(phase)){
    canAnswer=t.answeringTeam===selectedTeam;
  }else if(phase==="tiebreakAnswer"){
    canAnswer=t.answeringTeam===selectedTeam && (t.tiebreakSecondChance||!t.buzzPlayerId||t.buzzPlayerId===playerId);
  }
  ["A","B","C","D"].forEach(k=>$("#tttVote"+k).disabled=!canAnswer);

  if(phase==="answer"){
    $("#tttMobileTitle").textContent=`攻擊第 ${Number(t.selectedCell)+1} 格`;
    $("#tttMobileMsg").textContent=canAnswer?"你們隊先答；第一個送出的答案會被採用。":"等待對方隊伍作答。";
  }else if(phase==="steal"){
    $("#tttMobileTitle").textContent="🔥 接答搶格";
    $("#tttMobileMsg").textContent=canAnswer?"對方答錯了！你們隊答對就能搶走這格。":"你們隊已答錯，等待對方接答。";
  }else if(phase==="tiebreakAnswer"){
    $("#tttMobileTitle").textContent=t.tiebreakSecondChance?"接答機會":"⚡ 搶答成功";
    $("#tttMobileMsg").textContent=canAnswer?(t.tiebreakSecondChance?"對方搶答答錯，換你們隊回答。":"你搶到了！請回答 A/B/C/D。"):"等待有回答權的玩家作答。";
  }
  show("ttt");
}
async function selectTttCell(cell){
  const ms=(await get(ref(db,`rooms/${roomId}/meta`))).val();
  const t=ms?.ttt||{};
  if(ms?.mode!=="ttt"||ms.status!=="playing"||t.phase!=="pick"||t.pickerId!==playerId||t.turnTeam!==selectedTeam)return;
  if(t.board?.[`c${cell}`])return;
  await update(ref(db,`rooms/${roomId}/meta`),{
    "ttt/selectedCell":cell,
    "ttt/attackingTeam":selectedTeam,
    "ttt/answeringTeam":selectedTeam,
    "ttt/phase":"answer",
    "ttt/feedback":""
  });
}
async function submitTttAnswer(choice){
  const ms=(await get(ref(db,`rooms/${roomId}/meta`))).val();
  const t=ms?.ttt||{};
  if(ms?.mode!=="ttt"||ms.status!=="playing"||!["answer","steal","tiebreakAnswer"].includes(t.phase))return;
  if(t.answeringTeam!==selectedTeam)return;
  if(t.phase==="tiebreakAnswer"&&!t.tiebreakSecondChance&&t.buzzPlayerId&&t.buzzPlayerId!==playerId)return;
  const ar=ref(db,`rooms/${roomId}/tttAnswer`);
  const result=await runTransaction(ar,current=>{
    if(current)return current;
    return {team:selectedTeam,choice,playerId,name:playerName,at:Date.now()};
  });
  if(result.committed)$("#tttMobileMsg").textContent=`✅ 已送出 ${choice}，等待主機判定`;
}
async function submitTttBuzz(){
  const ms=(await get(ref(db,`rooms/${roomId}/meta`))).val();
  const t=ms?.ttt||{};
  if(ms?.mode!=="ttt"||ms.status!=="playing"||t.phase!=="tiebreakBuzz")return;
  const br=ref(db,`rooms/${roomId}/tttBuzz`);
  const result=await runTransaction(br,current=>{
    if(current)return current;
    return {team:selectedTeam,playerId,name:playerName,at:Date.now()};
  });
  $("#tttBuzzBtn").disabled=true;
  $("#tttMobileMsg").textContent=result.committed?"⚡ 你搶到了！等待主機開放作答。":"差一點！已經有人先搶到了。";
}


onValue(ref(db,`rooms/${roomId}/players`),s=>{
  const all=s.val()||{};
  chainOwnState=playerId?(all[playerId]||{}):{};
  dodgeOwnState=playerId?(all[playerId]||{}):{};
  if(roomMode==="chain"&&playerId)updateChainTrapUi();
  if(roomMode==="dodge"&&playerId)updateDodgeAliveUi();
});

function stopChainPhoneAnimation(){
  if(chainAnimId){cancelAnimationFrame(chainAnimId);chainAnimId=null;}
  chainLastFrame=0;
}
function chainPhoneZone(){
  return chainPhoneX<35?"左側":chainPhoneX>65?"右側":"中央";
}
function updateChainPhoneIndicator(){
  const marker=$("#chainPhoneMarker");
  if(marker)marker.style.left=`${Math.max(4,Math.min(96,chainPhoneX))}%`;
  if($("#chainPositionText"))$("#chainPositionText").textContent=`目前位置：${chainPhoneZone()}`;
}
function startChainPhoneAnimation(){
  if(chainAnimId)return;
  const frame=(ts)=>{
    if(!chainLastFrame)chainLastFrame=ts;
    const dt=Math.min(.08,(ts-chainLastFrame)/1000);chainLastFrame=ts;
    if(!chainOwnState.chained){
      const velocity=lastDir==="left"?-11:lastDir==="right"?11:0;
      if(velocity){chainPhoneX=Math.max(6,Math.min(94,chainPhoneX+velocity*dt));updateChainPhoneIndicator();}
    }
    chainAnimId=requestAnimationFrame(frame);
  };
  chainAnimId=requestAnimationFrame(frame);
}
function updateChainTrapUi(){
  const trapped=!!chainOwnState.chained;
  $("#chainTrapBox")?.classList.toggle("hidden",!trapped);
  $("#chainSafeBox")?.classList.toggle("hidden",trapped);
  if(trapped){
    stopChainPhoneAnimation();
    lastDir="stop";
    const progress=Math.max(chainShakeProgress,Number(chainOwnState?.shakeProgress||0));
    if($("#chainBreakBar"))$("#chainBreakBar").style.width=`${Math.min(100,progress/8*100)}%`;
    if($("#chainBreakText"))$("#chainBreakText").textContent=`掙脫 ${Math.min(8,progress)} / 8`;
    if($("#chainMobileTitle"))$("#chainMobileTitle").textContent="⛓️ 被鎖住！快甩動掙脫";
  }else{
    if(chainShakeProgress){chainShakeProgress=0;if($("#chainBreakBar"))$("#chainBreakBar").style.width="0%";}
    startChainPhoneAnimation();
  }
}
async function renderChainMobile(meta){
  clearTimer();
  const left=Math.max(0,Number(meta.roundEndsAt||0)-Date.now());
  $("#chainMobileTimer").textContent=`⏱ ${Math.ceil(left/1000)} 秒`;
  $("#chainPhoneName").textContent=playerName||"我";
  updateChainPhoneIndicator();
  updateChainTrapUi();
  if(!chainOwnState.chained){
    const wz=meta.chain?.warningZone||"";
    $("#chainMobileTitle").textContent=wz?`⚠️ ${wz==="left"?"左側":wz==="right"?"右側":"中央"}鎖鏈要來了！`:"左右移動躲開鎖鏈";
    $("#chainMobileMsg").textContent=wz?"快離開警告區！":"保持移動，注意大螢幕與手機警告。";
  }
  const tick=()=>{
    const ms=Math.max(0,Number(meta.roundEndsAt||0)-Date.now());
    $("#chainMobileTimer").textContent=`⏱ ${Math.ceil(ms/1000)} 秒`;
    if(ms<=0){clearTimer();stopChainPhoneAnimation();sendDir("stop",true);}
  };
  timerId=setInterval(tick,250);
  show("chain");
}
async function enableChainMotion(){
  try{
    if(typeof DeviceOrientationEvent!=="undefined"&&typeof DeviceOrientationEvent.requestPermission==="function"){
      const p=await DeviceOrientationEvent.requestPermission();if(p!=="granted")throw new Error("未取得方向感應權限");
    }
    if(typeof DeviceMotionEvent!=="undefined"&&typeof DeviceMotionEvent.requestPermission==="function"){
      const p2=await DeviceMotionEvent.requestPermission();if(p2!=="granted")throw new Error("未取得動作感應權限");
    }
    window.removeEventListener("deviceorientation",handleOrientation);
    window.addEventListener("deviceorientation",handleOrientation,true);
    window.removeEventListener("devicemotion",handleChainMotion);
    window.addEventListener("devicemotion",handleChainMotion,true);
    motionEnabled=true;
    $("#chainEnableMotionBtn").textContent="✅ 動作控制已啟用";
    $("#chainMobileMsg").textContent="左右傾斜移動；被鎖住後快速左右甩動手機。";
  }catch(e){
    $("#chainMobileMsg").textContent=`無法啟用動作感應：${e.message}。仍可用下方左右按鈕，受困時可快速點擊掙脫。`;
  }
}
function handleChainMotion(e){
  if(roomMode!=="chain"||!chainOwnState.chained)return;
  const a=e.accelerationIncludingGravity||e.acceleration||{};
  const mag=Math.sqrt((a.x||0)**2+(a.y||0)**2+(a.z||0)**2);
  const delta=Math.abs(mag-chainLastAccel);chainLastAccel=mag;
  if(delta>6.5)registerChainShake(false);
}
async function registerChainShake(fromTap=false){
  if(roomMode!=="chain"||!chainOwnState.chained)return;
  const now=Date.now();if(!fromTap&&now-chainLastShakeAt<130)return;
  chainLastShakeAt=now;
  chainShakeProgress=Math.min(8,chainShakeProgress+1);
  if($("#chainBreakBar"))$("#chainBreakBar").style.width=`${chainShakeProgress/8*100}%`;
  if($("#chainBreakText"))$("#chainBreakText").textContent=`掙脫 ${chainShakeProgress} / 8`;
  const cr=ref(db,`rooms/${roomId}/controls/${playerId}`);
  await update(cr,{shakeProgress:chainShakeProgress,at:now,dir:"stop"});
  if(chainShakeProgress>=8){
    $("#chainBreakText").textContent="✅ 掙脫中…";
  }
}

function dodgeMobileInfo(action){
  return {
    left:["⬅️","往左閃！"],right:["➡️","往右閃！"],up:["⬆️","往上閃！"],
    down:["⬇️","往下閃！"],jump:["🦘","小跳一下！"]
  }[action]||["⚡","準備"];
}
function setDodgePadActive(action){
  ["left","right","up","down","jump"].forEach(a=>{
    const id={left:"#dodgeLeft",right:"#dodgeRight",up:"#dodgeUp",down:"#dodgeDown",jump:"#dodgeJump"}[a];
    $(id)?.classList.toggle("active",a===action);
  });
}
function updateDodgeAliveUi(){
  const out=dodgeOwnState.alive===false;
  $("#dodgeEliminated")?.classList.toggle("hidden",!out);
  $("#dodgeEnableMotionBtn")?.classList.toggle("hidden",out);
  $("#dodgeFallback")?.classList.toggle("hidden",out);
  if(out){
    $("#dodgeMobileMsg").textContent=`本局分數：${Number(dodgeOwnState.score||0)} 分`;
    setDodgePadActive("");
  }
}
async function renderDodgeMobile(meta){
  clearTimer();
  const d=meta.dodge||{},round=Number(d.round||0);
  dodgeCurrentRound=round;
  const [icon,text]=dodgeMobileInfo(d.required||"");
  $("#dodgeMobileRound").textContent=`第 ${round} 回合`;
  $("#dodgeMobileCommand").textContent=d.phase==="active"?`${icon} ${text}`:"準備下一波";
  setDodgePadActive(d.phase==="active"?d.required:"");
  updateDodgeAliveUi();

  if(dodgeOwnState.alive!==false){
    const already=Number(dodgeOwnState.dodgeLastRound||0)===round;
    $("#dodgeMobileMsg").textContent=d.phase==="active"
      ?(already?`✅ 已完成：${text}，等待判定`:`快！${text}`)
      :"注意下一個障礙";
  }

  const tick=()=>{
    const ms=Math.max(0,Number(d.endsAt||0)-Date.now());
    if(d.phase==="active"&&dodgeOwnState.alive!==false){
      $("#dodgeMobileRound").textContent=`第 ${round} 回合｜${(ms/1000).toFixed(1)} 秒`;
    }
  };
  timerId=setInterval(tick,100);
  show("dodge");
}
async function enableDodgeMotion(){
  try{
    if(typeof DeviceOrientationEvent!=="undefined"&&typeof DeviceOrientationEvent.requestPermission==="function"){
      const p=await DeviceOrientationEvent.requestPermission();if(p!=="granted")throw new Error("未取得方向感應權限");
    }
    if(typeof DeviceMotionEvent!=="undefined"&&typeof DeviceMotionEvent.requestPermission==="function"){
      const p2=await DeviceMotionEvent.requestPermission();if(p2!=="granted")throw new Error("未取得動作感應權限");
    }
    dodgeMotionOn=true;dodgeBaselineBeta=null;dodgeBaselineGamma=null;
    window.addEventListener("deviceorientation",handleDodgeOrientation,true);
    window.addEventListener("devicemotion",handleDodgeMotion,true);
    $("#dodgeEnableMotionBtn").textContent="✅ 動作控制已啟用";
    $("#dodgeMobileMsg").textContent="保持手機在舒服角度；看到箭頭後向對應方向傾斜。";
  }catch(e){
    $("#dodgeMobileMsg").textContent=`無法啟用動作感應：${e.message}。可用下方方向按鈕代替。`;
  }
}
function handleDodgeOrientation(e){
  if(!dodgeMotionOn||roomMode!=="dodge"||dodgeOwnState.alive===false)return;
  const beta=Number(e.beta||0),gamma=Number(e.gamma||0);
  if(dodgeBaselineBeta===null){dodgeBaselineBeta=beta;dodgeBaselineGamma=gamma;return;}
  const db=beta-dodgeBaselineBeta,dg=gamma-dodgeBaselineGamma;
  if(Math.abs(db)<8&&Math.abs(dg)<8){dodgeTiltArmed=true;return;}
  if(!dodgeTiltArmed)return;
  let action="";
  if(Math.abs(dg)>Math.abs(db)&&Math.abs(dg)>17)action=dg<0?"left":"right";
  else if(Math.abs(db)>15)action=db<0?"up":"down";
  if(action){dodgeTiltArmed=false;submitDodgeAction(action);}
}
function handleDodgeMotion(e){
  if(!dodgeMotionOn||roomMode!=="dodge"||dodgeOwnState.alive===false)return;
  const a=e.accelerationIncludingGravity||e.acceleration||{};
  const mag=Math.sqrt((a.x||0)**2+(a.y||0)**2+(a.z||0)**2);
  const delta=Math.abs(mag-dodgeLastAccel);dodgeLastAccel=mag;
  if(delta>8.5)submitDodgeAction("jump");
}
async function submitDodgeAction(action){
  if(!playerId||roomMode!=="dodge"||dodgeOwnState.alive===false)return;
  const meta=(await get(ref(db,`rooms/${roomId}/meta`))).val();
  const d=meta?.dodge||{},round=Number(d.round||0);
  if(meta?.status!=="playing"||d.phase!=="active"||Date.now()>Number(d.endsAt||0))return;
  if(Number(dodgeOwnState.dodgeLastRound||0)===round||dodgeSubmittedRound===round)return;
  dodgeSubmittedRound=round;
  await update(ref(db,`rooms/${roomId}/players/${playerId}`),{
    dodgeAction:action,dodgeLastRound:round
  });
  const [,label]=dodgeMobileInfo(action);
  $("#dodgeMobileMsg").textContent=`📱 已偵測：${label}`;
}
function stopPhoneOxAnimation(){
  if(phoneOxAnimId){cancelAnimationFrame(phoneOxAnimId);phoneOxAnimId=null;}
  phoneOxLastFrame=0;
}
function resetPhoneOxPosition(){
  phoneOxX=50;
  phoneOxLastFrame=0;
  updatePhoneOxIndicator();
}
function phoneOxChoice(){
  if(phoneOxX<35)return phoneOxLeft;
  if(phoneOxX>65)return phoneOxRight;
  return "N";
}
function updatePhoneOxIndicator(){
  const marker=$("#phonePlayerMarker");
  if(marker)marker.style.left=`${Math.max(4,Math.min(96,phoneOxX))}%`;
  const choice=phoneOxChoice();
  let pos="中央等待區";
  if(phoneOxX<35)pos=`左側 ${phoneOxLeft} 區`;
  else if(phoneOxX>65)pos=`右側 ${phoneOxRight} 區`;
  $("#phonePositionText").textContent=`目前位置：${pos}`;
  $("#phoneChoiceText").textContent=choice==="N"?"目前選擇：尚未進入 O／X 區":`目前選擇：${choice}`;
  $("#phoneLeftZone")?.classList.toggle("active-zone",phoneOxX<35);
  $("#phoneRightZone")?.classList.toggle("active-zone",phoneOxX>65);
}
function startPhoneOxAnimation(){
  if(phoneOxAnimId)return;
  const frame=(ts)=>{
    if(!phoneOxLastFrame)phoneOxLastFrame=ts;
    const dt=Math.min(0.08,(ts-phoneOxLastFrame)/1000);
    phoneOxLastFrame=ts;
    const velocity=lastDir==="left"?-11:lastDir==="right"?11:0;
    if(velocity){
      phoneOxX=Math.max(6,Math.min(94,phoneOxX+velocity*dt));
      updatePhoneOxIndicator();
    }
    phoneOxAnimId=requestAnimationFrame(frame);
  };
  phoneOxAnimId=requestAnimationFrame(frame);
}
async function renderOx(m){
  clearTimer();
  const q=(await get(ref(db,`rooms/${roomId}/questions/${currentIndex}`))).val();if(!q)return;

  phoneOxLeft=q.oxLeft||"O";
  phoneOxRight=q.oxRight||"X";
  $("#oxMobileProgress").textContent=`第 ${currentIndex+1} / ${m.questionCount} 題`;
  $("#oxMobileQuestion").textContent=q.question;
  $("#phoneLeftLabel").textContent=phoneOxLeft;
  $("#phoneRightLabel").textContent=phoneOxRight;
  $("#phoneLeftTrackLabel").textContent=phoneOxLeft;
  $("#phoneRightTrackLabel").textContent=phoneOxRight;
  $("#phonePlayerName").textContent=playerName||"我";
  $("#phoneLeftZone")?.classList.toggle("zone-o",phoneOxLeft==="O");
  $("#phoneLeftZone")?.classList.toggle("zone-x",phoneOxLeft==="X");
  $("#phoneRightZone")?.classList.toggle("zone-o",phoneOxRight==="O");
  $("#phoneRightZone")?.classList.toggle("zone-x",phoneOxRight==="X");

  if(phoneOxQuestionIndex!==currentIndex){
    phoneOxQuestionIndex=currentIndex;
    resetPhoneOxPosition();
    lastDir="stop";
  }

  if(m.status==="revealed"){
    stopPhoneOxAnimation();
    await sendDir("stop",true);
    const locked=(await get(ref(db,`rooms/${roomId}/votes/${currentIndex}/${playerId}`))).val();
    const lockedChoice=locked?.choice||"N";
    const lockedText=lockedChoice==="N"?"未作答":lockedChoice;
    $("#motionMsg").textContent=`✅ 正確答案：${q.answer}｜本題最後鎖定：${lockedText}`;
    $("#phoneChoiceText").textContent=`最後鎖定：${lockedText}`;
    $("#oxMobileReference").textContent=q.reference?`📖 和合本：${q.reference}`:"";
    $("#oxMobileReference").classList.toggle("hidden",!q.reference);
    $("#oxMobileTimer").textContent="⏱ 本題結束";
  }else{
    startPhoneOxAnimation();
    $("#motionMsg").textContent=q.oxSwapped?"🔄 注意！這題 O／X 換邊了，先看清楚左右位置":"傾斜手機控制人物；回正就停止";
    $("#oxMobileReference").classList.add("hidden");
    runOxTimer(m.roundEndsAt);
  }
  show("ox");
}
function runOxTimer(endsAt){
  clearTimer();const tick=()=>{const ms=Math.max(0,(endsAt||0)-Date.now());$("#oxMobileTimer").textContent=`⏱ ${Math.ceil(ms/1000)} 秒`;if(ms<=0){clearTimer();stopPhoneOxAnimation();sendDir("stop",true);$("#motionMsg").textContent="⏰ 時間到，等待主機確認最後位置";}};tick();timerId=setInterval(tick,200);
}
async function enableMotion(){
  try{
    if(typeof DeviceOrientationEvent!=="undefined"&&typeof DeviceOrientationEvent.requestPermission==="function"){
      const p=await DeviceOrientationEvent.requestPermission();if(p!=="granted")throw new Error("未取得動作感應權限");
    }
    window.removeEventListener("deviceorientation",handleOrientation);window.addEventListener("deviceorientation",handleOrientation,true);motionEnabled=true;
    $("#enableMotionBtn").textContent="✅ 動作控制已啟用";$("#motionMsg").textContent="左右傾斜手機試試看";
  }catch(e){$("#motionMsg").textContent=`無法啟用陀螺儀：${e.message}，可使用下方左右按鈕。`;}
}
function handleOrientation(e){
  if(!motionEnabled||!(roomMode==="ox"||roomMode==="chain"))return;
  const g=Number(e.gamma||0);const dir=g<-12?"left":g>12?"right":"stop";sendDir(dir);
}
async function sendDir(dir,force=false){
  if(!playerId||!(roomMode==="ox"||roomMode==="chain"))return;
  if(roomMode==="chain"&&chainOwnState.chained)return;
  const now=Date.now();
  if(!force&&dir===lastDir)return;
  if(!force&&now-lastSentAt<80)return;
  lastDir=dir;lastSentAt=now;
  if(roomMode==="ox"){
    if(dir!=="stop")startPhoneOxAnimation();
    updatePhoneOxIndicator();
  }else if(roomMode==="chain"){
    if(dir!=="stop")startChainPhoneAnimation();
    updateChainPhoneIndicator();
  }
  await set(ref(db,`rooms/${roomId}/controls/${playerId}`),{dir,at:now,shakeProgress:roomMode==="chain"?chainShakeProgress:0});
}
async function renderVote(m){
  clearTimer();const q=(await get(ref(db,`rooms/${roomId}/questions/${currentIndex}`))).val();if(!q)return;
  $("#mobileProgress").textContent=`第 ${currentIndex+1} / ${m.questionCount} 題`;
  $("#mobileQuestion").textContent=q.question;
  ["A","B","C","D"].forEach((k,i)=>{const b=$("#vote"+k);b.textContent=`${k}\n${q.choices?.[i]||""}`;b.classList.remove("selected","correct","wrong");b.disabled=m.status!=="playing";});
  const ex=await get(ref(db,`rooms/${roomId}/votes/${currentIndex}/${playerId}`));
  if(ex.exists())lockVote(ex.val().choice);else votedIndex=null;
  if(m.status==="revealed"){
    $("#vote"+q.answer).classList.add("correct");
    if(ex.exists()&&ex.val().choice!==q.answer)$("#vote"+ex.val().choice).classList.add("wrong");
    $("#voteMsg").textContent=`✅ 正確答案：${q.answer}｜等待主持人下一題`;
    $("#mobileReference").textContent=q.reference?`📖 和合本：${q.reference}`:"";$("#mobileReference").classList.toggle("hidden",!q.reference);
    $("#mobileTimer").textContent="⏱ 本題結束";
  }else{
    $("#voteMsg").textContent=ex.exists()?`✅ 已選擇 ${ex.val().choice}`:"請選擇 A / B / C / D";
    $("#mobileReference").classList.add("hidden");
    runTimer(m.roundEndsAt);
  }
  show("vote");
}

function runTimer(endsAt){
  clearTimer();const tick=()=>{const ms=Math.max(0,(endsAt||0)-Date.now());$("#mobileTimer").textContent=`⏱ ${Math.ceil(ms/1000)} 秒`;if(ms<=0){clearTimer();["A","B","C","D"].forEach(k=>$("#vote"+k).disabled=true);$("#voteMsg").textContent="⏰ 時間到，等待公布答案";}};tick();timerId=setInterval(tick,250);
}
function clearTimer(){if(timerId){clearInterval(timerId);timerId=null;}}

async function cast(choice){
  if(!playerId||votedIndex===currentIndex)return;
  const meta=(await get(ref(db,`rooms/${roomId}/meta`))).val();
  if(!meta||meta.status!=="playing"||Date.now()>=Number(meta.roundEndsAt||0)){["A","B","C","D"].forEach(k=>$("#vote"+k).disabled=true);$("#voteMsg").textContent="⏰ 本題作答時間已結束";return}
  const vr=ref(db,`rooms/${roomId}/votes/${currentIndex}/${playerId}`),ex=await get(vr);
  if(ex.exists()){lockVote(ex.val().choice);return}
  await set(vr,{choice,at:Date.now()});lockVote(choice);
}
function lockVote(c){votedIndex=currentIndex;["A","B","C","D"].forEach(k=>$("#vote"+k).disabled=true);$("#vote"+c).classList.add("selected");$("#voteMsg").textContent=`✅ 已選擇 ${c}`;}

(async()=>{
  const meta=(await get(ref(db,`rooms/${roomId}/meta`))).val();
  if(!meta){$("#modeHint").textContent="找不到此房間，請重新掃描 QR Code。";$("#joinBtn").disabled=true;return}
  roomMode=meta.mode||"online";teamNames=meta.teamNames||teamNames;refreshModeUi();
  if(playerId&&playerName){$("#welcome").textContent=`歡迎 ${playerName}`;show("waiting");}
})();

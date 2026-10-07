import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js";
import { getDatabase, ref, set, update, onValue, get, onDisconnect, runTransaction } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";
import { firebaseConfig, appCheckSiteKey } from "./firebase-config.js";

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

initializeAppCheck(app, {
  provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
  isTokenAutoRefreshEnabled: true
});

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

const show=id=>["join","waiting","vote","ox","ttt","end"].forEach(x=>$("#"+x).classList.toggle("hidden",x!==id));
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

function pickTeam(t){selectedTeam=t;sessionStorage.setItem(`bible_team_${roomId}`,t);$("#pickA").classList.toggle("active",t==="A");$("#pickB").classList.toggle("active",t==="B");}
function refreshModeUi(){
  const team=roomMode==="team"||roomMode==="ttt",ox=roomMode==="ox";
  $("#teamPicker").classList.toggle("hidden",!team);
  $("#modeHint").textContent=roomMode==="team"?"⚔️ 這是兩隊競賽：輸入名字後選擇隊伍。":roomMode==="ttt"?"⭕❌ 九宮格答題戰：先選 A隊／B隊；每回合系統會隨機抽一人選格。":ox?"🕹️ 這是 OX 走位搶答：加入後用手機傾斜控制小人物。":"📱 這是手機多人模式：輸入名字後加入個人競賽。";
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
async function renderOx(m){
  clearTimer();const q=(await get(ref(db,`rooms/${roomId}/questions/${currentIndex}`))).val();if(!q)return;
  $("#oxMobileProgress").textContent=`第 ${currentIndex+1} / ${m.questionCount} 題`;
  $("#oxMobileQuestion").textContent=q.question;
  $("#phoneLeftLabel").textContent=q.oxLeft||"O";$("#phoneRightLabel").textContent=q.oxRight||"X";
  if(m.status==="revealed"){
    await sendDir("stop",true);$("#motionMsg").textContent=`✅ 正確答案：${q.answer}｜等待主持人下一題`;
    $("#oxMobileReference").textContent=q.reference?`📖 和合本：${q.reference}`:"";$("#oxMobileReference").classList.toggle("hidden",!q.reference);
    $("#oxMobileTimer").textContent="⏱ 本題結束";
  }else{
    $("#motionMsg").textContent=q.oxSwapped?"🔄 注意！這題 O／X 換邊了":"傾斜手機控制人物；回正就停止";
    $("#oxMobileReference").classList.add("hidden");runOxTimer(m.roundEndsAt);
  }
  show("ox");
}
function runOxTimer(endsAt){
  clearTimer();const tick=()=>{const ms=Math.max(0,(endsAt||0)-Date.now());$("#oxMobileTimer").textContent=`⏱ ${Math.ceil(ms/1000)} 秒`;if(ms<=0){clearTimer();sendDir("stop",true);$("#motionMsg").textContent="⏰ 時間到，位置已鎖定";}};tick();timerId=setInterval(tick,200);
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
  if(!motionEnabled||roomMode!=="ox")return;
  const g=Number(e.gamma||0);const dir=g<-12?"left":g>12?"right":"stop";sendDir(dir);
}
async function sendDir(dir,force=false){
  if(!playerId||roomMode!=="ox")return;
  const now=Date.now();if(!force&&dir===lastDir)return;if(!force&&now-lastSentAt<80)return;
  lastDir=dir;lastSentAt=now;await set(ref(db,`rooms/${roomId}/controls/${playerId}`),{dir,at:now});
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
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getDatabase, ref, set, onValue, get, onDisconnect } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

const app=getApps().length?getApp():initializeApp(firebaseConfig),db=getDatabase(app),$=s=>document.querySelector(s);
const roomId=new URLSearchParams(location.search).get("room");
if(!roomId){document.body.innerHTML='<main class="glass mobile-card"><h2>找不到房號</h2><p>請重新掃描大螢幕上的 QR Code。</p></main>';throw new Error("Missing room")}

$("#roomLabel").textContent=roomId;
let playerId=sessionStorage.getItem(`bible_player_${roomId}`)||null;
let playerName=sessionStorage.getItem(`bible_name_${roomId}`)||"";
let selectedTeam=sessionStorage.getItem(`bible_team_${roomId}`)||null;
let roomMode="online",teamNames={A:"A隊",B:"B隊"},currentIndex=-1,votedIndex=null,timerId=null;

const show=id=>["join","waiting","vote","end"].forEach(x=>$("#"+x).classList.toggle("hidden",x!==id));
const makeId=()=>crypto?.randomUUID?crypto.randomUUID():`p_${Date.now()}_${Math.random().toString(36).slice(2,9)}`;

$("#joinBtn").addEventListener("click",joinGame);
$("#nameInput").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();joinGame()}});
$("#pickA").addEventListener("click",()=>pickTeam("A"));
$("#pickB").addEventListener("click",()=>pickTeam("B"));
["A","B","C","D"].forEach(k=>$("#vote"+k).addEventListener("click",()=>cast(k)));

function pickTeam(t){selectedTeam=t;sessionStorage.setItem(`bible_team_${roomId}`,t);$("#pickA").classList.toggle("active",t==="A");$("#pickB").classList.toggle("active",t==="B");}
function refreshModeUi(){
  const team=roomMode==="team";
  $("#teamPicker").classList.toggle("hidden",!team);
  $("#modeHint").textContent=team?"⚔️ 這是兩隊競賽：輸入名字後選擇隊伍。":"📱 這是手機多人模式：輸入名字後加入個人競賽。";
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
  if(roomMode==="team"&&!selectedTeam){$("#joinMsg").textContent="請先選擇 A隊或 B隊";return}
  playerId=makeId();playerName=name;
  sessionStorage.setItem(`bible_player_${roomId}`,playerId);sessionStorage.setItem(`bible_name_${roomId}`,playerName);
  const pr=ref(db,`rooms/${roomId}/players/${playerId}`);
  await set(pr,{name:playerName,score:0,team:roomMode==="team"?selectedTeam:null,joinedAt:Date.now()});
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
    currentIndex=Number(m.currentIndex);await renderVote(m);return;
  }
  if(m.status==="ended"){
    clearTimer();const p=(await get(ref(db,`rooms/${roomId}/players/${playerId}`))).val();
    $("#myScore").textContent=p?`${p.score||0} 分`:"遊戲結束";
    if(roomMode==="team"&&p?.team){$("#teamResult").classList.remove("hidden");$("#teamResult").textContent=`${teamNames[p.team]||p.team}｜個人累積 ${p.score||0} 分`;}else $("#teamResult").classList.add("hidden");
    show("end");
  }
});

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

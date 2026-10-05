import { booksFor, buildQuestionSet, filterQuestions, DIFFICULTY_LABELS, DIFFICULTY_POINTS } from "./questions.js";

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const QUESTION_SECONDS = 30;
const CHOICES = ["A","B","C","D"];

let mode = null;
let questions = [];
let currentIndex = -1;
let timerId = null;
let roundEndsAt = 0;
let selectedChoice = null;
let revealed = false;
let soloScore = 0;
let networkApi = null;
let networkState = { players:{}, meta:{} };
let networkRevealInFlight = false;

const sections = ["home","onlineLobby","setup","game","ranking"];
function show(id){
  sections.forEach(x=>$("#"+x).classList.toggle("hidden",x!==id));
  $("#homeBtn").classList.toggle("hidden",id==="home");
}
function currentSettings(){return {testament:$("#testamentSelect").value,book:$("#bookSelect").value,difficulty:$("#difficultySelect").value};}
function isNetworkMode(){return mode==="team"||mode==="online";}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}

$$('.mode-card').forEach(btn=>btn.addEventListener('click',()=>selectMode(btn.dataset.mode)));
$("#homeBtn").addEventListener("click",goHome);
$("#backModeBtn").addEventListener("click",()=>isNetworkMode()?show("onlineLobby"):show("home"));
$("#testamentSelect").addEventListener("change",()=>{refreshBooks();refreshAvailability();});
$("#bookSelect").addEventListener("change",refreshAvailability);
$("#difficultySelect").addEventListener("change",refreshAvailability);
$("#countSelect").addEventListener("change",refreshAvailability);
$("#teamAName").addEventListener("input",syncTeamNamesToRoom);
$("#teamBName").addEventListener("input",syncTeamNamesToRoom);
$("#startGameBtn").addEventListener("click",startConfiguredGame);
$("#revealBtn").addEventListener("click",()=>isNetworkMode()?networkApi?.reveal?.():revealSolo());
$("#nextBtn").addEventListener("click",()=>isNetworkMode()?networkApi?.next?.():nextSoloQuestion());
$("#restartBtn").addEventListener("click",()=>isNetworkMode()?networkApi?.restart?.():openSetup());
$$('.choice').forEach(btn=>btn.addEventListener('click',()=>handleSoloChoice(btn.dataset.choice)));

async function selectMode(nextMode){
  mode=nextMode;
  if(mode==="solo"){
    openSetup();
    return;
  }
  show("onlineLobby");
  updateLobbyLabels();
  await ensureNetworkMode(mode);
}

function updateLobbyLabels(){
  const team = mode==="team";
  $("#lobbyModeLabel").textContent=team?"⚔️ 兩隊競賽":"📱 手機多人模式";
  $("#waitingTitle").textContent=team?"兩隊等待區":"玩家等待區";
  $("#teamLobbySummary").classList.toggle("hidden",!team);
}

function openSetup(){
  show("setup");
  $("#setupTitle").textContent=mode==="solo"?"👤 單人競技設定":mode==="team"?"⚔️ 兩隊競賽設定":"📱 手機多人設定";
  $("#teamNames").classList.toggle("hidden",mode!=="team");
  refreshBooks();
  refreshAvailability();
}

function refreshBooks(){
  const sel=$("#bookSelect"), old=sel.value;
  sel.innerHTML='<option value="all">全部經卷</option>';
  booksFor($("#testamentSelect").value).forEach(b=>{const o=document.createElement('option');o.value=b;o.textContent=b;sel.appendChild(o)});
  if([...sel.options].some(o=>o.value===old))sel.value=old;
}

function refreshAvailability(){
  const n=filterQuestions(currentSettings()).length, wanted=Number($("#countSelect").value);
  $("#questionAvailability").innerHTML=n
    ?`目前符合條件：<b>${n}</b> 題${n<wanted?`，少於設定的 ${wanted} 題，實際只會出 ${n} 題。`:""}`
    :`目前這個範圍尚未匯入《和合本》題目。請先在 <code>assets/questions.js</code> 加入已核對的題庫。`;
  $("#startGameBtn").disabled=n===0;
}

async function syncTeamNamesToRoom(){
  if(mode!=="team"||!networkApi)return;
  const names={A:$("#teamAName").value.trim()||"A隊",B:$("#teamBName").value.trim()||"B隊"};
  $("#lobbyTeamAName").textContent=names.A;$("#lobbyTeamBName").textContent=names.B;
  await networkApi.setTeamNames?.(names);
}

function startConfiguredGame(){
  const count=Number($("#countSelect").value);
  questions=buildQuestionSet(currentSettings(),count);
  if(!questions.length)return;
  currentIndex=0;soloScore=0;
  if(isNetworkMode()){
    const teamNames={A:$("#teamAName").value.trim()||"A隊",B:$("#teamBName").value.trim()||"B隊"};
    networkApi?.startGame?.({questions,settings:currentSettings(),teamNames});
    return;
  }
  show("game");
  renderSoloQuestion();
}

function renderSoloQuestion(){
  clearTimer();selectedChoice=null;revealed=false;
  const q=questions[currentIndex];if(!q)return finishSolo();
  $("#progress").textContent=`第 ${currentIndex+1} / ${questions.length} 題`;
  $("#difficultyBadge").textContent=DIFFICULTY_LABELS[q.difficulty]||q.difficulty;
  $("#bookRef").textContent=q.book?`${q.book}${q.chapter?`・第 ${q.chapter} 章`:""}`:"";
  $("#questionText").textContent=q.question;
  CHOICES.forEach((k,i)=>{const btn=$(`.choice[data-choice="${k}"]`);$("#answer"+k).textContent=q.choices?.[i]??"";btn.disabled=false;btn.classList.remove("selected","correct","wrong");$("#votes"+k).classList.add("hidden");});
  $("#status").textContent="請在 30 秒內選擇答案";
  $("#answerPanel").classList.add("hidden");$("#revealBtn").classList.remove("hidden");$("#nextBtn").classList.add("hidden");
  $("#teamScorePanel").classList.add("hidden");
  roundEndsAt=Date.now()+QUESTION_SECONDS*1000;
  runSoloTimer();
}

function runSoloTimer(){
  clearTimer();
  const tick=()=>{
    const ms=Math.max(0,roundEndsAt-Date.now());
    $("#timer").textContent=Math.ceil(ms/1000);
    $("#timerBar").style.width=`${Math.max(0,Math.min(100,ms/(QUESTION_SECONDS*1000)*100))}%`;
    if(ms<=0){clearTimer();if(!revealed)revealSolo();}
  };
  tick();timerId=setInterval(tick,200);
}
function clearTimer(){if(timerId){clearInterval(timerId);timerId=null;}}
function handleSoloChoice(choice){if(mode!=="solo"||revealed)return;selectedChoice=choice;$$('.choice').forEach(x=>x.classList.toggle('selected',x.dataset.choice===choice));$("#status").textContent=`已選擇 ${choice}，可等待時間到或按「公布答案」`;}
function revealSolo(){
  if(revealed)return;revealed=true;clearTimer();
  const q=questions[currentIndex],correct=q.answer;
  $$('.choice').forEach(btn=>{btn.disabled=true;if(btn.dataset.choice===correct)btn.classList.add('correct');if(selectedChoice===btn.dataset.choice&&selectedChoice!==correct)btn.classList.add('wrong');});
  showCorrectPanel(q);
  $("#revealBtn").classList.add("hidden");$("#nextBtn").classList.remove("hidden");
  if(selectedChoice===correct){const left=Math.max(0,Math.ceil((roundEndsAt-Date.now())/1000));const pts=(DIFFICULTY_POINTS[q.difficulty]||100)+left*10;soloScore+=pts;$("#status").textContent=`🎉 答對！+${pts} 分｜目前 ${soloScore} 分`;}
  else $("#status").textContent=`本題未答對｜目前 ${soloScore} 分`;
}
function nextSoloQuestion(){currentIndex++;currentIndex>=questions.length?finishSolo():renderSoloQuestion();}
function finishSolo(){clearTimer();show("ranking");$("#rankList").innerHTML=`<div class="rank"><span class="medal">🏆</span><span class="name">單人挑戰完成</span><strong>${soloScore} 分</strong></div>`;}

function showCorrectPanel(q){
  const i=CHOICES.indexOf(q.answer);
  $("#correctAnswer").textContent=`✅ 正確答案：${q.answer}. ${q.choices?.[i]||""}`;
  $("#scriptureRef").textContent=q.reference?`📖 和合本：${q.reference}`:"📖 和合本出處：待補";
  $("#explanation").textContent=q.explanation||"";
  $("#answerPanel").classList.remove("hidden");
}

async function ensureNetworkMode(requestedMode){
  if(networkApi){
    await networkApi.setMode(requestedMode);
    updateLobbyLabels();
    return;
  }
  try{
    const [{initializeApp,getApps,getApp},{getDatabase,ref,set,update,onValue,get,remove},configMod]=await Promise.all([
      import("https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js"),
      import("./firebase-config.js")
    ]);
    const app=getApps().length?getApp():initializeApp(configMod.firebaseConfig),db=getDatabase(app),params=new URLSearchParams(location.search);
    const randomRoom=()=>Array.from({length:5},()=>"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random()*32)]).join("");
    let roomId=params.get("room")||randomRoom();
    if(!params.get("room")){const u=new URL(location.href);u.searchParams.set("room",roomId);history.replaceState({},"",u)}
    $("#roomCode").textContent=roomId;
    const roomRef=ref(db,`rooms/${roomId}`),metaRef=ref(db,`rooms/${roomId}/meta`),playersRef=ref(db,`rooms/${roomId}/players`),votesRoot=ref(db,`rooms/${roomId}/votes`);
    if(!(await get(metaRef)).exists())await set(metaRef,{status:"waiting",mode:requestedMode,questionCount:0,currentIndex:-1,roundEndsAt:0,teamNames:{A:"A隊",B:"B隊"},createdAt:Date.now()});
    else await update(metaRef,{mode:requestedMode,status:"waiting"});

    const basePath=()=>location.pathname.replace(/\/[^/]*$/, "/");
    const mobileUrl=`${location.origin}${basePath()}mobile.html?room=${encodeURIComponent(roomId)}`;
    $("#joinUrl").textContent=mobileUrl;
    await loadQr();$("#qr").innerHTML="";new QRCode($("#qr"),{text:mobileUrl,width:220,height:220});

    const unPlayers=onValue(playersRef,s=>{networkState.players=s.val()||{};renderLobbyPlayers();if(mode==="team"&&["playing","revealed"].includes(networkState.meta.status))renderTeamScores();});
    const unMeta=onValue(metaRef,async s=>{
      networkState.meta=s.val()||{};
      const m=networkState.meta;
      if(m.mode&&isNetworkMode())mode=m.mode;
      updateLobbyLabels();
      const names=m.teamNames||{A:"A隊",B:"B隊"};
      $("#lobbyTeamAName").textContent=names.A||"A隊";$("#lobbyTeamBName").textContent=names.B||"B隊";
      if(m.status==="waiting"){if(!["setup","home"].some(id=>!$("#"+id).classList.contains("hidden")))show("onlineLobby");return;}
      if(m.status==="playing"||m.status==="revealed"){
        show("game");currentIndex=Number(m.currentIndex);
        questions=Object.values((await get(ref(db,`rooms/${roomId}/questions`))).val()||{});
        await renderNetworkQuestion(db,ref,get,roomId,m);
        return;
      }
      if(m.status==="ended")renderNetworkRanking();
    });
    const unVotes=onValue(votesRoot,()=>{if(isNetworkMode()&&["playing","revealed"].includes(networkState.meta.status))renderNetworkVotes(db,ref,get,roomId);});

    $("#onlineSetupBtn").onclick=openSetup;
    $("#newRoomBtn").onclick=()=>location.href=`${basePath()}index.html?room=${randomRoom()}`;

    networkApi={
      async setMode(next){mode=next;await update(metaRef,{mode:next,status:"waiting"});},
      async setTeamNames(names){await update(metaRef,{teamNames:names});},
      async startGame({questions:qs,settings,teamNames}){
        const u={};
        qs.forEach((q,i)=>u[`questions/${i}`]=q);
        u.votes=null;
        Object.entries(networkState.players).forEach(([id])=>u[`players/${id}/score`]=0);
        u.meta={status:"playing",mode,questionCount:qs.length,currentIndex:0,roundEndsAt:Date.now()+QUESTION_SECONDS*1000,settings,teamNames:mode==="team"?teamNames:{A:"A隊",B:"B隊"},createdAt:networkState.meta.createdAt||Date.now()};
        await update(roomRef,u);
      },
      async reveal(){await revealNetwork(db,ref,get,update,roomId,roomRef);},
      async next(){
        if(networkState.meta.status!=="revealed")return;
        const n=Number(networkState.meta.currentIndex)+1;
        if(n>=Number(networkState.meta.questionCount))await update(metaRef,{status:"ended"});
        else await update(metaRef,{status:"playing",currentIndex:n,roundEndsAt:Date.now()+QUESTION_SECONDS*1000});
      },
      async restart(){
        const u={votes:null,questions:null};
        Object.entries(networkState.players).forEach(([id])=>u[`players/${id}/score`]=0);
        u["meta/status"]="waiting";u["meta/currentIndex"]=-1;u["meta/questionCount"]=0;u["meta/roundEndsAt"]=0;
        await update(roomRef,u);show("onlineLobby");
      },
      stop(){unPlayers();unMeta();unVotes();}
    };
  }catch(err){
    $("#onlineLobby").innerHTML=`<div class="glass"><h2>無法啟動連線模式</h2><p class="muted">請確認網路連線與 Firebase 設定。單人競技仍可直接使用。</p><pre>${escapeHtml(err.message)}</pre></div>`;
  }
}

function renderLobbyPlayers(){
  const list=Object.entries(networkState.players);
  $("#playerCount").textContent=`${list.length} 人`;
  $("#players").innerHTML="";
  let a=0,b=0;
  list.sort((x,y)=>(x[1].joinedAt||0)-(y[1].joinedAt||0)).forEach(([,p])=>{
    if(p.team==="A")a++;if(p.team==="B")b++;
    const e=document.createElement("span");
    e.className=`pill${p.team?` team-${p.team.toLowerCase()}`:""}`;
    e.textContent=(p.team?`${p.team}｜`:"👤 ")+p.name;
    $("#players").appendChild(e);
  });
  $("#teamACount").textContent=`${a} 人`;$("#teamBCount").textContent=`${b} 人`;
}

async function loadQr(){
  if(window.QRCode)return;
  await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";s.onload=resolve;s.onerror=reject;document.head.appendChild(s)});
}

async function renderNetworkQuestion(db,ref,get,roomId,m){
  clearTimer();networkRevealInFlight=false;
  const snap=await get(ref(db,`rooms/${roomId}/questions/${m.currentIndex}`));const q=snap.val();if(!q)return;
  $("#progress").textContent=`第 ${Number(m.currentIndex)+1} / ${m.questionCount} 題`;
  $("#difficultyBadge").textContent=DIFFICULTY_LABELS[q.difficulty]||q.difficulty;
  $("#bookRef").textContent=q.book?`${q.book}${q.chapter?`・第 ${q.chapter} 章`:""}`:"";
  $("#questionText").textContent=q.question;
  CHOICES.forEach((k,i)=>{const b=$(`.choice[data-choice="${k}"]`);$("#answer"+k).textContent=q.choices?.[i]??"";b.disabled=true;b.classList.remove('correct','wrong','selected');$("#votes"+k).classList.remove('hidden');});
  $("#teamScorePanel").classList.toggle("hidden",mode!=="team");
  if(mode==="team")renderTeamScores();
  $("#answerPanel").classList.toggle('hidden',m.status!=="revealed");
  $("#revealBtn").classList.toggle('hidden',m.status!=="playing");
  $("#nextBtn").classList.toggle('hidden',m.status!=="revealed");
  if(m.status==="revealed"){
    showNetworkCorrect(q);
    $("#timer").textContent="0";$("#timerBar").style.width="0%";
  }else{
    $("#status").textContent="玩家作答中…";
    roundEndsAt=m.roundEndsAt;
    runNetworkTimer();
  }
  await renderNetworkVotes(db,ref,get,roomId);
}

function runNetworkTimer(){
  clearTimer();
  const tick=()=>{
    const ms=Math.max(0,roundEndsAt-Date.now());
    $("#timer").textContent=Math.ceil(ms/1000);
    $("#timerBar").style.width=`${Math.max(0,Math.min(100,ms/(QUESTION_SECONDS*1000)*100))}%`;
    if(ms<=0){clearTimer();if(networkState.meta.status==="playing"&&!networkRevealInFlight){networkRevealInFlight=true;networkApi?.reveal?.();}}
  };
  tick();timerId=setInterval(tick,200);
}

async function renderNetworkVotes(db,ref,get,roomId){
  const snap=await get(ref(db,`rooms/${roomId}/votes/${networkState.meta.currentIndex}`));const v=snap.val()||{};
  CHOICES.forEach(k=>$("#votes"+k).textContent=`${Object.values(v).filter(x=>x.choice===k).length} 票`);
}

async function revealNetwork(db,ref,get,update,roomId,roomRef){
  if(networkState.meta.status!=="playing")return;
  networkRevealInFlight=true;clearTimer();
  const idx=networkState.meta.currentIndex;
  const [qSnap,vSnap,pSnap]=await Promise.all([
    get(ref(db,`rooms/${roomId}/questions/${idx}`)),
    get(ref(db,`rooms/${roomId}/votes/${idx}`)),
    get(ref(db,`rooms/${roomId}/players`))
  ]);
  const q=qSnap.val(),v=vSnap.val()||{},players=pSnap.val()||{},u={};
  for(const [id,p] of Object.entries(players)){
    const vote=v[id];if(vote?.choice!==q.answer)continue;
    const base=DIFFICULTY_POINTS[q.difficulty]||100;
    const bonus=Math.max(0,Math.ceil(((networkState.meta.roundEndsAt||0)-(vote.at||networkState.meta.roundEndsAt||0))/1000))*10;
    u[`players/${id}/score`]=Number(p.score||0)+base+bonus;
  }
  u["meta/status"]="revealed";
  await update(roomRef,u);
}

function showNetworkCorrect(q){
  const btn=$(`.choice[data-choice="${q.answer}"]`);if(btn)btn.classList.add('correct');
  showCorrectPanel(q);
  $("#status").textContent="答案已公布；主持人按「下一題」才會繼續";
  if(mode==="team")renderTeamScores();
}

function renderTeamScores(){
  const names=networkState.meta.teamNames||{A:"A隊",B:"B隊"};
  const totals={A:0,B:0};
  Object.values(networkState.players).forEach(p=>{if(p.team==="A"||p.team==="B")totals[p.team]+=Number(p.score||0)});
  $("#teamALabel").textContent=names.A||"A隊";$("#teamBLabel").textContent=names.B||"B隊";
  $("#teamAScore").textContent=totals.A;$("#teamBScore").textContent=totals.B;
}

function renderNetworkRanking(){
  clearTimer();show("ranking");const r=$("#rankList");r.innerHTML="";
  if(mode==="team"){
    const names=networkState.meta.teamNames||{A:"A隊",B:"B隊"},totals={A:0,B:0};
    Object.values(networkState.players).forEach(p=>{if(p.team==="A"||p.team==="B")totals[p.team]+=Number(p.score||0)});
    [[names.A||"A隊",totals.A],[names.B||"B隊",totals.B]].sort((a,b)=>b[1]-a[1]).forEach((x,i)=>{r.innerHTML+=`<div class="rank"><span class="medal">${i===0?"🥇":"🥈"}</span><span class="name">${escapeHtml(x[0])}</span><strong>${x[1]} 分</strong></div>`;});
  }else{
    const arr=Object.values(networkState.players).sort((a,b)=>Number(b.score||0)-Number(a.score||0));
    arr.forEach((p,i)=>{const medal=i===0?"🥇":i===1?"🥈":i===2?"🥉":`${i+1}.`;r.innerHTML+=`<div class="rank"><span class="medal">${medal}</span><span class="name">${escapeHtml(p.name)}</span><strong>${Number(p.score||0)} 分</strong></div>`;});
  }
}

function goHome(){clearTimer();networkApi?.stop?.();networkApi=null;networkState={players:{},meta:{}};mode=null;show("home");}

show("home");refreshBooks();refreshAvailability();

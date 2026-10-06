import { booksFor, buildQuestionSet, filterQuestions, DIFFICULTY_LABELS, DIFFICULTY_POINTS } from "./questions.js";

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const QUESTION_SECONDS = 30;
const OX_SECONDS = 8;
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
let networkState = { players:{}, meta:{}, controls:{} };
let oxPositions = {};
let oxMoveTimer = null;
let oxQuestionIndex = -1;
let networkRevealInFlight = false;

const sections = ["home","onlineLobby","setup","game","ranking"];
function show(id){
  sections.forEach(x=>$("#"+x).classList.toggle("hidden",x!==id));
  $("#homeBtn").classList.toggle("hidden",id==="home");
}
function currentSettings(){return {testament:$("#testamentSelect").value,book:$("#bookSelect").value,difficulty:$("#difficultySelect").value};}
function isNetworkMode(){return mode==="team"||mode==="online"||mode==="ox";}
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
  $("#lobbyModeLabel").textContent=team?"⚔️ 兩隊競賽":mode==="ox"?"🕹️ OX 走位搶答":"📱 手機多人模式";
  $("#waitingTitle").textContent=team?"兩隊等待區":mode==="ox"?"OX 玩家等待區":"玩家等待區";
  $("#teamLobbySummary").classList.toggle("hidden",!team);
}

function openSetup(){
  show("setup");
  $("#setupTitle").textContent=mode==="solo"?"👤 單人競技設定":mode==="team"?"⚔️ 兩隊競賽設定":mode==="ox"?"🕹️ OX 走位搶答設定":"📱 手機多人設定";
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
    :`目前這個範圍尚未匯入《和合本》題目。請先在 <code>questions/</code> 加入已核對的題庫。`;
  $("#startGameBtn").disabled=n===0;
}

async function syncTeamNamesToRoom(){
  if(mode!=="team"||!networkApi)return;
  const names={A:$("#teamAName").value.trim()||"A隊",B:$("#teamBName").value.trim()||"B隊"};
  $("#lobbyTeamAName").textContent=names.A;$("#lobbyTeamBName").textContent=names.B;
  await networkApi.setTeamNames?.(names);
}

function makeOxQuestions(source){
  let swapRun=0;
  return source.map((q,i)=>{
    const correctIndex=CHOICES.indexOf(q.answer);
    const wrongIndexes=CHOICES.map((_,j)=>j).filter(j=>j!==correctIndex && q.choices?.[j]);
    const useCorrect=Math.random()<0.5 || !wrongIndexes.length;
    const pickIndex=useCorrect?correctIndex:wrongIndexes[Math.floor(Math.random()*wrongIndexes.length)];
    const picked=q.choices?.[pickIndex]??"";
    const answer=useCorrect?"O":"X";
    let swapped=Math.random()<0.30;
    if(swapRun>=2)swapped=false;
    swapRun=swapped?swapRun+1:0;
    return {...q,question:`${q.question}　答案是「${picked}」。`,answer,choices:["O 正確","X 錯誤"],oxLeft:swapped?"X":"O",oxRight:swapped?"O":"X",oxSwapped:swapped,originalAnswer:q.answer};
  });
}
function currentRoundSeconds(){return mode==="ox"?OX_SECONDS:QUESTION_SECONDS;}
function startConfiguredGame(){
  const count=Number($("#countSelect").value);
  questions=buildQuestionSet(currentSettings(),count);
  if(mode==="ox")questions=makeOxQuestions(questions);
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
    $("#timerBar").style.width=`${Math.max(0,Math.min(100,ms/(currentRoundSeconds()*1000)*100))}%`;
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
    const roomRef=ref(db,`rooms/${roomId}`),metaRef=ref(db,`rooms/${roomId}/meta`),playersRef=ref(db,`rooms/${roomId}/players`),votesRoot=ref(db,`rooms/${roomId}/votes`),controlsRef=ref(db,`rooms/${roomId}/controls`);
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
    const unVotes=onValue(votesRoot,()=>{if(isNetworkMode()&&["playing","revealed"].includes(networkState.meta.status)&&mode!=="ox")renderNetworkVotes(db,ref,get,roomId);});
    const unControls=onValue(controlsRef,s=>{networkState.controls=s.val()||{};});

    $("#onlineSetupBtn").onclick=openSetup;
    $("#newRoomBtn").onclick=()=>location.href=`${basePath()}index.html?room=${randomRoom()}`;

    networkApi={
      async setMode(next){mode=next;await update(metaRef,{mode:next,status:"waiting"});},
      async setTeamNames(names){await update(metaRef,{teamNames:names});},
      async startGame({questions:qs,settings,teamNames}){
        const u={};
        qs.forEach((q,i)=>u[`questions/${i}`]=q);
        u.votes=null;
        u.controls=null;
        Object.entries(networkState.players).forEach(([id])=>u[`players/${id}/score`]=0);
        u.meta={status:"playing",mode,questionCount:qs.length,currentIndex:0,roundEndsAt:Date.now()+currentRoundSeconds()*1000,settings,teamNames:mode==="team"?teamNames:{A:"A隊",B:"B隊"},createdAt:networkState.meta.createdAt||Date.now()};
        await update(roomRef,u);
      },
      async reveal(){await revealNetwork(db,ref,get,update,roomId,roomRef);},
      async next(){
        if(networkState.meta.status!=="revealed")return;
        const n=Number(networkState.meta.currentIndex)+1;
        if(n>=Number(networkState.meta.questionCount))await update(metaRef,{status:"ended"});
        else await update(metaRef,{status:"playing",currentIndex:n,roundEndsAt:Date.now()+currentRoundSeconds()*1000});
      },
      async restart(){
        const u={votes:null,questions:null};
        Object.entries(networkState.players).forEach(([id])=>u[`players/${id}/score`]=0);
        u["meta/status"]="waiting";u["meta/currentIndex"]=-1;u["meta/questionCount"]=0;u["meta/roundEndsAt"]=0;
        await update(roomRef,u);show("onlineLobby");
      },
      stop(){unPlayers();unMeta();unVotes();unControls();stopOxMovement();}
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
  const ox=mode==="ox";
  $("#choices").classList.toggle("hidden",ox);
  $("#oxArena").classList.toggle("hidden",!ox);
  $("#oxStats").classList.add("hidden");
  if(ox){
    $("#oxLeftLabel").textContent=q.oxLeft||"O";
    $("#oxRightLabel").textContent=q.oxRight||"X";
    $("#oxLeftZone").classList.toggle("zone-o",(q.oxLeft||"O")==="O");
    $("#oxLeftZone").classList.toggle("zone-x",(q.oxLeft||"O")==="X");
    $("#oxRightZone").classList.toggle("zone-o",(q.oxRight||"X")==="O");
    $("#oxRightZone").classList.toggle("zone-x",(q.oxRight||"X")==="X");
    if(oxQuestionIndex!==Number(m.currentIndex)){oxQuestionIndex=Number(m.currentIndex);resetOxPositions();}
    renderOxCharacters();startOxMovement();
  }else{
    stopOxMovement();
    CHOICES.forEach((k,i)=>{const b=$(`.choice[data-choice="${k}"]`);$("#answer"+k).textContent=q.choices?.[i]??"";b.disabled=true;b.classList.remove('correct','wrong','selected');$("#votes"+k).classList.remove('hidden');});
  }
  $("#teamScorePanel").classList.toggle("hidden",mode!=="team");
  if(mode==="team")renderTeamScores();
  $("#answerPanel").classList.toggle('hidden',m.status!=="revealed");
  $("#revealBtn").classList.toggle('hidden',m.status!=="playing");
  $("#nextBtn").classList.toggle('hidden',m.status!=="revealed");
  if(m.status==="revealed"){
    showNetworkCorrect(q);
    $("#timer").textContent="0";$("#timerBar").style.width="0%";
  }else{
    $("#status").textContent=mode==="ox"?(q.oxSwapped?"🔄 本題 O／X 已換邊！看清楚再走。":"📱 傾斜手機，讓小人物走進 O 或 X 區") : "玩家作答中…";
    roundEndsAt=m.roundEndsAt;
    runNetworkTimer();
  }
  if(mode!=="ox")await renderNetworkVotes(db,ref,get,roomId);
}

function runNetworkTimer(){
  clearTimer();
  const tick=()=>{
    const ms=Math.max(0,roundEndsAt-Date.now());
    $("#timer").textContent=Math.ceil(ms/1000);
    $("#timerBar").style.width=`${Math.max(0,Math.min(100,ms/(currentRoundSeconds()*1000)*100))}%`;
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
  const q=qSnap.val(),players=pSnap.val()||{},u={};
  let v=vSnap.val()||{};
  if(mode==="ox"){
    v={};
    for(const id of Object.keys(players)){
      const x=Number(oxPositions[id]?.x??50);
      const choice=x<35?(q.oxLeft||"O"):x>65?(q.oxRight||"X"):"N";
      v[id]={choice,at:Date.now()};
      u[`votes/${idx}/${id}`]=v[id];
    }
  }
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
  if(mode==="ox"){
    stopOxMovement();
    $("#oxLeftZone").classList.toggle("ox-correct",q.oxLeft===q.answer);
    $("#oxRightZone").classList.toggle("ox-correct",q.oxRight===q.answer);
    $("#correctAnswer").textContent=`✅ 正確答案：${q.answer}`;
    $("#scriptureRef").textContent=q.reference?`📖 和合本：${q.reference}`:"";
    $("#explanation").textContent=q.explanation||"";
    $("#answerPanel").classList.remove("hidden");
    renderOxStats(q);
  }else{
    const btn=$(`.choice[data-choice="${q.answer}"]`);if(btn)btn.classList.add('correct');
    showCorrectPanel(q);
  }
  $("#status").textContent="答案已公布；主持人按「下一題」才會繼續";
  if(mode==="team")renderTeamScores();
}

function resetOxPositions(){
  oxPositions={};
  const ids=Object.keys(networkState.players);
  ids.forEach((id,i)=>{oxPositions[id]={x:48+(i%5)*1.0,y:18+(i%6)*12};});
  $("#oxLeftZone")?.classList.remove("ox-correct");$("#oxRightZone")?.classList.remove("ox-correct");
}
function avatarFor(id){const a=["🧍","🧑","👩","👨","🧒","👧","👦"];let n=0;for(const c of id)n+=c.charCodeAt(0);return a[n%a.length];}
function renderOxCharacters(){
  const box=$("#oxCharacters");if(!box)return;
  const live=new Set(Object.keys(networkState.players));
  [...box.children].forEach(el=>{if(!live.has(el.dataset.id))el.remove();});
  Object.entries(networkState.players).forEach(([id,p],i)=>{
    if(!oxPositions[id])oxPositions[id]={x:50,y:18+(i%6)*12};
    let el=box.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if(!el){el=document.createElement("div");el.className="ox-person";el.dataset.id=id;el.innerHTML=`<span class="ox-avatar">${avatarFor(id)}</span><b>${escapeHtml(p.name)}</b>`;box.appendChild(el);}
    el.style.left=`${oxPositions[id].x}%`;el.style.top=`${oxPositions[id].y}%`;
  });
}
function startOxMovement(){
  if(oxMoveTimer)return;
  oxMoveTimer=setInterval(()=>{
    if(mode!=="ox"||networkState.meta.status!=="playing")return;
    for(const id of Object.keys(networkState.players)){
      if(!oxPositions[id])oxPositions[id]={x:50,y:50};
      const dir=networkState.controls[id]?.dir||"stop";
      const step=dir==="left"?-0.55:dir==="right"?0.55:0;
      oxPositions[id].x=Math.max(6,Math.min(94,oxPositions[id].x+step));
      const el=$("#oxCharacters")?.querySelector(`[data-id="${CSS.escape(id)}"]`);
      if(el){el.style.left=`${oxPositions[id].x}%`;el.classList.toggle("walking",step!==0);}
    }
  },50);
}
function stopOxMovement(){if(oxMoveTimer){clearInterval(oxMoveTimer);oxMoveTimer=null;}$("#oxCharacters")?.querySelectorAll(".walking").forEach(x=>x.classList.remove("walking"));}
function renderOxStats(q){
  const vals=Object.keys(networkState.players).map(id=>{const x=Number(oxPositions[id]?.x??50);return x<35?(q.oxLeft||"O"):x>65?(q.oxRight||"X"):"N";});
  const o=vals.filter(x=>x==="O").length,x=vals.filter(v=>v==="X").length,n=vals.filter(v=>v==="N").length,correct=vals.filter(v=>v===q.answer).length;
  const total=vals.length,rate=total?Math.round(correct/total*100):0;
  $("#oxStats").innerHTML=`<span>⭕ O：<b>${o}</b></span><span>❌ X：<b>${x}</b></span><span>⏸ 未作答：<b>${n}</b></span><span>🎯 答對率：<b>${rate}%</b></span>`;
  $("#oxStats").classList.remove("hidden");
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

function goHome(){clearTimer();networkApi?.stop?.();networkApi=null;networkState={players:{},meta:{},controls:{}};oxPositions={};oxQuestionIndex=-1;mode=null;show("home");}

show("home");refreshBooks();refreshAvailability();

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
let tttResolving = false;
let tttBuzzResolving = false;
let chainPositions = {};
let chainMoveTimer = null;
let chainAttackTimer = null;
let chainSecondTimer = null;
let chainAttackLock = false;
let dodgeRoundTimer = null;
let dodgeResolveTimer = null;
let dodgeUiTimer = null;
let dodgeResolving = false;
let inkBattleTimer = null;
let inkBattleBusy = false;
let inkBattleClash = 0;

const sections = ["home","onlineLobby","setup","game","tttGame","chainGame","dodgeGame","inkpkGame","ranking"];
function show(id){
  sections.forEach(x=>$("#"+x).classList.toggle("hidden",x!==id));
  $("#homeBtn").classList.toggle("hidden",id==="home");
}
function currentSettings(){return {testament:$("#testamentSelect").value,book:$("#bookSelect").value,difficulty:$("#difficultySelect").value};}
function isNetworkMode(){return mode==="team"||mode==="online"||mode==="ox"||mode==="ttt"||mode==="chain"||mode==="dodge"||mode==="inkpk";}
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
  const team = mode==="team"||mode==="ttt";
  $("#lobbyModeLabel").textContent=mode==="team"?"⚔️ 兩隊競賽":mode==="ox"?"🕹️ OX 走位搶答":mode==="ttt"?"⭕❌ 九宮格答題戰":mode==="chain"?"⛓️ 鎖鏈逃脫":mode==="dodge"?"💨 極限閃避":mode==="inkpk"?"✍️⚔️ 字戰 PK":"📱 手機多人模式";
  $("#waitingTitle").textContent=mode==="team"?"兩隊等待區":mode==="ox"?"OX 玩家等待區":mode==="ttt"?"九宮格兩隊等待區":mode==="chain"?"鎖鏈逃脫等待區":mode==="dodge"?"極限閃避等待區":mode==="inkpk"?"字戰 PK 等待區":"玩家等待區";
  $("#teamLobbySummary").classList.toggle("hidden",!team);
  $("#inkpkLobbyOptions")?.classList.toggle("hidden",mode!=="inkpk");
  if($("#lobbyRuleText"))$("#lobbyRuleText").textContent=mode==="inkpk"?"字戰 PK：1 位真人會自動對 AI；2 位真人互相 PK；最多 2 位真人。":"人數不限，1 人也能加入；不補 AI，不限制奇數或偶數。";
  if($("#onlineSetupBtn"))$("#onlineSetupBtn").textContent=(mode==="chain"||mode==="dodge"||mode==="inkpk")?"開始遊戲":"設定題目";
}

function openSetup(){
  show("setup");
  $("#setupTitle").textContent=mode==="solo"?"👤 單人競技設定":mode==="team"?"⚔️ 兩隊競賽設定":mode==="ox"?"🕹️ OX 走位搶答設定":mode==="ttt"?"⭕❌ 九宮格答題戰設定":mode==="chain"?"⛓️ 鎖鏈逃脫":"📱 手機多人設定";
  $("#teamNames").classList.toggle("hidden",!(mode==="team"||mode==="ttt"));
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
  if(!(mode==="team"||mode==="ttt")||!networkApi)return;
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
  questions=buildQuestionSet(currentSettings(),mode==="ttt"?Math.max(30,count):count);
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
    const [
      { initializeApp, getApps, getApp },
      { initializeAppCheck, ReCaptchaEnterpriseProvider },
      { getDatabase, ref, set, update, onValue, get, remove },
      configMod
    ] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js"),
      import("https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js"),
      import("./firebase-config.js")
    ]);

    const app = getApps().length ? getApp() : initializeApp(configMod.firebaseConfig);

    if (configMod.appCheckSiteKey) {
      initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(configMod.appCheckSiteKey),
        isTokenAutoRefreshEnabled: true
      });
    }

    const db = getDatabase(app);
    const params = new URLSearchParams(location.search);
    const randomRoom=()=>Array.from({length:5},()=>"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random()*32)]).join("");
    let roomId=params.get("room")||randomRoom();
    if(!params.get("room")){const u=new URL(location.href);u.searchParams.set("room",roomId);history.replaceState({},"",u)}
    $("#roomCode").textContent=roomId;
    const roomRef=ref(db,`rooms/${roomId}`),metaRef=ref(db,`rooms/${roomId}/meta`),playersRef=ref(db,`rooms/${roomId}/players`),votesRoot=ref(db,`rooms/${roomId}/votes`),controlsRef=ref(db,`rooms/${roomId}/controls`),tttAnswerRef=ref(db,`rooms/${roomId}/tttAnswer`),tttBuzzRef=ref(db,`rooms/${roomId}/tttBuzz`),inkpkRef=ref(db,`rooms/${roomId}/inkpk`);
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
      if(mode==="inkpk"&&m.status==="playing"){
        show("inkpkGame");
        await renderInkPkHost(db,ref,get,update,roomId,roomRef,metaRef,m);
        return;
      }
      if(mode==="dodge"&&m.status==="playing"){
        show("dodgeGame");
        renderDodgeHost(m);
        return;
      }
      if(mode==="chain"&&m.status==="playing"){
        show("chainGame");
        renderChainHost(m);
        return;
      }
      if(m.status==="playing"||m.status==="revealed"){
        questions=Object.values((await get(ref(db,`rooms/${roomId}/questions`))).val()||{});
        if(mode==="ttt"){
          show("tttGame");
          await renderTttHost(db,ref,get,roomId,m);
          return;
        }
        show("game");currentIndex=Number(m.currentIndex);
        await renderNetworkQuestion(db,ref,get,roomId,m);
        return;
      }
      if(m.status==="ended"){
        if(mode==="ttt"){show("tttGame");await renderTttHost(db,ref,get,roomId,m);return;}
        if(mode==="chain"){stopChainGame();renderNetworkRanking();return;}
        if(mode==="dodge"){stopDodgeGame();renderNetworkRanking();return;}
        if(mode==="inkpk"){stopInkBattle();show("inkpkGame");await renderInkPkHost(db,ref,get,update,roomId,roomRef,metaRef,m);return;}
        renderNetworkRanking();
      }
    });
    const unVotes=onValue(votesRoot,()=>{if(isNetworkMode()&&["playing","revealed"].includes(networkState.meta.status)&&mode!=="ox")renderNetworkVotes(db,ref,get,roomId);});
    const unControls=onValue(controlsRef,s=>{
      networkState.controls=s.val()||{};
      if(mode==="chain")checkChainEscapes(roomRef);
    });
    const unTttAnswer=onValue(tttAnswerRef,s=>{
      const ans=s.val();
      if(mode==="ttt"&&ans&&!tttResolving)resolveTttAnswer(db,ref,get,update,set,roomId,roomRef,metaRef,tttAnswerRef,ans);
    });
    const unTttBuzz=onValue(tttBuzzRef,s=>{
      const buzz=s.val();
      if(mode==="ttt"&&buzz&&!tttBuzzResolving)resolveTttBuzz(get,update,set,metaRef,tttBuzzRef,tttAnswerRef,buzz);
    });
    const unInkPk=onValue(inkpkRef,async s=>{
      if(mode!=="inkpk")return;
      const data=s.val()||{};
      if(networkState.meta.status==="playing"&&networkState.meta.inkpk?.phase==="draw"){
        await maybeStartInkBattle(get,update,roomId,roomRef,metaRef,data);
      }
    });

    $("#onlineSetupBtn").onclick=()=>mode==="chain"?networkApi?.startChain?.():mode==="dodge"?networkApi?.startDodge?.():mode==="inkpk"?networkApi?.startInkPk?.():openSetup();
    $("#newRoomBtn").onclick=()=>location.href=`${basePath()}index.html?room=${randomRoom()}`;

    networkApi={
      async setMode(next){mode=next;await update(metaRef,{mode:next,status:"waiting"});},
      async setTeamNames(names){await update(metaRef,{teamNames:names});},
      async startInkPk(){
        const humans=Object.entries(networkState.players||{}).filter(([,p])=>!p.ai);
        if(humans.length<1||humans.length>2){alert("字戰 PK 支援 1 位真人對 AI，或 2 位真人 PK。");return;}
        const missing=humans.filter(([,p])=>!p.inkColor);
        if(missing.length){alert("請真人玩家先選擇屬性顏色。");return;}

        stopInkBattle();
        const difficulty=$("#inkpkDifficultySelect")?.value||"easy";
        const dInfo=inkDifficultyInfo(difficulty);
        const char=dInfo.pool[Math.floor(Math.random()*dInfo.pool.length)];
        const now=Date.now();
        const u={votes:null,questions:null,controls:null,inkpk:null,"players/__ai__":null};

        humans.forEach(([id])=>{
          u[`players/${id}/score`]=0;
          u[`players/${id}/inkPower`]=100;
        });

        if(humans.length===1){
          const colors=["blue","red","green","black","yellow"];
          const aiColor=colors[Math.floor(Math.random()*colors.length)];
          const completion=Number((0.7+Math.random()*0.3).toFixed(4));
          const accuracy=completion;
          const power=Number(Math.max(20,Math.min(200,100+completion*100-(1-accuracy)*100)).toFixed(2));
          u["players/__ai__"]={name:"AI 電腦",score:0,inkColor:aiColor,joinedAt:now+1,ai:true,inkPower:power};
          u.inkpk={submissions:{"__ai__":{
            name:"AI 電腦",color:aiColor,power,completion,accuracy,
            image:makeAiGlyphImage(char,aiColor),submittedAt:now+100,ai:true
          }}};
        }

        u.meta={
          status:"playing",mode:"inkpk",questionCount:0,currentIndex:-1,roundEndsAt:now+15000,
          teamNames:{A:"A隊",B:"B隊"},createdAt:networkState.meta.createdAt||now,
          inkpk:{
            phase:"draw",char,difficulty,difficultyLabel:dInfo.label,difficultyMult:dInfo.mult,
            drawEndsAt:now+15000,winner:"",clash:0,hp:{},vsAI:humans.length===1
          }
        };
        await update(roomRef,u);
      },
      async startDodge(){
        const ids=Object.keys(networkState.players||{});
        if(!ids.length){alert("請至少讓 1 位玩家加入後再開始。");return;}
        stopDodgeGame();
        const u={votes:null,questions:null,controls:null};
        ids.forEach(id=>{
          u[`players/${id}/score`]=0;
          u[`players/${id}/alive`]=true;
          u[`players/${id}/dodgeLastRound`]=0;
          u[`players/${id}/dodgeAction`]="";
        });
        u.meta={
          status:"playing",mode:"dodge",questionCount:0,currentIndex:-1,roundEndsAt:0,
          teamNames:{A:"A隊",B:"B隊"},createdAt:networkState.meta.createdAt||Date.now(),
          dodge:{round:0,required:"",command:"",startsAt:Date.now()+1200,endsAt:Date.now()+3200,speedMs:2400,phase:"ready"}
        };
        await update(roomRef,u);
        startDodgeGame(db,ref,get,update,roomId,roomRef,metaRef);
      },
      async startChain(){
        const ids=Object.keys(networkState.players||{});
        if(!ids.length){alert("請至少讓 1 位玩家加入後再開始。");return;}
        stopChainGame();
        chainPositions={};
        const u={votes:null,questions:null,controls:null};
        ids.forEach((id,i)=>{
          u[`players/${id}/score`]=0;
          u[`players/${id}/chained`]=false;
          u[`players/${id}/chainHits`]=0;
          u[`players/${id}/chainEscapes`]=0;
          chainPositions[id]={x:18+(i%5)*16,y:20+(i%4)*18};
        });
        u.meta={
          status:"playing",mode:"chain",questionCount:0,currentIndex:-1,
          roundEndsAt:Date.now()+45000,teamNames:{A:"A隊",B:"B隊"},
          createdAt:networkState.meta.createdAt||Date.now(),
          chain:{attackSeq:0,warningZone:"",strikeZone:"",warningUntil:0,lastStrikeAt:0}
        };
        await update(roomRef,u);
        startChainGame(db,ref,get,update,roomId,roomRef,metaRef);
      },
      async startGame({questions:qs,settings,teamNames}){
        if(mode==="ttt"){
          const hasA=Object.values(networkState.players||{}).some(p=>p.team==="A");
          const hasB=Object.values(networkState.players||{}).some(p=>p.team==="B");
          if(!hasA||!hasB){alert("九宮格答題戰需要 A隊、B隊至少各 1 位玩家。");return;}
        }
        const u={};
        qs.forEach((q,i)=>u[`questions/${i}`]=q);
        u.votes=null;
        u.controls=null;
        u.tttAnswer=null;
        u.tttBuzz=null;
        Object.entries(networkState.players).forEach(([id])=>u[`players/${id}/score`]=0);
        if(mode==="ttt"){
          const picker=pickRandomTeamPlayer("A");
          u.meta={
            status:"playing",mode,questionCount:qs.length,currentIndex:0,roundEndsAt:0,settings,
            teamNames,createdAt:networkState.meta.createdAt||Date.now(),
            ttt:{
              board:{c0:"",c1:"",c2:"",c3:"",c4:"",c5:"",c6:"",c7:"",c8:""},
              turnTeam:"A",attackingTeam:"A",answeringTeam:"A",phase:"pick",
              pickerId:picker?.id||"",pickerName:picker?.name||"等待 A隊玩家",
              selectedCell:-1,questionIndex:0,winner:"",feedback:"A隊先攻"
            }
          };
        }else{
          u.meta={status:"playing",mode,questionCount:qs.length,currentIndex:0,roundEndsAt:Date.now()+currentRoundSeconds()*1000,settings,teamNames:mode==="team"?teamNames:{A:"A隊",B:"B隊"},createdAt:networkState.meta.createdAt||Date.now()};
        }
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
        stopChainGame();stopDodgeGame();stopInkBattle();
        const u={votes:null,questions:null,tttAnswer:null,tttBuzz:null,controls:null,inkpk:null,"players/__ai__":null};
        Object.entries(networkState.players).forEach(([id,p])=>{if(!p.ai)u[`players/${id}/score`]=0;});
        u["meta/status"]="waiting";u["meta/currentIndex"]=-1;u["meta/questionCount"]=0;u["meta/roundEndsAt"]=0;
        await update(roomRef,u);show("onlineLobby");
      },
      stop(){unPlayers();unMeta();unVotes();unControls();unTttAnswer();unTttBuzz();unInkPk();stopOxMovement();stopChainGame();stopDodgeGame();stopInkBattle();}
    };
  }catch(err){
    $("#onlineLobby").innerHTML=`<div class="glass"><h2>無法啟動連線模式</h2><p class="muted">請確認網路連線與 Firebase 設定。單人競技仍可直接使用。</p><pre>${escapeHtml(err.message)}</pre></div>`;
  }
}


function otherTeam(t){return t==="A"?"B":"A";}
function teamName(t){const n=networkState.meta?.teamNames||{A:"A隊",B:"B隊"};return n[t]||`${t}隊`;}
function pickRandomTeamPlayer(team){
  const arr=Object.entries(networkState.players||{}).filter(([,p])=>p.team===team).map(([id,p])=>({id,name:p.name||"玩家"}));
  return arr.length?arr[Math.floor(Math.random()*arr.length)]:null;
}
function tttBoardFrom(meta){
  const b=meta?.ttt?.board||{};
  return Array.from({length:9},(_,i)=>b[`c${i}`]||"");
}
function tttWinner(board){
  const lines=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for(const line of lines){
    const v=board[line[0]];
    if(v&&line.every(i=>board[i]===v))return {team:v,line};
  }
  return null;
}
function setTttBoardVisual(board,winLine=[]){
  $$("#tttBoard button").forEach((b,i)=>{
    const v=board[i];
    b.textContent=v==="A"?"⭕":v==="B"?"❌":String(i+1);
    b.classList.toggle("team-a",v==="A");
    b.classList.toggle("team-b",v==="B");
    b.classList.toggle("winning",winLine.includes(i));
  });
}
async function renderTttHost(db,ref,get,roomId,m){
  const t=m.ttt||{};
  const board=tttBoardFrom(m);
  const win=tttWinner(board);
  setTttBoardVisual(board,win?.line||[]);
  if(Number(t.selectedCell)>=0&&["answer","steal"].includes(t.phase||"")){
    $(`#tttBoard button[data-cell="${Number(t.selectedCell)}"]`)?.classList.add("ttt-selected");
  }
  $("#tttAName").textContent=(m.teamNames?.A||"A隊");
  $("#tttBName").textContent=(m.teamNames?.B||"B隊");
  $("#tttWinnerBanner").classList.add("hidden");
  $("#tttBackLobbyBtn").classList.add("hidden");
  $("#tttAnswerPanel").classList.add("hidden");
  $("#tttChoices").classList.add("hidden");

  const phase=t.phase||"pick";
  const attack=t.attackingTeam||t.turnTeam||"A";
  const answerTeam=t.answeringTeam||attack;
  const picker=t.pickerName||"";
  const names=m.teamNames||{A:"A隊",B:"B隊"};

  if(phase==="pick"){
    $("#tttPhaseBadge").textContent="選格";
    $("#tttTurnTitle").textContent=`${names[t.turnTeam]||t.turnTeam} 回合`;
    $("#tttPickerText").textContent=picker?`🎲 本回合隨機選格者：${picker}`:"等待該隊玩家加入";
    $("#tttQuestionNo").textContent="";
    $("#tttQuestionText").textContent="請看手機，由被抽中的隊員選擇要攻擊的空格。";
    $("#tttStatus").textContent="空格若之前雙方都答錯，可以再次選擇進攻。";
    if(t.feedback){
      $("#tttAnswerPanel").classList.remove("hidden");
      $("#tttCorrectAnswer").textContent=t.feedback;
      $("#tttReference").textContent=t.lastReference?`📖 ${t.lastReference}`:"";
      $("#tttExplanation").textContent=t.lastExplanation||"";
    }
    return;
  }

  if(phase==="won"){
    const winner=t.winner||win?.team;
    $("#tttPhaseBadge").textContent="勝利";
    $("#tttTurnTitle").textContent="遊戲結束";
    $("#tttPickerText").textContent="";
    $("#tttQuestionText").textContent="";
    $("#tttStatus").textContent="已完成三格連線！";
    $("#tttWinnerBanner").textContent=`🏆 ${names[winner]||winner} 獲勝！`;
    $("#tttWinnerBanner").classList.remove("hidden");
    $("#tttBackLobbyBtn").classList.remove("hidden");
    return;
  }

  if(phase==="tiebreakBuzz"){
    $("#tttPhaseBadge").textContent="平手搶答";
    $("#tttTurnTitle").textContent="⚡ 九宮格平手！進入搶答決勝";
    $("#tttPickerText").textContent="兩隊手機都會出現「搶答」按鈕";
    $("#tttQuestionText").textContent="先搶到的玩家取得第一回答權。";
    $("#tttStatus").textContent="若第一隊答錯，回答權直接交給另一隊。";
    return;
  }

  const qi=Number(t.questionIndex||0);
  const q=(await get(ref(db,`rooms/${roomId}/questions/${qi}`))).val();
  if(!q){
    $("#tttQuestionText").textContent="題庫不足，請重新開始並選擇有足夠題目的範圍。";
    return;
  }
  $("#tttQuestionNo").textContent=`題庫題號 ${qi+1}`;
  $("#tttQuestionText").textContent=q.question;
  ["A","B","C","D"].forEach((k,i)=>$("#ttt"+k).textContent=q.choices?.[i]||"");
  $("#tttChoices").classList.remove("hidden");

  if(phase==="answer"){
    $("#tttPhaseBadge").textContent="攻格答題";
    $("#tttTurnTitle").textContent=`${names[attack]||attack} 攻擊第 ${Number(t.selectedCell)+1} 格`;
    $("#tttPickerText").textContent=`由 ${names[attack]||attack} 先回答`;
    $("#tttStatus").textContent=`${names[answerTeam]||answerTeam} 作答中；該隊第一個送出的答案會被採用。`;
  }else if(phase==="steal"){
    $("#tttPhaseBadge").textContent="接答反攻";
    $("#tttTurnTitle").textContent=`${names[attack]||attack} 答錯，${names[answerTeam]||answerTeam} 接答！`;
    $("#tttPickerText").textContent=`答對可直接搶走第 ${Number(t.selectedCell)+1} 格`;
    $("#tttStatus").textContent=`${names[answerTeam]||answerTeam} 作答中。`;
  }else if(phase==="tiebreakAnswer"){
    $("#tttPhaseBadge").textContent="搶答作答";
    $("#tttTurnTitle").textContent=t.tiebreakSecondChance?`${names[answerTeam]||answerTeam} 接答機會`:`⚡ ${t.buzzPlayerName||"玩家"} 搶到回答權`;
    $("#tttPickerText").textContent=t.tiebreakSecondChance?"第一隊答錯，改由另一隊回答同一題。":`${names[answerTeam]||answerTeam} 先回答`;
    $("#tttStatus").textContent=`${names[answerTeam]||answerTeam} 作答中。`;
  }
  if(t.feedback){
    $("#tttAnswerPanel").classList.remove("hidden");
    $("#tttCorrectAnswer").textContent=t.feedback;
    $("#tttReference").textContent=t.lastReference?`📖 ${t.lastReference}`:"";
    $("#tttExplanation").textContent=t.lastExplanation||"";
  }
}
async function resolveTttAnswer(db,ref,get,update,set,roomId,roomRef,metaRef,tttAnswerRef,ans){
  tttResolving=true;
  try{
    const meta=(await get(metaRef)).val()||{};
    if(meta.mode!=="ttt"||meta.status!=="playing"){await set(tttAnswerRef,null);return;}
    const t=meta.ttt||{};
    if(!["answer","steal","tiebreakAnswer"].includes(t.phase)){await set(tttAnswerRef,null);return;}
    if(ans.team!==t.answeringTeam){await set(tttAnswerRef,null);return;}
    if(t.phase==="tiebreakAnswer"&&!t.tiebreakSecondChance&&t.buzzPlayerId&&ans.playerId!==t.buzzPlayerId){await set(tttAnswerRef,null);return;}

    const qi=Number(t.questionIndex||0);
    const q=(await get(ref(db,`rooms/${roomId}/questions/${qi}`))).val();
    if(!q){await set(tttAnswerRef,null);return;}
    const correct=ans.choice===q.answer;
    const names=meta.teamNames||{A:"A隊",B:"B隊"};
    const feedback=`${correct?"✅":"❌"} ${ans.name||names[ans.team]||ans.team} 回答 ${ans.choice}；正確答案是 ${q.answer}`;
    const baseUpdates={
      "ttt/feedback":feedback,
      "ttt/lastReference":q.reference||"",
      "ttt/lastExplanation":q.explanation||""
    };

    if(t.phase==="tiebreakAnswer"){
      if(correct){
        await update(metaRef,{...baseUpdates,status:"ended","ttt/phase":"won","ttt/winner":ans.team});
        await set(tttAnswerRef,null); return;
      }
      if(!t.tiebreakSecondChance){
        await update(metaRef,{...baseUpdates,"ttt/answeringTeam":otherTeam(ans.team),"ttt/tiebreakSecondChance":true});
        await set(tttAnswerRef,null); return;
      }
      const nextQi=(qi+1)%Math.max(1,Number(meta.questionCount||1));
      await update(metaRef,{...baseUpdates,"ttt/phase":"tiebreakBuzz","ttt/questionIndex":nextQi,"ttt/answeringTeam":"","ttt/buzzPlayerId":"","ttt/buzzPlayerName":"","ttt/tiebreakSecondChance":false});
      await set(tttAnswerRef,null);
      await set(ref(db,`rooms/${roomId}/tttBuzz`),null);
      return;
    }

    const attack=t.attackingTeam||t.turnTeam;
    const nextTeam=otherTeam(attack);
    const board=tttBoardFrom(meta);

    if(correct){
      board[Number(t.selectedCell)]=ans.team;
      const win=tttWinner(board);
      const updates={...baseUpdates};
      board.forEach((v,i)=>updates[`ttt/board/c${i}`]=v||"");
      if(win){
        updates.status="ended";updates["ttt/phase"]="won";updates["ttt/winner"]=win.team;
        await update(metaRef,updates);await set(tttAnswerRef,null);return;
      }
      if(board.every(Boolean)){
        updates["ttt/phase"]="tiebreakBuzz";updates["ttt/questionIndex"]=(qi+1)%Math.max(1,Number(meta.questionCount||1));
        updates["ttt/answeringTeam"]="";updates["ttt/buzzPlayerId"]="";updates["ttt/buzzPlayerName"]="";updates["ttt/tiebreakSecondChance"]=false;
        await update(metaRef,updates);await set(tttAnswerRef,null);await set(ref(db,`rooms/${roomId}/tttBuzz`),null);return;
      }
      const picker=pickRandomTeamPlayer(nextTeam);
      Object.assign(updates,{
        "ttt/phase":"pick","ttt/turnTeam":nextTeam,"ttt/attackingTeam":nextTeam,"ttt/answeringTeam":nextTeam,
        "ttt/pickerId":picker?.id||"","ttt/pickerName":picker?.name||`等待 ${names[nextTeam]||nextTeam} 玩家`,
        "ttt/selectedCell":-1,"ttt/questionIndex":(qi+1)%Math.max(1,Number(meta.questionCount||1))
      });
      await update(metaRef,updates);await set(tttAnswerRef,null);return;
    }

    if(t.phase==="answer"){
      await update(metaRef,{...baseUpdates,"ttt/phase":"steal","ttt/answeringTeam":otherTeam(attack)});
      await set(tttAnswerRef,null);return;
    }

    // steal also wrong -> cell remains empty and opponent gets next formal turn
    const picker=pickRandomTeamPlayer(nextTeam);
    await update(metaRef,{...baseUpdates,
      "ttt/phase":"pick","ttt/turnTeam":nextTeam,"ttt/attackingTeam":nextTeam,"ttt/answeringTeam":nextTeam,
      "ttt/pickerId":picker?.id||"","ttt/pickerName":picker?.name||`等待 ${names[nextTeam]||nextTeam} 玩家`,
      "ttt/selectedCell":-1,"ttt/questionIndex":(qi+1)%Math.max(1,Number(meta.questionCount||1))
    });
    await set(tttAnswerRef,null);
  }finally{tttResolving=false;}
}
async function resolveTttBuzz(get,update,set,metaRef,tttBuzzRef,tttAnswerRef,buzz){
  tttBuzzResolving=true;
  try{
    const metaSnap=await get(metaRef);
    const meta=metaSnap.val()||{};
    const t=meta.ttt||{};
    if(meta.mode!=="ttt"||meta.status!=="playing"||t.phase!=="tiebreakBuzz")return;
    await update(metaRef,{
      "ttt/phase":"tiebreakAnswer",
      "ttt/answeringTeam":buzz.team,
      "ttt/buzzPlayerId":buzz.playerId,
      "ttt/buzzPlayerName":buzz.name||"玩家",
      "ttt/tiebreakSecondChance":false,
      "ttt/feedback":`⚡ ${buzz.name||"玩家"} 搶到回答權！`
    });
    await set(tttAnswerRef,null);
  }finally{tttBuzzResolving=false;}
}



const INK_DIFFICULTY={
  easy:{label:"簡單",mult:1.00,pool:["光","愛","信","恩","道","羊"]},
  normal:{label:"普通",mult:1.15,pool:["平安","盼望","生命","真理","恩典","福音"]},
  hard:{label:"困難",mult:1.30,pool:["以馬內利","哈利路亞","伯利恆","加利利","耶路撒冷","客西馬尼"]},
  heaven:{label:"上天堂",mult:1.50,pool:["愛是恆久忍耐","你們是世上的光","主是我的牧者","我就是道路真理生命","起初神創造天地"]}
};
function inkDifficultyInfo(key){return INK_DIFFICULTY[key]||INK_DIFFICULTY.easy;}
function makeAiGlyphImage(text,color){
  const fill=INK_COLOR_HEX[color]||"#111827";
  const safe=String(text||"光").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]));
  const len=[...String(text||"")].length;
  const size=len<=1?220:len<=2?135:len<=4?86:len<=7?58:46;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320"><rect width="320" height="320" rx="18" fill="white"/><text x="160" y="166" text-anchor="middle" dominant-baseline="middle" font-size="${size}" font-weight="900" font-family="sans-serif" fill="${fill}">${safe}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
const INK_COLOR_HEX={blue:"#3b82f6",red:"#ef4444",green:"#22c55e",black:"#111827",yellow:"#facc15"};
function inkColorName(c){return {blue:"藍色",red:"紅色",green:"綠色",black:"黑色",yellow:"黃色"}[c]||c;}
function inkColorMultiplier(attacker,defender){
  if(attacker==="black"){
    if(defender==="yellow")return 1.4;
    return 1.5;
  }
  if(defender==="black"){
    return attacker==="yellow"?1.5:1.5;
  }
  if(attacker==="yellow"){
    return 1.0;
  }
  if(defender==="yellow"&&["blue","red","green"].includes(attacker)){
    return 0.5;
  }
  const beats={blue:"red",red:"green",green:"blue"};
  if(beats[attacker]===defender)return 1.4;
  if(beats[defender]===attacker)return 0.8;
  return 1.0;
}
function stopInkBattle(){
  if(inkBattleTimer){clearInterval(inkBattleTimer);inkBattleTimer=null;}
  inkBattleBusy=false;inkBattleClash=0;
}
function setInkFighterUi(slot,p,sub,hp,maxHp,enemyColor){
  const n=slot===1?1:2;
  $(`#inkpkName${n}`).textContent=p?.name||`玩家 ${n}`;
  const dot=$(`#inkpkColor${n}`);dot.style.background=INK_COLOR_HEX[p?.inkColor]||"#999";dot.title=inkColorName(p?.inkColor);
  const pct=Math.max(0,Math.min(100,(Number(hp||0)/Math.max(1,Number(maxHp||1)))*100));
  $(`#inkpkHp${n}`).style.width=`${pct}%`;
  $(`#inkpkHpText${n}`).textContent=`戰力 ${Math.max(0,Math.round(Number(hp||0)))}`;
  $(`#inkpkComplete${n}`).textContent=`完整度 ${Math.round(Number(sub?.completion||0)*100)}%`;
  const img=$(`#inkpkGlyph${n}`);
  if(sub?.image){img.src=sub.image;img.classList.remove("hidden");}else{img.removeAttribute("src");img.classList.add("hidden");}
  const cm=inkColorMultiplier(p?.inkColor,enemyColor);
  const dm=Number(networkState.meta?.inkpk?.difficultyMult||1);
  const final=cm*Number(sub?.completion||0)*dm;
  $(`#inkpkMult${n}`).textContent=`屬性 ${cm.toFixed(2)} × 完整度 ${Number(sub?.completion||0).toFixed(2)} × 難度 ${dm.toFixed(2)} ＝ 攻擊 ${final.toFixed(2)}×`;
}
async function renderInkPkHost(db,ref,get,update,roomId,roomRef,metaRef,m){
  const ip=m.inkpk||{},phase=ip.phase||"draw";
  $("#inkpkHostChar").textContent=ip.char||"勇";
  $("#inkpkHostChar").style.fontSize=[...(ip.char||"勇")].length<=2?"56px":[...(ip.char||"勇")].length<=5?"34px":"22px";
  $("#inkpkRuleHint").textContent=`難度：${ip.difficultyLabel||"簡單"}（${Number(ip.difficultyMult||1).toFixed(2)}×）｜15 秒描寫；完整度會直接乘上攻擊倍率${ip.vsAI?"｜本局為 AI 對戰":""}`;
  $("#inkpkWinner").classList.add("hidden");
  $("#inkpkRestartBtn").classList.add("hidden");
  const ps=(await get(ref(db,`rooms/${roomId}/players`))).val()||{};
  const ids=Object.keys(ps).sort((a,b)=>(ps[a].joinedAt||0)-(ps[b].joinedAt||0));
  const subs=(await get(ref(db,`rooms/${roomId}/inkpk/submissions`))).val()||{};
  const a=ids[0],b=ids[1];
  if(!a||!b){
    $("#inkpkHostStatus").textContent="等待兩位玩家加入";
    return;
  }
  const hp=ip.hp||{};
  const maxHp=ip.maxHp||{};
  setInkFighterUi(1,ps[a],subs[a],phase==="draw"?(subs[a]?.power||100):(hp[a]??subs[a]?.power??100),maxHp[a]??subs[a]?.power??100,ps[b]?.inkColor);
  setInkFighterUi(2,ps[b],subs[b],phase==="draw"?(subs[b]?.power||100):(hp[b]??subs[b]?.power??100),maxHp[b]??subs[b]?.power??100,ps[a]?.inkColor);

  if(phase==="draw"){
    const done=Object.keys(subs).filter(id=>ids.includes(id)).length;
    $("#inkpkHostStatus").textContent=`描字中：${done}/2 已完成`;
    $("#inkpkClashText").textContent="15 秒描寫中";
    return;
  }
  if(phase==="battle"){
    $("#inkpkHostStatus").textContent="⚔️ 字正在碰撞對戰！";
    $("#inkpkClashText").textContent=`第 ${Number(ip.clash||0)+1} 次碰撞`;
    if(!inkBattleTimer)startInkBattleLoop(get,update,roomId,roomRef,metaRef,ids);
    return;
  }
  if(phase==="ended"){
    stopInkBattle();
    const winner=ip.winner;
    $("#inkpkHostStatus").textContent="對戰結束";
    $("#inkpkClashText").textContent="FINISH";
    $("#inkpkWinner").textContent=winner==="draw"?"🤝 平手！":`🏆 ${ps[winner]?.name||"玩家"} 獲勝！`;
    $("#inkpkWinner").classList.remove("hidden");
    $("#inkpkRestartBtn").classList.remove("hidden");
  }
}
async function maybeStartInkBattle(get,update,roomId,roomRef,metaRef,data){
  if(networkState.meta.inkpk?.phase!=="draw")return;
  const ps=(await get(ref(db,`rooms/${roomId}/players`))).val()||{};
  const ids=Object.keys(ps).sort((a,b)=>(ps[a].joinedAt||0)-(ps[b].joinedAt||0));
  if(ids.length!==2)return;
  const subs=data.submissions||{};
  if(!subs[ids[0]]||!subs[ids[1]])return;
  const hp={},maxHp={};
  ids.forEach(id=>{
    const v=Math.max(1,Number(subs[id].power||100));
    hp[id]=v;maxHp[id]=v;
  });
  await update(metaRef,{"inkpk/phase":"battle","inkpk/hp":hp,"inkpk/maxHp":maxHp,"inkpk/clash":0});
}
function startInkBattleLoop(get,update,roomId,roomRef,metaRef,ids){
  stopInkBattle();inkBattleClash=0;
  inkBattleTimer=setInterval(async()=>{
    if(inkBattleBusy||mode!=="inkpk"||networkState.meta.status!=="playing"||networkState.meta.inkpk?.phase!=="battle")return;
    inkBattleBusy=true;
    try{
      const [pSnap,sSnap,mSnap]=await Promise.all([
        get(ref(db,`rooms/${roomId}/players`)),
        get(ref(db,`rooms/${roomId}/inkpk/submissions`)),
        get(metaRef)
      ]);
      const ps=pSnap.val()||{},subs=sSnap.val()||{},meta=mSnap.val()||{},ip=meta.inkpk||{};
      const [a,b]=ids;
      if(!a||!b||!subs[a]||!subs[b])return;
      let ha=Number(ip.hp?.[a]??subs[a].power??100),hb=Number(ip.hp?.[b]??subs[b].power??100);
      const ca=Number(subs[a].completion||0),cb=Number(subs[b].completion||0);
      const dm=Number(ip.difficultyMult||1);
      const ma=inkColorMultiplier(ps[a]?.inkColor,ps[b]?.inkColor)*ca*dm;
      const mb=inkColorMultiplier(ps[b]?.inkColor,ps[a]?.inkColor)*cb*dm;
      const dmgA=8*ma,dmgB=8*mb;
      const beforeA=ha,beforeB=hb;
      hb=Math.max(0,hb-dmgA);
      ha=Math.max(0,ha-dmgB);
      inkBattleClash=Number(ip.clash||0)+1;
      $("#inkpkFighter1").classList.add("ink-clash-left");
      $("#inkpkFighter2").classList.add("ink-clash-right");
      setTimeout(()=>{$("#inkpkFighter1")?.classList.remove("ink-clash-left");$("#inkpkFighter2")?.classList.remove("ink-clash-right");},260);
      $("#inkpkClashText").textContent=`💥 -${dmgA.toFixed(1)} / -${dmgB.toFixed(1)}`;

      const u={"inkpk/hp":{[a]:ha,[b]:hb},"inkpk/clash":inkBattleClash};
      let winner="";
      if(ha<=0||hb<=0||inkBattleClash>=40){
        if(ha<=0&&hb<=0)winner="draw";
        else if(ha<=0)winner=b;
        else if(hb<=0)winner=a;
        else if(ha===hb)winner="draw";
        else winner=ha>hb?a:b;
        u["inkpk/phase"]="ended";u["inkpk/winner"]=winner;
      }
      await update(metaRef,u);
      if(winner)stopInkBattle();
    }finally{inkBattleBusy=false;}
  },850);
}
const DODGE_ACTIONS=[
  {action:"left",icon:"⬅️",text:"往左閃！",from:"right"},
  {action:"right",icon:"➡️",text:"往右閃！",from:"left"},
  {action:"up",icon:"⬆️",text:"往上閃！",from:"bottom"},
  {action:"down",icon:"⬇️",text:"往下閃！",from:"top"},
  {action:"jump",icon:"🦘",text:"小跳一下！",from:"front"}
];

function dodgeActionInfo(action){return DODGE_ACTIONS.find(x=>x.action===action)||DODGE_ACTIONS[0];}
function renderDodgePlayers(){
  const box=$("#dodgePlayers");if(!box)return;
  const live=new Set(Object.keys(networkState.players||{}));
  [...box.children].forEach(el=>{if(!live.has(el.dataset.id))el.remove();});
  Object.entries(networkState.players||{}).forEach(([id,p],i)=>{
    let el=box.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if(!el){
      el=document.createElement("div");el.className="dodge-person";el.dataset.id=id;
      const x=18+(i%5)*16,y=18+(Math.floor(i/5)%4)*19;
      el.style.left=`${x}%`;el.style.top=`${y}%`;
      el.innerHTML=`<span>${avatarFor(id)}</span><b>${escapeHtml(p.name||"玩家")}</b>`;
      box.appendChild(el);
    }
    el.classList.toggle("out",p.alive===false);
    el.classList.toggle("alive",p.alive!==false);
  });
}
function renderDodgeScoreboard(){
  const box=$("#dodgeScoreboard");if(!box)return;
  const arr=Object.values(networkState.players||{}).sort((a,b)=>Number(b.score||0)-Number(a.score||0));
  box.innerHTML=arr.map(p=>`<div><b>${p.alive===false?"💥":"🟢"} ${escapeHtml(p.name||"玩家")}</b><span>${Number(p.score||0)} 分</span><small>${p.alive===false?"已出局":"存活中"}</small></div>`).join("");
}
function renderDodgeHost(m){
  const d=m.dodge||{},info=dodgeActionInfo(d.required||"left");
  $("#dodgeRound").textContent=Number(d.round||0);
  const speed=Math.max(1,2400/Math.max(900,Number(d.speedMs||2400)));
  $("#dodgeSpeed").textContent=`${speed.toFixed(1)}×`;
  $("#dodgeCommandIcon").textContent=d.phase==="active"?info.icon:"READY";
  $("#dodgeCommandText").textContent=d.phase==="active"?info.text:"準備下一波";
  $("#dodgeStatus").textContent=d.phase==="active"?"照提示用手機動作閃避！":"注意下一個障礙";
  renderDodgePlayers();renderDodgeScoreboard();

  const ob=$("#dodgeObstacle");
  if(d.phase==="active"){
    ob.className=`dodge-obstacle incoming from-${info.from}`;
    ob.textContent=info.from==="front"?"💥":"🧱";
    ob.style.setProperty("--dodge-duration",`${Math.max(.6,Number(d.speedMs||1800)/1000)}s`);
    ob.classList.remove("hidden");
  }else ob.classList.add("hidden");

  if(!dodgeUiTimer){
    dodgeUiTimer=setInterval(()=>{
      const meta=networkState.meta||{},dd=meta.dodge||{};
      if(mode!=="dodge"||meta.status!=="playing")return;
      const total=Math.max(1,Number(dd.endsAt||0)-Number(dd.startsAt||0));
      const left=Math.max(0,Number(dd.endsAt||0)-Date.now());
      $("#dodgeProgressBar").style.width=`${Math.max(0,Math.min(100,left/total*100))}%`;
    },50);
  }
}
function chooseDodgeAction(round){
  // avoid too many jumps in a row and make all five actions appear over time
  const pool=DODGE_ACTIONS;
  return pool[(round+Math.floor(Math.random()*pool.length))%pool.length];
}
async function startDodgeGame(db,ref,get,update,roomId,roomRef,metaRef){
  stopDodgeGame();
  const nextRound=async()=>{
    if(mode!=="dodge"||networkState.meta.status!=="playing")return;
    const playersSnap=await get(ref(db,`rooms/${roomId}/players`));
    const players=playersSnap.val()||{};
    const aliveIds=Object.entries(players).filter(([,p])=>p.alive!==false).map(([id])=>id);
    if(!aliveIds.length){
      await update(metaRef,{status:"ended","dodge/phase":"ended"});stopDodgeGame();return;
    }

    const prevRound=Number(networkState.meta.dodge?.round||0);
    const round=prevRound+1;
    const speedMs=Math.max(950,2400-(round-1)*90);
    const info=chooseDodgeAction(round);
    const clearActions={};
    aliveIds.forEach(id=>clearActions[`players/${id}/dodgeAction`]="");
    await update(roomRef,clearActions);
    const now=Date.now(),endsAt=now+speedMs;
    await update(metaRef,{
      "dodge/round":round,"dodge/required":info.action,"dodge/command":info.text,
      "dodge/startsAt":now,"dodge/endsAt":endsAt,"dodge/speedMs":speedMs,"dodge/phase":"active"
    });

    dodgeResolveTimer=setTimeout(async()=>{
      if(mode!=="dodge"||networkState.meta.status!=="playing")return;
      const ps=(await get(ref(db,`rooms/${roomId}/players`))).val()||{};
      const updates={};
      let survivors=0;
      for(const [id,p] of Object.entries(ps)){
        if(p.alive===false)continue;
        const ok=p.dodgeAction===info.action && Number(p.dodgeLastRound||0)===round;
        if(ok){
          survivors++;
          updates[`players/${id}/score`]=Number(p.score||0)+100+round*5;
        }else{
          updates[`players/${id}/alive`]=false;
        }
      }
      updates["meta/dodge/phase"]="resolved";
      await update(roomRef,updates);
      renderDodgePlayers();renderDodgeScoreboard();
      if(survivors<=0||round>=30){
        setTimeout(async()=>{await update(metaRef,{status:"ended","dodge/phase":"ended"});stopDodgeGame();},900);
      }else{
        dodgeRoundTimer=setTimeout(nextRound,Math.max(380,850-round*12));
      }
    },speedMs);
  };
  dodgeRoundTimer=setTimeout(nextRound,1200);
}
function stopDodgeGame(){
  if(dodgeRoundTimer){clearTimeout(dodgeRoundTimer);dodgeRoundTimer=null;}
  if(dodgeResolveTimer){clearTimeout(dodgeResolveTimer);dodgeResolveTimer=null;}
  if(dodgeUiTimer){clearInterval(dodgeUiTimer);dodgeUiTimer=null;}
  $("#dodgeObstacle")?.classList.add("hidden");
  if($("#dodgeProgressBar"))$("#dodgeProgressBar").style.width="0%";
}
function chainZoneForX(x){return x<35?"left":x>65?"right":"center";}
function chainZoneLabel(z){return z==="left"?"左側":z==="right"?"右側":"中央";}
function resetChainPositions(){
  const ids=Object.keys(networkState.players||{});
  ids.forEach((id,i)=>{if(!chainPositions[id])chainPositions[id]={x:18+(i%5)*16,y:18+(i%4)*19};});
}
function renderChainPlayers(){
  const box=$("#chainPlayers");if(!box)return;
  resetChainPositions();
  const live=new Set(Object.keys(networkState.players||{}));
  [...box.children].forEach(el=>{if(!live.has(el.dataset.id))el.remove();});
  Object.entries(networkState.players||{}).forEach(([id,p],i)=>{
    let el=box.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if(!el){
      el=document.createElement("div");el.className="chain-person";el.dataset.id=id;
      el.innerHTML=`<span class="chain-person-avatar">${avatarFor(id)}</span><b>${escapeHtml(p.name||"玩家")}</b><small class="chain-person-state"></small>`;
      box.appendChild(el);
    }
    const pos=chainPositions[id]||{x:50,y:50};
    el.style.left=`${pos.x}%`;el.style.top=`${pos.y}%`;
    el.classList.toggle("is-chained",!!p.chained);
    const st=el.querySelector(".chain-person-state");
    if(st)st.textContent=p.chained?"⛓️ 被鎖住":"";
  });
}
function renderChainScores(){
  const box=$("#chainScores");if(!box)return;
  const rows=Object.values(networkState.players||{}).sort((a,b)=>(b.score||0)-(a.score||0));
  box.innerHTML=rows.map(p=>`<div><b>${escapeHtml(p.name||"玩家")}</b><span>${Number(p.score||0)} 分</span><small>被抓 ${Number(p.chainHits||0)} 次・掙脫 ${Number(p.chainEscapes||0)} 次</small></div>`).join("");
}
function renderChainHost(m){
  const ms=Math.max(0,Number(m.roundEndsAt||0)-Date.now());
  $("#chainTimer").textContent=Math.ceil(ms/1000);
  $("#chainStatus").textContent=m.chain?.warningZone?`⚠️ ${chainZoneLabel(m.chain.warningZone)}即將遭到鎖鏈攻擊！`:"左右移動，躲開鎖鏈！";
  renderChainPlayers();
  renderChainScores();
  if(!chainMoveTimer)startChainGameMovement();
}
function startChainGameMovement(){
  if(chainMoveTimer)return;
  chainMoveTimer=setInterval(()=>{
    if(mode!=="chain"||networkState.meta.status!=="playing")return;
    resetChainPositions();
    for(const [id,p] of Object.entries(networkState.players||{})){
      const pos=chainPositions[id];if(!pos)continue;
      if(p.chained)continue;
      const dir=networkState.controls[id]?.dir||"stop";
      const step=dir==="left"?-0.65:dir==="right"?0.65:0;
      pos.x=Math.max(6,Math.min(94,pos.x+step));
      const el=$("#chainPlayers")?.querySelector(`[data-id="${CSS.escape(id)}"]`);
      if(el){el.style.left=`${pos.x}%`;el.classList.toggle("walking",step!==0);}
    }
  },50);
}
async function checkChainEscapes(roomRef){
  if(mode!=="chain"||networkState.meta.status!=="playing")return;
  const u={};
  for(const [id,p] of Object.entries(networkState.players||{})){
    if(!p.chained)continue;
    const progress=Number(networkState.controls[id]?.shakeProgress||0);
    if(progress>=8){
      u[`players/${id}/chained`]=false;
      u[`players/${id}/chainEscapes`]=Number(p.chainEscapes||0)+1;
      u[`players/${id}/score`]=Number(p.score||0)+5;
      u[`controls/${id}/shakeProgress`]=0;
    }
  }
  if(Object.keys(u).length)await update(roomRef,u);
}
function showChainWarning(zone){
  const w=$("#chainWarning"),s=$("#chainStrike");
  w.textContent=`⚠️ ${chainZoneLabel(zone)}鎖鏈來了！`;
  w.dataset.zone=zone;w.classList.remove("hidden");
  s.classList.add("hidden");
  $("#chainArena")?.setAttribute("data-warning-zone",zone);
}
function showChainStrike(zone){
  $("#chainWarning")?.classList.add("hidden");
  const s=$("#chainStrike");s.textContent="⛓️⛓️⛓️";s.dataset.zone=zone;s.classList.remove("hidden");
  $("#chainArena")?.setAttribute("data-strike-zone",zone);
  setTimeout(()=>{s.classList.add("hidden");$("#chainArena")?.removeAttribute("data-strike-zone");},650);
}
function startChainGame(db,ref,get,update,roomId,roomRef,metaRef){
  stopChainGame();
  startChainGameMovement();
  const scheduleAttack=()=>{
    if(mode!=="chain"||networkState.meta.status!=="playing")return;
    const zones=["left","center","right"];
    const zone=zones[Math.floor(Math.random()*zones.length)];
    showChainWarning(zone);
    update(metaRef,{"chain/warningZone":zone,"chain/warningUntil":Date.now()+900});
    chainAttackTimer=setTimeout(async()=>{
      if(mode!=="chain"||networkState.meta.status!=="playing")return;
      showChainStrike(zone);
      const u={};
      for(const [id,p] of Object.entries(networkState.players||{})){
        const pos=chainPositions[id]||{x:50};
        if(p.chained)continue;
        if(chainZoneForX(pos.x)===zone){
          u[`players/${id}/chained`]=true;
          u[`players/${id}/chainHits`]=Number(p.chainHits||0)+1;
          u[`controls/${id}/shakeProgress`]=0;
        }else{
          u[`players/${id}/score`]=Number(p.score||0)+10;
        }
      }
      u["meta/chain/warningZone"]="";
      u["meta/chain/strikeZone"]=zone;
      u["meta/chain/lastStrikeAt"]=Date.now();
      u["meta/chain/attackSeq"]=Number(networkState.meta.chain?.attackSeq||0)+1;
      await update(roomRef,u);
      chainAttackTimer=setTimeout(scheduleAttack,2100+Math.floor(Math.random()*900));
    },900);
  };
  chainAttackTimer=setTimeout(scheduleAttack,1400);
  chainSecondTimer=setInterval(async()=>{
    if(mode!=="chain"||networkState.meta.status!=="playing")return;
    const left=Number(networkState.meta.roundEndsAt||0)-Date.now();
    if(left<=0){
      stopChainGame();
      await update(metaRef,{status:"ended","chain/warningZone":"","chain/strikeZone":""});
      return;
    }
    $("#chainTimer").textContent=Math.ceil(left/1000);
    renderChainScores();
  },250);
}
function stopChainGame(){
  if(chainMoveTimer){clearInterval(chainMoveTimer);chainMoveTimer=null;}
  if(chainAttackTimer){clearTimeout(chainAttackTimer);chainAttackTimer=null;}
  if(chainSecondTimer){clearInterval(chainSecondTimer);chainSecondTimer=null;}
  $("#chainWarning")?.classList.add("hidden");
  $("#chainStrike")?.classList.add("hidden");
  $("#chainPlayers")?.querySelectorAll(".walking").forEach(x=>x.classList.remove("walking"));
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

$("#tttBackLobbyBtn")?.addEventListener("click",()=>networkApi?.restart?.());

$("#chainRestartBtn")?.addEventListener("click",()=>networkApi?.restart?.());

$("#dodgeRestartBtn")?.addEventListener("click",()=>networkApi?.restart?.());

$("#inkpkRestartBtn")?.addEventListener("click",()=>networkApi?.restart?.());

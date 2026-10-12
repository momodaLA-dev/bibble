import { initializeApp,getApps,getApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { initializeAppCheck,ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js";
import { getDatabase,ref,set,update,onValue,get,onDisconnect } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";
import * as configMod from "./firebase-config.js";
const app=getApps().length?getApp():initializeApp(configMod.firebaseConfig);
if(configMod.appCheckSiteKey)initializeAppCheck(app,{provider:new ReCaptchaEnterpriseProvider(configMod.appCheckSiteKey),isTokenAutoRefreshEnabled:true});
const db=getDatabase(app),$=s=>document.querySelector(s),roomId=new URLSearchParams(location.search).get("room");
if(!roomId){document.body.innerHTML="<main class='glass mobile-card'><h2>找不到房號</h2></main>";throw new Error("room");}
$("#umRoom").textContent=roomId;
let pid=sessionStorage.getItem(`uc_player_${roomId}`)||null,name=sessionStorage.getItem(`uc_name_${roomId}`)||"",meta={},players={};
function show(id){["umJoin","umWait","umSecret","umVote","umEnd"].forEach(x=>$("#"+x).classList.toggle("hidden",x!==id));}
async function join(){
  const n=$("#umName").value.trim().slice(0,12);if(!n){$("#umMsg").textContent="請輸入名字";return;}
  const ms=await get(ref(db,`undercoverRooms/${roomId}/meta`));if(!ms.exists()){$("#umMsg").textContent="房間不存在";return;}
  if(ms.val().status!=="waiting"){$("#umMsg").textContent="這局已開始";return;}
  pid=crypto.randomUUID?.()||`p_${Date.now()}_${Math.random().toString(36).slice(2)}`;name=n;
  sessionStorage.setItem(`uc_player_${roomId}`,pid);sessionStorage.setItem(`uc_name_${roomId}`,name);
  const pr=ref(db,`undercoverRooms/${roomId}/players/${pid}`);await set(pr,{name,joinedAt:Date.now(),voted:false});onDisconnect(pr).remove();
  $("#umWelcome").textContent=name;show("umWait");
}
onValue(ref(db,`undercoverRooms/${roomId}/players`),s=>{players=s.val()||{};if(meta.status==="voting")renderVoteButtons();if(meta.status==="describe"&&pid)refreshSpeechButton();});
onValue(ref(db,`undercoverRooms/${roomId}/meta`),async s=>{meta=s.val()||{};await renderState();});
async function renderState(){
  if(!pid){show("umJoin");return;}
  if(meta.status==="waiting"){show("umWait");$("#umWelcome").textContent=name;return;}
  if(meta.status==="describe"){
    const sec=(await get(ref(db,`undercoverRooms/${roomId}/secrets/${pid}`))).val();
    const p=players[pid]||(await get(ref(db,`undercoverRooms/${roomId}/players/${pid}`))).val()||{};
    const isBlank=sec?.role==="blank";
    $("#umPlayerNumber").textContent=sec?.playerNumber||p.playerNumber||"--";
    $("#umCategory").textContent=isBlank?"":`類別：${sec?.category||"聖經"}`;
    $("#umWord").textContent=isBlank?"":(sec?.word||"");
    hideSecret();
    $("#umOrderHint").textContent=isBlank
      ?"你是白板：查看區會保持空白。請根據其他人的描述臨場發揮。"
      :"按住「查看身分」才能看到秘密詞；放開後會立即隱藏。";
    show("umSecret");
    refreshSpeechButton();
    return;
  }
  if(meta.status==="voting"){show("umVote");renderVoteButtons();return;}
  if(meta.status==="result"){
    show("umEnd");
    const under=new Set(meta.undercoverIds||[]),blank=new Set(meta.blankIds||[]);
    const amUnder=under.has(pid),amBlank=blank.has(pid);
    $("#umEndIcon").textContent=amBlank?"⬜":amUnder?"🕵️":"🎭";
    $("#umEndTitle").textContent=amBlank?"你是白板":amUnder?"你是臥底":"你是平民";
    $("#umEndDetail").textContent=`平民詞：${meta.civilian||""}｜臥底詞：${meta.undercover||""}`;
  }
}
function showSecret(){
  $("#umSecretPeek").classList.remove("uc-secret-hidden");
}
function hideSecret(){
  $("#umSecretPeek").classList.add("uc-secret-hidden");
}
function refreshSpeechButton(){
  const p=players[pid]||{};
  const btn=$("#umSpokenBtn");
  if(!btn)return;
  btn.disabled=!!p.spoken;
  btn.textContent=p.spoken?"✅ 已發言":"✅ 發言完畢";
}
async function markSpoken(){
  if(!pid||meta.status!=="describe")return;
  await update(ref(db,`undercoverRooms/${roomId}/players/${pid}`),{spoken:true,spokenAt:Date.now()});
  $("#umOrderHint").textContent="已標記發言完畢，大螢幕上的你的號碼已暗掉。";
  refreshSpeechButton();
}
function renderVoteButtons(){
  const box=$("#umVoteButtons");if(!box)return;
  box.innerHTML=Object.entries(players).filter(([id])=>id!==pid).map(([id,p])=>`<button class="secondary full" data-vote-id="${id}">${escapeHtml(p.name||"玩家")}</button>`).join("");
  box.querySelectorAll("[data-vote-id]").forEach(b=>b.addEventListener("click",()=>vote(b.dataset.voteId)));
  get(ref(db,`undercoverRooms/${roomId}/votes/${pid}`)).then(s=>{if(s.exists()){$("#umVoteMsg").textContent=`你已投給 ${players[s.val().targetId]?.name||"玩家"}`;box.querySelectorAll("button").forEach(b=>b.disabled=true);}});
}
function escapeHtml(v){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
async function vote(targetId){
  const vr=ref(db,`undercoverRooms/${roomId}/votes/${pid}`),old=await get(vr);if(old.exists())return;
  await set(vr,{targetId,at:Date.now()});await update(ref(db,`undercoverRooms/${roomId}/players/${pid}`),{voted:true});
  $("#umVoteMsg").textContent=`你已投給 ${players[targetId]?.name||"玩家"}`;$("#umVoteButtons").querySelectorAll("button").forEach(b=>b.disabled=true);
}
$("#umJoinBtn").onclick=join;
const revealBtn=$("#umRevealBtn");
["pointerdown","touchstart","mousedown"].forEach(ev=>revealBtn?.addEventListener(ev,e=>{e.preventDefault();showSecret();}));
["pointerup","pointercancel","pointerleave","touchend","touchcancel","mouseup"].forEach(ev=>revealBtn?.addEventListener(ev,e=>{e.preventDefault();hideSecret();}));
$("#umSpokenBtn")?.addEventListener("click",markSpoken);
window.addEventListener("blur",hideSecret);
document.addEventListener("visibilitychange",()=>{if(document.hidden)hideSecret();});
if(pid){name=sessionStorage.getItem(`uc_name_${roomId}`)||"";$("#umWelcome").textContent=name;}

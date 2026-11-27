/* =========================================================================
   알람 — 마감 + 세부 점검시각
   ========================================================================= */
import {S} from './state.js';
import {STORE, invoke} from './store.js';
import {$, esc, showToast} from './dom-utils.js';
import {fmtT} from './datetime.js';
import {persist} from './render.js';
import {openModal, closeModal} from './modals.js';
import {logWarn, logged} from './logs.js';

function saveSettings(){ window.SETTINGS=S.settings; STORE.saveSettings(S.settings); }

/* AudioContext는 재사용 — 알람마다 새로 만들면 브라우저 엔진의 동시 생성
   상한(약 6개)에 걸려 몇 번 울린 뒤부터 소리가 조용히 죽는다 */
let _audioCtx=null;
function beep(){ try{ const ctx=_audioCtx=_audioCtx||new (window.AudioContext||window.webkitAudioContext)(); if(ctx.state==='suspended')ctx.resume(); const g=ctx.createGain(); g.connect(ctx.destination); g.gain.value=.15;
  [0,.28].forEach(t=>{const o=ctx.createOscillator();o.type='sine';o.frequency.value=880;o.connect(g);o.start(ctx.currentTime+t);o.stop(ctx.currentTime+t+.16);}); }catch(e){ logWarn('alarm-beep', e); } }
let firedNow=[];
export function checkAlarms(){
  if(!S.settings.alarmOn) return;
  if($('alarmBg').classList.contains('on')) return;   // F5: 모달이 이미 떠 있으면 재알림 금지
  const now=Date.now(); const fire=[];
  const test=(obj,key,iso,label,title)=>{ if(!iso)return; const t=new Date(iso).getTime(); if(isNaN(t)||now<t)return;
    obj.al=obj.al||{}; const st=obj.al[key]; if(st===true)return; if(typeof st==='number'&&now<st)return; fire.push({obj,key,label,title,iso}); };
  S.items.forEach(it=>{ if(it.done)return;
    test(it,'due',(it.f||{}).due,'기한',it.memo||'');
    (it.subs||[]).forEach(s=>{ if(!s.done)test(s,'mid',s.mid,'중간점검',s.title); });
    for(const a of fire) if(a.itemId==null){ a.itemId=it.id; if(a.key==='mid') a.subId=a.obj.id; }   // [확인]이 번호로 다시 찾는다(acknowledge)
  });
  if(!fire.length)return; firedNow=fire;
  /* v3.6.2: 알림창도 카드(v2.5.12)처럼 메모의 첫 줄만 보여준다 — 여러 줄 메모가 통째로
     떠서 알림창이 길어지던 문제. 세부 점검(title)은 원래 한 줄이라 영향 없음. */
  $('alarmList').innerHTML=fire.map(a=>`<div class="a-item ${a.key==='due'?'a-due':'a-mid'}"><b>${a.label}</b>${esc((a.title||'').split(/\r?\n/)[0].trim()||'(메모 없음)')}<span class="num">${fmtT(a.iso)}</span></div>`).join('');
  openModal('alarmBg',{close:()=>$('alarmOk').click()}); beep(); try{window.focus();}catch{} startTitleFlash(fire.length);
  invoke('focus_main_window').catch(logged('alarm-focus-main')); // window.focus() can't steal OS focus from another app; this can
  invoke('alarm_attention',{on:true}).catch(logged('alarm-attention-on')); // v2.5.3 작업표시줄 깜빡임 + 빨간 배지 (확인 전까지 유지)
  if('Notification'in window&&Notification.permission==='granted'){ fire.forEach(a=>{try{
    const nt=new Notification('뭐하려 했더라 · '+a.label,{body:a.title||'',tag:'wmhh-'+a.key+'-'+a.iso});
    nt.onclick=()=>{ try{window.focus();}catch{} try{nt.close();}catch{} };
  }catch(e){ logWarn('alarm-notification', e); }}); }
}
/* 점검 라운드 5: [확인]은 알림이 울릴 때의 객체가 아니라 **지금** 업무 목록에서 번호로 다시 찾은 업무·하위 업무에 적는다.
   알림창이 떠 있는 동안 목록이 통째로 바뀌면(JSON 복원 — 파일 고르기 창을 연 사이 알림이 울린 경우) 옛 객체에 적혀, 새 객체에는 확인이
   없어 20초 뒤 같은 알림이 다시 울렸다. 그 시각이 그새 바뀌었으면(본 알림과 다른 알림) 적지 않는다 — 새 시각에 다시 울린다. */
function acknowledgeTarget(a){
  const it=S.items.find(x=>x.id===a.itemId);
  if(!it || it.done) return null;
  if(a.key==='due') return (it.f||{}).due===a.iso ? it : null;
  const s=(it.subs||[]).find(x=>x.id===a.subId);
  return s && s.mid===a.iso ? s : null;
}
let _titleFlash=null, _baseTitle='';
function startTitleFlash(n){
  stopTitleFlash();
  let on=false;
  _titleFlash=setInterval(()=>{ on=!on; document.title = on ? `알림 ${n}건, 확인하세요` : _baseTitle; },900);
}
function stopTitleFlash(){ if(_titleFlash){ clearInterval(_titleFlash); _titleFlash=null; } document.title=_baseTitle; }
/* v3.7.0: 알람 켜기/끄기는 헤더 버튼이 아니라 설정 팝업의 '알림' 세그먼트에서 한다(소유자 지정).
   설정 쪽(settings-menu.js)이 저장한 뒤 이 함수를 불러 '끌 때의 뒷정리'를 맡긴다 —
   떠 있는 알림창 닫기·제목 깜빡임 중지·작업 표시줄 배지 걷기. */
let attentionOff=()=>{};
export function applyAlarmOn(){
  if(S.settings.alarmOn) return;
  closeModal('alarmBg'); firedNow=[]; stopTitleFlash(); attentionOff();
}

export function initAlarms(){
  _baseTitle=document.title;
  // 창을 다시 보면 깜빡임 중지
  window.addEventListener('focus',stopTitleFlash);
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden) stopTitleFlash(); });
  /* v2.5.3: 확인·미룸·알람 끔이 작업표시줄 배지도 함께 걷는다 (미룸은 재울림 때 다시 켜짐) */
  attentionOff=()=>invoke('alarm_attention',{on:false}).catch(logged('alarm-attention-off'));
  $('alarmOk').addEventListener('click',()=>{ firedNow.forEach(a=>{ const o=acknowledgeTarget(a); if(o){ o.al=o.al||{}; o.al[a.key]=true; } }); firedNow=[]; closeModal('alarmBg'); stopTitleFlash(); attentionOff(); persist(); });
  /* v2.5.11: '10분 뒤 다시'(스누즈) 기능 제거 — 알람창은 [확인]만. 옛 데이터의 snooze-until
     값은 Rust가 계속 디코드하고 카드 점은 '울림'으로 접어 표시하므로 호환 문제 없음. */
  setInterval(checkAlarms,20000); setTimeout(checkAlarms,2500);
}

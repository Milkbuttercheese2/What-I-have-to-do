/* =========================================================================
   엔트리 — 모듈 와이어링 + 전역 단축키 + 탭 + 시계 + 초기 로드
   규칙: 기능 모듈에는 최상위 실행문을 두지 않는다(리스너·인터벌은 전부 init*()).
   render↔form, render↔calendar 순환 import는 함수 선언만 오가므로 이 규칙이
   지켜지는 동안 안전하다.
   ========================================================================= */
import {S, reconcileCore, migrateItem} from './state.js';
import {STORE} from './store.js';
import {$, initToast, appAlert} from './dom-utils.js';
import {initDtDelegation} from './datetime.js';
import {initForm, closeForm, toInbox, contactsFromTags, refreshTagHl} from './form.js';
import {initPresets, renderPresets} from './presets.js';
import {initRender, render, renderDone} from './render.js';
import {initCalendar, renderCal} from './calendar.js';
import {initAlarms} from './alarms.js';
import {initBackup, reconcileImported} from './backup.js';
import {initCapture, sendCaptureConfig} from './capture-bridge.js';
import {initSettingsMenu, closeSettings, syncSettings} from './settings-menu.js';
import {initRecurBox, runRecurSpawn} from './recur-box.js';
import {initPhonebook, renderPhonebook} from './phonebook.js';
import {initAtComplete} from './at-complete.js';
import {makeItem} from './state.js';
import {setPlaceMode, placeMode} from './placement.js';
import {initUiScale, applyUiScale} from './ui-scale.js';
import {applyTheme} from './theme.js';
import {initQuit} from './quit.js';

reconcileCore();
/* 콘솔 디버깅용 전역 미러 (읽기 전용 용도 — 코드는 항상 S를 본다) */
window.items=S.items; window.FIELDS=S.fields; window.PRESETS=S.presets;
window.ID_KINDS=S.idKinds; window.SETTINGS=S.settings;

initToast(); initDtDelegation(); initForm(); initPresets();
initRender(); initCalendar(); initAlarms(); initBackup(); initCapture();
initSettingsMenu(); initRecurBox(); initUiScale();
initPhonebook(); initAtComplete(); initQuit();
renderPresets();

/* 탭 */
document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>{
  document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('on',x===t));
  const v=t.dataset.view;
  $('view-board').style.display=v==='board'&&placeMode()==='time'?'grid':'none';
  $('view-board5').style.display=v==='board'&&placeMode()==='owner'?'grid':'none';
  $('strip').style.display=v==='board'?'flex':'none';
  $('view-cal').classList.toggle('on',v==='cal');
  $('view-done').classList.toggle('on',v==='done');
  $('view-phone').classList.toggle('on',v==='phone');
  $('capture').style.display=v==='board'?'block':'none';
  if(v==='cal')renderCal(); if(v==='done')renderDone(); if(v==='phone')renderPhonebook();
}));
/* '완료 전체 비우기' 제거됨 */

/* 커스텀 타이틀바 (v2.5.1) — decorations:false 메인 창의 최소화·최대화·닫기.
   닫기는 close() → Rust CloseRequested 핸들러가 closeToTray 설정대로 트레이 숨김/종료 결정.
   __TAURI__.window 는 지연 접근(테스트·일반 브라우저에서 죽지 않게). */
{
  const tbWin=()=>window.__TAURI__.window.getCurrentWindow();
  const tbSafe=fn=>()=>{ try{ fn().catch(()=>{}); }catch{} };
  $('tbMin').addEventListener('click', tbSafe(()=>tbWin().minimize()));
  $('tbMax').addEventListener('click', tbSafe(()=>tbWin().toggleMaximize()));
  $('tbClose').addEventListener('click', tbSafe(()=>tbWin().close()));
  /* v2.5.11: 타이틀바 빈 영역 더블클릭 = 최대화/복원 토글 (전체화면 ↔ 컴팩트로 줄이기).
     버튼(─ □ ×) 더블클릭은 제외. */
  document.querySelector('.titlebar').addEventListener('dblclick', e=>{
    if(e.target.closest('.tb-btn')) return;
    tbSafe(()=>tbWin().toggleMaximize())();
  });
}

/* 보드 모드 선택 (시간 | 시간·담당자) — settings.boardMode 로 영속.
   헤더 모드 필(v2.5.0)이 산만하다 하여 v2.5.6에서 [설정] 메뉴의 팝업으로 이동. */
document.body.appendChild($('boardModeModal'));   // 어느 탭에서든 뜨도록 body 직속
function syncBoardModeSel(m){ [...$('boardModeModal').querySelectorAll('.bm-opt')].forEach(x=>x.classList.toggle('on', x.dataset.mode===m)); }
function closeBoardModeModal(){ $('boardModeModal').classList.remove('on'); }
$('boardModeBtn').addEventListener('click',()=>{ syncBoardModeSel(S.settings.boardMode==='owner'?'owner':'time'); $('boardModeModal').classList.add('on'); });
$('boardModeClose').addEventListener('click', closeBoardModeModal);
$('boardModeModal').addEventListener('click',e=>{
  const b=e.target.closest('.bm-opt');
  if(b){ const m=b.dataset.mode;
    if((S.settings.boardMode||'time')!==m){ S.settings.boardMode=m; STORE.saveSettings(S.settings); setPlaceMode(m); render(); }
    syncBoardModeSel(m); return;                 // 선택 즉시 적용, 모달은 열어둔다
  }
  if(e.target.id==='boardModeModal') closeBoardModeModal();   // 배경 클릭 닫기
});

/* Ctrl+S = '저장'으로 통일 (v2.5.22): 열려 있는 편집 화면을 저장한다.
   양식 팝업 > 주기 업무 > 프리셋 순으로 위에 떠 있는 것부터, 아무것도 없으면 JSON 백업. */
document.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey) && (e.key==='s'||e.key==='S')){
    e.preventDefault();
    if($('formPanel').classList.contains('on')){ $('fm-save').click(); }
    else if($('recurModal').classList.contains('on')){ $('rc-save').click(); }
    else if($('presetModal').classList.contains('on')){ $('np-save').click(); }
    /* v2.6.4: 바로 입력칸에 쓰는 중이면 그 메모를 등록한다 — 커서가 그 칸에 있는데
       Ctrl+S 가 백업 파일 대화상자를 띄우면 '저장'이라는 말과 어긋난다. */
    else if(document.activeElement===$('inp') && $('inp').value.trim()){ toInbox(); }
    else { $('bkExp').click(); }
  }
});
/* Ctrl+Enter 도 '저장' — 바로 입력(#inp)에 익숙해진 손을 양식·모달에서도 그대로 쓰게
   (v2.5.22, 사용자 요청). 아무 편집 화면도 없으면 아무 일도 하지 않는다(백업 실행 금지).
   #inp 의 Ctrl+Enter=등록은 form.js 가 따로 처리한다. IME 조합 중은 무시. */
document.addEventListener('keydown',e=>{
  if(e.key!=='Enter'||!(e.ctrlKey||e.metaKey)||e.isComposing||e.keyCode===229) return;
  if($('formPanel').classList.contains('on')){ e.preventDefault(); $('fm-save').click(); }
  else if($('recurModal').classList.contains('on')){ e.preventDefault(); $('rc-save').click(); }
  else if($('presetModal').classList.contains('on')){ e.preventDefault(); $('np-save').click(); }
});
/* F14: ESC 로 팝업 닫기. 배경 클릭 닫기는 드래그 선택 시 오작동하므로 의도적으로 제외.
   알람 모달은 명시적 확인이 필요하므로 대상에서 제외. */
document.addEventListener('keydown',e=>{
  if(e.key!=='Escape') return;
  /* v2.11.0: 양식 위에 뜨는 팝업(관련 업무 z70 등)을 먼저 닫는다 — 예전 순서(양식 먼저)는
     칩 팝업이 떠 있는데 ESC 가 밑의 양식을 닫아버리는 역전이었다. */
  if($('relModal').classList.contains('on')){ $('relModal').classList.remove('on'); return; }
  if($('pbSyncModal').classList.contains('on')){ $('pbSyncModal').classList.remove('on'); return; }
  if($('formPanel').classList.contains('on')){ closeForm(); return; }
  if($('presetModal').classList.contains('on')){ $('presetModal').classList.remove('on'); return; }
  if($('boardModeModal').classList.contains('on')){ closeBoardModeModal(); return; }
  if($('settingsModal').classList.contains('on')){ closeSettings(); return; }
});

function tickClock(){ const n=new Date();
  $('clock').textContent=String(n.getHours()).padStart(2,'0')+':'+String(n.getMinutes()).padStart(2,'0');
  const days=['일','월','화','수','목','금','토']; $('today').textContent=`${n.getFullYear()}. ${n.getMonth()+1}. ${n.getDate()} (${days[n.getDay()]})`; }
setInterval(tickClock,1000); tickClock();
/* 주기 업무: 자정 넘김·장시간 실행 대비 주기적으로 도래분 생성 */
setInterval(()=>{ if(S.loaded) runRecurSpawn(); }, 60000);

/* =========================================================================
   초기 로드 — SQLite에서 자동 불러오기
   ========================================================================= */
(async()=>{
  try{
    const loaded  = (await STORE.load()).map(migrateItem);
    const pending = S.items.slice();                   // 로드 대기 중 사용자가 입력한 항목
    S.items = loaded.concat(pending.filter(p => !loaded.some(l => l.id === p.id)));
    window.items = S.items;
    S.loaded = true;                                   // F1: 이제부터 저장 허용
    reconcileImported();
    /* 보드 모드 복원 (v2.5.0) — 저장된 boardMode 반영 후 아래 render()가 그린다 */
    const bm = S.settings.boardMode==='owner' ? 'owner' : 'time';
    setPlaceMode(bm); syncBoardModeSel(bm);
    /* 화면 크기·테마 복원 + 미니 창에 구성 전달.
       v2.6.4: 이 '보기 설정' 호출들은 각각 try 로 감싼다 — 여기서 예외가 나면 아래 초기 로드
       전체가 catch 로 떨어져, 데이터는 멀쩡한데 "불러오지 못했습니다" 경고가 뜨고 S.loaded 가
       false 로 남아 저장까지 막히는(=앱이 죽은 것처럼 보이는) 사고가 된다. 화면 꾸미기 실패가
       데이터 로드를 무너뜨리면 안 된다. */
    try{ applyUiScale(S.settings.uiScale); }catch(e){ console.warn('화면 크기 복원 실패',e); }
    try{ applyTheme(S.settings); syncSettings(); }catch(e){ console.warn('테마 복원 실패',e); }
    try{ sendCaptureConfig(); }catch(e){ console.warn('미니 창 구성 전달 실패',e); }
    /* v3.0.3: 로드 전 타이핑분의 @태그 하이라이트를 전화번호부 도착 후 다시 그린다 */
    try{ refreshTagHl(); }catch(e){ console.warn('태그 하이라이트 갱신 실패',e); }
    /* 캡처 초안 회수(v3.1.0): 지난 세션이 미등록 초안을 남긴 채 꺼졌다면
       (전원 차단 포함) 분류 대기로 자동 등록하고 초안을 비운다. */
    const draft=(S.settings.captureDraft||'').trim();
    let draftItem=null;
    if(draft){
      /* v2.11.0: 초안 회수도 빠른 메모 등록과 같은 규칙 — @태그의 관련인 자동 첨부 */
      draftItem=makeItem({memo:draft, staged:true, f:{received:new Date().toISOString()}, contacts:contactsFromTags(draft)});
      S.items.push(draftItem);
      S.settings.captureDraft='';
      STORE.saveSettings(S.settings);
    }
    if(pending.length||draftItem) await STORE.saveAll(S.items);   // 보류됐던 저장 플러시
    runRecurSpawn();                                   // 주기 업무: 예정일 도래분 생성(+저장)
    render();
  }catch(e){
    // 로드 실패를 조용히 삼키면 "빈 화면 + 저장도 안 되는" 죽은 앱이 된다.
    // S.loaded는 false로 남겨 저장을 계속 차단하되(F1), 무슨 일이 났는지와
    // 복구 경로(JSON·DB파일 불러오기)를 사용자에게 반드시 알린다.
    console.error('initial load failed', e);
    /* v3.3.1 안내 개정(소유자 지정): 원인 나열 대신 '해볼 순서'를 준다.
       실제 원인 1순위가 '앱이 완전히 꺼지기 전 재실행'이라 그것부터 짚는다. */
    await appAlert(
      '저장된 데이터를 불러오지 못했습니다.\n'+
      '지금은 데이터를 지키기 위해 저장이 잠겨 있습니다 — 아래 순서대로 해보세요.\n\n'+
      '1. 화면 오른쪽 아래 시계 옆 트레이 아이콘을 우클릭해 [종료]를 누른 뒤 앱을 다시 실행합니다.\n'+
      '   (앱이 완전히 꺼지기 전에 다시 열면 잠깐 이런 일이 생길 수 있습니다.)\n\n'+
      '2. 그래도 같으면 [설정] → [저장 위치 확인·변경]에서 다른 폴더로 옮겨 보세요.\n\n'+
      '3. 그래도 안 되면 [설정] → [JSON·DB파일 불러오기]로 예전 백업을 불러옵니다.\n'+
      '   (데이터 폴더 안 backups 폴더의 최신 .sqlite 파일, 또는 따로 저장해 둔 JSON 백업)\n\n'+
      '상세 오류: '+e, '데이터를 불러오지 못했습니다');
  }
  /* 버전 표기: v3.0.0부터 X.Y.Z semver 그대로 표시 (구 십진수 규칙의 ".0" 절삭 폐지) */
  try{ const v=await window.__TAURI__.app.getVersion(); $('appVer').textContent='v'+v; }catch{}
})();

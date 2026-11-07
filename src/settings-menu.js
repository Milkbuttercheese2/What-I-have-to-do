/* =========================================================================
   설정 팝업 (v2.6.0 표준 모달 → v3.7.0 전면 개편).
   구역(화면·빠른 메모·시작·업무 도구·데이터)마다 카드 하나. 선택형은 세그먼트,
   실행형은 › 줄. 실행 버튼의 실제 동작 리스너는 여전히 각 모듈(backup.js·presets.js·
   recur-box.js)에 있다 — 여기서는 팝업 여닫기와 선택형 설정만 담당한다(버튼 id 는 예전 그대로).

   v2.6.3 화면 배치(3P2): '먼저 뜨는 화면'과 'Alt 로 바꾸는 화면'은 서로 달라야 하므로
   둘째 줄에서 첫 화면과 같은 버튼은 비활성화하고, 겹치면 자동으로 밀어준다
   (theme.js normCapPair). 첫 화면이 '양식'이면 미니 창이 아예 뜨지 않아
   Alt 전환이 없으므로 둘째 줄 전체를 비활성화하고 이유를 적어준다.

   v3.7.0 추가: 보드 배치(구 boardModeModal 팝업을 여기로 흡수) · 윈도우 시작 시 자동 실행.
   ========================================================================= */
import {S} from './state.js';
import {STORE, invoke} from './store.js';
import {$, showToast} from './dom-utils.js';
import {openPresetModal} from './presets.js';
import {applyTheme, normTheme, normCapScreen, normCapPair, CAP_SCREEN_NAME} from './theme.js';
import {sendCaptureConfig} from './capture-bridge.js';
import {openModal, closeModal} from './modals.js';
import {setPlaceMode} from './placement.js';
import {render} from './render.js';
import {applyAlarmOn} from './alarms.js';

/* 보드 배치 — 기본은 담당자·시간(5열, v3.7.0 소유자 지정). 'time' 을 명시로 고른 사람만 4열. */
export const normBoardMode = v => v==='time' ? 'time' : 'owner';
const BOARD_DESC = {owner:'5열 · 분류 대기 · 본인/타인 진행(오늘 · 오늘 외)', time:'4열 · 분류 대기 · 오늘 처리 · 진행 중 · 예정'};

/* 설정 키 ↔ 세그먼트 UI (한 줄에 하나씩, 추가는 여기만 고치면 된다).
   get: 저장값 → 버튼 값 / set: 버튼 값 → 저장값 */
const SEGS=[
  {id:'segTheme',        get:s=>normTheme(s.theme),                     set:(s,v)=>{ s.theme=normTheme(v); }},
  {id:'segAlarm',        get:s=>s.alarmOn===false?'off':'on',          set:(s,v)=>{ s.alarmOn=(v!=='off'); }},
  {id:'segBoardMode',    get:s=>normBoardMode(s.boardMode),             set:(s,v)=>{ s.boardMode=normBoardMode(v); }},
  {id:'segCapStart',     get:s=>normCapPair(s).capStart,                set:(s,v)=>{ s.capStart=normCapPair({capStart:v}).capStart; }},
  {id:'segCapSecond',    get:s=>normCapPair(s).capSecond,               set:(s,v)=>{ s.capSecond=normCapScreen(v); }},
  {id:'segAutostart',    get:s=>s.autostart===false?'off':'on',         set:(s,v)=>{ s.autostart=(v!=='off'); }},
  {id:'segAutostartWin', get:s=>s.autostartMinimized===true?'tray':'show', set:(s,v)=>{ s.autostartMinimized=(v==='tray'); }},
];

export function openSettings(){
  syncSettings();
  /* v2.10.0 저장 위치 상시 표기 — 열 때마다 갱신(위치 변경 예약 후에도 최신을 보여주도록) */
  const p=$('dataDirPath');
  if(p){ p.textContent='확인 중…'; invoke('get_data_dir').then(d=>{ p.textContent=d||''; }).catch(()=>{ p.textContent=''; }); }
  openModal('settingsModal');
}
export function closeSettings(){ closeModal('settingsModal'); }

/* 저장된 값 → 버튼 on/비활성 표시 */
export function syncSettings(){
  SEGS.forEach(sg=>{
    const wrap=$(sg.id); if(!wrap) return;
    const cur=sg.get(S.settings);
    wrap.querySelectorAll('.seg-btn').forEach(b=>{ b.disabled=false; b.classList.toggle('on', b.dataset.v===cur); });
  });
  const pair=normCapPair(S.settings);
  /* 둘째 줄: 첫 화면과 같은 항목은 못 고른다. 첫 화면이 양식이면 줄 전체가 의미 없다. */
  const second=$('segCapSecond'), note=$('capOrderNote');
  if(second){
    const startsWithForm=pair.capStart==='form';
    second.querySelectorAll('.seg-btn').forEach(b=>{
      b.disabled = startsWithForm || b.dataset.v===pair.capStart;
      if(b.disabled) b.classList.remove('on');
    });
  }
  if(note){
    note.textContent = pair.capStart==='form'
      ? '양식으로 시작하면 미니 창 없이 메인 창 양식이 열려 Alt 전환이 없습니다'
      : `지금: ${CAP_SCREEN_NAME[pair.capStart]} → Alt → ${CAP_SCREEN_NAME[pair.capSecond]}`;
  }
  const bd=$('boardModeDesc'); if(bd) bd.textContent=BOARD_DESC[normBoardMode(S.settings.boardMode)];
  /* 자동 실행이 꺼져 있으면 '자동 실행되면' 줄은 의미가 없다 */
  const win=$('segAutostartWin');
  if(win && S.settings.autostart===false) win.querySelectorAll('.seg-btn').forEach(b=>{ b.disabled=true; });
}

/* 자동 실행 레지스트리를 설정값에 맞춘다 (Rust set_autostart). 실패는 알리되 앱을 막지 않는다.
   부팅 때(main.js)와 토글 때 부른다 — 켜는 쪽은 매번 다시 등록해 exe 위치가 바뀌어도 고쳐진다. */
export async function syncAutostart(quiet){
  const want=S.settings.autostart!==false;
  try{
    const now=await invoke('set_autostart',{enabled:want});
    if(typeof now==='boolean' && now!==want && !quiet) showToast('자동 실행 설정을 바꾸지 못했습니다. 보안 프로그램이 막았을 수 있습니다');
  }catch(e){
    console.warn('자동 실행 설정 실패',e);
    if(!quiet) showToast('자동 실행 설정을 바꾸지 못했습니다: '+e);
  }
}

/* 선택 즉시 적용·저장 (모달은 열어둔다) */
function pick(sg, val){
  const view=()=>JSON.stringify(SEGS.map(x=>x.get(S.settings)));   // 화면에 보이는 값 기준으로 '바뀌었나'를 본다
  const before=view();
  sg.set(S.settings, val);
  /* 첫 화면을 바꿔 둘이 겹치면 둘째 화면을 자동으로 밀어 항상 유효한 한 쌍을 유지한다 */
  const pair=normCapPair(S.settings);
  S.settings.capStart=pair.capStart; S.settings.capSecond=pair.capSecond;
  if(view()===before) return;                                    // 같은 값 — 쓰지 않는다
  window.SETTINGS=S.settings;
  STORE.saveSettings(S.settings);
  applyTheme(S.settings);        // 메인 테마는 즉시 반영
  sendCaptureConfig();           // 미니 창·단축키 동작에도 즉시 반영
  if(sg.id==='segBoardMode'){ setPlaceMode(normBoardMode(S.settings.boardMode)); render(); }
  if(sg.id==='segAutostart') syncAutostart();
  if(sg.id==='segAlarm'){ applyAlarmOn(); showToast(S.settings.alarmOn?'알림을 켰습니다':'알림을 껐습니다'); }
  syncSettings();
}

export function initSettingsMenu(){
  document.body.appendChild($('settingsModal'));      // 어느 탭에서든 뜨도록
  $('settingsBtn').addEventListener('click',openSettings);
  $('settingsClose').addEventListener('click',closeSettings);
  const x=$('settingsX'); if(x) x.addEventListener('click',closeSettings);
  $('settingsModal').addEventListener('click',e=>{
    if(e.target.id==='settingsModal'){ closeSettings(); return; }        // 배경 클릭 닫기
    const seg=e.target.closest('.seg-btn');
    if(seg){
      if(seg.disabled) return;
      const def=SEGS.find(x=>x.id===(seg.closest('.seg')||{}).id);
      if(def) pick(def, seg.dataset.v);
      return;
    }
    if(e.target.closest('button.set-go')) closeSettings();               // 실행 줄은 누르면 팝업을 닫는다
  });
  $('presetManageBtn').addEventListener('click',openPresetModal);
}

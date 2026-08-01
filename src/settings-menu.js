/* =========================================================================
   설정 팝업 (v2.6.0 — 드롭다운 메뉴에서 표준 모달로 전환).
   화면 테마(앱 전체 하나 — 미니 창도 따라간다)와 Ctrl+Alt+Space 화면 배치를 여기서 고르고,
   저장 위치/백업/프리셋 같은 실행 버튼도 이 안에 모았다. 실행 버튼의 실제
   동작 리스너는 여전히 각 모듈(backup.js·presets.js·recur-box.js·main.js)에
   있다 — 여기서는 팝업 여닫기와 선택형 설정만 담당한다(버튼 id 는 예전 그대로).

   v2.6.3 화면 배치(3P2): '먼저 뜨는 화면'과 'Alt 를 누르면' 을 각각 세 화면
   (내 업무 검색·빠른 메모·양식 메모) 중에서 고른다. 둘은 서로 달라야 하므로
   둘째 줄에서 첫 화면과 같은 버튼은 비활성화하고, 겹치면 자동으로 밀어준다
   (theme.js normCapPair). 첫 화면이 '양식 메모'면 미니 창이 아예 뜨지 않아
   Alt 전환이 없으므로 둘째 줄 전체를 비활성화하고 이유를 적어준다.
   ========================================================================= */
import {S} from './state.js';
import {STORE, invoke} from './store.js';
import {$} from './dom-utils.js';
import {openPresetModal} from './presets.js';
import {applyTheme, normTheme, normCapScreen, normCapPair, CAP_SCREEN_NAME} from './theme.js';
import {sendCaptureConfig} from './capture-bridge.js';

/* 설정 키 ↔ 세그먼트 UI ↔ 정규화 함수 (한 줄에 하나씩, 추가는 여기만 고치면 된다) */
const SEGS=[
  {id:'segTheme',     key:'theme',     norm:normTheme},
  {id:'segCapStart',  key:'capStart',  norm:v=>normCapPair({capStart:v}).capStart},
  {id:'segCapSecond', key:'capSecond', norm:normCapScreen},
];

export function openSettings(){
  syncSettings();
  /* v2.10.0 저장 위치 상시 표기 — 열 때마다 갱신(위치 변경 예약 후에도 최신을 보여주도록) */
  const p=$('dataDirPath');
  if(p){ p.textContent='저장 위치 확인 중…'; invoke('get_data_dir').then(d=>{ p.textContent=d?('저장 위치: '+d):''; }).catch(()=>{ p.textContent=''; }); }
  $('settingsModal').classList.add('on');
}
export function closeSettings(){ $('settingsModal').classList.remove('on'); }

/* 저장된 값 → 버튼 on/비활성 표시 */
export function syncSettings(){
  const pair=normCapPair(S.settings);
  const cur={theme:normTheme(S.settings.theme), capStart:pair.capStart, capSecond:pair.capSecond};
  SEGS.forEach(sg=>{
    const wrap=$(sg.id); if(!wrap) return;
    wrap.querySelectorAll('.seg-btn').forEach(b=>b.classList.toggle('on', b.dataset.v===cur[sg.key]));
  });
  /* 둘째 줄: 첫 화면과 같은 항목은 못 고른다. 첫 화면이 양식 메모면 줄 전체가 의미 없다. */
  const second=$('segCapSecond'), note=$('capOrderNote');
  if(second){
    const startsWithForm=cur.capStart==='form';
    second.querySelectorAll('.seg-btn').forEach(b=>{
      b.disabled = startsWithForm || b.dataset.v===cur.capStart;
      if(b.disabled) b.classList.remove('on');
    });
  }
  if(note){
    note.textContent = cur.capStart==='form'
      ? '양식 메모로 시작하면 미니 창 대신 메인 창의 양식이 열립니다 — 이때는 Alt 전환이 없습니다.'
      : `Ctrl+Alt+Space → ${CAP_SCREEN_NAME[cur.capStart]} · Alt → ${CAP_SCREEN_NAME[cur.capSecond]}`;
  }
}

/* 선택 즉시 적용·저장 (모달은 열어둔다 — 보드 모드 선택과 같은 규칙) */
function pick(key, val){
  if(S.settings[key]===val) return;
  S.settings[key]=val;
  /* 첫 화면을 바꿔 둘이 겹치면 둘째 화면을 자동으로 밀어 항상 유효한 한 쌍을 유지한다 */
  const pair=normCapPair(S.settings);
  S.settings.capStart=pair.capStart; S.settings.capSecond=pair.capSecond;
  window.SETTINGS=S.settings;
  STORE.saveSettings(S.settings);
  applyTheme(S.settings);        // 메인 테마는 즉시 반영
  sendCaptureConfig();           // 미니 창·단축키 동작에도 즉시 반영
  syncSettings();
}

export function initSettingsMenu(){
  document.body.appendChild($('settingsModal'));      // 어느 탭에서든 뜨도록
  $('settingsBtn').addEventListener('click',openSettings);
  $('settingsClose').addEventListener('click',closeSettings);
  $('settingsModal').addEventListener('click',e=>{
    if(e.target.id==='settingsModal'){ closeSettings(); return; }        // 배경 클릭 닫기
    const seg=e.target.closest('.seg-btn');
    if(seg){
      if(seg.disabled) return;
      const def=SEGS.find(x=>x.id===(seg.closest('.seg')||{}).id);
      if(def) pick(def.key, def.norm(seg.dataset.v));
      return;
    }
    if(e.target.closest('button.menu-item')) closeSettings();            // 실행 버튼은 누르면 팝업을 닫는다
  });
  $('presetManageBtn').addEventListener('click',openPresetModal);
}

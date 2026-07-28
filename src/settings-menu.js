/* =========================================================================
   설정 팝업 (v2.6.0 — 드롭다운 메뉴에서 표준 모달로 전환).
   화면 테마(메인/미니 창)·미니 창 동작을 여기서 고르고, 저장 위치/백업/
   프리셋 같은 실행 버튼도 이 안에 모았다. 실행 버튼의 실제 동작 리스너는
   여전히 각 모듈(backup.js·presets.js·recur-box.js)에 있다 — 여기서는
   팝업 여닫기와 선택형 설정만 담당한다(버튼 id 는 예전 그대로).
   ========================================================================= */
import {S} from './state.js';
import {STORE} from './store.js';
import {$} from './dom-utils.js';
import {openPresetModal} from './presets.js';
import {applyTheme, normTheme, normCapTheme, normCapStart, normCapSubmit} from './theme.js';
import {sendCaptureConfig} from './capture-bridge.js';

/* 설정 키 ↔ 세그먼트 UI ↔ 정규화 함수 (한 줄에 하나씩, 추가는 여기만 고치면 된다) */
const SEGS=[
  {id:'segTheme',     key:'theme',     norm:normTheme},
  {id:'segCapTheme',  key:'capTheme',  norm:normCapTheme},
  {id:'segCapStart',  key:'capStart',  norm:normCapStart},
  {id:'segCapSubmit', key:'capSubmit', norm:normCapSubmit},
];

export function openSettings(){ syncSettings(); $('settingsModal').classList.add('on'); }
export function closeSettings(){ $('settingsModal').classList.remove('on'); }

/* 저장된 값 → 버튼 on 표시 */
export function syncSettings(){
  SEGS.forEach(sg=>{
    const wrap=$(sg.id); if(!wrap) return;
    const cur=sg.norm(S.settings[sg.key]);
    wrap.querySelectorAll('.seg-btn').forEach(b=>b.classList.toggle('on', b.dataset.v===cur));
  });
}

/* 선택 즉시 적용·저장 (모달은 열어둔다 — 보드 모드 선택과 같은 규칙) */
function pick(key, val){
  if(S.settings[key]===val) return;
  S.settings[key]=val;
  window.SETTINGS=S.settings;
  STORE.saveSettings(S.settings);
  applyTheme(S.settings);        // 메인 테마는 즉시 반영
  sendCaptureConfig();           // 미니 창에도 즉시 반영
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
      const def=SEGS.find(x=>x.id===(seg.closest('.seg')||{}).id);
      if(def) pick(def.key, def.norm(seg.dataset.v));
      return;
    }
    if(e.target.closest('button.menu-item')) closeSettings();            // 실행 버튼은 누르면 팝업을 닫는다
  });
  $('presetManageBtn').addEventListener('click',openPresetModal);
}

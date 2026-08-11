/* =========================================================================
   팝업 스택 — "지금 화면 맨 위에 떠 있는 팝업이 무엇인가"의 단일 출처.

   예전에는 팝업을 여는 코드는 각 모듈에 있는데, ESC 로 무엇을 닫을지는
   main.js 에 손으로 적은 목록이 정했다(Ctrl+S · Ctrl+Enter 까지 합쳐 목록 셋).
   목록의 줄 순서가 곧 규칙이라, 새 팝업을 만드는 사람이 "몇 번째 줄에 넣어야
   하지?"를 머리로 계산해야 했고 틀려도 경고 없이 오작동했다. 실제로:
     · v2.11.0 — 양식 위에 뜬 관련 업무 팝업이 있는데 ESC 가 밑의 양식을 닫았다.
     · recurModal 은 아예 ESC 목록에 없어서, 주기 업무 팝업에서 ESC 를 누르면
       그 밑의 설정 팝업이 닫혔다.
     · pbSyncModal 을 ESC 로 닫으면 closePbSync() 를 안 거쳐 pendingSync 가 남았다.
   전부 "무엇이 위에 있는지"를 실행 중에 알 수 있는데도 사람이 미리 예측해서
   적어둔 탓이다. 지금은 열릴 때 스스로 쌓이고, ESC 는 맨 위 한 장을 걷는다.

   '맨 위'의 판정은 z-index → 그다음 연 순서다. z-index 를 CSS 에서 그때그때
   읽으므로(JS 에 베껴 적지 않는다) 화면에서 실제로 위에 있는 것과 어긋날 수
   없다. z-index 를 못 읽는 환경(스타일시트 없는 테스트)에서는 전부 0 으로 묶여
   '나중에 연 것'이 위가 된다 — 순서만으로도 정상 동작하는 안전한 축약이다.

   ⚠️ 각 모듈의 닫기 함수는 반드시 closeModal(id) 을 거쳐야 스택에서 빠진다.
   classList.remove('on') 을 직접 부르면 화면만 닫히고 스택에 유령이 남는다.
   ========================================================================= */
import {$} from './dom-utils.js';

const stack = [];
let seq = 0;

function zOf(el){
  let z = NaN;
  try{ z = parseInt(getComputedStyle(el).zIndex, 10); }catch{}
  return isNaN(z) ? 0 : z;
}

/* 화면에서 실제로 맨 위인 것의 스택 위치 (없으면 -1) */
function topIndex(){
  let best = -1;
  for(let i = 0; i < stack.length; i++){
    const m = stack[i], b = stack[best];
    if(best < 0 || m.z > b.z || (m.z === b.z && m.seq > b.seq)) best = i;
  }
  return best;
}

/* 팝업을 연다.
   opts.close — 화면에서 지우는 것 말고 더 할 일이 있을 때만 준다(양식의 초안
                플러시, 동기화 팝업의 대기 목록 비우기, 알림창의 [확인] 처리 등).
                안 주면 그냥 닫는다.
   opts.save  — 이 팝업이 열려 있을 때 Ctrl+S / Ctrl+Enter 가 할 일(선택).
                저장 버튼을 가진 모듈이 자기 버튼을 직접 안다 — 예전처럼 main.js
                가 남의 모듈 버튼($('fm-save').click())을 대신 누르지 않는다. */
export function openModal(id, opts = {}){
  const el = $(id); if(!el) return;
  const i = stack.findIndex(m => m.id === id);
  if(i >= 0) stack.splice(i, 1);                 // 이미 열려 있으면 맨 위로 다시 올린다
  el.classList.add('on');
  stack.push({id, seq: ++seq, z: zOf(el), close: opts.close || (() => closeModal(id)), save: opts.save || null});
}

/* 팝업을 닫는다. 스택에 없어도 화면은 반드시 닫는다(어긋난 상태를 남기지 않는다). */
export function closeModal(id){
  const i = stack.findIndex(m => m.id === id);
  if(i >= 0) stack.splice(i, 1);
  const el = $(id); if(el) el.classList.remove('on');
}

/* 맨 위 팝업을 닫는다 (ESC). 닫을 게 있었으면 true.
   스택에서 먼저 빼고 close 를 부르므로, close 안에서 closeModal 을 다시 불러도
   재귀하지 않는다(대부분의 모듈 닫기 함수가 그렇게 생겼다). */
export function closeTop(){
  const i = topIndex(); if(i < 0) return false;
  const m = stack.splice(i, 1)[0];
  try{ m.close(); }catch(e){ console.warn('팝업 닫기 실패', m.id, e); }
  return true;
}

/* 위에서부터 훑어 '저장할 수 있는' 첫 팝업의 저장 동작 (없으면 null).
   저장 버튼이 없는 팝업(관련 업무·설정 등)은 그냥 건너뛴다 — 예전 목록도
   그 셋(양식·주기 업무·프리셋)만 담고 있었으므로 동작이 같다. */
export function topSave(){
  const m = [...stack].sort((a, b) => (b.z - a.z) || (b.seq - a.seq)).find(x => x.save);
  return m ? m.save : null;
}

export function isOpen(id){ return stack.some(m => m.id === id); }

/* =========================================================================
   종료 플러시 (v3.3.4) — "닫을 때 조용히 사라지는 변경분" 제거.

   저장은 화면 조작마다 백그라운드로 돈다. 그래서 저장이 실패해 재시도를
   기다리는 동안(백신·클라우드 폴더·일시적 잠금) 화면에는 보이지만 디스크엔
   없는 변경분이 생긴다. 예전에는 트레이 [종료]·창 닫기가 곧바로 프로세스를
   죽여서 그게 통째로 사라졌다.

   이제 Rust 가 종료 전에 'wmhh://request-quit' 를 보내고(commands::request_quit),
   여기서 남은 저장을 밀어 넣은 뒤 'quit_now' 로 종료를 마무리한다.
   ⚠️ Rust 쪽에는 감시 타이머가 있어 이 응답이 없어도 몇 초 뒤 무조건 종료된다 —
   즉 이 모듈이 깨져도 앱이 안 닫히는 상태는 만들어지지 않는다. 그 보장을 믿고
   여기서는 어떤 실패도 종료를 막지 않게 짠다(전부 try/catch 후 진행).
   ========================================================================= */
import {STORE, invoke} from './store.js';

let quitting=false;

async function onQuitRequest(){
  if(quitting) return;                       // 연타 방지 — 첫 요청의 플러시가 진행 중
  quitting=true;
  try{ await STORE.flush(); }catch(e){ console.warn('종료 전 저장 플러시 실패',e); }
  try{ await invoke('quit_now'); }catch(e){ console.warn('종료 요청 실패',e); }
}

export function initQuit(){
  window.__TAURI__.event.listen('wmhh://request-quit', onQuitRequest).catch(()=>{});
}

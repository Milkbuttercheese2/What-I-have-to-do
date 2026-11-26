/* 조용히 삼키던 실패를 진단 로그(wmhh.log)에 한 줄 남긴다 — 화면 동작은 바꾸지 않는다.
   예전엔 `.catch(()=>{})` 로 버려서, 이벤트 듣기가 실패하면 그 기능(바깥 이름 바꾸기 따라가기, 종료 플러시,
   미니 창 메모 받기 등)이 통째로 죽어도 아무 흔적이 없었다(exe 에선 console 도 안 보인다).
   - 두 창(main·capture)이 함께 쓴다 → import 없음, __TAURI__ 는 부를 때 읽는다(최상위에서 읽지 말 것).
   - 남기는 것은 '어디서(tag)'와 오류 문구 앞 200자뿐 — 업무 내용·이름·번호를 넘기지 말 것(로그 규칙).
   - 로그 실패는 무시한다(로그 때문에 앱이 깨지면 안 된다). 한 창에서 100줄까지만 — 되풀이 실패가 로그를 채우지 않게. */
let sent=0;
const MAX_LINES=100;

export function logWarn(tag, e){
  let msg='';
  try{ msg=String(e&&e.message!=null?e.message:e).slice(0,200); }catch{ msg='?'; }
  try{ console.warn(`[${tag}]`, e); }catch{ /* console 이 없는 환경 */ }
  if(sent>=MAX_LINES) return;
  sent++;
  try{
    const inv=window.__TAURI__&&window.__TAURI__.core&&window.__TAURI__.core.invoke;
    if(inv) Promise.resolve(inv('client_log',{tag:String(tag).slice(0,40), msg})).catch(()=>{ /* 로그 실패는 무시 */ });
  }catch{ /* 로그 실패는 무시 */ }
}

/* `.catch(logged('tag'))` 꼴로 쓰는 짧은 손잡이 */
export const logged = tag => e => logWarn(tag, e);

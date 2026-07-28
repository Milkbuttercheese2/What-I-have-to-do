/* =========================================================================
   테마 (v2.6.0) — 메인 창 / 미니 창을 각각 밝게·어둡게 고를 수 있다.
   색은 전부 CSS 토큰이라(styles.css :root ↔ html[data-theme="dark"],
   capture.html :root ↔ body.light) 여기서는 '어느 값을 쓸지'만 정한다.
   이 파일은 아무것도 import 하지 않는다 — 메인 창과 테스트 양쪽에서 안전하게 쓰인다.
   ========================================================================= */
export const THEME_DEFAULTS = {
  /* v2.6.3: 테마는 앱 전체에 하나다 — 메인 창과 미니 창(검색·빠른 메모)이 같은 값을 쓴다.
     '양식 메모'는 메인 창의 양식 팝업이라 메인 테마를 따를 수밖에 없으므로, 테마를 둘로
     쪼개면 단축키로 오가는 세 화면의 색이 서로 달라진다(소유자 지정: 셋은 항상 같은 색). */
  theme:'light',          // 'light'(기존 화면 그대로) | 'dark'
  /* Ctrl+Alt+Space 화면 배치 (3P2 = 6가지): 세 화면 중 둘을 골라 순서를 정한다.
     'search'(내 업무 검색) | 'memo'(빠른 메모 — 미니 창) | 'form'(양식 메모 — 메인 창 양식) */
  capStart:'search',      // 단축키를 누르면 먼저 뜨는 화면
  capSecond:'memo',       // 그 화면에서 Alt 를 누르면 넘어갈 화면 (첫 화면과 달라야 한다)
};
const one = (v,a,b) => (v===b ? b : a);      // 아는 값만 통과, 나머지는 첫 번째(기본)로
export function normTheme(v){ return one(v,'light','dark'); }
export const CAP_SCREENS=['search','memo','form'];
export const CAP_SCREEN_NAME={search:'내 업무 검색', memo:'빠른 메모', form:'양식 메모'};
export function normCapScreen(v){ return CAP_SCREENS.includes(v) ? v : 'search'; }
/* 첫 화면·둘째 화면은 서로 달라야 한다(같으면 Alt 가 아무 일도 안 하는 상태가 된다).
   저장값이 겹치면 조용히 다른 화면으로 밀어 항상 유효한 한 쌍을 돌려준다. */
export function normCapPair(settings){
  const s=settings||{};
  const start=normCapScreen(s.capStart);
  let second=normCapScreen(s.capSecond);
  if(second===start) second=CAP_SCREENS.find(x=>x!==start);
  return {capStart:start, capSecond:second};
}
/* 예전 이름 유지 — 첫 화면만 필요한 곳에서 쓴다 */
export function normCapStart(v){ return normCapScreen(v); }

/* 설정값 → 캡처 창에 보낼 구성 (capture-bridge 가 이 모양 그대로 emit) */
export function captureConfig(settings){
  const s=settings||{};
  return Object.assign({theme:normTheme(s.theme)}, normCapPair(s));
}
/* 부팅 첫 페인트용 캐시 (v2.6.2).
   설정의 진실은 SQLite 하나다 — 여기 쓰는 값은 '읽어오기 전 한 프레임'을 위한 캐시일 뿐이고
   어떤 로직도 이 값을 근거로 판단하지 않는다. 없으면 기본값으로 그린다.
   이게 없으면 어둡게로 쓰는 사람은 실행할 때마다 흰 화면이 한 번 번쩍인다
   (미니 창도 마찬가지 — 반대로 밝게 설정이면 검은 창이 번쩍인다). */
export function cacheForBoot(settings){
  const s=settings||{};
  try{
    localStorage.setItem('wmhhTheme',     normTheme(s.theme));
    const pair=normCapPair(s);
    localStorage.setItem('wmhhCapStart',  pair.capStart);
    localStorage.setItem('wmhhCapSecond', pair.capSecond);
  }catch{}
}
/* 메인 창 테마 적용 — html[data-theme] 하나로 전체 전환 */
export function applyTheme(settings){
  const t=normTheme((settings||{}).theme);
  if(typeof document!=='undefined') document.documentElement.setAttribute('data-theme',t);
  cacheForBoot(settings);
  return t;
}

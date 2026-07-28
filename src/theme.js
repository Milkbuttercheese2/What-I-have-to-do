/* =========================================================================
   테마 (v2.6.0) — 메인 창 / 미니 창을 각각 밝게·어둡게 고를 수 있다.
   색은 전부 CSS 토큰이라(styles.css :root ↔ html[data-theme="dark"],
   capture.html :root ↔ body.light) 여기서는 '어느 값을 쓸지'만 정한다.
   이 파일은 아무것도 import 하지 않는다 — 메인 창과 테스트 양쪽에서 안전하게 쓰인다.
   ========================================================================= */
export const THEME_DEFAULTS = {
  theme:'light',          // 메인 창
  capTheme:'dark',        // 미니 창(기존 검정 패널이 기본)
  capStart:'search',      // 미니 창을 열 때 먼저 뜨는 화면: 'search' | 'memo'
  capSubmit:'inbox',      // 미니 창 Ctrl+Enter: 'inbox'(분류 대기 등록) | 'form'(양식 열기)
};
const one = (v,a,b) => (v===b ? b : a);      // 아는 값만 통과, 나머지는 첫 번째(기본)로
export function normTheme(v){ return one(v,'light','dark'); }
export function normCapTheme(v){ return one(v,'dark','light'); }
export function normCapStart(v){ return one(v,'search','memo'); }
export function normCapSubmit(v){ return one(v,'inbox','form'); }

/* 설정값 → 캡처 창에 보낼 구성 (capture-bridge 가 이 모양 그대로 emit) */
export function captureConfig(settings){
  const s=settings||{};
  return {capTheme:normCapTheme(s.capTheme), capStart:normCapStart(s.capStart), capSubmit:normCapSubmit(s.capSubmit)};
}
/* 메인 창 테마 적용 — html[data-theme] 하나로 전체 전환 */
export function applyTheme(settings){
  const t=normTheme((settings||{}).theme);
  if(typeof document!=='undefined') document.documentElement.setAttribute('data-theme',t);
  return t;
}

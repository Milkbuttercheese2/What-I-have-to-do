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
/* 부팅 첫 페인트용 캐시 (v2.6.2).
   설정의 진실은 SQLite 하나다 — 여기 쓰는 값은 '읽어오기 전 한 프레임'을 위한 캐시일 뿐이고
   어떤 로직도 이 값을 근거로 판단하지 않는다. 없으면 기본값으로 그린다.
   이게 없으면 어둡게로 쓰는 사람은 실행할 때마다 흰 화면이 한 번 번쩍인다
   (미니 창도 마찬가지 — 반대로 밝게 설정이면 검은 창이 번쩍인다). */
export function cacheForBoot(settings){
  const s=settings||{};
  try{
    localStorage.setItem('wmhhTheme',     normTheme(s.theme));
    localStorage.setItem('wmhhCapTheme',  normCapTheme(s.capTheme));
    localStorage.setItem('wmhhCapStart',  normCapStart(s.capStart));
    localStorage.setItem('wmhhCapSubmit', normCapSubmit(s.capSubmit));
  }catch{}
}
/* 메인 창 테마 적용 — html[data-theme] 하나로 전체 전환 */
export function applyTheme(settings){
  const t=normTheme((settings||{}).theme);
  if(typeof document!=='undefined') document.documentElement.setAttribute('data-theme',t);
  cacheForBoot(settings);
  return t;
}

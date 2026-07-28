/* 첫 페인트 테마 (v2.6.2) — index.html <head> 에서 module 보다 먼저 도는 클래식 스크립트.
   settings 를 SQLite 에서 읽어오기 전 한 프레임 동안만 쓰는 캐시다(theme.js cacheForBoot).
   여기서 아무 판단도 하지 않는다: 값이 없거나 이상하면 기본(밝게)으로 그리고,
   진짜 설정이 로드되면 main.js 의 applyTheme() 이 덮어쓴다.
   ※ CSP(script-src 'self')상 인라인 <script> 는 차단되므로 반드시 별도 파일이어야 한다. */
(function(){
  try{
    var t=localStorage.getItem('wmhhTheme');
    document.documentElement.setAttribute('data-theme', t==='dark'?'dark':'light');
  }catch(e){ document.documentElement.setAttribute('data-theme','light'); }
})();

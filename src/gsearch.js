/* =========================================================================
   한곳 검색칸 (v3.8.4) — 탭 줄 오른쪽의 #g-search 하나가 지금 탭의 검색칸 노릇을 한다.
   탭마다 있던 검색칸(#search·#dc-search·#done-search·#pb-search)은 그대로 두고 화면에서만 감춘다 —
   여기서 친 글자를 그 칸에 넣고 input 이벤트를 보내므로, 찾는 규칙·상태는 각 모듈이 가진 그대로다
   (이 모듈은 아무 검색 로직도 갖지 않는다). 캘린더 탭엔 검색이 없어 칸을 감춘다.
   init*() 외 최상위 실행문 없음.
   ========================================================================= */
import {$} from './dom-utils.js';
import {currentView} from './views.js';

const MAP={board:['search','업무 검색'], docs:['dc-search','문서 찾기'], done:['done-search','완료 업무 검색'], phone:['pb-search','전화번호부 검색']};
const target = () => { const m=MAP[currentView()]; return m ? $(m[0]) : null; };

/* 탭이 바뀌면 그 탭의 검색어·안내 글자로 맞춘다 */
export function syncGSearch(){
  const g=$('g-search'); if(!g) return;
  const m=MAP[currentView()], t=target();
  g.style.visibility = t ? '' : 'hidden';
  if(!t) return;
  g.placeholder=m[1];
  if(document.activeElement!==g) g.value=t.value;
}
function push(){
  const g=$('g-search'), t=target(); if(!g || !t) return;
  t.value=g.value;
  t.dispatchEvent(new Event('input', {bubbles:true}));
}
export function focusGSearch(){ const g=$('g-search'); if(!g || g.style.visibility==='hidden') return false; syncGSearch(); g.focus(); g.select(); return true; }

export function initGSearch(){
  const g=$('g-search'); if(!g) return;
  document.body.classList.add('gsearch');                    // 탭마다 있던 검색칸 감추기(CSS)
  g.addEventListener('input', push);
  g.addEventListener('focus', syncGSearch);
  g.addEventListener('keydown', e=>{
    if(e.key==='Escape' && g.value){ e.preventDefault(); e.stopPropagation(); g.value=''; push(); return; }
    /* Enter·화살표 등은 원래 칸의 동작(있다면)으로 넘긴다 */
    if(e.key==='Enter' || e.key==='ArrowDown' || e.key==='ArrowUp'){
      const t=target(); if(t) t.dispatchEvent(new KeyboardEvent('keydown', {key:e.key, bubbles:true, cancelable:true}));
    }
  });
  document.addEventListener('click', e=>{ if(e.target.closest && e.target.closest('.tab')) setTimeout(syncGSearch, 0); });
  syncGSearch();
}

/* =========================================================================
   화면(탭) 레지스트리 — "어떤 탭에 어떤 화면이 딸려 있는가"의 단일 출처.

   예전에는 이 목록이 main.js 의 탭 클릭 핸들러 안에 손으로 나열돼 있었다.
   그래서 화면을 하나 추가하면 기능과 무관한 배선을 main.js 세 곳(import ·
   표시 줄 · 그리기 호출)에 끼워 넣어야 했고, 빠뜨리면 "탭은 눌리는데 화면이
   안 바뀐다"로 조용히 어긋났다. 지금은 각 모듈이 자기 화면을 init*() 에서
   스스로 등록하므로, 화면을 추가할 때 main.js 는 건드리지 않는다.

   ⚠️ 이 모듈은 상태를 따로 들지 않는다 — '지금 어느 탭인가'의 진실은 DOM 의
   `.tab.on` 하나다(구 syncBoardVisibility 도 같은 것을 봤다). 여기에 현재 탭을
   따로 저장하면 DOM 과 어긋나는 두 번째 진실이 생긴다.
   ========================================================================= */
import {$} from './dom-utils.js';

const views = [];

/* 화면 하나를 등록한다.
   els  — 이 화면에 딸린 요소들. `display`를 주면 켤 때 그 값으로(끌 때 'none'),
          안 주면 classList 의 'on' 으로 켠다(기존 마크업의 두 방식 그대로).
          `when` 은 한 화면 안에서 조건부로 갈리는 요소를 위한 선택적 판정
          (보드의 4열/5열 — 보드 모드에 따라 둘 중 하나만 보인다).
   render — 이 화면으로 전환될 때 부를 함수(선택). */
export function registerView({key, els = [], render = null}){
  const i = views.findIndex(v => v.key === key);
  const v = {key, els, render};
  if(i >= 0) views[i] = v; else views.push(v);   // 재등록(init 재호출·테스트)은 교체
}

/* 지금 켜져 있는 탭. 탭 버튼이 아직 없는 환경에서는 'board'
   (구 syncBoardVisibility 의 `!t || t.dataset.view==='board'` 와 동일). */
export function currentView(){
  const t = document.querySelector('.tab.on');
  return t ? t.dataset.view : 'board';
}

/* 표시만 반영한다 — 그리기 함수는 부르지 않는다. */
export function applyView(key){
  for(const v of views) for(const e of v.els){
    const el = $(e.id); if(!el) continue;
    const on = v.key === key && (!e.when || e.when());
    if(e.display) el.style.display = on ? e.display : 'none';
    else el.classList.toggle('on', on);
  }
}

/* 탭 전환 — 표시를 바꾸고 그 화면을 그린다. */
export function showView(key){
  applyView(key);
  const v = views.find(x => x.key === key);
  if(v && v.render) v.render();
}

/* 지금 화면의 표시를 다시 반영한다(보드 모드 전환처럼 `when` 결과만 바뀐 경우).
   ⚠️ 여기서 render 를 부르면 안 된다 — 보드의 그리기 함수가 render() 이고
   render() 가 이 함수를 부르므로 무한 재귀가 된다. */
export function refreshView(){ applyView(currentView()); }

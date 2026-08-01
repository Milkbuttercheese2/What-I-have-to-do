/* 메모 합치기 (v2.8.0) — 보드 드래그 배선: 카드→카드 병합·실행 취소·완료 카드 보호 */
import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {setupEnv} from '../helpers/env.js';

mock.timers.enable({apis:['setTimeout','setInterval']});
const env = setupEnv();
const {S} = await import('../../src/state.js');
const {initRender, render} = await import('../../src/render.js');
const {initToast} = await import('../../src/dom-utils.js');
initToast(); initRender();

const doc = env.document;
const fire = (el, type) => el.dispatchEvent(new env.window.Event(type, {bubbles:true, cancelable:true}));
const cardOf = id => doc.querySelector(`#view-board .card[data-open="${id}"]`);
/* 드래그 한 사이클: mousedown(draggable 켬) → dragstart → drop(대상 카드) → dragend */
function dragMerge(fromId, toId){
  const from=cardOf(fromId), to=cardOf(toId);
  fire(from,'mousedown'); fire(from,'dragstart');
  fire(to,'drop'); fire(from,'dragend');
}

test('카드를 다른 카드에 놓으면 병합 — 받는 쪽 id 유지, 끌려온 쪽 제거, save_all 호출', async () => {
  await env.resetS(); S.loaded = true;
  S.items=[
    {id:1, memo:'받는 카드', owner:'', done:false, staged:true, f:{}, contacts:[], ids:[], subs:[], files:[], al:{}, recur:null, recurId:null},
    {id:2, memo:'끌려온 카드', owner:'', done:false, staged:true, f:{}, contacts:[], ids:[], subs:[], files:[], al:{}, recur:null, recurId:null},
  ];
  render();
  dragMerge(2, 1);
  await env.flush();
  assert.equal(S.items.length, 1);
  assert.equal(S.items[0].id, 1);                              // 가만히 있던 쪽 id
  assert.equal(S.items[0].memo, '받는 카드\n\n끌려온 카드');
  assert.ok(env.invokeCalls.some(c=>c.cmd==='save_all'));
  assert.ok(doc.getElementById('toast').classList.contains('on'));   // 실행 취소 토스트
});

test('실행 취소: 병합 전 두 카드가 그대로 복원된다', async () => {
  await env.resetS(); S.loaded = true;
  S.items=[
    {id:1, memo:'받는 카드', owner:'', done:false, staged:true, f:{}, contacts:[], ids:[], subs:[{id:9, title:'세부', mid:'', done:false, al:{}}], files:[], al:{}, recur:null, recurId:null},
    {id:2, memo:'끌려온 카드', owner:'', done:false, staged:true, f:{received:'2026-07-01T09:00:00.000Z'}, contacts:[], ids:[], subs:[], files:[], al:{}, recur:null, recurId:null},
  ];
  render();
  dragMerge(2, 1);
  await env.flush();
  assert.equal(S.items.length, 1);
  doc.getElementById('toast-undo').click();
  await env.flush();
  assert.equal(S.items.length, 2);
  assert.equal(S.items.find(x=>x.id===1).memo, '받는 카드');
  assert.equal(S.items.find(x=>x.id===1).subs.length, 1);
  assert.equal(S.items.find(x=>x.id===2).memo, '끌려온 카드');
});

test('자기 자신 위에 놓으면 아무 일도 없다', async () => {
  await env.resetS(); S.loaded = true;
  S.items=[{id:1, memo:'하나', owner:'', done:false, staged:true, f:{}, contacts:[], ids:[], subs:[], files:[], al:{}, recur:null, recurId:null}];
  render();
  dragMerge(1, 1);
  await env.flush();
  assert.equal(S.items.length, 1);
  assert.equal(S.items[0].memo, '하나');
});

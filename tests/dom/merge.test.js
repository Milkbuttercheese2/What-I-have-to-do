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
const mouse = (el, type, x, y) => el.dispatchEvent(new env.window.MouseEvent(type, {bubbles:true, cancelable:true, button:0, clientX:x, clientY:y}));
const cardOf = id => doc.querySelector(`#view-board .card[data-open="${id}"]:not(.drag-ghost)`);
/* v3.7.0 드래그 한 사이클(마우스 구현): 카드에서 누르고 → 6px 넘게 움직여 대상 위로 → 대상에서 놓기 */
function dragMerge(fromId, toId){
  const from=cardOf(fromId), to=cardOf(toId);
  mouse(from,'mousedown',10,10); mouse(to,'mousemove',40,40); mouse(to,'mouseup',40,40);
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

test('v3.7.0 끌어서 놓은 직후의 click 은 양식을 열지 않고, 6px 안쪽 이동은 그냥 클릭이다', async () => {
  await env.resetS(); S.loaded = true;
  S.items=[
    {id:1, memo:'하나', owner:'', done:false, staged:true, f:{}, contacts:[], ids:[], subs:[], files:[], al:{}, recur:null, recurId:null},
    {id:2, memo:'둘', owner:'', done:false, staged:true, f:{}, contacts:[], ids:[], subs:[], files:[], al:{}, recur:null, recurId:null},
  ];
  render();
  const from=cardOf(2);
  mouse(from,'mousedown',10,10); mouse(from,'mousemove',12,11); mouse(from,'mouseup',12,11);   // 2px — 드래그 아님
  assert.equal(S.items.length, 2);
  assert.equal(doc.querySelector('.drag-ghost'), null);
  mouse(from,'mousedown',10,10); mouse(from,'mousemove',60,10);
  assert.ok(doc.querySelector('.drag-ghost'), '6px 넘으면 유령 카드가 생긴다');
  mouse(doc.body,'mouseup',60,10);                                                         // 카드 밖에서 놓기 = 취소
  assert.equal(doc.querySelector('.drag-ghost'), null);
  assert.equal(S.items.length, 2);
  cardOf(2).dispatchEvent(new env.window.MouseEvent('click',{bubbles:true}));                // 놓은 직후 click 은 삼킨다
  assert.ok(!doc.getElementById('formPanel').classList.contains('on'));
});

/* 점검 라운드 3: 실행 취소가 두 업무를 '온전히' 되살리는가 — 알림 상태(확인·미룸), 하위 업무 순서(합치기는 시각순으로 섞는다)·담당,
   관련인·식별정보·파일 링크, 목록 자리까지. 되살린 그대로 저장에 실린다. */
test('실행 취소: 알림 상태·하위 업무 순서·파일 링크·목록 자리까지 합치기 전 그대로 저장된다', async () => {
  await env.resetS(); S.loaded = true;
  const t = {id:1, memo:'받는', owner:'', done:false, staged:false, f:{received:'2026-07-02T09:00:00.000Z', due:'2026-07-09T09:00:00.000Z'},
    contacts:[{who:'가', org:'가과', phone:'010-1', email:''}], ids:[{kind:'SR번호', val:'1'}],
    subs:[{id:11, title:'늦은 점검', mid:'2026-07-08T00:00:00.000Z', done:false, al:{mid:true}, owner:'갑'}, {id:12, title:'시각 없음', mid:'', done:false, al:{}, owner:''}],
    files:['C:\a.hwp'], al:{due:true}, recur:null, recurId:null};
  const mid = {id:5, memo:'가운데', owner:'', done:false, staged:true, f:{}, contacts:[], ids:[], subs:[], files:[], al:{}, recur:null, recurId:null};
  const s = {id:2, memo:'끌려온', owner:'', done:false, staged:true, f:{due:'2026-07-05T09:00:00.000Z'},
    contacts:[{who:'가', org:'가과', phone:'010-1', email:'ga@x.kr'}], ids:[{kind:'SR번호', val:'1'}],
    subs:[{id:21, title:'이른 점검', mid:'2026-07-03T00:00:00.000Z', done:false, al:{mid:1800000000000}, owner:''}],
    files:['C:\a.hwp', 'C:\b.pdf'], al:{due:1800000000000}, recur:null, recurId:null};
  S.items = [JSON.parse(JSON.stringify(t)), JSON.parse(JSON.stringify(mid)), JSON.parse(JSON.stringify(s))];
  render();
  dragMerge(2, 1);
  await env.flush();
  const m = S.items.find(x=>x.id===1);
  assert.deepEqual(m.subs.map(x=>x.id), [21, 11, 12], '합치면 시각순으로 섞인다');
  assert.equal(m.al.due, undefined, '더 이른 기한이 들어와 알림이 다시 걸린다');
  doc.getElementById('toast-undo').click();
  await env.flush();
  assert.deepEqual(S.items, [t, mid, s], '모든 칸과 목록 자리가 합치기 전 그대로');
  const last = env.invokeCalls.filter(c=>c.cmd==='save_all').at(-1).args.items;
  assert.deepEqual(last, [t, mid, s], '되살린 그대로 저장에 실린다');
});

/* 화면(탭) 레지스트리 — 각 모듈이 자기 화면을 등록하고, 탭 전환이 그것만 보고 움직이는가.
   예전에는 이 목록이 main.js 안에 손으로 나열돼 있었다(화면 추가 = main.js 세 곳 수정). */
import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {setupEnv} from '../helpers/env.js';

mock.timers.enable({apis:['setTimeout','setInterval']});
const env = setupEnv();
const {S} = await import('../../src/state.js');
const {registerView, showView, refreshView, currentView, applyView} = await import('../../src/views.js');
const {initRender, render} = await import('../../src/render.js');
const {initCalendar} = await import('../../src/calendar.js');
const {initPhonebook} = await import('../../src/phonebook.js');
const {initForm} = await import('../../src/form.js');
const {setPlaceMode} = await import('../../src/placement.js');
initForm(); initRender(); initCalendar(); initPhonebook();

const $ = id => env.document.getElementById(id);
const shown = id => $(id).style.display !== 'none';
const cls = id => $(id).classList.contains('on');
/* 탭 버튼을 실제로 눌러 main.js 없이도 같은 경로를 탄다 */
const goto = v => {
  env.document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.view === v));
  showView(v);
};

test('각 모듈이 init*() 에서 자기 화면을 등록한다 — main.js 목록 없이 탭이 돈다', async () => {
  await env.resetS(); S.loaded = true;
  setPlaceMode('time');

  goto('board');
  assert.ok(shown('view-board'), '보드 탭: 4열이 보인다');
  assert.ok(shown('strip') && shown('capture'), '검색줄·입력칸이 보드에 딸려 온다');
  assert.ok(!cls('view-cal') && !cls('view-done') && !cls('view-phone'));

  goto('cal');
  assert.ok(cls('view-cal'));
  assert.ok(!shown('view-board') && !shown('strip') && !shown('capture'), '보드에 딸린 것들이 함께 숨는다');

  goto('done');
  assert.ok(cls('view-done') && !cls('view-cal'));

  goto('phone');
  assert.ok(cls('view-phone') && !cls('view-done'));
});

test('보드 탭은 보드 모드에 따라 4열/5열 중 하나만 — 다른 탭에서는 둘 다 숨는다', async () => {
  await env.resetS(); S.loaded = true;

  setPlaceMode('time');  goto('board');
  assert.ok(shown('view-board') && !shown('view-board5'));

  setPlaceMode('owner'); goto('board');
  assert.ok(!shown('view-board') && shown('view-board5'));

  goto('cal');
  assert.ok(!shown('view-board') && !shown('view-board5'));
  setPlaceMode('time');
});

test('render() 안의 refreshView 는 그리기를 다시 부르지 않는다 (무한 재귀 방지)', async () => {
  await env.resetS(); S.loaded = true;
  setPlaceMode('time'); goto('board');
  assert.doesNotThrow(() => render(), 'render → refreshView → render 로 재귀하면 스택이 터진다');

  /* 보드 모드만 바꾸고 render 하면 탭 이동 없이 4열↔5열이 갈린다 */
  setPlaceMode('owner'); render();
  assert.ok(shown('view-board5') && !shown('view-board'));
  setPlaceMode('time');
});

test('currentView: 상태를 따로 들지 않고 .tab.on 을 본다', () => {
  goto('cal');
  assert.equal(currentView(), 'cal');
  goto('board');
  assert.equal(currentView(), 'board');
});

test('재등록은 교체다 — init 을 두 번 불러도 화면이 중복되지 않는다', () => {
  let drawn = 0;
  registerView({key:'done', els:[{id:'view-done'}], render:() => { drawn++; }});
  registerView({key:'done', els:[{id:'view-done'}], render:() => { drawn++; }});
  showView('done');
  assert.equal(drawn, 1, '같은 key 를 두 번 등록해도 그리기는 한 번');
});

test('없는 요소는 조용히 건너뛴다 — 마크업이 아직 없는 화면이 탭 전환을 깨지 않는다', () => {
  registerView({key:'ghost', els:[{id:'view-does-not-exist'}]});
  assert.doesNotThrow(() => applyView('ghost'));
});

/* 점검 라운드 5(라운드 4 의심 1) — 앱을 켜 둔 채 달이 바뀌면 완료 탭이 앞 달에 남던 것.
   완료 탭의 보는 달(dcalY/dcalM)은 처음 그릴 때 한 번만 정해, 11월에 켜 둔 앱이 12월 1일로 넘어가면 "2026년 11월에 완료한 업무"만
   보였다(12월 1일에 완료한 업무는 목록에도 달력 띠에도 없었다). 이제 사용자가 달을 직접 넘기지 않았으면 이번 달을 따라가고,
   직접 다른 달을 보고 있으면 그대로 둔다. 보는 달은 모듈 상태라 이 파일은 새 모듈·가짜 시계로 따로 돈다. */
import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {setupEnv} from '../helpers/env.js';

mock.timers.enable({apis:['setTimeout','setInterval','Date'], now:new Date(2026, 10, 30, 23, 59).getTime()});
const env = setupEnv();
const {S, newId, toggleDone} = await import('../../src/state.js');
const {initRender, renderDone, persist} = await import('../../src/render.js');
const {initToast} = await import('../../src/dom-utils.js');
const {setPlaceMode} = await import('../../src/placement.js');
const {showView} = await import('../../src/views.js');
initToast(); initRender();

const $ = id => env.document.getElementById(id);
const doc = env.document;
const click = el => el.dispatchEvent(new env.window.MouseEvent('click', {bubbles:true, cancelable:true}));
const mk = o => Object.assign({id:newId(), memo:'업무', owner:'', done:false, doneAt:null, staged:false, f:{}, contacts:[], ids:[], subs:[], files:[], al:{}, recur:null, recurId:null}, o);
/* 탭 전환 — 지금 탭은 .tab.on 으로 정해지고(views.js), 보드 다시 그리기는 보이는 완료 탭도 다시 그린다(render.js renderHidden) */
function tab(key){ doc.querySelectorAll('.tab').forEach(t=>t.classList.toggle('on', t.dataset.view===key)); showView(key); }
const head = () => $('done-cal').querySelector('.dcal-head b').textContent;
const rows = () => [...doc.querySelectorAll('#col-done .drow:not(.drow-h) .drow-memo')].map(x=>x.textContent);
async function fresh(at){
  await env.resetS(); S.loaded=true; S.doneDirty.clear(); setPlaceMode('time');
  env.onInvoke('save_all', ()=>({kind:'Saved', version:1}));
  mock.timers.setTime(at);
}

test('달을 넘기지 않았으면 자정에 달이 바뀔 때 완료 탭도 이번 달로 — 그날 완료한 업무가 보인다', async () => {
  await fresh(new Date(2026, 10, 30, 23, 59).getTime());
  tab('done');                                          // 완료 탭을 연 채로
  S.items.push(mk({memo:'11월 끝낸 일', done:true, doneAt:new Date(2026, 10, 30, 10).getTime()}));
  const it = mk({memo:'12월 1일에 끝낼 일'}); S.items.push(it);
  renderDone();
  assert.match(head(), /2026년 11월/);
  mock.timers.tick(2*60e3);                             // 12-01 00:01 — 1분마다 도는 다시 그리기도 지나간다
  assert.equal(new Date().getMonth(), 11);
  toggleDone(it); persist(); await env.flush();
  assert.match(head(), /2026년 12월/, '보는 달이 이번 달을 따라간다');
  assert.ok(rows().includes('12월 1일에 끝낼 일'), `오늘 완료한 업무가 목록에 보인다 — 보인 것: ${JSON.stringify(rows())}`);
  assert.ok(rows().includes('11월 끝낸 일'), '이번 달 보기는 예전처럼 전체(앞 달 것도)');
  tab('board');
});

test('직접 다른 달로 넘겨 보고 있으면 달이 바뀌어도 그 달에 머문다 · 이번 달로 돌아오면 다시 따라간다', async () => {
  await fresh(new Date(2027, 0, 31, 23, 59).getTime());
  tab('done');
  S.items.push(mk({memo:'12월 끝낸 일', done:true, doneAt:new Date(2026, 11, 15, 10).getTime()}));
  renderDone();
  assert.match(head(), /2027년 1월/);
  click($('done-cal').querySelector('[data-dcalnav="-1"]'));
  assert.match(head(), /2026년 12월/);
  /* setTime 으로 옮긴다 — tick 은 앞 시험 뒤로 밀린 1분 타이머를 몇 달 치(수만 번) 다 돌려 멈춘 것처럼 된다 */
  mock.timers.setTime(new Date(2027, 1, 1, 0, 1).getTime());
  renderDone();
  assert.match(head(), /2026년 12월/, '사용자가 고른 달은 그대로');
  assert.deepEqual(rows(), ['12월 끝낸 일']);
  click($('done-cal').querySelector('[data-dcalnav="1"]'));
  click($('done-cal').querySelector('[data-dcalnav="1"]'));
  assert.match(head(), /2027년 2월/, '이번 달로 돌아왔다');
  mock.timers.setTime(new Date(2027, 2, 1, 0, 1).getTime());
  renderDone();
  assert.match(head(), /2027년 3월/, '이번 달로 돌아온 뒤에는 다시 따라간다');
  tab('board');
});

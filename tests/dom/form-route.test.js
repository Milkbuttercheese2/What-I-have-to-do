/* 양식 메모(v2.6.3 — 단축키로 메인 창 빈 양식)의 저장 위치 계약.
   빠른 메모(captureMemo)는 staged:true 라 '항상 분류 대기'지만, 양식 저장은 staged:false 라
   placeOf() 가 적힌 내용대로 배치한다 — 이 차이가 무너지면 '양식으로 적었는데 전부 분류 대기'
   또는 그 반대가 된다. */
import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {setupEnv} from '../helpers/env.js';

mock.timers.enable({apis:['setTimeout','setInterval']});
const env = setupEnv();
const {S} = await import('../../src/state.js');
const {placeOf} = await import('../../src/placement.js');
const {initForm} = await import('../../src/form.js');
const {initCapture} = await import('../../src/capture-bridge.js');
initForm(); initCapture();
const $ = id => env.document.getElementById(id);
const input = el => el.dispatchEvent(new env.window.Event('input', {bubbles:true}));
const d2 = n => String(n).padStart(2,'0');
const setDt = (span, dt) => {
  span.querySelector('.dt-date').value = `${dt.getFullYear()}/${d2(dt.getMonth()+1)}/${d2(dt.getDate())}`;
  span.querySelector('.dt-time').value = `${d2(dt.getHours())}:${d2(dt.getMinutes())}`;
};

test('마감을 오늘로 적으면 → 오늘 처리 (분류 대기 아님)', async () => {
  await env.resetS(); S.loaded = true;
  env.fireEvent('wmhh://open-blank-form', {});           // 단축키 경로와 동일
  await env.flush();
  $('fm-memo').value = '오늘까지 회신할 건'; input($('fm-memo'));
  /* v2.7.0 수정: now+3h 는 21시 이후 실행 시 내일로 넘어가 매일 저녁마다 실패하던
     시간 의존 결함 — '오늘 23:59'로 고정하면 언제 돌려도 오늘이다(지났어도 today). */
  const due = new Date(); due.setHours(23,59,0,0);
  setDt($('fm-grid').querySelector('[data-fkey="due"]'), due);
  $('fm-save').click(); await env.flush();
  assert.equal(S.items.length, 1);
  assert.equal(S.items[0].staged, false);                // 양식 저장은 '분류 대기 고정'이 아니다
  assert.equal(placeOf(S.items[0]), 'today');
});

test('마감을 모레로 적으면 → 예정·대기', async () => {
  await env.resetS(); S.loaded = true;
  env.fireEvent('wmhh://open-blank-form', {}); await env.flush();
  $('fm-memo').value = '다음 주 준비'; input($('fm-memo'));
  const due = new Date(Date.now() + 48*3600e3); due.setSeconds(0,0);
  setDt($('fm-grid').querySelector('[data-fkey="due"]'), due);
  $('fm-save').click(); await env.flush();
  assert.equal(placeOf(S.items[0]), 'planned');
});

test('세부 할 일 하나를 완료 표시하면 → 진행 중', async () => {
  await env.resetS(); S.loaded = true;
  env.fireEvent('wmhh://open-blank-form', {}); await env.flush();
  $('fm-memo').value = '착수한 건'; input($('fm-memo'));
  const row = $('fm-subs').querySelector('.fsub-row');
  row.querySelector('.fsub-title').value = '자료 수집';
  row.querySelector('.fsub-chk').dispatchEvent(new env.window.MouseEvent('click', {bubbles:true}));
  $('fm-save').click(); await env.flush();
  assert.equal(placeOf(S.items[0]), 'doing');
});

test('시각을 하나도 안 적으면 → 분류 대기', async () => {
  await env.resetS(); S.loaded = true;
  env.fireEvent('wmhh://open-blank-form', {}); await env.flush();
  $('fm-memo').value = '언제 할지 아직 모름'; input($('fm-memo'));
  const rec = $('fm-grid').querySelector('[data-fkey="received"]');
  const due = $('fm-grid').querySelector('[data-fkey="due"]');
  [rec, due].forEach(sp => { sp.querySelector('.dt-date').value=''; sp.querySelector('.dt-time').value=''; });
  $('fm-save').click(); await env.flush();
  assert.equal(placeOf(S.items[0]), 'inbox');
});

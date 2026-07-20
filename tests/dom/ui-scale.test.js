/* 화면 크기(Ctrl+휠 확대) — v2.5.15
   범위·격자 정규화, 휠 조작, 상·하한, 그리고 맨 휠에는 반응하지 않아
   보드/목록 스크롤을 가로채지 않는지 확인한다. */
import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {setupEnv} from '../helpers/env.js';

mock.timers.enable({apis:['setTimeout','setInterval']});
const env = setupEnv();
const {S} = await import('../../src/state.js');
const {normScale, stepScale, applyUiScale, initUiScale,
       MIN_SCALE, MAX_SCALE, SCALE_STEP} = await import('../../src/ui-scale.js');

initUiScale();
const doc = env.document;

/* Ctrl+휠 한 번. deltaY < 0 = 위로 굴림 = 확대 */
function wheel({ctrl=true, up=true} = {}){
  const e = new env.window.Event('wheel', {bubbles:true, cancelable:true});
  e.ctrlKey = ctrl; e.deltaY = up ? -120 : 120;
  env.window.dispatchEvent(e);
  return e;
}

test('normScale: 범위 밖은 자르고, 10% 격자에 맞추고, 손상값은 100', () => {
  assert.equal(normScale(100), 100);
  assert.equal(normScale(123), 120, '10% 격자로 반올림');
  assert.equal(normScale(1000), MAX_SCALE, '상한으로 자름');
  assert.equal(normScale(10), MIN_SCALE, '하한으로 자름');
  for(const bad of [undefined, null, 'abc', NaN, Infinity])
    assert.equal(normScale(bad), 100, `${String(bad)} → 100`);
});

test('stepScale: 한 칸씩 오르내리고 끝에서 멈춘다', () => {
  assert.equal(stepScale(100, +1), 100 + SCALE_STEP);
  assert.equal(stepScale(100, -1), 100 - SCALE_STEP);
  assert.equal(stepScale(MAX_SCALE, +1), MAX_SCALE, '상한에서 더 안 올라감');
  assert.equal(stepScale(MIN_SCALE, -1), MIN_SCALE, '하한에서 더 안 내려감');
});

test('applyUiScale: 100%는 zoom을 비우고, 확대는 배수로 넣는다', () => {
  applyUiScale(130);
  assert.equal(doc.body.style.zoom, '1.3');
  applyUiScale(100);
  assert.equal(doc.body.style.zoom, '', '등배에서는 zoom을 남기지 않는다');
});

test('Ctrl+휠: 위로 굴리면 커지고 아래로 굴리면 작아진다 + settings 저장', async () => {
  await env.resetS(); S.loaded = true;

  wheel({up:true});
  assert.equal(S.settings.uiScale, 110);
  assert.equal(doc.body.style.zoom, '1.1');

  wheel({up:true});
  assert.equal(S.settings.uiScale, 120);

  wheel({up:false});
  assert.equal(S.settings.uiScale, 110);

  // 저장은 묶여서 한 번만 (휠은 연속으로 쏟아진다)
  assert.equal(env.invokeCalls.filter(c=>c.cmd==='save_settings').length, 0, '아직 디바운스 중');
  mock.timers.tick(500);
  assert.equal(env.invokeCalls.filter(c=>c.cmd==='save_settings').length, 1);
});

test('맨 휠은 가로채지 않는다 — 보드·목록 스크롤 보존', async () => {
  await env.resetS(); S.loaded = true;
  const e = wheel({ctrl:false, up:true});
  assert.equal(S.settings.uiScale, undefined, '크기가 바뀌면 안 된다');
  assert.equal(e.defaultPrevented, false, 'preventDefault 하면 스크롤이 죽는다');
});

test('Ctrl+휠은 기본 동작을 막는다 (브라우저 자체 확대 방지)', async () => {
  await env.resetS(); S.loaded = true;
  const e = wheel({up:true});
  assert.equal(e.defaultPrevented, true);
});

test('상한에서 계속 굴려도 저장이 폭주하지 않는다', async () => {
  mock.timers.tick(500);              // 앞 테스트가 남긴 디바운스 저장 흘려보내기
  await env.resetS(); S.loaded = true;
  S.settings.uiScale = MAX_SCALE;
  for(let i=0;i<5;i++) wheel({up:true});
  mock.timers.tick(500);
  assert.equal(S.settings.uiScale, MAX_SCALE);
  assert.equal(env.invokeCalls.filter(c=>c.cmd==='save_settings').length, 0,
    '값이 안 바뀌면 저장도 하지 않는다');
});

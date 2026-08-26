/* 캡처 브리지 — 이벤트→captureMemo 라우팅(F1 게이트 계약) + 트레이 첫 안내.
   단축키는 v2.31부터 Rust 고정값(설정 UI 없음)이라 여기서 검증할 게 없다. */
import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {setupEnv} from '../helpers/env.js';

mock.timers.enable({apis:['setTimeout','setInterval']});
const env = setupEnv();
const {S} = await import('../../src/state.js');
const {initCapture, sendCaptureConfig} = await import('../../src/capture-bridge.js');
initCapture();

const $ = id => env.document.getElementById(id);

test('캡처 이벤트 수신: S.loaded=true → 아이템 push + save_all', async () => {
  await env.resetS(); S.loaded = true;
  env.fireEvent('wmhh://capture-memo', {text:'  전화 메모  '});
  await env.flush();
  assert.equal(S.items.length, 1);
  assert.equal(S.items[0].memo, '전화 메모');
  assert.equal(S.items[0].staged, true);
  assert.ok(env.invokeCalls.some(c=>c.cmd==='save_all'));
});

test('F1 게이트: S.loaded=false → 아이템은 push되지만 save_all은 없음 (pending-merge 계약)', async () => {
  await env.resetS();                       // S.loaded=false
  env.fireEvent('wmhh://capture-memo', {text:'로드 전 메모'});
  await env.flush();
  assert.equal(S.items.length, 1);          // 메모는 인메모리에 남아 pending-merge가 수거
  assert.ok(!env.invokeCalls.some(c=>c.cmd==='save_all'));
});

test('빈 payload 이벤트는 무시', async () => {
  await env.resetS(); S.loaded = true;
  env.fireEvent('wmhh://capture-memo', {});
  env.fireEvent('wmhh://capture-memo', undefined);
  await env.flush();
  assert.equal(S.items.length, 0);
});

test('트레이 첫 안내: hidden-to-tray 후 창 focus 시 1회만 토스트 + 플래그 저장', async () => {
  await env.resetS(); S.loaded = true;
  env.fireEvent('wmhh://hidden-to-tray');
  $('toast').classList.remove('on');
  env.window.dispatchEvent(new env.window.Event('focus'));
  await env.flush();
  assert.ok($('toast').classList.contains('on'));
  assert.equal(S.settings.trayNoticeShown, true);
  assert.ok(env.invokeCalls.some(c=>c.cmd==='save_settings' && c.args.settings.trayNoticeShown===true));
  // 두 번째부터는 침묵
  env.fireEvent('wmhh://hidden-to-tray');
  $('toast').classList.remove('on');
  env.window.dispatchEvent(new env.window.Event('focus'));
  await env.flush();
  assert.equal($('toast').classList.contains('on'), false);
});

/* ── 미니 창 구성 전달 (v2.6.0) ─────────────────────────────────────────── */
test('capture-hello 를 받으면 설정을 capture 창으로 내려보낸다', async () => {
  await env.resetS(); S.loaded = true;
  S.settings.theme='dark'; S.settings.capStart='memo'; S.settings.capSecond='form';
  env.fireEvent('wmhh://capture-hello', {});
  await env.flush();
  const cfg = env.emitted.filter(e=>e.name==='wmhh://capture-config').at(-1);
  assert.equal(cfg.target, 'capture');
  assert.deepEqual(cfg.payload, {theme:'dark', capStart:'memo', capSecond:'form'});
});


test("첫 화면이 '양식 메모': Rust 에 모드를 알리고, open-blank-form 을 받으면 빈 양식을 연다 (v2.6.3)", async () => {
  await env.resetS(); S.loaded = true;
  S.settings.capStart = 'form';
  sendCaptureConfig();
  const call = env.invokeCalls.filter(c=>c.cmd==='set_capture_form_mode').at(-1);
  assert.deepEqual(call.args, {form:true});
  env.fireEvent('wmhh://open-blank-form', {});
  await env.flush();
  assert.ok($('formPanel').classList.contains('on'));
  assert.equal($('fm-memo').value, '');
  assert.equal(S.items.length, 0);                    // 저장은 사용자가 [저장]을 눌러야
  $('formPanel').classList.remove('on');
});

test("첫 화면이 검색·빠른 메모면 Rust 에 form:false — 미니 창이 뜬다", async () => {
  await env.resetS(); S.loaded = true;
  S.settings.capStart = 'memo'; S.settings.capSecond = 'form';
  sendCaptureConfig();
  assert.deepEqual(env.invokeCalls.filter(c=>c.cmd==='set_capture_form_mode').at(-1).args, {form:false});
});

test('빠른검색에서 완료 업무는 읽기 전용, 미완료 업무는 편집 가능으로 열린다', async () => {
  await env.resetS(); S.loaded = true;
  const done = {id:1, memo:'완료 업무', done:true};
  const open = {id:2, memo:'진행 중 업무', done:false};
  S.items.push(done, open);

  env.fireEvent('wmhh://open-item', {id:done.id});
  await env.flush();
  assert.ok($('formPanel').classList.contains('on'));
  assert.ok($('formPanel').classList.contains('fm-ro'), '완료 업무는 읽기 전용으로 연다');
  assert.equal($('fm-memo').disabled, true, '완료 업무 입력은 잠긴다');

  $('formPanel').classList.remove('on');
  env.fireEvent('wmhh://open-item', {id:open.id});
  await env.flush();
  assert.equal($('formPanel').classList.contains('fm-ro'), false, '미완료 업무는 편집 모드로 연다');
  assert.equal($('fm-memo').disabled, false);
});

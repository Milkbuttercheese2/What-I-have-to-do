/* 설정 팝업 (v2.6.0) — 테마 2×2 · 미니 창 시작 화면/등록 방식.
   선택은 즉시 저장되고, 메인 테마는 html[data-theme], 미니 창은 capture-config 로 전달된다. */
import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {setupEnv} from '../helpers/env.js';

mock.timers.enable({apis:['setTimeout','setInterval']});
const env = setupEnv();
const {S} = await import('../../src/state.js');
const {initSettingsMenu, openSettings, closeSettings, syncSettings} = await import('../../src/settings-menu.js');
initSettingsMenu();

const $ = id => env.document.getElementById(id);
const click = el => el.dispatchEvent(new env.window.MouseEvent('click', {bubbles:true}));
const segBtn = (segId, v) => $(segId).querySelector(`.seg-btn[data-v="${v}"]`);
const configs = () => env.emitted.filter(e=>e.name==='wmhh://capture-config');
const saved = () => env.invokeCalls.filter(c=>c.cmd==='save_settings');

test('설정 버튼 → 팝업 열림, 저장된 값이 세그먼트에 표시된다', async () => {
  await env.resetS(); S.loaded = true;
  S.settings.theme = 'dark'; S.settings.capStart = 'memo';
  click($('settingsBtn'));
  assert.ok($('settingsModal').classList.contains('on'));
  assert.ok(segBtn('segTheme','dark').classList.contains('on'));
  assert.equal(segBtn('segTheme','light').classList.contains('on'), false);
  assert.ok(segBtn('segCapStart','memo').classList.contains('on'));
  assert.ok(segBtn('segCapTheme','dark').classList.contains('on'));    // 저장값 없으면 기본(어둡게)
});

test('메인 테마 선택 → html[data-theme] 즉시 반영 + 저장 + 표시 갱신', async () => {
  await env.resetS(); S.loaded = true;
  openSettings();
  click(segBtn('segTheme','dark'));
  assert.equal(S.settings.theme, 'dark');
  assert.equal(env.document.documentElement.getAttribute('data-theme'), 'dark');
  assert.equal(saved().length, 1);
  assert.ok(segBtn('segTheme','dark').classList.contains('on'));
  click(segBtn('segTheme','light'));
  assert.equal(env.document.documentElement.getAttribute('data-theme'), 'light');
  assert.ok($('settingsModal').classList.contains('on'));              // 선택해도 팝업은 열어둔다
});

test('미니 창 설정 → capture 창으로 구성 전달 (테마·시작 화면·등록 방식)', async () => {
  await env.resetS(); S.loaded = true;
  openSettings();
  click(segBtn('segCapTheme','light'));
  click(segBtn('segCapStart','memo'));
  click(segBtn('segCapSubmit','form'));
  assert.equal(S.settings.capTheme, 'light');
  assert.equal(S.settings.capStart, 'memo');
  assert.equal(S.settings.capSubmit, 'form');
  const last = configs().at(-1);
  assert.equal(last.target, 'capture');
  assert.deepEqual(last.payload, {capTheme:'light', capStart:'memo', capSubmit:'form'});
});

test('같은 값을 다시 눌러도 저장하지 않는다 (불필요한 쓰기 방지)', async () => {
  await env.resetS(); S.loaded = true;
  S.settings.theme = 'light';
  openSettings();
  click(segBtn('segTheme','light'));
  assert.equal(saved().length, 0);
});

test('실행 버튼(백업 등)을 누르면 설정 팝업은 닫힌다 · 배경 클릭도 닫는다', async () => {
  await env.resetS(); S.loaded = true;
  openSettings();
  click($('bkExp'));
  assert.equal($('settingsModal').classList.contains('on'), false);
  openSettings();
  click($('settingsModal'));                                            // 배경(모달 바깥) 클릭
  assert.equal($('settingsModal').classList.contains('on'), false);
  openSettings(); click($('settingsClose'));
  assert.equal($('settingsModal').classList.contains('on'), false);
});

test('syncSettings: 저장값이 깨져 있어도 기본값 쪽이 켜진다', async () => {
  await env.resetS(); S.loaded = true;
  S.settings.theme = 'DARK'; S.settings.capSubmit = 42;
  syncSettings();
  assert.ok(segBtn('segTheme','light').classList.contains('on'));
  assert.ok(segBtn('segCapSubmit','inbox').classList.contains('on'));
  closeSettings();
});

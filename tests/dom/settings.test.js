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

test('설정 변경 → capture 창으로 구성 전달 (테마는 앱 전체 값 하나)', async () => {
  await env.resetS(); S.loaded = true;
  openSettings();
  click(segBtn('segTheme','dark'));
  click(segBtn('segCapStart','memo'));
  assert.equal(S.settings.theme, 'dark');
  assert.equal(S.settings.capStart, 'memo');
  const last = configs().at(-1);
  assert.equal(last.target, 'capture');
  assert.deepEqual(last.payload, {theme:'dark', capStart:'memo', capSecond:'search'});
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
  S.settings.theme = 'DARK'; S.settings.capStart = 42;
  syncSettings();
  assert.ok(segBtn('segTheme','light').classList.contains('on'));
  assert.ok(segBtn('segCapStart','search').classList.contains('on'));
  closeSettings();
});

test('부팅 캐시(v2.6.2): 선택 즉시 localStorage 에 반영 — 다음 실행 첫 페인트용', async () => {
  await env.resetS(); S.loaded = true;
  openSettings();
  click(segBtn('segTheme','dark'));
  click(segBtn('segCapStart','memo'));
  assert.equal(env.window.localStorage.getItem('wmhhTheme'), 'dark');
  assert.equal(env.window.localStorage.getItem('wmhhCapStart'), 'memo');
  assert.equal(env.window.localStorage.getItem('wmhhCapSecond'), 'search');
  closeSettings();
});

test("화면 배치(3P2): 첫 화면과 겹치는 둘째 화면 버튼은 못 고른다 + 겹치면 자동으로 밀린다", async () => {
  await env.resetS(); S.loaded = true;
  openSettings();
  assert.equal(segBtn('segCapSecond','search').disabled, true);   // 첫 화면(검색)과 같은 항목
  assert.ok(segBtn('segCapSecond','memo').classList.contains('on'));
  click(segBtn('segCapSecond','form'));                            // 검색 → Alt → 양식 메모
  assert.equal(S.settings.capSecond, 'form');
  click(segBtn('segCapStart','form'));                             // 첫 화면을 양식 메모로 (겹침)
  assert.equal(S.settings.capStart, 'form');
  assert.notEqual(S.settings.capSecond, 'form');                   // 둘째가 자동으로 밀린다
  assert.deepEqual(env.invokeCalls.filter(c=>c.cmd==='set_capture_form_mode').at(-1).args, {form:true});
  [...$('segCapSecond').querySelectorAll('.seg-btn')].forEach(b=>assert.equal(b.disabled, true));
  assert.match($('capOrderNote').textContent, /Alt 전환이 없습니다/);
  click(segBtn('segCapStart','memo'));                             // 다시 미니 창 경로로
  assert.deepEqual(env.invokeCalls.filter(c=>c.cmd==='set_capture_form_mode').at(-1).args, {form:false});
  assert.match($('capOrderNote').textContent, /Ctrl\+Alt\+Space →/);
  closeSettings();
});

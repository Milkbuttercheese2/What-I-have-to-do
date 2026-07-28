/* 미니 캡처 창 — Ctrl+Enter 등록·Enter 개행·IME 가드·Esc·blur 드래프트 유지
   capture.html 위에서 돌고, capture-win.js는 앱 모듈을 import하지 않는다. */
import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {setupEnv} from '../helpers/env.js';

mock.timers.enable({apis:['setTimeout','setInterval']});
const env = setupEnv({html: 'capture.html'});
const {initCaptureWin} = await import('../../src/capture-win.js');
initCaptureWin();

const inp = env.document.getElementById('cap-inp');
const body = env.document.body;
const key = init => inp.dispatchEvent(new env.window.KeyboardEvent('keydown', Object.assign({bubbles:true, cancelable:true}, init)));
const emits = () => env.emitted.filter(e=>e.name==='wmhh://capture-memo');
const hides = () => env.emitted.filter(e=>e.hide);
const reset = () => { env.emitted.length = 0; inp.value=''; body.classList.remove('flash'); };

test('Ctrl+Enter: main으로 emitTo + 입력 클리어 + 플래시, 400ms 후 플래시 해제 + 숨김', () => {
  reset();
  inp.value = '  긴급 회신  ';
  key({key:'Enter', ctrlKey:true});
  assert.equal(emits().length, 1);
  assert.deepEqual(emits()[0], {target:'main', name:'wmhh://capture-memo', payload:{text:'긴급 회신'}});
  assert.equal(inp.value, '');
  assert.ok(body.classList.contains('flash'));
  assert.equal(hides().length, 0);
  // 플래시(등록 처리) 중의 blur는 조기 숨김을 유발하지 않는다
  env.window.dispatchEvent(new env.window.Event('blur'));
  assert.equal(hides().length, 0);
  mock.timers.tick(400);
  assert.equal(body.classList.contains('flash'), false);
  assert.equal(hides().length, 1);
});

test('맨 Enter는 등록하지 않는다 (개행 — 메인 바로 입력과 동일 규칙)', () => {
  reset();
  inp.value = '여러 줄 메모';
  key({key:'Enter'});
  assert.equal(emits().length, 0);
  assert.equal(inp.value, '여러 줄 메모');
});

test('IME 조합 중(isComposing) Ctrl+Enter는 무시', () => {
  reset();
  inp.value = '한글 조합중';
  const e = new env.window.KeyboardEvent('keydown', {key:'Enter', ctrlKey:true, bubbles:true, cancelable:true});
  Object.defineProperty(e, 'isComposing', {value: true});
  inp.dispatchEvent(e);
  assert.equal(emits().length, 0);
  assert.equal(inp.value, '한글 조합중');
});

test('빈 입력에서 Ctrl+Enter → 발신 없이 숨기기만', () => {
  reset();
  inp.value = '   ';
  key({key:'Enter', ctrlKey:true});
  assert.equal(emits().length, 0);
  assert.equal(hides().length, 1);
});

const drafts = () => env.emitted.filter(e=>e.name==='wmhh://capture-draft');

test('Esc: 내용을 유지한 채 숨기고 초안을 플러시 (v3.1.0 — 삭제는 사용자만)', () => {
  reset();
  inp.value = '이어서 쓸 메모';
  key({key:'Escape'});
  assert.equal(inp.value, '이어서 쓸 메모');       // 절대 지우지 않는다
  assert.equal(hides().length, 1);
  assert.equal(emits().length, 0);
  assert.equal(drafts().at(-1).payload.text, '이어서 쓸 메모');   // 초안 저장 플러시
});

test('blur: 숨기되 드래프트는 유지 + 초안 플러시', () => {
  reset();
  inp.value = '전화 중 끊긴 메모';
  env.window.dispatchEvent(new env.window.Event('blur'));
  assert.equal(hides().length, 1);
  assert.equal(inp.value, '전화 중 끊긴 메모');
  assert.equal(drafts().at(-1).payload.text, '전화 중 끊긴 메모');
});

test('Ctrl+Enter 등록 시 초안을 빈 값으로 플러시 (재시작 중복 등록 방지)', () => {
  reset();
  inp.value = '등록할 메모';
  key({key:'Enter', ctrlKey:true});
  assert.equal(drafts().at(-1).payload.text, '');
  mock.timers.tick(400);
});

/* (v2.5.5) 'Ctrl 단독 → open_main_maximized' 기능 제거 — 관련 테스트 삭제 */

/* v2.5.21: 기본 모드 = 검색, Alt 로 빠른 메모. placeholder 대신 힌트줄 안내 */
const searchInp = env.document.getElementById('cap-search');
const hint = env.document.getElementById('cap-hint');
const alt = () => env.document.dispatchEvent(new env.window.KeyboardEvent('keydown', {key:'Alt', bubbles:true, cancelable:true}));

test('창을 열면 검색 모드로 시작한다 (메모칸은 감춰짐)', () => {
  assert.ok(body.classList.contains('search'));
  assert.equal(inp.style.display, 'none');
  assert.equal(searchInp.style.display, '');
  assert.match(hint.textContent, /검색/);
});

test('Alt: 빠른 메모 모드로 전환 → 다시 Alt 로 검색 모드', () => {
  alt();
  assert.equal(body.classList.contains('search'), false);
  assert.equal(inp.style.display, '');
  assert.match(hint.textContent, /빠른 메모/);
  alt();
  assert.ok(body.classList.contains('search'));
});

test('입력칸에는 placeholder 를 두지 않는다 (빈 칸의 회색 문구 오해 방지)', () => {
  assert.equal(inp.getAttribute('placeholder'), null);
  assert.equal(searchInp.getAttribute('placeholder'), null);
});

test('다시 열리면(focus) 검색어를 비운 검색 모드로 초기화 — 메모 초안은 유지', () => {
  reset();
  inp.value = '이어서 쓸 메모';
  searchInp.value = '지난 검색어';
  alt();                                            // 메모 모드로 이동한 상태에서
  assert.equal(body.classList.contains('search'), false);
  env.window.dispatchEvent(new env.window.Event('focus'));
  assert.ok(body.classList.contains('search'));
  assert.equal(searchInp.value, '');
  assert.equal(inp.value, '이어서 쓸 메모');
});

test('입력 시 초안이 디바운스 후 전송된다', () => {
  reset();
  inp.value = '타이핑 중';
  inp.dispatchEvent(new env.window.Event('input', {bubbles:true}));
  assert.equal(drafts().length, 0);               // 아직 (400ms 디바운스)
  mock.timers.tick(400);
  assert.equal(drafts().at(-1).payload.text, '타이핑 중');
});

/* ── 설정 연동 (v2.6.0): 테마·시작 화면·Ctrl+Enter 동작 ─────────────────── */
const {applyCaptureConfig, openFresh} = await import('../../src/capture-win.js');
const hellos = () => env.emitted.filter(e=>e.name==='wmhh://capture-hello');
const forms  = () => env.emitted.filter(e=>e.name==='wmhh://capture-form');

test('창이 뜰 때마다 메인 창에 구성을 요청한다 (capture-hello)', () => {
  reset();
  env.window.dispatchEvent(new env.window.Event('focus'));
  assert.equal(hellos().length, 1);
  assert.deepEqual(hellos()[0].target, 'main');
});

test('테마: capTheme=light 면 body.light, dark 면 해제', () => {
  applyCaptureConfig({capTheme:'light'});
  assert.ok(body.classList.contains('light'));
  applyCaptureConfig({capTheme:'dark'});
  assert.equal(body.classList.contains('light'), false);
});

test('시작 화면: capStart=memo 면 창을 열 때 빠른 메모로 시작', () => {
  applyCaptureConfig({capStart:'memo'});
  openFresh();
  assert.equal(body.classList.contains('search'), false);
  assert.equal(inp.style.display, '');
  applyCaptureConfig({capStart:'search'});
  openFresh();
  assert.ok(body.classList.contains('search'));
});

test('Ctrl+Enter: capSubmit=form 이면 등록 대신 양식 열기 이벤트 + 메인 창 포커스', () => {
  reset();
  applyCaptureConfig({capStart:'memo', capSubmit:'form'});
  openFresh();
  inp.value = '양식으로 정리할 건';
  key({key:'Enter', ctrlKey:true});
  assert.equal(emits().length, 0);                       // capture-memo 는 나가지 않는다
  assert.deepEqual(forms().at(-1), {target:'main', name:'wmhh://capture-form', payload:{text:'양식으로 정리할 건'}});
  assert.ok(env.invokeCalls.some(c=>c.cmd==='focus_main_window'));
  assert.equal(inp.value, '');
  assert.equal(hides().length, 1);                       // 플래시 없이 바로 숨김
  assert.equal(body.classList.contains('flash'), false);
  mock.timers.tick(400);
  applyCaptureConfig({capStart:'search', capSubmit:'inbox'});
});

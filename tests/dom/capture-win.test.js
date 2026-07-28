/* 미니 캡처 창 — Ctrl+Enter 등록·Enter 개행·IME 가드·Esc·blur 드래프트 유지
   capture.html 위에서 돌고, capture-win.js는 앱 모듈을 import하지 않는다. */
import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {setupEnv} from '../helpers/env.js';

/* Date 도 모의한다 — v2.6.4 '뜨자마자 온 blur 무시' 가드가 Date.now() 로 시간을 재기 때문 */
mock.timers.enable({apis:['setTimeout','setInterval','Date']});
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
  mock.timers.tick(500);                          // 창이 뜬 직후 가드(450ms)를 지난 뒤
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

test('단축키로 새로 뜨면(capture-shown) 검색어를 비운 첫 화면으로 초기화 — 메모 초안은 유지', () => {
  reset();
  inp.value = '이어서 쓸 메모';
  searchInp.value = '지난 검색어';
  alt();                                            // 메모 모드로 이동한 상태에서
  assert.equal(body.classList.contains('search'), false);
  env.fireEvent('wmhh://capture-shown', {});        // Rust 가 창을 띄우며 보내는 신호
  assert.ok(body.classList.contains('search'));
  assert.equal(searchInp.value, '');
  assert.equal(inp.value, '이어서 쓸 메모');
});

test('포커스만 돌아온 경우에는 초기화하지 않는다 — 치던 검색어가 살아 있다 (v2.6.5)', () => {
  reset();
  searchInp.value = '쓰던 검색어';
  env.window.dispatchEvent(new env.window.Event('focus'));   // 다른 창 보고 돌아옴
  assert.equal(searchInp.value, '쓰던 검색어');
  assert.ok(body.classList.contains('search'));
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

test('창이 뜰 때마다 메인 창에 구성을 요청한다 (capture-hello)', () => {
  reset();
  env.window.dispatchEvent(new env.window.Event('focus'));
  assert.equal(hellos().length, 1);
  assert.deepEqual(hellos()[0].target, 'main');
});

test('테마: 앱 전체 테마를 그대로 따른다 (dark 면 검정 패널, light 면 흰 패널)', () => {
  applyCaptureConfig({theme:'dark'});
  assert.equal(body.classList.contains('light'), false);
  applyCaptureConfig({theme:'light'});
  assert.ok(body.classList.contains('light'));
});

test('첫 화면: capStart=memo 면 창을 열 때 빠른 메모로 시작', () => {
  applyCaptureConfig({capStart:'memo', capSecond:'search'});
  openFresh();
  assert.equal(body.classList.contains('search'), false);
  assert.equal(inp.style.display, '');
  applyCaptureConfig({capStart:'search', capSecond:'memo'});
  openFresh();
  assert.ok(body.classList.contains('search'));
});

test("배치(3P2): Alt 목적지가 '양식 메모'면 미니 창을 접고 메인 양식을 연다", () => {
  reset();
  applyCaptureConfig({capStart:'search', capSecond:'form'});
  openFresh();
  assert.match(hint.textContent, /Alt 를 누르면 양식 메모/);
  alt();
  assert.equal(env.emitted.filter(e=>e.name==='wmhh://open-blank-form').length, 1);
  assert.ok(env.invokeCalls.some(c=>c.cmd==='focus_main_window'));
  assert.equal(hides().length, 1);
  mock.timers.tick(400);
  applyCaptureConfig({capStart:'search', capSecond:'memo'});
});

test('창이 뜬 직후의 blur 는 무시한다 — 다른 앱이 포커스를 가져가도 사라지지 않는다 (v2.6.4)', () => {
  reset();
  env.window.dispatchEvent(new env.window.Event('focus'));   // 창이 막 떴다
  env.emitted.length = 0;
  env.window.dispatchEvent(new env.window.Event('blur'));    // 브라우저가 뜨면서 포커스를 뺏음
  assert.equal(hides().length, 0);                           // 숨지 않는다
  mock.timers.tick(500);
  env.window.dispatchEvent(new env.window.Event('blur'));    // 그 뒤의 blur 는 정상적으로 숨김
  assert.equal(hides().length, 1);
});

test('검색 결과: ↑↓ 로 고르고 Enter 로 연다 (v2.6.4)', async () => {
  reset();
  applyCaptureConfig({capStart:'search', capSecond:'memo'});
  openFresh();
  env.onInvoke('quick_search', () => [{id:11, memo:'첫째', done:false},
                                      {id:22, memo:'둘째', done:false},
                                      {id:33, memo:'셋째', done:true}]);
  searchInp.value = '메모';
  searchInp.dispatchEvent(new env.window.Event('input', {bubbles:true}));
  mock.timers.tick(250);
  await env.flush(5);
  const hitEls = () => [...env.document.querySelectorAll('.cap-hit')];
  assert.equal(hitEls().length, 3);
  /* v2.6.7: 검색만 해서는 아무 줄도 켜지지 않는다 — 손대지 않은 하이라이트가 남지 않게 */
  assert.equal(hitEls().filter(el=>el.classList.contains('sel')).length, 0);
  const key2 = init => searchInp.dispatchEvent(new env.window.KeyboardEvent('keydown', Object.assign({bubbles:true, cancelable:true}, init)));
  key2({key:'ArrowDown'});
  assert.ok(hitEls()[0].classList.contains('sel'));          // 첫 ↓ = 첫 줄
  key2({key:'ArrowDown'});
  key2({key:'ArrowDown'});
  assert.ok(hitEls()[2].classList.contains('sel'));          // 마지막 줄
  key2({key:'ArrowDown'});
  assert.ok(hitEls()[2].classList.contains('sel'), '맨 아래에서 더 내려가지 않는다(순환 없음)');
  key2({key:'ArrowUp'});
  assert.ok(hitEls()[1].classList.contains('sel'), '맨 아래에서도 ↑ 로 다시 올라간다');
  key2({key:'ArrowUp'});
  assert.ok(hitEls()[0].classList.contains('sel'));
  key2({key:'ArrowUp'});
  assert.ok(hitEls()[0].classList.contains('sel'), '맨 위에서 더 올라가지 않는다');
  key2({key:'ArrowDown'}); key2({key:'ArrowDown'});          // 다시 마지막 줄로
  env.emitted.length = 0;
  key2({key:'Enter'});
  const opened = env.emitted.filter(e=>e.name==='wmhh://open-item');
  assert.deepEqual(opened.at(-1).payload, {id:33});           // 고른 항목이 열린다
  assert.ok(env.invokeCalls.some(c=>c.cmd==='focus_main_window'));
  assert.equal(hides().length, 1);
});

test('빠른 메모: Ctrl+S 로도 등록된다 (v2.6.4)', () => {
  reset();
  applyCaptureConfig({capStart:'memo', capSecond:'search'});
  openFresh();
  inp.value = 'Ctrl+S 로 저장할 메모';
  key({key:'s', ctrlKey:true});
  assert.deepEqual(emits().at(-1), {target:'main', name:'wmhh://capture-memo', payload:{text:'Ctrl+S 로 저장할 메모'}});
  assert.equal(inp.value, '');
  assert.ok(body.classList.contains('flash'));
  mock.timers.tick(400);
  applyCaptureConfig({capStart:'search', capSecond:'memo'});
});

test('목록이 다시 그려져도 고른 항목을 유지한다 — 디바운스가 뒤늦게 터져도 제자리로 안 돌아간다 (v2.6.5)', async () => {
  reset();
  applyCaptureConfig({capStart:'search', capSecond:'memo'});
  openFresh();
  env.onInvoke('quick_search', () => [{id:11, memo:'첫째', done:false},
                                      {id:22, memo:'둘째', done:false},
                                      {id:33, memo:'셋째', done:false}]);
  searchInp.value = '메모';
  searchInp.dispatchEvent(new env.window.Event('input', {bubbles:true}));
  mock.timers.tick(250); await env.flush(5);
  const hitEls = () => [...env.document.querySelectorAll('.cap-hit')];
  const key2 = init => searchInp.dispatchEvent(new env.window.KeyboardEvent('keydown', Object.assign({bubbles:true, cancelable:true}, init)));
  key2({key:'ArrowDown'}); key2({key:'ArrowDown'}); key2({key:'ArrowDown'});
  assert.ok(hitEls()[2].classList.contains('sel'));          // 셋째를 골라둔 상태
  await runSearchAgain();                                     // 같은 검색어로 목록 재생성
  assert.ok(hitEls()[2].classList.contains('sel'), '고른 자리를 그대로 이어간다');
  async function runSearchAgain(){
    searchInp.dispatchEvent(new env.window.Event('input', {bubbles:true}));
    mock.timers.tick(250); await env.flush(5);
  }
});

test('감출 때 검색 화면을 미리 비운다 — 다음에 뜰 때 지난 검색어가 번쩍이지 않는다 (v2.6.6)', async () => {
  reset();
  applyCaptureConfig({capStart:'search', capSecond:'memo'});
  openFresh();
  env.onInvoke('quick_search', () => [{id:11, memo:'지난 결과', done:false}]);
  searchInp.value = '지난 검색어';
  searchInp.dispatchEvent(new env.window.Event('input', {bubbles:true}));
  mock.timers.tick(250); await env.flush(5);
  assert.equal(env.document.querySelectorAll('.cap-hit').length, 1);
  mock.timers.tick(500);                                   // 창이 뜬 직후 가드 지난 뒤
  env.window.dispatchEvent(new env.window.Event('blur'));  // 다른 창으로 → 숨김
  assert.equal(hides().length, 1);
  assert.equal(searchInp.value, '', '숨는 순간 이미 비어 있다');
  assert.equal(env.document.querySelectorAll('.cap-hit').length, 0);
  assert.ok(body.classList.contains('search'));            // 첫 화면·창 높이까지 맞춰 둔다
});

test('Rust 토글로 숨은 경우에도 화면을 비운다 (capture-hidden, v2.6.6)', async () => {
  reset();
  openFresh();
  env.onInvoke('quick_search', () => [{id:11, memo:'지난 결과', done:false}]);
  searchInp.value = '지난 검색어';
  searchInp.dispatchEvent(new env.window.Event('input', {bubbles:true}));
  mock.timers.tick(250); await env.flush(5);
  env.fireEvent('wmhh://capture-hidden', {});
  assert.equal(searchInp.value, '');
  assert.equal(env.document.querySelectorAll('.cap-hit').length, 0);
});

test('아무 줄도 고르지 않은 채 Enter 를 누르면 첫 결과가 열린다 (v2.6.7)', async () => {
  reset();
  applyCaptureConfig({capStart:'search', capSecond:'memo'});
  openFresh();
  env.onInvoke('quick_search', () => [{id:77, memo:'첫 결과', done:false},
                                      {id:88, memo:'둘째', done:false}]);
  searchInp.value = '결과';
  searchInp.dispatchEvent(new env.window.Event('input', {bubbles:true}));
  mock.timers.tick(250); await env.flush(5);
  assert.equal([...env.document.querySelectorAll('.cap-hit.sel')].length, 0);
  env.emitted.length = 0;
  searchInp.dispatchEvent(new env.window.KeyboardEvent('keydown', {key:'Enter', bubbles:true, cancelable:true}));
  assert.deepEqual(env.emitted.filter(e=>e.name==='wmhh://open-item').at(-1).payload, {id:77});
});

test('hover 하이라이트는 마우스를 움직였을 때만 켠다 — 창이 커서 밑에 떠도 줄이 켜지지 않는다 (v2.6.7)', () => {
  reset();
  openFresh();
  assert.equal(body.classList.contains('mouse'), false, '새로 뜰 때는 마우스 모드 아님');
  env.document.dispatchEvent(new env.window.MouseEvent('mousemove', {bubbles:true}));
  assert.ok(body.classList.contains('mouse'));
  searchInp.dispatchEvent(new env.window.KeyboardEvent('keydown', {key:'ArrowDown', bubbles:true, cancelable:true}));
  assert.equal(body.classList.contains('mouse'), false, '키보드를 쓰면 hover 표시는 꺼진다');
});

test('목록 밖에서 휠을 굴려도 결과 목록이 스크롤된다 (v2.6.8)', async () => {
  reset();
  applyCaptureConfig({capStart:'search', capSecond:'memo'});
  openFresh();
  env.onInvoke('quick_search', () => Array.from({length:20}, (_,i)=>({id:i+1, memo:'업무 '+(i+1), done:false})));
  searchInp.value = '업무';
  searchInp.dispatchEvent(new env.window.Event('input', {bubbles:true}));
  mock.timers.tick(250); await env.flush(5);
  const list = env.document.getElementById('cap-items');
  list.scrollTop = 0;
  const ev = new env.window.WheelEvent('wheel', {deltaY:120, bubbles:true, cancelable:true});
  searchInp.dispatchEvent(ev);                       // 검색칸(목록 밖) 위에서 휠
  assert.equal(list.scrollTop, 120, '목록으로 넘어가 스크롤된다');
});

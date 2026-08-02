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

test('Esc: 내용을 유지한 채 숨기고 초안을 플러시 (v3.0.1 — 삭제는 사용자만)', () => {
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

test('빠른 메모 태그: 하이라이트 렌더 + hover 클릭 → 검색 화면 점프 (v3.0.2 통일 정책)', async () => {
  reset();
  env.onInvoke('phonebook_list', ()=>[{id:1, who:'김철수', org:'행정과', phone:'010-1'}]);
  env.onInvoke('quick_search', ()=>[]);
  /* loadBook 은 init 때 1회 + '창이 새로 뜰 때'(capture-shown) 마다 — 핸들러 등록 후
     capture-shown 을 쏴서 전화번호부를 실제로 받게 한다 */
  env.fireEvent('wmhh://capture-shown');
  await env.flush();
  // Alt 로 메모 모드 진입 (capture-shown 의 openFresh 가 검색 모드로 초기화하므로 그 뒤에)
  if(body.classList.contains('search'))
    env.document.dispatchEvent(new env.window.KeyboardEvent('keydown', {key:'Alt', bubbles:true}));
  await env.flush();
  inp.value='통화 @김철수 건';
  inp.dispatchEvent(new env.window.Event('input', {bubbles:true}));
  await env.flush();
  const hl=env.document.getElementById('cap-hl');
  assert.equal(hl.querySelectorAll('.at-tag').length, 1);        // 실존 관련인만 하이라이트
  // hover 없이 클릭 → 아무 일도 없음 (기하 판정)
  inp.dispatchEvent(new env.window.MouseEvent('click', {bubbles:true, cancelable:true}));
  assert.ok(body.classList.contains('search')===false);
  // hover 상태에서 클릭 → 검색 화면 점프 + 그 이름이 검색어로
  hl.querySelector('.at-tag').classList.add('hover');
  inp.dispatchEvent(new env.window.MouseEvent('click', {bubbles:true, cancelable:true}));
  assert.ok(body.classList.contains('search'));
  assert.equal(env.document.getElementById('cap-search').value, '김철수');
  assert.ok(env.invokeCalls.some(c=>c.cmd==='quick_search'&&c.args.query==='김철수'));
});

/* v3.0.4: 검색 화면에 빈 띠가 하나 더 생기던 버그 — @ 자동완성 목록(#cap-pb)의
   표시 여부를 JS 인라인 style 로 다루던 탓에, 그 인라인이 'block' 인 채 남으면
   검색 화면이 [입력칸 | 빈 띠 | 결과] 3단으로 쪼개졌다. 이제 body.pb 클래스 하나가
   유일한 스위치이고(capture.html 에서 검색·플래시 중엔 규칙상 자리조차 못 갖는다),
   closePb 는 pbOpen 과 무관하게 항상 화면을 정리한다. */
test('@ 자동완성 목록은 검색 화면으로 넘어가면 반드시 접힌다 (v3.0.4 빈 띠 버그)', async () => {
  reset();
  env.onInvoke('phonebook_search', ()=>[{id:1, who:'김철수', org:'행정과', phone:'010-1'}]);
  env.onInvoke('quick_search', ()=>[]);
  const pb = env.document.getElementById('cap-pb');
  if(body.classList.contains('search')) alt();          // 빠른 메모 화면으로
  inp.value='통화 @김철';
  inp.selectionStart = inp.value.length;
  inp.dispatchEvent(new env.window.Event('input', {bubbles:true}));
  mock.timers.tick(150);                                 // 디바운스
  await env.flush();
  assert.ok(body.classList.contains('pb'));              // 목록이 펴졌다
  assert.equal(pb.style.display, '');                    // 인라인 style 로는 아무것도 안 한다
  alt();                                                 // 검색 화면으로
  assert.ok(body.classList.contains('search'));
  assert.equal(body.classList.contains('pb'), false);    // 클래스가 사라져 자리도 없어진다
  assert.equal(pb.innerHTML, '');
});

test('닫힌 뒤 뒤늦게 도착한 자동완성 응답은 목록을 되살리지 않는다 (v3.0.4)', async () => {
  reset();
  env.onInvoke('phonebook_search', ()=>[{id:1, who:'김철수', org:'행정과', phone:'010-1'}]);
  if(body.classList.contains('search')) alt();
  inp.value='통화 @김철';
  inp.selectionStart = inp.value.length;
  inp.dispatchEvent(new env.window.Event('input', {bubbles:true}));
  alt();                                                 // 응답 전에 검색 화면으로 이동
  mock.timers.tick(150);
  await env.flush();
  assert.ok(body.classList.contains('search'));
  assert.equal(body.classList.contains('pb'), false);
});

/* v3.3.4: "↓ 로 2번째 줄에 갔다가 곧바로 1번째 줄로 되돌아오는" 버그.
   runPb 는 디바운스(150ms) + 검색 왕복이 끝난 뒤에야 도착하는데, 사람은 그보다
   빨리 ↓ 를 누른다. 예전엔 그때 도착한 응답이 pbSel 을 무조건 0 으로 되돌렸다
   (검색 결과 목록이 v2.6.5 에서 keepId 로 고친 것과 같은 버그가 남아 있었다). */
test('@ 목록: 뒤늦게 도착한 응답이 ↓ 로 고른 줄을 첫 줄로 되돌리지 않는다', async () => {
  reset();
  const book=[{id:1, who:'김철수', org:'행정과', phone:'010-1'},
              {id:2, who:'김철민', org:'재무과', phone:'010-2'},
              {id:3, who:'김철호', org:'감사과', phone:'010-3'}];
  env.onInvoke('phonebook_search', ()=>book);
  if(body.classList.contains('search')) alt();            // 빠른 메모 화면으로
  const pb = env.document.getElementById('cap-pb');
  const selText = () => { const el=pb.querySelector('.cap-pb-it.sel'); return el?el.textContent.replace(/\s+/g,''):null; };

  // 1) 목록을 편다
  inp.value='통화 @김철'; inp.selectionStart=inp.value.length;
  inp.dispatchEvent(new env.window.Event('input', {bubbles:true}));
  mock.timers.tick(150); await env.flush();
  assert.ok(body.classList.contains('pb'));
  assert.ok(selText().startsWith('김철수'), '처음엔 첫 줄');

  // 2) 한 글자 더 치자마자(=응답이 아직 안 옴) ↓ 로 둘째 줄을 고른다
  inp.value='통화 @김철민'; inp.selectionStart=inp.value.length;
  inp.dispatchEvent(new env.window.Event('input', {bubbles:true}));
  key({key:'ArrowDown'});
  assert.ok(selText().startsWith('김철민'), '↓ 직후엔 둘째 줄');

  // 3) 이제 응답이 도착한다 — 고른 사람이 새 목록에도 있으므로 그 자리를 잇는다
  mock.timers.tick(150); await env.flush();
  assert.ok(selText().startsWith('김철민'), '응답이 와도 첫 줄로 되돌아가면 안 된다');

  // 4) 반대로 고른 사람이 새 목록에서 사라지면 그때는 첫 줄로 (정상 동작)
  env.onInvoke('phonebook_search', ()=>[book[2]]);
  inp.value='통화 @김철호'; inp.selectionStart=inp.value.length;
  inp.dispatchEvent(new env.window.Event('input', {bubbles:true}));
  mock.timers.tick(150); await env.flush();
  assert.ok(selText().startsWith('김철호'), '후보가 바뀌면 첫 줄로 돌아간다');
});

/* v3.4.3: "직전 검색을 아래끝으로 내려놨으면 첫 행이 통째로 안 보인다"(사용자 신고).
   innerHTML 을 갈아끼워도 브라우저는 스크롤 위치를 유지하기 때문에, 아래로 내려둔
   목록에 새 후보를 그리면 그 스크롤이 그대로 남아 첫 행부터 가려졌다. 새 후보
   목록은 무조건 맨 위에서 시작한다 — 직전에 얼마나 내려갔든 무관하게. */
test('@ 목록: 직전에 아래끝까지 내려놨어도 새 후보는 첫 행부터 보인다 (v3.4.3)', async () => {
  reset();
  const book = Array.from({length: 14}, (_, i) => ({id:i+1, who:'사람'+(i+1), org:'조달청', phone:'010-0-'+i}));
  env.onInvoke('phonebook_search', ()=>book);
  if(body.classList.contains('search')) alt();
  const pb = env.document.getElementById('cap-pb');

  inp.value='통화 @사람'; inp.selectionStart=inp.value.length;
  inp.dispatchEvent(new env.window.Event('input', {bubbles:true}));
  mock.timers.tick(150); await env.flush();
  assert.equal(pb.querySelectorAll('.cap-pb-it').length, 14);

  pb.scrollTop = 400;                                   // 사용자가 목록을 아래끝까지 내렸다
  inp.value='통화 @사람1'; inp.selectionStart=inp.value.length;
  inp.dispatchEvent(new env.window.Event('input', {bubbles:true}));
  mock.timers.tick(150); await env.flush();
  assert.equal(pb.scrollTop, 0, '새 후보 목록은 맨 위에서 시작해야 한다');
});

/* 위 규칙의 예외는 ↑↓ 조작 하나뿐 — 10행 아래로 내려간 선택을 따라가야 하므로
   그때는 스크롤을 건드리지 않는다(스크롤을 0 으로 되돌리면 고른 줄이 사라진다). */
test('@ 목록: ↑↓ 로 고르는 중에는 스크롤을 되돌리지 않는다 (v3.4.3)', async () => {
  reset();
  const book = Array.from({length: 14}, (_, i) => ({id:i+1, who:'사람'+(i+1), org:'조달청', phone:'010-0-'+i}));
  env.onInvoke('phonebook_search', ()=>book);
  if(body.classList.contains('search')) alt();
  const pb = env.document.getElementById('cap-pb');
  inp.value='통화 @사람'; inp.selectionStart=inp.value.length;
  inp.dispatchEvent(new env.window.Event('input', {bubbles:true}));
  mock.timers.tick(150); await env.flush();

  pb.scrollTop = 120;
  key({key:'ArrowDown'});
  assert.equal(pb.scrollTop, 120, '방향키는 스크롤을 유지한다');
});

/* v3.4.4: 첫 행이 반쯤 잘린 채 굳던 진짜 경로.
   목록은 '창이 아직 126px 인 순간'에 그려지고 그때 #cap-pb 는 40px 남짓이다.
   그 사이 무엇이든(scrollIntoView·스크롤 앵커링·포커스) 목록을 밀면 그 scrollTop 이
   남는데, 후보가 10행을 넘으면 목록이 계속 스크롤 가능이라 창이 커져도 브라우저가
   0 으로 되돌려 주지 않는다. 창이 자리를 잡을 때마다 첫 행을 제자리로 되돌린다. */
test('@ 목록: 창이 자리잡는 사이 목록이 밀려도 첫 행은 되돌아온다 (v3.4.4)', async () => {
  reset();
  const book = Array.from({length: 14}, (_, i) => ({id:i+1, who:'사람'+(i+1), org:'조달청', phone:'010-2-'+i}));
  env.onInvoke('phonebook_search', ()=>book);
  if(body.classList.contains('search')) alt();
  const pb = env.document.getElementById('cap-pb');
  inp.value='통화 @사람'; inp.selectionStart=inp.value.length;
  inp.dispatchEvent(new env.window.Event('input', {bubbles:true}));
  mock.timers.tick(150); await env.flush();
  assert.equal(pb.querySelectorAll('.cap-pb-it').length, 14);

  pb.scrollTop = 60;                       // 창이 커지기 전에 누군가 목록을 밀었다
  mock.timers.tick(80); await env.flush();  // 창 크기 반영 대기 후 보정
  assert.equal(pb.scrollTop, 0, '첫 행이 잘린 채로 굳으면 안 된다');
});

/* 검색어가 좁혀지며 '고르고 있던 사람'의 순번이 보이는 10행 밖으로 밀리는 경우.
   그 자리를 이으면 목록을 스크롤해야 보이고, 그 스크롤이 곧 첫 행이 잘린 화면이다.
   손으로 ↓ 를 눌러 내려간 게 아니므로 첫 줄로 돌아가는 것이 맞다. */
test('@ 목록: 이어갈 자리가 10행 밖이면 잇지 않고 첫 줄로 (v3.4.4)', async () => {
  reset();
  const far = {id:99, who:'멀리있는사람', org:'조달청', phone:'010-9-9'};
  const many = Array.from({length: 12}, (_, i) => ({id:i+1, who:'사람'+(i+1), org:'조달청', phone:'010-3-'+i}));
  env.onInvoke('phonebook_search', ()=>[far, ...many]);       // 처음엔 맨 앞
  if(body.classList.contains('search')) alt();
  const pb = env.document.getElementById('cap-pb');
  const selIdx = () => [...pb.querySelectorAll('.cap-pb-it')].findIndex(el=>el.classList.contains('sel'));
  inp.value='통화 @사람'; inp.selectionStart=inp.value.length;
  inp.dispatchEvent(new env.window.Event('input', {bubbles:true}));
  mock.timers.tick(150); await env.flush();
  assert.equal(selIdx(), 0);

  env.onInvoke('phonebook_search', ()=>[...many, far]);       // 좁혀지며 13번째로 밀렸다
  inp.value='통화 @사람1'; inp.selectionStart=inp.value.length;
  inp.dispatchEvent(new env.window.Event('input', {bubbles:true}));
  mock.timers.tick(150); await env.flush();
  assert.equal(selIdx(), 0, '10행 밖 자리는 잇지 않는다');
  assert.equal(pb.scrollTop, 0);
});

/* v3.4.5: "펴졌다가 다시 접히는" 창. v3.4.3~v3.4.4 의 보정은 다음 요청 크기를
   window.innerHeight 기준으로 계산했는데, 앞서 보낸 리사이즈가 아직 반영되기
   전이면 그 값은 **옛 크기**다 → 이미 가는 중인 490 보다 작은 444 를 뒤이어
   요청했고, 두 요청이 차례로 적용되며 창이 커졌다 도로 접혔다(실렌더 확인:
   지연 150ms 이상에서 매번 재현). 요청한 크기가 반영되기 전에는 다시 요청하지
   않는다 — 그리고 누적 기준은 언제나 '내가 요청한 값'이라 줄어들 수 없다. */
test('@ 목록: 창 크기가 반영되기 전에는 다시 요청하지 않는다 (v3.4.5)', async () => {
  reset();
  const book = Array.from({length: 14}, (_, i) => ({id:i+1, who:'사람'+(i+1), org:'조달청', phone:'010-4-'+i}));
  env.onInvoke('phonebook_search', ()=>book);
  if(body.classList.contains('search')) alt();
  env.invokeCalls.length = 0;                       // 모드 전환분 제외 — 자동완성만 본다

  inp.value='통화 @사람'; inp.selectionStart=inp.value.length;
  inp.dispatchEvent(new env.window.Event('input', {bubbles:true}));
  mock.timers.tick(150); await env.flush();
  for(let i=0;i<10;i++){ mock.timers.tick(80); await env.flush(); }   // 보정 회차를 모두 돌린다

  const hs = env.invokeCalls.filter(c=>c.cmd==='resize_capture').map(c=>c.args.height);
  assert.equal(hs.length, 1, `창이 요청대로 안 커지는 동안에는 한 번만 요청해야 한다 (실제: ${hs.join(',')})`);
  for(let i=1;i<hs.length;i++) assert.ok(hs[i]>=hs[i-1], '요청 높이는 한 검색 안에서 줄어들 수 없다');
});

/* v3.4.9: 빠른 메모의 태그 하이라이트는 **입력칸과 같은 만큼 스크롤**돼야 한다.
   입력칸은 110px 에서 자라기를 멈추고 그 뒤로는 안에서 스크롤되는데, 백드롭이
   맨 위에 남으면 하이라이트가 실제 글자보다 아래에 그려진다(사용자 신고:
   "하이라이트가 아래로 밀리고 @태그가 첫 줄로 안 올라간다"). 양식 메모(form.js)에는
   처음부터 있던 동기화가 미니 창에만 빠져 있었다. */
test('빠른 메모: 하이라이트 백드롭이 입력칸 스크롤을 따라간다 (v3.4.9)', async () => {
  reset();
  if(body.classList.contains('search')) alt();
  const hl = env.document.getElementById('cap-hl');
  inp.value = Array.from({length:12},(_,i)=>'메모 줄 '+(i+1)).join('\n');
  inp.scrollTop = 120;                                  // 긴 메모라 입력칸이 안에서 스크롤된 상태
  inp.dispatchEvent(new env.window.Event('input', {bubbles:true}));
  assert.equal(hl.scrollTop, 120, '백드롭이 같은 위치로 따라와야 한다');

  inp.scrollTop = 60;                                   // 사용자가 입력칸을 직접 굴린 경우
  inp.dispatchEvent(new env.window.Event('scroll', {bubbles:true}));
  assert.equal(hl.scrollTop, 60);
});

/* 창(body·#cap-shell)은 overflow:hidden 이지만 프로그램·포커스 스크롤은 먹는다.
   패널이 창보다 잠깐 커진 순간 캐럿을 보이려고 브라우저가 body 를 밀면 입력줄이
   위로 잘린 채 굳는다 — 창이 자리를 잡을 때마다 0 으로 되돌린다. */
test('미니 창 자체는 스크롤된 채로 굳지 않는다 (v3.4.9)', async () => {
  reset();
  const book = Array.from({length: 12}, (_, i) => ({id:i+1, who:'사람'+(i+1), org:'조달청', phone:'010-5-'+i}));
  env.onInvoke('phonebook_search', ()=>book);
  if(body.classList.contains('search')) alt();
  const shell = env.document.getElementById('cap-shell');
  const root = env.document.scrollingElement || env.document.documentElement;

  inp.value='통화 @사람'; inp.selectionStart=inp.value.length;
  inp.dispatchEvent(new env.window.Event('input', {bubbles:true}));
  mock.timers.tick(150); await env.flush();

  root.scrollTop = 30; shell.scrollTop = 18;             // 포커스 스크롤 등으로 밀린 상황
  mock.timers.tick(80); await env.flush();               // 창이 자리를 잡는 시점
  assert.equal(root.scrollTop, 0, '창이 밀린 채로 굳으면 입력줄이 잘린다');
  assert.equal(shell.scrollTop, 0);
});

/* v3.4.9: @자동완성 목록도 목록 밖에서 굴린 휠을 받는다. 예전엔 검색 화면에서만
   동작해, 후보가 10행을 넘어 스크롤이 생겨도 입력칸·힌트줄 위에서 굴리면 아무 일도
   없었다(v2.6.8 이 검색 목록에만 적용됐던 규칙을 자동완성에도 넓힌 것). */
test('@ 자동완성: 목록 밖에서 굴린 휠도 그 목록을 스크롤한다 (v3.4.9)', async () => {
  reset();
  const book = Array.from({length: 14}, (_, i) => ({id:i+1, who:'사람'+(i+1), org:'조달청', phone:'010-6-'+i}));
  env.onInvoke('phonebook_search', ()=>book);
  if(body.classList.contains('search')) alt();
  const pb = env.document.getElementById('cap-pb');
  inp.value='통화 @사람'; inp.selectionStart=inp.value.length;
  inp.dispatchEvent(new env.window.Event('input', {bubbles:true}));
  mock.timers.tick(150); await env.flush();
  assert.ok(body.classList.contains('pb'));

  const hint = env.document.getElementById('cap-hint');       // 목록 밖(힌트줄) 위에서 굴린다
  const ev = new env.window.WheelEvent('wheel', {deltaY: 90, bubbles: true, cancelable: true});
  hint.dispatchEvent(ev);
  assert.equal(pb.scrollTop, 90, '자동완성 목록으로 넘어가 스크롤돼야 한다');
});

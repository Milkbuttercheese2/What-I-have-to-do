/* 업무 공유(양식의 [공유] → 미리 보기 창) · 양식 메모 구역 제목 선
   공유 버튼 자리·이름, 미리 보기 열기/ESC 닫기, 공유가 업무를 저장하지 않음, 저장 전 고친 내용이 실림 */
import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {setupEnv} from '../helpers/env.js';

mock.timers.enable({apis:['setTimeout','setInterval']});
const env = setupEnv();
const {S, newId} = await import('../../src/state.js');
const {openForm, closeForm, initForm} = await import('../../src/form.js');
const {closeTop, isOpen} = await import('../../src/modals.js');
initForm();

const $ = id => env.document.getElementById(id);
const input = el => el.dispatchEvent(new env.window.Event('input', {bubbles:true}));
const isoMin = min => { const d = new Date(Date.now() + min*60e3); d.setSeconds(0,0); return d.toISOString(); };

function item(over){
  return Object.assign({id:newId(), memo:'입찰공고 정정 사유 확인\n시설과 요청\n[통화 내용]\n사유서는 내일 오전에.', done:false, staged:false,
    f:{received:isoMin(-60), due:isoMin(60*30)},
    contacts:[{who:'김서준 주무관', org:'시설과', phone:'02-000-0000', email:'k@example.go.kr'}],
    ids:[{kind:'공고번호', val:'R26BK00123456'}],
    subs:[{id:newId(), title:'정정 사유서 받기', mid:isoMin(-30), done:true, al:{}, owner:''}],
    files:['C:\\업무\\정정요청.hwpx'], al:{}}, over||{});
}
async function fresh(){ await env.resetS(); S.loaded=true; while(closeTop()); }

test('공유 버튼: 진행 중 양식의 단추 줄 맨 앞, 이름 "공유"', async () => {
  await fresh();
  const it=item(); S.items.push(it); openForm(it);
  const b=$('fm-share');
  assert.ok(b, '공유 버튼이 있다');
  assert.equal(b.parentElement.className.includes('fm-actions'), true);
  assert.equal(b.parentElement.firstElementChild, b, '.fm-actions 맨 앞(임시저장 표시 앞)');
  assert.equal(b.nextElementSibling.id, 'fm-draft');
  assert.equal(b.getAttribute('aria-label'), '공유');
  assert.equal(b.getAttribute('title'), '공유');
  assert.ok(b.querySelector('svg path'), '글자 대신 SVG 아이콘');
  assert.equal(b.disabled, false);
  closeForm();
});

test('공유 버튼: 완료 업무(읽기 전용 양식)에서도 맨 앞에 있고 눌린다', async () => {
  await fresh();
  const it=item({done:true, doneAt:new Date(2026,10,26,17,0).getTime()}); S.items.push(it);
  openForm(it, {readonly:true});
  const b=$('fm-share');
  assert.ok($('formPanel').classList.contains('fm-ro'));
  assert.equal(b.parentElement.firstElementChild, b);
  assert.equal(b.disabled, false, '읽기 전용에서도 공유는 살려 둔다');
  b.click();
  assert.ok(isOpen('shareModal'));
  assert.match($('share-stage').querySelector('.shc-hd span').textContent, /^완료 2026\/11\/26 17:00 · \d{4}\/\d{2}\/\d{2} \d{2}:\d{2} 기준$/, '머리에 완료 시각');
  while(closeTop());
});

test('공유 버튼 → 미리 보기 창, ESC 로 미리 보기만 닫히고 양식으로', async () => {
  await fresh();
  const it=item(); S.items.push(it); openForm(it);
  $('fm-share').click();
  assert.ok($('shareModal').classList.contains('on'));
  assert.equal($('shareModal').querySelector('h3').textContent, '업무 공유');
  assert.ok($('share-stage').querySelector('.shc'), '메모지가 그려짐');
  for(const id of ['share-img','share-text','share-save']) assert.ok($(id), id);
  assert.equal($('share-img').textContent, '그림 복사');
  assert.ok($('share-img').classList.contains('btn-ok'), '[그림 복사]가 주 동작');
  /* 2026-11-28 단추 규칙: 이 창을 연 까닭인 [그림 복사]만 '할 일이 생김'(녹색), 나머지는 흰 단추 */
  assert.ok($('share-img').classList.contains('ready'), '[그림 복사]는 창이 뜨자마자 녹색');
  for(const id of ['share-text','share-save']) assert.equal($(id).classList.contains('ready'), false, `${id} 는 흰 단추`);
  env.document.dispatchEvent(new env.window.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
  closeTop();                                         // main.js 의 ESC 처리와 같은 길(맨 위 한 장)
  assert.equal($('shareModal').classList.contains('on'), false);
  assert.ok($('formPanel').classList.contains('on'), '양식은 그대로');
  closeForm();
});

test('공유는 업무를 저장하지 않는다 — 열고·펼치고·글자로 복사해도 save_all 없음, S.items 그대로', async () => {
  await fresh();
  const it=item({contacts:Array.from({length:4},(_,i)=>({who:`사람${i}`, org:'과', phone:'', email:''}))}); S.items.push(it);
  const before=JSON.stringify(S.items);
  openForm(it);
  $('fm-memo').value='고친 메모'; input($('fm-memo'));
  env.invokeCalls.length=0;
  $('fm-share').click();
  $('share-stage').querySelector('.sh-fold[data-fold="people"]').click();
  let copied=null;
  Object.defineProperty(globalThis.navigator, 'clipboard', {value:{writeText:async t=>{ copied=t; }}, configurable:true});
  $('share-text').click(); await env.flush();
  mock.timers.tick(1000); await env.flush();
  assert.ok(copied && copied.startsWith('[업무 공유]'), '글자로 복사');
  assert.equal(env.invokeCalls.filter(c=>c.cmd==='save_all').length, 0);
  assert.equal(JSON.stringify(S.items), before, '업무 자체는 바뀌지 않음');
  delete globalThis.navigator.clipboard;
  while(closeTop());
});

test('저장 전 고친 내용이 실린다(메모·관련인) · 연락처·파일 링크는 기본으로 빠지고 스위치로 연락처만', async () => {
  await fresh();
  const it=item(); S.items.push(it); openForm(it);
  $('fm-memo').value='새 제목 줄\n본문'; input($('fm-memo'));
  $('fm-contacts').querySelector('.c-who').value='이고침 주무관';
  $('fm-share').click();
  const st=$('share-stage');
  assert.equal(st.querySelector('.shc-title').textContent, '새 제목 줄');
  assert.ok(st.textContent.includes('이고침 주무관'));
  assert.ok(!st.textContent.includes('02-000-0000'), '연락처는 기본으로 뺌');
  assert.ok(!st.textContent.includes('k@example.go.kr'), '이메일은 기본으로 뺌');
  assert.ok(!st.textContent.includes('정정요청'), '파일 링크는 싣지 않음');
  assert.ok(!st.querySelector('.shc-ft').textContent.includes('뺌'), '바닥줄에 "…는 뺌" 없음(2026-11-28 소유자 지정)');
  $('share-contacts').checked=true; $('share-contacts').dispatchEvent(new env.window.Event('change', {bubbles:true}));
  assert.ok(!$('share-stage').querySelector('.shc-ft').textContent.includes('뺌'), '연락처를 넣어도 "파일 링크는 뺌" 없음');
  assert.ok($('share-stage').textContent.includes('02-000-0000'));
  assert.ok($('share-stage').textContent.includes('k@example.go.kr'));
  assert.ok(!$('share-stage').textContent.includes('정정요청'), '스위치를 켜도 파일 링크는 안 들어감');
  while(closeTop());
});

test('[펼치기]/[접기]: 누르면 그 칸이 다 실리고 단추 글이 바뀐다', async () => {
  await fresh();
  const it=item({contacts:Array.from({length:5},(_,i)=>({who:`사람${i} 주무관`, org:`부서${i}`, phone:'', email:''}))}); S.items.push(it); openForm(it);
  $('fm-share').click();
  const st=$('share-stage'), count=()=>st.querySelectorAll('.shc-kv .who').length;
  assert.equal(count(), 2);
  assert.equal(st.querySelectorAll('.shc-kv b').length, 0, '관련인 이름은 굵게 하지 않는다(2026-11-28 소유자 지정)');
  assert.ok([...st.querySelectorAll('.shc-more span')].some(s=>s.textContent==='외 3명'));
  st.querySelector('.sh-fold[data-fold="people"]').click();
  assert.equal(count(), 5);
  assert.match(st.querySelector('.sh-fold[data-fold="people"]').textContent, /접기/);
  st.querySelector('.sh-fold[data-fold="people"]').click();
  assert.equal(count(), 2);
  while(closeTop());
});

test('[그림 복사]: 클립보드에 그림을 넣을 수 없는 환경이면 까닭을 알리고 [파일로 저장]을 권한다', async () => {
  await fresh();
  const it=item(); S.items.push(it); openForm(it);
  $('fm-share').click();
  env.alerts.length=0;
  $('share-img').click(); await env.flush();
  assert.equal(env.alerts.length, 1);
  assert.match(env.alerts[0], /그림을 클립보드에 넣을 수 없습니다/);
  assert.match(env.alerts[0], /파일로 저장/);
  while(closeTop());
});

test('양식 메모 칸: [제목] 한 줄 위에 선 표시 — 맨 처음 [제목]·뒤에 글이 붙은 줄·줄 가운데 대괄호는 선 없음', async () => {
  await fresh();
  openForm({memo:'[제목]\n첫 글\n[통화 내용]\n[긴급] 오늘 중\n시행령 [별표 2] 참조\n  [검토할 것]  \n끝'});
  const hl=$('fm-memo-hl');
  const marks=[...hl.querySelectorAll('.msec')].map(m=>m.nextSibling.textContent.split('\n')[0]);
  assert.deepEqual(marks, ['[통화 내용]', '  [검토할 것]  ']);
  assert.equal(hl.textContent, $('fm-memo').value+'\n', '백드롭 글자는 메모 그대로(선 표시는 빈 요소)');
  $('fm-memo').value='[제목]\n본문'; input($('fm-memo'));
  assert.equal(hl.querySelectorAll('.msec').length, 0);
  closeForm();
});

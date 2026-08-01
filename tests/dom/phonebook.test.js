/* 전화번호부 탭 + @ 자동완성 (v2.7.0) — 추가/수정/삭제, 아이템에서 가져오기,
   바로 입력 @삽입, 양식 관련인 칸 자동완성 채움 */
import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {setupEnv} from '../helpers/env.js';

mock.timers.enable({apis:['setTimeout','setInterval']});
const env = setupEnv();
const {S} = await import('../../src/state.js');
const {initPhonebook, renderPhonebook, adoptPhonebook} = await import('../../src/phonebook.js');
const {initAtComplete} = await import('../../src/at-complete.js');
const {initForm, openForm} = await import('../../src/form.js');
initPhonebook(); initAtComplete(); initForm();

const $ = id => env.document.getElementById(id);
const input = el => el.dispatchEvent(new env.window.Event('input', {bubbles:true}));
const key = (el, k) => el.dispatchEvent(new env.window.KeyboardEvent('keydown', {key:k, bubbles:true, cancelable:true}));

test('직접 추가: 저장(save_phonebook) + 목록 렌더 + 중복 차단', async () => {
  await env.resetS(); S.loaded = true;
  $('pb-org').value='행정과'; $('pb-who').value='김철수'; $('pb-phone').value='010-1234-5678';
  $('pb-save').click();
  assert.equal(S.phonebook.length, 1);
  assert.equal(S.phonebook[0].who, '김철수');
  assert.ok(S.phonebook[0].id > 0);
  assert.ok(env.invokeCalls.some(c=>c.cmd==='save_phonebook'));
  assert.ok($('pb-list').textContent.includes('김철수'));
  assert.equal($('pb-count').textContent, '1');
  // 표기만 다른 전화(하이픈 없음)는 같은 사람 — 추가 거부
  $('pb-org').value='행정과'; $('pb-who').value='김철수'; $('pb-phone').value='01012345678';
  $('pb-save').click();
  assert.equal(S.phonebook.length, 1);
  assert.ok(env.alerts.some(a=>a.includes('이미')));
});

test('수정·삭제: 수정 저장이 항목을 갱신하고 삭제가 목록·저장에 반영', async () => {
  await env.resetS(); S.loaded = true;
  adoptPhonebook([{id:11, who:'김철수', org:'행정과', phone:'010-1'}, {id:12, who:'이영희', org:'세무과', phone:'010-2'}]);
  renderPhonebook();
  $('pb-list').querySelector('[data-pbedit="11"]').click();
  assert.equal($('pb-who').value, '김철수');
  $('pb-phone').value='010-9999-0000';
  $('pb-save').click();
  assert.equal(S.phonebook.find(e=>e.id===11).phone, '010-9999-0000');
  $('pb-list').querySelector('[data-pbdel="12"]').click();     // confirm 기본 true
  assert.equal(S.phonebook.length, 1);
  assert.ok(!$('pb-list').textContent.includes('이영희'));
});

test('아이템에서 가져오기: 없는 관련인만 일괄 추가 (중복 제외)', async () => {
  await env.resetS(); S.loaded = true;
  adoptPhonebook([{id:11, who:'이영희', org:'', phone:''}]);
  S.items=[{id:1, contacts:[{who:'김철수', org:'행정과', phone:'010-1'}, {who:'이영희', org:'', phone:''}]},
           {id:2, contacts:[{who:'김철수', org:'행정과', phone:'010-1'}]}];
  $('pb-import').click();
  assert.equal(S.phonebook.length, 2);                          // 김철수만 새로 추가
  assert.ok(S.phonebook.some(e=>e.who==='김철수'&&e.id>0));
  $('pb-import').click();                                       // 다시 눌러도 추가할 게 없음
  assert.equal(S.phonebook.length, 2);
  assert.ok(env.alerts.some(a=>a.includes('없습니다')));
});

test('바로 입력 @자동완성: @김철 → 드롭다운 → Enter 로 텍스트 삽입', async () => {
  await env.resetS(); S.loaded = true;
  adoptPhonebook([{id:11, who:'김철수', org:'행정과', phone:'010-1234-5678'}]);
  const inp=$('inp');
  inp.value='민원 @김철'; inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length);
  input(inp);
  const drop=env.document.getElementById('atDrop');
  assert.equal(drop.style.display, 'block');
  assert.ok(drop.textContent.includes('김철수'));
  key(inp, 'Enter');
  assert.equal(inp.value, '민원 @김철수(행정과 010-1234-5678)');   // @태그 + 정보 병기
  assert.equal(drop.style.display, 'none');
});

test('바로 입력 @자동완성: 일치 없으면 드롭다운이 열리지 않는다', async () => {
  await env.resetS(); S.loaded = true;
  adoptPhonebook([{id:11, who:'김철수', org:'행정과', phone:'010-1'}]);
  const inp=$('inp');
  inp.value='@없는사람'; inp.setSelectionRange(inp.value.length, inp.value.length);
  input(inp);
  assert.equal(env.document.getElementById('atDrop').style.display, 'none');
});

test('양식 관련인 칸: 이름 일부만 쳐도 드롭다운 → 클릭 시 그 행 3칸 채움', async () => {
  await env.resetS(); S.loaded = true;
  adoptPhonebook([{id:11, who:'김철수', org:'행정과', phone:'010-1234-5678'}]);
  openForm({});
  const row=$('fm-contacts').querySelector('.contact-row');
  const who=row.querySelector('.c-who');
  who.value='김철'; who.focus();
  input(who);
  const drop=env.document.getElementById('atDrop');
  assert.equal(drop.style.display, 'block');
  drop.querySelector('[data-ati="0"]').dispatchEvent(new env.window.MouseEvent('mousedown', {bubbles:true, cancelable:true}));
  assert.equal(row.querySelector('.c-who').value, '김철수');
  assert.equal(row.querySelector('.c-org').value, '행정과');
  assert.equal(row.querySelector('.c-phone').value, '010-1234-5678');
  assert.equal(drop.style.display, 'none');
});

test('양식 메모 @자동완성: @태그는 완성형으로 남고 관련인 행이 채워진다 (중복 선택은 1번만)', async () => {
  await env.resetS(); S.loaded = true;
  adoptPhonebook([{id:11, who:'김철수', org:'행정과', phone:'010-1234-5678'}]);
  openForm({});
  const memo=$('fm-memo');
  memo.value='회신 요청 @김철'; memo.focus(); memo.setSelectionRange(memo.value.length, memo.value.length);
  input(memo);
  const drop=env.document.getElementById('atDrop');
  assert.equal(drop.style.display, 'block');
  key(memo, 'Enter');
  assert.equal(memo.value, '회신 요청 @김철수');                // 태그는 지우지 않는다 (소유자 지정)
  const rows=()=>[...$('fm-contacts').querySelectorAll('.contact-row')];
  assert.equal(rows()[0].querySelector('.c-who').value, '김철수');
  // 같은 사람을 다시 골라도 관련인은 한 번만 — 태그만 하나 더 남는다
  memo.value=memo.value+' 그리고 @김철'; memo.setSelectionRange(memo.value.length, memo.value.length);
  input(memo);
  key(memo, 'Enter');
  assert.equal(memo.value, '회신 요청 @김철수 그리고 @김철수');
  const filled=rows().filter(r=>r.querySelector('.c-who').value==='김철수');
  assert.equal(filled.length, 1);
});

test('@태그 클릭 → 관련 업무 팝업 (이름 OR 연락처 일치), 행 클릭이 팝업을 닫는다', async () => {
  await env.resetS(); S.loaded = true;
  adoptPhonebook([{id:11, who:'김철수', org:'행정과', phone:'010-1234-5678'}]);
  S.items=[
    {id:1, memo:'이름으로 적은 건', contacts:[{who:'김철수', org:'', phone:''}], done:false},
    {id:2, memo:'번호만 적은 건', contacts:[{who:'', org:'', phone:'01012345678'}], done:true},
    {id:3, memo:'메모에 @김철수 태그만', contacts:[], done:false},
    {id:4, memo:'무관한 업무', contacts:[{who:'박영수', org:'', phone:'010-9'}], done:false},
  ];
  // 카드에 렌더된 것과 같은 @태그를 클릭한 상황
  const tag=env.document.createElement('span');
  tag.className='at-tag'; tag.dataset.at='김철수';
  env.document.body.appendChild(tag);
  tag.dispatchEvent(new env.window.MouseEvent('click', {bubbles:true, cancelable:true}));
  const modal=env.document.getElementById('relModal');
  assert.ok(modal.classList.contains('on'));
  const hits=[...modal.querySelectorAll('.rel-hit')].map(el=>Number(el.dataset.open));
  assert.deepEqual(hits, [3,1,2]);                              // 미완료 먼저·최신순, 무관한 4는 제외
  // 행 클릭 → 팝업 닫힘 (양식 열기 자체는 render.js data-open 위임 몫)
  modal.querySelector('[data-open="1"]').dispatchEvent(new env.window.MouseEvent('click', {bubbles:true}));
  assert.ok(!modal.classList.contains('on'));
  tag.remove();
});

test('백업 왕복: adoptPhonebook 이 id 없는 항목에 id 를 채우고 lastId 를 시드한다 (F12)', async () => {
  await env.resetS();
  adoptPhonebook([{who:'김철수', org:'행정과', phone:'010-1'}, {id:99999, who:'이영희', org:'', phone:'010-2'}, {who:'', org:'', phone:''}]);
  assert.equal(S.phonebook.length, 2);                          // 빈 껍데기 제거
  assert.ok(S.phonebook[0].id > 0);
  assert.ok(S.lastId >= 99999);                                 // 기존 id 가 lastId 를 밀어올림
});

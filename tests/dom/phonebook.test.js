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
const {initForm, openForm, captureMemo} = await import('../../src/form.js');
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
  // v2.9.0 무결성: 3칸이 다 없으면 거부 (일부만 아는 관련인은 메모에)
  $('pb-org').value=''; $('pb-who').value='이영희'; $('pb-phone').value='';
  $('pb-save').click();
  assert.equal(S.phonebook.length, 1);
  assert.ok(env.alerts.some(a=>a.includes('모두 입력')));
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

test('새로고침: 3칸 완비 관련인만 확인 팝업(표준 모달)에 모아 [모두 추가]', async () => {
  await env.resetS(); S.loaded = true;
  adoptPhonebook([{id:11, who:'이영희', org:'세무과', phone:'010-2'}]);
  S.items=[{id:1, contacts:[{who:'김철수', org:'행정과', phone:'010-1'}, {who:'박이름만', org:'', phone:''}]},
           {id:2, contacts:[{who:'김철수', org:'행정과', phone:'010-1'}, {who:'이영희', org:'세무과', phone:'010-2'}]}];
  $('pb-import').click();
  const modal=env.document.getElementById('pbSyncModal');
  assert.ok(modal.classList.contains('on'));                    // confirm 대신 앱 모달
  assert.equal(modal.querySelectorAll('.pbs-row').length, 1);   // 김철수만 (이름만인 박이름만·이미 있는 이영희 제외)
  env.document.getElementById('pbs-add').click();
  assert.ok(!modal.classList.contains('on'));
  assert.equal(S.phonebook.length, 2);
  assert.ok(S.phonebook.some(e=>e.who==='김철수'&&e.id>0));
  $('pb-import').click();                                       // 다시 눌러도 추가할 게 없음 → 토스트
  assert.ok(!modal.classList.contains('on'));
  assert.equal(S.phonebook.length, 2);
  assert.ok(env.document.getElementById('toast-msg').textContent.includes('없습니다'));
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
  assert.equal(inp.value, '민원 @김철수');   // v2.9.0: 완성형 태그만 (정보는 등록 시 관련인으로)
  assert.equal(drop.style.display, 'none');
});

test('빠른 메모 등록: 메모 속 @태그의 관련인이 자동 첨부된다 (중복 없이)', async () => {
  await env.resetS(); S.loaded = true;
  adoptPhonebook([{id:11, who:'김철수', org:'행정과', phone:'010-1234-5678'},
                  {id:12, who:'이영희', org:'세무과', phone:'010-2'}]);
  captureMemo('통화함 @김철수 회신 요망 @김철수 @이영희');
  await env.flush();
  assert.equal(S.items.length, 1);
  const cs=S.items[0].contacts;
  assert.deepEqual(cs.map(c=>c.who), ['김철수','이영희']);       // 같은 태그 두 번 = 한 번만
  assert.equal(cs[0].org, '행정과');
  assert.equal(cs[0].phone, '010-1234-5678');
  // 전화번호부에 없는 태그는 그냥 텍스트 — 관련인 없음
  captureMemo('@모르는사람 메모');
  await env.flush();
  assert.deepEqual(S.items[1].contacts, []);
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

test('양식 메모 본문 @태그: 하이라이트 + 태그 위 클릭 → 관련 업무 팝업, 카드 태그는 클릭 안 됨', async () => {
  await env.resetS(); S.loaded = true;
  adoptPhonebook([{id:11, who:'김철수', org:'행정과', phone:'010-1234-5678'}]);
  S.items=[
    {id:1, memo:'이름으로 적은 건', contacts:[{who:'김철수', org:'', phone:''}], done:false},
    {id:2, memo:'번호만 적은 건', contacts:[{who:'', org:'', phone:'01012345678'}], done:true},
    {id:3, memo:'메모에 @김철수 태그만', contacts:[], done:false},
    {id:4, memo:'무관한 업무', contacts:[{who:'박영수', org:'', phone:'010-9'}], done:false},
  ];
  // 양식을 열면 백드롭 층에 본문 태그 하이라이트가 깔린다 (v2.11.0 — 별도 칩 없음)
  openForm({memo:'통화 @김철수 건'});
  const hl=env.document.getElementById('fm-memo-hl');
  assert.equal(hl.querySelectorAll('.at-tag').length, 1);
  // 본문에서 캐럿을 태그 위에 놓고 클릭 → 팝업
  const memo=$('fm-memo');
  const at=memo.value.indexOf('@')+1;
  memo.setSelectionRange(at, at);
  memo.dispatchEvent(new env.window.MouseEvent('click', {bubbles:true, cancelable:true}));
  const modal=env.document.getElementById('relModal');
  assert.ok(modal.classList.contains('on'));
  const hits=[...modal.querySelectorAll('.rel-hit')].map(el=>Number(el.dataset.open));
  assert.deepEqual(hits, [3,1,2]);                              // 미완료 먼저·최신순, 무관한 4는 제외
  // 행 클릭 → 팝업 닫힘 (양식 열기 자체는 render.js data-open 위임 몫)
  modal.querySelector('[data-open="1"]').dispatchEvent(new env.window.MouseEvent('click', {bubbles:true}));
  assert.ok(!modal.classList.contains('on'));
  // 태그 밖(일반 본문)을 클릭하면 그냥 편집 — 팝업 없음
  memo.setSelectionRange(0, 0);
  memo.dispatchEvent(new env.window.MouseEvent('click', {bubbles:true, cancelable:true}));
  assert.ok(!modal.classList.contains('on'));
  // 카드 위 .at-tag 는 클릭해도 팝업이 뜨지 않는다 (색 표시만)
  const cardTag=env.document.createElement('span');
  cardTag.className='at-tag'; cardTag.dataset.at='김철수';
  env.document.body.appendChild(cardTag);
  cardTag.dispatchEvent(new env.window.MouseEvent('click', {bubbles:true, cancelable:true}));
  assert.ok(!modal.classList.contains('on'));
  cardTag.remove();
});

test('양식 저장 시 관련인 → 전화번호부 자동 흡수 (3칸 완비만, 번호 보강 포함)', async () => {
  await env.resetS(); S.loaded = true;
  adoptPhonebook([{id:11, who:'이영희', org:'세무과', phone:''}]);   // 번호 없는 기존 항목 (보강 대상)
  openForm({});
  $('fm-memo').value='새 업무';
  const row=$('fm-contacts').querySelector('.contact-row');
  row.querySelector('.c-org').value='행정과'; row.querySelector('.c-who').value='김철수'; row.querySelector('.c-phone').value='010-1';
  // 둘째 행: 이영희(번호 보강) / 셋째 행: 이름만(자동 흡수 제외)
  env.document.getElementById('fm-contactadd').click();
  const rows=$('fm-contacts').querySelectorAll('.contact-row');
  rows[1].querySelector('.c-org').value='세무과'; rows[1].querySelector('.c-who').value='이영희'; rows[1].querySelector('.c-phone').value='010-2';
  env.document.getElementById('fm-contactadd').click();
  const rows2=$('fm-contacts').querySelectorAll('.contact-row');
  rows2[2].querySelector('.c-who').value='박이름만';
  $('fm-save').click();
  await env.flush();
  assert.equal(S.phonebook.length, 2);                          // 김철수 추가 (박이름만 제외)
  assert.ok(S.phonebook.some(e=>e.who==='김철수'&&e.org==='행정과'&&e.phone==='010-1'));
  assert.equal(S.phonebook.find(e=>e.id===11).phone, '010-2');  // 이영희 번호 보강
  assert.ok(env.invokeCalls.some(c=>c.cmd==='save_phonebook'));
});

test('번호꼴 @태그(@010-…) 본문 클릭도 연락처(숫자만 비교)로 검색된다 — 구버전 번호만 항목 호환', async () => {
  await env.resetS(); S.loaded = true;
  adoptPhonebook([{id:11, who:'', org:'', phone:'010-1234-5678'}]);   // 구버전 데이터 pass-through (신규 입력은 3칸 필수)
  S.items=[
    {id:1, memo:'표기 다른 번호', contacts:[{who:'', org:'', phone:'01012345678'}], done:false},
    {id:2, memo:'무관', contacts:[{who:'', org:'', phone:'02-000'}], done:false},
  ];
  openForm({memo:'회신 @010-1234-5678'});
  assert.equal(env.document.getElementById('fm-memo-hl').querySelectorAll('.at-tag').length, 1);
  const memo=$('fm-memo');
  const at=memo.value.indexOf('@')+3;
  memo.setSelectionRange(at, at);
  memo.dispatchEvent(new env.window.MouseEvent('click', {bubbles:true, cancelable:true}));
  const modal=env.document.getElementById('relModal');
  assert.ok(modal.classList.contains('on'));
  const hits=[...modal.querySelectorAll('.rel-hit')].map(el=>Number(el.dataset.open));
  assert.deepEqual(hits, [1]);
  modal.classList.remove('on');
});

test('본문 하이라이트: 전화번호부 실존 관련인만 — 한 글자만 지워도 태그 해제 (v2.11.0)', async () => {
  await env.resetS(); S.loaded = true;
  adoptPhonebook([{id:11, who:'우성균', org:'행정과', phone:'010-1'}]);
  openForm({memo:'회신 @우성균 건'});
  const hl=env.document.getElementById('fm-memo-hl');
  assert.equal(hl.querySelectorAll('.at-tag').length, 1);
  const memo=$('fm-memo');
  memo.value='회신 @우성 건';                                   // '균' 삭제
  memo.dispatchEvent(new env.window.Event('input', {bubbles:true}));
  assert.equal(hl.querySelectorAll('.at-tag').length, 0);       // 하이라이트 해제 — 평문
  assert.ok(hl.textContent.includes('@우성'));                  // 본문 자체는 그대로 비친다
  // 해제된 태그 위 클릭은 그냥 편집 — 팝업 없음
  memo.setSelectionRange(memo.value.indexOf('@')+1, memo.value.indexOf('@')+1);
  memo.dispatchEvent(new env.window.MouseEvent('click', {bubbles:true, cancelable:true}));
  assert.ok(!env.document.getElementById('relModal').classList.contains('on'));
});

test('전화번호부 정렬: 엮인 업무 수 → 소속 → 이름, 행에 업무 수 배지 (v2.11.0)', async () => {
  await env.resetS(); S.loaded = true;
  adoptPhonebook([
    {id:1, who:'가나다', org:'가과', phone:'010-1'},            // 업무 0건
    {id:2, who:'마바사', org:'나과', phone:'010-2'},            // 업무 2건
    {id:3, who:'아자차', org:'나과', phone:'010-3'},            // 업무 0건 — 2번과 소속 같음
  ]);
  S.items=[
    {id:100, memo:'통화 @마바사', contacts:[], done:false},
    {id:101, memo:'', contacts:[{who:'마바사', org:'나과', phone:'010-2'}], done:false},
  ];
  renderPhonebook();
  const rows=[...$('pb-list').querySelectorAll('.pb-item')].map(el=>Number(el.dataset.pbid));
  assert.deepEqual(rows, [2,1,3]);                              // 업무 많은 마바사 먼저, 나머지는 소속순(가과<나과)
  const first=$('pb-list').querySelector('.pb-item .pb-cnt');
  assert.equal(first.textContent, '업무 2');
});

test('백업 왕복: adoptPhonebook 이 id 없는 항목에 id 를 채우고 lastId 를 시드한다 (F12)', async () => {
  await env.resetS();
  adoptPhonebook([{who:'김철수', org:'행정과', phone:'010-1'}, {id:99999, who:'이영희', org:'', phone:'010-2'}, {who:'', org:'', phone:''}]);
  assert.equal(S.phonebook.length, 2);                          // 빈 껍데기 제거
  assert.ok(S.phonebook[0].id > 0);
  assert.ok(S.lastId >= 99999);                                 // 기존 id 가 lastId 를 밀어올림
});

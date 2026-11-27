/* 단추 색 규칙(2026-11-28 소유자 지정 — "버튼은 다 흰색, 녹색은 할 일이 생겼을 때만").
   평소엔 모든 단추가 흰 단추이고, 누르면 사용자가 방금 한 일이 마무리되는 때만 '할 일이 생김'(.ready, 청록 솔리드)이 켜진다.
   - 양식 [저장]: 임시저장분이 있을 때만(옆에 "임시저장됨"이 뜨는 그 상태) — 깨끗할 때·저장 뒤·되돌리기 뒤·닫은 뒤엔 흰색
   - 입력하면 누를 수 있게 되는 단추([추가]·[＋ 추가]·[등록]·[프리셋 저장]): 입력칸이 비면 흰색, 들어갈 글자가 있으면 녹색
   - 확인 창의 기본 동작·[그림 복사]·알림창 [확인]: 창이 떠 있으면 녹색 / 늘 흰색인 단추(공유·되돌리기·업무 완료·＋ 입력 …)는 .ready 가 없다
   색(테두리 두께가 같아 크기가 그대로인지 등)은 jsdom 이 계산하지 않으므로 실렌더 갈무리로 본다 — 여기서는 켜고 끄는 때만. */
import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {setupEnv} from '../helpers/env.js';

mock.timers.enable({apis:['setTimeout','setInterval']});
const env = setupEnv();
const {S, newId} = await import('../../src/state.js');
const {initToast, appConfirm} = await import('../../src/dom-utils.js');
const {initRender} = await import('../../src/render.js');
const {initForm, openForm, closeForm} = await import('../../src/form.js');
const {initPhonebook} = await import('../../src/phonebook.js');
const {initPresets, openPresetModal} = await import('../../src/presets.js');
const {initRecurBox, openRecurModal} = await import('../../src/recur-box.js');
const {closeTop} = await import('../../src/modals.js');
initToast(); initRender(); initForm(); initPhonebook(); initPresets(); initRecurBox();

const $ = id => env.document.getElementById(id);
const input = el => el.dispatchEvent(new env.window.Event('input', {bubbles:true}));
const click = el => el.dispatchEvent(new env.window.MouseEvent('click', {bubbles:true, cancelable:true}));
const ready = id => $(id).classList.contains('ready');
const type = (id, v) => { $(id).value = v; input($(id)); };
const mk = o => Object.assign({id:newId(), memo:'계약변경 검토', owner:'', done:false, doneAt:null, staged:false, f:{}, contacts:[], ids:[], subs:[], files:[], al:{}, recur:null, recurId:null}, o);
async function fresh(){ await env.resetS(); S.loaded=true; S.doneDirty.clear(); while(closeTop()); env.onInvoke('save_all', ()=>({kind:'Saved', version:1})); }
/* 입력이 멈춘 뒤(700ms) 임시저장 — 그때 "임시저장됨"과 녹색 [저장]이 함께 켜진다 */
async function typeAndPause(id, v){ type(id, v); mock.timers.tick(700); await env.flush(); }

test('양식 [저장]: 깨끗할 때 흰색 → 고치면(임시저장됨) 녹색 → 저장 뒤 다시 흰색', async () => {
  await fresh();
  const it=mk(); S.items.push(it);
  openForm(it); await env.flush();
  assert.equal(ready('fm-save'), false, '연 직후(고친 것 없음)는 흰 단추');
  assert.equal($('fm-draft').textContent, '');
  await typeAndPause('fm-memo', '계약변경 검토 — 산출내역 대조');
  assert.match($('fm-draft').textContent, /^임시저장됨 /);
  assert.equal(ready('fm-save'), true, '저장할 변경이 생기면 녹색');
  await typeAndPause('fm-memo', '계약변경 검토');
  assert.equal(ready('fm-save'), false, '저장본과 같아지면(임시저장분이 사라지면) 다시 흰색');
  await typeAndPause('fm-memo', '계약변경 검토 — 고침');
  assert.equal(ready('fm-save'), true);
  click($('fm-save')); await env.flush();
  assert.equal(it.memo, '계약변경 검토 — 고침');
  assert.equal(ready('fm-save'), false, '저장 뒤 흰색');
  openForm(it); await env.flush();
  assert.equal(ready('fm-save'), false, '다시 열어도 흰색');
  closeForm();
});

test('양식 [저장]: 되돌리기·닫기 뒤 흰색, 임시저장분이 남은 양식을 다시 열면 바로 녹색', async () => {
  await fresh();
  const it=mk(); S.items.push(it);
  openForm(it); await env.flush();
  await typeAndPause('fm-memo', '되돌릴 글');
  assert.equal(ready('fm-save'), true);
  env.answerConfirm(true);
  click($('fm-revert')); await env.flush(6);
  assert.equal($('fm-memo').value, '계약변경 검토', '저장본으로 되돌아감');
  assert.equal(ready('fm-save'), false, '되돌리기 뒤 흰색');
  await typeAndPause('fm-memo', '닫았다 다시 열 글');
  closeForm(); await env.flush();
  assert.equal(ready('fm-save'), false, '닫으면 꺼진다');
  openForm(it); await env.flush();
  assert.equal($('fm-memo').value, '닫았다 다시 열 글', '임시저장분으로 다시 채움');
  assert.equal(ready('fm-save'), true, '저장되지 않은 변경이 있으니 바로 녹색');
  closeForm();
});

test('양식의 늘 흰 단추: 공유·되돌리기·업무 완료·다시 진행·＋ 추가·＋ 입력은 고쳐도 .ready 가 없다', async () => {
  await fresh();
  const it=mk(); S.items.push(it);
  openForm(it); await env.flush();
  await typeAndPause('fm-memo', '고친 글');
  assert.equal(ready('fm-save'), true);
  for(const id of ['fm-share','fm-revert','fm-finish','fm-reopen','fm-subadd','fm-idadd','fm-contactadd','fm-linkadd','fm-book','blankForm'])
    assert.equal(ready(id), false, `${id} 는 늘 흰 단추`);
  closeForm();
});

test('전화번호부 [추가]: 세 칸이 다 차야 녹색, 하나라도 비면 흰색 · [수정]은 바뀐 것이 있을 때만', async () => {
  await fresh();
  S.phonebook=[{id:901, who:'김계약', org:'시설과', phone:'02-000-0000', email:''}];
  click($('pb-add')); await env.flush();
  assert.equal(ready('pb-save'), false, '빈 칸');
  type('pb-org', '조달계약과'); type('pb-who', '이계약');
  assert.equal(ready('pb-save'), false, '연락처가 비면 눌러도 들어가지 않으니 흰색');
  type('pb-phone', '02-000-1300');
  assert.equal(ready('pb-save'), true, '세 칸이 다 차면 녹색');
  type('pb-who', '');
  assert.equal(ready('pb-save'), false, '다시 비우면 흰색');
  while(closeTop());
  assert.equal(ready('pb-save'), false, '닫으면(입력칸 비움) 흰색');
  /* 수정: 불러온 그대로면 흰색, 고치면 녹색 (오른쪽 칸 머리의 [수정]과 같은 data-pbedit 위임) */
  $('pb-list').innerHTML='<button data-pbedit="901">수정</button>';
  click($('pb-list').querySelector('[data-pbedit]')); await env.flush();
  assert.equal($('pb-save').textContent, '저장');
  assert.equal(ready('pb-save'), false, '불러온 그대로');
  type('pb-email', 'kim@example.go.kr');
  assert.equal(ready('pb-save'), true, '이메일을 고치면 녹색');
  while(closeTop());
});

test('식별정보 명칭 [＋ 추가]·[프리셋 저장]: 입력칸이 비면 흰색, 글자가 있으면 녹색', async () => {
  await fresh();
  openPresetModal(); await env.flush();
  assert.equal(ready('idk-add'), false);
  type('idk-new', '계약번호2');
  assert.equal(ready('idk-add'), true);
  click($('idk-add')); await env.flush();
  assert.ok(S.idKinds.includes('계약번호2'));
  assert.equal($('idk-new').value, '');
  assert.equal(ready('idk-add'), false, '추가한 뒤 입력칸이 비면 흰색');
  type('idk-new', '   ');
  assert.equal(ready('idk-add'), false, '빈칸만이면 흰색');

  assert.equal(ready('np-save'), false, '새 프리셋: 버튼 이름이 비면 흰색');
  type('np-sum', '메모만');
  assert.equal(ready('np-save'), false, '버튼 이름이 없으면 저장되지 않으니 흰색');
  type('np-label', '계약변경');
  assert.equal(ready('np-save'), true);
  click($('np-save')); await env.flush(6);
  assert.equal(S.presets.length, 1);
  assert.equal(ready('np-save'), false, '저장 뒤 입력칸이 비어 흰색');
  /* 수정: 불러온 그대로면 흰색, 고치면 녹색 */
  click($('presetList').querySelector('.ps-edit')); await env.flush();
  assert.equal($('np-label').value, '계약변경');
  assert.equal(ready('np-save'), false, '불러온 그대로');
  type('np-label', '계약변경 검토');
  assert.equal(ready('np-save'), true, '고치면 녹색');
  while(closeTop());
});

test('반복 업무 [등록]: 공통 내용이 비면 흰색, 쓰면 녹색 · 등록 뒤 흰색', async () => {
  await fresh();
  openRecurModal(); await env.flush();
  assert.equal(ready('rc-save'), false);
  type('rc-memo', '주간 업무보고 취합');
  assert.equal(ready('rc-save'), true);
  click($('rc-dow').querySelector('[data-dow="1"]'));
  click($('rc-save')); await env.flush(6);
  assert.equal(S.items.filter(x=>x.recur).length, 1);
  assert.equal(ready('rc-save'), false, '등록 뒤 입력칸이 비어 흰색');
  type('rc-memo', '   ');
  assert.equal(ready('rc-save'), false, '빈칸만이면 흰색');
  while(closeTop());
});

test('확인 창의 기본 동작·알림창 [확인]은 녹색, 취소는 흰색', async () => {
  await fresh();
  delete env.window.__WMHH_TEST_DIALOGS__;              // 앱 표준 대화상자를 실제로 띄운다
  const p=appConfirm('이 업무를 삭제할까요?');
  await env.flush();
  assert.ok($('appDialog').classList.contains('on'));
  assert.equal(ready('dlg-ok'), true, 'Enter 로 눌리는 [확인]은 녹색');
  assert.equal(ready('dlg-cancel'), false, '[취소]는 흰색');
  click($('dlg-cancel')); assert.equal(await p, false);
  env.window.__WMHH_TEST_DIALOGS__ = true;
  assert.equal(ready('alarmOk'), true, '알림창은 [확인] 하나뿐인 창');
  for(const id of ['settingsClose','presetClose','recurClose','relClose','bookDone','pbs-cancel','pb-cancel'])
    assert.equal(ready(id), false, `${id}: 닫기·취소는 흰색`);
});

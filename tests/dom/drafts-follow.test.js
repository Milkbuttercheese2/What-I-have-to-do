/* 점검 라운드 3 — 임시저장분(양식에 쓰다 저장하지 않고 닫은 것)은 양식 밖에서 바뀐 업무를 따라간다.
   임시저장분은 양식 칸 전부의 사본이라, 메모 합치기·인물 바꾸기·카드에 파일 놓기·캘린더의 하위 업무 지우기가 그 업무를 바꾼 뒤
   양식을 열면 바뀌기 전 사본이 되살아나 [저장] 한 번에 그 변경을 되돌렸다. 합치기는 끌려온 업무가 이미 지워져 그 메모·관련인·
   하위 업무가 영영 사라졌다(가장 나쁜 경우). 문서 탭의 링크 고치기는 docs-v380.test.js 에서 본다. */
import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {setupEnv} from '../helpers/env.js';

mock.timers.enable({apis:['setTimeout','setInterval']});
const env = setupEnv();
const {S, newId} = await import('../../src/state.js');
const {initToast} = await import('../../src/dom-utils.js');
const {initRender, render} = await import('../../src/render.js');
const {initForm, openForm, closeForm} = await import('../../src/form.js');
const {initPhonebook, adoptPhonebook, openSwap, renderPhonebook} = await import('../../src/phonebook.js');
const {applyDrop} = await import('../../src/filedrop.js');
const {setPlaceMode} = await import('../../src/placement.js');
const {closeTop} = await import('../../src/modals.js');
initToast(); initRender(); initForm(); initPhonebook();

const $ = id => env.document.getElementById(id);
const doc = env.document;
const input = el => el.dispatchEvent(new env.window.Event('input', {bubbles:true}));
const click = el => el.dispatchEvent(new env.window.MouseEvent('click', {bubbles:true, cancelable:true}));
const mouse = (el, type, x, y) => el.dispatchEvent(new env.window.MouseEvent(type, {bubbles:true, cancelable:true, button:0, clientX:x, clientY:y}));
const cardOf = id => doc.querySelector(`#view-board .card[data-open="${id}"]:not(.drag-ghost)`);
const mk = o => Object.assign({id:newId(), memo:'업무', owner:'', done:false, doneAt:null, staged:false, f:{}, contacts:[], ids:[], subs:[], files:[], al:{}, recur:null, recurId:null}, o);
const draftOf = id => (S.settings.formDrafts||{})[String(id)];
async function fresh(){ await env.resetS(); S.loaded=true; S.doneDirty.clear(); while(closeTop()); setPlaceMode('time'); env.onInvoke('save_all', ()=>({kind:'Saved', version:1})); }
/* 양식을 열어 메모를 고치고 저장하지 않고 닫는다 = 임시저장분 */
async function leaveDraft(it, memo){
  openForm(it); await env.flush();
  $('fm-memo').value = memo; input($('fm-memo'));
  closeForm(); await env.flush();
  assert.ok(draftOf(it.id), '임시저장분이 생겼다');
}
function dragMerge(fromId, toId){ render(); const from=cardOf(fromId), to=cardOf(toId); mouse(from,'mousedown',10,10); mouse(to,'mousemove',40,40); mouse(to,'mouseup',40,40); }
/* 양식을 열어 보이는 메모를 읽고 [저장] — 사용자가 하는 그대로 */
async function openAndSave(id){
  openForm(S.items.find(x=>x.id===id)); await env.flush();
  const shown = $('fm-memo').value;
  click($('fm-save')); await env.flush();
  return shown;
}

test('메모 합치기: 받는 쪽에 임시저장분이 있어도 합친 내용이 양식에 보이고, [저장]해도 끌려온 업무의 내용이 남는다', async () => {
  await fresh();
  const A = mk({memo:'가 업무 메모', contacts:[{who:'김가', org:'가과', phone:'010-1', email:''}], subs:[{id:newId(), title:'가 하위', mid:'', done:false, al:{}, owner:''}]});
  const B = mk({memo:'나 업무 메모'});
  S.items.push(A, B);
  await leaveDraft(B, '나 업무 메모 + 저장 안 한 고침');
  dragMerge(A.id, B.id); await env.flush();
  assert.ok(!S.items.some(x=>x.id===A.id), '끌려온 업무는 지워졌다');
  const shown = await openAndSave(B.id);
  assert.match(shown, /저장 안 한 고침/, '쓰던 고침은 그대로');
  assert.match(shown, /가 업무 메모/, '끌려온 업무의 메모도 보인다');
  const after = S.items.find(x=>x.id===B.id);
  assert.match(after.memo, /가 업무 메모/, '[저장]해도 끌려온 메모가 남는다');
  assert.deepEqual(after.contacts.map(c=>c.who), ['김가'], '관련인도 남는다');
  assert.deepEqual(after.subs.map(s=>s.title), ['가 하위'], '하위 업무도 남는다');
});

test('메모 합치기: 끌려온 쪽의 임시저장분은 받는 쪽 임시저장분으로 옮겨진다(버려지지 않는다)', async () => {
  await fresh();
  const A = mk({memo:'가 저장본'}), B = mk({memo:'나 저장본'});
  S.items.push(A, B);
  await leaveDraft(A, '가 저장본 + 가에 쓰던 것');
  dragMerge(A.id, B.id); await env.flush();
  assert.equal(draftOf(A.id), undefined, '주인 없는 임시저장분은 남지 않는다');
  assert.match(draftOf(B.id).data.memo, /나 저장본[\s\S]*가에 쓰던 것/);
  const shown = await openAndSave(B.id);
  assert.match(shown, /가에 쓰던 것/);
});

test('메모 합치기 [실행 취소]: 두 업무와 두 임시저장분이 합치기 전으로', async () => {
  await fresh();
  const A = mk({memo:'가'}), B = mk({memo:'나'});
  S.items.push(A, B);
  await leaveDraft(A, '가 + 가 초안');
  await leaveDraft(B, '나 + 나 초안');
  const before = JSON.parse(JSON.stringify(S.settings.formDrafts));
  dragMerge(A.id, B.id); await env.flush();
  click($('toast-undo')); await env.flush();
  assert.deepEqual(S.items.map(x=>x.memo).sort(), ['가', '나']);
  assert.deepEqual(S.settings.formDrafts, before);
});

test('메모 합치기: 임시저장분이 없으면 설정을 건드리지 않는다', async () => {
  await fresh();
  const A = mk({memo:'가'}), B = mk({memo:'나'});
  S.items.push(A, B);
  env.invokeCalls.length = 0;
  dragMerge(A.id, B.id); await env.flush();
  assert.ok(!env.invokeCalls.some(c=>c.cmd==='save_settings'));
});

test('인물 바꾸기: 임시저장분의 관련인·@태그도 바뀐다 — [저장]해도 옛 사람이 되살아나지 않는다 · 실행 취소', async () => {
  await fresh();
  adoptPhonebook([{id:11, who:'김철수', org:'행정과', phone:'010-1111-1111'}, {id:12, who:'이영희', org:'세무과', phone:'010-2222-2222'}]);
  const A = {who:'김철수', org:'행정과', phone:'010-1111-1111', email:''};
  const a = mk({memo:'@김철수 회신', contacts:[A]});
  S.items.push(a);
  await leaveDraft(a, '@김철수 회신 — 내일 다시');
  renderPhonebook();
  openSwap(11);
  click($('pbsw-list').querySelector('[data-swapto="12"]'));
  click($('pbsw-go')); await env.flush();
  assert.equal(draftOf(a.id).data.memo, '@이영희 회신 — 내일 다시');
  assert.deepEqual(draftOf(a.id).data.contacts.map(c=>c.who), ['이영희']);
  click($('toast-undo')); await env.flush();
  assert.equal(draftOf(a.id).data.memo, '@김철수 회신 — 내일 다시', '실행 취소 = 임시저장분도 제자리로');
  /* 다시 바꾸고 양식을 열어 저장 — 옛 사람이 업무에도 전화번호부에도 돌아오지 않는다 */
  openSwap(11);
  click($('pbsw-list').querySelector('[data-swapto="12"]'));
  click($('pbsw-go')); await env.flush();
  await openAndSave(a.id);
  const it = S.items.find(x=>x.id===a.id);
  assert.deepEqual(it.contacts.map(c=>c.who), ['이영희']);
  assert.equal(it.memo, '@이영희 회신 — 내일 다시');
  assert.ok(!S.phonebook.some(e=>e.who==='김철수'), '지운 사람이 저장으로 다시 들어오지 않는다');
});

test('카드에 파일 놓기: 임시저장분에도 링크가 붙는다 — [저장]해도 방금 놓은 링크가 빠지지 않는다 · 실행 취소', async () => {
  await fresh();
  const a = mk({memo:'계약'});
  S.items.push(a);
  await leaveDraft(a, '계약 — 검토 중');
  applyDrop({kind:'card', id:a.id}, ['C:\\계약\\검토서.hwp']);
  assert.deepEqual(draftOf(a.id).data.files, ['C:\\계약\\검토서.hwp']);
  click($('toast-undo')); await env.flush();
  assert.deepEqual(draftOf(a.id).data.files, []);
  applyDrop({kind:'card', id:a.id}, ['C:\\계약\\검토서.hwp']);
  await openAndSave(a.id);
  assert.deepEqual(S.items.find(x=>x.id===a.id).files, ['C:\\계약\\검토서.hwp']);
});

test('캘린더의 하위 업무 지우기(×): 임시저장분에서도 빠진다 — [저장]해도 지운 줄이 되살아나지 않는다 · 실행 취소', async () => {
  await fresh();
  const cut = {id:newId(), title:'지울 점검', mid:'', done:false, al:{}, owner:''};
  const keep = {id:newId(), title:'남는 점검', mid:'', done:false, al:{}, owner:''};
  const a = mk({memo:'점검 업무', subs:[cut, keep]});
  S.items.push(a);
  await leaveDraft(a, '점검 업무 — 고침');
  const x = doc.createElement('span'); x.dataset.delsub = String(cut.id); x.dataset.item = String(a.id); doc.body.appendChild(x);
  click(x); await env.flush();
  assert.deepEqual(draftOf(a.id).data.subs.map(s=>s.title), ['남는 점검']);
  click($('toast-undo')); await env.flush();
  assert.deepEqual(draftOf(a.id).data.subs.map(s=>s.title), ['지울 점검', '남는 점검']);
  click(x); await env.flush();
  x.remove();
  await openAndSave(a.id);
  assert.deepEqual(S.items.find(y=>y.id===a.id).subs.map(s=>s.title), ['남는 점검']);
});

/* ── 점검 라운드 5(독립 검토 01 확정 2): [실행 취소]는 그 동작이 바꾼 것만 되돌린다 ─────────────────────────────
   실행 취소 알림이 떠 있는 6초 안에 그 업무 양식을 열어 더 쓰고 닫은 뒤 [실행 취소]를 누르면, 예전엔 임시저장분을 바꾸기 전
   사본으로 통째로 되돌려 그 사이 쓴 글이 사라졌다(파일 놓기·하위 업무 × 는 기준 2139ca3 에 없던 퇴행). */
test('파일 놓기 [실행 취소]: 그 뒤 양식에 더 쓰고 닫은 글은 남고, 놓은 링크만 빠진다', async () => {
  await fresh();
  const a = mk({memo:'계약', files:['C:\\계약\\원본.hwp']});
  S.items.push(a);
  await leaveDraft(a, '계약 — 검토 중');
  applyDrop({kind:'card', id:a.id}, ['C:\\계약\\검토서.hwp', 'C:\\계약\\원본.hwp']);   // 둘째는 이미 있던 링크 — 실행 취소가 빼면 안 된다
  await leaveDraft(a, '계약 — 검토 중 — 놓은 뒤 더 쓴 글');
  click($('toast-undo')); await env.flush();
  const d = draftOf(a.id);
  assert.equal(d?.data.memo, '계약 — 검토 중 — 놓은 뒤 더 쓴 글', '그 사이 쓴 글이 남는다');
  assert.deepEqual(d.data.files, ['C:\\계약\\원본.hwp'], '놓은 링크만 빠지고 원래 있던 링크는 남는다');
  assert.deepEqual(S.items.find(x=>x.id===a.id).files, ['C:\\계약\\원본.hwp'], '업무도 놓기 전으로');
});

test('하위 업무 × [실행 취소]: 그 뒤 양식에 더 쓰고 닫은 글은 남고, 지운 하위 업무만 제자리로 돌아온다', async () => {
  await fresh();
  const cut = {id:newId(), title:'지울 점검', mid:'', done:false, al:{}, owner:''};
  const keep = {id:newId(), title:'남는 점검', mid:'', done:false, al:{}, owner:''};
  const a = mk({memo:'점검 업무', subs:[cut, keep]});
  S.items.push(a);
  await leaveDraft(a, '점검 업무 — 고침');
  const x = doc.createElement('span'); x.dataset.delsub = String(cut.id); x.dataset.item = String(a.id); doc.body.appendChild(x);
  click(x); await env.flush(); x.remove();
  await leaveDraft(a, '점검 업무 — 고침 — 지운 뒤 더 쓴 글');
  click($('toast-undo')); await env.flush();
  const d = draftOf(a.id);
  assert.equal(d?.data.memo, '점검 업무 — 고침 — 지운 뒤 더 쓴 글', '그 사이 쓴 글이 남는다');
  assert.deepEqual(d.data.subs.map(s=>s.title), ['지울 점검', '남는 점검'], '지운 하위 업무만 제자리로');
  assert.deepEqual(S.items.find(y=>y.id===a.id).subs.map(s=>s.title), ['지울 점검', '남는 점검']);
});

test('메모 합치기 [실행 취소]: 그 뒤 받는 쪽 양식에 더 쓰고 닫은 글은 남는다(끌려온 쪽 임시저장분도 되살아난다)', async () => {
  await fresh();
  const A = mk({memo:'가'}), B = mk({memo:'나'});
  S.items.push(A, B);
  await leaveDraft(A, '가 + 가에 쓰던 초안');            // 끌려올 쪽에만 임시저장분
  dragMerge(A.id, B.id); await env.flush();
  assert.ok(draftOf(B.id), '받는 쪽에 합친 임시저장분');
  await leaveDraft(B, '나\n\n가 + 가에 쓰던 초안\n\n합친 뒤 받는 쪽에 새로 쓴 중요한 글');
  click($('toast-undo')); await env.flush();
  assert.deepEqual(S.items.map(x=>x.memo).sort(), ['가', '나'], '업무 둘은 합치기 전으로');
  assert.match(draftOf(B.id)?.data.memo || '', /합친 뒤 받는 쪽에 새로 쓴 중요한 글/, '그 사이 쓴 글이 남는다(합친 내용과 나눌 수 없어 그 임시저장분은 그대로 둔다)');
  assert.equal(draftOf(A.id)?.data.memo, '가 + 가에 쓰던 초안', '끌려온 쪽 임시저장분은 제자리로');
});

test('인물 바꾸기 [실행 취소]: 그 뒤 양식에 더 쓰고 닫은 글은 남는다', async () => {
  await fresh();
  adoptPhonebook([{id:11, who:'김철수', org:'행정과', phone:'010-1111-1111'}, {id:12, who:'이영희', org:'세무과', phone:'010-2222-2222'}]);
  const a = mk({memo:'@김철수 회신', contacts:[{who:'김철수', org:'행정과', phone:'010-1111-1111', email:''}]});
  S.items.push(a);
  await leaveDraft(a, '@김철수 회신 — 내일 다시');
  renderPhonebook();
  openSwap(11);
  click($('pbsw-list').querySelector('[data-swapto="12"]'));
  click($('pbsw-go')); await env.flush();
  await leaveDraft(a, '@이영희 회신 — 내일 다시 — 바꾼 뒤 더 쓴 글');
  click($('toast-undo')); await env.flush();
  assert.equal(draftOf(a.id)?.data.memo, '@이영희 회신 — 내일 다시 — 바꾼 뒤 더 쓴 글', '그 사이 쓴 글이 남는다');
  assert.deepEqual(S.items.find(x=>x.id===a.id).contacts.map(c=>c.who), ['김철수'], '업무는 바꾸기 전으로');
});

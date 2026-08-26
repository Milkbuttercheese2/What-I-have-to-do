/* 양식 패널 — 왕복 보존 · F2(마감 변경 시 알람 재무장) · F3(오입력 차단) */
import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {setupEnv} from '../helpers/env.js';

mock.timers.enable({apis:['setTimeout','setInterval']});
const env = setupEnv();
const {S, newId} = await import('../../src/state.js');
const {isoToDateStr, isoToTimeStr} = await import('../../src/datetime.js');
const {toInbox, captureMemo, openForm, closeForm, initForm} = await import('../../src/form.js');
initForm();

const $ = id => env.document.getElementById(id);
const iso = min => new Date(Date.now() + min*60e3).toISOString();
const input = el => el.dispatchEvent(new env.window.Event('input', {bubbles:true}));

/* dt 위젯은 HH:MM까지만 왕복하므로 실사용 mid/due는 항상 초가 0이다 —
   픽스처도 초를 0으로 맞춰야 무변경 저장에서 ISO가 동일하게 재조합된다 */
const isoMin = min => { const d = new Date(Date.now() + min*60e3); d.setSeconds(0,0); return d.toISOString(); };

function fullItem(){
  const due = isoMin(60*26), mid = isoMin(60*27);
  return {
    id: newId(), memo:'전화 문의 건', done:false, staged:false,
    f:{received: iso(-10), due},
    contacts:[{who:'김담당', org:'모부서', phone:'010-1111-2222', email:'kim@example.go.kr'}],   /* v3.5.0 이메일(선택)도 왕복 대상 */
    ids:[{kind:'SR번호', val:'SR-1'}, {kind:'자체번호', val:'X-9'}],   // 자체번호 = 기타(커스텀)
    subs:[{id:newId(), title:'회신', mid, done:false, al:{mid:true}}],
    al:{due:true},
  };
}

test('toInbox: staged 아이템 생성 + save_all + 입력창 클리어', async () => {
  await env.resetS(); S.loaded = true;
  $('inp').value = '  급한 메모  ';
  toInbox();
  await env.flush();
  assert.equal(S.items.length, 1);
  const it = S.items[0];
  assert.equal(it.memo, '급한 메모');
  assert.equal(it.staged, true);
  assert.ok(!isNaN(new Date(it.f.received)));
  assert.equal($('inp').value, '');
  assert.ok(env.invokeCalls.some(c=>c.cmd==='save_all'));
});

test('captureMemo: trim된 staged 아이템 생성 + save_all (toInbox·캡처 창 공용 코어)', async () => {
  await env.resetS(); S.loaded = true;
  assert.equal(captureMemo('  통화 메모  '), true);
  await env.flush();
  assert.equal(S.items.length, 1);
  assert.equal(S.items[0].memo, '통화 메모');
  assert.equal(S.items[0].staged, true);
  assert.deepEqual(S.items[0].al, {});
  assert.ok(!isNaN(new Date(S.items[0].f.received)));
  assert.ok(env.invokeCalls.some(c=>c.cmd==='save_all'));
});

test('captureMemo: 빈/공백 텍스트는 false — 아이템도 저장도 없음', async () => {
  await env.resetS(); S.loaded = true;
  assert.equal(captureMemo('   '), false);
  assert.equal(captureMemo(null), false);
  await env.flush();
  assert.equal(S.items.length, 0);
  assert.ok(!env.invokeCalls.some(c=>c.cmd==='save_all'));
});

test('openForm: 풀 아이템 렌더 — dt·관련인·식별번호(기타 포함)·세부 data-subid', async () => {
  await env.resetS(); S.loaded = true;
  const it = fullItem(); S.items.push(it);
  openForm(it);
  assert.ok($('formPanel').classList.contains('on'));
  assert.equal($('fm-memo').value, it.memo);
  // dt 필드
  const dueSpan = $('fm-grid').querySelector('[data-fkey="due"]');
  assert.equal(dueSpan.querySelector('.dt-date').value, isoToDateStr(it.f.due));
  assert.equal(dueSpan.querySelector('.dt-time').value, isoToTimeStr(it.f.due));
  // 관련인
  const crow = $('fm-contacts').querySelector('.contact-row');
  assert.equal(crow.querySelector('.c-who').value, '김담당');
  // 식별번호: 커스텀 kind는 '기타' 선택 + 직접입력 노출
  const idRows = $('fm-ids').querySelectorAll('.fid-row');
  assert.equal(idRows.length, 2);
  assert.equal(idRows[1].querySelector('.fid-kind').value, '기타');
  assert.equal(idRows[1].querySelector('.fid-etc').value, '자체번호');
  // 세부: data-subid 유지
  assert.equal($('fm-subs').querySelector('.fsub-row').dataset.subid, String(it.subs[0].id));
  closeForm();
});

test('무변경 저장 왕복: memo/contacts/ids/subs 보존 + sub al 보존', async () => {
  await env.resetS(); S.loaded = true;
  const it = fullItem(); S.items.push(it);
  const before = JSON.parse(JSON.stringify({memo:it.memo, contacts:it.contacts, ids:it.ids}));
  openForm(it);
  $('fm-save').click();
  await env.flush();
  assert.equal($('formPanel').classList.contains('on'), false);
  const after = S.items[0];
  assert.equal(after.memo, before.memo);
  assert.deepEqual(after.contacts, before.contacts);
  assert.deepEqual(after.ids, before.ids);
  assert.deepEqual(after.subs[0].al, {mid:true});   // mid 무변경 → al 보존
  assert.equal(after.al.due, true);                 // 마감 무변경 → 알람 확인상태 유지 (F2)
  assert.equal(after.staged, false);
});

test('F2: 마감 변경 시 al.due 삭제(알람 재무장)', async () => {
  await env.resetS(); S.loaded = true;
  const it = fullItem(); S.items.push(it);
  openForm(it);
  const dueSpan = $('fm-grid').querySelector('[data-fkey="due"]');
  const newDue = iso(60*50);
  dueSpan.querySelector('.dt-date').value = isoToDateStr(newDue);
  dueSpan.querySelector('.dt-time').value = isoToTimeStr(newDue);
  input(dueSpan.querySelector('.dt-date'));
  $('fm-save').click();
  await env.flush();
  assert.ok(!('due' in S.items[0].al));
});

test('세부 mid 변경 → 해당 sub의 al 리셋', async () => {
  await env.resetS(); S.loaded = true;
  const it = fullItem(); S.items.push(it);
  openForm(it);
  const subDt = $('fm-subs').querySelector('.fsub-dt');
  const newMid = iso(60*40);
  subDt.querySelector('.dt-date').value = isoToDateStr(newMid);
  subDt.querySelector('.dt-time').value = isoToTimeStr(newMid);
  $('fm-save').click();
  await env.flush();
  assert.deepEqual(S.items[0].subs[0].al, {});
});

test('신규 저장: 새 id로 push, al:{}', async () => {
  await env.resetS(); S.loaded = true;
  openForm({});
  $('fm-memo').value = '새 업무';
  $('fm-save').click();
  await env.flush();
  assert.equal(S.items.length, 1);
  assert.equal(S.items[0].memo, '새 업무');
  assert.equal(typeof S.items[0].id, 'number');
  assert.deepEqual(S.items[0].al, {});
});

test('F3: 오입력(시각만 입력)은 저장 차단 — alert + 패널 유지 + 상태 불변', async () => {
  await env.resetS(); S.loaded = true;
  openForm({});
  $('fm-memo').value = '오입력 테스트';
  const dueSpan = $('fm-grid').querySelector('[data-fkey="due"]');
  dueSpan.querySelector('.dt-time').value = '18:00';   // 날짜 없이 시각만 → null
  $('fm-save').click();
  await env.flush();
  assert.equal(env.alerts.length, 1);
  assert.match(env.alerts[0], /날짜·시각 입력이 올바르지 않습니다/);
  assert.ok($('formPanel').classList.contains('on'));
  assert.equal(S.items.length, 0);
  closeForm();
});

test('세부 제목에서 Enter → 마지막 행이면 새 행 추가', async () => {
  await env.resetS(); S.loaded = true;
  openForm({});
  const rows0 = $('fm-subs').querySelectorAll('.fsub-row').length;
  const title = $('fm-subs').querySelector('.fsub-title');
  title.dispatchEvent(new env.window.KeyboardEvent('keydown', {key:'Enter', bubbles:true}));
  assert.equal($('fm-subs').querySelectorAll('.fsub-row').length, rows0 + 1);
  closeForm();
});

test('연락처는 저장 시 표준 하이픈 표기로 — 인식 못 하는 표기는 원문 (v3.2.0, v2.5.1 개정)', async () => {
  await env.resetS(); S.loaded = true;
  openForm({});
  $('fm-memo').value = '전화 입력 건';
  const ph = $('fm-contacts').querySelector('.c-phone');
  ph.value = '01099998888';
  $('fm-save').click();
  await env.flush();
  assert.equal(S.items[0].contacts[0].phone, '010-9999-8888');   // 표준형으로
  // 내선 등 애매한 표기는 여전히 원문 유지 (보수적 파서 — 유실 없음)
  openForm({});
  $('fm-memo').value = '내선 건';
  $('fm-contacts').querySelector('.c-phone').value = '02-123-4567 내선302';
  $('fm-save').click();
  await env.flush();
  assert.equal(S.items[1].contacts[0].phone, '02-123-4567 내선302');
});

test('관련인 행에 드래그 핸들 존재 — DOM 순서가 저장 순서 (v2.5.3)', async () => {
  await env.resetS(); S.loaded = true;
  openForm({memo:'관련인 정렬', contacts:[{who:'김',org:'a과',phone:'1'},{who:'박',org:'b과',phone:'2'}]});
  const rows = $('fm-contacts').querySelectorAll('.contact-row');
  assert.equal(rows.length, 2);
  for(const r of rows) assert.ok(r.querySelector('.drag-handle'));
  $('fm-contacts').appendChild(rows[0]);        // 드래그 결과와 동일한 DOM 재배열
  $('fm-save').click();
  await env.flush();
  assert.deepEqual(S.items[0].contacts.map(c=>c.who), ['박','김']);
});

test('관련인: Enter로 다음 행 추가/이동, IME 조합 중은 무시 (v2.5.3)', async () => {
  await env.resetS(); S.loaded = true;
  openForm({});
  const rows0 = $('fm-contacts').querySelectorAll('.contact-row').length;   // 기본 1행
  const phone = $('fm-contacts').querySelector('.c-phone');
  phone.dispatchEvent(new env.window.KeyboardEvent('keydown', {key:'Enter', bubbles:true, cancelable:true}));
  assert.equal($('fm-contacts').querySelectorAll('.contact-row').length, rows0 + 1);   // 마지막 행 → 새 행
  const firstOrg = $('fm-contacts').querySelector('.c-org');
  firstOrg.dispatchEvent(new env.window.KeyboardEvent('keydown', {key:'Enter', bubbles:true, cancelable:true}));
  assert.equal($('fm-contacts').querySelectorAll('.contact-row').length, rows0 + 1);   // 중간 행 → 추가 없음(이동만)
  const ime = new env.window.KeyboardEvent('keydown', {key:'Enter', bubbles:true, cancelable:true});
  Object.defineProperty(ime, 'isComposing', {value:true});
  $('fm-contacts').querySelectorAll('.c-phone')[1].dispatchEvent(ime);
  assert.equal($('fm-contacts').querySelectorAll('.contact-row').length, rows0 + 1);   // IME 조합 중 무시
  closeForm();
});

test('식별번호 행에 드래그 핸들 존재 — 순서 변경 가능 (v2.5.1)', async () => {
  await env.resetS(); S.loaded = true;
  const it = fullItem(); S.items.push(it);
  openForm(it);
  const idRows = $('fm-ids').querySelectorAll('.fid-row');
  assert.equal(idRows.length, 2);
  for(const r of idRows) assert.ok(r.querySelector('.drag-handle'));
  // DOM 순서를 뒤집으면 collectForm(저장)도 그 순서를 따른다
  $('fm-ids').appendChild(idRows[0]);
  $('fm-save').click();
  await env.flush();
  assert.deepEqual(S.items[0].ids.map(x=>x.kind), ['자체번호','SR번호']);
  assert.deepEqual(S.items[0].ids.map(x=>x.val), ['X-9','SR-1']);
});

test('closeForm 후에는 편집 대상이 리셋됨 — 새 저장은 새 아이템', async () => {
  await env.resetS(); S.loaded = true;
  const it = fullItem(); S.items.push(it);
  openForm(it);            // 편집 모드 진입
  closeForm();             // editingId 리셋
  openForm({});            // 빈 양식
  $('fm-memo').value = '별개의 새 업무';
  $('fm-save').click();
  await env.flush();
  assert.equal(S.items.length, 2);
  assert.equal(S.items[0].memo, it.memo);   // 원본 무변경
});

/* ── 임시저장/되돌리기 (v2.5.22) ─────────────────────────────────────────── */
const draftOf = key => (S.settings.formDrafts||{})[String(key)];

test('임시저장: 입력 후 700ms → settings.formDrafts 에 저장, 항목 자체는 불변', async () => {
  await env.resetS(); S.loaded = true;
  const it = fullItem(); S.items.push(it);
  openForm(it);
  $('fm-memo').value = '통화 내용 추가 기록';
  input($('fm-memo'));
  assert.equal(draftOf(it.id), undefined);          // 아직 디바운스 중
  mock.timers.tick(700);
  await env.flush();
  assert.equal(draftOf(it.id).data.memo, '통화 내용 추가 기록');
  assert.equal(S.items[0].memo, '전화 문의 건');    // 최종 저장 전에는 항목 불변
  assert.ok(env.invokeCalls.some(c=>c.cmd==='save_settings'));
});

test('ESC/닫기: 임시저장이 즉시 플러시되고, 다시 열면 그 내용이 복원된다', async () => {
  await env.resetS(); S.loaded = true;
  const it = fullItem(); S.items.push(it);
  openForm(it);
  $('fm-memo').value = '쓰다 만 메모';
  input($('fm-memo'));
  closeForm();                                       // 디바운스 대기 없이 확정 플러시
  await env.flush();
  assert.equal(draftOf(it.id).data.memo, '쓰다 만 메모');
  openForm(it);
  assert.equal($('fm-memo').value, '쓰다 만 메모');  // 항목이 아니라 임시저장분이 뜬다
  assert.match($('fm-draft').textContent, /임시저장됨/);
  closeForm();
});

test('저장(Ctrl+S): 항목에 반영되고 임시저장분은 폐기된다', async () => {
  await env.resetS(); S.loaded = true;
  const it = fullItem(); S.items.push(it);
  openForm(it);
  $('fm-memo').value = '최종 확정 메모';
  input($('fm-memo'));
  mock.timers.tick(700);
  await env.flush();
  assert.ok(draftOf(it.id));
  $('fm-save').click();
  await env.flush();
  assert.equal(S.items[0].memo, '최종 확정 메모');
  assert.equal(draftOf(it.id), undefined);           // 최종 저장 = 초안 폐기
  openForm(S.items[0]);
  assert.equal($('fm-memo').value, '최종 확정 메모');
  assert.equal($('fm-draft').textContent, '');
  closeForm();
});

test('되돌리기: 마지막 저장본으로 복구 + 임시저장분 삭제 (항목은 원래대로)', async () => {
  await env.resetS(); S.loaded = true;
  const it = fullItem(); S.items.push(it);
  openForm(it);
  $('fm-memo').value = '잘못 쓴 내용';
  input($('fm-memo'));
  mock.timers.tick(700);
  await env.flush();
  assert.ok(draftOf(it.id));
  $('fm-revert').click();                            // confirm 은 기본 true
  await env.flush();
  assert.equal($('fm-memo').value, '전화 문의 건');  // 저장본으로 복구
  assert.equal(draftOf(it.id), undefined);
  assert.equal(S.items[0].memo, '전화 문의 건');
  assert.ok($('formPanel').classList.contains('on'));// 팝업은 열린 채로
  closeForm();
});

test('저장본과 같아지면 임시저장분은 스스로 지워진다', async () => {
  await env.resetS(); S.loaded = true;
  const it = fullItem(); S.items.push(it);
  openForm(it);
  $('fm-memo').value = '임시 변경';
  input($('fm-memo')); mock.timers.tick(700); await env.flush();
  assert.ok(draftOf(it.id));
  $('fm-memo').value = '전화 문의 건';               // 원래대로 되돌려 씀
  input($('fm-memo')); mock.timers.tick(700); await env.flush();
  assert.equal(draftOf(it.id), undefined);
  assert.equal($('fm-draft').textContent, '');
  closeForm();
});

test('삭제된 항목의 임시저장분은 정리된다 (설정 비대화 방지)', async () => {
  await env.resetS(); S.loaded = true;
  const it = fullItem(); S.items.push(it);
  S.settings.formDrafts = {'999999': {at: 1, data:{memo:'사라진 항목'}}};
  openForm(it);
  $('fm-memo').value = '살아있는 항목 메모';
  input($('fm-memo')); mock.timers.tick(700); await env.flush();
  assert.equal(draftOf(999999), undefined);
  assert.ok(draftOf(it.id));
  closeForm();
});

test('새 항목: 쓰다 닫아도 남고, 빈 양식을 다시 열면 이어서 쓴다', async () => {
  await env.resetS(); S.loaded = true;
  openForm({});
  $('fm-memo').value = '새로 받은 민원 정리';
  input($('fm-memo'));
  closeForm();
  await env.flush();
  assert.equal(draftOf('new').data.memo, '새로 받은 민원 정리');
  openForm({});
  assert.equal($('fm-memo').value, '새로 받은 민원 정리');
  $('fm-save').click();                              // 최종 저장 → 초안 폐기
  await env.flush();
  assert.equal(S.items.length, 1);
  assert.equal(draftOf('new'), undefined);
});

test('새 양식을 채워진 채로 열면(바로 입력·프리셋) 남은 초안과 어느 쪽을 쓸지 묻는다', async () => {
  await env.resetS(); S.loaded = true;
  openForm({});
  $('fm-memo').value = '남겨둔 초안';
  input($('fm-memo'));
  closeForm(); await env.flush();
  env.answerConfirm(false);                          // "새로 시작"
  await openForm({memo:'방금 입력한 내용'});          // v3.3.0: 확인 대화상자가 Promise 기반
  assert.equal($('fm-memo').value, '방금 입력한 내용');
  assert.equal(draftOf('new'), undefined);           // 선택에 따라 초안 폐기
  closeForm(); await env.flush();
});

test('다른 양식으로 갈아탈 때 이전 양식의 임시저장을 먼저 확정한다 (미니 창 → 양식 열기)', async () => {
  await env.resetS(); S.loaded = true;
  const it = fullItem(); S.items.push(it);
  openForm(it);
  $('fm-memo').value = '쓰다 만 채로 다른 양식이 열림';
  input($('fm-memo'));
  openForm({memo:'미니 창에서 넘어온 새 메모'});     // 디바운스 대기 없이 곧바로 전환
  await env.flush();
  assert.equal(draftOf(it.id).data.memo, '쓰다 만 채로 다른 양식이 열림');   // 잃지 않는다
  assert.equal($('fm-memo').value, '미니 창에서 넘어온 새 메모');
  closeForm();
});

test('임시저장 안전장치: 내용이 그대로면 설정을 다시 쓰지 않는다', async () => {
  await env.resetS(); S.loaded = true;
  const it = fullItem(); S.items.push(it);
  openForm(it);
  $('fm-memo').value = '한 번만 쓰이면 된다';
  input($('fm-memo')); mock.timers.tick(700); await env.flush();
  const writes = env.invokeCalls.filter(c=>c.cmd==='save_settings').length;
  input($('fm-memo')); mock.timers.tick(700); await env.flush();   // 같은 내용으로 다시 트리거
  assert.equal(env.invokeCalls.filter(c=>c.cmd==='save_settings').length, writes);
  closeForm();
});

test('임시저장 안전장치: 총량이 넘치면 오래된 초안부터 버리되 지금 쓰는 초안은 남긴다', async () => {
  await env.resetS(); S.loaded = true;
  const it = fullItem(); S.items.push(it);
  const big = 'ㅁ'.repeat(120000);
  S.items.push({...fullItem(), id: 9001}, {...fullItem(), id: 9002}, {...fullItem(), id: 9003});
  S.settings.formDrafts = {
    '9001': {at: 1, data:{memo:big}}, '9002': {at: 2, data:{memo:big}}, '9003': {at: 3, data:{memo:big}},
  };
  openForm(it);
  $('fm-memo').value = big;
  input($('fm-memo')); mock.timers.tick(700); await env.flush();
  assert.ok(draftOf(it.id), '지금 쓰는 초안은 남는다');
  assert.ok(JSON.stringify(S.settings.formDrafts).length <= 400000 + big.length, '총량이 상한 근처로 줄어든다');
  assert.equal(draftOf(9001), undefined, '가장 오래된 초안부터 버려진다');
  closeForm();
});

/* ── v3.6.0 완료 업무 읽기 전용 ─────────────────────────────────────────────
   저장은 완료 업무 행을 다시 쓰지 않는다(증분 저장). 그래서 완료 업무를 여기서
   고칠 수 있게 두면 그 변경이 저장에 실리지 않아 **조용히 사라진다** —
   읽기 전용은 UX 취향이 아니라 그 설계의 정확성 조건이다. */

test('완료 업무는 읽기 전용으로 열린다 (저장 버튼 없음 · 입력 잠김 · 초안 안 만듦)', async () => {
  await env.resetS(); S.loaded = true;
  const it = fullItem(); it.done = true; S.items.push(it);
  await openForm(it, {readonly:true});
  assert.ok($('formPanel').classList.contains('on'));
  assert.ok($('formPanel').classList.contains('fm-ro'), '읽기 전용 표시');
  assert.equal($('fm-memo').disabled, true, '내용을 고칠 수 없어야 한다');
  assert.equal($('fm-save').style.display, 'none', '저장 버튼은 감춘다');
  assert.equal($('fm-revert').style.display, 'none', '되돌리기도 감춘다(고칠 게 없으므로)');
  assert.match($('fm-place').textContent, /완료를 취소/, '고치는 방법을 알려준다');
  // 초안을 만들지 않는다 — 고칠 수 없는 화면의 초안은 되살아날 때 혼란만 만든다
  const drafts = (S.settings.formDrafts)||{};
  assert.equal(drafts[String(it.id)], undefined);
});

test('완료 업무의 세부 체크·드래그도 읽기 전용으로 잠긴다 (화면만 바뀌는 가짜 수정 방지)', async () => {
  await env.resetS(); S.loaded = true;
  const it = fullItem(); it.done = true; it.subs[0].done = false; S.items.push(it);
  await openForm(it, {readonly:true});
  const row = $('fm-subs').querySelector('.fsub-row');
  const chk = row.querySelector('.fsub-chk');
  const handle = row.querySelector('.drag-handle');
  assert.equal(chk.getAttribute('aria-disabled'), 'true');
  assert.equal(handle.getAttribute('aria-disabled'), 'true');
  chk.dispatchEvent(new env.window.MouseEvent('click', {bubbles:true}));
  assert.equal(row.dataset.done, '0', '읽기 전용에서는 세부 완료 상태도 바뀌지 않아야 한다');
  assert.equal(it.subs[0].done, false, '원본 데이터가 바뀌지 않아야 한다');
  closeForm();
});

test('미완료 업무는 예전처럼 편집 가능하게 열린다 (읽기 전용이 새는지 확인)', async () => {
  await env.resetS(); S.loaded = true;
  const it = fullItem(); S.items.push(it);
  await openForm(it);
  assert.equal($('formPanel').classList.contains('fm-ro'), false);
  assert.equal($('fm-memo').disabled, false);
  assert.notEqual($('fm-save').style.display, 'none');
  assert.notEqual($('fm-revert').style.display, 'none');
});

/* 되살리는 길은 **카드의 체크박스 하나**다(v3.6.1 소유자 지정 — 양식 안에 [되살려서 수정]을
   뒀다가 없앴다: 하는 일이 체크박스와 겹쳤다). 그 경로가 저장까지 이어지는지 확인한다. */
test('완료 취소(체크박스): 완료가 풀리고 그 변화가 저장에 실린다', async () => {
  const {toggleDone} = await import('../../src/state.js');
  const {STORE} = await import('../../src/store.js');
  await env.resetS(); S.loaded = true;
  const it = fullItem(); it.done = true; S.items.push(it);
  toggleDone(it);                      // 카드 체크박스가 하는 일
  await STORE.saveAll(S.items);
  await STORE._saving;
  await env.flush();
  assert.equal(it.done, false, '완료가 풀려야 한다');
  /* 저장 payload 로 확인한다 — 저장이 성공하면 doneDirty 는 비워지는 게 정상이므로
     (그게 계약이다) 표시가 남았는지를 보면 안 된다. 중요한 건 그 변화가 실려 나갔는가다. */
  const sent = env.invokeCalls.filter(c=>c.cmd==='save_all').pop();
  assert.ok(sent, '완료를 취소하면 저장된다');
  const row = sent.args.items.find(x=>x.id===it.id);
  assert.ok(row, '되살린 업무가 저장 목록에 실려야 한다');
  assert.equal(row.done, false);
  assert.equal(S.doneDirty.has(it.id), false, '저장 성공 후에는 표시가 비워진다');
});

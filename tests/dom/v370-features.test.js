/* v3.7.0 기능 회귀 — 업무 종료 · 다시 진행 · 파일 끌어다 놓기 · 인물 일괄 바꾸기 ·
   설정(보드 배치·자동 실행) · 2쪽 보기 · 한눈 요약 숫자.
   핵심 불변식: 완료 업무가 바뀌는 모든 경로는 S.doneDirty 에 표시돼야 저장에 실린다(v3.6.0 증분 저장). */
import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {setupEnv} from '../helpers/env.js';

mock.timers.enable({apis:['setTimeout','setInterval']});
const env = setupEnv();
const {S, newId} = await import('../../src/state.js');
const {openForm, closeForm, initForm, openBook} = await import('../../src/form.js');
const {initRender, render, renderDone, metricsOf} = await import('../../src/render.js');
const {initToast} = await import('../../src/dom-utils.js');
const {initPhonebook, adoptPhonebook, openSwap, renderPhonebook} = await import('../../src/phonebook.js');
const {mergePaths, dropTarget, applyDrop, handleDragDrop} = await import('../../src/filedrop.js');
const {initSettingsMenu, openSettings, closeSettings, syncAutostart} = await import('../../src/settings-menu.js');
const {placeMode, setPlaceMode} = await import('../../src/placement.js');
const {closeTop, isOpen} = await import('../../src/modals.js');
initToast(); initForm(); initRender(); initPhonebook(); initSettingsMenu();

const $ = id => env.document.getElementById(id);
const doc = env.document;
const click = el => el.dispatchEvent(new env.window.MouseEvent('click', {bubbles:true, cancelable:true}));
const saves = () => env.invokeCalls.filter(c=>c.cmd==='save_all');
const mk = o => Object.assign({id:newId(), memo:'업무', owner:'', done:false, doneAt:null, staged:false, f:{}, contacts:[], ids:[], subs:[], files:[], al:{}, recur:null, recurId:null}, o);
async function fresh(){ await env.resetS(); S.loaded=true; S.doneDirty.clear(); while(closeTop()); setPlaceMode('time'); }

/* ── 업무 종료 / 다시 진행 ───────────────────────────────────────────── */
test('업무 종료: 연 양식의 변경을 저장하면서 완료 처리 + 저장에 실린다 + [실행 취소]로 되돌린다', async () => {
  await fresh();
  const it = mk({memo:'원래'}); S.items.push(it);
  await openForm(it);
  $('fm-memo').value = '고친 내용';
  click($('fm-finish'));
  await env.flush();
  const cur = S.items.find(x=>x.id===it.id);
  assert.equal(cur.memo, '고친 내용', '편집 내용도 함께 저장된다');
  assert.equal(cur.done, true);
  assert.ok(cur.doneAt > 0);
  assert.ok(!isOpen('formPanel'), '양식은 닫힌다');
  const last = saves().at(-1).args;
  assert.ok(last.items.some(x=>x.id===it.id && x.done), '완료로 바뀐 업무가 이번 저장에 실린다(doneDirty)');
  click($('toast-undo')); await env.flush();
  assert.equal(S.items.find(x=>x.id===it.id).done, false, '실행 취소 = 진행 중으로');
});

test('업무 종료: 새 양식에서 누르면 완료된 업무로 바로 기록된다', async () => {
  await fresh();
  await openForm({});
  $('fm-memo').value = '이미 처리한 통화';
  click($('fm-finish'));
  await env.flush();
  assert.equal(S.items.length, 1);
  assert.equal(S.items[0].done, true);
  assert.equal(S.items[0].memo, '이미 처리한 통화');
});

test('업무 종료: 날짜 오입력이면 저장도 완료도 하지 않는다 (F3)', async () => {
  await fresh();
  const it = mk({}); S.items.push(it);
  await openForm(it);
  const d = $('fm-grid').querySelector('.dt-date'); d.value = '2026/13/45';
  click($('fm-finish'));
  await env.flush();
  assert.equal(S.items.find(x=>x.id===it.id).done, false);
  assert.ok(isOpen('formPanel'));
  closeForm();
});

test('다시 진행: 검색으로 연 완료 업무(읽기 전용)를 진행 중으로 되돌리고 편집 가능하게 다시 연다', async () => {
  await fresh();
  const it = mk({memo:'끝난 일', done:true, doneAt:Date.now()}); S.items.push(it);
  await openForm(it, {readonly:true});
  assert.ok($('formPanel').classList.contains('fm-ro'));
  click($('fm-reopen'));
  await env.flush();
  assert.equal(S.items.find(x=>x.id===it.id).done, false);
  assert.ok(isOpen('formPanel'), '양식이 열린 채로');
  assert.ok(!$('formPanel').classList.contains('fm-ro'), '이제 편집 가능');
  assert.equal($('fm-memo').disabled, false);
  assert.equal($('fm-finish').style.display, '', '[업무 종료]가 다시 보인다');
  assert.ok(saves().at(-1).args.items.some(x=>x.id===it.id && !x.done), '되살림이 저장에 실린다');
  /* 실행 취소 — 양식을 닫고 다시 완료로 */
  click($('toast-undo')); await env.flush();
  assert.equal(S.items.find(x=>x.id===it.id).done, true);
  assert.ok(!isOpen('formPanel'));
});

/* ── 파일·폴더 끌어다 놓기 ────────────────────────────────────────────── */
test('mergePaths: 대소문자·구분자·끝 슬래시가 달라도 같은 경로는 한 번만', () => {
  const r = mergePaths(['C:\\Docs\\a.hwp'], ['c:/docs/A.HWP', 'C:\\Docs\\b.xlsx', '', 'D:\\폴더\\', 'D:\\폴더']);
  assert.deepEqual(r.files, ['C:\\Docs\\a.hwp', 'C:\\Docs\\b.xlsx', 'D:\\폴더\\']);
  assert.equal(r.added, 2);
});

test('카드 위에 놓으면 그 업무에 링크가 붙고 저장된다 · 실행 취소', async () => {
  await fresh();
  const it = mk({memo:'계약변경', staged:true}); S.items.push(it); render();
  const card = doc.querySelector(`#view-board .card[data-open="${it.id}"]`);
  const t = dropTarget(card);
  assert.deepEqual(t, {kind:'card', id:it.id});
  applyDrop(t, ['C:\\계약\\검토서.hwp', 'C:\\계약']);
  await env.flush();
  assert.deepEqual(S.items[0].files, ['C:\\계약\\검토서.hwp', 'C:\\계약']);
  assert.ok(saves().length >= 1);
  click($('toast-undo')); await env.flush();
  assert.deepEqual(S.items[0].files, []);
});

test('완료 업무 카드·읽기 전용 양식에는 붙이지 않는다 (증분 저장 보호)', async () => {
  await fresh();
  const it = mk({memo:'끝', done:true}); S.items.push(it); render(); renderDone();
  const card = doc.querySelector(`#col-done .card[data-open="${it.id}"]`);
  assert.equal(dropTarget(card).kind, 'blocked');
  assert.equal(applyDrop(dropTarget(card), ['C:\\a.txt']), false);
  assert.deepEqual(S.items[0].files, []);
  await openForm(it, {readonly:true});
  assert.equal(dropTarget(doc.body).kind, 'blocked');
  closeForm();
});

test('양식이 열려 있으면 링크 칸에 행으로 추가(저장 전엔 업무 불변) · 빈 곳이면 새 양식', async () => {
  await fresh();
  const it = mk({files:['C:\\a.txt']}); S.items.push(it);
  await openForm(it);
  assert.equal(dropTarget(doc.body).kind, 'form');
  applyDrop({kind:'form'}, ['C:\\a.txt', 'C:\\b.txt']);
  assert.equal($('fm-files').querySelectorAll('.ffile-row').length, 2, '중복은 건너뛴다');
  assert.deepEqual(S.items[0].files, ['C:\\a.txt'], '저장 전에는 업무를 건드리지 않는다');
  click($('fm-save')); await env.flush();
  assert.deepEqual(S.items[0].files, ['C:\\a.txt', 'C:\\b.txt']);
  /* 빈 곳 → 새 양식 */
  assert.equal(dropTarget(doc.body).kind, 'new');
  applyDrop({kind:'new'}, ['C:\\새\\문서.pdf']);
  await env.flush();
  assert.ok(isOpen('formPanel'));
  assert.equal($('fm-files').querySelector('.ffile-path').value, 'C:\\새\\문서.pdf');
  closeForm();
});

test('다른 팝업이 떠 있으면 놓아도 아무 일 없다 · Tauri 이벤트(drop) 경로', async () => {
  await fresh();
  openSettings();
  assert.equal(dropTarget(doc.body).kind, 'blocked');
  closeSettings();
  /* jsdom 엔 elementFromPoint 가 없다 → 대상은 '빈 곳'(새 양식) */
  handleDragDrop({type:'drop', paths:['C:\\x.txt'], position:{x:10,y:10}});
  await env.flush();
  assert.ok(isOpen('formPanel'));
  closeForm();
  handleDragDrop({type:'leave'});
  assert.ok(!$('dropVeil').classList.contains('on'));
});

/* ── 인물 일괄 바꾸기 ─────────────────────────────────────────────────── */
test('인물 바꾸기: 관련인·@태그가 B 로, 완료 업무도 저장에 실리고, A 는 삭제된다 · 실행 취소', async () => {
  await fresh();
  adoptPhonebook([{id:11, who:'김철수', org:'행정과', phone:'010-1111-1111'}, {id:12, who:'이영희', org:'세무과', phone:'010-2222-2222', email:'lee@x.kr'}]);
  const A = {who:'김철수', org:'행정과', phone:'010-1111-1111', email:''};
  const a = mk({memo:'@김철수 회신', contacts:[A]});
  const b = mk({memo:'완료 @김철수', contacts:[A], done:true, doneAt:Date.now()});
  const c = mk({memo:'@김철수 동명이인', contacts:[{who:'김철수', org:'다른과', phone:'010-9'}]});
  S.items.push(a, b, c);
  renderPhonebook();
  openSwap(11);
  assert.ok(isOpen('pbSwapModal'));
  click($('pbsw-list').querySelector('[data-swapto="12"]'));
  assert.match($('pbsw-sum').textContent, /업무 2건\(완료 1건 포함\)/);
  click($('pbsw-go'));
  await env.flush();
  const A2 = S.items.find(x=>x.id===a.id), B2 = S.items.find(x=>x.id===b.id), C2 = S.items.find(x=>x.id===c.id);
  assert.equal(A2.memo, '@이영희 회신');
  assert.deepEqual(A2.contacts, [{who:'이영희', org:'세무과', phone:'010-2222-2222', email:'lee@x.kr'}]);
  assert.equal(B2.memo, '완료 @이영희');
  assert.equal(C2.memo, '@김철수 동명이인', '엮이지 않은 동명이인 업무는 건드리지 않는다');
  assert.ok(saves().at(-1).args.items.some(x=>x.id===b.id && x.memo==='완료 @이영희'), '완료 업무의 변경도 저장에 실린다');
  assert.deepEqual(S.phonebook.map(e=>e.id), [12], 'A 는 전화번호부에서 지워진다');
  assert.ok(!isOpen('pbSwapModal'));
  click($('toast-undo')); await env.flush();
  assert.equal(S.items.find(x=>x.id===a.id).memo, '@김철수 회신');
  assert.equal(S.items.find(x=>x.id===b.id).memo, '완료 @김철수');
  assert.ok(saves().at(-1).args.items.some(x=>x.id===b.id && x.memo==='완료 @김철수'), '되돌린 완료 업무도 저장에 실린다');
  assert.deepEqual(S.phonebook.map(e=>e.id).sort(), [11,12]);
});

test('인물 바꾸기: B 를 고르기 전엔 [바꾸기]가 잠겨 있고, ESC 로 닫힌다', async () => {
  await fresh();
  adoptPhonebook([{id:11, who:'김철수', org:'행정과', phone:'010-1'}, {id:12, who:'이영희', org:'세무과', phone:'010-2'}]);
  openSwap(11);
  assert.equal($('pbsw-go').disabled, true);
  assert.equal($('pbsw-list').querySelectorAll('[data-swapto]').length, 1, '자기 자신은 후보에 없다');
  closeTop();
  assert.ok(!isOpen('pbSwapModal'));
});

/* ── 설정: 보드 배치 · 자동 실행 ──────────────────────────────────────── */
test('보드 배치: 기본은 담당자·시간, 고르면 즉시 배치가 바뀌고 저장된다', async () => {
  await fresh();
  delete S.settings.boardMode;
  openSettings();
  assert.ok($('segBoardMode').querySelector('[data-v="owner"]').classList.contains('on'), '설정이 없으면 담당자·시간');
  click($('segBoardMode').querySelector('[data-v="time"]'));
  assert.equal(S.settings.boardMode, 'time');
  assert.equal(placeMode(), 'time');
  click($('segBoardMode').querySelector('[data-v="owner"]'));
  assert.equal(placeMode(), 'owner');
  assert.ok(env.invokeCalls.some(c=>c.cmd==='save_settings'));
  closeSettings();
});

test('자동 실행: 토글하면 set_autostart 가 그 값으로 불리고, 끄면 "자동 실행되면" 줄이 잠긴다', async () => {
  await fresh();
  openSettings();
  click($('segAutostart').querySelector('[data-v="off"]'));
  await env.flush();
  assert.equal(S.settings.autostart, false);
  assert.deepEqual(env.invokeCalls.filter(c=>c.cmd==='set_autostart').at(-1).args, {enabled:false});
  [...$('segAutostartWin').querySelectorAll('.seg-btn')].forEach(b=>assert.equal(b.disabled, true));
  click($('segAutostart').querySelector('[data-v="on"]'));
  await env.flush();
  assert.deepEqual(env.invokeCalls.filter(c=>c.cmd==='set_autostart').at(-1).args, {enabled:true});
  click($('segAutostartWin').querySelector('[data-v="tray"]'));
  assert.equal(S.settings.autostartMinimized, true);
  closeSettings();
});

test('syncAutostart: 설정이 없으면(업데이트 직후) 켬으로 등록한다', async () => {
  await fresh();
  delete S.settings.autostart;
  await syncAutostart(true);
  assert.deepEqual(env.invokeCalls.filter(c=>c.cmd==='set_autostart').at(-1).args, {enabled:true});
});

/* ── 2쪽 보기 · 요약 숫자 ─────────────────────────────────────────────── */
test('2쪽 보기: 메모를 읽기 전용 팝업으로 펼치고 ESC 로 닫는다', async () => {
  await fresh();
  openBook('첫 줄 제목\n둘째 줄');
  assert.ok(isOpen('bookModal'));
  assert.equal($('book-title').textContent, '첫 줄 제목');
  assert.equal($('book-text').textContent, '첫 줄 제목\n둘째 줄');
  closeTop();
  assert.ok(!isOpen('bookModal'));
});

test('metricsOf: 오늘 할 일(오늘·지난 미완료) · 오늘 완료(오늘 끝냈거나 오늘 일정인 완료) — 주기 부모 제외', () => {
  const now = new Date(); now.setHours(12,0,0,0); const T = now.getTime();
  const at = h => new Date(T + h*3600e3).toISOString();
  const items = [
    mk({f:{due:at(-30)}}),                                    // 어제 마감, 아직 안 끝남 → 오늘 할 일
    mk({f:{due:at(3)}}),                                      // 오늘 마감 → 오늘 할 일
    mk({subs:[{id:1, title:'s', mid:at(48), done:false}]}),   // 모레 — 세지 않음
    mk({}),                                                   // 시각 없음 — 세지 않음
    mk({done:true, doneAt:T-3600e3}),                         // 오늘 완료 처리 → 오늘 완료
    mk({done:true, doneAt:T-86400e3*3, f:{due:at(2)}}),       // 사흘 전 끝냈지만 일정이 오늘 → 오늘 완료
    mk({done:true, doneAt:T-86400e3*3, f:{due:at(-72)}}),     // 지난 완료 — 세지 않음
    mk({recur:{type:'dow'}, f:{due:at(1)}}),                  // 주기 부모 — 제외
  ];
  assert.deepEqual(metricsOf(items, T), {active:4, todo:2, doneToday:2, overdue:1});
});

/* ── 완료 묶음 · 캘린더 상세 · 전화번호부 묶음 · 연결된 업무 ───────────── */
test('doneGroupOf: 오늘/어제/이번 주/지난주/월별/날짜 모름', async () => {
  const {doneGroupOf} = await import('../../src/render.js');
  const now = new Date(2026, 10, 12, 15, 0).getTime();          // 2026-11-12 (목)
  const at = (m,d,h=10) => new Date(2026, m, d, h, 0).getTime();
  assert.equal(doneGroupOf(at(10,12), now).key, 'today');
  assert.equal(doneGroupOf(at(10,11), now).key, 'yday');
  assert.equal(doneGroupOf(at(10,9), now).key, 'week');           // 월요일
  assert.equal(doneGroupOf(at(10,8), now).key, 'lweek');          // 지난 일요일
  assert.equal(doneGroupOf(at(10,2), now).key, 'lweek');          // 지난주 월요일
  assert.equal(doneGroupOf(at(10,1), now).label, '2026년 11월');
  assert.equal(doneGroupOf(null, now).key, 'nodate');
});

test('완료 탭: 묶음 머리와 카드가 그려지고, 카드를 누르면 읽기 전용 양식이 열린다', async () => {
  await fresh();
  S.items.push(mk({memo:'오늘 끝', done:true, doneAt:Date.now()}), mk({memo:'옛날 끝', done:true, doneAt:Date.now()-86400e3*60}));
  render(); renderDone();
  const heads=[...doc.querySelectorAll('#col-done .dg-label')].map(x=>x.textContent);
  assert.equal(heads[0], '오늘');
  assert.equal(heads.length, 2);
  click(doc.querySelector('#col-done .card .card-memo'));
  assert.ok(isOpen('formPanel'));
  assert.ok($('formPanel').classList.contains('fm-ro'));
  closeForm();
});

test('캘린더: 처음부터 오늘 상세가 보이고, 날짜를 누르면 그날로 바뀐다', async () => {
  await fresh();
  const {initCalendar, renderCal} = await import('../../src/calendar.js');
  const t = new Date(); t.setHours(15,0,0,0);
  S.items.push(mk({memo:'오늘 마감 건', f:{due:t.toISOString()}}));
  renderCal();
  assert.ok($('cal-detail').classList.contains('on'));
  assert.ok($('cal-detail-cards').textContent.includes('오늘 마감 건'));
  assert.match($('cal-detail-title').textContent, /1건/);
  /* 시간표: 15:00 마감 → 가로선이 15×44px 높이에, 이름표는 누르면 그 업무가 열린다 */
  const line = doc.querySelector('#cal-detail-cards .tl-line.tl-due');
  assert.equal(line.style.top, `${15*44}px`);
  const chip = doc.querySelector('#cal-detail-cards .tl-chip');
  assert.match(chip.textContent, /15:00마감오늘 마감 건/);
  click(chip);
  assert.ok(isOpen('formPanel'));
  closeForm();
});

test('layoutTimeline: 같은 시각대 이름표는 겹치지 않게 아래로 밀리고 선은 제자리', async () => {
  const {layoutTimeline, HOUR_PX} = await import('../../src/calendar.js');
  const d = h => { const x=new Date(2026,10,7); x.setHours(Math.floor(h), Math.round((h%1)*60),0,0); return x.toISOString(); };
  const rows = layoutTimeline([{iso:d(9)},{iso:d(9)},{iso:d(9.25)},{iso:d(14)}]);
  assert.deepEqual(rows.map(r=>r.line), [9*HOUR_PX, 9*HOUR_PX, 9.25*HOUR_PX, 14*HOUR_PX]);
  for(let i=1;i<rows.length;i++) assert.ok(rows[i].chip >= rows[i-1].chip+26, '이름표가 겹치지 않는다');
  assert.equal(rows[3].chip, 14*HOUR_PX-13, '멀리 떨어진 건 제 시각 그대로');
});

test('전화번호부: 소속별 묶음 머리가 생기고 행에 머리글자가 붙는다', async () => {
  await fresh();
  adoptPhonebook([{id:1, who:'가나다', org:'가과', phone:'010-1'}, {id:2, who:'라마바', org:'가과', phone:'010-2'}, {id:3, who:'사아자', org:'나과', phone:'010-3'}]);
  renderPhonebook();
  const g=[...doc.querySelectorAll('#pb-list .pb-ghead span:first-child')].map(x=>x.textContent);
  assert.deepEqual(g, ['가과','나과']);
  assert.equal(doc.querySelector('#pb-list .pb-avatar').textContent, '가');
});

test('linkedItems: 관련인(3칸)·식별정보·주기로 엮고, 동명이인·자기 자신·주기 부모는 뺀다', async () => {
  const {linkedItems} = await import('../../src/links.js');
  const P = {who:'김철수', org:'행정과', phone:'010-1111-1111'};
  const me = mk({id:1, contacts:[P], ids:[{kind:'계약번호', val:'2026-01'}], recurId:77});
  const items = [me,
    mk({id:2, contacts:[{...P, phone:'01011111111'}]}),                     // 같은 사람(숫자만 비교)
    mk({id:3, ids:[{kind:'계약번호', val:'2026 - 01'.replace(/ /g,'')}]}),  // 같은 식별정보
    mk({id:4, recurId:77, done:true, doneAt:1}),                             // 같은 주기
    mk({id:5, contacts:[{who:'김철수', org:'다른과', phone:'010-9'}]}),      // 동명이인 — 제외
    mk({id:6, recur:{type:'dow'}, contacts:[P]}),                            // 주기 부모 — 제외
  ];
  const r = linkedItems(items, me);
  assert.deepEqual(r.map(x=>x.it.id), [3,2,4]);                              // 미완료 먼저, 그 안에서 최근 것 먼저
  assert.deepEqual(r[0].why, ['계약번호 2026-01']);
  assert.deepEqual(r[1].why, ['관련인 김철수']);
  assert.deepEqual(r[2].why, ['같은 주기 업무']);
});

test('관계도 탭(근거지도식): 칩·연결 목록·사슬·살피기 칸 · 노드 클릭=가운데 이동 · ◀ · [열기] · 전체 지도 · 칩으로 종류 끄기', async () => {
  await fresh();
  const {initGraphView, renderGraphView, showGraphFor} = await import('../../src/graph-view.js');
  initGraphView();
  const P = {who:'김철수', org:'행정과', phone:'010-1111-1111', email:''};
  const a = mk({memo:'지금 업무', contacts:[P], ids:[{kind:'계약번호', val:'K-1'}]});
  const b = mk({memo:'예전 업무', contacts:[P], done:true, doneAt:Date.now()-1e6});
  const c = mk({memo:'같은 계약', ids:[{kind:'계약번호', val:'K-1'}]});
  const lone = mk({memo:'외톨이'});
  S.items.push(a, b, c, lone);
  renderGraphView();
  const rows=[...doc.querySelectorAll('#gr-table .gr-tr[data-gsel]')].map(r=>r.textContent);
  assert.equal(rows.length, 3, '엮인 업무가 있는 것만 연결 목록에');
  assert.ok(!rows.some(t=>t.includes('외톨이')));
  assert.match($('gr-chips').textContent, /관련인 1/);
  assert.match($('gr-chips').textContent, /식별정보 1/);
  assert.ok($('gr-panel').querySelector('.gr-intro'), '고르기 전엔 안내 + 예시');
  showGraphFor(a.id);
  assert.match($('gr-panel').textContent, /지금 업무/);
  assert.match($('gr-panel').textContent, /고리 2개 · 엮인 업무 2건/);
  assert.ok($('gr-panel').querySelector('svg.link-graph'));
  assert.equal($('gr-panel').querySelectorAll('.g-hub').length, 2, '관련인 고리 + 식별정보 고리');
  assert.equal($('gr-insp').querySelectorAll('.gi-sec').length, 2, '살피기 칸: 고리별 묶음');
  click($('gr-panel').querySelector(`.g-task[data-gcenter="${b.id}"]`));
  assert.match($('gr-panel').querySelector('.gr-title').textContent, /예전 업무/, '노드를 누르면 그 업무가 가운데로');
  assert.ok(!isOpen('formPanel'), '노드 클릭은 양식을 열지 않는다');
  click($('gr-back'));
  assert.match($('gr-panel').querySelector('.gr-title').textContent, /지금 업무/, '◀ 로 되돌아간다');
  /* 칩으로 식별정보 끄기 → 사슬에서 식별정보 고리가 빠진다 */
  click($('gr-chips').querySelector('[data-gkind="id"]'));
  assert.equal($('gr-panel').querySelectorAll('.g-hub').length, 1);
  click($('gr-chips').querySelector('[data-gkind="id"]'));
  /* 전체 지도 — 업무 3, 고른 업무 강조 */
  click($('gr-mode').querySelector('[data-v="all"]'));
  assert.equal($('gr-panel').querySelectorAll('.g-task').length, 3);
  assert.ok($('gr-panel').querySelector(`.g-task.g-sel[data-gcenter="${a.id}"]`));
  click($('gr-mode').querySelector('[data-v="chain"]'));
  /* [열기] → 양식, 양식의 [관계도] → 다시 이 탭 */
  click($('gr-insp').querySelector('.gr-open'));
  await env.flush();
  assert.ok(isOpen('formPanel'));
  assert.equal($('fm-memo').value, '지금 업무');
  assert.notEqual($('fm-graph').style.display, 'none', '양식의 [관계도] 단추가 보인다');
  click($('fm-graph'));
  assert.ok(!isOpen('formPanel'));
  /* 선택 해제 */
  click($('gr-clear'));
  assert.ok($('gr-panel').querySelector('.gr-intro'));
  assert.equal($('gr-insp').innerHTML, '');
  await openForm(lone);
  assert.equal($('fm-graph').style.display, 'none', '엮인 게 없으면 단추가 없다');
  closeForm();
});

test('설정의 알림 켬/끔: alarmOn 저장 + 끌 때 뒷정리 + 헤더엔 알람 버튼이 없다', async () => {
  await fresh();
  assert.equal($('alarmToggle'), null, '헤더 알람 버튼은 설정으로 옮겨졌다');
  S.settings.alarmOn = true;
  openSettings();
  assert.ok($('segAlarm').querySelector('[data-v="on"]').classList.contains('on'));
  click($('segAlarm').querySelector('[data-v="off"]'));
  assert.equal(S.settings.alarmOn, false);
  assert.ok(env.invokeCalls.some(c=>c.cmd==='save_settings'));
  assert.match($('toast-msg').textContent, /껐습니다/);
  click($('segAlarm').querySelector('[data-v="on"]'));
  assert.equal(S.settings.alarmOn, true);
  closeSettings();
});

test('graphLayout: 3단 배치 — 업무는 오른쪽 열에 겹치지 않게, 고리는 가운데 열에 최소 간격, 같은 고리 업무끼리 모인다', async () => {
  const {graphLayout, GRAPH} = await import('../../src/links.js');
  const mkL = (id, keys, done=false) => ({it:{id, memo:'업무'+id, done}, via:keys.map(k=>({kind:k.startsWith('i')?'id':'person', key:k, label:k}))});
  const g = graphLayout([mkL(1,['pa']), mkL(2,['ib']), mkL(3,['pa'],true), mkL(4,['pa','ib']), mkL(5,['ib'])]);
  assert.equal(g.hubs.length, 2);
  assert.deepEqual(g.hubs.map(h=>h.kind), ['person','id'], '관련인 고리가 위');
  g.tasks.forEach(t=>assert.equal(t.x, GRAPH.colT));
  g.hubs.forEach(h=>assert.equal(h.x, GRAPH.colH));
  for(let i=1;i<g.tasks.length;i++) assert.ok(g.tasks[i].y-g.tasks[i-1].y >= GRAPH.rowT-1e-6);
  for(let i=1;i<g.hubs.length;i++) assert.ok(g.hubs[i].y-g.hubs[i-1].y >= GRAPH.rowH-1e-6);
  assert.deepEqual(g.tasks.map(t=>t.id), [1,4,3,2,5], '첫 고리 순 · 그 안에서 미완료 먼저');
  g.hubs.concat(g.tasks).forEach(n=>assert.ok(n.y>=g.top+13 && n.y<=g.H-13, '모든 노드가 열 머리 아래·그림 안'));
  assert.equal(g.center.y, g.top+(g.H-g.top)/2);
  const many = graphLayout(Array.from({length:24},(_,i)=>mkL(i+1,['p'+(i%7)])));
  many.hubs.concat(many.tasks).forEach(n=>assert.ok(n.y>=many.top+13 && n.y<=many.H-13));
});

test('linkCounts: 색인으로 센 수 = linkedItems 길이 (무작위 300건)', async () => {
  const {linkCounts, linkedItems} = await import('../../src/links.js');
  let seed=7; const rnd=n=>{ seed=(seed*1103515245+12345)%2147483648; return seed%n; };
  const people=Array.from({length:12},(_,i)=>({who:'사람'+i, org:'과'+(i%4), phone:'010-'+(1000+i)}));
  const items=Array.from({length:300},(_,i)=>mk({id:i+1,
    contacts: rnd(3)? [people[rnd(12)]] : [],
    ids: rnd(4)===0 ? [{kind:'계약번호', val:'K-'+rnd(20)}] : [],
    recurId: rnd(10)===0 ? 900+rnd(3) : null, recur: i===5 ? {type:'dow'} : null}));
  const cnt=linkCounts(items);
  for(const it of items){ if(it.recur) continue; assert.equal(cnt.get(it.id)||0, linkedItems(items, it, 1e9).length, 'id '+it.id); }
  const t0=Date.now(); const big=Array.from({length:3000},(_,i)=>mk({id:i+1, contacts:[people[i%12]]})); linkCounts(big);
  assert.ok(Date.now()-t0 < 1500, '3천 건도 빠르게');
});

test('linkIndex: 업무별 고리 = linkedItems 의 via 합집합, 고리마다 2건 이상', async () => {
  const {linkIndex, linkedItems} = await import('../../src/links.js');
  let seed=11; const rnd=n=>{ seed=(seed*1103515245+12345)%2147483648; return seed%n; };
  const people=Array.from({length:8},(_,i)=>({who:'사람'+i, org:'과', phone:'010-'+(2000+i)}));
  const items=Array.from({length:150},(_,i)=>mk({id:i+1, contacts: rnd(2)?[people[rnd(8)]]:[], ids: rnd(5)===0?[{kind:'계약번호', val:'K'+rnd(9)}]:[], recurId: rnd(9)===0?77:null}));
  const ix=linkIndex(items);
  for(const h of ix.hubs.values()) assert.ok(h.ids.size>=2);
  for(const it of items){
    const want=new Set(linkedItems(items, it, 1e9).flatMap(l=>l.via.map(v=>v.key)));
    assert.deepEqual(new Set(ix.keysOf.get(it.id)), want, 'id '+it.id);
  }
  const off=linkIndex(items, {kinds:['person']});
  for(const h of off.hubs.values()) assert.equal(h.kind, 'person');
});

test('v3.7.0 속도: persist 는 저장이 끝나기 전에 화면부터 그린다', async () => {
  await fresh();
  let release; env.onInvoke('save_all', () => new Promise(r=>{ release=r; }));   // 느린 디스크 흉내
  const it = mk({memo:'방금 쓴 메모', staged:true}); S.items.push(it);
  const {persist} = await import('../../src/render.js');
  const p = persist();
  assert.ok(doc.querySelector(`#view-board .card[data-open="${it.id}"]`), '저장 완료 전인데 카드가 이미 보인다');
  release({kind:'Saved', version:1}); await p;
  env.onInvoke('save_all', () => undefined);
});

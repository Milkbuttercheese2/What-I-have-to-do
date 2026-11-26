/* v3.8.0 캘린더 — 진행 중 | 완료 전환 · 시간표 빈 자리 누르기 = 그 시각으로 새 업무 · 날짜 두 번 누르기.
   (화면 글은 표준용어로 '진행 중 | 완료'. 보기 값은 예전 그대로 'live' | 'done'.)
   핵심 불변식: (1) 완료 보기는 완료 시각(doneAt)에 부모 업무만 그리고 누르기로 새 업무를 만들지 않는다.
   (2) 미리 채워 연 양식은 닫으면 아무것도 생기지 않고, 하위 업무 제목을 비운 채 저장해도 점검시각이 살아남는다. */
import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {setupEnv} from '../helpers/env.js';

mock.timers.enable({apis:['setTimeout','setInterval']});
const env = setupEnv();
const {S, newId} = await import('../../src/state.js');
const {initForm, closeForm} = await import('../../src/form.js');
const {initRender} = await import('../../src/render.js');
const {initCalendar, renderCal, minuteAtY, slotIso, HOUR_PX, calView} = await import('../../src/calendar.js');
const {initToast} = await import('../../src/dom-utils.js');
const {closeTop, isOpen} = await import('../../src/modals.js');
initToast(); initForm(); initRender(); initCalendar();

const $ = id => env.document.getElementById(id);
const doc = env.document;
const ev = (el, type, o) => el.dispatchEvent(new env.window.MouseEvent(type, Object.assign({bubbles:true, cancelable:true}, o)));
const click = (el, o) => ev(el, 'click', o);
const mk = o => Object.assign({id:newId(), memo:'업무', owner:'', done:false, doneAt:null, staged:false, f:{}, contacts:[], ids:[], subs:[], files:[], al:{}, recur:null, recurId:null}, o);
async function fresh(){ await env.resetS(); S.loaded=true; S.doneDirty.clear(); while(closeTop()); S.settings.calView='live'; S.settings.formDrafts={}; }
const today = (h,m=0) => { const t=new Date(); t.setHours(h,m,0,0); return t; };
const subTime = () => doc.querySelector('#fm-subs .fsub-row .dt-time').value;
const subDate = () => doc.querySelector('#fm-subs .fsub-row .dt-date').value;
const ymd = d => `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;

test('minuteAtY: 0시 · 30분 맞춤(내림) · 23:30 · 자정 경계·음수는 그날 안으로', () => {
  assert.equal(minuteAtY(0), 0);
  assert.equal(minuteAtY(HOUR_PX*0.49), 0, '0:29 → 0:00');
  assert.equal(minuteAtY(HOUR_PX*0.5), 30);
  assert.equal(minuteAtY(HOUR_PX*14.99), 14*60+30);
  assert.equal(minuteAtY(HOUR_PX*23.5), 23*60+30);
  assert.equal(minuteAtY(HOUR_PX*23.99), 23*60+30);
  assert.equal(minuteAtY(HOUR_PX*24), 23*60+30, '맨 아래(24:00)도 그날 23:30');
  assert.equal(minuteAtY(HOUR_PX*30), 23*60+30);
  assert.equal(minuteAtY(-5), 0);
  assert.equal(minuteAtY(NaN), 0);
  const iso = slotIso('2026-10-21', 23*60+30);                // 달은 0부터 → 11월 21일
  const d = new Date(iso);
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()], [2026,10,21,23,30]);
});

test('진행 중 | 완료 전환: 완료 보기는 완료 시각에 부모 업무만, 고른 값은 설정에 기억', async () => {
  await fresh();
  S.items.push(
    mk({memo:'진행 중 마감', f:{due:today(15).toISOString()}}),
    mk({memo:'오늘 끝낸 일\n둘째', done:true, doneAt:today(10,20).getTime(), subs:[{id:newId(), title:'세부', mid:today(9).toISOString(), done:true, al:{}, owner:''}]}),
    mk({memo:'옛 완료(doneAt 없음)', done:true, doneAt:null}),
    mk({memo:'주기 부모', done:true, doneAt:today(11).getTime(), recur:{type:'dow'}}),
  );
  renderCal();
  assert.deepEqual([...doc.querySelectorAll('#cal-mode .seg-btn')].map(b=>[b.dataset.v, b.textContent]),
    [['live','진행 중'], ['done','완료']], '보기 단추 글은 표준용어, 값은 그대로');
  assert.match($('cal-legend').textContent, /하위 업무 점검일.*업무 기한/);
  assert.ok($('cal-detail-cards').textContent.includes('진행 중 마감'));
  assert.ok(!$('cal-detail-cards').textContent.includes('오늘 끝낸 일'));
  const before = env.invokeCalls.filter(c=>c.cmd==='save_settings').length;
  click(doc.querySelector('#cal-mode [data-v="done"]'));
  assert.equal(calView(), 'done');
  assert.equal(S.settings.calView, 'done');
  assert.ok(env.invokeCalls.filter(c=>c.cmd==='save_settings').length > before, '설정 저장');
  assert.ok(doc.querySelector('#cal-mode [data-v="done"]').classList.contains('on'));
  const chips = [...doc.querySelectorAll('#cal-detail-cards .tl-chip')];
  assert.equal(chips.length, 1, '부모 업무 하나만 — 세부·doneAt 없는 것·주기 부모는 안 그린다');
  assert.match(chips[0].textContent, /^10:20완료오늘 끝낸 일×$/);
  assert.ok(chips[0].classList.contains('tl-fin'));
  assert.equal(doc.querySelector('#cal-detail-cards .tl-line.tl-fin').style.top, `${(10+20/60)*HOUR_PX}px`);
  assert.ok(doc.querySelector('#cal-grid .pill.p-fin'), '달 칸 알약도 그린다');
  assert.ok(!doc.querySelector('#cal-grid .pill.p-done'), '완료 보기는 줄을 긋지 않는다');
  assert.match($('cal-legend').textContent, /완료한 날/);
  /* 이름표 → 읽기 전용 양식 */
  click(chips[0]);
  assert.ok(isOpen('formPanel'));
  assert.ok($('formPanel').classList.contains('fm-ro'));
  closeForm();
  /* 빈 날 안내문은 보기에 맞게 */
  const other = new Date(); other.setDate(other.getDate()+3);
  const cell = doc.querySelector(`#cal-grid .cal-day[data-key="${other.getFullYear()}-${other.getMonth()}-${other.getDate()}"]`);
  if(cell){ click(cell); assert.match($('cal-detail-cards').textContent, /이날 완료한 업무가 없습니다/); }
  /* 완료 보기에선 누르기로 새 업무를 만들지 않는다 */
  click(doc.querySelector('#cal-detail-cards .tl-canvas'), {clientY: HOUR_PX*9});
  assert.ok(!isOpen('formPanel'));
  if(cell){ ev(cell, 'dblclick'); assert.ok(!isOpen('formPanel')); }
  /* 모르는 값은 진행 중 보기('live')로 */
  S.settings.calView='zzz'; assert.equal(calView(), 'live');
});

test('시간표 빈 자리 누르기 → 새 양식 + 첫 세부 점검시각(30분 맞춤) · 이름표는 그 업무를 연다', async () => {
  await fresh();
  const it = mk({memo:'기존 마감', f:{due:today(15).toISOString()}}); S.items.push(it);
  click($('cal-today'));                                     // 앞 시험이 고른 날짜를 오늘로 되돌린다
  renderCal();
  const canvas = doc.querySelector('#cal-detail-cards .tl-canvas');
  /* 마우스 올리면 흐린 줄 + 시각 */
  ev(canvas, 'mousemove', {clientY: HOUR_PX*14.8});
  const hv = canvas.querySelector('.tl-hover');
  assert.ok(hv.classList.contains('on'));
  assert.equal(hv.textContent, '14:30');
  assert.equal(hv.style.top, `${14.5*HOUR_PX}px`);
  ev($('cal-detail-cards'), 'mouseleave');
  assert.ok(!hv.classList.contains('on'));
  /* 빈 자리 */
  click(canvas, {clientY: HOUR_PX*14.8});
  assert.ok(isOpen('formPanel'));
  assert.equal($('fm-title').textContent, '새 업무');
  assert.equal(subTime(), '14:30');
  assert.equal(subDate(), ymd(new Date()));
  assert.equal(doc.activeElement, $('fm-memo'), '커서는 메모 칸');
  /* 닫으면 아무것도 생기지 않는다 */
  closeForm();
  assert.equal(S.items.length, 1);
  assert.equal((S.settings.formDrafts||{}).new, undefined, '손대지 않고 닫으면 임시저장도 남지 않는다');
  /* 이름표는 그 업무 */
  click(doc.querySelector('#cal-detail-cards .tl-chip'));
  assert.ok(isOpen('formPanel'));
  assert.equal($('fm-title').textContent, '업무');
  assert.equal($('fm-memo').value, '기존 마감');
  closeForm();
});

test('미리 채운 양식: 세부 제목을 비운 채 저장해도 점검시각이 남는다(메모 첫 줄이 제목)', async () => {
  await fresh();
  renderCal();
  click(doc.querySelector('#cal-detail-cards .tl-canvas'), {clientY: HOUR_PX*9});
  assert.equal(subTime(), '09:00');
  $('fm-memo').value = '거래처 회신 확인\n자세한 내용';
  click($('fm-save')); await env.flush();
  assert.equal(S.items.length, 1);
  const sub = S.items[0].subs[0];
  assert.ok(sub, '세부 줄이 버려지지 않는다');
  assert.equal(sub.title, '거래처 회신 확인');
  assert.equal(new Date(sub.mid).getHours(), 9);
  /* 일반 새 양식은 예전 규칙 그대로(제목 빈 줄은 버린다) */
  const {openForm} = await import('../../src/form.js');
  await openForm({subs:[{title:'', mid:today(9).toISOString()}]});
  $('fm-memo').value = '일반 양식';
  click($('fm-save')); await env.flush();
  assert.equal(S.items.find(x=>x.memo==='일반 양식').subs.length, 0);
});

test('달 칸: 한 번 누르기 = 날짜 고르기, 두 번 누르기 = 그날 18:00 으로 새 양식', async () => {
  await fresh();
  renderCal();
  const d = new Date(); d.setDate(15);
  const cell = () => doc.querySelector(`#cal-grid .cal-day[data-key="${d.getFullYear()}-${d.getMonth()}-15"]`);
  const node = cell();
  click(node);
  assert.ok(!isOpen('formPanel'));
  assert.ok(node.classList.contains('sel'));
  assert.equal(cell(), node, '한 번 누르기는 칸을 갈아끼우지 않는다(두 번 누르기가 같은 칸에 닿게)');
  assert.match($('cal-detail-title').textContent, /15일/);
  ev(node, 'dblclick');
  assert.ok(isOpen('formPanel'));
  assert.equal(subTime(), '18:00');
  assert.equal(subDate(), ymd(d));
  closeForm();
  assert.equal(S.items.length, 0);
});

test('이름표 × (v3.8.0): 기한 = 업무 삭제 · 점검 = 그 하위 업무 줄만 · 완료 = 완료 업무 삭제 — 양식·새 업무는 안 생긴다', async () => {
  await fresh();
  const keep = {id:newId(), title:'남는 세부', mid:today(16).toISOString(), done:false, al:{mid:true}, owner:''};
  const cut  = {id:newId(), title:'지울 세부', mid:today(11).toISOString(), done:false, al:{}, owner:''};
  const a = mk({memo:'마감 업무', f:{due:today(15).toISOString()}, al:{due:true}});
  const b = mk({memo:'점검 업무', subs:[cut, keep]});
  const c = mk({memo:'끝낸 업무', done:true, doneAt:today(10).getTime()});
  S.items.push(a, b, c);
  doc.querySelectorAll('.tab').forEach(t=>t.classList.toggle('on', t.dataset.view==='cal'));   // 캘린더 탭을 보는 중(지운 뒤 다시 그려지게)
  (await import('../../src/views.js')).showView('cal');
  click($('cal-today'));
  const x = sel => doc.querySelector(`#cal-detail-cards ${sel}`);
  const saves = () => env.invokeCalls.filter(c=>c.cmd==='save_all').length;
  /* 점검 × — 세부 줄만, 남은 세부의 알람 상태 그대로, 양식 안 열림·새 업무 없음 */
  let n0 = saves();
  click(x(`[data-delsub="${cut.id}"]`)); await env.flush();
  assert.ok(!isOpen('formPanel'), '× 는 양식을 열지 않는다');
  assert.equal(S.items.length, 3, '빈 자리 클릭 = 새 업무가 타지 않는다');
  assert.deepEqual(S.items.find(i=>i.id===b.id).subs.map(s=>s.title), ['남는 세부']);
  assert.deepEqual(S.items.find(i=>i.id===b.id).subs[0].al, {mid:true});
  assert.ok(saves() > n0);
  assert.ok(!x(`[data-delsub="${cut.id}"]`), '이름표가 사라진다');
  click($('toast-undo')); await env.flush();
  assert.deepEqual(S.items.find(i=>i.id===b.id).subs.map(s=>s.title), ['지울 세부', '남는 세부'], '실행 취소 = 제자리로');
  /* 기한 × — 카드의 × 와 같은 경로(업무 삭제 + 실행 취소) */
  click(x(`.tl-chip [data-del="${a.id}"]`)); await env.flush();
  assert.ok(!isOpen('formPanel'));
  assert.ok(!S.items.some(i=>i.id===a.id));
  assert.equal($('toast-msg').textContent, '업무 삭제함');
  click($('toast-undo')); await env.flush();
  assert.ok(S.items.some(i=>i.id===a.id));
  /* 완료 보기의 × — 완료 업무 삭제(완료 탭 카드의 × 와 같게: deletedDone 으로 저장에 실린다) */
  click(doc.querySelector('#cal-mode [data-v="done"]'));
  click(x(`.tl-chip [data-del="${c.id}"]`)); await env.flush();
  assert.ok(!isOpen('formPanel'));
  assert.ok(!S.items.some(i=>i.id===c.id));
  const last = env.invokeCalls.filter(k=>k.cmd==='save_all').at(-1).args;
  assert.ok((last.deletedDone||[]).includes(c.id), '완료 업무 삭제가 저장에 실린다(markDoneRemoved)');
  assert.equal(S.items.length, 2);
});

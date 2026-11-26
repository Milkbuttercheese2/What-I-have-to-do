/* 화면 글 표준용어(2026-11) — 옛 자료 호환과 바뀐 글을 지킨다.
   - 필드 이름은 DB·백업에 값으로 저장된다(fields.label). 옛 DB·옛 백업에는 '마감시각'이 들어 있다.
     불러올 때 기본 필드는 코드의 CORE_FIELDS 로 덮어쓰므로(state.js reconcileCore·backup.js reconcileImported)
     화면에는 새 이름 '기한'이 나오고, 다음 저장 때 DB 에도 새 이름이 들어간다. 기한 값(f.due)은 그대로다.
   - 엑셀 내보내기 머리글은 '기한'·'하위 업무 진행'·'하위 업무 내역'(예전 '마감시각'·'세부진행'·'세부내역').
     앱은 이 파일을 다시 읽지 않는다(XLSX.read 는 전화번호부 가져오기와 문서 탭 보기뿐).
   테스트 자료는 모두 지어낸 것이다. */
import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {setupEnv} from '../helpers/env.js';

mock.timers.enable({apis:['setTimeout','setInterval']});
const env = setupEnv();
const {S, migrateItem, newId} = await import('../../src/state.js');
const {STORE} = await import('../../src/store.js');
const {reconcileImported, initBackup} = await import('../../src/backup.js');
const {initPresets} = await import('../../src/presets.js');
const {initForm, openForm, closeForm} = await import('../../src/form.js');
const {initRender, render} = await import('../../src/render.js');
const {initToast} = await import('../../src/dom-utils.js');
const {closeTop} = await import('../../src/modals.js');
initToast(); initForm(); initRender(); initPresets(); initBackup();

const $ = id => env.document.getElementById(id);
const doc = env.document;
const iso = min => { const d = new Date(Date.now() + min*60e3); d.setSeconds(0,0); return d.toISOString(); };
const mk = o => Object.assign({id:newId(), memo:'업무', owner:'', done:false, doneAt:null, staged:false, f:{}, contacts:[], ids:[], subs:[], files:[], al:{}, recur:null, recurId:null}, o);
async function fresh(){ await env.resetS(); S.doneDirty.clear(); while(closeTop()); }

/* 옛 판(v3.8.25 까지)이 DB 에 남긴 필드 표 — 001_init.sql 초기값과 같은 이름 */
const OLD_FIELDS = [
  {key:'received', label:'접수시각', type:'datetime', on:true, builtin:true},
  {key:'due',      label:'마감시각', type:'datetime', on:false, builtin:false},   // 옛 이름 + 엇나간 깃발까지
  {key:'dept',     label:'담당 부서', type:'text', on:true, builtin:false},        // 사용자가 더한 필드
];
const dueLabel = () => $('fm-grid').querySelector('[data-fkey="due"]').closest('.fm-field').querySelector('label').textContent;

test('옛 DB 호환: 필드 이름 "마감시각"이 든 상태를 불러오면 화면엔 "기한", 저장도 새 이름, 기한 값은 그대로', async () => {
  await fresh();
  const due = new Date(2026, 10, 30, 18, 0, 0, 0).toISOString();
  env.onInvoke('load_all', () => ({dataVersion:3, fields:JSON.parse(JSON.stringify(OLD_FIELDS)),
    items:[{id:101, memo:'옛 자료 업무', done:false, staged:false, f:{received:due, due}, contacts:[], ids:[], subs:[], files:[], al:{due:true}}]}));
  S.items = (await STORE.load()).map(migrateItem);
  S.loaded = true;
  reconcileImported();
  const byKey = k => S.fields.find(f=>f.key===k);
  assert.deepEqual(S.fields.map(f=>f.key), ['received','due','dept'], '필드가 빠지거나 늘지 않는다');
  assert.equal(byKey('due').label, '기한');
  assert.equal(byKey('due').on, true);
  assert.equal(byKey('due').builtin, true);
  assert.equal(byKey('received').label, '접수시각');
  assert.equal(byKey('dept').label, '담당 부서', '사용자 필드 이름은 건드리지 않는다');
  /* 다음 저장(save_fields)에 새 이름이 실린다 — 옛 이름은 DB 에 다시 쓰이지 않는다 */
  const sf = env.invokeCalls.filter(c=>c.cmd==='save_fields').at(-1);
  assert.ok(sf, 'save_fields 가 나간다');
  assert.equal(sf.args.fields.find(f=>f.key==='due').label, '기한');
  assert.ok(!JSON.stringify(sf.args).includes('마감시각'));
  /* 자료는 깨지지 않는다 */
  assert.equal(S.items.length, 1);
  assert.equal(S.items[0].f.due, due);
  assert.deepEqual(S.items[0].al, {due:true}, '알림 확인 상태도 그대로');
  /* 양식에도 새 이름 */
  await openForm(S.items[0]);
  assert.equal(dueLabel(), '기한');
  assert.ok(!$('fm-grid').textContent.includes('마감시각'));
  assert.equal($('fm-grid').querySelector('[data-fkey="due"] .dt-time').value, '18:00');
  closeForm();
  env.onInvoke('load_all', () => undefined);
});

test('옛 백업 호환: "마감시각"이 든 JSON 백업을 복원해도 화면엔 "기한", 기한 값·업무는 그대로', async () => {
  await fresh(); S.loaded = true;
  const due = new Date(2026, 11, 2, 9, 30, 0, 0).toISOString();
  const oldBackup = {v:5, exported:'2026-11-01T00:00:00.000Z', fields:JSON.parse(JSON.stringify(OLD_FIELDS)),
    items:[{id:201, memo:'백업 속 업무', f:{due}, subs:[{id:202, title:'서류 확인', mid:due, done:false, al:{}, owner:''}]}]};
  env.onInvoke('import_backup_file', () => ({kind:'Json', content: JSON.stringify(oldBackup)}));
  env.onInvoke('backup_import', () => 9);
  env.answerConfirm(true);
  $('bkImp').click();
  await env.flush(10);
  assert.equal(env.invokeCalls.filter(c=>c.cmd==='backup_import').length, 1, '복원은 한 번에');
  assert.equal(S.fields.find(f=>f.key==='due').label, '기한');
  assert.equal(S.fields.find(f=>f.key==='dept').label, '담당 부서');
  const sf = env.invokeCalls.filter(c=>c.cmd==='save_fields').at(-1);
  assert.equal(sf.args.fields.find(f=>f.key==='due').label, '기한', '복원 뒤 저장되는 이름도 새 이름');
  assert.equal(S.items.length, 1);
  assert.equal(S.items[0].f.due, due);
  assert.deepEqual(S.items[0].subs.map(s=>[s.id, s.title, s.mid]), [[202, '서류 확인', due]]);
  assert.equal($('toast-msg').textContent, '백업 1건을 복원했습니다');
  env.onInvoke('backup_import', () => null);
});

test('엑셀 내보내기 머리글: 기한 · 하위 업무 진행 · 하위 업무 내역 (옛 열 이름은 없다)', async () => {
  await fresh(); S.loaded = true;
  const due = new Date(2026, 10, 3, 14, 5, 0, 0).toISOString();
  S.items.push(mk({memo:'내보낼 업무', done:true, doneAt:Date.now(), f:{due},
    subs:[{id:newId(), title:'서류 확인', mid:'', done:true, al:{}, owner:''}, {id:newId(), title:'회신', mid:'', done:false, al:{}, owner:''}]}));
  let rows = null;
  const X = {utils:{json_to_sheet:r=>{ rows=r; return {}; }, book_new:()=>({}), book_append_sheet:()=>{}}, write:()=>new Uint8Array([1]).buffer};
  env.window.XLSX = X; globalThis.XLSX = X;
  let saved = null;
  env.onInvoke('save_binary_file', a => { saved = a; return true; });
  try{
    $('xlsx').click();
    await env.flush(8);
    assert.ok(rows && rows.length === 1, '한 줄');
    assert.deepEqual(Object.keys(rows[0]),
      ['구역','메모','관련인','관련소속','연락처','이메일','접수시각','기한','식별정보','하위 업무 진행','하위 업무 내역','파일링크']);
    for(const old of ['마감시각','세부진행','세부내역']) assert.ok(!(old in rows[0]), `옛 열 이름 ${old} 없음`);
    assert.equal(rows[0]['기한'], '2026-11-03 14:05');
    assert.equal(rows[0]['하위 업무 진행'], '1/2');
    assert.equal(rows[0]['하위 업무 내역'], '[완료] 서류 확인 · 회신');
    assert.match(saved.suggestedName, /^뭐하려했더라_업무목록_\d{8}\.xlsx$/, '파일 이름은 그대로');
  } finally {
    delete env.window.XLSX; delete globalThis.XLSX;
    env.onInvoke('save_binary_file', () => undefined);
  }
});

test('보드 카드·요약 줄의 바뀐 글: 알림 점 · 반복 꼬리표 · 진행 중 업무 · 오늘 업무', async () => {
  await fresh(); S.loaded = true;
  const parent = mk({memo:'매주 보고', recur:{type:'dow', dows:[1], time:'09:00', next:null}});
  const wait = mk({memo:'대기', f:{due:iso(120)}});
  const ring = mk({memo:'울림', f:{due:iso(-30)}});
  const seen = mk({memo:'확인함', f:{due:iso(-20)}, al:{due:true}});
  const child = mk({memo:'회차', recurId:parent.id});
  S.items.push(parent, wait, ring, seen, child);
  render();
  const card = it => doc.querySelector(`.card[data-open="${it.id}"]`);
  const tip = it => card(it).querySelector('.adot').getAttribute('title');
  assert.equal(tip(wait), '알림 대기');
  assert.equal(tip(ring), '알림 울림');
  assert.equal(tip(seen), '알림 확인함');
  assert.equal(card(ring).querySelector('.tag.time .k').textContent, '기한:');
  assert.equal(card(child).querySelector('.tag.recur').textContent, '반복');
  assert.ok(!doc.querySelector('#view-board').innerHTML.includes('알람'), '옛 말 "알람"이 카드에 남지 않는다');
  const m = $('metrics').textContent;
  assert.match(m, /진행 중 업무/); assert.match(m, /오늘 업무/);
  assert.ok(!/진행 업무|오늘 할 일/.test(m));
});

test('양식·설정·팝업의 바뀐 이름표(index.html)', () => {
  assert.equal(doc.querySelector('.fm-subs .t-head').textContent, '하위 업무');
  assert.equal($('fm-finish').textContent, '✓ 업무 완료');
  assert.equal($('pb-xlsx').textContent, '엑셀 가져오기');
  assert.equal($('pbs-title').textContent, '엑셀 가져오기');
  assert.equal(doc.querySelector('#recurModal h3').textContent, '반복 업무');
  assert.equal(doc.querySelector('#recurManageBtn .set-lab').textContent, '반복 업무');
  assert.equal(doc.querySelector('#segAlarm').closest('.set-row').querySelector('.set-lab').textContent, '기한·점검 시각 알림');
  /* 저장 지연 경고는 그대로 경고로 뜨고, 부르는 단추 이름은 설정에 실제로 있는 이름이다 */
  const alert = $('saveAlert');
  assert.equal(alert.getAttribute('role'), 'alert');
  assert.match(alert.textContent, /\[설정 → 백업 파일 만들기\]/);
  assert.equal(doc.querySelector('#bkExp .set-lab').textContent, '백업 파일 만들기');
});

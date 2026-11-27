/* 백업/복원 — reconcileImported · JSON 복원 분기 전체 · Db/Cancelled · 내보내기 */
import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {setupEnv} from '../helpers/env.js';

mock.timers.enable({apis:['setTimeout','setInterval']});
const env = setupEnv();
const {S} = await import('../../src/state.js');
const {reconcileImported, initBackup} = await import('../../src/backup.js');
const {initPresets} = await import('../../src/presets.js');
initPresets();     // reconcileImported → renderPresets 경로에 프리셋 초기화 필요
initBackup();

const $ = id => env.document.getElementById(id);
const iso = min => new Date(Date.now() + min*60e3).toISOString();

test('reconcileImported: 4종 소비 + 기타 필터 + save_* 호출 + imported null화', async () => {
  await env.resetS(); S.loaded = true;
  S.imported = {
    fields: [{key:'received'}, {key:'who'}, {key:'커스텀', on:true}],
    presets: [{id:'p1', label:'프리셋1', sum:'요약'}],
    idKinds: ['계약번호', '기타', '', 'SR번호'],
    settings: {alarmOn:false},
  };
  reconcileImported();
  assert.deepEqual(S.idKinds, ['계약번호', 'SR번호']);            // '기타'·빈값 필터
  assert.equal(S.settings.alarmOn, false);
  assert.equal(S.presets[0].label, '프리셋1');
  assert.deepEqual(S.fields.map(f=>f.key), ['received','due','커스텀']);  // 레거시 who 제거
  for(const k of ['fields','presets','idKinds','settings']) assert.equal(S.imported[k], null);
  const cmds = env.invokeCalls.map(c=>c.cmd);
  for(const c of ['save_presets','save_id_kinds','save_settings','save_fields'])
    assert.ok(cmds.includes(c), c+' 호출됨');
  assert.ok($('presets').textContent.includes('프리셋1'));        // 재렌더 확인
});

test('JSON 복원 해피패스: 구형 아이템 마이그레이션 + backup_import 1회 + 상태 교체', async () => {
  await env.resetS(); S.loaded = true;
  S.items.push({id:1, memo:'기존', done:false, staged:true, f:{}, contacts:[], ids:[], subs:[], al:{}});
  const oldBackup = {
    items: [{id: 2, title:'구형 제목', f:{who:'담당자', due:iso(60)}, subs:[]}],   // v5 이전 형태
  };
  env.onInvoke('import_backup_file', () => ({kind:'Json', content: JSON.stringify(oldBackup)}));
  env.answerConfirm(true);
  $('bkImp').click();
  await env.flush(8);
  const bi = env.invokeCalls.filter(c=>c.cmd==='backup_import');
  assert.equal(bi.length, 1);
  const payload = bi[0].args.payload;
  assert.equal(payload.v, 5);
  assert.equal(payload.items[0].memo, '구형 제목');                       // 마이그레이션됨
  assert.deepEqual(payload.items[0].contacts, [{who:'담당자', org:'', phone:''}]);
  assert.ok(Array.isArray(payload.fields) && Array.isArray(payload.presets)); // 빠진 섹션 채움
  assert.equal(S.items.length, 1);
  assert.equal(S.items[0].memo, '구형 제목');                              // 메모리 교체
  assert.equal($('toast-msg').textContent, '백업 1건을 복원했습니다');
});

/* 복원은 번호표(dataVersion)를 올린다. 새 번호를 받아 두지 않으면 복원 직후의 저장이 옛 번호로 나가
   '낡은 화면'으로 거절된다(비상 덤프 + 거짓 안내 + 새로고침). */
test('JSON 복원 뒤 첫 저장은 복원이 돌려준 번호표로 나간다', async () => {
  await env.resetS(); S.loaded = true; S.dataVersion = 4;
  env.onInvoke('import_backup_file', () => ({kind:'Json', content: JSON.stringify({items:[{id:7, memo:'복원분', f:{}, subs:[]}]})}));
  env.onInvoke('backup_import', () => 5);
  env.onInvoke('save_all', () => ({kind:'Saved', version:6}));
  env.answerConfirm(true);
  $('bkImp').click();
  await env.flush(8);
  const save = env.invokeCalls.filter(c=>c.cmd==='save_all').pop();
  assert.ok(save, '복원 뒤 저장이 나간다');
  assert.equal(save.args.baseVersion, 5, '옛 번호(4)가 아니라 복원 뒤 번호(5)');
  env.onInvoke('backup_import', () => null);
  env.onInvoke('save_all', () => undefined);
});

test('형식 오류 JSON → alert + backup_import 미호출 + 상태 불변', async () => {
  await env.resetS(); S.loaded = true;
  S.items.push({id:1, memo:'보존되어야 함', done:false, staged:true, f:{}, contacts:[], ids:[], subs:[], al:{}});
  env.onInvoke('import_backup_file', () => ({kind:'Json', content: '{"items": "배열아님"}'}));
  $('bkImp').click();
  await env.flush(8);
  assert.ok(env.alerts.some(a=>a.includes('형식이 올바르지 않습니다')));
  assert.equal(env.invokeCalls.filter(c=>c.cmd==='backup_import').length, 0);
  assert.equal(S.items[0].memo, '보존되어야 함');
});

test('confirm 거절 → 복원 안 함', async () => {
  await env.resetS(); S.loaded = true;
  env.onInvoke('import_backup_file', () => ({kind:'Json', content: JSON.stringify({items:[]})}));
  env.answerConfirm(false);
  $('bkImp').click();
  await env.flush(8);
  assert.equal(env.invokeCalls.filter(c=>c.cmd==='backup_import').length, 0);
});

test('backup_import 실패 → alert + 메모리 상태 불변 (DB 우선 순서)', async () => {
  await env.resetS(); S.loaded = true;
  S.items.push({id:1, memo:'살아남을 데이터', done:false, staged:true, f:{}, contacts:[], ids:[], subs:[], al:{}});
  env.onInvoke('import_backup_file', () => ({kind:'Json', content: JSON.stringify({items:[{id:9, memo:'새것'}]})}));
  env.onInvoke('backup_import', () => { throw new Error('tx rollback'); });
  env.answerConfirm(true);
  $('bkImp').click();
  await env.flush(8);
  assert.ok(env.alerts.some(a=>a.includes('백업 복원 실패')));
  assert.equal(S.items[0].memo, '살아남을 데이터');
});

test('Cancelled → 아무 일도 없음 / Db 거절 → cancel_pending_import / Db 수락 → restart_app', async () => {
  await env.resetS(); S.loaded = true;
  env.onInvoke('import_backup_file', () => ({kind:'Cancelled'}));
  $('bkImp').click();
  await env.flush(8);
  assert.equal(env.invokeCalls.filter(c=>c.cmd!=='import_backup_file').length, 0);

  await env.resetS(); S.loaded = true;
  env.onInvoke('import_backup_file', () => ({kind:'Db', items:7}));
  env.answerConfirm(false);                       // 덮어쓰기 거절
  $('bkImp').click();
  await env.flush(8);
  assert.ok(env.invokeCalls.some(c=>c.cmd==='cancel_pending_import'));
  assert.equal($('toast-msg').textContent, '복원을 취소했습니다');

  await env.resetS(); S.loaded = true;
  env.onInvoke('import_backup_file', () => ({kind:'Db', items:7}));
  env.answerConfirm(true, true);                  // 덮어쓰기 + 즉시 재시작
  $('bkImp').click();
  await env.flush(8);
  assert.ok(env.invokeCalls.some(c=>c.cmd==='restart_app'));
});

/* DB 파일 복원을 거절했는데 대기 파일 지우기(cancel_pending_import)가 실패하면, 다음 실행 때 거절한
   복원이 적용된다. 예전엔 그 실패를 삼키고 '복원을 취소했습니다'를 띄웠다. */
test('DB 복원 취소가 실패하면 취소됐다고 하지 않고 알린다 (한 번 더 시도한 뒤)', async () => {
  await env.resetS(); S.loaded = true;
  env.onInvoke('import_backup_file', () => ({kind:'Db', items:7}));
  env.onInvoke('cancel_pending_import', () => { throw new Error('사용 중'); });
  $('toast-msg').textContent = '';
  const before = env.alerts.length;
  env.answerConfirm(false);
  $('bkImp').click();
  for (let i = 0; i < 4; i++) { await env.flush(4); mock.timers.tick(400); }
  await env.flush(8);
  assert.equal(env.invokeCalls.filter(c=>c.cmd==='cancel_pending_import').length, 2, '한 번 더 시도');
  assert.notEqual($('toast-msg').textContent, '복원을 취소했습니다');
  assert.ok(env.alerts.slice(before).some(m=>m.includes('복원 취소에 실패')), '실패를 알린다');
  env.onInvoke('cancel_pending_import', () => null);
});

test('JSON 백업 내보내기: 파일명 패턴 + 내용이 유효한 v5 payload', async () => {
  await env.resetS(); S.loaded = true;
  S.items.push({id:1, memo:'백업될 것', done:false, staged:true, f:{}, contacts:[], ids:[], subs:[], al:{}});
  let captured;
  env.onInvoke('save_text_file', args => { captured = args; return true; });
  $('bkExp').click();
  await env.flush(8);
  assert.match(captured.suggestedName, /^뭐하려했더라_백업_\d{8}\.json$/);
  const parsed = JSON.parse(captured.content);
  assert.equal(parsed.v, 5);
  assert.equal(parsed.items[0].memo, '백업될 것');
  assert.ok(Array.isArray(parsed.fields) && Array.isArray(parsed.idKinds));
  assert.equal($('toast-msg').textContent, '백업 파일을 저장했습니다');
});

test('저장 위치 변경 해피패스: get_data_dir → choose_data_dir → restart_app', async () => {
  await env.resetS(); S.loaded = true;
  env.onInvoke('get_data_dir', () => 'C:\\old\\dir');
  env.onInvoke('choose_data_dir', () => 'C:\\new\\dir');
  env.answerConfirm(true, true);
  $('dataDirBtn').click();
  await env.flush(8);
  const cmds = env.invokeCalls.map(c=>c.cmd);
  assert.deepEqual(cmds, ['get_data_dir', 'choose_data_dir', 'restart_app']);
});

/* ── 옛 백업 ↔ 현재 설정의 호환 계약 (v2.6.2) ─────────────────────────────
   설정은 스키마가 아니라 key/value 가방이라 새 키가 늘어도 마이그레이션이 없다.
   빠진 키는 기본값으로 채우고, 모르는 옛 키는 버리지 않고 보존하며,
   임시 상태(초안)는 내보낼 때도 들어올 때도 제외한다. */
test('옛 백업 복원: 빠진 설정 키는 기본값으로, 모르는 옛 키는 보존, 초안은 제외', async () => {
  await env.resetS(); S.loaded = true;
  const oldBackup = {
    v: 4,
    items: [{id: 7, memo:'옛 업무', f:{}, subs:[]}],
    settings: {                       // 테마 관련 키가 아예 없는 옛 설정
      alarmOn: false,
      captureShortcut: 'Ctrl+Alt+Q',  // v2.31에서 없어진 키 — 버리지 않는다
      captureDraft: '옛 초안',        // 임시 상태 — 들어오면 안 된다
      formDrafts: {'7': {at:1, data:{memo:'옛 임시저장'}}},
    },
  };
  env.onInvoke('import_backup_file', () => ({kind:'Json', content: JSON.stringify(oldBackup)}));
  env.onInvoke('backup_import', () => null);      // 앞 테스트가 걸어둔 실패 핸들러 해제
  env.answerConfirm(true);
  $('bkImp').click();
  await env.flush(20);
  const sent = env.invokeCalls.filter(c=>c.cmd==='backup_import')[0].args.payload.settings;
  assert.equal(sent.captureDraft, '');                 // 초안은 털어서 보낸다
  assert.deepEqual(sent.formDrafts, {});
  assert.equal(sent.captureShortcut, 'Ctrl+Alt+Q');    // 모르는 옛 키는 보존
  assert.equal(S.settings.alarmOn, false);             // 백업 값이 이긴다
  assert.equal(S.settings.closeToTray, true);          // 빠진 키는 DEFAULT_SETTINGS 로 채워진다
  assert.equal(S.settings.theme, undefined);           // 테마 키 없음 → norm*() 이 기본값으로 접는다
});

test('내보내기: 임시 상태(초안)는 백업 파일에 담기지 않는다', async () => {
  await env.resetS(); S.loaded = true;
  S.settings.captureDraft = '쓰다 만 캡처';
  S.settings.formDrafts = {'1': {at: 1, data:{memo:'쓰다 만 양식'}}};
  S.settings.theme = 'dark';
  env.onInvoke('save_text_file', () => true);
  $('bkExp').click();
  await env.flush(8);
  const text = env.invokeCalls.filter(c=>c.cmd==='save_text_file')[0].args.content;
  const out = JSON.parse(text);
  assert.equal(out.settings.captureDraft, '');
  assert.deepEqual(out.settings.formDrafts, {});
  assert.equal(out.settings.theme, 'dark');            // 진짜 설정은 그대로 간다
});

/* 점검 라운드 3: 시작 때 읽기가 실패한 세션(S.loaded=false — "저장된 데이터를 불러오지 못했습니다" 안내)에서 안내대로
   [백업에서 복원](JSON)을 하면, 예전엔 F1 게이트가 닫힌 채로 남아 **복원 뒤 고친 것이 하나도 저장되지 않았다**(배너도 없이 —
   saveAll 이 조용히 돌아간다). 앱을 닫으면 그 사이 작업이 사라졌다. */
test('시작 읽기 실패 세션에서 JSON 복원 → 그 뒤 고친 것이 저장된다(F1 게이트가 열린다)', async () => {
  await env.resetS();                                  // loaded=false = 첫 읽기 실패
  const {persist} = await import('../../src/render.js');
  env.onInvoke('import_backup_file', () => ({kind:'Json', content: JSON.stringify({items:[{id:7, memo:'복원분', f:{}, subs:[]}]})}));
  env.onInvoke('backup_import', () => 3);
  env.onInvoke('save_all', () => ({kind:'Saved', version:4}));
  env.answerConfirm(true);
  $('bkImp').click();
  await env.flush(8);
  assert.equal(S.items.length, 1);
  assert.equal(S.loaded, true, '복원으로 DB 와 화면이 같아졌으니 게이트가 열린다');
  const first = env.invokeCalls.filter(c=>c.cmd==='save_all');
  assert.equal(first.length, 1, '복원 직후의 저장(persist)도 나간다');
  assert.equal(first[0].args.baseVersion, 3, '복원이 준 번호표로');
  env.invokeCalls.length = 0;
  S.items[0].memo = '복원 뒤 고침';
  await persist();
  await env.flush(4);
  const saves = env.invokeCalls.filter(c=>c.cmd==='save_all');
  assert.equal(saves.length, 1, '복원 뒤 고친 것이 저장에 나간다');
  assert.equal(saves[0].args.items[0].memo, '복원 뒤 고침');
  assert.equal(saves[0].args.baseVersion, 4, '그 저장이 돌려준 번호표로');
  env.onInvoke('backup_import', () => null);
  env.onInvoke('save_all', () => undefined);
});

test('시작 읽기 실패 세션에서 JSON 복원이 실패하면 게이트는 닫힌 채다(빈 화면이 DB 를 덮지 않게)', async () => {
  await env.resetS();
  env.onInvoke('import_backup_file', () => ({kind:'Json', content: JSON.stringify({items:[{id:7, memo:'복원분', f:{}, subs:[]}]})}));
  env.onInvoke('backup_import', () => { throw '쓰기 실패'; });
  env.answerConfirm(true);
  $('bkImp').click();
  await env.flush(8);
  assert.equal(S.loaded, false);
  assert.equal(S.items.length, 0);
  env.onInvoke('backup_import', () => null);
});

/* 점검 라운드 3 — 제안(소유자 결정 전이라 todo): 문서 탭 옆 칸 양식은 가림막이 없어 양식을 연 채 [설정] → [백업에서 복원]을 할 수 있다.
   복원한 데이터에 그 업무가 없으면, 양식의 [저장]은 '고칠 업무가 없음'으로 아무것도 하지 않고 임시저장분까지 지워 쓰던 글이 사라진다.
   (그 업무가 있으면 반대로 복원 전 화면 내용이 복원한 업무를 덮는다.) 고치려면 복원 때 양식을 어떻게 할지(닫기·새 업무로 남기기)를 정해야 한다. */
test('복원으로 열린 양식의 업무가 없어지면 [저장]이 쓰던 글을 말없이 버린다', {todo:'제안 — 복원 때 열린 양식 처리(소유자 결정)'}, async () => {
  const {initForm, openForm} = await import('../../src/form.js');
  initForm();
  await env.resetS(); S.loaded = true;
  const it = {id:41, memo:'복원 전 업무', done:false, staged:false, f:{}, contacts:[], ids:[], subs:[], files:[], al:{}};
  S.items.push(it);
  openForm(it, {dock:true}); await env.flush();
  $('fm-memo').value = '복원 전 업무 — 쓰던 글';
  env.onInvoke('import_backup_file', () => ({kind:'Json', content: JSON.stringify({items:[{id:7, memo:'복원분', f:{}, subs:[]}]})}));
  env.onInvoke('backup_import', () => 3);
  env.answerConfirm(true);
  $('bkImp').click();
  await env.flush(8);
  $('fm-save').click(); await env.flush(4);
  assert.ok(S.items.some(x=>String(x.memo).includes('쓰던 글')), '쓰던 글이 어딘가 남는다');
  env.onInvoke('backup_import', () => null);
});

/* 점검 라운드 3: [백업 파일 만들기] → 그 파일로 [백업에서 복원]의 왕복 — 모든 칸이 그대로 backup_import 에 실리는가
   (하위 업무 순서·담당·알림 상태(확인·미룸 숫자)·관련인 이메일·식별정보·파일 링크·반복 업무·완료 시각·사용자 칸·
   전화번호부·프리셋·식별정보 명칭·옛 반복 정의·모르는 설정 키). 임시 상태(초안)만 빠진다. */
test('JSON 백업 왕복: 만든 파일로 복원하면 모든 칸이 그대로 실린다(초안만 빠진다)', async () => {
  await env.resetS(); S.loaded = true;
  const items = [
    {id:1700000000001, memo:'첫 줄\n[구역]\n내용 @김가', owner:'', done:false, doneAt:null, staged:false,
     f:{received:'2026-11-01T00:00:00.000Z', due:'2026-11-30T09:00:00.000Z', custom1:'사용자 칸'},
     contacts:[{who:'김가', org:'가과', phone:'010-1111-2222', email:'kim@x.kr'}, {who:'나', org:'', phone:'내선 1234', email:''}],
     ids:[{kind:'SR번호', val:'SR-1'}, {kind:'자체', val:'X-9'}],
     subs:[{id:1700000000003, title:'둘째로 적은 것', mid:'2026-11-20T01:00:00.000Z', done:true, al:{mid:true}, owner:'박담당'},
           {id:1700000000002, title:'첫째로 적은 것', mid:'', done:false, al:{mid:1800000000000}, owner:''}],
     files:['C:\문서\가.hwp', '\\srv\공유\나.pdf'], al:{due:true}, recur:null, recurId:1700000000099},
    {id:1700000000010, memo:'반복 부모', owner:'', done:false, doneAt:null, staged:false, f:{}, contacts:[], ids:[], subs:[], files:[], al:{},
     recur:{freq:'weekly', dow:[1,3], time:{hh:9, mm:30}, next:'2026-12-01', paused:false}, recurId:null},
    {id:1700000000020, memo:'완료', owner:'외부', done:true, doneAt:1764200000000, staged:true, f:{}, contacts:[], ids:[], subs:[], files:[], al:{}, recur:null, recurId:null},
  ];
  S.items = JSON.parse(JSON.stringify(items));
  S.fields = [...S.fields, {key:'custom1', label:'사용자 칸', type:'datetime', on:true}];
  S.presets = [{id:'p1', label:'프리셋', memo:'틀', subs:['가']}];
  S.idKinds = ['SR번호', '공사관리번호'];
  S.recurDefs = [{id:5, memo:'옛 정기', freq:'daily', dow:[], time:{hh:8, mm:0}, next:'', paused:true}];
  S.phonebook = [{id:9, who:'김가', org:'가과', phone:'010-1111-2222', email:'kim@x.kr'}];
  Object.assign(S.settings, {theme:'dark', uiScale:130, docRoots:['D:\공유'], 옛키:'보존', captureDraft:'쓰다 만 미니 메모', formDrafts:{'1':{at:1, data:{memo:'초안'}}}});
  const want = {fields:S.fields, presets:S.presets, idKinds:S.idKinds, recurDefs:S.recurDefs, phonebook:S.phonebook,
                settings:{...S.settings, captureDraft:'', formDrafts:{}}};
  env.onInvoke('save_text_file', () => true);
  $('bkExp').click();
  await env.flush(8);
  const file = env.invokeCalls.filter(c=>c.cmd==='save_text_file').at(-1).args.content;
  env.invokeCalls.length = 0;
  env.onInvoke('import_backup_file', () => ({kind:'Json', content:file}));
  env.onInvoke('backup_import', () => 9);
  env.answerConfirm(true);
  $('bkImp').click();
  await env.flush(10);
  const payload = env.invokeCalls.filter(c=>c.cmd==='backup_import')[0].args.payload;
  assert.deepEqual(payload.items, items, '업무의 모든 칸 — 순서까지');
  for(const k of ['fields','presets','idKinds','recurDefs','phonebook']) assert.deepEqual(payload[k], want[k], k);
  assert.deepEqual(payload.settings, want.settings, '설정 — 모르는 키 보존, 초안만 빠짐');
  env.onInvoke('backup_import', () => null);
});

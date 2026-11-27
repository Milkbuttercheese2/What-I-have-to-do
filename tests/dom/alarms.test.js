/* 알람 — 발화 조건 · F5(모달 중 재알림 금지) · F6(스누즈) · 확인/미룸 · 토글 */
import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {setupEnv} from '../helpers/env.js';

mock.timers.enable({apis:['setTimeout','setInterval']});
const env = setupEnv();
const {S, newId} = await import('../../src/state.js');
const {checkAlarms, initAlarms} = await import('../../src/alarms.js');
initAlarms();

const $ = id => env.document.getElementById(id);
const iso = min => new Date(Date.now() + min*60e3).toISOString();
const mk = o => Object.assign({id:newId(), memo:'m', done:false, staged:false, f:{}, contacts:[], ids:[], subs:[], al:{}}, o);
const closeModal = () => { $('alarmBg').classList.remove('on'); };

test('지난 기한 → 모달 + 기한 항목 + focus_main_window + 작업표시줄 배지 on (v2.5.3)', async () => {
  await env.resetS(); S.loaded = true;
  S.items.push(mk({memo:'지난 마감건', f:{due:iso(-5)}}));
  checkAlarms();
  assert.ok($('alarmBg').classList.contains('on'));
  assert.equal($('alarmList').querySelector('.a-due b').textContent, '기한');   // 이름표 글(예전 '마감') — 메모의 '마감'과 헷갈리지 않게 이름표만 본다
  assert.ok($('alarmList').textContent.includes('지난 마감건'));
  assert.ok(env.invokeCalls.some(c=>c.cmd==='focus_main_window'));
  assert.ok(env.invokeCalls.some(c=>c.cmd==='alarm_attention'&&c.args&&c.args.on===true));
  closeModal();
});

test('지난 미완료 세부 mid → 중간점검 / 완료 sub·완료 아이템은 침묵', async () => {
  await env.resetS(); S.loaded = true;
  S.items.push(mk({subs:[{id:newId(), title:'회신 점검', mid:iso(-3), done:false, al:{}}]}));
  checkAlarms();
  assert.ok($('alarmList').textContent.includes('중간점검'));
  closeModal();

  await env.resetS(); S.loaded = true;
  S.items.push(
    mk({subs:[{id:newId(), title:'done sub', mid:iso(-3), done:true, al:{}}]}),
    mk({memo:'done item', done:true, f:{due:iso(-3)}}),
  );
  checkAlarms();
  assert.equal($('alarmBg').classList.contains('on'), false);
});

test('al=true(확인됨)·스누즈 중은 미발화, 스누즈 만료는 발화 (F6)', async () => {
  await env.resetS(); S.loaded = true;
  S.items.push(mk({f:{due:iso(-5)}, al:{due:true}}));                 // 확인됨
  checkAlarms();
  assert.equal($('alarmBg').classList.contains('on'), false);

  S.items[0].al.due = Date.now() + 60e3;                              // 스누즈 중
  checkAlarms();
  assert.equal($('alarmBg').classList.contains('on'), false);

  S.items[0].al.due = Date.now() - 1;                                 // 스누즈 만료
  checkAlarms();
  assert.ok($('alarmBg').classList.contains('on'));
  closeModal();
});

test('알림창은 메모 첫 줄만 보여준다 (v3.6.2 — 카드 v2.5.12 와 동일 규칙)', async () => {
  await env.resetS(); S.loaded = true;
  S.items.push(mk({memo:'첫 줄 요약\n둘째 줄 상세내용\n셋째 줄', f:{due:iso(-5)}}));
  checkAlarms();
  assert.ok($('alarmList').textContent.includes('첫 줄 요약'));
  assert.ok(!$('alarmList').textContent.includes('둘째 줄 상세내용'));
  closeModal();
});

test('alarmOn=false → 억제', async () => {
  await env.resetS(); S.loaded = true;
  S.settings.alarmOn = false;
  S.items.push(mk({f:{due:iso(-5)}}));
  checkAlarms();
  assert.equal($('alarmBg').classList.contains('on'), false);
});

test('F5: 모달이 이미 떠 있으면 목록을 다시 쓰지 않음', async () => {
  await env.resetS(); S.loaded = true;
  S.items.push(mk({memo:'첫 알람', f:{due:iso(-5)}}));
  checkAlarms();
  const firstList = $('alarmList').innerHTML;
  S.items.push(mk({memo:'둘째 알람', f:{due:iso(-4)}}));
  checkAlarms();                                                      // 모달 열림 중 → no-op
  assert.equal($('alarmList').innerHTML, firstList);
  closeModal();
});

test('확인 → al=true + 모달 닫힘 + persist + 작업표시줄 배지 off (v2.5.3)', async () => {
  await env.resetS(); S.loaded = true;
  S.items.push(mk({f:{due:iso(-5)}}));
  checkAlarms();
  env.invokeCalls.length = 0;
  $('alarmOk').click();
  await env.flush();
  assert.equal(S.items[0].al.due, true);
  assert.equal($('alarmBg').classList.contains('on'), false);
  assert.ok(env.invokeCalls.some(c=>c.cmd==='save_all'));
  assert.ok(env.invokeCalls.some(c=>c.cmd==='alarm_attention'&&c.args&&c.args.on===false));
});

test('v3.7.0 알림 끄기(설정 세그먼트 → applyAlarmOn): 떠 있는 알림창을 닫고 다시 울리지 않는다', async () => {
  await env.resetS(); S.loaded = true;
  S.settings.alarmOn = true;
  S.items.push(mk({f:{due:iso(-5)}}));
  checkAlarms();
  assert.ok($('alarmBg').classList.contains('on'));
  const {applyAlarmOn} = await import('../../src/alarms.js');
  S.settings.alarmOn = false; applyAlarmOn();
  assert.equal($('alarmBg').classList.contains('on'), false);         // 모달도 닫힘
  assert.ok(env.invokeCalls.some(c=>c.cmd==='alarm_attention' && c.args && c.args.on===false));
  S.items.push(mk({f:{due:iso(-3)}}));
  checkAlarms();
  assert.equal($('alarmBg').classList.contains('on'), false);         // 꺼져 있으면 다시 안 뜬다
  S.settings.alarmOn = true; applyAlarmOn();                          // 켤 때는 아무것도 닫지 않는다
});

/* 점검 라운드 5(라운드 4 의심 3): 알림창이 떠 있는 동안 업무 목록이 통째로 바뀌면(JSON 복원) [확인]이 옛 객체에 적혀, 20초 뒤 같은 알림이
   다시 울렸다. 실제 순서 — [백업에서 복원]의 파일 고르기 창을 여는 동안 알림이 울려 앱 창에 알림창이 뜨고, 파일을 고른 뒤 확인 창이 그 위에
   떠 복원을 마치면 밑에 남은 알림창의 [확인]이 바뀌기 전 객체를 가리킨다. 이제 [확인]은 번호로 지금 업무·하위 업무를 다시 찾아 적는다. */
test('알림창이 떠 있는 동안 JSON 복원으로 업무 목록이 바뀌어도 [확인]이 먹는다 — 20초 뒤 다시 울리지 않는다', async () => {
  const {initBackup} = await import('../../src/backup.js');
  const {initPresets} = await import('../../src/presets.js');
  initPresets(); initBackup();
  await env.resetS(); S.loaded = true;
  const due = iso(-5), mid = iso(-3), subId = newId();
  const saved = {id:newId(), memo:'회신 기한', f:{due}, subs:[{id:subId, title:'중간 점검', mid, done:false, al:{}}], contacts:[], ids:[], files:[], al:{}};
  S.items.push(mk(JSON.parse(JSON.stringify(saved))));
  let pick; env.onInvoke('import_backup_file', () => new Promise(r => { pick = r; }));   // 파일 고르기 창이 떠 있는 동안
  env.onInvoke('backup_import', () => 2);
  env.onInvoke('save_all', () => ({kind:'Saved', version:3}));
  $('bkImp').click(); await env.flush();
  checkAlarms();                                                       // 그 사이 20초 점검이 울린다
  assert.ok($('alarmBg').classList.contains('on'));
  env.answerConfirm(true);
  pick({kind:'Json', content: JSON.stringify({items:[saved]})});       // 같은 업무가 든 백업 — 새 객체로 바뀐다
  await env.flush(8);
  assert.notEqual(S.items[0], undefined);
  $('alarmOk').click(); await env.flush();
  assert.equal(S.items[0].al.due, true, '지금 업무에 확인이 적힌다');
  assert.equal(S.items[0].subs[0].al.mid, true, '지금 하위 업무에도');
  mock.timers.tick(20000);
  assert.equal($('alarmBg').classList.contains('on'), false, '20초 뒤 다시 울리지 않는다');
  env.onInvoke('import_backup_file', () => ({kind:'Cancelled'}));
  env.onInvoke('backup_import', () => null);
  env.onInvoke('save_all', () => undefined);
});

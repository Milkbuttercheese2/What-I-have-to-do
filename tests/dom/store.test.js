/* STORE 저장 파사드 — F1 게이트 · 단일비행 큐 · load() 핸드오프 */
import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {setupEnv} from '../helpers/env.js';

mock.timers.enable({apis:['setTimeout','setInterval']});
const env = setupEnv();
const {S} = await import('../../src/state.js');
const {STORE} = await import('../../src/store.js');

test('F1 게이트: 로드 전 saveAll은 invoke를 한 번도 부르지 않는다', async () => {
  await env.resetS();                       // loaded=false
  await STORE.saveAll([{id:1}]);
  await env.flush();
  assert.equal(env.invokeCalls.length, 0);
});

test('정상 저장: save_all 1회, items 전달', async () => {
  await env.resetS(); S.loaded = true;
  const items = [{id:1, memo:'a'}];
  await STORE.saveAll(items);
  await STORE._saving;                      // 큐 비행 완료 대기
  const calls = env.invokeCalls.filter(c=>c.cmd==='save_all');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, {items, baseVersion:S.dataVersion});   // v3.3.7 번호표 동반
});

test('단일비행 last-wins: 비행 중 들어온 A,B,C 중 실제 저장은 [첫번째, 마지막]', async () => {
  await env.resetS(); S.loaded = true;
  const gates = [];
  env.onInvoke('save_all', () => new Promise(r => gates.push(r)));
  const A=[{id:1}], B=[{id:2}], C=[{id:3}];
  STORE.saveAll(A);                         // 비행 시작
  STORE.saveAll(B);                         // pending에 덮임
  STORE.saveAll(C);                         // B를 덮음 → last-wins
  const p = STORE._saving;
  // 첫 비행 해제 → 루프가 C로 두 번째 invoke를 만들므로 gate가 다시 생긴다.
  // 새 gate가 생길 때마다 해제하며 큐가 마를 때까지 반복.
  for(let i=0; i<10 && STORE._saving; i++){
    while(gates.length) gates.shift()();
    await env.flush();
  }
  await p;
  const saved = env.invokeCalls.filter(c=>c.cmd==='save_all').map(c=>c.args.items);
  assert.deepEqual(saved, [A, C]);
});

test('저장 실패: _saving 복구 → 다음 저장 정상', async () => {
  await env.resetS(); S.loaded = true;
  env.onInvoke('save_all', () => { throw new Error('disk'); });
  await STORE.saveAll([{id:1}]);
  await STORE._saving; await env.flush();
  assert.equal(STORE._saving, null);
  // 회복 확인
  env.onInvoke('save_all', () => undefined);
  await STORE.saveAll([{id:2}]);
  await STORE._saving;
  assert.equal(env.invokeCalls.filter(c=>c.cmd==='save_all').length, 2);
});

test('load(): S.imported 4종을 채우고 items 반환, 비배열 items는 []', async () => {
  await env.resetS();
  const state = {
    items:[{id:9}], fields:[{key:'received'}], presets:[{id:'p1'}],
    idKinds:['계약번호'], settings:{alarmOn:false},
  };
  env.onInvoke('load_all', () => state);
  const items = await STORE.load();
  assert.deepEqual(items, state.items);
  assert.equal(S.imported.fields, state.fields);
  assert.equal(S.imported.presets, state.presets);
  assert.equal(S.imported.idKinds, state.idKinds);
  assert.equal(S.imported.settings, state.settings);

  env.onInvoke('load_all', () => ({items:'nope'}));
  assert.deepEqual(await STORE.load(), []);
});

test('save*: F1 게이트 공유 + 호출 형태', async () => {
  await env.resetS();                       // loaded=false → 전부 차단
  STORE.saveFields([1]); STORE.savePresets([2]); STORE.saveIdKinds([3]); STORE.saveSettings({a:1});
  await env.flush();
  assert.equal(env.invokeCalls.length, 0);
  S.loaded = true;
  STORE.saveFields([1]); STORE.savePresets([2]); STORE.saveIdKinds([3]); STORE.saveSettings({a:1});
  await env.flush();
  assert.deepEqual(env.invokeCalls.map(c=>c.cmd),
    ['save_fields','save_presets','save_id_kinds','save_settings']);
  assert.deepEqual(env.invokeCalls[2].args, {idKinds:[3]});
});

/* ── v3.3.4 저장 실패 복구 ──────────────────────────────────────────────
   예전엔 실패한 배치를 버렸다(_pending 을 비운 뒤 invoke, catch 는 경고만).
   화면엔 변경이 남으니 사용자는 저장된 줄 알고 계속 일하다 앱을 닫았고,
   그 사이 작업분이 통째로 사라졌다. */

test('실패한 배치를 버리지 않고 대기열에 되돌린 뒤 재시도해서 결국 저장한다', async () => {
  await env.resetS(); S.loaded = true;
  let fail = true;
  env.onInvoke('save_all', () => { if(fail) throw new Error('lock'); });
  const items = [{id:1, memo:'잠긴 동안 친 내용'}];
  await STORE.saveAll(items);
  await env.flush();
  assert.equal(STORE._pending, items, '실패한 배치가 대기열에 남아 있어야 함');
  assert.ok(env.document.getElementById('saveAlert').classList.contains('on'), '실패는 눈에 보이게');

  fail = false;
  mock.timers.tick(1000);                       // 첫 재시도(1초)
  await STORE._saving; await env.flush();
  const calls = env.invokeCalls.filter(c=>c.cmd==='save_all');
  assert.equal(calls.length, 2, '재시도로 두 번째 저장이 일어나야 함');
  assert.deepEqual(calls[1].args.items, items);
  assert.equal(STORE._pending, null, '성공하면 대기열이 비어야 함');
  assert.equal(env.document.getElementById('saveAlert').classList.contains('on'), false);
});

test('재시도 대기 중 더 새 배치가 오면 그쪽만 저장한다 (전체 교체 저장이므로)', async () => {
  await env.resetS(); S.loaded = true;
  let fail = true;
  env.onInvoke('save_all', () => { if(fail) throw new Error('lock'); });
  await STORE.saveAll([{id:1}]);
  await env.flush();
  fail = false;
  const newer = [{id:1},{id:2}];
  await STORE.saveAll(newer);                   // 실패분을 포함하는 최신 스냅샷
  await STORE._saving; await env.flush();
  const saved = env.invokeCalls.filter(c=>c.cmd==='save_all').map(c=>c.args.items);
  assert.deepEqual(saved[saved.length-1], newer);
  assert.equal(STORE._pending, null);
  mock.timers.tick(60000);                      // 남은 재시도 타이머가 있어도 헛돌지 않아야
  await env.flush();
  assert.equal(env.invokeCalls.filter(c=>c.cmd==='save_all').length, saved.length);
});

test('flush(): 대기 중인 것을 즉시 밀어 넣고 전부 기록됐는지 알려준다 (종료 경로)', async () => {
  await env.resetS(); S.loaded = true;
  let fail = true;
  env.onInvoke('save_all', () => { if(fail) throw new Error('lock'); });
  await STORE.saveAll([{id:7}]);
  await env.flush();
  assert.equal(await STORE.flush(), false, '아직 못 썼으면 false');

  fail = false;
  assert.equal(await STORE.flush(), true, '기록에 성공하면 true');
  assert.equal(STORE._pending, null);
});

test('연속 실패가 이어지면 DB 를 건너뛰고 비상 덤프를 남긴다', async () => {
  await env.resetS(); S.loaded = true;
  env.onInvoke('save_all', () => { throw new Error('lock'); });
  env.onInvoke('emergency_dump', () => 'C:/데이터/emergency/wmhh_emergency_20260802_120000.json');
  S.items = [{id:1, memo:'지켜야 할 내용'}];
  await STORE.saveAll(S.items);
  await env.flush();
  assert.equal(env.invokeCalls.filter(c=>c.cmd==='emergency_dump').length, 0, '1회 실패로는 덤프하지 않는다');

  mock.timers.tick(1000); await STORE._saving; await env.flush();   // 2회
  mock.timers.tick(2000); await STORE._saving; await env.flush();   // 3회 → 덤프
  const dumps = env.invokeCalls.filter(c=>c.cmd==='emergency_dump');
  assert.equal(dumps.length, 1);
  const payload = JSON.parse(dumps[0].args.json);
  assert.equal(payload.v, 5, '평범한 JSON 백업과 같은 형태여야 [불러오기]로 복원된다');
  assert.deepEqual(payload.items, S.items);
  assert.equal(payload.settings.captureDraft, '', '임시 상태는 백업 왕복 계약대로 제외');
  assert.match(env.document.getElementById('saveAlertDump').textContent, /emergency/);

  // 뒷정리: 성공시켜 재시도 타이머·실패 카운터를 되돌린다
  env.onInvoke('save_all', () => undefined);
  await STORE.flush();
  assert.equal(env.document.getElementById('saveAlert').classList.contains('on'), false);
});

/* ── v3.3.7 번호표: 낡은 화면이 최신 데이터를 덮지 못하게 ──────────────────
   실제 사고: 7월 21일 상태를 들고 있던 화면이 오늘 저장을 하자, 저장이 전체
   교체라 그 뒤에 쌓인 업무가 통째로 사라졌다(07-23·08-02 두 차례). */

test('load(): 번호표를 받아 S.dataVersion 에 담는다', async () => {
  await env.resetS();
  env.onInvoke('load_all', () => ({items:[], dataVersion:42}));
  await STORE.load();
  assert.equal(S.dataVersion, 42);
});

test('저장 성공: Rust 가 준 새 번호로 갱신한다 (안 하면 다음 저장부터 전부 거절된다)', async () => {
  await env.resetS(); S.loaded = true; S.dataVersion = 7;
  env.onInvoke('save_all', () => ({kind:'Saved', version:8}));
  await STORE.saveAll([{id:1}]);
  await STORE._saving;
  assert.equal(S.dataVersion, 8);
  assert.equal(env.invokeCalls.find(c=>c.cmd==='save_all').args.baseVersion, 7);
});

test('거절(Stale): 재시도하지 않고, 화면 내용을 파일로 남긴다', async () => {
  await env.resetS(); S.loaded = true; S.dataVersion = 3;
  S.items = [{id:1, memo:'낡은 화면의 내용'}];
  env.onInvoke('save_all', () => ({kind:'Stale', expected:3, current:99}));
  env.onInvoke('emergency_dump', () => 'C:/데이터/emergency/wmhh_emergency_x.json');
  // jsdom 의 location.reload 는 교체가 막혀 있어(non-configurable) 관측하지 않는다.
  // 여기서 검증할 것은 '아무것도 잃지 않고, 낡은 내용을 다시 밀지 않는다' 세 가지다.

  await STORE.saveAll(S.items);
  await STORE._saving; await env.flush(); await env.flush();

  const dumps = env.invokeCalls.filter(c=>c.cmd==='emergency_dump');
  assert.equal(dumps.length, 1, '거절당한 화면 내용은 파일로 남아야 한다');
  assert.deepEqual(JSON.parse(dumps[0].args.json).items, S.items);
  assert.equal(STORE._pending, null, '거절은 재시도 대상이 아니다 — 같은 낡은 내용을 다시 밀면 안 된다');
  assert.equal(env.invokeCalls.filter(c=>c.cmd==='save_all').length, 1, '거절 뒤 재시도 저장이 없어야 한다');
  assert.equal(env.document.getElementById('saveAlert').classList.contains('on'), false,
    '거절은 저장 실패가 아니므로 실패 배너를 켜지 않는다');
});

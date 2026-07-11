/* 반복 일정 도메인 — nextRecurDate · advanceRecur · toggleDone 이월 분기 */
import {test} from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};
const {makeItem, toggleDone, nextRecurDate, advanceRecur} = await import('../../src/state.js');

const DAY = 86400000;
// 로컬 구성자로 만들어 getDay()가 로컬 기준으로 일관되게 나오도록
const isoLocal = (y,mo,d,hh=9,mm=0) => new Date(y,mo,d,hh,mm,0,0).toISOString();

test('nextRecurDate: 매일 = +1일, 시:분 보존', () => {
  const a = isoLocal(2026,6,10,18,30);            // 2026-07-10 18:30 로컬
  const n = nextRecurDate(a, {freq:'daily'});
  assert.equal(new Date(n) - new Date(a), DAY);
  assert.equal(new Date(n).getHours(), 18);
  assert.equal(new Date(n).getMinutes(), 30);
});

test('nextRecurDate: 매주 요일 미지정 = +7일', () => {
  const a = isoLocal(2026,6,10);
  assert.equal(new Date(nextRecurDate(a, {freq:'weekly'})) - new Date(a), 7*DAY);
});

test('nextRecurDate: 매주 요일 지정 = 다음 해당 요일 (1~7일 이내)', () => {
  const a = isoLocal(2026,6,6);                    // 임의 앵커
  for(const target of [0,1,2,3,4,5,6]){
    const n = new Date(nextRecurDate(a, {freq:'weekly', dow:[target]}));
    assert.equal(n.getDay(), target);
    const gap = (n - new Date(a)) / DAY;
    assert.ok(gap >= 1 && gap <= 7, `gap ${gap} 벗어남 (target ${target})`);
  }
});

test('nextRecurDate: 매월 = 다음 달 같은 일, 짧은 달 클램프(1/31→2/28)', () => {
  const a = isoLocal(2026,0,31,9,0);              // 2026-01-31
  const n = new Date(nextRecurDate(a, {freq:'monthly'}));
  assert.equal(n.getMonth(), 1);                   // 2월(0-index)
  assert.equal(n.getDate(), 28);                   // 2026는 평년
  assert.equal(n.getHours(), 9);
});

test('nextRecurDate: recur 없음/손상 ISO는 원본 그대로', () => {
  const a = isoLocal(2026,6,10);
  assert.equal(nextRecurDate(a, null), a);
  assert.equal(nextRecurDate('깨진값', {freq:'daily'}), '깨진값');
});

test('advanceRecur: 마감 전진 + 세부 mid 동일 delta 이동 + 세부/알람 리셋', () => {
  const due = isoLocal(2026,6,10,18,0);
  const mid = isoLocal(2026,6,9,10,0);            // 마감보다 하루 전 점검
  const it = makeItem({
    recur:{freq:'daily'}, f:{due}, al:{due:true},
    subs:[{id:1, title:'점검', mid, done:true, al:{mid:true}}],
  });
  advanceRecur(it);
  const nd = new Date(it.f.due), od = new Date(due);
  assert.equal(nd - od, DAY);                       // 마감 +1일
  assert.equal(new Date(it.subs[0].mid) - new Date(mid), DAY);  // 세부도 같은 만큼 이동
  assert.equal(it.subs[0].done, false);            // 세부 완료 리셋
  assert.deepEqual(it.subs[0].al, {});             // 세부 알람 리셋
  assert.ok(!('due' in it.al));                    // 마감 알람 재무장
  assert.equal(it.done, false);
});

test('advanceRecur: 앵커(f.due) 없으면 no-op', () => {
  const it = makeItem({recur:{freq:'daily'}, f:{}});
  const before = JSON.stringify(it);
  advanceRecur(it);
  assert.equal(JSON.stringify(it), before);
});

test('toggleDone: 반복+마감이면 완료 대신 다음 회차로 이월', () => {
  const due = isoLocal(2026,6,10,18,0);
  const it = makeItem({recur:{freq:'daily'}, f:{due}});
  toggleDone(it);
  assert.equal(it.done, false);                    // 완료되지 않음
  assert.equal(new Date(it.f.due) - new Date(due), DAY);  // 다음 회차로
});

test('toggleDone: 반복이라도 마감 없으면 일반 완료', () => {
  const it = makeItem({recur:{freq:'daily'}, f:{}});
  toggleDone(it);
  assert.equal(it.done, true);
  assert.equal(typeof it.doneAt, 'number');
});

test('toggleDone: 반복 아니면 기존대로 토글', () => {
  const it = makeItem({f:{due:isoLocal(2026,6,10)}});
  toggleDone(it);
  assert.equal(it.done, true);
  toggleDone(it);
  assert.equal(it.done, false);
  assert.equal(it.doneAt, null);
});

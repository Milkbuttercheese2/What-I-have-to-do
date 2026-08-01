/* merge — 메모 합치기 순수 병합 규칙 (v2.8.0) */
import {test} from 'node:test';
import assert from 'node:assert/strict';

const {mergeItems} = await import('../../src/merge.js');

const base = (o={}) => Object.assign(
  {id:1, memo:'', owner:'', done:false, doneAt:null, staged:false, f:{}, contacts:[], ids:[], subs:[], files:[], al:{}, recur:null, recurId:null}, o);

test('id·알람·담당은 받는 쪽 유지, 메모는 이어붙임', () => {
  const t=base({id:10, memo:'먼저 적은 건', owner:'박주무관', al:{due:true}});
  const s=base({id:20, memo:'나중에 또 온 전화', owner:'딴사람'});
  const m=mergeItems(t,s);
  assert.equal(m.id, 10);
  assert.equal(m.owner, '박주무관');
  assert.equal(m.memo, '먼저 적은 건\n\n나중에 또 온 전화');
  assert.deepEqual(m.al, {due:true});                     // 마감 변화 없음 → 알람 유지
  // 원본 불변 (순수 함수)
  assert.equal(t.memo, '먼저 적은 건');
  assert.equal(s.memo, '나중에 또 온 전화');
});

test('접수·마감은 이른 쪽 — 마감이 바뀌면 알람 재무장(F2)', () => {
  const t=base({f:{received:'2026-07-02T09:00:00.000Z', due:'2026-07-10T18:00:00.000Z'}, al:{due:true}});
  const s=base({id:2, f:{received:'2026-07-01T09:00:00.000Z', due:'2026-07-05T18:00:00.000Z'}});
  const m=mergeItems(t,s);
  assert.equal(m.f.received, '2026-07-01T09:00:00.000Z');
  assert.equal(m.f.due, '2026-07-05T18:00:00.000Z');      // 이른 마감이 이김
  assert.equal(m.al.due, undefined);                       // 마감이 바뀌었으니 재무장
});

test('한쪽만 시각이 있으면 그쪽, 손상 ISO 는 무시(F7 계열)', () => {
  const t=base({f:{received:'', due:'깨진값'}});
  const s=base({id:2, f:{received:'2026-07-01T09:00:00.000Z', due:'2026-07-05T18:00:00.000Z'}});
  const m=mergeItems(t,s);
  assert.equal(m.f.received, '2026-07-01T09:00:00.000Z');
  assert.equal(m.f.due, '2026-07-05T18:00:00.000Z');
  // 마감이 빈 값('깨진값'→유효값)으로 바뀐 셈 — 재무장 대상
  assert.equal(m.al.due, undefined);
});

test('커스텀 필드: 받는 쪽 우선, 빈 칸만 끌려온 쪽으로 보충', () => {
  const t=base({f:{custom1:'받는 쪽 값', custom2:''}});
  const s=base({id:2, f:{custom1:'끌려온 값', custom2:'보충값', custom3:'새 키'}});
  const m=mergeItems(t,s);
  assert.equal(m.f.custom1, '받는 쪽 값');
  assert.equal(m.f.custom2, '보충값');
  assert.equal(m.f.custom3, '새 키');
});

test('세부할일: 합쳐서 점검시각 오름차순, 시각 없는 것은 뒤 (원래 순서 유지)', () => {
  const t=base({subs:[
    {id:1, title:'받는-늦음', mid:'2026-07-05T10:00:00.000Z', done:false, al:{}},
    {id:2, title:'받는-무시각', mid:'', done:false, al:{}},
  ]});
  const s=base({id:2, subs:[
    {id:3, title:'끌려온-이름', mid:'2026-07-01T10:00:00.000Z', done:true, al:{mid:true}},
    {id:4, title:'끌려온-무시각', mid:'', done:false, al:{}},
  ]});
  const m=mergeItems(t,s);
  assert.deepEqual(m.subs.map(x=>x.title), ['끌려온-이름','받는-늦음','받는-무시각','끌려온-무시각']);
  assert.equal(m.subs[0].al.mid, true);                    // 세부 알람 상태·id 보존
  assert.equal(m.subs[0].id, 3);
});

test('관련인·식별정보·파일: 이어붙임 + 중복 제거 (전화는 숫자만 비교)', () => {
  const t=base({
    contacts:[{who:'김철수', org:'행정과', phone:'010-1234-5678'}],
    ids:[{kind:'SR번호', val:'SR-1'}],
    files:['C:\\a.hwp']});
  const s=base({id:2,
    contacts:[{who:'김철수', org:'행정과', phone:'01012345678'}, {who:'이영희', org:'', phone:''}],
    ids:[{kind:'SR번호', val:'SR-1'}, {kind:'SR번호', val:'SR-2'}],
    files:['C:\\a.hwp', 'C:\\b.xlsx']});
  const m=mergeItems(t,s);
  assert.deepEqual(m.contacts.map(c=>c.who), ['김철수','이영희']);
  assert.deepEqual(m.ids.map(x=>x.val), ['SR-1','SR-2']);
  assert.deepEqual(m.files, ['C:\\a.hwp','C:\\b.xlsx']);
});

test('분류 상태: 어느 한쪽이라도 분류를 마쳤으면 분류 대기로 안 돌아간다', () => {
  assert.equal(mergeItems(base({staged:true}), base({id:2, staged:true})).staged, true);
  assert.equal(mergeItems(base({staged:false}), base({id:2, staged:true})).staged, false);
  assert.equal(mergeItems(base({staged:true}), base({id:2, staged:false})).staged, false);
});

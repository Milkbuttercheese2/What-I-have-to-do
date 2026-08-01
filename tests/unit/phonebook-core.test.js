/* phonebook-core — 전화번호부 순수 로직 (v2.7.0):
   중복 판정 · 아이템에서 모으기 · 검색 · @ 토큰 · 삽입 · 엑셀 행 매핑 */
import {test} from 'node:test';
import assert from 'node:assert/strict';

const {phoneDigits, normEntry, entryKey, gatherFromItems, matchEntries, entryLabel, atToken, applyInsert, mapSheetRows}
  = await import('../../src/phonebook-core.js');

test('entryKey: 전화 표기 차이(하이픈·공백)는 같은 사람으로 판정', () => {
  assert.equal(
    entryKey({who:'김철수', org:'행정과', phone:'010-1234-5678'}),
    entryKey({who:'김철수', org:'행정과', phone:'010 1234 5678'}));
  assert.notEqual(
    entryKey({who:'김철수', org:'행정과', phone:'010-1234-5678'}),
    entryKey({who:'김철수', org:'세무과', phone:'010-1234-5678'}));
});

test('gatherFromItems: 아이템 관련인 중 전화번호부에 없는 것만, 자기들끼리도 중복 제거', () => {
  const items=[
    {contacts:[{who:'김철수', org:'행정과', phone:'010-1234-5678'}, {who:'이영희', org:'', phone:''}]},
    {contacts:[{who:'김철수', org:'행정과', phone:'01012345678'}]},   // 표기만 다른 중복
    {contacts:[{who:'', org:'', phone:''}]},                          // 빈 껍데기
    {},                                                               // contacts 없음
  ];
  const existing=[{id:1, who:'이영희', org:'', phone:''}];
  const found=gatherFromItems(items, existing);
  assert.equal(found.length, 1);
  assert.equal(found[0].who, '김철수');
  assert.equal(found[0].id, undefined);       // id 는 호출부(newId)가 채운다
});

test('matchEntries: 이름·소속·전화(숫자만 버전)로 부분일치, 빈 검색어는 빈 목록', () => {
  const list=[
    {who:'김철수', org:'○○세무서', phone:'010-1234-5678'},
    {who:'이영희', org:'행정과', phone:'02-123-4567'},
  ];
  assert.equal(matchEntries(list,'철수').length, 1);
  assert.equal(matchEntries(list,'세무').length, 1);
  assert.equal(matchEntries(list,'01012345678')[0].who, '김철수');
  assert.equal(matchEntries(list,'').length, 0);       // @ 뒤 한 글자부터 검색
  assert.equal(matchEntries(list,'행정',8)[0].who, '이영희');
});

test('entryLabel: 있는 필드만으로 자연스러운 삽입 문자열', () => {
  assert.equal(entryLabel({who:'김철수', org:'행정과', phone:'010-1'}), '김철수(행정과 010-1)');
  assert.equal(entryLabel({who:'김철수', org:'', phone:''}), '김철수');
  assert.equal(entryLabel({who:'', org:'행정과', phone:'010-1'}), '행정과(010-1)');
  assert.equal(entryLabel({who:'', org:'', phone:'010-1'}), '010-1');
});

test('atToken: 줄 시작·공백 뒤 @만 트리거, 이메일 한가운데 @ 는 무시', () => {
  assert.deepEqual(atToken('@김철', 3), {start:0, query:'김철'});
  assert.deepEqual(atToken('전화 @세무', 6), {start:3, query:'세무'});
  assert.equal(atToken('a@b.com', 3), null);            // 이메일꼴
  assert.equal(atToken('그냥 텍스트', 6), null);
  assert.deepEqual(atToken('메모 @', 4), {start:3, query:''});   // 맨 @ — query 빈 문자열
});

test('applyInsert: @토큰을 라벨로 치환하고 커서를 라벨 끝으로', () => {
  const r=applyInsert('민원 @김철 회신', 6, 3, '김철수(행정과)');
  assert.equal(r.text, '민원 김철수(행정과) 회신');
  assert.equal(r.caret, 3+'김철수(행정과)'.length);
});

test('mapSheetRows: 헤더 자동 인식 + 행 매핑 + 중복 제거, 헤더 없으면 null', () => {
  const rows=[
    ['연락처 목록',''],                                   // 제목 줄 (헤더 아님)
    ['소속','성명','전화번호'],
    ['행정과','김철수','010-1234-5678'],
    ['행정과','김철수','01012345678'],                    // 표기만 다른 중복
    ['','',''],                                          // 빈 줄
    ['세무과','이영희',''],
  ];
  const m=mapSheetRows(rows);
  assert.ok(m);
  assert.equal(m.entries.length, 2);
  assert.deepEqual(m.entries[0], {who:'김철수', org:'행정과', phone:'010-1234-5678'});
  assert.equal(m.entries[1].who, '이영희');
  assert.equal(mapSheetRows([['가','나','다'],['1','2','3']]), null);   // 헤더 인식 실패
});

test('normEntry/phoneDigits: 문자열 강제·trim·숫자 추출', () => {
  assert.deepEqual(normEntry({who:' 김철수 ', org:null, phone:1234}), {id:undefined, who:'김철수', org:'', phone:'1234'});
  assert.equal(phoneDigits('010-12 34'), '0101234');
  assert.equal(phoneDigits(null), '');
});

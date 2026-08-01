/* phonebook-core — 전화번호부 순수 로직 (v2.7.0):
   중복 판정 · 아이템에서 모으기 · 검색 · @ 토큰 · 삽입 · 엑셀 행 매핑 */
import {test} from 'node:test';
import assert from 'node:assert/strict';

const {phoneDigits, normEntry, entryKey, isComplete, gatherFromItems, matchEntries, entryLabel, tagText, linkifyAt, relatedItems, atToken, applyInsert, mapSheetRows, extractTags, entriesForTag, absorbContacts}
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

test('tagText: 이름 → 소속 → 번호 순으로 @태그 텍스트', () => {
  assert.equal(tagText({who:'김철수', org:'행정과', phone:'010-1'}), '@김철수');
  assert.equal(tagText({who:'', org:'행정과', phone:'010-1'}), '@행정과');
  assert.equal(tagText({who:'', org:'', phone:'010-1'}), '@010-1');
});

test('linkifyAt(book): 전화번호부 실존 관련인 태그만 감싼다 — 부분 삭제 시 태그 해제 (v2.11.0)', () => {
  const book=[{id:1, who:'우성균', org:'행정과', phone:'010-1'}];
  assert.equal(linkifyAt('회신 @우성균 건', book),
    '회신 <span class="at-tag" data-at="우성균">@우성균</span> 건');
  // '균' 한 글자만 지워도 실존 관련인이 아니므로 평문 — 태그 삭제 (소유자 지정)
  assert.equal(linkifyAt('회신 @우성 건', book), '회신 @우성 건');
  // book 을 안 주면(구 시그니처) 전부 감싼다 — 하위 호환
  assert.ok(linkifyAt('회신 @우성 건').includes('at-tag'));
});

test('linkifyAt: @태그를 span 으로, 괄호 정보·꼬리 문장부호는 태그 밖으로', () => {
  assert.equal(linkifyAt('민원 @김철수 회신'),
    '민원 <span class="at-tag" data-at="김철수">@김철수</span> 회신');
  // 바로 입력 형식: '(' 앞까지만 태그
  assert.equal(linkifyAt('@김철수(행정과 010-1)'),
    '<span class="at-tag" data-at="김철수">@김철수</span>(행정과 010-1)');
  // 꼬리 쉼표는 태그 밖
  assert.equal(linkifyAt('@김철수, 확인'),
    '<span class="at-tag" data-at="김철수">@김철수</span>, 확인');
  // 이메일 한가운데 @ 는 그대로
  assert.equal(linkifyAt('a@b.com'), 'a@b.com');
  // esc() 를 거친 엔티티는 태그로 이어지지 않는다 (& 제외 문자 집합)
  assert.equal(linkifyAt('@김&quot;철'), '<span class="at-tag" data-at="김">@김</span>&quot;철');
});

test('relatedItems(strict, v3.0.2): 관련인 3칸 완전 일치 OR 메모의 정확한 @태그만', () => {
  const entry={id:1, who:'김철수', org:'행정과', phone:'010-1234-5678'};
  const items=[
    {id:1, memo:'', contacts:[{who:'김철수', org:'행정과', phone:'010 1234 5678'}], done:false}, // 3칸 일치(번호 표기만 다름) ✓
    {id:2, memo:'', contacts:[{who:'김철수', org:'', phone:''}], done:false},                    // 이름만 — 제외 (소유자 지정)
    {id:3, memo:'통화 @김철수 건', contacts:[], done:true},                                       // 정확한 태그 ✓
    {id:4, memo:'김철수 언급만(태그 아님)', contacts:[], done:false},                             // 평문 언급 — 제외
    {id:5, memo:'@김철 부분 태그', contacts:[], done:false},                                      // 다른 태그 — 제외
    {id:6, memo:'', contacts:[{who:'김철수', org:'세무과', phone:'010-1234-5678'}], done:false}, // 소속 다름 — 제외
    {id:7, memo:'@김철수 주기', contacts:[], done:false, recur:{type:'dow'}},                     // 주기 부모 — 제외
  ];
  const hits=relatedItems(items, {name:'김철수', entries:[entry]}).map(it=>it.id);
  assert.deepEqual(hits, [1,3]);                 // 미완료 먼저(1) → 완료(3)
  // 구버전 번호만 항목: 세 칸('','',digits)이 그대로 일치하는 관련인만 걸린다
  const phoneOnly={id:9, who:'', org:'', phone:'010-9999-8888'};
  const items2=[{id:10, memo:'', contacts:[{who:'', org:'', phone:'01099998888'}], done:false},
                {id:11, memo:'', contacts:[{who:'박', org:'', phone:'010-9999-8888'}], done:false}];
  assert.deepEqual(relatedItems(items2, {name:'010-9999-8888', entries:[phoneOnly]}).map(i=>i.id), [10]);
});

test('isComplete: 소속·이름·연락처(숫자 있는) 3칸 완비 판정 (v2.9.0 무결성 규칙)', () => {
  assert.equal(isComplete({who:'김철수', org:'행정과', phone:'010-1'}), true);
  assert.equal(isComplete({who:'김철수', org:'', phone:'010-1'}), false);
  assert.equal(isComplete({who:'', org:'행정과', phone:'010-1'}), false);
  assert.equal(isComplete({who:'김철수', org:'행정과', phone:'없음'}), false);   // 숫자 없는 연락처
});

test('extractTags: 메모 원문에서 @태그 이름들 (중복 제거·괄호 앞까지·꼬리 문장부호 제거)', () => {
  assert.deepEqual(extractTags('통화 @김철수 회신 @김철수, 그리고 @이영희(세무과)'), ['김철수','이영희']);
  assert.deepEqual(extractTags('a@b.com 은 태그 아님'), []);
  assert.deepEqual(extractTags(''), []);
});

test('entriesForTag: 이름 일치 / 이름 없는 항목의 소속 일치 / 번호꼴 태그의 번호 일치', () => {
  const book=[
    {id:1, who:'김철수', org:'행정과', phone:'010-1'},
    {id:2, who:'', org:'행정과', phone:'02-1234-5678'},          // 구버전 소속만 항목
    {id:3, who:'', org:'', phone:'010-9999-8888'},               // 구버전 번호만 항목
  ];
  assert.deepEqual(entriesForTag(book, '김철수').map(e=>e.id), [1]);
  assert.deepEqual(entriesForTag(book, '행정과').map(e=>e.id), [2]);   // 이름 있는 1번은 소속으로 안 걸림
  assert.deepEqual(entriesForTag(book, '01099998888').map(e=>e.id), [3]);
  assert.deepEqual(entriesForTag(book, '없는사람'), []);
});

test('absorbContacts: 3칸 완비만 흡수, 완전 중복 건너뜀, 빈 번호는 보강, 다른 번호는 새 항목', () => {
  const book=[
    {id:1, who:'김철수', org:'행정과', phone:'010-1'},
    {id:2, who:'이영희', org:'세무과', phone:''},
  ];
  const {added, updates}=absorbContacts(book, [
    {who:'김철수', org:'행정과', phone:'010-1'},        // 완전 중복 → 건너뜀
    {who:'이영희', org:'세무과', phone:'010-2'},        // 기존 번호 없음 → 보강
    {who:'김철수', org:'행정과', phone:'010-3'},        // 같은 사람 다른 번호 → 새 항목
    {who:'박이름만', org:'', phone:''},                 // 불완전 → 제외
    {who:'', org:'', phone:''},
  ]);
  assert.deepEqual(updates, [{id:2, phone:'010-2'}]);
  assert.deepEqual(added, [{who:'김철수', org:'행정과', phone:'010-3'}]);
});

test('queryReady: 이름 2글자·번호 3자리 문턱값, 010 은 열지 않음 (v2.10.0)', async () => {
  const {queryReady} = await import('../../src/phonebook-core.js');
  assert.equal(queryReady('김'), false);          // 이름 1글자 — 닫힘
  assert.equal(queryReady('김철'), true);         // 2글자부터
  assert.equal(queryReady('01'), false);
  assert.equal(queryReady('010'), false);         // 모든 휴대전화 공통 접두 — 소음 방지
  assert.equal(queryReady('010-'), false);        // 하이픈 붙어도 숫자는 010
  assert.equal(queryReady('0102'), true);
  assert.equal(queryReady('295'), true);          // 국번 등 3자리부터
  assert.equal(queryReady(''), false);
});

test('normEntry/phoneDigits: 문자열 강제·trim·숫자 추출', () => {
  assert.deepEqual(normEntry({who:' 김철수 ', org:null, phone:1234}), {id:undefined, who:'김철수', org:'', phone:'1234'});
  assert.equal(phoneDigits('010-12 34'), '0101234');
  assert.equal(phoneDigits(null), '');
});

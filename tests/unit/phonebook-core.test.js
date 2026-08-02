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
  assert.deepEqual(m.entries[0], {who:'김철수', org:'행정과', phone:'010-1234-5678', email:''});
  assert.equal(m.entries[1].who, '이영희');
  assert.equal(mapSheetRows([['가','나','다'],['1','2','3']]), null);   // 헤더 인식 실패
});

test('tagText: 이름 → 소속 → 번호 순으로 @태그 텍스트', () => {
  assert.equal(tagText({who:'김철수', org:'행정과', phone:'010-1'}), '@김철수');
  assert.equal(tagText({who:'', org:'행정과', phone:'010-1'}), '@행정과');
  assert.equal(tagText({who:'', org:'', phone:'010-1'}), '@010-1');
});

test('linkifyAt(book): 전화번호부 실존 관련인 태그만 감싼다 — 부분 삭제 시 태그 해제 (v2.11.0)', () => {
  const book=[{id:1, who:'홍길동', org:'행정과', phone:'010-1'}];
  assert.equal(linkifyAt('회신 @홍길동 건', book),
    '회신 <span class="at-tag" data-at="홍길동">@홍길동</span> 건');
  // '균' 한 글자만 지워도 실존 관련인이 아니므로 평문 — 태그 삭제 (소유자 지정)
  assert.equal(linkifyAt('회신 @홍길 건', book), '회신 @홍길 건');
  // book 을 안 주면(구 시그니처) 전부 감싼다 — 하위 호환
  assert.ok(linkifyAt('회신 @홍길 건').includes('at-tag'));
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

test('relatedItems(v3.1.1): 전화번호부 3칸(관련소속·관련인·연락처) 완전 일치만 — 메모 @태그 경로 폐지', () => {
  const entry={id:1, who:'김철수', org:'행정과', phone:'010-1234-5678'};
  const items=[
    {id:1, memo:'', contacts:[{who:'김철수', org:'행정과', phone:'010 1234 5678'}], done:false}, // 3칸 일치(번호 표기만 다름) ✓
    {id:2, memo:'', contacts:[{who:'김철수', org:'', phone:''}], done:false},                    // 이름만 — 제외 (소유자 지정)
    {id:3, memo:'통화 @김철수 건', contacts:[], done:true},                                       // 태그만 — v3.1.1 제외
    {id:4, memo:'김철수 언급만(태그 아님)', contacts:[], done:false},                             // 평문 언급 — 제외
    {id:5, memo:'@김철 부분 태그', contacts:[], done:false},                                      // 다른 태그 — 제외
    {id:6, memo:'', contacts:[{who:'김철수', org:'세무과', phone:'010-1234-5678'}], done:false}, // 소속 다름 — 제외
    {id:7, memo:'@김철수 주기', contacts:[{who:'김철수', org:'행정과', phone:'010-1234-5678'}], done:false, recur:{type:'dow'}},  // 주기 부모 — 제외
    {id:8, memo:'@김철수 태그 + 관련인까지', contacts:[{who:'김철수', org:'행정과', phone:'01012345678'}], done:true},            // 3칸 일치 ✓(완료)
  ];
  const hits=relatedItems(items, {entries:[entry]}).map(it=>it.id);
  assert.deepEqual(hits, [1,8]);                 // 미완료 먼저(1) → 완료(8)
  // 기준이 되는 전화번호부 항목이 없으면 아무것도 엮지 않는다
  assert.deepEqual(relatedItems(items, {entries:[]}), []);
  // 구버전 번호만 항목: 세 칸('','',digits)이 그대로 일치하는 관련인만 걸린다
  const phoneOnly={id:9, who:'', org:'', phone:'010-9999-8888'};
  const items2=[{id:10, memo:'', contacts:[{who:'', org:'', phone:'01099998888'}], done:false},
                {id:11, memo:'', contacts:[{who:'박', org:'', phone:'010-9999-8888'}], done:false}];
  assert.deepEqual(relatedItems(items2, {entries:[phoneOnly]}).map(i=>i.id), [10]);
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
  assert.deepEqual(added, [{who:'김철수', org:'행정과', phone:'010-3', email:''}]);
});

/* ── v3.5.0 이메일(선택) ──────────────────────────────────────────────────
   설계의 핵심 두 줄: ① 이메일은 **고유 식별에 쓰지 않는다**(달라도 같은 사람),
   ② 그래서 같은 사람으로 접힐 때 **빈 칸이면 채우고 있으면 안 건드린다**.
   이 두 규칙이 깨지면 이메일이 조용히 사라지거나 같은 사람이 둘로 갈라진다. */

test('이메일은 고유 식별에 쓰지 않는다 — entryKey·isComplete·relatedItems 모두 무시', () => {
  const a={who:'김철수', org:'행정과', phone:'010-1', email:'a@x.go.kr'};
  const b={who:'김철수', org:'행정과', phone:'010-1', email:'b@y.go.kr'};
  assert.equal(entryKey(a), entryKey(b));                  // 이메일만 달라도 같은 사람
  assert.equal(isComplete({who:'김철수', org:'행정과', phone:'010-1'}), true);   // 이메일 없어도 등록 자격
  assert.equal(isComplete({who:'김철수', org:'행정과', phone:'', email:'a@x.go.kr'}), false);  // 이메일만으론 불가

  // 업무의 관련인 이메일이 전화번호부와 달라도 관련 업무로 걸려야 한다
  const items=[{id:1, contacts:[b]}];
  assert.equal(relatedItems(items, {entries:[a]}).length, 1);
  // 이메일은 삽입 라벨·태그 텍스트에도 안 들어간다
  assert.equal(entryLabel(a), '김철수(행정과 010-1)');
  assert.equal(tagText(a), '@김철수');
});

test('absorbContacts: 이미 있는 사람의 빈 이메일은 보강, 이미 있는 이메일은 안 덮음', () => {
  const book=[
    {id:1, who:'김철수', org:'행정과', phone:'010-1', email:''},          // 이메일 비어 있음
    {id:2, who:'이영희', org:'세무과', phone:'010-2', email:'old@x.go.kr'},// 이미 있음
    {id:3, who:'박민수', org:'감사과', phone:'', email:''},                // 번호도 이메일도 없음
  ];
  const {added, updates}=absorbContacts(book, [
    {who:'김철수', org:'행정과', phone:'010-1', email:'new@x.go.kr'},   // 빈 칸 → 보강
    {who:'이영희', org:'세무과', phone:'010-2', email:'new@y.go.kr'},   // 이미 있음 → 그대로
    {who:'박민수', org:'감사과', phone:'010-3', email:'new@z.go.kr'},   // 번호·이메일 함께 보강
  ]);
  assert.equal(added.length, 0);                                       // 항목은 하나도 안 늘어난다
  const byId=Object.fromEntries(updates.map(u=>[u.id,u]));
  assert.deepEqual(byId[1], {id:1, email:'new@x.go.kr'});
  assert.equal(byId[2], undefined);                                    // 덮어쓰지 않으므로 패치 자체가 없다
  assert.deepEqual(byId[3], {id:3, phone:'010-3', email:'new@z.go.kr'});// 한 항목에 패치는 한 건으로 합친다
});

test('absorbContacts: 반영하지 않은 이메일은 kept 로 보고한다 (조용히 버리지 않는다)', () => {
  /* v3.5.1: 전화번호부는 한 사람당 대표 주소 하나뿐이라 두 번째 주소는 갈 곳이 없다.
     그렇다고 말없이 넘기면 사용자는 자기가 적은 주소가 어디로 갔는지 모른다. */
  const book=[
    {id:1, who:'김철수', org:'행정과', phone:'010-1', email:'old@x.go.kr'},
    {id:2, who:'이영희', org:'세무과', phone:'010-2', email:''},
  ];
  const {kept}=absorbContacts(book, [
    {who:'김철수', org:'행정과', phone:'010-1', email:'new@x.go.kr'},   // 다른 주소 → 보고
    {who:'김철수', org:'행정과', phone:'010-1', email:'new@x.go.kr'},   // 같은 건 두 번째 → 한 번만
    {who:'김철수', org:'행정과', phone:'010-1', email:'old@x.go.kr'},   // 같은 주소 → 보고 없음
    {who:'이영희', org:'세무과', phone:'010-2', email:'lee@y.go.kr'},   // 빈 칸 보강 → 보고 없음
  ]);
  assert.equal(kept.length, 1);
  assert.deepEqual(kept[0], {id:1, who:'김철수', org:'행정과', kept:'old@x.go.kr', ignored:'new@x.go.kr'});
});

test('absorbContacts: 새로 들어오는 사람은 kept 가 비어 있다 (알릴 것이 없다)', () => {
  const {added, kept}=absorbContacts([], [{who:'박민수', org:'감사과', phone:'010-9', email:'park@x.go.kr'}]);
  assert.equal(added.length, 1);
  assert.deepEqual(kept, []);
});

test('absorbContacts: 새 사람은 이메일까지 함께 들어오고, 같은 배치 중복은 이메일을 잃지 않는다', () => {
  const {added}=absorbContacts([], [
    {who:'최수진', org:'기획과', phone:'010-9', email:''},               // 먼저 만난 쪽이 빈 칸
    {who:'최수진', org:'기획과', phone:'010-9', email:'choi@x.go.kr'},   // 나중 것이 이메일을 안다
  ]);
  assert.equal(added.length, 1);
  assert.equal(added[0].email, 'choi@x.go.kr');   // 빈 칸이 뒤의 값을 가리면 안 된다
});

test('gatherFromItems/mapSheetRows: 같은 사람을 접을 때 이메일을 잃지 않는다', () => {
  const items=[
    {contacts:[{who:'김철수', org:'행정과', phone:'010-1234-5678'}]},                     // 이메일 없음
    {contacts:[{who:'김철수', org:'행정과', phone:'01012345678', email:'kim@x.go.kr'}]},  // 표기만 다른 같은 사람
  ];
  const found=gatherFromItems(items, []);
  assert.equal(found.length, 1);
  assert.equal(found[0].email, 'kim@x.go.kr');

  const m=mapSheetRows([
    ['소속','성명','전화번호','이메일'],
    ['행정과','김철수','010-1234-5678',''],
    ['행정과','김철수','01012345678','kim@x.go.kr'],   // 중복 행이 이메일을 갖고 있다
  ]);
  assert.equal(m.entries.length, 1);
  assert.equal(m.entries[0].email, 'kim@x.go.kr');
});

test('mapSheetRows: 이메일 열은 선택 — 없어도 되고, 그것만으론 헤더가 되지 않는다', () => {
  const noEmail=mapSheetRows([['소속','성명','전화번호'],['행정과','김철수','010-1']]);
  assert.equal(noEmail.entries[0].email, '');       // 열이 없으면 빈 값
  assert.equal(noEmail.cols.email, -1);
  // 이메일 열 하나만 있는 시트는 전화번호부로 인식하지 않는다(헤더 점수는 3칸으로만 센다)
  assert.equal(mapSheetRows([['이메일'],['a@x.go.kr']]), null);
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
  assert.deepEqual(normEntry({who:' 김철수 ', org:null, phone:1234}), {id:undefined, who:'김철수', org:'', phone:'1234', email:''});
  assert.equal(normEntry({email:'  Kim@Example.go.kr '}).email, 'Kim@Example.go.kr');   // trim 만 — 대소문자 원문 유지
  assert.equal(phoneDigits('010-12 34'), '0101234');
  assert.equal(phoneDigits(null), '');
});

test('formatPhone: 접두·자리수 규칙으로 표준 하이픈 표기 (v3.2.0 하나의 전화번호 체계)', async () => {
  const {formatPhone} = await import('../../src/phonebook-core.js');
  // 휴대폰 — 어떤 표기든 표준형으로
  assert.equal(formatPhone('01012345678'), '010-1234-5678');
  assert.equal(formatPhone('010 1234 5678'), '010-1234-5678');
  assert.equal(formatPhone('010.1234.5678'), '010-1234-5678');
  assert.equal(formatPhone('0111234567'), '011-123-4567');       // 구형 10자리
  // 서울 / 지역 / 인터넷 / 안심 / 전국대표
  assert.equal(formatPhone('021234567'), '02-123-4567');
  assert.equal(formatPhone('0212345678'), '02-1234-5678');
  assert.equal(formatPhone('(02) 1234-5678'), '02-1234-5678');
  assert.equal(formatPhone('0311234567'), '031-123-4567');
  assert.equal(formatPhone('07012345678'), '070-1234-5678');
  assert.equal(formatPhone('070-4056-1234'), '070-4056-1234');   // 하이픈 입력 070 (소유자 지정 예시)
  assert.equal(formatPhone('070 4056 1234'), '070-4056-1234');
  assert.equal(formatPhone('070-4056-XXXX'), '070-4056-XXXX');   // 마스킹(X) 표기 — 원문 보존
  assert.equal(formatPhone('050412345678'), '0504-1234-5678');
  assert.equal(formatPhone('15881234'), '1588-1234');
  assert.equal(formatPhone('18331234'), '1833-1234');
  // '변수' — 확실치 않으면 원문 유지 (유실 없음)
  assert.equal(formatPhone('02-123-4567 내선302'), '02-123-4567 내선302');
  assert.equal(formatPhone('+82-10-1234-5678'), '+82-10-1234-5678');
  assert.equal(formatPhone('123-4567'), '123-4567');             // 지역번호 없는 국번
  assert.equal(formatPhone('010-1'), '010-1');                   // 자리수 미달
  assert.equal(formatPhone(''), '');
});

test('normEntry/migrate 경로: 기존 저장분 01012345678 도 표준형으로 (v3.2.0)', async () => {
  assert.equal(normEntry({who:'김', org:'과', phone:'01012345678'}).phone, '010-1234-5678');
  const {migrateItem} = await import('../../src/state.js');
  const it=migrateItem({id:1, memo:'m', contacts:[{who:'김철수', org:'행정과', phone:'01012345678'}, {who:'이', org:'', phone:'02-123-4567 내선3'}]});
  assert.equal(it.contacts[0].phone, '010-1234-5678');           // 기존 데이터 회복
  assert.equal(it.contacts[1].phone, '02-123-4567 내선3');       // 애매한 표기는 원문
});

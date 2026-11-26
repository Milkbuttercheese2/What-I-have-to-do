/* 엑셀로 내보내기(xlsx-export.js) — 만든 바이트를 SheetJS 로 다시 읽어 값·병합·열 너비를 보고,
   꾸러미(zip) 안의 XML 을 직접 읽어 엑셀이 엄격히 보는 구조(원소 순서·꾸밈 수·관계·내용 형식)를 본다.
   이 PC 에는 엑셀이 없어 진짜 엑셀로 열어 볼 수 없다 — 그래서 규격을 테스트로 지킨다. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const XLSX = require('../../src/vendor/xlsx.full.min.js');
const X = await import('../../src/xlsx-export.js');
const {setPlaceMode, placeOf, PLACE_NAME} = await import('../../src/placement.js');

const NOW = new Date(2026, 10, 27, 15, 20);
const T = (d, h, m=0) => new Date(2026, 10, d, h, m).toISOString();

const {zipNames, unzipText, parseXml, checkPackage} = await import('../helpers/xlsx-package.js');

/* ---- 견본 자료(지어낸 것) ---- */
function sample(){
  return [
    {id:1, memo:'입찰공고 정정 사유 확인\n시설과에서 공고문 규격 부분 정정을 요청.\n사유서를 받아 정정안 검토 뒤 재공고 일정 회신.',
      f:{received:T(26,9,10), due:T(28,14)}, contacts:[{who:'김서준', org:'시설과', phone:'02-000-0000', email:''}],
      ids:[{kind:'공고번호', val:'R26BK00123456'}], subs:[{id:11,title:'정정 사유서 받기',done:true,mid:T(26,10)},{id:12,title:'공고문 정정안 검토',done:false},{id:13,title:'재공고 일정 회신',done:false}],
      files:['C:\\업무\\2026\\입찰\\정정요청.hwpx']},
    {id:2, memo:'나라장터 공고분 규격 정정 요청 회신', f:{due:T(27,18)}, contacts:[{who:'박하린', org:'정보화담당관', phone:'02-000-0001'}], subs:[], ids:[], files:[]},
    {id:3, memo:'계약변경 사유서와 산출내역 검토\n물가변동 조정률 계산 근거 확인 필요.', f:{due:T(25,18)},
      contacts:[{who:'최민재',org:'재무과',phone:'02-000-0002'},{who:'한지우',org:'건설사업단',phone:'02-000-0003'}],
      ids:[{kind:'계약번호',val:'2026-0412'}], subs:[{id:31,title:'변경 요청서 접수',done:true},{id:32,title:'산출내역 대조',done:true},{id:33,title:'조정률 계산 검증',done:false},{id:34,title:'변경계약 기안',done:false}], files:[]},
    {id:4, memo:'청사 전기설비 유지관리 용역 장기계속 2차', f:{due:T(28+7,12)}, contacts:[{who:'윤소이',org:'운영지원과',phone:'02-000-0004'}],
      ids:[{kind:'사업번호',val:'26-용역-077'}], subs:[{id:41,title:'과업지시서 변경분 확인',done:true,mid:T(26,9)},{id:42,title:'2차 계약 기안',done:false,mid:T(30,9)}], files:[]},
    {id:5, memo:'소액수의 견적 비교표 작성', done:true, doneAt:new Date(2026,10,26,17,0).getTime(), f:{due:T(26,17)},
      contacts:[{who:'정다은',org:'총무과',phone:'02-000-0005'}], subs:[{id:51,title:'견적서 3곳 받기',done:true},{id:52,title:'비교표 작성',done:true}], ids:[], files:[]},
    {id:6, memo:'분류 대기 메모(내보내지 않는다)', subs:[], contacts:[], ids:[], files:[]},
    {id:7, memo:'예정 업무(손 안 댐, 내보내지 않는다)', f:{due:T(30*2,9)}, subs:[], contacts:[], ids:[], files:[]},
  ];
}
const build = (items, opts) => X.buildXlsx(XLSX, items, Object.assign({now:NOW}, opts));
const readBack = bytes => XLSX.read(bytes, {type:'array', cellStyles:true});   // cellStyles: 열 너비·줄 높이까지 읽는다
const cell = (ws, a) => ws[a] ? ws[a].v : undefined;

/* 예전 backup.js(이번 개편 전) 의 범위·원자료 식 그대로 — 바뀌지 않았는지 대조한다 */
function oldExportable(items){
  const started=it=>(it.subs||[]).some(s=>s.done);
  return items.filter(it=>{const p=placeOf(it);
    return it.done||['today','doing','metoday','othtoday'].includes(p)||(['meplan','othplan'].includes(p)&&started(it));});
}
function oldRow(it){
  const fx=iso=>{ if(!iso)return''; const d=new Date(iso); if(isNaN(d))return'';
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; };
  const subs=it.subs||[];
  return {
    '구역':PLACE_NAME[placeOf(it)], '메모':it.memo||'',
    '관련인':(it.contacts||[]).map(c=>c.who).filter(Boolean).join(', '),
    '관련소속':(it.contacts||[]).map(c=>c.org).filter(Boolean).join(', '),
    '연락처':(it.contacts||[]).map(c=>c.phone).filter(Boolean).join(', '),
    '이메일':(it.contacts||[]).map(c=>c.email).filter(Boolean).join(', '),
    '접수시각':fx((it.f||{}).received), '기한':fx((it.f||{}).due),
    '식별정보':(it.ids||[]).map(x=>`${x.kind}: ${x.val}`).join(' · '),
    '하위 업무 진행':subs.length?`${subs.filter(s=>s.done).length}/${subs.length}`:'',
    '하위 업무 내역':subs.map(s=>(s.done?'[완료] ':'')+s.title+(s.mid?` (점검 ${fx(s.mid)})`:'')).join(' · '),
    '파일링크':(it.files||[]).join(' · ')
  };
}

test('내보내는 업무 범위와 원자료 열은 예전과 같다(4열·5열 모두)', () => {
  for(const mode of ['time','owner']){
    setPlaceMode(mode);
    const items = sample();
    assert.deepEqual(X.exportableItems(items).map(i=>i.id), oldExportable(items).map(i=>i.id), mode);
    for(const it of X.exportableItems(items)){
      const old = oldRow(it);
      assert.deepEqual(Object.keys(old), X.RAW_COLUMNS, '열 이름·순서');
      assert.deepEqual(X.rawRow(it), Object.values(old), `${mode} ${it.id} 원자료 값`);
    }
  }
  setPlaceMode('time');
});

test('원자료 시트: 예전과 같은 열 이름·순서의 한 줄짜리 표, 자동 필터, 머리글 틀 고정', () => {
  setPlaceMode('time');
  const items = sample(), wb = readBack(build(items));
  const ws = wb.Sheets['원자료'];
  const aoa = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
  assert.deepEqual(aoa[0], ['구역','메모','관련인','관련소속','연락처','이메일','접수시각','기한','식별정보','하위 업무 진행','하위 업무 내역','파일링크']);
  const exp = oldExportable(items);
  assert.equal(aoa.length, exp.length + 1);
  assert.deepEqual(aoa.slice(1), exp.map(it => Object.values(oldRow(it))), '값이 예전과 같다');
  assert.equal(ws['!autofilter'].ref, `A1:L${exp.length+1}`);
});

test('시트 이름과 순서 — 32,000자에서 잘린 메모가 없으면 메모 전문 시트를 만들지 않는다', () => {
  setPlaceMode('time');
  assert.deepEqual(readBack(build(sample())).SheetNames, ['업무 목록','연락처·파일','원자료']);
  const many = sample(); many[0].memo += '\n' + '다음 줄\n'.repeat(500);
  assert.deepEqual(readBack(build(many)).SheetNames, ['업무 목록','연락처·파일','원자료'], '줄이 많아도 내용 칸에 다 들어가면 메모 전문 시트는 없다');
  const long = sample(); long[0].memo += '\n' + '가'.repeat(33000);
  assert.deepEqual(readBack(build(long)).SheetNames, ['업무 목록','연락처·파일','메모 전문','원자료']);
});

test('업무 목록 시트: 제목·기준 줄·머리글·구역 줄(보드 순서, 완료가 맨 뒤)·병합·열 너비', () => {
  setPlaceMode('time');
  const wb = readBack(build(sample())), ws = wb.Sheets['업무 목록'];
  const aoa = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
  assert.equal(aoa[0][0], '업무 목록');
  assert.equal(aoa[1][0], '2026-11-27 15:20 기준 · 진행 중인 업무 4건 · 완료 1건');
  assert.deepEqual(aoa[2], ['업무','내용','기한','관련인','진행','하위 업무','식별정보']);
  const sections = aoa.filter(r => /^\S.* · \d+건$/.test(r[0]) && r.slice(1).every(v => v === '')).map(r => r[0]);
  assert.deepEqual(sections, ['오늘 처리 · 2건','진행 중 · 2건','완료 · 1건']);
  /* 구역 안은 보드처럼 시각이 이른 것부터. 계약변경은 하위 업무를 끝낸 것이 있어도 기한이 지나 오늘 처리 */
  const titles = aoa.slice(3).map(r => r[0]);
  assert.deepEqual(titles, ['오늘 처리 · 2건','계약변경 사유서와 산출내역 검토','나라장터 공고분 규격 정정 요청 회신',
    '진행 중 · 2건','입찰공고 정정 사유 확인','청사 전기설비 유지관리 용역 장기계속 2차','완료 · 1건','소액수의 견적 비교표 작성']);
  const merges = ws['!merges'].map(m => XLSX.utils.encode_range(m));
  for(const r of ['A1:G1','A2:G2','A4:G4','A7:G7','A10:G10']) assert.ok(merges.includes(r), r+' 병합');
  assert.deepEqual(ws['!cols'].map(c => Math.round(c.wch)), [26,46,16,16,7,34,22]);
  assert.ok(!ws['!autofilter'], '업무 목록에는 자동 필터를 걸지 않는다');
  /* 업무 줄 */
  const row = aoa.find(r => r[0] === '계약변경 사유서와 산출내역 검토');
  assert.deepEqual(row, ['계약변경 사유서와 산출내역 검토','물가변동 조정률 계산 근거 확인 필요.','11-25(수) 18:00\n2일 지남','최민재\n재무과\n한지우\n건설사업단','2/4',
    '☐ 조정률 계산 검증\n☐ 변경계약 기안\n✓ 변경 요청서 접수\n✓ 산출내역 대조','계약번호 2026-0412']);
  const done = aoa.find(r => r[0] === '소액수의 견적 비교표 작성');
  assert.equal(done[2], '11-26(목) 완료');
});

test('업무 목록 시트의 꾸밈: 머리글·구역·지남/오늘·완료도 검정, 줄바꿈 표시, 틀 고정, 인쇄 설정', () => {
  setPlaceMode('time');
  const pkg = checkPackage(build(sample()));
  const s1 = pkg.sheets[0];
  assert.equal(s1.name, '업무 목록');
  const S = a => Number(Array.from(s1.doc.getElementsByTagName('c')).find(c => c.getAttribute('r') === a)?.getAttribute('s') || 0);
  assert.equal(S('A1'), X.ST.title); assert.equal(S('A2'), X.ST.meta);
  for(const c of 'ABCDEFG') assert.equal(S(c+'3'), X.ST.head);
  assert.equal(S('A4'), X.ST.secToday); assert.equal(S('G4'), X.ST.secToday, '병합한 구역 줄의 나머지 칸도 같은 꾸밈(테두리)');
  assert.equal(S('A5'), X.ST.bold); assert.equal(S('C5'), X.ST.late, '지난 기한은 붉은');
  assert.equal(S('C6'), X.ST.soon, '오늘 기한(아직 안 지남)은 주홍');
  assert.equal(S('A7'), X.ST.secTeal); assert.equal(S('A10'), X.ST.secDone);
  /* 완료 업무 줄도 다른 구역과 같은 꾸밈(검정 글자·업무 이름 굵게) — 2026-11-27 소유자 지시 */
  assert.equal(S('A11'), X.ST.bold); assert.equal(S('B11'), X.ST.body); assert.equal(S('C11'), X.ST.body, '완료의 기한 칸도 보통 글자');
  assert.equal(S('E11'), X.ST.center); assert.equal(S('F11'), X.ST.body, '✓ 하위 업무 줄도 보통 글자');
  /* 꾸밈 번호 → 실제 꾸밈 */
  const st = pkg.docs['xl/styles.xml'];
  const xf = n => st.getElementsByTagName('cellXfs')[0].children[n];
  const fontColor = n => st.getElementsByTagName('fonts')[0].children[Number(xf(n).getAttribute('fontId'))].getElementsByTagName('color')[0].getAttribute('rgb');
  assert.equal(xf(X.ST.body).getElementsByTagName('alignment')[0].getAttribute('wrapText'), '1');
  assert.equal(xf(X.ST.body).getElementsByTagName('alignment')[0].getAttribute('vertical'), 'top');
  for(const k of ['body','bold','center']) assert.equal(fontColor(X.ST[k]), 'FF131A24', k+' 검정');
  const fontColors = Array.from(st.getElementsByTagName('fonts')[0].children).map(f => f.getElementsByTagName('color')[0].getAttribute('rgb'));
  assert.ok(!fontColors.includes('FF8A93A1'), '완료 흐림(회색) 글꼴은 styles.xml 에 없다');
  const secDoneFill = st.getElementsByTagName('fills')[0].children[Number(xf(X.ST.secDone).getAttribute('fillId'))];
  assert.equal(secDoneFill.getElementsByTagName('fgColor')[0].getAttribute('rgb'), 'FFEEF0F3', '완료 구역 줄의 옅은 회색 채움은 그대로');
  assert.equal(fontColor(X.ST.late), 'FF9B1B30'); assert.equal(fontColor(X.ST.soon), 'FFB34A26'); assert.equal(fontColor(X.ST.head), 'FFFFFFFF');
  const headFill = st.getElementsByTagName('fills')[0].children[Number(xf(X.ST.head).getAttribute('fillId'))];
  assert.equal(headFill.getElementsByTagName('fgColor')[0].getAttribute('rgb'), 'FF2A7C6E', '머리글 청록 채움');
  /* 틀 고정 = 머리글 줄(3)까지 */
  const pane = s1.doc.getElementsByTagName('pane')[0];
  assert.equal(pane.getAttribute('ySplit'), '3');
  /* 인쇄: 가로, 폭을 한 쪽에, 머리글 되풀이 */
  const ps = s1.doc.getElementsByTagName('pageSetup')[0];
  assert.equal(ps.getAttribute('orientation'), 'landscape'); assert.equal(ps.getAttribute('fitToWidth'), '1'); assert.equal(ps.getAttribute('fitToHeight'), '0');
  const dn = Array.from(pkg.docs['xl/workbook.xml'].getElementsByTagName('definedName')).find(d => d.getAttribute('name') === '_xlnm.Print_Titles');
  assert.equal(dn.getAttribute('localSheetId'), '0'); assert.equal(dn.textContent, "'업무 목록'!$3:$3");
  /* 첫 시트만 골라진 탭 */
  assert.equal(pkg.sheets.filter(s => s.doc.getElementsByTagName('sheetView')[0].getAttribute('tabSelected') === '1').length, 1);
  /* 줄 높이: 줄바꿈이 든 업무 줄은 줄 수만큼 */
  const ht = r => Number(Array.from(s1.doc.getElementsByTagName('row')).find(x => x.getAttribute('r') === String(r)).getAttribute('ht'));
  assert.ok(ht(5) >= 4*15, '하위 업무 넷 → 4줄 이상');
  /* 다른 시트도 머리글 틀 고정 */
  for(const s of pkg.sheets.slice(1)) assert.equal(s.doc.getElementsByTagName('pane')[0].getAttribute('ySplit'), '1', s.name);
  /* 원자료는 자동 필터, 업무 목록은 없음 */
  assert.equal(pkg.sheets.at(-1).doc.getElementsByTagName('autoFilter').length, 1);
  assert.equal(s1.doc.getElementsByTagName('autoFilter').length, 0);
});

test('기한 칸: 지남·오늘·내일·그 밖·완료·다른 해', () => {
  const now = NOW;
  assert.deepEqual(X.dueCell({f:{due:T(24,9)}}, now), {text:'11-24(화) 09:00\n3일 지남', tone:'late'});
  assert.deepEqual(X.dueCell({f:{due:T(27,9)}}, now), {text:'11-27(금) 09:00\n오늘', tone:'late'}, '오늘인데 이미 지난 시각');
  assert.deepEqual(X.dueCell({f:{due:T(27,18)}}, now), {text:'11-27(금) 18:00\n오늘', tone:'soon'});
  assert.deepEqual(X.dueCell({f:{due:T(28,14)}}, now), {text:'11-28(토) 14:00\n내일', tone:'soon'});
  assert.deepEqual(X.dueCell({f:{due:T(30,14)}}, now), {text:'11-30(월) 14:00', tone:''});
  assert.deepEqual(X.dueCell({f:{}}, now), {text:'', tone:''});
  assert.deepEqual(X.dueCell({f:{due:'망가진 값'}}, now), {text:'', tone:''});
  assert.deepEqual(X.dueCell({done:true, doneAt:new Date(2026,10,26,17).getTime()}, now), {text:'11-26(목) 완료', tone:'done'});
  assert.deepEqual(X.dueCell({done:true}, now), {text:'완료', tone:'done'});
  assert.equal(X.dueCell({f:{due:new Date(2027,0,5,9).toISOString()}}, now).text, '2027-01-05(화) 09:00');
});

test('업무·내용 칸: 메모 나머지를 다 담고, 32,000자를 넘을 때만 잘라 안내 — 그때만 메모 전문 시트로', () => {
  assert.deepEqual(X.memoCells('\n\n  제목 줄  \n\n가\n나\n\n'), {title:'제목 줄', body:'가\n나', cut:false});
  assert.deepEqual(X.memoCells('[구역 제목]\n본문'), {title:'[구역 제목]', body:'본문', cut:false}, '[제목] 줄은 그대로 글자로');
  const eight = X.memoCells('t\n1\n2\n3\n4\n5\n6\n7\n\n8');
  assert.deepEqual(eight, {title:'t', body:'1\n2\n3\n4\n5\n6\n7\n\n8', cut:false}, '5줄 넘는 메모도 온전히(가운데 빈 줄 포함)');
  const long = X.memoCells('t\n' + '가'.repeat(250) + '\n' + '나'.repeat(100) + '\n끝');
  assert.equal(long.body, '가'.repeat(250) + '\n' + '나'.repeat(100) + '\n끝'); assert.ok(!long.cut);
  const edge = X.memoCells('t\n' + '다'.repeat(32000));
  assert.equal(edge.body, '다'.repeat(32000)); assert.ok(!edge.cut, '딱 32,000자는 자르지 않는다');
  const over = X.memoCells('t\n' + '다'.repeat(32001));
  assert.equal(over.body, '다'.repeat(32000) + "… (잘림. 전체는 '메모 전문' 시트)"); assert.ok(over.cut);
  assert.ok(over.body.length <= 32767);
  /* 첫 줄이 120자를 넘으면 업무 칸은 앞 120자, 뒤쪽은 내용 칸 맨 앞에 이어 적는다 — 잃는 글이 없어 메모 전문으로 보내지 않는다 */
  const title = X.memoCells('가'.repeat(120) + '나'.repeat(10) + '\n본문');
  assert.deepEqual(title, {title:'가'.repeat(120) + '…', body:'…' + '나'.repeat(10) + '\n본문', cut:false});
  assert.deepEqual(X.memoCells(''), {title:'', body:'', cut:false});
});

test('업무 줄 높이: 메모 길이와 무관하고 하위 업무 수를 따른다(최소 2줄 · 최대 409pt), 같은 줄의 다른 칸도 가리지 않는다', () => {
  setPlaceMode('time');
  /* 완료 업무로 — 기한 칸('11-27(금) 완료')이 한 줄이라 최소 높이를 그대로 볼 수 있다 */
  const one = (memo, more) => Object.assign({id:1, memo, done:true, doneAt:new Date(2026,10,27,14).getTime(), f:{due:T(27,18)}, contacts:[], ids:[], subs:[], files:[]}, more);
  const htOf = items => { const s1 = checkPackage(build(items)).sheets[0];
    return Number(Array.from(s1.doc.getElementsByTagName('row')).find(x => x.getAttribute('r') === '5').getAttribute('ht')); };
  const subs = n => Array.from({length:n}, (_, i) => ({id:i+1, title:`하위 ${i+1}`, done:i % 4 === 3}));
  const memo = n => '업무\n' + Array.from({length:n}, (_, i) => `메모 ${i+1}번째 줄`).join('\n');
  /* 메모 길이만 다르면 높이가 같다 — 하위 업무가 없으면 최소 2줄 */
  assert.equal(htOf([one(memo(1))]), 2*15+3);
  assert.equal(htOf([one(memo(200))]), 2*15+3, '메모 200줄이어도 2줄 높이(메모는 셀 안에서 아래가 가려진다)');
  assert.equal(htOf([one('업무\n' + '가'.repeat(30000))]), 2*15+3);
  /* 하위 업무 수를 따른다 */
  assert.equal(htOf([one(memo(200), {subs:subs(5)})]), 5*15+3);
  assert.equal(htOf([one(memo(1), {subs:subs(12)})]), 12*15+3);
  /* 하위 업무가 많아도 409pt 아래, 같은 줄의 관련인 칸이 더 길면 그 줄 수 */
  assert.ok(htOf([one(memo(1), {subs:subs(80)})]) <= 409);
  const ps = Array.from({length:3}, (_, i) => ({who:'사람'+i, org:'과'+i, phone:''}));
  assert.equal(htOf([one(memo(1), {subs:subs(1), contacts:ps})]), 6*15+3, '관련인 3명(이름·소속 6줄)이 가려지지 않게');
  /* 업무 이름이 접혀 여러 줄이 되는 경우도 본다(열 너비 26 — 한글 14자쯤에서 접힌다) */
  assert.ok(htOf([one('가'.repeat(60) + '\n본문')]) >= 4*15+3);
});

test('관련인 3명·하위 업무는 줄 높이에 드는 만큼(남은 것 먼저)·식별정보 3개까지, 넘으면 외 N', () => {
  const ps = Array.from({length:5}, (_, i) => ({who:'사람'+i, org:'과'+i, phone:'02-000-000'+i}));
  assert.equal(X.peopleCell(ps), '사람0\n과0\n사람1\n과1\n사람2\n과2\n외 2명');
  assert.equal(X.peopleCell([{who:'', org:'', phone:'02-000-0000'}]), '', '이름·소속이 없는 관련인은 첫 시트에 안 보인다(연락처는 둘째 시트)');
  const subs = [{title:'끝1',done:true},{title:'남1'},{title:'끝2',done:true},{title:'남2'},{title:'남3'},{title:'남4'},{title:'끝3',done:true},{title:'남5'},{title:'남6'}];
  assert.equal(X.subsCell(subs), '☐ 남1\n☐ 남2\n☐ 남3\n☐ 남4\n☐ 남5\n☐ 남6\n✓ 끝1\n✓ 끝2\n✓ 끝3', '9개면 다 적는다');
  /* 한 줄짜리는 LIMITS.subs(26)개까지, 그 뒤는 외 N개 — 합쳐 27줄 = 408pt */
  const many = Array.from({length:30}, (_, i) => ({title:'일'+i, done:i >= 25}));
  const lines = X.subsCell(many).split('\n');
  assert.equal(X.LIMITS.subs, 26); assert.equal(X.ROW_LINES, 27);
  assert.equal(lines.length, 27); assert.equal(lines[25], '✓ 일25'); assert.equal(lines.at(-1), '외 4개 · 끝낸 것 4개');
  assert.equal(X.subsCell(many.slice(0, 26)).split('\n').length, 26, '26개는 외 줄 없이 다');
  /* 제목이 접혀 여러 줄이 되면 줄 수로 재어 일찍 멈춘다 — '외' 줄까지 27줄 안 */
  const wide = Array.from({length:20}, (_, i) => ({title:'가'.repeat(40) + i}));
  const w = X.subsCell(wide);
  assert.ok(X.visualLines(w, 34) <= 27, `${X.visualLines(w, 34)}줄`); assert.match(w, /외 \d+개$/);
  assert.equal(X.subsCell([{title:'a'},{title:'b',done:true}]), '☐ a\n✓ b');
  assert.equal(X.idsCell([{kind:'가',val:1},{kind:'나',val:2},{kind:'다',val:3},{kind:'라',val:4}]), '가 1\n나 2\n다 3\n외 1개');
});

test('연락처·파일 시트: 관련인 한 사람에 한 줄, 업무 이름과 파일은 첫 줄에만', () => {
  setPlaceMode('time');
  const ws = readBack(build(sample())).Sheets['연락처·파일'];
  const aoa = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
  assert.deepEqual(aoa[0], ['업무','관련소속','관련인','연락처','이메일','파일·폴더 링크']);
  const i = aoa.findIndex(r => r[0] === '계약변경 사유서와 산출내역 검토');
  assert.deepEqual(aoa[i], ['계약변경 사유서와 산출내역 검토','재무과','최민재','02-000-0002','','']);
  assert.deepEqual(aoa[i+1], ['','건설사업단','한지우','02-000-0003','','']);
  const j = aoa.findIndex(r => r[0] === '입찰공고 정정 사유 확인');
  assert.equal(aoa[j][5], 'C:\\업무\\2026\\입찰\\정정요청.hwpx');
});

test('메모 전문 시트: 32,000자에서 잘린 메모만, 메모 한 줄을 시트 한 줄에, 업무 이름은 첫 줄에만, 업무 사이에 빈 줄', () => {
  setPlaceMode('time');
  const items = sample();
  items[0].memo = '첫 업무\n' + Array.from({length:8}, (_, i) => `줄 ${i+1}`).join('\n') + '\n' + '마'.repeat(32500);
  items[2].memo = '둘째 업무\n\n' + '라'.repeat(32500);
  items[1].memo = '셋째 업무\n' + '바'.repeat(2500);   // 내용 칸에 다 들어가므로 메모 전문에는 싣지 않는다
  const bytes = build(items);
  assert.equal(checkPackage(bytes).sheets.length, 4);
  const wb = readBack(bytes);
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets['메모 전문'], {header:1, defval:''});
  assert.deepEqual(aoa[0], ['업무','메모']);
  assert.ok(!aoa.some(r => r[0] === '셋째 업무'), '다 담긴 메모는 싣지 않는다');
  /* 업무 목록과 같은 순서: 오늘 처리(둘째 업무) → 진행 중(첫 업무) */
  const ra = Array.from({length:32}, () => ['', '라'.repeat(1000)]).concat([['', '라'.repeat(500)]]);
  assert.deepEqual(aoa.slice(1, 36), [['둘째 업무','둘째 업무'],['',''], ...ra]);
  assert.deepEqual(aoa[36], ['','']); /* 업무 사이 빈 줄 */
  assert.deepEqual(aoa[37], ['첫 업무','첫 업무']);
  assert.deepEqual(aoa.slice(38, 46).map(r => r[1]), Array.from({length:8}, (_, i) => `줄 ${i+1}`));
  assert.equal(aoa.slice(46).map(r => r[1]).join(''), '마'.repeat(32500));
  /* 업무 목록의 내용 칸: 잘린 것은 32,000자 + 안내, 다 들어간 것은 그대로 */
  const list = XLSX.utils.sheet_to_json(wb.Sheets['업무 목록'], {header:1, defval:''});
  assert.equal(list.find(r => r[0] === '둘째 업무')[1], '라'.repeat(32000) + "… (잘림. 전체는 '메모 전문' 시트)");
  assert.equal(list.find(r => r[0] === '셋째 업무')[1], '바'.repeat(2500));
});

test('제어 문자는 지우고, = + - @ 로 시작하는 글과 & < > 는 글자 그대로', () => {
  setPlaceMode('time');
  const items = [{id:1, memo:'=SUM(A1:A3)\n+82 @멘션 -1 & <b>값</b>\u0001\u0007\u001f끝\uD800', f:{due:T(27,9)}, subs:[], contacts:[{who:'@사람', org:'-과', phone:'+82-2-000-0000'}], ids:[], files:[]}];
  const bytes = build(items);
  checkPackage(bytes);
  const wb = readBack(bytes);
  const ws = wb.Sheets['업무 목록'];
  assert.equal(ws.A5.v, '=SUM(A1:A3)'); assert.equal(ws.A5.t, 's'); assert.ok(!ws.A5.f, '수식이 아니다');
  assert.equal(ws.B5.v, '+82 @멘션 -1 & <b>값</b>끝');
  const raw = wb.Sheets['원자료'];
  assert.equal(raw.B2.v, '=SUM(A1:A3)\n+82 @멘션 -1 & <b>값</b>끝');
  assert.equal(raw.E2.v, '+82-2-000-0000'); assert.equal(raw.E2.t, 's');
});

test('5열(시간·담당자) 모드: 구역은 보드 5열 순서', () => {
  setPlaceMode('owner');
  const items = sample();
  items[1].subs = [{id:21, title:'회신', done:false, mid:T(27,17), owner:'박하린'}];
  const aoa = XLSX.utils.sheet_to_json(readBack(build(items)).Sheets['업무 목록'], {header:1, defval:''});
  const sections = aoa.filter(r => / · \d+건$/.test(r[0]) && r[1] === '').map(r => r[0].replace(/ · \d+건$/, ''));
  assert.deepEqual(sections, ['본인 진행 · 오늘','타인 진행 · 오늘','본인 진행 · 오늘 외','완료']);
  setPlaceMode('time');
});

test('styles.xml 의 꾸밈 수와 ST 번호가 맞다', () => {
  const doc = parseXml(X.stylesXml(), 'styles.xml');
  assert.equal(doc.getElementsByTagName('cellXfs')[0].children.length, X.STYLE_COUNT);
  for(const v of Object.values(X.ST)) assert.ok(v > 0 && v < X.STYLE_COUNT);
});

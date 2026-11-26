/* 엑셀로 내보내기 — 큰 자료에서 실패하지 않는다(소유자 지시, 설계서 5절).
   예전 내보내기는 32,767자를 넘는 메모가 하나라도 있으면 XLSX.write 가 "Text length must not exceed 32767 characters"
   로 던져 파일이 통째로 안 나왔다(메모 칸은 50,000자까지 받는다 — index.html maxlength). 그 실패가 다시 나지 않는지 본다.
   자료는 모두 지어낸 것이다. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const XLSX = require('../../src/vendor/xlsx.full.min.js');
const X = await import('../../src/xlsx-export.js');
const {setPlaceMode, placeOf, PLACE_NAME} = await import('../../src/placement.js');
const {checkPackage} = await import('../helpers/xlsx-package.js');

setPlaceMode('time');
const NOW = new Date(2026, 10, 27, 15, 20);
const T = (d, h) => new Date(2026, 10, d, h, 0).toISOString();
const base = (id, memo, more) => Object.assign({id, memo, done:false, f:{due:T(27,9)}, contacts:[], ids:[], subs:[], files:[]}, more);
const build = items => X.buildXlsx(XLSX, items, {now:NOW});
const read = bytes => XLSX.read(bytes, {type:'array'});
const rows = (wb, name) => XLSX.utils.sheet_to_json(wb.Sheets[name], {header:1, defval:''});
/* 업무 목록 시트 r 번째 줄의 높이(pt) */
const listHt = (bytes, r = 5) => Number(Array.from(checkPackage(bytes).sheets[0].doc.getElementsByTagName('row')).find(x => x.getAttribute('r') === String(r)).getAttribute('ht'));
/* 꾸러미 안의 모든 글자 셀 길이 */
function maxCellLen(wb){ let m = 0; for(const n of wb.SheetNames) for(const [k, c] of Object.entries(wb.Sheets[n])) if(k[0] !== '!' && typeof c.v === 'string') m = Math.max(m, c.v.length); return m; }
const HANGUL = n => Array.from({length:n}, (_, i) => '가나다라마바사아자차카타파하'[i % 14]).join('');

/* 예전 내보내기(이번 개편 전 backup.js)의 쓰기 — 실패를 재현해 두어 테스트가 무엇을 막는지 분명히 한다 */
function oldWrite(items){
  const rows = items.map(it => ({'구역':'', '메모':it.memo||''}));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), '업무목록');
  return XLSX.write(wb, {type:'array', bookType:'xlsx'});
}

test('예전 방식은 40,000자 메모에서 던진다 — 새 방식은 파일이 나온다', () => {
  const items = [base(1, '긴 메모\n' + HANGUL(40000))];
  assert.throws(() => oldWrite(items), /32767/);
  const bytes = build(items);
  checkPackage(bytes);
  assert.ok(maxCellLen(read(bytes)) <= 32767);
});

test('메모 50,000자: 업무 목록·원자료는 32,000자에서 자르고 안내, 메모 전문에는 전부', () => {
  const memo = '오만 자 메모\n' + HANGUL(49992);
  assert.equal(memo.length, 50000);
  const bytes = build([base(1, memo)]);
  checkPackage(bytes);
  const wb = read(bytes);
  const raw = rows(wb, '원자료');
  assert.equal(raw[1][1], memo.slice(0, 32000) + "… (잘림. 전체는 '메모 전문' 시트)");
  const full = rows(wb, '메모 전문').slice(1);
  assert.equal(full[0][1], '오만 자 메모');
  const chunks = full.slice(1).map(r => r[1]);
  assert.ok(chunks.every(c => c.length <= 1000), '한 줄은 1,000자씩 끊는다');
  assert.equal(chunks.join(''), HANGUL(49992), '잘린 데 없이 전부');
  const list = rows(wb, '업무 목록');
  assert.equal(list[4][0], '오만 자 메모');
  assert.equal(list[4][1], HANGUL(49992).slice(0, 32000) + "… (잘림. 전체는 '메모 전문' 시트)");
  assert.ok(maxCellLen(wb) <= 32767);
  assert.equal(listHt(bytes), listHt(build([base(1, '오만 자 메모')])), '줄 높이는 메모 길이와 무관');
});

test('메모 1,000줄: 업무 목록 내용 칸에 999줄 모두(32,000자 안이라 메모 전문 시트 없음), 줄 높이는 그대로', () => {
  const memo = ['천 줄 메모', ...Array.from({length:999}, (_, i) => `${i+1}번째 줄 — 조달 검토 내용`)].join('\n');
  assert.ok(memo.length < 32000);
  const bytes = build([base(1, memo)]);
  checkPackage(bytes);
  const wb = read(bytes);
  assert.equal(rows(wb, '업무 목록')[4][1], memo.split('\n').slice(1).join('\n'));
  assert.ok(!wb.SheetNames.includes('메모 전문'));
  assert.equal(listHt(bytes), listHt(build([base(1, '천 줄 메모')])), '줄 높이는 메모 길이와 무관');
  /* 32,000자를 넘는 줄 많은 메모는 메모 전문에 한 줄에 한 줄 */
  const big = ['큰 메모', ...Array.from({length:1999}, (_, i) => `${i+1}번째 줄 — 조달 검토 내용 ` + HANGUL(10))].join('\n');
  assert.ok(big.length > 32000);
  const wb2 = read(build([base(1, big)]));
  const full = rows(wb2, '메모 전문').slice(1);
  assert.equal(full.length, 2000);
  assert.deepEqual(full.map(r => r[1]), big.split('\n'));
});

test('한 줄 40,000자 메모: 메모 전문에서 1,000자씩 이어 적고, 줄 높이는 409pt 아래', () => {
  const line = HANGUL(40000);
  const bytes = build([base(1, '한 줄이 긴 메모\n' + line + '\n끝 줄')]);
  const pkg = checkPackage(bytes);       // 줄 높이 ≤ 409·셀 ≤ 32,767 도 여기서 본다
  const wb = read(bytes);
  const full = rows(wb, '메모 전문').slice(1).map(r => r[1]);
  assert.equal(full.length, 1 + 40 + 1);
  assert.equal(full.slice(1, 41).join(''), line);
  assert.equal(full.at(-1), '끝 줄');
  assert.ok(pkg.sheets.length === 4);
});

test('하위 업무 200개·관련인 100명·식별정보 50개·파일 300개', () => {
  const subs = Array.from({length:200}, (_, i) => ({id:i+1, title:`하위 업무 ${i+1} ` + HANGUL(200), done:i % 3 === 0}));
  const contacts = Array.from({length:100}, (_, i) => ({who:`가상인${i+1}`, org:`가상과${i % 7}`, phone:`02-000-${String(i).padStart(4,'0')}`, email:''}));
  const ids = Array.from({length:50}, (_, i) => ({kind:'계약번호', val:`2026-${i}`}));
  const files = Array.from({length:300}, (_, i) => `C:\\업무\\2026\\가상 폴더\\${HANGUL(100)}_${i}.hwpx`);
  const bytes = build([base(1, '큰 업무', {subs, contacts, ids, files})]);
  checkPackage(bytes);
  const wb = read(bytes);
  const r = rows(wb, '업무 목록')[4];
  assert.equal(r[3].split('\n').length, 3*2 + 1, '관련인 3명(이름·소속) + 외 N명');
  assert.match(r[3], /외 97명$/);
  assert.equal(r[4], '67/200');
  /* 하위 업무: 줄 높이 한도(27줄) 안에 드는 만큼 남은 것부터, 나머지는 외 N개 */
  const sl = r[5].split('\n'), shown = sl.length - 1;
  assert.ok(sl.slice(0, -1).every(x => x.startsWith('☐ ')), '남은 것 먼저');
  assert.equal(sl.at(-1), `외 ${200 - shown}개 · 끝낸 것 67개`);
  assert.ok(X.visualLines(r[5], 34) <= X.ROW_LINES, '하위 업무 칸이 줄 높이 안에 다 보인다');
  const ht = listHt(bytes);
  assert.ok(ht <= 409 && ht >= X.visualLines(r[5], 34)*15 + 3, `줄 높이 ${ht}pt — 하위 업무 칸이 다 보이고 한도 아래`);
  assert.match(r[6], /외 47개$/);
  const k = rows(wb, '연락처·파일').slice(1);
  assert.equal(k.length, 100, '관련인 한 사람에 한 줄');
  assert.ok(k[0][5].length <= 32767);
  const raw = rows(wb, '원자료');
  assert.ok(raw[1][10].endsWith('… (잘림)') && raw[1][10].length <= 32767, '하위 업무 내역');
  assert.ok(raw[1][11].endsWith('… (잘림)'), '파일링크');
  assert.ok(maxCellLen(wb) <= 32767);
});

test('긴 관련인 이름·긴 하위 업무 제목·긴 식별정보도 업무 목록 줄 높이는 409pt 아래', () => {
  const long = HANGUL(5000);
  const bytes = build([base(1, long + '\n' + long, {
    subs:Array.from({length:6}, (_, i) => ({id:i, title:long})), contacts:Array.from({length:4}, () => ({who:long, org:long, phone:''})),
    ids:Array.from({length:4}, () => ({kind:long, val:long}))})]);
  checkPackage(bytes);     // ht ≤ 409
});

test('업무 2,000건: 파일이 나오고 걸린 시간을 예전 방식과 함께 적는다(15초 안)', t => {
  const items = Array.from({length:2000}, (_, i) => base(i+1,
    `업무 ${i+1} — 가상 계약 검토\n` + Array.from({length:i % 9}, (_, j) => `${j+1}. 내용 ` + HANGUL(40)).join('\n'),
    {done:i % 4 === 0, doneAt:i % 4 === 0 ? NOW.getTime() - i*6e4 : undefined, f:{due:T(20 + i % 15, 9 + i % 8), received:T(20, 9)},
     contacts:[{who:`가상인${i}`, org:'가상과', phone:'02-000-0000', email:''}], ids:[{kind:'공고번호', val:`R26-${i}`}],
     subs:Array.from({length:i % 6}, (_, j) => ({id:j, title:`하위 ${j}`, done:j % 2 === 0}))}));
  /* 예전 방식(json_to_sheet + write) — 같은 열의 원자료만 */
  const t0 = performance.now();
  const rowsOld = X.exportableItems(items).map(it => Object.fromEntries(X.rawRow(it).map((v, k) => [X.RAW_COLUMNS[k], v])));
  const wbOld = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wbOld, XLSX.utils.json_to_sheet(rowsOld), '업무목록');
  XLSX.write(wbOld, {type:'array', bookType:'xlsx'});
  const oldMs = performance.now() - t0;
  const t1 = performance.now();
  const bytes = build(items);
  const newMs = performance.now() - t1;
  t.diagnostic(`2,000건: 예전 ${oldMs.toFixed(0)}ms → 새 ${newMs.toFixed(0)}ms, ${(bytes.length/1024).toFixed(0)}KB`);
  checkPackage(bytes);
  const wb = read(bytes);
  assert.equal(rows(wb, '원자료').length, X.exportableItems(items).length + 1);
  assert.ok(newMs < 15000, `2,000건이 15초 안에 (${newMs.toFixed(0)}ms)`);
});

test('안전망: 앞 단계를 거치지 않은 값도 쓰기 직전에 32,767자 아래로', () => {
  assert.equal(X.guardCell('가'.repeat(40000)).length, 32000 + '… (잘림)'.length);
  assert.equal(X.guardCell('가'.repeat(32767)).length, 32767, '한도 안이면 그대로');
  assert.equal(X.guardCell(null), null);
  /* 서로게이트 짝을 가르지 않는다 */
  const emoji = '😀'.repeat(20000);
  const g = X.guardCell(emoji);
  assert.ok(g.length <= 32767);
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(g), '짝 없는 서로게이트 없음');
});

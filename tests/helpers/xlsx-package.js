/* 엑셀로 내보내기 꾸러미(zip) 검사 도구 — tests/unit/xlsx-export*.test.js 가 함께 쓴다.
   엑셀이 엄격히 보는 구조(원소 순서·꾸밈 수·관계·내용 형식·틀 고정 짝·줄 높이·글자 한도)를 본다. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {JSDOM} from 'jsdom';

const require = createRequire(import.meta.url);
const XLSX = require('../../src/vendor/xlsx.full.min.js');

/* ---- 꾸러미 읽기 도구 ---- */
/* zip 중앙 디렉터리에서 항목 이름을 직접 읽는다(CFB.read 는 읽을 때 표지 항목을 스스로 끼워 넣으므로 쓰지 않는다) */
export function zipNames(bytes){
  const b = Buffer.from(bytes), out = [];
  let i = 0;
  while((i = b.indexOf(Buffer.from([0x50,0x4b,1,2]), i)) >= 0){
    const n=b.readUInt16LE(i+28), e=b.readUInt16LE(i+30), c=b.readUInt16LE(i+32);
    out.push(b.slice(i+46, i+46+n).toString('utf8')); i += 46+n+e+c;
  }
  return out;
}
export function unzipText(bytes){
  const z = XLSX.CFB.read(bytes, {type:'array'}), files = {};
  for(const name of zipNames(bytes)){ const f = XLSX.CFB.find(z, '/'+name); files[name] = Buffer.from(f.content).toString('utf8'); }
  return files;
}
const parser = new (new JSDOM('').window.DOMParser)();
export function parseXml(text, name){
  const doc = parser.parseFromString(text, 'application/xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  assert.ok(!err, `${name}: XML 이 잘 짜이지 않았다 — ${err && err.textContent}`);
  return doc;
}
const kids = el => Array.from(el.children).map(c => c.localName);
/* 규격(ECMA-376 CT_Worksheet)의 자식 순서 */
export const WS_ORDER = ['sheetPr','dimension','sheetViews','sheetFormatPr','cols','sheetData','sheetCalcPr','sheetProtection','protectedRanges',
  'scenarios','autoFilter','sortState','dataConsolidate','customSheetViews','mergeCells','phoneticPr','conditionalFormatting','dataValidations',
  'hyperlinks','printOptions','pageMargins','pageSetup','headerFooter','rowBreaks','colBreaks','customProperties','cellWatches','ignoredErrors',
  'smartTags','drawing','legacyDrawing','legacyDrawingHF','picture','oleObjects','controls','webPublishItems','tableParts','extLst'];
/* 꾸러미 전체를 검사한다 — 큰 자료 테스트도 이것을 쓴다 */
export function checkPackage(bytes){
  const raw = Buffer.from(bytes);
  assert.ok(!raw.includes('Sh33tJ5'), 'SheetJS 표지 항목(Sh33tJ5)이 없다');
  const names = zipNames(bytes), files = unzipText(bytes);
  assert.ok(names.includes('[Content_Types].xml') && names.includes('_rels/.rels') && names.includes('xl/workbook.xml'));
  const docs = {};
  for(const n of names) if(/\.(xml|rels)$/.test(n)) docs[n] = parseXml(files[n], n);
  /* 내용 형식: Override 가 가리키는 파일이 모두 있고, 있는 파일은 Override 나 Default(확장자)로 형식이 정해진다 */
  const ct = docs['[Content_Types].xml'];
  const over = Array.from(ct.getElementsByTagName('Override')).map(o => o.getAttribute('PartName').slice(1));
  const defs = Array.from(ct.getElementsByTagName('Default')).map(d => d.getAttribute('Extension').toLowerCase());
  for(const p of over) assert.ok(names.includes(p), `Override ${p} 의 파일이 있다`);
  for(const n of names) if(n !== '[Content_Types].xml') assert.ok(over.includes(n) || defs.includes(n.split('.').pop().toLowerCase()), `${n} 의 내용 형식이 정해져 있다`);
  /* 관계: 대상 파일이 있다 */
  for(const n of names.filter(n => n.endsWith('.rels'))){
    const base = n.replace(/_rels\/[^/]*\.rels$/, '');
    for(const r of Array.from(docs[n].getElementsByTagName('Relationship'))){
      if(r.getAttribute('TargetMode') === 'External') continue;
      const t = r.getAttribute('Target'), full = t.startsWith('/') ? t.slice(1) : base + t;
      assert.ok(names.includes(full), `${n} → ${full} 가 있다`);
    }
  }
  /* 꾸밈: count 와 실제 개수, fills 앞 두 칸 예약, 셀의 s 가 범위 안 */
  const st = docs['xl/styles.xml'];
  for(const tag of ['fonts','fills','borders','cellXfs','cellStyleXfs','cellStyles']){
    const el = st.getElementsByTagName(tag)[0];
    assert.equal(Number(el.getAttribute('count')), el.children.length, `${tag} count`);
  }
  const fills = st.getElementsByTagName('fills')[0].children;
  assert.equal(fills[0].firstElementChild.getAttribute('patternType'), 'none');
  assert.equal(fills[1].firstElementChild.getAttribute('patternType'), 'gray125');
  const nFont = st.getElementsByTagName('fonts')[0].children.length, nFill = fills.length, nBorder = st.getElementsByTagName('borders')[0].children.length;
  const xfs = Array.from(st.getElementsByTagName('cellXfs')[0].children);
  for(const xf of xfs){
    assert.ok(Number(xf.getAttribute('fontId')) < nFont && Number(xf.getAttribute('fillId')) < nFill && Number(xf.getAttribute('borderId')) < nBorder, 'xf 번호가 범위 안');
  }
  /* 워크북: 시트와 관계, 정의된 이름 */
  const wb = docs['xl/workbook.xml'];
  const sheetEls = Array.from(wb.getElementsByTagName('sheet'));
  const wbRels = docs['xl/_rels/workbook.xml.rels'];
  const relById = Object.fromEntries(Array.from(wbRels.getElementsByTagName('Relationship')).map(r => [r.getAttribute('Id'), r.getAttribute('Target')]));
  const wbKids = kids(wb.documentElement);
  assert.ok(wbKids.indexOf('sheets') < (wbKids.indexOf('definedNames') === -1 ? 99 : wbKids.indexOf('definedNames')), 'definedNames 는 sheets 뒤');
  for(const dn of Array.from(wb.getElementsByTagName('definedName'))){
    const ls = dn.getAttribute('localSheetId');
    if(ls != null) assert.ok(Number(ls) < sheetEls.length, '정의된 이름의 localSheetId 가 시트 범위 안');
  }
  /* 시트마다: 원소 순서, s 범위, 틀 고정 짝, 줄 높이 한도, 글자 한도 */
  const sheets = [];
  sheetEls.forEach((s, i) => {
    const target = 'xl/' + relById[s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')];
    const doc = docs[target];
    assert.ok(doc, `${target} 가 있다`);
    const order = kids(doc.documentElement).map(k => WS_ORDER.indexOf(k));
    assert.ok(order.every(k => k >= 0), `${target}: 모르는 원소 없음 ${kids(doc.documentElement)}`);
    assert.deepEqual(order, order.slice().sort((a,b) => a-b), `${target}: 원소 순서가 규격대로 ${kids(doc.documentElement)}`);
    for(const c of Array.from(doc.getElementsByTagName('c'))){
      const sv = c.getAttribute('s');
      if(sv != null) assert.ok(Number(sv) >= 0 && Number(sv) < xfs.length, `${target} ${c.getAttribute('r')} s=${sv} 범위 안`);
      assert.equal(c.getElementsByTagName('f').length, 0, '수식 없음');
      const v = c.getElementsByTagName('v')[0];
      if(v) assert.ok(v.textContent.length <= 32767, `${target} ${c.getAttribute('r')} 글자 한도`);
    }
    for(const r of Array.from(doc.getElementsByTagName('row'))){
      const ht = r.getAttribute('ht'); if(ht != null) assert.ok(Number(ht) > 0 && Number(ht) <= 409, `줄 높이 ${ht} ≤ 409`);
    }
    const pane = doc.getElementsByTagName('pane')[0];
    if(pane){
      assert.equal(pane.getAttribute('state'), 'frozen');
      const sel = Array.from(doc.getElementsByTagName('selection'));
      assert.ok(sel.some(x => x.getAttribute('pane') === pane.getAttribute('activePane')), '틀 고정의 activePane 과 같은 selection 이 있다');
      const ySplit = Number(pane.getAttribute('ySplit'));
      assert.equal(pane.getAttribute('topLeftCell'), `A${ySplit+1}`);
    }
    const ps = doc.getElementsByTagName('pageSetup')[0];
    if(ps && ps.getAttribute('fitToWidth')) assert.equal(doc.getElementsByTagName('pageSetUpPr')[0]?.getAttribute('fitToPage'), '1', '쪽 맞춤은 sheetPr 에도');
    sheets.push({name: s.getAttribute('name'), doc});
  });
  return {names, files, docs, sheets, styleCount: xfs.length};
}


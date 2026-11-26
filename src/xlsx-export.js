/* =========================================================================
   엑셀로 내보내기 (2026-11-27 개편) — 순수 모듈(상태·DOM·Tauri 없음).
   업무 목록 → 꾸밈이 든 .xlsx 바이트(Uint8Array). 저장은 backup.js 가 save_binary_file 로 한다.

   만드는 길(설계서 3절의 '(가)'): SheetJS(vendor/xlsx.full.min.js 0.20.3)로 값·병합·열 너비·줄 높이·자동 필터·
   인쇄 제목(정의된 이름)이 든 꾸러미를 만든 뒤, 같은 SheetJS 안의 XLSX.CFB(zip 읽기·쓰기)로 열어
   - xl/styles.xml 을 이 모듈의 것으로 갈아 끼우고
   - 시트 XML 의 셀에 꾸밈 번호(s="N")를 넣고, sheetPr(쪽 맞춤)·sheetViews(틀 고정)·pageMargins·pageSetup 을 넣는다.
   까닭: 이 SheetJS 는 셀 꾸밈(글자 색·채움·줄바꿈 표시·틀 고정)을 파일에 쓰지 않는다. 새 의존성은 넣지 않는다(내부망 보안검토).
   꾸러미의 뼈대([Content_Types].xml·rels·workbook.xml·dimension·병합·열 너비)는 SheetJS 가 쓴 것을 그대로 두어
   구조를 틀릴 여지를 줄인다. 시트 XML 의 원소 순서(sheetPr → dimension → sheetViews → … → pageSetup)는
   엑셀이 엄격히 보므로 tests/unit/xlsx-export.test.js 가 지킨다.

   시트: ① 업무 목록(읽는 용도) ② 연락처·파일(개인정보를 여기로 모은다) ③ 메모 전문(시트 ①에서 잘린 메모만,
   잘린 것이 없으면 만들지 않는다) ④ 원자료(예전 내보내기와 같은 열 이름·순서).
   큰 자료: 어떤 셀도 엑셀 셀 한도 32,767자를 넘지 않는다(예전엔 넘으면 XLSX.write 가 던져 파일이 안 나왔다).
   ========================================================================= */
import {placeOf as boardPlaceOf, PLACE_NAME} from './placement.js';

/* 원자료 시트의 열 — 예전 내보내기(v3.8.x 이전 backup.js)와 **같은 이름·같은 순서**. 바꾸면 사용자의 기존 수식·필터가 깨진다. */
export const RAW_COLUMNS=['구역','메모','관련인','관련소속','연락처','이메일','접수시각','기한','식별정보','하위 업무 진행','하위 업무 내역','파일링크'];
export const SHEET_NAMES={list:'업무 목록', contacts:'연락처·파일', memo:'메모 전문', raw:'원자료'};
export const LIST_HEAD=['업무','내용','기한','관련인','진행','하위 업무','식별정보'];
export const CONTACT_HEAD=['업무','관련소속','관련인','연락처','이메일','파일·폴더 링크'];
export const MEMO_HEAD=['업무','메모'];
/* 구역 순서 = 보드의 열 순서(4열·5열 둘 다 적어 둔다 — 한 번에 한 모드의 값만 나온다), 완료가 맨 뒤 */
export const SECTION_ORDER=['inbox','today','doing','planned','metoday','othtoday','meplan','othplan','done'];

export const LIMITS={
  cell:32767,      // 엑셀 셀 한 칸의 글자 한도
  cut:32000,       // 넘을 때 자르는 길이(뒤에 붙는 안내 글자가 들어갈 자리를 남긴다)
  title:120,       // 업무 열(메모 첫 줄)
  bodyLines:5, bodyChars:300,   // 내용 열(메모 나머지)
  people:3, subs:5, ids:3,      // 관련인·하위 업무·식별정보를 몇 개까지 보이나
  item:40,         // 업무 목록 시트의 하위 업무·식별정보 한 줄, 관련인 이름·소속 한 줄의 글자 한도(줄 높이를 409pt 아래로 두려고)
  rowPt:409,       // 엑셀 줄 높이 한도
  memoChunk:1000,  // 메모 전문 시트에서 메모 한 줄을 끊어 다음 줄에 잇는 길이(아래 MEMO_CHUNK 설명)
};

/* ---- 줄 높이 어림 ----------------------------------------------------------------------------
   엑셀은 줄바꿈이 든 셀이라도 파일을 열 때 줄 높이를 저절로 맞추지 않는 경우가 있다(병합 안 된 셀도, 파일에
   ht 가 없으면 기본 높이로 둘 때가 있다). 그래서 줄 수를 세어 높이를 파일에 적는다.
   - 열 너비의 단위는 '기본 글꼴 숫자 0 한 개의 폭'이다. 기본 글꼴은 맑은 고딕 10pt(아래 styles.xml).
   - 한글 한 자 = 숫자 0 의 1.8개로 잡는다. 한셀 뷰어 2024 로 견본을 열어 재 보니 너비 46 칸에 한글이 29자쯤
     들어갔다(≈1.6). 엑셀에서는 확인하지 못했고 맑은 고딕의 숫자 폭이 판마다 조금 달라 넉넉히 1.8 —
     적게 잡으면 글이 셀 아래로 잘려 안 보이고, 많이 잡으면 빈 줄이 조금 생길 뿐이다. (처음엔 2.0 이었으나 빈 줄이 너무 컸다.)
   - 로마자·숫자는 평균 1.0 이지만 W·M 같은 넓은 글자를 생각해 1.1.
   - 셀 안쪽 여백(좌우 약 2px씩 + 열 너비 계산에 든 5px)을 빼려고 쓸 수 있는 폭 = 열 너비 − 1.5.
   - 한 줄 높이 15pt: 맑은 고딕 10pt 의 엑셀 기본 줄 높이(약 15pt). 위아래 여백으로 3pt 를 더한다. */
const HANGUL_W=1.8, LATIN_W=1.1, CELL_PAD=1.5, LINE_PT=15, ROW_PAD=3;
function charW(cp){
  return (cp>=0x1100&&cp<=0x11FF)||(cp>=0x2E80&&cp<=0xA4CF)||(cp>=0xAC00&&cp<=0xD7A3)||(cp>=0xF900&&cp<=0xFAFF)||
    (cp>=0xFE30&&cp<=0xFE4F)||(cp>=0xFF00&&cp<=0xFF60)||(cp>=0xFFE0&&cp<=0xFFE6)||(cp>=0x2600&&cp<=0x27BF)||cp>0xFFFF ? HANGUL_W : LATIN_W;
}
export function textUnits(s){ let w=0; for(const ch of s) w+=charW(ch.codePointAt(0)); return w; }
/* 열 너비 wch 인 셀에 text 를 줄바꿈 표시로 넣었을 때 보이는 줄 수 */
export function visualLines(text, wch){
  const room=Math.max(1, wch-CELL_PAD);
  let n=0;
  for(const line of String(text).split('\n')) n+=Math.max(1, Math.ceil(textUnits(line)/room));
  return n;
}
export function rowHeight(cells, widths, min=LINE_PT+ROW_PAD){
  let lines=1;
  cells.forEach((v,i)=>{ if(v!=null&&v!=='') lines=Math.max(lines, visualLines(v, widths[i])); });
  return Math.min(LIMITS.rowPt, Math.max(min, lines*LINE_PT+ROW_PAD));
}

/* ---- 글자 다듬기 ---- */
/* 엑셀(XML 1.0)이 받지 않는 글자를 지운다: 탭·줄바꿈을 뺀 0x00–0x1F, 짝 없는 서로게이트, U+FFFE·U+FFFF.
   \r\n·\r 은 \n 으로. (XML 특수 문자 & < > 는 SheetJS 가 바꿔 적는다. 글은 모두 글자 셀(t="str")로 쓰므로
   = + - @ 로 시작해도 수식으로 읽히지 않는다.) */
export function cleanText(v){
  return String(v??'').replace(/\r\n?/g,'\n')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]/g,'')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,'');
}
/* n 자에서 자르되 서로게이트 짝을 가르지 않는다 */
function sliceSafe(s, n){
  if(s.length<=n) return s;
  let k=n; const c=s.charCodeAt(k-1); if(c>=0xD800&&c<=0xDBFF) k--;
  return s.slice(0,k);
}
export function capText(s, suffix='… (잘림)'){ return s.length>LIMITS.cut ? sliceSafe(s, LIMITS.cut)+suffix : s; }
/* 쓰기 직전 안전망 — 모든 글자 셀을 한 번 더 본다(앞에서 놓친 것이 있어도 32,767자를 넘지 않게) */
export function guardCell(v){
  if(v==null) return v;
  const s=cleanText(v);
  return s.length>LIMITS.cell ? capText(s) : s;
}
function short(s, n=LIMITS.item){ const t=cleanText(s).replace(/[\n\t]+/g,' ').trim(); return t.length>n ? sliceSafe(t,n)+'…' : t; }

/* ---- 범위·원자료 (예전 내보내기와 같게) ---- */
/* 분류 대기·예정 업무는 아직 손 안 댄 메모라 보고용 목록에는 뺀다 — 오늘 처리·진행 중·완료만 담는다.
   (시간·담당자 모드에서는 오늘 두 열(metoday/othtoday)이 같은 역할. v2.5.1: 손댄(하위 업무 일부 완료) 업무가
   오늘 외 열에 있어도 빠지지 않게 started 조건) */
export function exportableItems(items, placeOf=boardPlaceOf){
  const started=it=>(it.subs||[]).some(s=>s.done);
  return (items||[]).filter(it=>{ const p=placeOf(it);
    return it.done||['today','doing','metoday','othtoday'].includes(p)||(['meplan','othplan'].includes(p)&&started(it)); });
}
const p2=n=>String(n).padStart(2,'0');
function toDate(v){ if(v==null||v==='') return null; const d=new Date(v); return isNaN(d)?null:d; }
export function fmtStamp(iso){ const d=toDate(iso); return d?`${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`:''; }
/* 원자료 한 줄 — 값은 예전 내보내기와 같다(자르기만 더한다) */
export function rawRow(it, placeOf=boardPlaceOf){
  const subs=it.subs||[], cs=it.contacts||[];
  return [
    PLACE_NAME[placeOf(it)],
    it.memo||'',
    cs.map(c=>c.who).filter(Boolean).join(', '),
    cs.map(c=>c.org).filter(Boolean).join(', '),
    cs.map(c=>c.phone).filter(Boolean).join(', '),
    cs.map(c=>c.email).filter(Boolean).join(', '),
    fmtStamp((it.f||{}).received),
    fmtStamp((it.f||{}).due),
    (it.ids||[]).map(x=>`${x.kind}: ${x.val}`).join(' · '),
    subs.length?`${subs.filter(s=>s.done).length}/${subs.length}`:'',
    subs.map(s=>(s.done?'[완료] ':'')+s.title+(s.mid?` (점검 ${fmtStamp(s.mid)})`:'')).join(' · '),
    (it.files||[]).join(' · '),
  ];
}

/* ---- 업무 목록 시트의 칸 ---- */
const WD='일월화수목금토';
const dayNo=d=>Math.round(new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime()/864e5);
function mdw(d, now){ return (d.getFullYear()!==now.getFullYear()?`${d.getFullYear()}-`:'')+`${p2(d.getMonth()+1)}-${p2(d.getDate())}(${WD[d.getDay()]})`; }

/* 메모 → 첫 줄(업무)과 나머지(내용). 첫 줄 = 처음으로 글이 있는 줄. 나머지의 앞뒤 빈 줄은 뺀다. */
export function memoParts(memo){
  const lines=cleanText(memo).split('\n');
  const i=lines.findIndex(l=>l.trim());
  if(i<0) return {title:'', body:[]};
  const body=lines.slice(i+1);
  while(body.length&&!body[0].trim()) body.shift();
  while(body.length&&!body[body.length-1].trim()) body.pop();
  return {title:lines[i].trim(), body};
}
/* 업무 칸·내용 칸과 '메모 전문' 시트로 보낼지(cut) */
export function memoCells(memo){
  const {title, body}=memoParts(memo);
  let cut=false, t=title;
  if(t.length>LIMITS.title){ t=sliceSafe(t,LIMITS.title)+'…'; cut=true; }
  const out=[]; let used=0, full=0, partial=false;
  for(const line of body){
    if(out.length>=LIMITS.bodyLines||used>=LIMITS.bodyChars){ cut=true; break; }
    const room=LIMITS.bodyChars-used;
    if(line.length>room){ out.push(sliceSafe(line,room)+'…'); partial=true; cut=true; break; }
    out.push(line); used+=line.length; full++;
  }
  const rest=body.length-full-(partial?1:0);
  if(rest>0) out.push(`… 아래 ${rest}줄 더 있음 ('${SHEET_NAMES.memo}' 시트)`);
  else if(partial) out.push(`(이어지는 내용은 '${SHEET_NAMES.memo}' 시트)`);
  return {title:t, body:out.join('\n'), cut};
}
/* 기한 칸: 글과 꾸밈 종류('late' 지남 · 'soon' 오늘·내일 · 'dim' 완료 · '' 보통) */
export function dueCell(it, now){
  if(it.done){
    const d=toDate(it.doneAt);
    return {text:d?`${mdw(d,now)} 완료`:'완료', tone:'dim'};
  }
  const d=toDate((it.f||{}).due);
  if(!d) return {text:'', tone:''};
  let text=`${mdw(d,now)} ${p2(d.getHours())}:${p2(d.getMinutes())}`, tone='';
  const diff=dayNo(d)-dayNo(now);
  if(diff<0){ text+=`\n${-diff}일 지남`; tone='late'; }
  else if(diff===0){ text+='\n오늘'; tone=d<now?'late':'soon'; }
  else if(diff===1){ text+='\n내일'; tone='soon'; }
  return {text, tone};
}
export function peopleCell(contacts){
  const ps=(contacts||[]).filter(c=>c&&(String(c.who||'').trim()||String(c.org||'').trim()));
  const lines=[];
  ps.slice(0,LIMITS.people).forEach(c=>{ if(String(c.who||'').trim()) lines.push(short(c.who)); if(String(c.org||'').trim()) lines.push(short(c.org)); });
  if(ps.length>LIMITS.people) lines.push(`외 ${ps.length-LIMITS.people}명`);
  return lines.join('\n');
}
export function subsCell(subs){
  const all=subs||[], ordered=all.filter(s=>!s.done).concat(all.filter(s=>s.done));
  const lines=ordered.slice(0,LIMITS.subs).map(s=>(s.done?'✓ ':'☐ ')+short(s.title));
  if(ordered.length>LIMITS.subs){
    const hidden=ordered.slice(LIMITS.subs), hd=hidden.filter(s=>s.done).length;
    lines.push(`외 ${hidden.length}개`+(hd?` · 끝낸 것 ${hd}개`:''));
  }
  return lines.join('\n');
}
export function idsCell(ids){
  const xs=ids||[];
  const lines=xs.slice(0,LIMITS.ids).map(x=>short(`${x.kind??''} ${x.val??''}`));
  if(xs.length>LIMITS.ids) lines.push(`외 ${xs.length-LIMITS.ids}개`);
  return lines.join('\n');
}

/* 보드와 같은 정렬: 남은 하위 업무 점검 시각·기한 가운데 가장 이른 것 → 시각 없는 것은 뒤에 새것부터(render.js render()) */
function boardSort(list){
  const kt=new Map();
  const key=it=>{ if(kt.has(it)) return kt.get(it);
    const ts=(it.subs||[]).filter(s=>!s.done&&s.mid).map(s=>new Date(s.mid).getTime()).filter(x=>!isNaN(x));
    const d=(it.f||{}).due?new Date(it.f.due).getTime():NaN; if(!isNaN(d)) ts.push(d);
    const k=ts.length?Math.min(...ts):null; kt.set(it,k); return k; };
  return list.sort((a,b)=>{ const at=key(a), bt=key(b);
    if(at!=null&&bt!=null&&at!==bt) return at-bt;
    if(at!=null&&bt==null) return -1; if(at==null&&bt!=null) return 1;
    return (b.id||0)-(a.id||0); });
}
/* 구역별로 묶는다 — [{key, name, items}] (빈 구역은 뺀다). 완료는 끝낸 때가 최근인 것부터(완료 탭과 같다). */
export function groupSections(items, placeOf=boardPlaceOf){
  const by=new Map();
  for(const it of items){ const k=it.done?'done':placeOf(it); if(!by.has(k)) by.set(k,[]); by.get(k).push(it); }
  const keys=SECTION_ORDER.filter(k=>by.has(k)).concat([...by.keys()].filter(k=>!SECTION_ORDER.includes(k)));
  return keys.map(k=>{
    const list=by.get(k);
    if(k==='done') list.sort((a,b)=>(b.doneAt||b.id||0)-(a.doneAt||a.id||0)); else boardSort(list);
    return {key:k, name:PLACE_NAME[k]||k, items:list};
  });
}

/* ---- 꾸밈(styles.xml) ----
   색은 앱의 색 토큰(src/styles.css :root, 디자인 정책.md)과 시안(총괄 reports/시안/뭐하려-했더라-엑셀-내보내기.html)에서 가져온다.
   fills 의 0·1 번은 규격이 예약한 자리(none, gray125)다. 번호를 바꾸면 아래 ST 와 함께 바꾼다. */
const C={ink:'FF131A24', soft:'FF687284', dim:'FF8A93A1', white:'FFFFFFFF', focus:'FF2A7C6E', line:'FFD9DDE3',
  late:'FF9B1B30', soon:'FFB34A26', secTodayFg:'FFB34A26', secTodayBg:'FFFBE9E2', secTodayBar:'FFD9623A',
  secTealFg:'FF1F6357', secTealBg:'FFEDF4F2', secDoneFg:'FF5A6472', secDoneBg:'FFEEF0F3', secDoneBar:'FF9AA3AE'};
const FONT_NAME='맑은 고딕';
const font=(o={})=>`<font>${o.b?'<b/>':''}<sz val="${o.sz||10}"/><color rgb="${o.c||C.ink}"/><name val="${FONT_NAME}"/><family val="3"/><charset val="129"/></font>`;
const FONTS=[font(), font({b:1}), font({b:1,sz:16}), font({c:C.soft}), font({b:1,c:C.white}), font({c:C.dim}), font({b:1,c:C.dim}),
  font({b:1,c:C.late}), font({b:1,c:C.soon}), font({b:1,c:C.secTodayFg}), font({b:1,c:C.secTealFg}), font({b:1,c:C.secDoneFg})];
const solid=rgb=>`<fill><patternFill patternType="solid"><fgColor rgb="${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;
const FILLS=['<fill><patternFill patternType="none"/></fill>','<fill><patternFill patternType="gray125"/></fill>',
  solid(C.focus), solid(C.secTodayBg), solid(C.secTealBg), solid(C.secDoneBg)];
const side=(n,st,rgb)=>`<${n} style="${st}"><color rgb="${rgb}"/></${n}>`;
const box=(left)=>`<border>${left||side('left','thin',C.line)}${side('right','thin',C.line)}${side('top','thin',C.line)}${side('bottom','thin',C.line)}<diagonal/></border>`;
const BORDERS=['<border><left/><right/><top/><bottom/><diagonal/></border>', box(), box(side('left','thick',C.secTodayBar)),
  box(side('left','thick',C.focus)), box(side('left','thick',C.secDoneBar))];
const WRAP_TOP='<alignment vertical="top" wrapText="1"/>';
/* cellXfs — [font, fill, border, alignment]. 0 번은 기본(꾸밈 없음) */
const XFS=[
  [0,0,0,''],                                            // 0 기본
  [2,0,0,'<alignment vertical="center"/>'],              // 1 제목 줄
  [3,0,0,'<alignment vertical="center"/>'],              // 2 기준 줄(흐림)
  [4,2,1,'<alignment vertical="center" wrapText="1"/>'], // 3 머리글(청록 채움·흰 굵은 글자)
  [0,0,1,WRAP_TOP],                                      // 4 본문
  [1,0,1,WRAP_TOP],                                      // 5 본문 굵게(업무)
  [5,0,1,WRAP_TOP],                                      // 6 완료 흐림
  [6,0,1,WRAP_TOP],                                      // 7 완료 흐림 굵게
  [7,0,1,WRAP_TOP],                                      // 8 기한 지남(붉은)
  [8,0,1,WRAP_TOP],                                      // 9 기한 오늘·내일(주홍)
  [9,3,2,'<alignment vertical="center"/>'],              // 10 구역 줄 — 오늘
  [10,4,3,'<alignment vertical="center"/>'],             // 11 구역 줄 — 진행 중·예정
  [11,5,4,'<alignment vertical="center"/>'],             // 12 구역 줄 — 완료
  [0,0,1,'<alignment horizontal="center" vertical="top"/>'], // 13 본문 가운데(진행)
  [5,0,1,'<alignment horizontal="center" vertical="top"/>'], // 14 완료 흐림 가운데
];
export const ST={title:1, meta:2, head:3, body:4, bold:5, dim:6, dimBold:7, late:8, soon:9, secToday:10, secTeal:11, secDone:12, center:13, dimCenter:14};
export function stylesXml(){
  const xf=([f,fi,b,al])=>`<xf numFmtId="0" fontId="${f}" fillId="${fi}" borderId="${b}" xfId="0"${f?' applyFont="1"':''}${fi?' applyFill="1"':''}${b?' applyBorder="1"':''}${al?' applyAlignment="1">'+al+'</xf>':'/>'}`;
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'+
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+
    `<fonts count="${FONTS.length}">${FONTS.join('')}</fonts>`+
    `<fills count="${FILLS.length}">${FILLS.join('')}</fills>`+
    `<borders count="${BORDERS.length}">${BORDERS.join('')}</borders>`+
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'+
    `<cellXfs count="${XFS.length}">${XFS.map(xf).join('')}</cellXfs>`+
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'+
    '<dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium9" defaultPivotStyle="PivotStyleMedium4"/>'+
    '</styleSheet>';
}
export const STYLE_COUNT=XFS.length;
const SEC_STYLE=k=>k==='done'?ST.secDone:(['today','metoday','othtoday'].includes(k)?ST.secToday:ST.secTeal);

/* ---- 시트 짜기 ----
   시트 하나 = {name, rows: 값 2차원 배열(null=셀 없음), st: 꾸밈 번호 2차원 배열, cols: 열 너비(wch), hts: 줄 높이(pt),
   merges, freeze: 고정할 줄 수, autofilter, print: 인쇄 설정을 넣을지} */
function newSheet(name, cols){ return {name, cols, rows:[], st:[], hts:[], merges:[], freeze:0, autofilter:null, print:false, fit:false}; }
function push(sh, vals, sts, ht){ sh.rows.push(vals); sh.st.push(sts); sh.hts.push(ht??null); return sh.rows.length-1; }
const fill=(n,v)=>Array.from({length:n},()=>v);

const LIST_W=[26,46,16,16,7,34,22];
const CONTACT_W=[30,18,12,15,24,50];
const MEMO_W=[30,100];

export function buildSheets(items, {now=new Date(), placeOf=boardPlaceOf}={}){
  const exp=exportableItems(items, placeOf);
  const groups=groupSections(exp, placeOf);
  const memoCut=[];

  /* ① 업무 목록 */
  const L=newSheet(SHEET_NAMES.list, LIST_W); L.freeze=3; L.print=true; L.fit=true;
  const n=LIST_HEAD.length, ongoing=exp.filter(it=>!it.done).length, done=exp.length-ongoing;
  push(L, ['업무 목록', ...fill(n-1,null)], [ST.title, ...fill(n-1,0)], 28);
  push(L, [`${fmtStamp(now)} 기준 · 진행 중인 업무 ${ongoing}건 · 완료 ${done}건`, ...fill(n-1,null)], [ST.meta, ...fill(n-1,0)], 18);
  L.merges.push({s:{r:0,c:0},e:{r:0,c:n-1}}, {s:{r:1,c:0},e:{r:1,c:n-1}});
  push(L, LIST_HEAD.slice(), fill(n, ST.head), 22);
  for(const g of groups){
    const r=push(L, [`${g.name} · ${g.items.length}건`, ...fill(n-1,'')], fill(n, SEC_STYLE(g.key)), 22);
    L.merges.push({s:{r,c:0},e:{r,c:n-1}});
    for(const it of g.items){
      const m=memoCells(it.memo);
      if(m.cut) memoCut.push(it);
      const due=dueCell(it, now), subs=it.subs||[];
      const vals=[m.title||'(메모 없음)', m.body, due.text, peopleCell(it.contacts),
        subs.length?`${subs.filter(s=>s.done).length}/${subs.length}`:'', subsCell(subs), idsCell(it.ids)];
      const dim=!!it.done;
      const sts=dim ? [ST.dimBold, ST.dim, ST.dim, ST.dim, ST.dimCenter, ST.dim, ST.dim]
        : [ST.bold, ST.body, due.tone==='late'?ST.late:due.tone==='soon'?ST.soon:ST.body, ST.body, ST.center, ST.body, ST.body];
      push(L, vals, sts, rowHeight(vals, LIST_W));
    }
  }

  /* ② 연락처·파일 — 관련인 한 사람에 한 줄, 업무 이름과 파일 링크는 그 업무의 첫 줄에만 */
  const K=newSheet(SHEET_NAMES.contacts, CONTACT_W); K.freeze=1; K.print=true; K.fit=true;
  push(K, CONTACT_HEAD.slice(), fill(CONTACT_HEAD.length, ST.head), 22);
  for(const g of groups) for(const it of g.items){
    const cs=(it.contacts||[]).filter(c=>c&&(c.who||c.org||c.phone||c.email)), files=(it.files||[]).filter(Boolean);
    if(!cs.length&&!files.length) continue;
    const title=memoCells(it.memo).title||'(메모 없음)';
    const rows=Math.max(1, cs.length);
    for(let i=0;i<rows;i++){
      const c=cs[i]||{};
      const vals=[i?'':title, c.org||'', c.who||'', c.phone||'', c.email||'', i?'':capText(cleanText(files.join('\n')))];
      push(K, vals, [ST.bold, ST.body, ST.body, ST.body, ST.body, ST.body], rowHeight(vals, CONTACT_W));
    }
  }

  /* ③ 메모 전문 — 메모 한 줄을 시트 한 줄에. 긴 줄은 MEMO_CHUNK 자씩 끊어 잇는다.
     설계서는 32,000자씩으로 적었으나 그러면 한 줄이 엑셀 줄 높이 한도(409pt)를 넘어 셀 안에서 잘려 보인다.
     메모 열(너비 100)에 한글 1,000자 ≈ 21줄 ≈ 318pt 라 한도 아래에 다 보인다. */
  let M=null;
  if(memoCut.length){
    M=newSheet(SHEET_NAMES.memo, MEMO_W); M.freeze=1; M.print=true; M.fit=true;
    push(M, MEMO_HEAD.slice(), [ST.head, ST.head], 22);
    memoCut.forEach((it,idx)=>{
      if(idx) push(M, [null,null], [0,0], null);
      const title=memoCells(it.memo).title;
      let first=true;
      for(const line of cleanText(it.memo).split('\n')){
        /* 서로게이트 짝을 가르지 않게 잘라 낸 실제 길이만큼 넘어간다 */
        let rest=line; const parts=[];
        do{ const p=sliceSafe(rest, LIMITS.memoChunk); parts.push(p); rest=rest.slice(p.length); }while(rest.length);
        for(const p of parts){
          const vals=[first?title:'', p];
          push(M, vals, [ST.bold, ST.body], rowHeight(vals, MEMO_W));
          first=false;
        }
      }
    });
  }

  /* ④ 원자료 */
  const R=newSheet(SHEET_NAMES.raw, null);
  push(R, RAW_COLUMNS.slice(), fill(RAW_COLUMNS.length, ST.head), null);
  const rawRows=exp.map(it=>rawRow(it, placeOf).map((v,i)=>capText(cleanText(v), i===1?`… (잘림. 전체는 '${SHEET_NAMES.memo}' 시트)`:'… (잘림)')));
  rawRows.forEach(v=>push(R, v, fill(RAW_COLUMNS.length, 0), null));
  /* 열 너비는 예전 내보내기와 같은 식 */
  R.cols=RAW_COLUMNS.map((c,i)=>Math.max(10, Math.min(46, rawRows.reduce((m,r)=>Math.max(m, String(r[i]||'').length*1.7), c.length*2))));
  R.freeze=1; R.autofilter={ref:`A1:${String.fromCharCode(64+RAW_COLUMNS.length)}${rawRows.length+1}`};

  return {sheets:[L, K, M, R].filter(Boolean), count:exp.length};
}

/* ---- 꾸러미 만들기 ---- */
const enc=s=>new TextEncoder().encode(s);
const dec=b=>new TextDecoder('utf-8').decode(b);
function sheetViewsXml(sh, first){
  const attrs=`${first?' tabSelected="1"':''}${first?' showGridLines="0"':''} workbookViewId="0"`;
  if(!sh.freeze) return `<sheetViews><sheetView${attrs}/></sheetViews>`;
  const top=`A${sh.freeze+1}`;
  return `<sheetViews><sheetView${attrs}><pane ySplit="${sh.freeze}" topLeftCell="${top}" activePane="bottomLeft" state="frozen"/>`+
    `<selection pane="bottomLeft" activeCell="${top}" sqref="${top}"/></sheetView></sheetViews>`;
}
/* SheetJS 가 쓴 시트 XML 에 꾸밈 번호·sheetPr·틀 고정·인쇄 설정을 넣는다 */
export function patchSheetXml(xml, sh, first){
  if(/<sheetPr[\s>/]/.test(xml)) throw new Error('예상 밖의 sheetPr');
  if(!/<sheetViews>[\s\S]*?<\/sheetViews>/.test(xml)) throw new Error('sheetViews 를 찾지 못했습니다');
  /* 셀 꾸밈 번호 — 열은 A~Z 한 글자(이 모듈의 시트는 12열 이하) */
  xml=xml.replace(/<c r="([A-Z])(\d+)"/g, (m,col,row)=>{
    const s=(sh.st[row-1]||[])[col.charCodeAt(0)-65];
    return s ? `${m} s="${s}"` : m;
  });
  /* SheetJS 는 줄바꿈이 든 줄·셀 태그에도 xml:space 를 붙인다 — 엑셀이 쓰지 않는 자리라 값(<v>)에만 남긴다 */
  xml=xml.replace(/<(row|c) ([^>]*?) xml:space="preserve"/g, '<$1 $2');
  xml=xml.replace(/(<worksheet[^>]*>)/, `$1${sh.fit?'<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>':''}`);
  xml=xml.replace(/<sheetViews>[\s\S]*?<\/sheetViews>/, sheetViewsXml(sh, first));
  if(sh.print){
    const tail='<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>'+
      `<pageSetup paperSize="9" orientation="landscape"${sh.fit?' fitToWidth="1" fitToHeight="0"':''}/>`;
    xml=xml.includes('<ignoredErrors') ? xml.replace('<ignoredErrors', tail+'<ignoredErrors') : xml.replace('</worksheet>', tail+'</worksheet>');
  }
  return xml;
}

/* 업무 목록 → .xlsx 바이트. XLSX 는 SheetJS 전역(앱은 needXlsx() 뒤 window.XLSX, 시험은 require) */
export function buildXlsx(XLSX, items, opts={}){
  const {sheets}=buildSheets(items, opts);
  const wb=XLSX.utils.book_new();
  for(const sh of sheets){
    /* 안전망: 쓰기 직전에 모든 글자 셀을 한 번 더 본다 */
    const rows=sh.rows.map(r=>r.map(guardCell));
    const ws=XLSX.utils.aoa_to_sheet(rows);
    ws['!cols']=sh.cols.map(w=>({wch:w}));
    ws['!rows']=sh.hts.map(h=>h?{hpt:h}:null);
    if(sh.merges.length) ws['!merges']=sh.merges;
    if(sh.autofilter) ws['!autofilter']=sh.autofilter;
    XLSX.utils.book_append_sheet(wb, ws, sh.name);
  }
  /* 인쇄 제목: 업무 목록의 머리글 줄을 쪽마다 되풀이 */
  wb.Workbook={Names:[{Name:'_xlnm.Print_Titles', Sheet:0, Ref:`'${SHEET_NAMES.list}'!$3:$3`}]};
  const raw=new Uint8Array(XLSX.write(wb, {type:'array', bookType:'xlsx'}));
  const z=XLSX.CFB.read(raw, {type:'array'});
  const put=(path, text)=>{ const f=XLSX.CFB.find(z, path); if(!f) throw new Error(path+' 가 없습니다'); const b=enc(text); f.content=b; f.size=b.length; };
  put('/xl/styles.xml', stylesXml());
  sheets.forEach((sh,i)=>{
    const f=XLSX.CFB.find(z, `/xl/worksheets/sheet${i+1}.xml`);
    if(!f) throw new Error(`sheet${i+1}.xml 이 없습니다`);
    put(`/xl/worksheets/sheet${i+1}.xml`, patchSheetXml(dec(f.content), sh, i===0));
  });
  /* SheetJS 의 CFB 그릇에 들어 있는 표지 항목(Sh33tJ5)은 꾸러미에 남기지 않는다 */
  z.FullPaths.filter(p=>/Sh33tJ5$/.test(p)).forEach(p=>XLSX.CFB.utils.cfb_del(z, p.replace(/^Root Entry/,'')));
  return new Uint8Array(XLSX.CFB.write(z, {fileType:'zip', type:'array', compression:true}));
}

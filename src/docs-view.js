/* =========================================================================
   문서 탭 미리보기 — 파일 바이트 → HTML. 상태·Tauri 없음(DOMParser·전역 XLSX·vendor 만 씀).
   v3.8.1 순서(docs.js): 그림·PDF·글자 파일은 앱 안에서 그리고, 나머지는 먼저 **Windows 탐색기 미리 보기 처리기**
   (preview.rs — 한컴·Office 가 설치돼 있으면 그 프로그램이 그리는 모습 그대로)를 쓰고, 처리기가 없을 때만 아래 대체본:
   · HWPX(한글) / PPTX(파워포인트) = zip 안의 XML 에서 **글자와 표만** 뽑는다. 쪽 모양·글꼴·색·그림은 재현하지 않는다.
   · XLSX·XLS = 이미 든 SheetJS 로 표. 시트 전환.
   · PDF = pdf.js(vendor/pdfjs, Apache-2.0), MD = marked(MIT) + DOMPurify(Apache-2.0/MPL) — 처음 쓸 때만 불러온다.
   zip 풀기는 SheetJS 에 든 XLSX.CFB(zip 도 읽는다)를 쓴다.
   ========================================================================= */
import {esc} from './dom-utils.js';

export const XLSX_ROW_MAX = 5000;          // 시트당 그리는 행 상한(설계 5.3)
export const XLSX_COL_MAX = 200;

/* 확장자 → 종류 */
/* v3.8.1 앱 안에서 바로 고치는 글자 파일(상용 편집 프로그램이 따로 없는 형식 — 소유자 지정) */
export const TEXT_EXT=new Set(['txt','text','log','md','markdown','csv','tsv','json','jsonc','xml','html','htm','css','js','mjs','cjs','ts','tsx','jsx',
  'py','rs','java','kt','c','h','cpp','hpp','cs','go','rb','php','sh','bat','cmd','ps1','sql','ini','cfg','conf','yaml','yml','toml','properties','reg','srt','vtt','tex','r','lua','vb','vbs']);
export const IMG_MIME={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',jfif:'image/jpeg',gif:'image/gif',bmp:'image/bmp',webp:'image/webp',svg:'image/svg+xml',ico:'image/x-icon',avif:'image/avif'};
export const MEDIA_MIME={mp4:'video/mp4',m4v:'video/mp4',webm:'video/webm',mov:'video/mp4',mp3:'audio/mpeg',m4a:'audio/mp4',wav:'audio/wav',ogg:'audio/ogg',oga:'audio/ogg',flac:'audio/flac'};
export const extOf = name => { const n=String(name||'').toLowerCase(), i=n.lastIndexOf('.'); return i>0 ? n.slice(i+1) : ''; };
export function docKind(name){
  const ext=extOf(name);
  if(ext==='hwpx') return 'hwpx';
  if(ext==='hwp') return 'hwp';
  if(ext==='pptx'||ext==='ppt') return 'pptx';
  if(['xlsx','xlsm','xls'].includes(ext)) return 'xlsx';
  if(ext==='docx'||ext==='doc') return 'docx';
  if(ext==='pdf') return 'pdf';
  if(ext==='md'||ext==='markdown') return 'md';
  if(ext==='csv'||ext==='tsv') return 'csv';
  if(ext==='html'||ext==='htm') return 'html';
  if(ext==='zip') return 'zip';
  if(IMG_MIME[ext]) return 'img';
  if(MEDIA_MIME[ext]) return 'media';
  if(TEXT_EXT.has(ext)) return 'text';
  return 'other';
}
/* 바깥 프로그램 열기 단추 이름 */
export function openLabel(kind){
  return kind==='hwpx'||kind==='hwp' ? '한글에서 열기' : kind==='xlsx'||kind==='csv' ? '엑셀에서 열기' : kind==='pptx' ? '파워포인트에서 열기' : kind==='docx' ? '워드에서 열기' : '열기';
}
/* 앱 안 그리기만 쓰는 형식(탐색기 미리 보기 처리기를 부르지 않는다) */
export const inApp = kind => ['img','pdf','md','csv','html','text','media'].includes(kind);
export const isTextKind = kind => kind==='md'||kind==='csv'||kind==='html'||kind==='text';

/* MD → 안전한 HTML(스크립트·이벤트 속성 제거). 상대 경로 그림은 화면(docs.js)이 파일을 읽어 바꿔 넣는다. */
let mdLib=null;
export async function mdHtml(text){
  if(!mdLib){
    const [{marked}, pur]=await Promise.all([import('./vendor/marked.esm.js'), import('./vendor/purify.es.mjs')]);
    const DOMPurify=(pur.default && pur.default.sanitize) ? pur.default : pur.default(window);
    mdLib={marked, DOMPurify};
  }
  const raw=mdLib.marked.parse(String(text||''), {gfm:true, breaks:true, async:false});
  return mdLib.DOMPurify.sanitize(raw, {FORBID_TAGS:['style','form','input','button','iframe','object','embed'], FORBID_ATTR:['style']});
}
/* ── 코드·쿼리 색 강조(v3.8.4) — highlight.js 11(BSD-3, vendor/highlight.min.js: 자주 쓰는 언어 36종). 처음 쓸 때만 불러온다.
   확장자 → 언어. 여기 없는 확장자(txt·csv·log 등)는 색을 입히지 않는다. */
const CODE_LANG={js:'javascript',mjs:'javascript',cjs:'javascript',jsx:'javascript',ts:'typescript',tsx:'typescript',json:'json',jsonc:'json',
  py:'python',sql:'sql',xml:'xml',html:'xml',htm:'xml',css:'css',scss:'scss',less:'less',java:'java',kt:'kotlin',c:'c',h:'c',cpp:'cpp',hpp:'cpp',cs:'csharp',
  go:'go',rs:'rust',rb:'ruby',php:'php',sh:'bash',yaml:'yaml',yml:'yaml',toml:'ini',ini:'ini',cfg:'ini',conf:'ini',properties:'ini',
  md:'markdown',markdown:'markdown',lua:'lua',r:'r',vb:'vbnet',vbs:'vbnet',swift:'swift',pl:'perl',diff:'diff'};
export const codeLang = name => CODE_LANG[extOf(name)] || null;
export const CODE_HL_MAX=400000;                     // 이보다 긴 글자는 색을 입히지 않는다(입력이 느려지지 않게)
let hlLib=null;
async function hl(){ if(!hlLib) hlLib=(await import('./vendor/highlight.min.js')).default; return hlLib; }
/* 글자 → 색 입힌 HTML(이스케이프됨). 언어를 모르거나 실패하면 null */
export async function codeHtml(text, lang){
  const h=await hl();
  if(!lang || !h.getLanguage(lang)) return null;
  try{ return h.highlight(String(text||''), {language:lang, ignoreIllegals:true}).value; }catch{ return null; }
}
/* MD 보기 안의 코드 블록(```sql 처럼 언어를 적은 것)에 색 */
export async function highlightBlocks(root){
  const blocks=[...root.querySelectorAll('pre code')];
  if(!blocks.length) return;
  const h=await hl();
  for(const c of blocks){
    const m=/(?:^|\s)language-([\w+-]+)/.exec(c.className||''); if(!m) continue;
    const lang=h.getLanguage(m[1]) ? m[1] : null; if(!lang) continue;
    try{ c.innerHTML=h.highlight(c.textContent, {language:lang, ignoreIllegals:true}).value; c.classList.add('hljs'); }catch{}
  }
}

/* ── CSV 표 편집(v3.8.4) — 글자 ↔ 칸. 따옴표 규칙(RFC 4180): 구분자·따옴표·줄바꿈이 든 칸만 따옴표로 감싼다 ── */
export const CSV_EDIT_MAX_ROWS=2000, CSV_EDIT_MAX_COLS=60;
export function parseCsv(text, delim){
  const d=delim||',', rows=[]; let row=[], cell='', q=false, i=0; const s=String(text||'');
  while(i<s.length){
    const c=s[i];
    if(q){
      if(c==='"'){ if(s[i+1]==='"'){ cell+='"'; i+=2; continue; } q=false; i++; continue; }
      cell+=c; i++; continue;
    }
    if(c==='"' && cell===''){ q=true; i++; continue; }
    if(c===d){ row.push(cell); cell=''; i++; continue; }
    if(c==='\r'){ i++; continue; }
    if(c==='\n'){ row.push(cell); rows.push(row); row=[]; cell=''; i++; continue; }
    cell+=c; i++;
  }
  if(cell!=='' || row.length){ row.push(cell); rows.push(row); }
  return rows;
}
export function toCsv(rows, delim){
  const d=delim||',';
  const q=v=>{ const t=String(v??''); return (t.includes(d)||t.includes('"')||t.includes('\n')||t.includes('\r')) ? '"'+t.replace(/"/g,'""')+'"' : t; };
  return rows.map(r=>r.map(q).join(d)).join('\n')+(rows.length?'\n':'');
}
/* 고칠 수 있는 표 HTML — 칸마다 data-r/data-c. 너무 크면 null(읽기 전용 표로) */
export function csvEditHtml(rows){
  if(rows.length>CSV_EDIT_MAX_ROWS) return null;
  const w=rows.reduce((m,r)=>Math.max(m,r.length),0);
  if(w>CSV_EDIT_MAX_COLS) return null;
  return `<table class="dv-table dv-sheet dv-csv">${rows.map((r,ri)=>`<tr><th>${ri+1}</th>${Array.from({length:Math.max(w,1)},(_,ci)=>`<td contenteditable="plaintext-only" spellcheck="false" data-r="${ri}" data-c="${ci}">${esc(r[ci]??'')}</td>`).join('')}</tr>`).join('')}</table>`;
}

/* CSV/TSV 글자 → 표 HTML(SheetJS) */
export function csvHtml(text, tsv){
  const wb=window.XLSX.read(String(text||''), {type:'string', raw:true, FS: tsv?'\t':undefined});
  return xlsxBook(null, wb).html(0);
}

/* PDF — pdf.js 로 쪽마다 canvas. 돌려주는 함수를 부르면 정리한다.
   v3.8.4: 쪽은 보일 때 읽고(쪽이 수백 장이어도 바로 뜬다), 화면에서 멀어진 쪽의 그림은 놓아 준다(쪽당 수십 MB),
   한 쪽 그림 폭은 4096px 까지(확대해도 메모리가 터지지 않게). 암호 걸린 PDF 는 알기 쉬운 말로. */
let pdfLib=null;
const PDF_MAX_PX=4096;
export async function renderPdf(box, bytes){
  if(!pdfLib){
    pdfLib=await import('./vendor/pdfjs/pdf.min.mjs');
    pdfLib.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  }
  const base=new URL('./vendor/pdfjs/', import.meta.url).href;
  let doc;
  try{ doc=await pdfLib.getDocument({data:bytes, cMapUrl:base+'cmaps/', cMapPacked:true, standardFontDataUrl:base+'standard_fonts/', isEvalSupported:false, useSystemFonts:true}).promise; }
  catch(e){ throw new Error(/password/i.test(String(e&&e.name)+String(e&&e.message)) ? '암호가 걸린 PDF — [열기]로 보세요' : 'PDF 를 읽지 못함 — '+(e&&e.message||e)); }
  box.innerHTML=`<div class="dv-pdf-bar"><span class="num">${doc.numPages}쪽</span><button type="button" class="seg-btn" data-pdfz="-1" title="작게">−</button><span class="num dv-pdf-z">100%</span><button type="button" class="seg-btn" data-pdfz="1" title="크게">＋</button></div><div class="dv-pdf"></div>`;
  const wrap=box.querySelector('.dv-pdf'), zl=box.querySelector('.dv-pdf-z');
  let zoom=1, dead=false, ratio=1.414;
  try{ const v=(await doc.getPage(1)).getViewport({scale:1}); ratio=v.height/v.width; }catch{}
  const pages=[];
  for(let n=1;n<=doc.numPages;n++){
    const c=document.createElement('canvas'); c.className='dv-pdf-pg'; c.dataset.pg=String(n); c.width=1; c.height=1; wrap.appendChild(c);
    pages.push({n, c, pg:null, ratio, drawn:0, busy:false, on:false});
  }
  const fitW=()=>Math.max(200, wrap.clientWidth-24);
  const size=p=>{ const w=fitW()*zoom; p.c.style.width=w+'px'; p.c.style.height=(w*p.ratio)+'px'; };
  const layout=()=>{ for(const p of pages){ size(p); p.drawn=0; } };
  const draw=async p=>{
    const key=Math.min(PDF_MAX_PX, Math.round(fitW()*zoom*(window.devicePixelRatio||1)));
    if(p.drawn===key || p.busy || dead) return;
    p.busy=true;
    try{
      if(!p.pg) p.pg=await doc.getPage(p.n);
      const v1=p.pg.getViewport({scale:1}); p.ratio=v1.height/v1.width; size(p);
      const vp=p.pg.getViewport({scale:key/v1.width});
      if(!dead && p.on){
        p.c.width=Math.floor(vp.width); p.c.height=Math.floor(vp.height);
        await p.pg.render({canvasContext:p.c.getContext('2d'), viewport:vp}).promise;
        p.drawn=key;
      }
    }catch(e){ console.warn('pdf 쪽 그리기 실패', e); }
    p.busy=false;
    if(!dead && p.on && p.drawn!==Math.min(PDF_MAX_PX, Math.round(fitW()*zoom*(window.devicePixelRatio||1)))) draw(p);   // 그리는 사이 크기가 바뀌었다
  };
  const drop=p=>{ if(p.busy) return; p.c.width=1; p.c.height=1; p.drawn=0; };
  const io=new IntersectionObserver(es=>{ for(const e of es){ const p=pages[Number(e.target.dataset.pg)-1]; if(!p) continue; p.on=e.isIntersecting; if(p.on) draw(p); else drop(p); } }, {root:box.closest('.dv-content')||null, rootMargin:'800px 0px'});
  layout(); pages.forEach(p=>io.observe(p.c));
  const redraw=()=>{ layout(); pages.forEach(p=>{ if(p.on) draw(p); }); };
  const ro=new ResizeObserver(()=>{ if(Math.abs((ro.w||0)-wrap.clientWidth)>4){ ro.w=wrap.clientWidth; redraw(); } }); ro.w=wrap.clientWidth; ro.observe(wrap);
  box.querySelector('.dv-pdf-bar').addEventListener('click', e=>{
    const b=e.target.closest('[data-pdfz]'); if(!b) return;
    zoom=Math.min(3, Math.max(0.5, Math.round((zoom+Number(b.dataset.pdfz)*0.25)*100)/100)); zl.textContent=Math.round(zoom*100)+'%'; redraw();
  });
  return ()=>{ dead=true; io.disconnect(); ro.disconnect(); try{ doc.destroy(); }catch{} };
}

/* zip → {경로: Uint8Array} */
export function unzip(bytes){
  const z=window.XLSX.CFB.read(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), {type:'array'});
  const out={};
  z.FullPaths.forEach((p,i)=>{ const f=z.FileIndex[i]; if(f && f.type===2 && f.content) out[p.replace(/^Root Entry\//,'')]=f.content instanceof Uint8Array?f.content:new Uint8Array(f.content); });
  return out;
}
const xml = bytes => new DOMParser().parseFromString(new TextDecoder('utf-8').decode(bytes), 'application/xml');
const kids = (el, name) => [...el.children].filter(c=>c.localName===name);
const num = (s, re) => Number((String(s).match(re)||[])[1]||0);

/* 한 덩어리(문단 묶음)를 훑어 문단 글자와 표를 순서대로 HTML 로. 표 안은 그 표가 따로 그린다. */
function walkBlock(el, para, tbl, t){
  const out=[];
  const visit=node=>{
    for(const c of node.children){
      if(c.localName===tbl){ out.push(tableHtml(c, para, tbl, t)); continue; }
      if(c.localName===para){
        const texts=[], inner=[];
        const grab=n=>{ for(const d of n.children){ if(d.localName===tbl){ inner.push(tableHtml(d, para, tbl, t)); continue; } if(d.localName===t){ texts.push(d.textContent); continue; } grab(d); } };
        grab(c);
        const s=texts.join('');
        out.push(s.trim() ? `<p>${esc(s)}</p>` : '<p class="dv-blank"></p>');
        out.push(...inner);
        continue;
      }
      visit(c);
    }
  };
  visit(el);
  /* 빈 문단이 줄줄이 이어지면 하나로 */
  return out.join('').replace(/(<p class="dv-blank"><\/p>){2,}/g, '<p class="dv-blank"></p>');
}
function tableHtml(tbl, para, tblName, t){
  const rows=[...tbl.getElementsByTagNameNS('*','tr')].filter(r=>r.closest && nearestTbl(r, tblName)===tbl);
  return `<table class="dv-table">${rows.map(r=>`<tr>${[...r.children].filter(c=>c.localName==='tc').map(c=>{
    const span=[...c.children].find(x=>x.localName==='cellSpan');               // HWPX: <hp:cellSpan colSpan rowSpan>
    const cs=Number(c.getAttribute('gridSpan')||(span&&span.getAttribute('colSpan'))||1), rs=Number(c.getAttribute('rowSpan')||(span&&span.getAttribute('rowSpan'))||1);
    if(c.getAttribute('hMerge')==='1'||c.getAttribute('vMerge')==='1') return '';   // PPTX 병합된 빈 칸
    return `<td${cs>1?` colspan="${cs}"`:''}${rs>1?` rowspan="${rs}"`:''}>${walkBlock(c, para, tblName, t)}</td>`;
  }).join('')}</tr>`).join('')}</table>`;
}
function nearestTbl(el, tblName){ let p=el.parentElement; while(p){ if(p.localName===tblName) return p; p=p.parentElement; } return null; }

/* HWPX: Contents/section0.xml, section1.xml … 순서대로 */
export function hwpxHtml(files){
  const secs=Object.keys(files).filter(k=>/(^|\/)Contents\/section\d+\.xml$/i.test(k)).sort((a,b)=>num(a,/section(\d+)/i)-num(b,/section(\d+)/i));
  if(!secs.length) throw new Error('HWPX 본문을 찾지 못함');
  return secs.map(k=>`<section class="dv-sec">${walkBlock(xml(files[k]).documentElement, 'p', 'tbl', 't')}</section>`).join('');
}
/* PPTX: ppt/slides/slide1.xml … 슬라이드마다 한 칸 */
export function pptxHtml(files){
  const slides=Object.keys(files).filter(k=>/(^|\/)ppt\/slides\/slide\d+\.xml$/i.test(k)).sort((a,b)=>num(a,/slide(\d+)\.xml/i)-num(b,/slide(\d+)\.xml/i));
  if(!slides.length) throw new Error('PPTX 슬라이드를 찾지 못함');
  return slides.map((k,i)=>`<section class="dv-slide"><div class="dv-slide-no">슬라이드 ${i+1}</div>${walkBlock(xml(files[k]).documentElement, 'p', 'tbl', 't')}</section>`).join('');
}
/* DOCX: word/document.xml — 문단 글자와 표(HWPX 와 같은 훑기) */
export function docxHtml(files){
  const k=Object.keys(files).find(p=>/(^|\/)word\/document\.xml$/i.test(p));
  if(!k) throw new Error('DOCX 본문을 찾지 못함');
  return `<section class="dv-sec">${walkBlock(xml(files[k]).documentElement, 'p', 'tbl', 't')}</section>`;
}
/* HWP(5.x, 이진) — 파일에 든 미리 보기 글자(PrvText, 앞부분만)를 꺼낸다. 본문 전체는 한글 프로그램이 있어야 한다. */
export function hwpText(files){
  const b=files['PrvText']; if(!b) throw new Error('HWP 미리 보기 글자가 없음');
  return new TextDecoder('utf-16le').decode(b).replace(/\0+$/,'');
}
/* 문서에 든 첫 쪽 그림(만든 프로그램이 저장해 둔 것) — HWP·HWPX: PrvImage, PPTX: thumbnail. 없으면 null */
export function docThumb(files){
  for(const [k,b] of Object.entries(files)){
    if(!/(^|\/)(PrvImage(\.\w+)?|thumbnail\.(jpe?g|png))$/i.test(k) || !b || b.length<100) continue;
    const mime = b[0]===0x89&&b[1]===0x50 ? 'image/png' : b[0]===0xFF&&b[1]===0xD8 ? 'image/jpeg' : b[0]===0x47&&b[1]===0x49 ? 'image/gif' : b[0]===0x42&&b[1]===0x4D ? 'image/bmp' : null;
    if(mime) return {bytes:b, mime};
  }
  return null;
}
/* ZIP 안 목록 — [{name, size}] (폴더 줄 제외, 이름순) */
export function zipList(bytes){
  const z=window.XLSX.CFB.read(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), {type:'array'});
  const out=[];
  z.FullPaths.forEach((p,i)=>{ const f=z.FileIndex[i]; const name=zipName(p.replace(/^Root Entry\//,'')); if(f && f.type===2 && name && !name.includes('Sh33tJ5')) out.push({name, size:f.size||(f.content?f.content.length:0)}); });
  return out.sort((a,b)=>a.name.localeCompare(b.name));
}
/* SheetJS 는 zip 안 이름을 바이트 그대로 준다 — UTF-8, 아니면 EUC-KR(옛 한글 Windows 압축)로 되살린다 */
function zipName(raw){
  const s=String(raw).replace(/\\/g,'/');
  if(!/[\x80-\xff]/.test(s) || /[^\x00-\xff]/.test(s)) return s;          // 이미 제대로 된 이름(또는 영문)이면 그대로
  const b=Uint8Array.from(s, c=>c.charCodeAt(0));
  try{ return new TextDecoder('utf-8', {fatal:true}).decode(b); }catch{}
  try{ return new TextDecoder('euc-kr', {fatal:true}).decode(b); }catch{}
  return s;
}

/* XLSX: 통합 문서 → {names, html(i)} */
export function xlsxBook(bytes, given){
  const wb=given || window.XLSX.read(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), {type:'array', cellDates:true});
  return {
    names: wb.SheetNames.slice(),
    html(i){
      const ws=wb.Sheets[wb.SheetNames[i]]; if(!ws) return '';
      const rows=window.XLSX.utils.sheet_to_json(ws, {header:1, raw:false, defval:''});
      const shown=rows.slice(0, XLSX_ROW_MAX);
      const w=Math.min(XLSX_COL_MAX, shown.reduce((m,r)=>Math.max(m,r.length),0));
      const body=shown.map((r,ri)=>`<tr><th>${ri+1}</th>${Array.from({length:w},(_,ci)=>`<td>${esc(r[ci]??'')}</td>`).join('')}</tr>`).join('');
      return (rows.length ? `<table class="dv-table dv-sheet">${body}</table>` : '<div class="dv-empty">빈 시트</div>')
        + (rows.length>XLSX_ROW_MAX ? `<div class="dv-cap">${rows.length}행 중 ${XLSX_ROW_MAX}행 표시</div>` : '');
    }
  };
}

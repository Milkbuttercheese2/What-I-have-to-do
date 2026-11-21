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
export const inApp = kind => ['img','pdf','md','csv','text','media'].includes(kind);
export const isTextKind = kind => kind==='md'||kind==='csv'||kind==='text';

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
/* CSV/TSV 글자 → 표 HTML(SheetJS) */
export function csvHtml(text, tsv){
  const wb=window.XLSX.read(String(text||''), {type:'string', raw:true, FS: tsv?'\t':undefined});
  return xlsxBook(null, wb).html(0);
}

/* PDF — pdf.js 로 쪽마다 canvas. 보이는 쪽만 그린다(쪽이 많아도 가볍게). 돌려주는 함수를 부르면 정리한다. */
let pdfLib=null;
export async function renderPdf(box, bytes){
  if(!pdfLib){
    pdfLib=await import('./vendor/pdfjs/pdf.min.mjs');
    pdfLib.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  }
  const base=new URL('./vendor/pdfjs/', import.meta.url).href;
  const task=pdfLib.getDocument({data:bytes, cMapUrl:base+'cmaps/', cMapPacked:true, standardFontDataUrl:base+'standard_fonts/', isEvalSupported:false, useSystemFonts:true});
  const doc=await task.promise;
  box.innerHTML=`<div class="dv-pdf-bar"><span class="num">${doc.numPages}쪽</span><button type="button" class="seg-btn" data-pdfz="-1">−</button><span class="num dv-pdf-z">100%</span><button type="button" class="seg-btn" data-pdfz="1">＋</button></div><div class="dv-pdf"></div>`;
  const wrap=box.querySelector('.dv-pdf'), zl=box.querySelector('.dv-pdf-z');
  let zoom=1, dead=false;
  const pages=[];
  for(let i=1;i<=doc.numPages;i++){
    const pg=await doc.getPage(i); if(dead) break;
    const c=document.createElement('canvas'); c.className='dv-pdf-pg'; c.dataset.pg=String(i); wrap.appendChild(c);
    pages.push({pg, c, drawn:0});
  }
  const fitW=()=>Math.max(200, wrap.clientWidth-24);
  const layout=()=>{ for(const p of pages){ const v=p.pg.getViewport({scale:1}), w=fitW()*zoom; p.c.style.width=w+'px'; p.c.style.height=(w*v.height/v.width)+'px'; p.drawn=0; } };
  const draw=async p=>{
    const key=Math.round(fitW()*zoom*(window.devicePixelRatio||1)); if(p.drawn===key || p.busy) return;
    p.busy=true;
    try{
      const v1=p.pg.getViewport({scale:1}), scale=key/v1.width, vp=p.pg.getViewport({scale});
      p.c.width=Math.floor(vp.width); p.c.height=Math.floor(vp.height);
      await p.pg.render({canvasContext:p.c.getContext('2d'), viewport:vp}).promise;
      p.drawn=key;
    }catch(e){ console.warn('pdf 쪽 그리기 실패', e); }
    p.busy=false;
  };
  const io=new IntersectionObserver(es=>{ for(const e of es) if(e.isIntersecting){ const p=pages.find(x=>x.c===e.target); if(p) draw(p); } }, {root:box.closest('.dv-content')||null, rootMargin:'600px 0px'});
  layout(); pages.forEach(p=>io.observe(p.c));
  const redraw=()=>{ layout(); pages.forEach(p=>{ io.unobserve(p.c); io.observe(p.c); }); };
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

/* =========================================================================
   문서 탭 (v3.8.0, v3.8.1 여러 폴더·미리 보기·바로 고치기) — 세 칸.
     · 왼쪽: 지정한 문서 폴더들(settings.docRoots — 여러 개) 아래 폴더·파일 트리(노션식 — 누르면 그 자리에서 펼침).
       한 단계씩 읽는다(doc_list). 폴더 줄의 ▸ 는 넓은 누름 자리(접기·펼치기 전용).
     · 가운데: 고른 파일 보기.
         그림·PDF(pdf.js)·동영상/소리 = 앱 안에서 그림.
         글자 파일(txt·md·csv·json 등 상용 편집 프로그램이 따로 없는 형식) = **보는 즉시 고침**(입력칸) — 잠깐 쉬면/다른
           파일로 가면/Ctrl+S 면 저장. 원래 인코딩(UTF-8·BOM·UTF-16·EUC-KR) 그대로 쓰고, 그새 다른 프로그램이 고쳤으면
           덮어쓰지 않는다(docs.rs). MD 는 [보기|편집], CSV 는 [표|편집].
         나머지(HWPX·HWP·XLSX·PPTX·DOCX…) = Windows 탐색기 미리 보기 처리기(preview.rs — 설치된 한컴·Office 가 그리는
           그대로). 처리기가 없으면 docs-view.js 의 글자·표 대체본, 그것도 없으면 정보와 [열기].
     · 오른쪽: 고른 폴더(파일을 고르면 그 파일이 든 폴더)의 **업무 메모** — 보드·캘린더·완료와 **같은 업무 데이터**를
       보여 주는 방식만 다르다(사용자 지정). [＋ 메모]는 그 폴더 링크가 들어간 새 양식을 연다. 따로 저장하는 메모는 없다.
   트리 항목의 열쇠는 `폴더번호:상대경로`(nodeKey). 펼친 폴더(docOpen)·마지막 파일(docLast)은 이 열쇠로 settings 에.
   모든 파일 접근은 Rust docs.rs 가 그 폴더 안인지 확인한다(화면은 폴더 번호와 상대 경로만 넘긴다).
   트리에서 항목을 같은 문서 폴더 안의 폴더로 끌어 놓으면 옮긴다(doc_move — 덮어쓰기 없음, 확인 후 [실행 취소]).
   옮긴 경로를 가리키던 업무 파일 링크는 새 경로로 고친다(종료 업무는 S.doneDirty 표시 — 증분 저장 규칙).
   ⚠️ 탐색기 미리 보기는 웹뷰 위에 뜬 별도 창이다 — 팝업·양식이 열리거나 다른 탭으로 가면 반드시 숨긴다(syncNative).
   init*() 외 최상위 실행문 없음.
   ========================================================================= */
import {S} from './state.js';
import {STORE, invoke} from './store.js';
import {$, esc, escAttr, appAlert, appConfirm, showToast} from './dom-utils.js';
import {registerView, showView} from './views.js';
import {docKind, extOf, openLabel, unzip, hwpxHtml, pptxHtml, xlsxBook, inApp, isTextKind, IMG_MIME, MEDIA_MIME, mdHtml, csvHtml, renderPdf} from './docs-view.js';
import {cardHtml, persist} from './render.js';
import {placeOf} from './placement.js';
import {openForm} from './form.js';
import {topId} from './modals.js';

const kids=new Map();             // nodeKey(폴더) → 항목 목록 | {error}
let open=null, openFor=null;      // 펼친 폴더 nodeKey 의 Set · 그것을 읽은(또는 마지막으로 쓴) settings.docOpen 배열
function keepOpen(){ S.settings.docOpen=openFor=[...open]; }
let sel=null;                     // 고른 항목 {i, rel, dir}
let shown=null;                   // 가운데에 보이는 파일 {i, rel, mtime}
let book=null, sheetIdx=0;        // XLSX 대체본 상태
let roots=[];                     // Rust 가 받은 폴더 정보 [{ok, path(정규화), error}] — settings.docRoots 와 같은 순서
let rootsFor=null;                // roots 를 만든 settings.docRoots 의 JSON(달라지면 다시 잡는다)
let ed=null;                      // 글자 편집 상태 {i, rel, encoding, mtime, dirty, saving, timer, err}
let viewCleanup=null;             // PDF·그림 정리 함수
let native=false;                 // 탐색기 미리 보기 창이 떠 있다
let nativeShown=true;
let viewSeq=0;                    // 가운데를 다시 그릴 때마다 +1 — 늦게 끝난 비동기 결과 버리기
const SAVE_IDLE_MS=1200;

export const nodeKey = (i, rel) => `${i}:${rel||''}`;
const parseKey = k => { const s=String(k||''), j=s.indexOf(':'); return j<0 ? {i:0, rel:s} : {i:Number(s.slice(0,j))||0, rel:s.slice(j+1)}; };
const parentOf = rel => rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
const nameOf = rel => rel ? rel.slice(rel.lastIndexOf('/')+1) : '';
const fmtSize = n => n<1024 ? `${n} B` : n<1048576 ? `${(n/1024).toFixed(1)} KB` : `${(n/1048576).toFixed(1)} MB`;
const fmtTime = ms => { if(!ms) return ''; const d=new Date(ms); return `${d.getFullYear()}.${d.getMonth()+1}.${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; };
function saveSettings(){ window.SETTINGS=S.settings; STORE.saveSettings(S.settings); }

/* 설정의 폴더 목록 — v3.8.0 의 단일 docRoot 는 첫 폴더로 옮긴다(옛 열쇠 docOpen/docLast 도 0번 폴더로) */
export function docRoots(){
  const st=S.settings;
  if(!Array.isArray(st.docRoots)){
    st.docRoots = st.docRoot ? [String(st.docRoot)] : [];
    if(st.docRoot){
      st.docOpen=(Array.isArray(st.docOpen)?st.docOpen:[]).map(r=>String(r).includes(':')&&/^\d+:/.test(r)?r:nodeKey(0, r));
      if(st.docLast && !/^\d+:/.test(st.docLast)) st.docLast=nodeKey(0, st.docLast);
    }
    delete st.docRoot;
  }
  return st.docRoots;
}
const rootName = i => { const r=String(docRoots()[i]||''); return r.split(/[\\/]/).filter(Boolean).pop()||r; };
function entryOf(i, rel){ const list=kids.get(nodeKey(i, parentOf(rel))); return Array.isArray(list) ? list.find(e=>e.rel===rel) : null; }

async function ensureRoots(){
  const want=docRoots(), sig=JSON.stringify(want);
  if(rootsFor===sig) return;
  try{ roots=await invoke('doc_set_roots', {paths:want}); }
  catch(e){ roots=want.map(()=>({ok:false, path:'', error:String(e)})); }
  if(!Array.isArray(roots)) roots=[];
  rootsFor=sig; kids.clear();
  roots.forEach((r,i)=>{ if(!r || !r.ok) kids.set(nodeKey(i,''), {error:(r&&r.error)||'폴더를 열 수 없습니다'}); });
}
async function load(i, rel){
  if(!(roots[i]&&roots[i].ok)) return;
  try{ kids.set(nodeKey(i, rel), await invoke('doc_list', {root:i, rel})); }
  catch(e){ kids.set(nodeKey(i, rel), {error:String(e)}); }
}

/* ── 왼쪽: 트리 ── */
const isSel = (i, rel) => !!sel && sel.i===i && sel.rel===rel;
function rowHtml(i, e, depth){
  const k=nodeKey(i, e.rel), isOpen=e.dir && open.has(k);
  const kind=e.dir ? '' : docKind(e.name);
  return `<div class="dt-row${isSel(i,e.rel)?' on':''}${e.dir?' dir':''}" data-dkey="${escAttr(k)}" data-ddir="${e.dir?1:0}" style="padding-left:${4+depth*16}px" title="${escAttr(e.name)}">`
    +`<span class="dt-caret"${e.dir?' data-caret="1"':''}>${e.dir?(isOpen?'▾':'▸'):''}</span>`
    +`<span class="dt-ico ${e.dir?'ico-dir':'ico-'+kind}"></span><span class="dt-name">${esc(e.name)}</span></div>`
    +(isOpen ? listHtml(i, e.rel, depth+1) : '');
}
function listHtml(i, rel, depth){
  const list=kids.get(nodeKey(i, rel)), pad=`style="padding-left:${30+depth*16}px"`;
  if(list===undefined) return `<div class="dt-note" ${pad}>읽는 중</div>`;
  if(list.error) return `<div class="dt-note dt-err" ${pad}>${esc(list.error)}</div>`;
  if(!list.length) return `<div class="dt-note" ${pad}>빈 폴더</div>`;
  return list.map(e=>rowHtml(i, e, depth)).join('');
}
function renderTree(){
  const el=$('dt-tree'); if(!el) return;
  el.innerHTML=docRoots().map((p,i)=>{
    const k=nodeKey(i,''), isOpen=open.has(k);
    return `<div class="dt-row dt-root dir${isSel(i,'')?' on':''}" data-dkey="${escAttr(k)}" data-ddir="1" title="${escAttr(p)}">`
      +`<span class="dt-caret" data-caret="1">${isOpen?'▾':'▸'}</span><span class="dt-ico ico-dir"></span><span class="dt-name">${esc(rootName(i))}</span>`
      +`<button type="button" class="dt-unroot" data-unroot="${i}" title="목록에서 빼기(폴더는 그대로)" aria-label="목록에서 빼기">×</button></div>`
      +(isOpen ? listHtml(i, '', 1) : '');
  }).join('');
}

/* ── 가운데: 보기 ── */
function viewHead(i, rel, e, extra){
  const kind=docKind(rel), k=escAttr(nodeKey(i, rel));
  return `<div class="dv-head"><div class="dv-title"><span class="dt-ico ico-${kind}"></span><b>${esc(nameOf(rel))}</b>`
    +(e?`<span class="dv-meta num">${fmtSize(e.size)} · ${fmtTime(e.mtime)}</span>`:'')+`</div>`
    +`<div class="dv-acts">${extra||''}<button type="button" class="btn btn-tool" data-dopen="${k}">${openLabel(kind)}</button>`
    +`<button type="button" class="btn btn-tool" data-dreveal="${k}">폴더에서 보기</button></div></div>`;
}
const box = () => { const b=$('dv-body'); return b && b.querySelector('.dv-content'); };
async function leaveViewer(){
  await flushEdit();
  if(viewCleanup){ try{ viewCleanup(); }catch{} viewCleanup=null; }
  if(native){ native=false; stopNativeWatch(); try{ await invoke('doc_preview_close'); }catch{} }
  ed=null; book=null; shown=null;
}
async function renderViewer(){
  const el=$('dv-body'); if(!el) return;
  const same = sel && !sel.dir && shown && shown.i===sel.i && shown.rel===sel.rel;
  if(same) return;                                         // 보던 파일 그대로 — 입력 중인 글자·PDF 를 갈아엎지 않는다
  await leaveViewer();
  const seq=++viewSeq;
  if(!sel){ el.innerHTML='<div class="dv-empty">폴더 없음</div>'; return; }
  if(sel.dir){
    const list=kids.get(nodeKey(sel.i, sel.rel));
    const files=Array.isArray(list) ? list.filter(e=>!e.dir) : [];
    el.innerHTML=`<div class="dv-folder"><div class="dv-ftitle"><span class="dt-ico ico-dir"></span><b>${esc(sel.rel ? nameOf(sel.rel) : rootName(sel.i))}</b></div>`
      +(list && list.error ? `<div class="dv-empty dv-err">${esc(list.error)}</div>`
        : files.length ? `<div class="dv-flist">${files.map(f=>`<div class="dv-frow" data-dkey="${escAttr(nodeKey(sel.i, f.rel))}" data-ddir="0"><span class="dt-ico ico-${docKind(f.name)}"></span><span class="dv-fname">${esc(f.name)}</span><span class="dv-meta num">${fmtSize(f.size)}</span><span class="dv-meta num">${fmtTime(f.mtime)}</span></div>`).join('')}</div>`
        : '<div class="dv-empty">파일 없음</div>')+`</div>`;
    return;
  }
  const {i, rel}=sel, e=entryOf(i, rel), kind=docKind(rel);
  shown={i, rel, mtime:e?e.mtime:0};
  el.innerHTML=viewHead(i, rel, e)+'<div class="dv-content"><div class="dv-empty">읽는 중</div></div>';
  const alive = () => seq===viewSeq && !!box();
  try{
    if(isTextKind(kind)) return await showText(i, rel, kind, seq);
    if(kind==='img' || kind==='media' || kind==='pdf'){
      const bytes=new Uint8Array(await invoke('doc_read', {root:i, rel}));
      if(!alive()) return;
      if(kind==='pdf'){ box().innerHTML='<div class="dv-empty">읽는 중</div>'; const c=await renderPdf(box(), bytes); if(alive()) viewCleanup=c; else c(); return; }
      const ext=extOf(rel), url=URL.createObjectURL(new Blob([bytes], {type:(IMG_MIME[ext]||MEDIA_MIME[ext]||'application/octet-stream')}));
      viewCleanup=()=>URL.revokeObjectURL(url);
      box().innerHTML = kind==='img' ? `<div class="dv-img"><img src="${url}" alt="${escAttr(nameOf(rel))}"></div>`
        : String(MEDIA_MIME[ext]).startsWith('audio') ? `<audio class="dv-media" controls src="${url}"></audio>` : `<video class="dv-media" controls src="${url}"></video>`;
      return;
    }
    /* 그 밖: 탐색기 미리 보기 → 대체본 → 글자로 읽히면 편집 → 정보 */
    if(await tryNative(i, rel, seq)) return;
    if(!alive()) return;
    if(kind==='hwpx' || kind==='pptx' || kind==='xlsx') return await showFallback(i, rel, kind, seq);
    if(kind==='other'){
      try{ return await showText(i, rel, 'text', seq, true); }catch{ /* 글자 파일 아님 */ }
    }
    if(alive()) box().innerHTML=`<div class="dv-info"><span class="dt-ico ico-${kind}"></span><div>미리 보기 없음</div><div class="dv-meta">${esc(extOf(rel).toUpperCase()||'파일')}${e?` · ${fmtSize(e.size)}`:''}</div></div>`;
  }catch(err){
    if(alive()) box().innerHTML=`<div class="dv-empty dv-err">${esc(String(err&&err.message||err))}</div>`;
  }
}
async function showFallback(i, rel, kind, seq){
  const bytes=new Uint8Array(await invoke('doc_read', {root:i, rel}));
  if(seq!==viewSeq || !box()) return;
  try{
    if(kind==='xlsx'){
      book=xlsxBook(bytes); sheetIdx=Math.min(sheetIdx, book.names.length-1); if(sheetIdx<0) sheetIdx=0;
      box().innerHTML=`<div class="dv-ro">표만 보기</div>`
        +(book.names.length>1?`<div class="dv-sheets">${book.names.map((n,j)=>`<button type="button" class="seg-btn${j===sheetIdx?' on':''}" data-dsheet="${j}">${esc(n)}</button>`).join('')}</div>`:'')
        +`<div class="dv-scroll">${book.html(sheetIdx)}</div>`;
    } else {
      const html = kind==='hwpx' ? hwpxHtml(unzip(bytes)) : pptxHtml(unzip(bytes));
      box().innerHTML=`<div class="dv-ro">글자·표만 보기</div><div class="dv-doc dv-${kind}">${html}</div>`;
    }
  }catch(err){ box().innerHTML=`<div class="dv-empty dv-err">미리 보기 실패 — ${esc(err.message||String(err))}</div>`; }
}

/* ── 글자 파일: 보는 즉시 고침 ── */
const mdMode = () => S.settings.docMdMode==='edit' ? 'edit' : 'view';
const csvMode = () => S.settings.docCsvMode==='edit' ? 'edit' : 'table';
async function showText(i, rel, kind, seq, probe){
  const f=await invoke('doc_read_text', {root:i, rel});
  if(seq!==viewSeq || !box()) return;
  /* 입력칸은 줄바꿈을 \n 하나로 바꾼다 — 원래 파일이 CRLF(Windows 메모장)면 저장할 때 되돌린다 */
  const crlf=(f.text.match(/\r\n/g)||[]).length, lf=(f.text.match(/(^|[^\r])\n/g)||[]).length;
  ed={i, rel, kind, encoding:f.encoding, eol: crlf>0 && crlf>=lf ? '\r\n' : '\n', mtime:f.mtime, text:f.text, dirty:false, saving:false, timer:0, err:''};
  if(shown) shown.mtime=f.mtime;
  const seg = kind==='md' ? `<div class="seg dv-seg"><button type="button" class="seg-btn${mdMode()==='view'?' on':''}" data-tmode="view">보기</button><button type="button" class="seg-btn${mdMode()==='edit'?' on':''}" data-tmode="edit">편집</button></div>`
    : kind==='csv' ? `<div class="seg dv-seg"><button type="button" class="seg-btn${csvMode()==='table'?' on':''}" data-tmode="table">표</button><button type="button" class="seg-btn${csvMode()==='edit'?' on':''}" data-tmode="edit">편집</button></div>` : '';
  const head=$('dv-body').querySelector('.dv-head .dv-acts');
  if(head) head.insertAdjacentHTML('afterbegin', `<span class="dv-save num" id="dv-save">${probe?'글자로 열림 · ':''}${esc(encName(f.encoding))}</span>${seg}`);
  box().classList.add('dv-text');
  box().innerHTML=`<textarea class="dv-ta" id="dv-ta" spellcheck="false" maxlength="5000000"></textarea><div class="dv-md" id="dv-md"></div>`;
  $('dv-ta').value=f.text;
  await textMode();
}
const encName = e => e==='utf-8' ? 'UTF-8' : e==='utf-8-bom' ? 'UTF-8(BOM)' : e==='utf-16le' ? 'UTF-16' : e==='cp949' ? 'EUC-KR' : String(e||'');
async function textMode(){
  if(!ed) return;
  const ta=$('dv-ta'), md=$('dv-md'); if(!ta||!md) return;
  const view = ed.kind==='md' ? mdMode()==='view' : ed.kind==='csv' ? csvMode()==='table' : false;
  ta.style.display = view ? 'none' : '';
  md.style.display = view ? '' : 'none';
  if(!view) return;
  const text=ta.value;
  if(ed.kind==='csv'){
    try{ md.innerHTML=`<div class="dv-scroll">${csvHtml(text, extOf(ed.rel)==='tsv')}</div>`; }catch(e){ md.innerHTML=`<div class="dv-empty dv-err">${esc(String(e))}</div>`; }
    return;
  }
  const want=ed;
  const html=await mdHtml(text);
  if(ed!==want) return;
  md.innerHTML=`<div class="dv-mdv">${html}</div>`;
  /* 같은 폴더 기준 상대 경로 그림 — 파일을 읽어 넣는다(웹뷰는 문서 폴더를 직접 못 읽는다) */
  for(const img of md.querySelectorAll('img')){
    const src=img.getAttribute('src')||'';
    if(/^(data:|blob:|https?:)/i.test(src) || !src) continue;
    const r=resolveRel(parentOf(want.rel), decodeURIComponent(src.split(/[?#]/)[0]));
    if(r==null){ img.removeAttribute('src'); continue; }
    try{
      const b=new Uint8Array(await invoke('doc_read', {root:want.i, rel:r}));
      if(ed!==want) return;
      const u=URL.createObjectURL(new Blob([b], {type:IMG_MIME[extOf(r)]||'image/png'}));
      img.src=u; const prev=viewCleanup; viewCleanup=()=>{ URL.revokeObjectURL(u); if(prev) prev(); };
    }catch{ img.removeAttribute('src'); img.alt=`(그림 없음: ${src})`; }
  }
}
/* 상대 경로 → 문서 폴더 안 rel(밖으로 나가면 null) */
export function resolveRel(dir, rel){
  const out=dir ? dir.split('/') : [];
  for(const s of String(rel).replace(/\\/g,'/').split('/')){
    if(!s || s==='.') continue;
    if(s==='..'){ if(!out.length) return null; out.pop(); continue; }
    if(/^[a-z]:$/i.test(s)) return null;
    out.push(s);
  }
  return out.join('/');
}
function markSave(text, bad){
  const s=$('dv-save'); if(!s) return;
  s.textContent=text; s.classList.toggle('dv-bad', !!bad);
}
function onEdit(){
  if(!ed) return;
  ed.dirty=true; ed.err='';
  markSave('고치는 중');
  clearTimeout(ed.timer); ed.timer=setTimeout(()=>saveEdit(), SAVE_IDLE_MS);
}
/* 저장 — 실패해도 입력한 글자는 그대로 둔다(화면에 남기고 알림) */
export async function saveEdit(){
  const cur=ed; if(!cur || !cur.dirty) return true;
  clearTimeout(cur.timer);
  if(cur.saving){ cur.again=true; return false; }
  const ta=$('dv-ta'); const typed = ta && ed===cur ? ta.value : cur.pending;
  if(typed==null) return false;
  const text = cur.eol==='\r\n' ? typed.replace(/\r?\n/g, '\r\n') : typed;
  cur.saving=true; cur.dirty=false; markSave('저장 중');
  try{
    cur.mtime=await invoke('doc_write_text', {root:cur.i, rel:cur.rel, text, encoding:cur.encoding, baseMtime:cur.mtime});
    cur.text=text;
    if(shown && shown.i===cur.i && shown.rel===cur.rel) shown.mtime=cur.mtime;
    const e=entryOf(cur.i, cur.rel); if(e){ e.mtime=cur.mtime; e.size=new Blob([text]).size; }
    if(ed===cur) markSave(`저장됨 · ${encName(cur.encoding)}`);
    cur.saving=false;
    if(cur.again){ cur.again=false; if(cur.dirty) return saveEdit(); }
    return true;
  }catch(err){
    cur.saving=false; cur.err=String(err);
    /* 그새 다른 프로그램이 고쳤다 — 어느 쪽도 버리지 않는다: 내 고침은 '… (내 고침)' 새 파일로, 원래 파일은 다시 연다 */
    if(/다른 프로그램이 이 파일을 고쳤/.test(cur.err)){
      cur.dirty=false;
      const kept=await keepMine(cur, text);
      if(ed===cur && shown && shown.i===cur.i && shown.rel===cur.rel){ ed=null; shown=null; await load(cur.i, parentOf(cur.rel)); renderTree(); await renderViewer(); }
      await appAlert(kept ? `다른 프로그램이 '${nameOf(cur.rel)}' 을(를) 먼저 고쳤습니다.\n고친 내용은 '${nameOf(kept)}' 로 따로 저장했습니다.` : `'${nameOf(cur.rel)}' 저장 실패\n${err}`);
      return !!kept;
    }
    cur.dirty=true;
    if(ed===cur) markSave('저장 실패', true);
    await appAlert(`'${nameOf(cur.rel)}' 저장 실패\n${err}`);
    return false;
  }
}
async function keepMine(cur, text){
  try{
    const dir=parentOf(cur.rel), nm=nameOf(cur.rel), dot=nm.lastIndexOf('.');
    const stem=dot>0 ? nm.slice(0,dot) : nm, ext=dot>0 ? nm.slice(dot) : '';
    await load(cur.i, dir);
    const rel=await invoke('doc_create', {root:cur.i, dir, name:freeName(kids.get(nodeKey(cur.i, dir)), `${stem} (내 고침)`, ext), isDir:false});
    const f=await invoke('doc_read_text', {root:cur.i, rel});
    await invoke('doc_write_text', {root:cur.i, rel, text, encoding:cur.encoding, baseMtime:f.mtime});
    await load(cur.i, dir);
    return rel;
  }catch(e){ console.warn('내 고침 따로 저장 실패', e); return null; }
}
/* 떠나기 전에 고친 글자를 저장한다(다른 파일·다른 탭·폴더 바꾸기) */
async function flushEdit(){
  if(!ed || !ed.dirty) return;
  const ta=$('dv-ta'); if(ta) ed.pending=ta.value;
  await saveEdit();
}

/* ── 탐색기 미리 보기 창(preview.rs) ── */
function nativeRect(){
  const ph=$('dv-native'); if(!ph) return null;
  const r=ph.getBoundingClientRect(), d=window.devicePixelRatio||1;
  return {x:Math.round(r.left*d), y:Math.round(r.top*d), w:Math.max(1,Math.round(r.width*d)), h:Math.max(1,Math.round(r.height*d))};
}
async function tryNative(i, rel, seq){
  if(seq!==viewSeq || !box()) return false;
  box().classList.add('dv-native-box');
  box().innerHTML='<div class="dv-native" id="dv-native"><div class="dv-empty">미리 보기 여는 중</div></div>';
  const r=nativeRect(); if(!r) return false;
  let ok=false;
  try{ ok=await invoke('doc_preview_open', {root:i, rel, ...r}); }
  catch(err){ console.warn('탐색기 미리 보기 실패', err); ok=false; }
  if(seq!==viewSeq || !box()){ if(ok){ try{ await invoke('doc_preview_close'); }catch{} } return true; }
  if(!ok){ box().classList.remove('dv-native-box'); return false; }
  native=true; nativeShown=true;
  const ph=$('dv-native'); if(ph) ph.innerHTML='';
  startNativeWatch();
  syncNative();
  return true;
}
/* 미리 보기 창을 가려야 하는 때: 문서 탭이 아님 · 팝업/양식/알림 · 앱 대화상자 · 끌기 중 */
function nativeBlocked(){
  const v=$('view-docs');
  if(!v || !v.classList.contains('on')) return true;
  if(topId()) return true;
  return !!document.querySelector('.modal-bg.on, .form-panel.on, .alarm-bg.on, #appDialog.on, body.dt-dragging, .dt-menu');
}
let lastRect='';
async function syncNative(){
  if(!native) return;
  const want=!nativeBlocked();
  if(want!==nativeShown){ nativeShown=want; try{ await invoke('doc_preview_show', {on:want}); }catch{} }
  if(!want) return;
  const r=nativeRect(); if(!r) return;
  const sig=`${r.x},${r.y},${r.w},${r.h}`;
  if(sig===lastRect) return;
  lastRect=sig;
  try{ await invoke('doc_preview_place', r); }catch{}
}
let mo=null, ro=null, raf=0;
const kick = () => { if(raf) return; const f=window.requestAnimationFrame||(cb=>setTimeout(cb,16)); raf=f(()=>{ raf=0; syncNative(); }); };
function startNativeWatch(){
  lastRect='';
  const MO=window.MutationObserver;
  if(!mo && MO) mo=new MO(kick);
  if(mo) mo.observe(document.body, {attributes:true, childList:true, subtree:true, attributeFilter:['class']});
  const ph=$('dv-native');
  if(ph && window.ResizeObserver){ ro=new window.ResizeObserver(kick); ro.observe(ph); }
  window.addEventListener('resize', kick); window.addEventListener('scroll', kick, true);
}
function stopNativeWatch(){
  if(mo) mo.disconnect();
  if(ro){ ro.disconnect(); ro=null; }
  window.removeEventListener('resize', kick); window.removeEventListener('scroll', kick, true);
}

/* ── 오른쪽: 그 폴더의 업무 메모 ── */
function noteFolder(){ return !sel ? null : {i:sel.i, rel: sel.dir ? sel.rel : parentOf(sel.rel)}; }
/* 경로 비교용 — 대소문자·구분자·끝 슬래시 무시(Windows) */
const norm = p => String(p||'').replace(/^\\\\\?\\(UNC\\)?/,(m,u)=>u?'\\\\':'').replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase();
/* 폴더의 절대 경로 후보 — 사용자가 고른 그대로(예: 매핑 드라이브 Z:)와 Rust 가 정규화한 것(UNC 일 수 있음) 둘 다 */
function folderPaths(i, rel){
  const add=r=>r ? norm(rel ? `${r}/${rel}` : r) : null;
  return [...new Set([add(docRoots()[i]), add(roots[i]&&roots[i].path)].filter(Boolean))];
}
/* 그 폴더 자체나 폴더 바로 안의 파일을 링크로 가진 업무(주기 정의 제외) — 진행 먼저, 최근 것 먼저 */
/* subdirs: 그 폴더 바로 안의 하위 폴더 이름(소문자) — 하위 폴더 자체를 링크한 업무는 그 하위 폴더의 메모다 */
export function folderItems(items, paths, subdirs){
  const set=new Set(paths), sub=new Set(subdirs||[]);
  const hit=f=>{ const n=norm(f); if(set.has(n)) return true;
    const k=n.lastIndexOf('/'); return set.has(n.slice(0,k)) && !sub.has(n.slice(k+1)); };
  return (items||[]).filter(it=>!it.recur && (it.files||[]).some(hit))
    .sort((a,b)=>((a.done?1:0)-(b.done?1:0)) || ((b.doneAt||b.id)-(a.doneAt||a.id)));
}
export function renderNote(){
  const t=$('dn-title'); if(!t) return;
  const nf=noteFolder();
  if(!nf){ t.textContent=''; $('dn-count').textContent=''; $('dn-list').innerHTML=''; return; }
  t.textContent = nf.rel ? nameOf(nf.rel) : rootName(nf.i);
  const here=kids.get(nodeKey(nf.i, nf.rel));
  const list=folderItems(S.items, folderPaths(nf.i, nf.rel), Array.isArray(here) ? here.filter(e=>e.dir).map(e=>e.name.toLowerCase()) : []);
  $('dn-count').textContent = list.length ? String(list.length) : '';
  $('dn-list').innerHTML = list.length ? list.map(it=>cardHtml(it, it.done ? 'done' : placeOf(it))).join('') : '<div class="dv-empty">이 폴더의 메모 없음</div>';
}
/* 업무 링크에 쓸 그 항목의 절대 경로 — 사용자가 고른 폴더 표기(매핑 드라이브 등) 기준, '\' 구분 */
function basePath(i, rel){
  const r=String(docRoots()[i]||(roots[i]&&roots[i].path)||'').replace(/[\\/]+$/,'');
  return rel ? `${r}\\${rel.replace(/\//g,'\\')}` : r;
}
/* 옮긴 항목(oldPaths = 정규화된 옛 절대 경로 후보)을 가리키던 파일 링크를 newBase 로 바꾼다. 바뀐 업무 목록을 돌려준다.
   폴더를 옮기면 그 안 파일 링크도 따라간다(앞부분만 바꾸고 나머지 글자는 그대로). */
export function relinkFiles(items, oldPaths, newBase){
  const changed=[];
  for(const it of items||[]){
    let hit=false;
    const files=(it.files||[]).map(f=>{
      const raw=String(f).replace(/^\\\\\?\\/,''), n=norm(raw);
      for(const c of oldPaths) if(n===c || n.startsWith(c+'/')){ hit=true; return newBase+raw.slice(c.length); }
      return f;
    });
    if(hit){ it.files=files; changed.push(it); }
  }
  return changed;
}
/* 파일 링크 경로 → 문서 폴더 안이면 {i, rel}, 아니면 null (양식의 [문서] 단추) */
export function docTarget(path){
  const n=norm(path); if(!n) return null;
  const rs=docRoots();
  for(let i=0;i<rs.length;i++){
    for(const base of [norm(rs[i]), norm(roots[i]&&roots[i].path)]){
      if(!base) continue;
      if(n===base) return {i, rel:''};
      if(n.startsWith(base+'/')){
        const tail=String(path).replace(/^\\\\\?\\(UNC\\)?/,'').replace(/\\/g,'/').replace(/\/+$/,'');
        return {i, rel:tail.slice(tail.length-(n.length-base.length-1))};
      }
    }
  }
  return null;
}
const movedRel=(rel, from, to)=> rel===from ? to : rel.startsWith(from+'/') ? to+rel.slice(from.length) : rel;
const movedKey=(k, i, from, to)=>{ const p=parseKey(k); return p.i===i ? nodeKey(i, movedRel(p.rel, from, to)) : k; };
/* 옮긴 뒤 정리 — 링크 고치기(저장), 트리 캐시·펼침·선택·마지막 파일 경로를 새 자리로 */
async function applyMoved(i, from, to){
  const changed=relinkFiles(S.items, folderPaths(i, from), basePath(i, to));
  for(const it of changed) if(it.done) S.doneDirty.add(it.id);       // 종료 업무 링크도 저장에 실리게(증분 저장 규칙)
  for(const k of [...kids.keys()]){ const p=parseKey(k); if(p.i===i && (p.rel===from || p.rel.startsWith(from+'/') || p.rel===parentOf(from) || p.rel===parentOf(to))) kids.delete(k); }
  open=new Set([...open].map(k=>movedKey(k, i, from, to)));
  keepOpen();
  if(S.settings.docLast) S.settings.docLast=movedKey(S.settings.docLast, i, from, to);
  if(sel && sel.i===i){ const r=movedRel(sel.rel, from, to); if(r!==sel.rel){ if(!sel.dir) await leaveViewer(); sel={...sel, rel:r}; } }
  saveSettings();
  if(changed.length) persist();
  await renderDocs();
}
async function doMove(i, from, toDir){
  const dest = toDir ? nameOf(toDir) : rootName(i);
  if(!await appConfirm(`'${nameOf(from)}' → '${dest}' 이동`)) return;
  if(ed && ed.i===i && (ed.rel===from || ed.rel.startsWith(from+'/'))) await flushEdit();
  if(native && shown && shown.i===i && (shown.rel===from || shown.rel.startsWith(from+'/'))) await leaveViewer();   // 처리기가 파일을 쥐고 있으면 못 옮긴다
  let to;
  try{ to=await invoke('doc_move', {root:i, from, toDir}); }
  catch(e){ await appAlert('이동 실패\n'+e); return; }
  await applyMoved(i, from, to);
  showToast('이동함', async()=>{
    try{ const back=await invoke('doc_move', {root:i, from:to, toDir:parentOf(from)}); await applyMoved(i, to, back); }
    catch(e){ appAlert('되돌리기 실패\n'+e); }
  });
}
/* 트리 끌기 — 마우스 이벤트(Windows WebView2 에선 HTML5 드래그가 꺼져 있다 — CLAUDE.md 끌어 놓기 주의) */
let drag=null, swallowUntil=0;
export function dropOk(dk, tk){
  const d=parseKey(dk), t=parseKey(tk);
  if(d.i!==t.i || d.rel==='') return false;                              // 다른 문서 폴더로는 옮기지 않는다
  return t.rel!==d.rel && !t.rel.startsWith(d.rel+'/') && t.rel!==parentOf(d.rel);
}
function endDrag(){
  document.querySelectorAll('#dt-tree .drop-on').forEach(x=>x.classList.remove('drop-on'));
  const g=document.querySelector('.dt-ghost'); if(g) g.remove();
  document.body.classList.remove('dt-dragging'); drag=null;
}
const dropRow = t => t && t.closest && t.closest('#dt-tree .dt-row.dir');
function initTreeDrag(){
  $('dt-tree').addEventListener('mousedown',e=>{
    if(e.button!==0 || e.target.closest('.dt-unroot')) return;
    const row=e.target.closest('.dt-row'); if(!row || parseKey(row.dataset.dkey).rel==='') return;
    drag={key:row.dataset.dkey, x:e.clientX, y:e.clientY, on:false};
  });
  document.addEventListener('mousemove',e=>{
    if(!drag) return;
    if(e.buttons===0 && drag.on){ endDrag(); return; }
    if(!drag.on){
      if(Math.hypot(e.clientX-drag.x, e.clientY-drag.y)<6) return;
      drag.on=true; document.body.classList.add('dt-dragging');
      const g=document.createElement('div'); g.className='dt-ghost'; g.textContent=nameOf(parseKey(drag.key).rel); document.body.appendChild(g);
    }
    const g=document.querySelector('.dt-ghost'); if(g){ g.style.left=(e.clientX+12)+'px'; g.style.top=(e.clientY+8)+'px'; }
    const t=dropRow(e.target);
    document.querySelectorAll('#dt-tree .drop-on').forEach(x=>{ if(x!==t) x.classList.remove('drop-on'); });
    if(t && dropOk(drag.key, t.dataset.dkey)) t.classList.add('drop-on');
  });
  document.addEventListener('mouseup',e=>{
    if(!drag) return;
    const d=drag; endDrag();
    if(!d.on) return;
    swallowUntil=Date.now()+300;                          // 놓은 뒤 따라오는 click 한 번은 고르기로 치지 않는다
    const t=dropRow(e.target);
    if(t && dropOk(d.key, t.dataset.dkey)){ const a=parseKey(d.key), b=parseKey(t.dataset.dkey); doMove(a.i, a.rel, b.rel); }
  });
}

/* ── 오른쪽 클릭: 새로 만들기 · 이름 바꾸기 (v3.8.1 소유자 지정) ──
   새 항목은 기본 이름으로 바로 만들고(같은 이름이 있으면 ' (2)'…) 곧바로 이름 바꾸기 칸을 연다 — 탐색기와 같은 흐름.
   Rust 는 덮어쓰지 않는다(doc_create·doc_rename). 이름이 바뀌면 그 경로를 가리키던 업무 링크도 따라간다(applyMoved). */
/* [종류, 기본 이름, 확장자, 오피스 문서?] — 오피스 문서는 이름을 정하면 바로 그 프로그램으로 연다(소유자 지정) */
const NEW_KINDS=[['dir','새 폴더','',false],['txt','새 텍스트 문서','.txt',false],['md','새 메모','.md',false],
  ['hwpx','새 한글 문서','.hwpx',true],['xlsx','새 엑셀 문서','.xlsx',true],['pptx','새 파워포인트','.pptx',true]];
export function freeName(list, base, ext){
  const have=new Set((Array.isArray(list)?list:[]).map(e=>e.name.toLowerCase()));
  for(let n=1;n<1000;n++){ const nm=n===1?`${base}${ext}`:`${base} (${n})${ext}`; if(!have.has(nm.toLowerCase())) return nm; }
  return `${base} ${Date.now()}${ext}`;
}
function closeMenu(){ const m=document.querySelector('.dt-menu'); if(m) m.remove(); }
function openMenu(x, y, key, dir){
  closeMenu();
  const {rel}=parseKey(key);
  const m=document.createElement('div'); m.className='dt-menu'; m.setAttribute('role','menu');
  const item=([k,label,ext])=>`<button type="button" data-mnew="${k}">${label}${ext?` (${ext})`:''}</button>`;
  m.innerHTML=(dir ? NEW_KINDS.filter(x=>!x[3]).map(item).join('')+'<hr>'+NEW_KINDS.filter(x=>x[3]).map(item).join('') : '')
    +(rel ? `${dir?'<hr>':''}<button type="button" data-mren="1">이름 바꾸기</button>` : '')
    +(!dir ? `<button type="button" data-mopen="1">열기</button>` : '')
    +`<button type="button" data-mreveal="1">폴더에서 보기</button>`;
  document.body.appendChild(m);
  const r=m.getBoundingClientRect();
  m.style.left=Math.max(4, Math.min(x, window.innerWidth-r.width-4))+'px';
  m.style.top=Math.max(4, Math.min(y, window.innerHeight-r.height-4))+'px';
  m.addEventListener('click', async e=>{
    const b=e.target.closest('button'); if(!b) return;
    closeMenu();
    const p=parseKey(key);
    if(b.dataset.mnew) return createItem(p.i, p.rel, b.dataset.mnew);
    if(b.dataset.mren) return startRename(key);
    if(b.dataset.mopen || b.dataset.mreveal){
      if(b.dataset.mopen) await flushEdit();
      try{ await invoke(b.dataset.mopen?'open_file_path':'reveal_file_path', {path:await invoke('doc_abs', {root:p.i, rel:p.rel})}); }
      catch(err){ appAlert('열 수 없습니다:\n'+err); }
    }
  });
  const first=m.querySelector('button'); if(first && first.focus) first.focus();
}
async function createItem(i, dirRel, kind){
  const k=nodeKey(i, dirRel);
  if(!kids.has(k)) await load(i, dirRel);
  const [, base, ext, office]=NEW_KINDS.find(x=>x[0]===kind);
  const name=freeName(kids.get(k), base, ext);
  let rel;
  try{ rel=await invoke(office ? 'doc_create_doc' : 'doc_create', office ? {root:i, dir:dirRel, name} : {root:i, dir:dirRel, name, isDir:kind==='dir'}); }
  catch(e){ await appAlert('만들지 못했습니다\n'+e); return; }
  await load(i, dirRel);
  open.add(k); keepOpen();
  if(kind!=='dir') S.settings.docLast=nodeKey(i, rel);
  saveSettings();
  await leaveViewer();
  sel={i, rel, dir:kind==='dir'};
  renderTree(); renderNote(); await renderViewer();
  /* 오피스 문서: 이름을 정하면(그대로 두어도) 바로 그 프로그램으로 연다 — 열린 뒤엔 이름을 못 바꾸므로 순서가 이렇다 */
  startRename(nodeKey(i, rel), office ? async finalRel=>{
    if(native) await leaveViewer();
    try{ await invoke('open_file_path', {path:await invoke('doc_abs', {root:i, rel:finalRel})}); }
    catch(err){ appAlert('열 수 없습니다:\n'+err); }
  } : null);
}
function startRename(key, after){
  const row=[...document.querySelectorAll('#dt-tree .dt-row')].find(r=>r.dataset.dkey===key); if(!row) return;
  const nm=row.querySelector('.dt-name'); if(!nm) return;
  const {i, rel}=parseKey(key), old=nameOf(rel);
  const inp=document.createElement('input'); inp.className='dt-rename'; inp.value=old; inp.maxLength=200; inp.spellcheck=false;
  nm.replaceWith(inp);
  const dot=row.dataset.ddir==='1' ? -1 : old.lastIndexOf('.');
  inp.focus(); inp.setSelectionRange(0, dot>0 ? dot : old.length);
  let done=false;
  const finish=async ok=>{
    if(done) return; done=true;
    const v=inp.value.trim();
    if(!ok || !v || v===old){ renderTree(); if(after) after(rel); return; }
    if(ed && ed.i===i && (ed.rel===rel || ed.rel.startsWith(rel+'/'))) await flushEdit();
    if(native && shown && shown.i===i && (shown.rel===rel || shown.rel.startsWith(rel+'/'))) await leaveViewer();   // 처리기가 파일을 쥐고 있으면 못 바꾼다
    let to;
    try{ to=await invoke('doc_rename', {root:i, rel, name:v}); }
    catch(e){ await appAlert('이름을 바꾸지 못했습니다\n'+e); renderTree(); if(after) after(rel); return; }
    await applyMoved(i, rel, to);
    if(after) after(to);
  };
  inp.addEventListener('keydown', e=>{
    if(e.isComposing || e.keyCode===229) return;
    if(e.key==='Enter'){ e.preventDefault(); finish(true); }
    else if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); finish(false); }
  });
  inp.addEventListener('blur', ()=>finish(true));
  inp.addEventListener('mousedown', e=>e.stopPropagation());     // 끌기 시작으로 치지 않는다
  inp.addEventListener('click', e=>e.stopPropagation());         // 고르기(줄 클릭)로 치지 않는다
}

/* ── 바깥(탐색기)에서 끌어 온 파일 → 문서 폴더에 복사 (filedrop.js 가 부른다) ── */
/* 놓인 요소가 문서 탭의 폴더면 {key, label, row} — 트리의 폴더 줄, 또는 가운데의 폴더 보기(고른 폴더) */
export function dropFolderAt(el){
  const v=$('view-docs'); if(!v || !v.classList.contains('on') || !el || !el.closest) return null;
  const row=el.closest('#dt-tree .dt-row.dir');
  if(row){ const p=parseKey(row.dataset.dkey); return {key:row.dataset.dkey, label:p.rel ? nameOf(p.rel) : rootName(p.i), row}; }
  if(el.closest('#dv-body .dv-folder') && sel && sel.dir) return {key:nodeKey(sel.i, sel.rel), label:sel.rel ? nameOf(sel.rel) : rootName(sel.i), row:el.closest('.dv-folder')};
  return null;
}
export async function importInto(key, paths){
  const {i, rel}=parseKey(key);
  let made=[], err='';
  try{ made=await invoke('doc_import', {root:i, dir:rel, paths}); }
  catch(e){ err=String(e); }
  await load(i, rel);
  open.add(key); keepOpen(); saveSettings();
  if(made && made.length===1){ await leaveViewer(); const e=entryOf(i, made[0]); sel={i, rel:made[0], dir:!!(e&&e.dir)}; }
  renderTree(); renderNote(); await renderViewer();
  if(err) appAlert(err);
  else if(made && made.length) showToast(`${made.length===1 ? `'${nameOf(made[0])}'` : `${made.length}개`} 복사함`);
  else showToast('이미 그 폴더에 있습니다');
}

/* [＋ 메모] — 이 폴더 링크가 든 새 양식(저장해야 업무가 생긴다) */
async function addNote(){
  const nf=noteFolder(); if(!nf) return;
  if(!(roots[nf.i]&&roots[nf.i].ok)){ appAlert('폴더를 찾을 수 없습니다'); return; }
  openForm({files:[basePath(nf.i, nf.rel)]});
}

/* ── 전체 ── */
export async function renderDocs(){
  const view=$('view-docs'); if(!view) return;
  const rs=docRoots();
  if(!open || openFor!==S.settings.docOpen){                 // 설정이 바깥에서 바뀌면(백업 복원 등) 다시 읽는다
    const had=!!open;
    open=new Set((Array.isArray(S.settings.docOpen) ? S.settings.docOpen : []).map(String));
    if(had){ sel=null; rootsFor=null; }
    openFor=S.settings.docOpen;
  }
  const has=rs.length>0;
  view.classList.toggle('has-root', has);
  $('dc-path').textContent = rs.length===1 ? rs[0] : rs.length ? `폴더 ${rs.length}개` : '';
  if(!has){ await leaveViewer(); sel=null; return; }
  await ensureRoots();
  /* 처음 보는 폴더는 펼친 채로 */
  rs.forEach((_,i)=>{ if(!S.settings.docSeen || !S.settings.docSeen.includes(rs[i])){ open.add(nodeKey(i,'')); } });
  S.settings.docSeen=[...rs];
  for(const k of [...open]){ const p=parseKey(k); if(p.i<rs.length && !kids.has(k)) await load(p.i, p.rel); }
  for(let i=0;i<rs.length;i++) if(!kids.has(nodeKey(i,''))) await load(i, '');
  if(sel && sel.i>=rs.length) sel=null;
  if(!sel && S.settings.docLast){ const p=parseKey(S.settings.docLast); if(p.i<rs.length && kids.has(nodeKey(p.i, parentOf(p.rel))) && entryOf(p.i, p.rel)) sel={i:p.i, rel:p.rel, dir:false}; }
  if(!sel) sel={i:0, rel:'', dir:true};
  renderTree(); renderNote(); await renderViewer();
  syncNative();
}
/* 폴더: 처음 누르면 펼치고 고른다, 고른 폴더를 다시 누르거나 ▸/▾ 를 누르면 접기·펼치기 */
async function pick(key, dir, caret){
  const {i, rel}=parseKey(key);
  if(dir){
    if(open.has(key) && (isSel(i, rel) || caret)) open.delete(key); else open.add(key);
    keepOpen(); saveSettings();
    if(open.has(key) && !kids.has(key)){ renderTree(); await load(i, rel); }
    if(caret && !isSel(i, rel)){ renderTree(); return; }           // ▸ 만 누르면 접기·펼치기만(고른 것 유지)
    sel={i, rel, dir:true};
  } else {
    sel={i, rel, dir:false};
    S.settings.docLast=key; saveSettings();
  }
  renderTree(); renderNote(); await renderViewer();
}
async function addRoot(){
  let p=null;
  try{ p=await invoke('pick_folder_path'); }catch(e){ await appAlert('선택 실패: '+e); return; }
  if(!p) return;
  const rs=docRoots();
  if(rs.some(r=>norm(r)===norm(p))){ showToast('이미 있는 폴더'); return; }
  rs.push(p); saveSettings();
  sel={i:rs.length-1, rel:'', dir:true};
  await renderDocs();
}
async function removeRoot(i){
  const rs=docRoots(); if(!(i>=0 && i<rs.length)) return;
  if(!await appConfirm(`'${rootName(i)}' 목록에서 빼기\n(폴더와 파일은 그대로)`)) return;
  if(sel && sel.i===i) await leaveViewer();
  rs.splice(i,1);
  const shift=k=>{ const p=parseKey(k); return p.i===i ? null : nodeKey(p.i>i?p.i-1:p.i, p.rel); };
  open=new Set([...open].map(shift).filter(Boolean)); keepOpen();
  S.settings.docLast = S.settings.docLast ? (shift(S.settings.docLast)||'') : '';
  if(sel){ sel = sel.i===i ? null : {...sel, i: sel.i>i ? sel.i-1 : sel.i}; }
  if(shown && shown.i>i) shown={...shown, i:shown.i-1};
  if(ed && ed.i>i) ed.i--;
  saveSettings(); rootsFor=null;
  await renderDocs();
}
/* 바깥 프로그램에서 고치고 돌아오면 보던 파일을 다시 읽는다 — 창이 앞으로 올 때 고친 시각만 비교(계속 지켜보지 않음).
   고치던 글자(저장 안 됨)가 있으면 건드리지 않는다. */
async function recheck(){
  const view=$('view-docs'); if(!view || !view.classList.contains('on') || !shown) return;
  if(ed && (ed.dirty || ed.saving)) return;
  const {i, rel, mtime}=shown;
  await load(i, parentOf(rel));
  const e=entryOf(i, rel);
  if(e && e.mtime!==mtime && shown && shown.rel===rel && shown.i===i){ await leaveViewer(); renderTree(); await renderViewer(); }
}
/* 양식 등에서 [문서] → 문서 탭에서 그 파일(폴더)을 고른다 */
export async function showDoc(path){
  await ensureRoots();
  const t=docTarget(path); if(!t){ appAlert('문서 폴더 안의 파일이 아닙니다'); return; }
  if(!open || openFor!==S.settings.docOpen){ open=new Set((S.settings.docOpen||[]).map(String)); openFor=S.settings.docOpen; }
  const parts=t.rel ? t.rel.split('/') : [];
  let cur=''; open.add(nodeKey(t.i,''));
  if(!kids.has(nodeKey(t.i,''))) await load(t.i,'');
  let dir=true;
  for(let j=0;j<parts.length;j++){
    const next=cur ? `${cur}/${parts[j]}` : parts[j];
    const list=kids.get(nodeKey(t.i, cur));
    const e=Array.isArray(list) ? list.find(x=>x.rel.toLowerCase()===next.toLowerCase()) : null;
    if(!e){ dir = j<parts.length-1; cur=next; break; }
    cur=e.rel; dir=e.dir;
    if(e.dir){ open.add(nodeKey(t.i, cur)); if(!kids.has(nodeKey(t.i, cur))) await load(t.i, cur); }
  }
  keepOpen();
  if(!dir) S.settings.docLast=nodeKey(t.i, cur);
  saveSettings();
  await leaveViewer();
  sel={i:t.i, rel:cur, dir};
  showView('docs');
  await renderDocs();
}

export function initDocs(){
  registerView({key:'docs', els:[{id:'view-docs'}], render:renderDocs});
  $('dc-root').addEventListener('click', addRoot);
  $('dc-root-empty').addEventListener('click', addRoot);
  initTreeDrag();
  $('dn-add').addEventListener('click', addNote);
  $('dt-tree').addEventListener('contextmenu', e=>{
    const row=e.target.closest('.dt-row'); if(!row) return;
    e.preventDefault();
    openMenu(e.clientX, e.clientY, row.dataset.dkey, row.dataset.ddir==='1');
  });
  document.addEventListener('mousedown', e=>{ if(!e.target.closest || !e.target.closest('.dt-menu')) closeMenu(); }, true);
  document.addEventListener('keydown', e=>{ if(e.key==='Escape' && document.querySelector('.dt-menu')){ e.stopPropagation(); closeMenu(); } }, true);
  window.addEventListener('blur', closeMenu);
  $('dt-tree').addEventListener('scroll', closeMenu);
  $('view-docs').addEventListener('click', async e=>{
    if(Date.now()<swallowUntil) return;
    const un=e.target.closest('[data-unroot]');
    if(un){ e.stopPropagation(); removeRoot(Number(un.dataset.unroot)); return; }
    const o=e.target.closest('[data-dopen]');
    if(o){ const p=parseKey(o.dataset.dopen); await flushEdit(); try{ await invoke('open_file_path', {path:await invoke('doc_abs', {root:p.i, rel:p.rel})}); }catch(err){ appAlert('열 수 없습니다:\n'+err); } return; }
    const r=e.target.closest('[data-dreveal]');
    if(r){ const p=parseKey(r.dataset.dreveal); try{ await invoke('reveal_file_path', {path:await invoke('doc_abs', {root:p.i, rel:p.rel})}); }catch(err){ appAlert('폴더를 열 수 없습니다:\n'+err); } return; }
    const tm=e.target.closest('[data-tmode]');
    if(tm && ed){
      if(ed.kind==='md') S.settings.docMdMode=tm.dataset.tmode; else S.settings.docCsvMode=tm.dataset.tmode;
      saveSettings();
      tm.parentElement.querySelectorAll('[data-tmode]').forEach(b=>b.classList.toggle('on', b===tm));
      await textMode(); return;
    }
    const sh=e.target.closest('[data-dsheet]');
    if(sh && book){ sheetIdx=Number(sh.dataset.dsheet); const sc=$('dv-body').querySelector('.dv-scroll'); if(sc) sc.innerHTML=book.html(sheetIdx);
      $('dv-body').querySelectorAll('[data-dsheet]').forEach(b=>b.classList.toggle('on', Number(b.dataset.dsheet)===sheetIdx)); return; }
    /* MD 보기 속 링크 — 웹뷰가 다른 곳으로 넘어가지 않게. 같은 문서 폴더 안 파일이면 그 파일을 연다 */
    const a=e.target.closest('.dv-mdv a');
    if(a){
      e.preventDefault();
      const href=a.getAttribute('href')||'';
      if(ed && href && !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('#')){
        const r2=resolveRel(parentOf(ed.rel), decodeURIComponent(href.split(/[?#]/)[0]));
        if(r2!=null) await showDoc(basePath(ed.i, r2));
      }
      return;
    }
    const row=e.target.closest('[data-dkey]');
    if(row) pick(row.dataset.dkey, row.dataset.ddir==='1', !!e.target.closest('[data-caret]'));
  });
  $('view-docs').addEventListener('input', e=>{ if(e.target.id==='dv-ta') onEdit(); });
  /* Ctrl+S — 문서 탭에서 고친 글자가 있고 팝업이 없으면 그 파일 저장(전역 Ctrl+S=백업보다 먼저) */
  document.addEventListener('keydown', e=>{
    if(!(e.ctrlKey||e.metaKey) || (e.key!=='s'&&e.key!=='S') || e.altKey || e.shiftKey) return;
    const v=$('view-docs'); if(!v || !v.classList.contains('on') || !ed || topId()) return;
    if(document.querySelector('.modal-bg.on, .form-panel.on, .alarm-bg.on, #appDialog.on')) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const ta=$('dv-ta'); if(ta && ed) { if(ta.value!==ed.text || ed.dirty){ ed.dirty=true; } }
    saveEdit().then(ok=>{ if(ok && ed) markSave(`저장됨 · ${encName(ed.encoding)}`); });
  }, true);
  /* 다른 탭으로 가면 고친 글자를 저장한다 */
  document.addEventListener('click', e=>{ if(e.target.closest && e.target.closest('.tab') && ed && ed.dirty) flushEdit(); }, true);
  window.addEventListener('focus', recheck);
  window.addEventListener('beforeunload', ()=>{ if(ed && ed.dirty) saveEdit(); });
}

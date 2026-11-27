/* =========================================================================
   파일·폴더 끌어다 놓기 → 링크 (v3.7.0, 소유자 요청)
   탐색기에서 파일·폴더를 창으로 끌어 오면 그 '경로'를 업무의 링크로 건다.

   어디에 놓았나로 갈린다 (dropTarget):
     · 양식이 열려 있으면      → 그 양식의 파일·폴더 링크 칸에 행 추가 (저장은 사용자 몫)
     · 보드·달력의 카드 위면   → 그 업무에 바로 연결 + [실행 취소] 토스트
     · 그 밖의 빈 곳이면       → 그 링크를 담은 새 양식을 연다
     · 문서 탭의 폴더 위면     → 그 폴더 안으로 **복사** (v3.8.1 — 원본은 그대로)
     · 다른 팝업이 위에 있거나 완료 업무면 → 아무것도 바꾸지 않고 이유만 알린다
       (완료 업무는 읽기 전용 — 증분 저장이 완료 업무를 다시 쓰지 않으므로, 여기서
        고치면 그 변경이 조용히 사라진다. form.js setReadonly 주석 참조)

   왜 Tauri 이벤트인가: 웹 페이지의 HTML5 drop 은 파일 '이름'만 주고 경로를 주지 않는다.
   경로는 네이티브 창만 안다 → tauri.conf.json 에서 메인 창 dragDropEnabled 를 켜고
   getCurrentWebview().onDragDropEvent 로 받는다. 그 대가로 내부 드래그(정렬·메모 합치기)는
   마우스 이벤트로 다시 짰다(dom-utils enableDragReorder · render.js initMergeDrag).

   규칙: 최상위 실행문 없음 — 배선은 initFileDrop() 에서. __TAURI__ 는 지연 접근.
   ========================================================================= */
import {S} from './state.js';
import {$, showToast} from './dom-utils.js';
import {topId} from './modals.js';
import {persist} from './render.js';
import {openForm, addLinkPaths, formReadonly, editDrafts} from './form.js';
import {dropFolderAt, importInto} from './docs.js';
import {invoke} from './store.js';

/* 경로 비교 키 — Windows 경로는 대소문자·구분자 차이를 같은 것으로 본다 */
const pathKey = p => String(p||'').trim().replace(/\//g,'\\').replace(/\\+$/,'').toLowerCase();

/* 기존 목록에 새 경로를 덧붙인다 (중복·빈 값 제외). 원본 불변. */
export function mergePaths(list, paths){
  const out=(list||[]).slice(), seen=new Set(out.map(pathKey));
  let added=0;
  for(const p of paths||[]){
    const v=String(p||'').trim(); const k=pathKey(v);
    if(!v||seen.has(k)) continue;
    seen.add(k); out.push(v); added++;
  }
  return {files:out, added};
}

/* 놓인 지점의 요소로 대상을 정한다 (순수 판정 — DOM 만 읽는다).
   반환: {kind:'form'} | {kind:'card', id} | {kind:'new'} | {kind:'blocked', why} */
export function dropTarget(el){
  const top=topId();
  if(top==='formPanel') return formReadonly() ? {kind:'blocked', why:'완료된 업무에는 연결할 수 없습니다. [다시 진행]으로 되돌린 뒤 놓으세요.'} : {kind:'form'};
  if(top) return {kind:'blocked', why:'열려 있는 창을 닫은 뒤 놓으세요.'};
  /* v3.8.1 문서 탭의 폴더(트리의 폴더 줄 · 가운데 폴더 보기) 위 → 그 폴더 안으로 복사 */
  const dk=dropFolderAt(el);
  if(dk) return {kind:'docdir', key:dk.key, label:dk.label, row:dk.row};
  /* v3.8.9: 문서 탭 가운데(문서 보기)는 놓는 자리가 아니다 — 글자를 골라 끌 때 '새 업무 양식' 안내가 떠서 헷갈렸다(소유자 지정) */
  if(el && el.closest && el.closest('#view-docs.on .dc-view')) return {kind:'none'};
  const card=el&&el.closest&&el.closest('.card[data-open]:not(.drag-ghost), .drow[data-open]');   // .drow = 완료 탭의 한 줄(v3.8.4)
  if(card){
    const it=S.items.find(x=>String(x.id)===card.dataset.open);
    if(!it) return {kind:'new'};
    if(it.done) return {kind:'blocked', why:'완료된 업무에는 연결할 수 없습니다. 완료를 취소한 뒤 놓으세요.'};
    return {kind:'card', id:it.id};
  }
  return {kind:'new'};
}

const fileName = p => (String(p||'').split(/[\\/]/).filter(Boolean).pop()||p);

/* 실제 적용 — 테스트에서 직접 부를 수 있게 분리 */
export function applyDrop(target, paths){
  paths=(paths||[]).filter(p=>String(p||'').trim());
  if(!paths.length) return false;
  if(target.kind==='none') return false;
  if(target.kind==='blocked'){ showToast(target.why); return false; }
  if(target.kind==='docdir'){ importInto(target.key, paths, !!target.mv); return true; }
  if(target.kind==='form'){ const n=addLinkPaths(paths); showToast(n?`링크 ${n}개를 양식에 추가했습니다. 저장해야 반영됩니다`:'이미 연결된 링크입니다'); return n>0; }
  if(target.kind==='card'){
    const it=S.items.find(x=>x.id===target.id); if(!it||it.done) return false;
    const before=(it.files||[]).slice();
    const {files, added}=mergePaths(before, paths);
    if(!added){ showToast('이미 연결된 링크입니다'); return false; }
    it.files=files;
    /* 이 업무에 임시저장분이 있으면 거기에도 붙인다 — 안 붙이면 양식을 열어 [저장]할 때 방금 놓은 링크가 빠진다(form.js editDrafts) */
    /* 실행 취소 때 그 뒤 양식에 더 쓴 임시저장분이면 이번에 붙인 링크만 뺀다(그 사이 쓴 글은 남긴다 — form.js undoDraftEdits) */
    let addedKeys=new Set();
    const undoDraft=editDrafts([it.id], d=>{
      const r=mergePaths(d.files||[], paths); if(!r.added) return undefined;
      addedKeys=new Set(r.files.slice((d.files||[]).length).map(pathKey));
      return {...d, files:r.files};
    }, d=>{
      const files=(d.files||[]).filter(p=>!addedKeys.has(pathKey(p)));
      return files.length===(d.files||[]).length ? undefined : {...d, files};
    });
    persist();
    const memo=String(it.memo||'').split('\n')[0].slice(0,24);
    showToast(`'${memo||'업무'}'에 링크 ${added}개를 연결했습니다`,()=>{
      const cur=S.items.find(x=>x.id===target.id); if(cur&&!cur.done){ cur.files=before; undoDraft(); persist(); }
    });
    return true;
  }
  /* 새 양식 — 메모는 비워 두고(사용자가 쓴다) 링크만 채운다 */
  openForm({files:mergePaths([], paths).files});
  showToast(`${paths.length===1?fileName(paths[0]):'링크 '+paths.length+'개'}을(를) 새 업무 양식에 담았습니다`);
  return true;
}

/* ── 화면 표시(드래그 중 안내) ── */
function clearHl(){
  document.querySelectorAll('.drop-on').forEach(el=>el.classList.remove('drop-on'));
  const v=$('dropVeil'); if(v) v.classList.remove('on');
}
function showHl(target, el){
  clearHl();
  if(target.kind==='none') return;
  const v=$('dropVeil'), c=$('dropCard'); if(!v||!c) return;
  v.classList.add('on');
  v.classList.toggle('framed', target.kind!=='form' && target.kind!=='card' && target.kind!=='docdir');   // 전체 테두리는 빈 곳·막힘일 때만
  if(target.kind==='form'){ const w=document.querySelector('.fm-files-wrap'); if(w) w.classList.add('drop-on'); c.textContent='놓으면 이 양식의 링크 칸에 추가합니다'; }
  else if(target.kind==='card'){ const card=el&&el.closest('.card[data-open]'); if(card) card.classList.add('drop-on'); c.textContent='놓으면 이 업무에 링크로 연결합니다'; }
  else if(target.kind==='blocked'){ c.textContent=target.why; }
  else if(target.kind==='docdir'){ if(target.row) target.row.classList.add('drop-on'); c.textContent=`놓으면 '${target.label}' 폴더로 ${shiftNow?'옮깁니다':'복사합니다 · Shift 를 누르면 옮기기'}`; }
  else c.textContent='놓으면 이 링크로 새 업무 양식을 엽니다';
}
/* 네이티브 좌표(물리 px, 웹뷰 기준) → CSS px. devicePixelRatio 에 DPI·화면 배율이 모두 들어 있다 */
function elAt(pos){
  if(!pos||typeof document.elementFromPoint!=='function') return null;
  const r=window.devicePixelRatio||1;
  return document.elementFromPoint(pos.x/r, pos.y/r);
}

/* v3.8.3 문서 폴더로 끌어 올 때 Shift = 옮기기. 탐색기에서 끄는 동안 웹뷰는 키 입력을 못 받으므로
   Windows 에 직접 묻는다(key_shift_down). 끄는 동안 0.15초마다 묻고, 놓을 때 한 번 더 묻는다. */
let shiftNow=false, shiftAt=0;
const askShift = () => invoke('key_shift_down').then(v=>!!v, ()=>false);
/* v3.8.9: 끄는 것이 파일이 아니면(문서 보기에서 고른 글자·그림 — 경로가 없다) 아무 안내도 하지 않는다 */
let noPaths=false;
export async function handleDragDrop(payload){
  const p=payload||{};
  if(p.type==='leave'){ clearHl(); shiftNow=false; noPaths=false; return; }
  if(p.type==='enter') noPaths=!(p.paths||[]).length;
  if(noPaths && p.type!=='drop'){ clearHl(); return; }
  if(p.type==='enter'||p.type==='over'){
    const el=elAt(p.position), t=dropTarget(el); showHl(t, el);
    if(t.kind==='docdir' && Date.now()-shiftAt>150){
      shiftAt=Date.now();
      const v=await askShift();
      if(v!==shiftNow){ shiftNow=v; const el2=elAt(p.position); showHl(dropTarget(el2), el2); }
    }
    return;
  }
  if(p.type==='drop'){
    noPaths=false;
    const el=elAt(p.position), t=dropTarget(el); clearHl();
    if(t.kind==='docdir') t.mv = shiftNow || await askShift();
    shiftNow=false;
    applyDrop(t, p.paths||[]);
  }
}

export function initFileDrop(){
  try{
    const wv=window.__TAURI__&&window.__TAURI__.webview&&window.__TAURI__.webview.getCurrentWebview&&window.__TAURI__.webview.getCurrentWebview();
    if(!wv||typeof wv.onDragDropEvent!=='function') return;      // 브라우저·테스트 — 조용히 생략
    wv.onDragDropEvent(ev=>{ try{ handleDragDrop(ev&&ev.payload); }catch(e){ console.warn('파일 놓기 처리 실패',e); clearHl(); } })
      .catch(e=>console.warn('파일 놓기 이벤트 등록 실패',e));
  }catch(e){ console.warn('파일 놓기 초기화 실패',e); }
}

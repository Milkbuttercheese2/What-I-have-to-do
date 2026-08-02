/* =========================================================================
   DOM 유틸 — 요소 조회 · 이스케이프 · 토스트 · 드래그 재정렬 · 알림 권한
   ========================================================================= */
export const $ = id => document.getElementById(id);

/* F8: 숫자 등 비문자열이 들어와도 죽지 않도록 문자열화 */
export function esc(s){return String(s ?? '').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
/* F11: '&'를 먼저 이스케이프해야 편집 왕복 시 &amp; 가 &로 붕괴하지 않음 */
export function escAttr(s){return String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

/* 드래그로 순서 바꾸기 — 핸들(.drag-handle)을 잡아야만 드래그 시작.
   컨테이너 안의 rowSelector 요소들을 재정렬. onDrop(container) 콜백으로 저장 처리. */
export function enableDragReorder(container, rowSelector, handleSelector, onDrop){
  let dragEl=null;
  const clearDraggable=()=>container.querySelectorAll('[draggable="true"]').forEach(r=>r.removeAttribute('draggable'));
  container.addEventListener('mousedown',e=>{
    const h=e.target.closest(handleSelector);
    const row=e.target.closest(rowSelector);
    if(h&&row&&container.contains(row)) row.setAttribute('draggable','true');
  });
  // 컨테이너 밖에서 놓아도 draggable 이 남지 않도록 문서 전역에서 해제
  document.addEventListener('mouseup',()=>{ if(!dragEl) clearDraggable(); });
  container.addEventListener('dragstart',e=>{
    const row=e.target.closest(rowSelector);
    if(!row||row.getAttribute('draggable')!=='true'){ e.preventDefault(); return; }
    dragEl=row; row.classList.add('dragging');
    try{ e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain',''); }catch{}
  });
  container.addEventListener('dragover',e=>{
    if(!dragEl)return; e.preventDefault();
    const after=[...container.querySelectorAll(rowSelector+':not(.dragging)')].reduce((closest,child)=>{
      const box=child.getBoundingClientRect(); const offset=e.clientY-box.top-box.height/2;
      if(offset<0&&offset>closest.offset) return {offset,el:child}; return closest;
    },{offset:-Infinity,el:null}).el;
    if(after==null) container.appendChild(dragEl); else container.insertBefore(dragEl,after);
  });
  container.addEventListener('drop',e=>{ e.preventDefault(); });
  container.addEventListener('dragend',()=>{
    if(dragEl){ dragEl.classList.remove('dragging'); }
    dragEl=null; clearDraggable(); if(onDrop) onDrop(container);
  });
}

/* 실행취소 토스트 */
let _toastTimer=null,_undoFn=null;
export function showToast(msg,undoFn){ $('toast-msg').textContent=msg; _undoFn=undoFn||null; $('toast-undo').style.display=undoFn?'inline-block':'none';
  $('toast').classList.add('on'); clearTimeout(_toastTimer); _toastTimer=setTimeout(()=>{$('toast').classList.remove('on');_undoFn=null;},6000); }
export function initToast(){
  $('toast-undo').addEventListener('click',()=>{ if(_undoFn){const fn=_undoFn;_undoFn=null;$('toast').classList.remove('on');clearTimeout(_toastTimer);fn();} });
}

/* 저장 실패 표시 — 조용한 성공/시끄러운 실패. 저장 성공 시엔 아무 것도 띄우지 않고,
   실패하면 다음 저장이 성공할 때까지 계속 떠 있는 경고 배너를 켠다(store.js가 호출).
   요소가 없어도(테스트 하네스 등) 죽지 않게 널 가드. */
/* v3.3.4: 저장을 계속 다시 시도하므로 문구도 '실패했다'가 아니라 '다시 시도 중'이다.
   비상 덤프까지 갔으면 그 파일 경로를 함께 보여준다 — 사용자가 붙잡을 수 있는
   구체적인 것 하나(어디에 남아 있는가)가 안내문 열 줄보다 낫다. */
export function showSaveError(dumpPath){
  const el=$('saveAlert'); if(!el) return;
  el.classList.add('on');
  const d=$('saveAlertDump');
  if(d && dumpPath){ d.textContent='데이터를 파일로 따로 남겨두었습니다: '+dumpPath; d.style.display=''; }
}
export function clearSaveError(){
  const el=$('saveAlert'); if(el) el.classList.remove('on');
  const d=$('saveAlertDump'); if(d){ d.textContent=''; d.style.display='none'; }
}

/* ── 앱 표준 대화상자 (v3.3.0 소유자 지정) ────────────────────────────────
   네이티브 alert/confirm 은 창 제목이 'wmhh-desktop' 으로 뜨고 버튼·글꼴이 OS
   것이라 앱과 따로 논다. 같은 문법의 표준 모달(.modal-bg > .modal)로 통일한다.
   - appAlert(msg) → Promise<void>, appConfirm(msg) → Promise<boolean>
   - ESC/배경 클릭 = 취소(확인은 버튼으로만) — 실수로 진행되지 않게.
   - 테스트 하니스 호환: window.confirm/alert 가 스텁된 환경(jsdom)에서는
     그 스텁을 그대로 쓴다(기존 테스트 계약 유지 — env.answerConfirm/alerts). */
let dlgEl=null, dlgResolve=null;
function ensureDialog(){
  if(dlgEl) return dlgEl;
  dlgEl=document.createElement('div');
  dlgEl.className='modal-bg'; dlgEl.id='appDialog';
  dlgEl.innerHTML=`<div class="modal modal-narrow" role="alertdialog" aria-modal="true">
    <h3 id="dlg-title">알림</h3>
    <div class="m-sub" id="dlg-msg"></div>
    <div class="m-actions">
      <button class="btn btn-cancel" id="dlg-cancel" style="display:none">취소</button>
      <button class="btn btn-ok" id="dlg-ok">확인</button>
    </div>
  </div>`;
  document.body.appendChild(dlgEl);
  const close=v=>{ dlgEl.classList.remove('on'); const r=dlgResolve; dlgResolve=null; if(r) r(v); };
  dlgEl.querySelector('#dlg-ok').addEventListener('click',()=>close(true));
  dlgEl.querySelector('#dlg-cancel').addEventListener('click',()=>close(false));
  dlgEl.addEventListener('click',e=>{ if(e.target===dlgEl) close(false); });   // 배경 클릭 = 취소
  document.addEventListener('keydown',e=>{
    if(!dlgEl.classList.contains('on')) return;
    if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); close(false); }
    else if(e.key==='Enter'){ e.preventDefault(); e.stopPropagation(); close(true); }
  }, true);
  return dlgEl;
}
function openDialog(msg, withCancel, title){
  const el=ensureDialog();
  el.querySelector('#dlg-title').textContent=title||(withCancel?'확인':'알림');
  /* 줄바꿈을 살려 보여준다(기존 문구들이 \n 으로 문단을 나눈다) */
  el.querySelector('#dlg-msg').textContent=String(msg==null?'':msg);
  el.querySelector('#dlg-cancel').style.display=withCancel?'inline-block':'none';
  el.querySelector('#dlg-ok').textContent=withCancel?'확인':'확인';
  el.classList.add('on');
  setTimeout(()=>{ const b=el.querySelector('#dlg-ok'); if(b&&b.focus) b.focus(); },0);
  return new Promise(res=>{ dlgResolve=res; });
}
/* jsdom 테스트 하니스는 window.confirm/alert 를 제어용으로 스텁한다 —
   그 환경에서는 스텁을 그대로 태워 기존 테스트 계약(answerConfirm/alerts)을 지킨다. */
const isStubbed=fn=>{ try{ return typeof window[fn]==='function' && !/\[native code\]/.test(Function.prototype.toString.call(window[fn])); }catch{ return false; } };
export function appAlert(msg, title){
  if(isStubbed('alert')){ window.alert(msg); return Promise.resolve(); }
  return openDialog(msg, false, title).then(()=>{});
}
export function appConfirm(msg, title){
  if(isStubbed('confirm')) return Promise.resolve(!!window.confirm(msg));
  return openDialog(msg, true, title);
}

/* 알림 권한 요청 (최초 1회) — persist()가 부르므로 알람 모듈이 아닌 여기에 둔다 */
let notifyAsked=false;
export function askNotify(){ if(notifyAsked||!('Notification'in window))return; notifyAsked=true; if(Notification.permission==='default'){try{Notification.requestPermission();}catch{}} }

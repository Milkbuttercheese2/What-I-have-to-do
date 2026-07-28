/* =========================================================================
   미니 캡처 창 로직 — 이 파일은 capture 웹뷰에서만 돈다.
   메인 앱 모듈(state.js/store.js 등)을 import하지 말 것: store.js의 최상위
   __TAURI__ 구조분해가 테스트를 깨고, 모듈 상태가 두 웹뷰에서 이중 실행된다.
   저장도 직접 하지 않는다 — 메모 텍스트를 이벤트로 메인 창에 던지면
   메인 창의 captureMemo()가 F1 로드 게이트·저장 큐를 그대로 태운다.

   동작 (v2.5.21에서 기본 모드가 검색으로 바뀜 — 소유자 지정):
   - 검색 모드(기본): 창을 열 때마다 검색칸이 빈 상태로 뜬다. 내 업무(quick_search)를
     검색해 클릭하면 메인 창에서 열린다.
   - Alt: 빠른 메모 모드 토글. Ctrl+Enter 등록, Esc/blur = 숨김만 (내용은 절대 안 지움 —
     지우는 건 사용자 몫). 입력할 때마다 초안을 메인 창으로 흘려보내
     settings.captureDraft로 저장 → 앱이 꺼져도 다음 실행 때 분류 대기로 자동 등록.
     메모 초안은 별도 입력칸이라 검색 모드로 오가도 남는다.
   - v2.6.3: 테마는 앱 전체에 하나다(메인 창과 같은 값 — 검색·빠른 메모·양식 메모가 같은 색).
     화면 배치(첫 화면 / Alt 로 넘어갈 화면 — 검색·빠른 메모·
     양식 메모 중 둘, 3P2 = 6가지)를 설정에서 고른다. '양식 메모'는 이 창이 담지 못하므로
     메인 창 양식을 연다(첫 화면이 양식 메모면 Rust 가 아예 이 창을 띄우지 않는다). 이 창은 DB를 직접 읽지 않고 메인 창에 'capture-hello'로 물어보면
     메인이 'capture-config'로 내려준다 — 설정의 소유자는 메인 창 하나다.
   - 입력칸에 placeholder를 두지 않는다(v2.5.21): 빈 칸의 회색 문구를 실제 글자로 오해해
     "그 단어 뒤로 커서가 안 간다"는 혼선이 있었다. 안내는 아래 힌트줄(#cap-hint)이 맡는다.
   ========================================================================= */
let submitting=false;                       // 등록 플래시 중 blur로 조기 숨김 방지
let mode='memo';                            // 'memo' | 'search' (init에서 설정값으로 진입)
/* v2.6.0 설정값 — 메인 창이 'wmhh://capture-config' 로 내려준다(요청은 capture-hello).
   이 창은 DB를 직접 읽지 않는다: 설정의 단일 소유자는 메인 창이다. */
let cfg={theme:'light', capStart:'search', capSecond:'memo'};
let ready=false;                            // 설정을 한 번이라도 받았는가

const SCREEN_NAME={search:'내 업무 검색', memo:'빠른 메모', form:'양식 메모'};
const HINT={search:'내 업무 검색 · ↑↓ 이동 · Enter 열기', memo:'빠른 메모 · Ctrl+Enter(또는 Ctrl+S) 등록'};
/* 힌트줄 문구 — 배치(첫/둘째 화면)에 따라 'Alt 를 누르면 …' 부분이 달라진다 */
function hintFor(m){
  const other = (m===cfg.capStart) ? cfg.capSecond : cfg.capStart;
  return HINT[m] + (other&&other!==m ? ` · Alt 를 누르면 ${SCREEN_NAME[other]}` : '');
}

/* 설정 적용 — 테마는 body.light 한 줄로 갈린다(색은 capture.html 토큰) */
export function applyCaptureConfig(c){
  c=c||{};
  if(c.theme) cfg.theme=c.theme;
  if(c.capStart) cfg.capStart=c.capStart;
  if(c.capSecond) cfg.capSecond=c.capSecond;
  document.body.classList.toggle('light', cfg.theme!=='dark');   // 앱 전체 테마를 그대로 따른다
  $id('cap-hint').textContent=hintFor(mode);
}
/* 메인 창에 설정을 달라고 알린다 (부팅 직후·창이 다시 뜰 때마다) */
function askConfig(){ window.__TAURI__.event.emitTo('main','wmhh://capture-hello',{}).catch(()=>{}); }
let draftTimer=null, searchTimer=null, searchSeq=0;
let selIdx=-1;                              // 검색 결과 선택 위치 (v2.6.4 방향키 이동)
/* v2.6.4: 창이 막 뜬 직후의 blur 는 무시한다.
   다른 앱(브라우저 등)이 뜨는 중에 단축키를 누르면, 창이 보이자마자 그 앱이 포커스를
   가져가며 blur 가 날아온다 → 예전엔 그 blur 로 창을 곧장 숨겨서 "단축키를 눌렀는데
   아무것도 안 뜬다 / 떴다가 사라진다"로 보였다. 뜬 직후 잠깐은 살려둔다. */
let shownAt=0;
const JUST_SHOWN_MS=450;

const hideWin=()=>window.__TAURI__.window.getCurrentWindow().hide();   // 지연 접근 (테스트 하네스 제약)
const invoke=(cmd,args)=>window.__TAURI__.core.invoke(cmd,args);
const $id=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* 메모 입력칸 세로 자동 확장 (rows=1 시작 → 내용 따라 늘어남, 상한 110px).
   기본 textarea가 2줄이라 한 줄 메모가 위로 떠 보이던 문제를 없앤다. */
function autoGrow(el){ if(!el)return; el.style.height='auto'; el.style.height=Math.min(el.scrollHeight,110)+'px'; }

/* 초안을 메인 창으로 (메인이 settings.captureDraft에 저장) — 등록/삭제 포함 모든 변경 */
function sendDraft(text){
  window.__TAURI__.event.emitTo('main','wmhh://capture-draft',{text:String(text??'')}).catch(()=>{});
}

/* 화면 크기(v2.5.15)는 이 창이 스스로 처리하지 않는다 — 메인 창에서 Ctrl+휠로
   바꾸면 Rust(set_ui_scale)가 이 웹뷰의 배율과 네이티브 창 크기를 함께 맞춰준다.
   여기서 논리 높이(126/406)만 알려주면 Rust 가 현재 배율을 곱해 적용한다. */

function setMode(m){
  mode=m;
  const search=m==='search';
  document.body.classList.toggle('search',search);
  $id('cap-inp').style.display=search?'none':'';
  $id('cap-search').style.display=search?'':'none';
  $id('cap-results').style.display=search?'flex':'none';
  $id('cap-hint').textContent=hintFor(m);
  invoke('resize_capture',{height:search?406:126}).catch(()=>{});   // 메모 모드 = 낮은 바, 검색 모드 = 목록 높이
  const t=search?$id('cap-search'):$id('cap-inp');
  t.focus(); const n=t.value.length; try{t.setSelectionRange(n,n);}catch{}
  if(search) runSearch($id('cap-search').value.trim());
}

async function runSearch(q){
  const seq=++searchSeq;
  const iw=$id('cap-items');
  selIdx=-1;
  if(!q){ iw.innerHTML='<div class="cap-empty">검색어를 입력하세요</div>'; return; }
  const items=await invoke('quick_search',{query:q}).catch(()=>[]);
  if(seq!==searchSeq) return;               // 그 사이 새 검색어 입력됨
  iw.innerHTML=items.length?items.map(h=>
    `<div class="cap-hit${h.done?' done':''}" data-item="${h.id}"><span class="cap-tag ${h.done?'done':'ongoing'}">${h.done?'완료':'진행'}</span><span class="cap-hit-txt">${esc(h.memo||'(메모 없음)')}</span></div>`
  ).join(''):'<div class="cap-empty">일치하는 업무 없음</div>';
  if(items.length) setSel(0);               // 첫 항목을 미리 골라둬 Enter 만 눌러도 열린다
}

/* ── 검색 결과 키보드 이동 (v2.6.4) ──────────────────────────────────────
   ↑/↓ 로 고르고 Enter 로 연다. 선택은 화면(.sel)에만 있는 상태라 데이터와 무관하다. */
function hits(){ return [...$id('cap-items').querySelectorAll('.cap-hit')]; }
function setSel(i){
  const list=hits(); if(!list.length){ selIdx=-1; return; }
  selIdx=(i+list.length)%list.length;       // 끝에서 넘어가면 반대쪽으로 (순환)
  list.forEach((el,n)=>el.classList.toggle('sel', n===selIdx));
  const el=list[selIdx];
  if(el&&el.scrollIntoView) el.scrollIntoView({block:'nearest'});
}
function moveSel(d){ if(hits().length) setSel(selIdx<0 ? (d>0?0:-1) : selIdx+d); }
function openSel(){
  const el=hits()[selIdx]; if(!el) return false;
  openItem(Number(el.dataset.item)); return true;
}
/* 업무 하나를 메인 창에서 열기 — 클릭·Enter 공용 */
function openItem(id){
  window.__TAURI__.event.emitTo('main','wmhh://open-item',{id}).catch(()=>{});
  invoke('focus_main_window').catch(()=>{});
  hideWin();
}

/* 빠른 메모 등록 — Ctrl+Enter / Ctrl+S 공용 (v2.6.4) */
function submitMemo(){
  const inp=$id('cap-inp');
  const t=inp.value.trim(); if(!t){ hideWin(); return; }
  window.__TAURI__.event.emitTo('main','wmhh://capture-memo',{text:t}).catch(()=>{});
  inp.value=''; autoGrow(inp); clearTimeout(draftTimer); sendDraft('');   // 등록됐으니 초안 비움
  submitting=true; document.body.classList.add('flash');
  setTimeout(()=>{ document.body.classList.remove('flash'); submitting=false; hideWin(); },400);
}

export function initCaptureWin(){
  /* 구성(capture-config)이 도착하기 전 한 프레임: 지난번 값 캐시로 그려 깜빡임을 없앤다.
     진실은 메인 창이 내려주는 값이고, 도착하면 그걸로 덮어쓴다(theme.js cacheForBoot). */
  try{
    applyCaptureConfig({theme:localStorage.getItem('wmhhTheme')||'light',
                        capStart:localStorage.getItem('wmhhCapStart')||'search',
                        capSecond:localStorage.getItem('wmhhCapSecond')||'memo'});
  }catch{}
  const inp=$id('cap-inp');
  inp.addEventListener('input',()=>{
    autoGrow(inp);
    clearTimeout(draftTimer);
    draftTimer=setTimeout(()=>sendDraft(inp.value),400);
  });
  inp.addEventListener('keydown',e=>{
    if(e.isComposing||e.keyCode===229) return;   // 한글 IME 조합 중 오등록 방지
    if(e.key==='Escape'){ e.preventDefault(); sendDraft(inp.value); hideWin(); return; }   // 내용 유지!
    /* 메인 바로 입력(form.js)과 동일: Ctrl(⌘)+Enter=등록, 맨 Enter=줄바꿈.
       v2.6.4: Ctrl+S 도 '저장' — 앱 전체에서 Ctrl+S=저장으로 통일한 규칙을 여기도 적용한다. */
    if((e.key==='Enter'&&(e.ctrlKey||e.metaKey)) || ((e.key==='s'||e.key==='S')&&(e.ctrlKey||e.metaKey))){
      e.preventDefault(); submitMemo();
    }
  });

  const searchInp=$id('cap-search');
  searchInp.addEventListener('keydown',e=>{
    if(e.isComposing||e.keyCode===229) return;   // 한글 조합 중에는 목록 조작·확정 금지
    if(e.key==='Escape'){ e.preventDefault(); hideWin(); return; }   // 다음에 열 때 어차피 검색 모드로 초기화
    if(e.key==='ArrowDown'){ e.preventDefault(); moveSel(1); return; }
    if(e.key==='ArrowUp'){ e.preventDefault(); moveSel(-1); return; }
    if(e.key==='Enter'){ e.preventDefault(); openSel(); return; }
  });
  searchInp.addEventListener('input',()=>{
    clearTimeout(searchTimer);
    searchTimer=setTimeout(()=>runSearch(searchInp.value.trim()),250);
  });

  /* Alt = 설정한 '다른 화면'으로 전환. 양식 메모는 이 창이 담지 못하므로 메인 창으로 넘긴다. */
  document.addEventListener('keydown',e=>{
    if(e.key!=='Alt'||e.repeat) return;
    e.preventDefault();
    const target = (mode===cfg.capStart) ? cfg.capSecond : cfg.capStart;
    if(target==='form'){ openMainForm(); return; }
    setMode(target==='memo'?'memo':'search');
  });

  /* (v2.5.5 제거) 'Ctrl 단독 → 메인 창 최대화' 기능 삭제 — 의도치 않게 자주 발동돼 제거. */

  /* 검색 결과 클릭 — 업무를 메인 창에서 연다 */
  $id('cap-results').addEventListener('click',e=>{
    const ih=e.target.closest('[data-item]');
    if(ih) openItem(Number(ih.dataset.item));
  });

  /* 포커스를 잃으면 숨김 — 초안은 유지 + 저장 플러시 */
  autoGrow(inp);   // 초기 높이(빈 상태 1줄) 세팅 — 첫 열 때 글자 배열 정상화
  window.addEventListener('blur',()=>{
    if(submitting) return;
    if(Date.now()-shownAt < JUST_SHOWN_MS) return;   // 뜨자마자 온 blur = 다른 창이 포커스를 가져간 것
    sendDraft(inp.value); hideWin();
  });
  /* 창이 다시 뜨면(=focus) 항상 빈 검색 모드로 초기화 — 지난 검색어가 남아 있지 않게.
     메모 초안(textarea)은 건드리지 않는다: Alt 로 넘어가면 그대로 이어 쓴다. */
  window.addEventListener('focus',()=>{ shownAt=Date.now(); askConfig(); openFresh(); });
  window.__TAURI__.event.listen('wmhh://capture-config', ev=>{
    const first = !ready; ready=true;
    applyCaptureConfig(ev.payload||{});
    if(first) openFresh();          // 설정이 도착한 뒤 시작 화면을 다시 잡는다
  }).catch(()=>{});
  askConfig();
  openFresh();
}

/* '양식 메모' — 미니 창을 접고 메인 창의 빈 양식을 연다 (Rust 가 여는 경로와 같은 이벤트) */
function openMainForm(){
  window.__TAURI__.event.emitTo('main','wmhh://open-blank-form',{}).catch(()=>{});
  invoke('focus_main_window').catch(()=>{});
  submitting=true; setTimeout(()=>{ submitting=false; },400);   // blur 로 인한 중복 숨김 방지
  hideWin();
}

/* Ctrl+Alt+Space 로 열릴 때의 초기 상태: 입력칸을 비우고 설정된 첫 화면으로 */
export function openFresh(){
  shownAt=Date.now();
  $id('cap-search').value='';
  setMode(cfg.capStart==='memo'?'memo':'search');   // 'form' 이면 Rust 가 이 창을 안 띄운다(방어적으로 검색)
}

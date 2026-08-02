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
/* phonebook-core.js 는 상태·DOM·Tauri 접근이 없는 순수 모듈이라 여기서 import 해도
   안전하다 — "메인 모듈 import 금지"의 이유(최상위 부작용·모듈 상태 이중 실행)가
   둘 다 없다. 전화번호부 데이터 자체는 DB 를 직접 읽지 않고 phonebook_search
   커맨드로 조회한다(quick_search 와 같은 경로). */
import {atToken, applyInsert, tagText, queryReady, linkifyAt} from './phonebook-core.js';

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
/* v2.7.0 빠른 메모 @ 자동완성 — 전화번호부(phonebook_search) 드롭다운 상태 */
let pbItems=[], pbSel=0, pbToken=null, pbTimer=null, pbSeq=0, pbOpen=false;
/* v3.0.1 본문 @태그 하이라이트용 전체 목록 — 실존 관련인 판정(linkifyAt book 인자).
   phonebook_list 로 창이 뜰 때마다 갱신(메인 창에서 전화번호부를 고쳐도 다음 표시에 반영). */
let pbBook=[];
/* v2.6.4: 창이 막 뜬 직후의 blur 는 무시한다.
   다른 앱(브라우저 등)이 뜨는 중에 단축키를 누르면, 창이 보이자마자 그 앱이 포커스를
   가져가며 blur 가 날아온다 → 예전엔 그 blur 로 창을 곧장 숨겨서 "단축키를 눌렀는데
   아무것도 안 뜬다 / 떴다가 사라진다"로 보였다. 뜬 직후 잠깐은 살려둔다. */
let shownAt=0;
const JUST_SHOWN_MS=450;

/* 창을 감출 때 화면을 '미리' 비운다 (v2.6.6).
   이 창은 닫히는 게 아니라 숨는 것뿐이라 DOM 이 그대로 남는다. 예전처럼 '다시 뜬 뒤에'
   비우면, 뜨는 첫 프레임에 지난 검색어와 결과가 한 번 번쩍였다가 지워진다.
   감출 때 비워 두면 다음에 뜰 때 처음부터 빈 화면이다. 메모 초안(textarea)은 건드리지 않는다. */
function resetSearchUI(){
  document.body.classList.remove('mouse');       // 새로 뜰 땐 hover 하이라이트 없이 시작
  closePb(true);                                 // v2.7.0: 숨는 김에 @ 자동완성도 접는다 (setMode 가 높이 복원)
  clearTimeout(searchTimer); searchSeq++;        // 진행 중이던 검색이 뒤늦게 그려지지 않게
  const s=$id('cap-search'); if(s) s.value='';
  selIdx=-1;
  const iw=$id('cap-items'); if(iw) iw.innerHTML='<div class="cap-empty">검색어를 입력하세요</div>';
  setMode(cfg.capStart==='memo'?'memo':'search');  // 숨은 채로 첫 화면·창 높이까지 맞춰 둔다
}
const hideWin=()=>{                                   // 지연 접근 (테스트 하네스 제약)
  resetSearchUI();
  return window.__TAURI__.window.getCurrentWindow().hide();
};
const invoke=(cmd,args)=>window.__TAURI__.core.invoke(cmd,args);
const $id=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* 메모 입력칸 세로 자동 확장 (rows=1 시작 → 내용 따라 늘어남, 상한 110px).
   기본 textarea가 2줄이라 한 줄 메모가 위로 떠 보이던 문제를 없앤다. */
function autoGrow(el){ if(!el)return; el.style.height='auto'; el.style.height=Math.min(el.scrollHeight,110)+'px'; }

/* ── v3.0.1 빠른 메모 본문 @태그 하이라이트 + hover 반응 ────────────────
   양식 메모(form.js renderMemoHl)와 같은 백드롭 층 기법 — 실존 관련인 태그만.
   hover 는 백드롭 태그 span 의 실제 사각형에 커서가 들어왔는지로 판정한다
   (textarea 가 위에 있어 CSS :hover 가 불가능한 구조). */
function loadBook(){
  invoke('phonebook_list').then(b=>{ pbBook=Array.isArray(b)?b:[]; renderCapHl(); }).catch(()=>{});
}
function renderCapHl(){
  const hl=$id('cap-hl'); if(!hl) return;
  hl.innerHTML=linkifyAt(esc($id('cap-inp').value), pbBook)+'\n';
}
function wireTagHover(ta, hl){
  let raf=0;
  ta.addEventListener('mousemove',e=>{
    if(raf) return;
    raf=requestAnimationFrame(()=>{ raf=0;
      let hit=null;
      hl.querySelectorAll('.at-tag').forEach(sp=>{
        const r=sp.getBoundingClientRect();
        if(!hit && e.clientX>=r.left && e.clientX<=r.right && e.clientY>=r.top && e.clientY<=r.bottom) hit=sp;
        sp.classList.remove('hover');
      });
      if(hit) hit.classList.add('hover');
      ta.style.cursor=hit?'pointer':'';
    });
  });
  ta.addEventListener('mouseleave',()=>{ hl.querySelectorAll('.at-tag.hover').forEach(s=>s.classList.remove('hover')); ta.style.cursor=''; });
}

/* 초안을 메인 창으로 (메인이 settings.captureDraft에 저장) — 등록/삭제 포함 모든 변경 */
function sendDraft(text){
  window.__TAURI__.event.emitTo('main','wmhh://capture-draft',{text:String(text??'')}).catch(()=>{});
}

/* 화면 크기(v2.5.15)는 이 창이 스스로 처리하지 않는다 — 메인 창에서 Ctrl+휠로
   바꾸면 Rust(set_ui_scale)가 이 웹뷰의 배율과 네이티브 창 크기를 함께 맞춰준다.
   여기서 논리 높이(126/406)만 알려주면 Rust 가 현재 배율을 곱해 적용한다. */

/* ── 빠른 메모 @ 자동완성 (v2.7.0) ───────────────────────────────────────
   @김철 처럼 치면 전화번호부를 검색해 목록을 펴고(창 높이도 잠깐 늘린다),
   고르면 "김철수(소속 전화)" 텍스트가 커서 자리에 들어간다. 메모 모드 전용. */
const PB_BASE_H=126;                        // 메모 모드 기본 창 높이 (setMode 와 동일 값)
function closePb(skipResize){
  clearTimeout(pbTimer); pbSeq++;
  /* v3.0.4: 화면 정리는 pbOpen 과 무관하게 **항상** 한다. 예전엔 여기서 먼저
     빠져나가는 바람에(pbOpen=false) 화면에 펴진 목록이 그대로 남을 수 있었다 —
     검색 화면에 빈 띠가 하나 더 생기던 버그. 표시 자체는 CSS 가 갈라 주지만
     (body.pb) 내용·상태는 여기서 확실히 비운다. */
  const wasOpen=pbOpen;
  pbOpen=false; pbItems=[]; pbToken=null;
  document.body.classList.remove('pb');
  const w=$id('cap-pb'); if(w) w.innerHTML='';
  if(!wasOpen) return;
  /* setMode 가 곧바로 제 높이를 다시 정하므로 그 경로에선 이중 resize 를 피한다 */
  if(!skipResize && mode==='memo') invoke('resize_capture',{height:PB_BASE_H}).catch(()=>{});
}
function renderPb(){
  const w=$id('cap-pb'); if(!w) return;
  w.innerHTML=pbItems.map((e,i)=>`<div class="cap-pb-it${i===pbSel?' sel':''}" data-pb="${i}">
    <span class="cap-pb-who">${esc(e.who||'—')}</span><span class="cap-pb-org">${esc(e.org||'')}</span><span class="cap-pb-phone">${esc(e.phone||'')}</span>
  </div>`).join('');
  const sel=w.querySelector('.cap-pb-it.sel');
  if(sel&&sel.scrollIntoView) sel.scrollIntoView({block:'nearest'});   // 10행 넘어 스크롤 시 선택 추적 (v3.2.1)
}
async function runPb(){
  const inp=$id('cap-inp');
  const t=atToken(inp.value, inp.selectionStart);
  if(!t||!queryReady(t.query)){ closePb(); return; }   // v2.10.0 문턱값(이름 2글자·번호 3자리, 010 제외)
  const seq=++pbSeq;
  const found=(await invoke('phonebook_search',{query:t.query}).catch(()=>[]))||[];
  if(seq!==pbSeq || mode!=='memo') return;    // 그 사이 입력이 바뀌었거나 모드 이탈
  if(!found.length){ closePb(); return; }
  pbItems=found; pbSel=0; pbToken={start:t.start, caret:inp.selectionStart};
  /* v2.9.0: 목록이 펴질 땐 입력칸의 flex:1 을 끈다(body.pb) — 안 끄면 늘어난 창
     높이를 입력칸이 흡수해 입력·힌트·목록이 벌어진 3분할로 찢어져 보인다.
     v3.0.4: 펴고 접는 유일한 스위치가 이 클래스다(인라인 style.display 금지 —
     capture.html 주석 참조). */
  document.body.classList.add('pb');
  renderPb();
  if(!pbOpen){ pbOpen=true; }
  /* v3.2.2 높이 공식 교정: PB_BASE_H(126) 가산은 메모 모드의 여유 슬랙까지 끌고 와
     목록 아래 죽은 띠(~35px)를 만들었다(실렌더 rect 로 확정). 실제 소비량으로 계산:
     bar 56 + 힌트 ~32 + 목록 패딩 12 = 100, 행당 33. 10행 넘으면 목록 스크롤. */
  invoke('resize_capture',{height:100+Math.min(pbItems.length,10)*33}).catch(()=>{});
}
function schedulePb(){ clearTimeout(pbTimer); pbTimer=setTimeout(runPb,150); }
function applyPb(i){
  const inp=$id('cap-inp'); const e=pbItems[i??pbSel];
  if(!e||!pbToken){ closePb(); return; }
  /* 완성형 @태그만 삽입 (메인 창 바로 입력과 동일 — 관련인 정보는 등록 시 자동 첨부) */
  const r=applyInsert(inp.value, pbToken.caret, pbToken.start, tagText(e));
  inp.value=r.text; try{inp.setSelectionRange(r.caret,r.caret);}catch{}
  autoGrow(inp); renderCapHl();
  clearTimeout(draftTimer); sendDraft(inp.value);   // 삽입분도 초안에 즉시 반영
  closePb(); inp.focus();
}

/* v3.0.1 소유자 지정 — v3.0.0의 '검색 모드 동적 높이'는 철회. 실렌더 스크린샷으로
   확인한 결과, 빈 검색을 150px 로 줄이는 것이 오히려 입력칸·힌트·좁은 안내의
   3단 슬리버를 만들었다. 검색 모드는 예전처럼 **고정 406** 한 판이 맞다
   (빈 안내문은 넓은 목록 영역 가운데 정렬 — capture.html .cap-empty). */

function setMode(m){
  closePb(true);                               // 모드 전환 시 자동완성 접기 (아래에서 높이를 새로 정한다)
  mode=m;
  const search=m==='search';
  document.body.classList.toggle('search',search);
  $id('cap-inp').style.display=search?'none':'';
  $id('cap-search').style.display=search?'':'none';
  $id('cap-results').style.display=search?'flex':'none';
  $id('cap-hint').textContent=hintFor(m);
  invoke('resize_capture',{height:search?406:126}).catch(()=>{});   // 메모 모드 = 낮은 바, 검색 모드 = 고정 한 판
  const t=search?$id('cap-search'):$id('cap-inp');
  t.focus(); const n=t.value.length; try{t.setSelectionRange(n,n);}catch{}
  if(search) runSearch($id('cap-search').value.trim());
}

async function runSearch(q){
  const seq=++searchSeq;
  const iw=$id('cap-items');
  /* v2.6.5: 다시 그리기 전에 '지금 고른 업무'를 id 로 기억해 둔다.
     검색어를 치자마자 ↓ 를 누르면 250ms 디바운스가 뒤늦게 터지며 목록을 다시 그리는데,
     예전엔 그때 선택이 0 번으로 되돌아가 "내리다가 제자리로 돌아오는" 것처럼 보였다.
     같은 업무가 새 목록에도 있으면 그 자리를 그대로 이어간다. */
  const keepId=selectedId();
  selIdx=-1;
  if(!q){ iw.innerHTML='<div class="cap-empty">검색어를 입력하세요</div>'; return; }
  const items=await invoke('quick_search',{query:q}).catch(()=>[]);
  if(seq!==searchSeq) return;               // 그 사이 새 검색어 입력됨
  iw.innerHTML=items.length?items.map(h=>
    `<div class="cap-hit${h.done?' done':''}" data-item="${h.id}"><span class="cap-tag ${h.done?'done':'ongoing'}">${h.done?'완료':'진행'}</span><span class="cap-hit-txt">${esc(h.memo||'(메모 없음)')}</span></div>`
  ).join(''):'<div class="cap-empty">일치하는 업무 없음</div>';
  if(!items.length) return;
  /* v2.6.7: 검색만 했을 때는 아무 줄도 고르지 않는다(하이라이트 없음).
     예전엔 첫 줄을 자동으로 골라둬, 손대지도 않은 줄이 계속 켜져 있는 것처럼 보였다.
     이미 ↑↓ 로 고른 게 있고 그 업무가 새 목록에도 있으면 그 자리만 이어간다. */
  if(keepId!=null){
    const back=items.findIndex(h=>h.id===keepId);
    if(back>=0) setSel(back);
  }
}

/* ── 검색 결과 키보드 이동 (v2.6.4) ──────────────────────────────────────
   ↑/↓ 로 고르고 Enter 로 연다. 선택은 화면(.sel)에만 있는 상태라 데이터와 무관하다. */
function hits(){ return [...$id('cap-items').querySelectorAll('.cap-hit')]; }
/* 지금 고른 업무의 id (없으면 null) — 목록을 다시 그려도 선택을 이어가기 위한 열쇠 */
function selectedId(){ const el=hits()[selIdx]; return el?Number(el.dataset.item):null; }
function setSel(i){
  const list=hits(); if(!list.length){ selIdx=-1; return; }
  selIdx=Math.max(0, Math.min(i, list.length-1));
  list.forEach((el,n)=>el.classList.toggle('sel', n===selIdx));
  const el=list[selIdx];
  if(el&&el.scrollIntoView) el.scrollIntoView({block:'nearest'});
}
/* ↑↓ 이동 — 끝에서는 멈춘다(순환 없음). 아직 아무것도 안 골랐으면 ↓=첫 줄 / ↑=마지막 줄. */
function moveSel(d){
  const list=hits(); if(!list.length) return;
  if(selIdx<0){ setSel(d>0 ? 0 : list.length-1); return; }
  const next=selIdx+d;
  if(next<0 || next>=list.length) return;   // 맨 위/맨 아래에서 더 가지 않는다
  setSel(next);
}
function openSel(){
  const list=hits(); if(!list.length) return false;
  const el=list[selIdx<0?0:selIdx];         // 아무것도 안 골랐으면 첫 결과
  if(!el) return false;
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
  inp.value=''; autoGrow(inp); renderCapHl(); clearTimeout(draftTimer); sendDraft('');   // 등록됐으니 초안 비움
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
    renderCapHl();                              // v3.0.1: 본문 태그 하이라이트 갱신
    clearTimeout(draftTimer);
    draftTimer=setTimeout(()=>sendDraft(inp.value),400);
    schedulePb();                               // v2.7.0: @토큰이면 전화번호부 자동완성
  });
  wireTagHover(inp, $id('cap-hl'));             // v3.0.1: 태그 hover 반응
  /* v3.0.2 통일 정책: 빠른 메모의 태그도 클릭 = 관련 업무 검색. 이 창엔 팝업이
     없으므로 검색 화면으로 점프해 그 이름을 검색한다(hover 기하 판정 — 태그 위
     커서일 때만, 메인 창과 동일 규칙). */
  inp.addEventListener('click',()=>{
    const sp=$id('cap-hl') && $id('cap-hl').querySelector('.at-tag.hover');
    if(!sp) return;
    $id('cap-search').value=sp.dataset.at;
    setMode('search');                          // setMode 가 검색 실행·포커스까지 처리
  });
  inp.addEventListener('keydown',e=>{
    if(e.isComposing||e.keyCode===229) return;   // 한글 IME 조합 중 오등록 방지
    /* v2.7.0: 자동완성이 펴져 있으면 그 목록부터 조작한다 (Ctrl 조합은 통과 — 등록/저장) */
    if(pbOpen && !e.ctrlKey && !e.metaKey){
      if(e.key==='ArrowDown'){ e.preventDefault(); pbSel=Math.min(pbSel+1,pbItems.length-1); renderPb(); return; }
      if(e.key==='ArrowUp'){ e.preventDefault(); pbSel=Math.max(pbSel-1,0); renderPb(); return; }
      if(e.key==='Enter'||e.key==='Tab'){ e.preventDefault(); applyPb(); return; }
      if(e.key==='Escape'){ e.preventDefault(); closePb(); return; }   // 드롭다운만 접는다 (창 유지)
    }
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

  /* v2.6.8: 창 어디에 커서가 있어도 휠로 결과 목록을 오르내린다.
     목록 밖(검색칸·힌트줄) 위에서 굴리면 스크롤이 먹지 않던 것을 목록으로 넘겨준다. */
  document.addEventListener('wheel',e=>{
    const list=$id('cap-items');
    if(!list || mode!=='search') return;
    if(e.target.closest && e.target.closest('.cap-list')) return;   // 목록 위면 브라우저 기본 스크롤
    list.scrollTop += e.deltaY;
    e.preventDefault();
  }, {passive:false});

  /* v2.6.7 마우스/키보드 모드 — hover 하이라이트는 마우스를 실제로 움직였을 때만 켠다.
     창이 커서 밑에 떠서 생기는 '가만히 있는데 켜진 줄'을 없앤다. */
  document.addEventListener('mousemove',()=>document.body.classList.add('mouse'));
  document.addEventListener('keydown',()=>document.body.classList.remove('mouse'), true);

  /* 검색 결과 클릭 — 업무를 메인 창에서 연다 */
  $id('cap-results').addEventListener('click',e=>{
    const ih=e.target.closest('[data-item]');
    if(ih) openItem(Number(ih.dataset.item));
  });

  /* @ 자동완성 클릭 — mousedown 에서 잡아 blur(창 숨김)보다 먼저 적용한다 */
  $id('cap-pb').addEventListener('mousedown',e=>{
    e.preventDefault();
    const it=e.target.closest('[data-pb]');
    if(it) applyPb(Number(it.dataset.pb));
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
  /* v2.6.5: 포커스가 돌아온 것만으로는 화면을 초기화하지 않는다.
     예전엔 focus 마다 openFresh() 를 불러, 창을 띄워둔 채 잠깐 다른 창을 보고 돌아오면
     치던 검색어가 지워지고 검색 모드로 되돌아갔다. 초기화는 단축키로 '새로 뜰 때'만
     (Rust show_capture_window → wmhh://capture-shown). 여기서는 구성 갱신과 포커스 복구만. */
  window.addEventListener('focus',()=>{
    shownAt=Date.now(); askConfig();
    const t=(mode==='search')?$id('cap-search'):$id('cap-inp');
    t.focus(); const n=t.value.length; try{t.setSelectionRange(n,n);}catch{}
  });
  window.__TAURI__.event.listen('wmhh://capture-shown', ()=>{ loadBook(); openFresh(); }).catch(()=>{});
  /* Rust 가 토글로 창을 숨긴 경우(단축키 두 번) — 이때는 이 창의 JS 가 돌지 않으므로 알려준다 */
  window.__TAURI__.event.listen('wmhh://capture-hidden', ()=>resetSearchUI()).catch(()=>{});
  window.__TAURI__.event.listen('wmhh://capture-config', ev=>{
    const first = !ready; ready=true;
    applyCaptureConfig(ev.payload||{});
    if(first) openFresh();          // 설정이 도착한 뒤 시작 화면을 다시 잡는다
  }).catch(()=>{});
  askConfig();
  loadBook();                                   // v3.0.1: 태그 하이라이트용 전화번호부
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

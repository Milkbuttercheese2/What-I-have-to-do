/* =========================================================================
   렌더 — 보드/완료 카드 재생성 + persist()
   ========================================================================= */
import {S, toggleDone, markDoneRemoved} from './state.js';
import {STORE, invoke} from './store.js';
import {$, esc, escAttr, showToast, askNotify, appAlert} from './dom-utils.js';
import {fmtDue, fmtT} from './datetime.js';
import {placeOf, placeMode} from './placement.js';
import {textMatch} from './filters.js';
import {recurLabel} from './recur.js';
import {linkifyAt} from './phonebook-core.js';
import {mergeItems} from './merge.js';
import {openForm} from './form.js';
import {renderCal} from './calendar.js';
import {registerView, refreshView} from './views.js';

/* 부모(주기 정의)는 보드 밖 — 화면 어디에도 카드로 그리지 않는다 */
const onBoard = it => !it.recur;

let q='', dq='';

function matchesQ(it){ return textMatch(it, q); }

/* 알람 점 — "울렸는지"만 3단계로 단순화(v2.4.4). 미룸(스누즈) 색 구분은 없앤다.
   ○ 대기(안 울림·빈 점) / ● 울림(시각 지남·빨강) / ● 확인함(팝업에서 [확인]·초록).
   스누즈(al=숫자)도 이미 울린 것이므로 '울림(빨강)'으로 묶는다. 완료 업무·세부는 점 없음. */
function alarmDot(obj,key){
  if(obj.done) return '';
  const iso=key==='due'?(obj.f||{}).due:obj.mid;
  if(!iso) return '';
  const t=new Date(iso).getTime();
  if(isNaN(t)) return '';
  const st=(obj.al||{})[key];
  let cls,tip;
  if(st===true){ cls='ad-done'; tip='알람 확인함'; }              // ● 확인함(초록)
  else if(t<=Date.now()){ cls='ad-ring'; tip='알람 울림'; }        // ● 울림(빨강) — 미확인·스누즈 포함
  else { cls='ad-wait'; tip='알람 대기'; }                         // ○ 대기
  return `<span class="adot ${cls}" title="${escAttr(tip)}"></span>`;
}
/* 카드에 보일 세부 할일: '울린 것(지난 미완료 점검)'을 우선 표시 —
   지나서 울린 점검이 있으면 가장 오래된(먼저 지난) 것을, 없으면 가장 임박한 미래 것을 보여준다. */
function earliestSub(it){
  const now=Date.now();
  const pend=(it.subs||[]).filter(s=>!s.done && s.mid);
  if(!pend.length) return null;
  const past=pend.filter(s=>new Date(s.mid).getTime()<=now).sort((a,b)=>new Date(a.mid)-new Date(b.mid));
  if(past[0]) return past[0];   // 울린 것 우선 — 먼저 지난(가장 오래된) 것
  const future=pend.filter(s=>new Date(s.mid).getTime()>now).sort((a,b)=>new Date(a.mid)-new Date(b.mid));
  return future[0]||null;
}
/* 카드 겉면: 메모(1줄) · 가장 임박한 세부 할일 · 시각 만.
   관련인/식별번호는 카드에서 감추고 팝업에서만 표시. */
/* 시각 pill 공용 빌더 — 마감(due)과 점검(세부 mid)이 같은 마크업을 쓴다(중복 방지).
   adot는 태그(pill) 밖에 둔다 — '대기'의 투명 배경이 pill 색과 겹치지 않도록. */
function timePill(obj,key,iso,label){
  const m=fmtDue(iso); if(!m) return '';      // F7: 손상 ISO면 렌더 생략
  return `${alarmDot(obj,key)}<span class="tag time ${m.cls}"><span class="k">${label}</span>${esc(m.label)}</span>`;
}
function dueTagHtml(it){ const v=(it.f||{}).due; return v?timePill(it,'due',v,'마감:'):''; }
export function cardHtml(it,place){
  /* v2.5.12: 카드에는 메모 본문의 '첫 줄'만 가져온다(줄바꿈 이후는 버림). 그 첫 줄이 길면
     .card-memo 가 최대 2줄까지 감싸 보여준다(2줄 클램프). */
  const memo=(it.memo||'').split(/\r?\n/)[0].trim();
  /* v2.7.0 @태그 색 표시 (클릭은 양식 칩에서). v2.11.0: 전화번호부에 실존하는
     관련인의 태그만 색이 붙는다 — 편집으로 이름이 어긋나면 평문으로 돌아간다. */
  const memoHtml = memo ? linkifyAt(esc(memo), S.phonebook) : '<span style="color:var(--ink-soft)">(메모 없음)</span>';
  /* v2.5.2 완료 카드: 메모 1줄 + 완료 시각 1줄만 — 세부·마감·주기·긴급도 없음 */
  if(place==='done'||it.done){
    const dv=it.doneAt!=null?new Date(it.doneAt):null;
    const doneLine=(dv&&!isNaN(dv))?`<div class="card-meta"><span class="tag time"><span class="k">완료:</span>${esc(fmtT(dv.toISOString()))}</span></div>`:'';
    return `<div class="card p-${place}${it.done?' done':''}" data-open="${it.id}">
    <div class="card-top">
      <div class="chk ${it.done?'on':''}" data-id="${it.id}"></div>
      <div class="card-body">
        <div class="card-memo">${memoHtml}</div>
        ${doneLine}
      </div>
      <button class="del" data-del="${it.id}" title="삭제">×</button>
    </div></div>`;
  }
  const es=earliestSub(it);
  const parent = it.recurId!=null ? S.items.find(x=>x.id===it.recurId) : null;
  /* v2.5.3: 주기 배지에 recur 클래스 — 5열 모드 시각 줄에서도 시각과 한 줄에 들어가게 축소 표기 */
  const recurTag = it.recurId!=null?`<span class="tag mid recur" title="${escAttr(parent&&parent.recur?recurLabel(parent.recur):'주기 업무에서 생성됨')}">주기</span>`:'';
  /* v2.5.1 시각 표시 정책 — 마감보다 앞서는 미완료 세부가 있으면 그 세부의 점검시각만
     보이고 마감 태그는 감춘다(둘 다 보이던 중복 제거). 앞서는 세부가 없거나 전부
     완료면 마감만. 시각 칩은 세부 제목 줄이 아니라 메타 줄에 둔다(제목 잘림 방지). */
  const dueT=(it.f||{}).due?new Date(it.f.due).getTime():NaN;
  const esT=es&&es.mid?new Date(es.mid).getTime():NaN;
  const subFirst = !isNaN(esT) && (isNaN(dueT) || esT<dueT);
  const subLine = es?`<div class="card-subline"><span class="sub-mark">▸</span><span class="sub-title">${esc(es.title)}</span></div>`:'';
  const timeTag = subFirst ? timePill(es,'mid',es.mid,'점검:') : dueTagHtml(it);
  /* v2.5.2 주기 배지는 시각 줄에 인라인(시각 없으면 단독 줄). 시각 줄은 세부 줄과 같은 시작선(들여쓰기 통일). */
  const timeLine = (timeTag||recurTag)?`<div class="card-meta">${timeTag}${recurTag}</div>`:'';
  // 파일 링크는 카드 앞면에 표시하지 않는다. 파일은 양식 팝업에서 다룬다(form.js addFormFileRow).
  // 카드 구성(v2.5.2, 최대 3줄·각 1줄 말줄임): 메모 → 세부(있다면) → 시각(점검 또는 마감)+주기.
  // 빈 줄은 아예 그리지 않는다. 진행상황·담당은 카드에서 뺐다(팝업에서 확인).
  return `<div class="card p-${place}${it.done?' done':''}" data-open="${it.id}">
    <div class="card-top">
      <div class="chk ${it.done?'on':''}" data-id="${it.id}"></div>
      <div class="card-body">
        <div class="card-memo">${memoHtml}</div>
        ${subLine}
        ${timeLine}
      </div>
      <button class="del" data-del="${it.id}" title="삭제">×</button>
    </div></div>`;
}
/* v2.5.0 보드 모드에 맞는 main 표시 — 보드 탭일 때만 placeMode() 쪽을 보인다.
   보이는 조건은 아래 registerView('board') 의 when 이 갖고 있으므로 여기서는
   지금 화면의 표시를 다시 반영만 한다(그리기 함수는 부르지 않는다 — 재귀). */
function syncBoardVisibility(){ refreshView(); }
/* v3.7.0 한눈 요약 줄(흐름도의 '9 단계 · 27 절차' 줄) — 숫자 넷, 순서도 소유자 지정.
   · 진행 업무 = 보드에 있는 미완료 업무 전체
   · 오늘 할 일 = 오늘 걸린 업무(마감·미완료 세부 점검이 오늘이거나 이미 지난 것) 중 아직 안 끝난 것
   · 오늘 완료 = 오늘 걸린 업무 중 끝난 것 — 오늘 완료 처리했거나, 마감·점검일이 오늘인 완료 업무
   · 시각 지남 = 미완료인데 마감·점검 시각이 이미 지난 업무(빨강)
   전부 파생값이다(저장 안 함). 검색어와 무관하게 전체 기준. 주기 부모(보드 밖)는 제외. */
export function metricsOf(items, now){
  now=now||Date.now();
  const s0=new Date(now); s0.setHours(0,0,0,0);
  const e0=new Date(now); e0.setHours(23,59,59,999);
  const start=s0.getTime(), end=e0.getTime();
  const t=iso=>{ const x=iso?new Date(iso).getTime():NaN; return isNaN(x)?null:x; };
  let active=0, todo=0, doneToday=0, overdue=0;
  for(const it of items){
    if(!onBoard(it)) continue;
    if(it.done){
      const times=(it.subs||[]).map(s=>t(s.mid)).concat([t((it.f||{}).due)]).filter(x=>x!=null);
      const doneAtToday=it.doneAt && it.doneAt>=start && it.doneAt<=end;
      if(doneAtToday || times.some(x=>x>=start && x<=end)) doneToday++;
      continue;
    }
    const times=(it.subs||[]).filter(s=>!s.done).map(s=>t(s.mid)).concat([t((it.f||{}).due)]).filter(x=>x!=null);
    active++;
    if(times.some(x=>x<=end)) todo++;
    if(times.some(x=>x<now)) overdue++;
  }
  return {active, todo, doneToday, overdue};
}
function renderMetrics(){
  const el=$('metrics'); if(!el) return;
  const m=metricsOf(S.items);
  el.innerHTML=`<span><b>${m.active}</b>진행 업무</span><span class="m-todo"><b>${m.todo}</b>오늘 할 일</span>`
    +`<span class="m-ok"><b>${m.doneToday}</b>오늘 완료</span><span class="${m.overdue?'m-warn':''}"><b>${m.overdue}</b>시각 지남</span>`;
}
export function render(){
  syncBoardVisibility();
  renderMetrics();
  /* 정렬: 세부 점검·마감시각 레벨 구분 없이, 먼저 도래하는 시각이 위로.
     (미완료 세부 mid + 마감 due 중 가장 이른 시각 기준 오름차순 → 시각 없으면 뒤, 최신 등록 순) */
  const keyTime=(it)=>{
    const ts=(it.subs||[]).filter(s=>!s.done&&s.mid).map(s=>new Date(s.mid).getTime()).filter(x=>!isNaN(x));
    const d=(it.f||{}).due?new Date(it.f.due).getTime():NaN;
    if(!isNaN(d)) ts.push(d);
    return ts.length?Math.min(...ts):null;
  };
  const sorter=(a,b)=>{
    const at=keyTime(a), bt=keyTime(b);
    if(at!=null&&bt!=null&&at!==bt) return at-bt;
    if(at!=null&&bt==null) return -1;
    if(at==null&&bt!=null) return 1;
    return b.id-a.id;
  };
  if(placeMode()==='owner'){
    /* 시간·담당자 모드(5열) — 필터·정렬은 시간 모드와 동일, 배치만 placeOwner 결과 */
    const cols={inbox:[],metoday:[],othtoday:[],meplan:[],othplan:[]};
    S.items.filter(onBoard).filter(matchesQ).forEach(it=>{ const p=placeOf(it); if(cols[p])cols[p].push(it); });
    for(const k of ['inbox','metoday','othtoday','meplan','othplan']){
      const list=cols[k].sort(sorter);
      $('c5-'+k).textContent=list.length;
      $('col5-'+k).innerHTML=list.length?list.map(it=>cardHtml(it,k)).join(''):`<div class="empty">${q?'검색 결과가 없습니다.':(k==='inbox'?'자유 입력이 여기 쌓입니다.':'해당 업무가 없습니다.')}</div>`;
    }
    renderHidden();
    return;
  }
  const cols={inbox:[],today:[],doing:[],planned:[]};
  S.items.filter(onBoard).filter(matchesQ).forEach(it=>{ const p=placeOf(it); if(cols[p])cols[p].push(it); });
  const EMPTY={inbox:'자유 입력이 여기 쌓입니다.',today:'오늘 마감·점검 건이 없습니다.<br><b>여유 있는 날</b>',doing:'진행 중인 업무가 없습니다.',planned:'예정 건이 없습니다.'};
  for(const k of ['inbox','today','doing','planned']){
    const list=cols[k].sort(sorter);
    $('c-'+k).textContent=list.length;
    $('col-'+k).innerHTML=list.length?list.map(it=>cardHtml(it,k)).join(''):`<div class="empty">${q?'검색 결과가 없습니다.':EMPTY[k]}</div>`;
  }
  renderHidden();
}
/* v3.7.0 속도: 달력·완료는 **보이고 있을 때만** 다시 그린다. 안 보일 땐 탭을 열 때 views.js 가 그 화면의
   render(renderCal·renderDone)를 부르므로 늘 최신으로 열린다. 예전엔 저장할 때마다 완료 업무 전부와
   달력 42칸을 숨은 채로 다시 만들었다(완료가 쌓일수록 저장이 느려지던 원인). */
function renderHidden(){
  const on=id=>{ const el=$(id); return !!el && el.classList.contains('on'); };
  if(on('view-cal')) renderCal();
  if(on('view-done')) renderDone();
}
/* v3.7.0 완료 업무를 '언제 끝냈나'로 묶는다 — 오늘 / 어제 / 이번 주 / 지난주 / 그 이전은 월별.
   완료 시각(doneAt)이 없는 옛 데이터는 '날짜 모름' 묶음. 묶음 키는 표시용 파생값(저장 안 함). */
export function doneGroupOf(doneAt, now){
  if(!doneAt) return {key:'nodate', label:'완료 날짜 모름', order:-1};
  now=now||Date.now();
  const d0=new Date(now); d0.setHours(0,0,0,0); const today=d0.getTime();
  const wk=new Date(d0); wk.setDate(wk.getDate()-((wk.getDay()+6)%7)); const week=wk.getTime();   // 이번 주 월요일
  /* v3.7.1 소유자 지정: 오늘 · 이번 주 · 이번 달, 그 이전은 달별(어제·지난주 묶음 폐지).
     이번 주가 지난달에 걸쳐 시작해도(월요일이 지난달) 이번 주로 본다 — 주가 달보다 먼저. */
  const m1=new Date(d0); m1.setDate(1); const month=m1.getTime();                                       // 이번 달 1일
  if(doneAt>=today) return {key:'today', label:'오늘', order:1e15};
  if(doneAt>=week) return {key:'week', label:'이번 주', order:1e15-1};
  if(doneAt>=month) return {key:'month', label:'이번 달', order:1e15-2};
  const d=new Date(doneAt);
  return {key:`m${d.getFullYear()}-${d.getMonth()}`, label:`${d.getFullYear()}년 ${d.getMonth()+1}월`, order:d.getFullYear()*12+d.getMonth()};
}
export function renderDone(){
  const all=S.items.filter(onBoard).filter(it=>it.done);
  const list=all.filter(it=>textMatch(it, dq)).sort((a,b)=>(b.doneAt||b.id)-(a.doneAt||a.id));
  $('done-count').textContent=all.length;
  const now=Date.now();
  const dm=$('done-metrics');
  if(dm){
    const g=all.map(it=>doneGroupOf(it.doneAt, now).key);
    const n=k=>g.filter(x=>x===k).length;
    /* 요약 숫자는 '그 기간에 끝낸 건수'(누적) — 이번 주 = 오늘 + 이번 주, 이번 달 = 오늘 + 이번 주 + 이번 달.
       단 이번 주가 지난달에서 시작했으면 지난달 날짜분은 이번 달에 넣지 않는다(달력 기준). */
    const mStart=new Date(now); mStart.setHours(0,0,0,0); mStart.setDate(1);
    const inMonth=all.filter(it=>it.doneAt && it.doneAt>=mStart.getTime()).length;
    dm.innerHTML=`<span class="m-ok"><b>${n('today')}</b>오늘</span><span><b>${n('today')+n('week')}</b>이번 주</span><span><b>${inMonth}</b>이번 달</span>`;
  }
  if(!list.length){ $('col-done').innerHTML=`<div class="empty">${dq?'검색 결과가 없습니다.':'완료된 업무가 없습니다.'}</div>`; return; }
  const groups=[];
  for(const it of list){
    const g=doneGroupOf(it.doneAt, now);
    let grp=groups.find(x=>x.key===g.key);
    if(!grp){ grp=Object.assign({items:[]}, g); groups.push(grp); }
    grp.items.push(it);
  }
  groups.sort((a,b)=>b.order-a.order);
  $('col-done').innerHTML=groups.map(g=>`<section class="done-group" data-group="${g.key}">
      <div class="dg-head"><span class="dg-label">${esc(g.label)}</span><span class="count num">${g.items.length}</span></div>
      <div class="cards dg-cards">${g.items.map(it=>cardHtml(it,'done')).join('')}</div>
    </section>`).join('');
}
/* v3.7.0 속도: 화면을 **먼저** 그리고 저장은 뒤에서 한다(소유자 지적 — 메모 저장 뒤 살짝 멈칫).
   예전엔 `await saveAll` 뒤에 render 해서, 디스크 쓰기(진행 중인 앞 저장 + 백업 회전까지)가 끝날 때까지
   보드가 옛 모습으로 멈춰 있었다. 저장 실패는 store.js 가 배너·재시도로 따로 다루고(화면 코드를 막지
   않는다), 번호표 거절(Stale)은 store.js 가 화면을 다시 읽으므로 먼저 그려도 데이터가 어긋나지 않는다.
   돌려주는 프로미스는 실제 저장 완료 — 기다려야 하는 곳은 지금처럼 await 하면 된다. */
export function persist(){ window.items=S.items; render(); askNotify(); return STORE.saveAll(S.items); }

/* ── 메모 합치기 (v2.8.0) ────────────────────────────────────────────────
   보드 카드를 끌어 다른 카드에 놓으면 그 카드(받는 쪽)로 병합한다.
   규칙은 merge.js — 여기서는 드래그 배선·교체·실행 취소만.
   끌던 카드 id 는 dataTransfer 가 아니라 모듈 상태로 넘긴다(jsdom 테스트 가능 +
   webview dataTransfer 편차 회피). */
let dragMergeId=null;

function mergeCards(targetId, sourceId){
  const t=S.items.find(x=>x.id===targetId), s=S.items.find(x=>x.id===sourceId);
  if(!t||!s||t===s||t.done||s.done) return;
  const beforeT=JSON.parse(JSON.stringify(t));            // 실행 취소용 원본 보관
  const beforeS=JSON.parse(JSON.stringify(s));
  const srcIdx=S.items.indexOf(s);
  S.items[S.items.indexOf(t)]=mergeItems(t,s);
  S.items.splice(S.items.indexOf(s),1);
  persist();
  showToast('메모를 합쳤습니다',()=>{
    const i=S.items.findIndex(x=>x.id===targetId);
    if(i>=0) S.items[i]=beforeT; else S.items.push(beforeT);
    if(!S.items.some(x=>x.id===sourceId)) S.items.splice(Math.min(srcIdx,S.items.length),0,beforeS);
    persist();
  });
}

/* 보드 두 뷰의 카드만 드래그 병합 대상 (완료 탭·캘린더 상세는 제외) */
const boardCard=el=>el.closest&&el.closest('#view-board .card,#view-board5 .card');

/* v3.7.0: HTML5 드래그 → 마우스 이벤트 (dom-utils enableDragReorder 주석과 같은 이유 —
   파일 끌어다 놓기를 위해 dragDropEnabled 를 켜면 Windows WebView2 에서 HTML5 드래그가 죽는다).
   카드를 6px 이상 끌면 유령 카드가 손을 따라오고, 다른 보드 카드 위에서 놓으면 병합한다.
   놓을 대상은 이벤트 target 으로 판정한다(유령은 pointer-events:none) — jsdom 테스트 가능.
   드래그로 끝난 mouseup 뒤에 따라오는 click 한 번은 삼킨다(놓자마자 양식이 열리지 않게). */
function initMergeDrag(){
  let start=null, ghost=null, swallowUntil=0;
  const clear=()=>{
    document.querySelectorAll('.card.dragging,.card.merge-over').forEach(el=>el.classList.remove('dragging','merge-over'));
    if(ghost){ ghost.remove(); ghost=null; }
    document.body.classList.remove('is-dragging');
    dragMergeId=null; start=null;
  };
  document.body.addEventListener('mousedown',e=>{
    if(e.button!==0) return;
    const card=boardCard(e.target);
    if(!card||!card.dataset.open||e.target.closest('.chk,.del,.at-tag')) return;
    start={x:e.clientX, y:e.clientY, card};
  });
  document.addEventListener('mousemove',e=>{
    if(!start) return;
    if(e.buttons===0 && dragMergeId!=null){ clear(); return; }   // 창 밖에서 버튼을 놓고 돌아온 경우 — 끌기 취소
    if(dragMergeId==null){
      if(Math.hypot(e.clientX-start.x, e.clientY-start.y)<6) return;
      dragMergeId=Number(start.card.dataset.open);
      start.card.classList.add('dragging');
      document.body.classList.add('is-dragging');
      try{ ghost=start.card.cloneNode(true); ghost.classList.remove('dragging'); ghost.classList.add('drag-ghost'); document.body.appendChild(ghost); }catch{ ghost=null; }
    }
    if(ghost){ ghost.style.left=(e.clientX+12)+'px'; ghost.style.top=(e.clientY+10)+'px'; }
    const card=boardCard(e.target);
    document.querySelectorAll('.card.merge-over').forEach(el=>{ if(el!==card) el.classList.remove('merge-over'); });
    if(card&&!card.classList.contains('drag-ghost')&&Number(card.dataset.open)!==dragMergeId) card.classList.add('merge-over');
  });
  document.addEventListener('mouseup',e=>{
    if(!start) return;
    const src=dragMergeId;
    const card=boardCard(e.target);
    clear();
    if(src==null) return;                         // 6px 안쪽 = 그냥 클릭
    swallowUntil=Date.now()+400;                  // 놓은 직후 따라오는 click 만 (타이머 없이 — 다음 클릭을 막지 않게)
    if(!card) return;
    const tid=Number(card.dataset.open);
    if(tid&&tid!==src) mergeCards(tid, src);
  });
  document.addEventListener('click',e=>{
    if(swallowUntil && Date.now()<swallowUntil && boardCard(e.target)){ swallowUntil=0; e.stopPropagation(); e.preventDefault(); }
  },true);
  window.addEventListener('blur',clear);
}

export function initRender(){
  /* 이 모듈이 소유한 화면 둘을 등록한다 (탭 배선은 main.js 가 아니라 여기).
     보드 탭은 보드 모드에 따라 4열/5열 중 하나만 보이고, 검색줄·입력칸이 함께 붙는다. */
  registerView({key:'board', els:[
    {id:'view-board',  display:'grid', when:()=>placeMode()==='time'},
    {id:'view-board5', display:'grid', when:()=>placeMode()==='owner'},
    {id:'strip',       display:'flex'},
    {id:'capture',     display:'block'},
  ]});
  registerView({key:'done', els:[{id:'view-done'}], render:renderDone});
  /* 카드 상호작용 */
  document.body.addEventListener('click',async e=>{
    /* 파일 링크 클릭 — 카드 열기(data-open)보다 먼저 처리 */
    const fo=e.target.closest('[data-fopen]');
    if(fo){ e.stopPropagation(); invoke('open_file_path',{path:fo.dataset.fopen}).catch(err=>appAlert('파일을 열 수 없습니다:\n'+fo.dataset.fopen+'\n\n'+err)); return; }
    const fr=e.target.closest('[data-freveal]');
    if(fr){ e.stopPropagation(); invoke('reveal_file_path',{path:fr.dataset.freveal}).catch(err=>appAlert('폴더를 열 수 없습니다:\n'+err)); return; }
    const chk=e.target.closest('.chk');
    if(chk&&chk.dataset.id){ e.stopPropagation(); const it=S.items.find(x=>x.id==chk.dataset.id);
      if(it){ toggleDone(it); persist(); } return; }
    const del=e.target.closest('.del');
    if(del&&del.dataset.del){ e.stopPropagation(); const id=+del.dataset.del; const idx=S.items.findIndex(x=>x.id==id);
      if(idx>=0){
        const removed=S.items[idx];
        /* v3.6.0: 완료 업무는 저장이 다시 쓰지 않으므로 '지웠다'는 사실을 따로 알려야 한다.
           되돌릴 때도 마찬가지 — 다시 넣으려면 그 배치에 실려야 하므로 또 표시한다. */
        markDoneRemoved(removed);
        S.items.splice(idx,1); persist();
        showToast('업무 삭제함',()=>{ S.items.splice(Math.min(idx,S.items.length),0,removed); markDoneRemoved(removed); persist(); });
      } return; }
    /* v3.6.0: 완료 업무는 읽기 전용으로 연다 — 저장이 완료 업무 행을 다시 쓰지 않으므로
       여기서 고치면 그 변경이 조용히 사라진다. 고치려면 [되살려서 수정]으로 먼저 되살린다. */
    const open=e.target.closest('[data-open]');
    if(open){ const it=S.items.find(x=>x.id==open.dataset.open); if(it)openForm(it,{readonly:!!it.done}); return; }
  });
  initMergeDrag();
  /* 주기 재렌더 — 편집 중·드래그 중 보호 (재렌더는 DOM 을 갈아엎어 드래그를 끊는다) */
  setInterval(()=>{ const a=document.activeElement;
    if(document.querySelector('.card.dragging'))return;
    if(a&&(a.matches('#search,#done-search,.dt-date,.dt-time')||a.closest('#formPanel,#presetModal')))return;
    render(); },60000);
  /* 검색 */
  $('search').addEventListener('input',e=>{q=e.target.value.trim().toLowerCase();render();});
  $('done-search').addEventListener('input',e=>{dq=e.target.value.trim().toLowerCase();renderDone();});
}

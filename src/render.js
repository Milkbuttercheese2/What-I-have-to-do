/* =========================================================================
   렌더 — 보드/완료 카드 재생성 + persist()
   ========================================================================= */
import {S, toggleDone, markDoneRemoved} from './state.js';
import {STORE, invoke, openPath, revealPath} from './store.js';
import {$, esc, escAttr, showToast, askNotify, appAlert} from './dom-utils.js';
import {doneGroupOf, groupOpenByDefault} from './done-weeks.js';
import {fmtDue, fmtT} from './datetime.js';
import {placeOf, placeMode} from './placement.js';
import {textMatch} from './filters.js';
import {recurLabel} from './recur.js';
import {linkifyAt} from './phonebook-core.js';
import {mergeItems} from './merge.js';
import {openForm} from './form.js';
import {renderCal} from './calendar.js';
import {renderNote as renderDocNotes} from './docs.js';
import {registerView, refreshView} from './views.js';

/* 부모(주기 정의)는 보드 밖 — 화면 어디에도 카드로 그리지 않는다 */
const onBoard = it => !it.recur;

let q='', dq='';
/* v3.8.25 검색칸 입력은 120ms 쉬었다가 그린다 — 예전엔 글자 하나마다 보드·완료 목록을 통째로 다시 그렸다(업무가 많으면 칠 때마다 멈칫) */
const SEARCH_DEBOUNCE=120;
let qT=null, dqT=null;
/* v3.8.25 id → 업무 찾기 — 카드마다 S.items.find 로 처음부터 훑던 것(주기 업무에서 생긴 카드의 원본 찾기)을 색인으로.
   색인은 자리(번호)를 기억하고, 꺼낼 때 그 자리에 아직 같은 id 가 있는지 본다 — 업무를 바꿔 끼우거나 지워도 낡은 것을 돌려주지 않는다 */
let idIdx=null;
function itemById(id){
  const a=S.items;
  if(idIdx && idIdx.a===a){ const k=idIdx.m.get(id); if(k===undefined && idIdx.n===a.length) return undefined; const x=k===undefined?undefined:a[k]; if(x && x.id===id) return x; }
  idIdx={a, n:a.length, m:new Map(a.map((x,k)=>[x.id,k]))};
  const k=idIdx.m.get(id); return k===undefined ? undefined : a[k];
}

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
function dueTagHtml(it){ const v=(it.f||{}).due; return v?timePill(it,'due',v,'기한:'):''; }
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
  const parent = it.recurId!=null ? itemById(it.recurId) : null;
  /* v2.5.3: 주기 배지에 recur 클래스 — 5열 모드 시각 줄에서도 시각과 한 줄에 들어가게 축소 표기 */
  const recurTag = it.recurId!=null?`<span class="tag mid recur" title="${escAttr(parent&&parent.recur?recurLabel(parent.recur):'반복 업무에서 생성됨')}">반복</span>`:'';
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
  el.innerHTML=`<span><b>${m.active}</b>진행 중 업무</span><span class="m-todo"><b>${m.todo}</b>오늘 업무</span>`
    +`<span class="m-ok"><b>${m.doneToday}</b>오늘 완료</span><span class="${m.overdue?'m-warn':''}"><b>${m.overdue}</b>시각 지남</span>`;
}
/* v3.8.16 보드 칸은 지난번과 같은 HTML 이면 다시 넣지 않는다 — 카드를 하나 체크·저장할 때 바뀌지 않은 칸까지
   카드를 전부 다시 만들어(업무 1천 건: 그리기 200ms 넘게) 1분마다 도는 자동 다시 그리기도 같은 비용을 냈다.
   칸 안 카드 DOM 을 직접 바꾸는 곳(끌기 표시 .dragging·.merge-over·.drop-on)은 끝날 때 스스로 지운다. */
const colHtml=new WeakMap();
function putCol(el, html){ if(!el) return; if(colHtml.get(el)===html) return; el.innerHTML=html; colHtml.set(el, html); }
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
  /* 정렬 열쇠는 업무마다 한 번만 계산한다(비교마다 날짜를 다시 읽으면 1천 건에서 수만 번) */
  const kt=new Map();
  const keyOf=it=>{ if(!kt.has(it)) kt.set(it, keyTime(it)); return kt.get(it); };
  const sorter=(a,b)=>{
    const at=keyOf(a), bt=keyOf(b);
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
      putCol($('col5-'+k), list.length?list.map(it=>cardHtml(it,k)).join(''):`<div class="empty">${q?'검색 결과가 없습니다.':(k==='inbox'?'자유 입력이 여기 쌓입니다.':'해당 업무가 없습니다.')}</div>`);
    }
    renderHidden();
    return;
  }
  const cols={inbox:[],today:[],doing:[],planned:[]};
  S.items.filter(onBoard).filter(matchesQ).forEach(it=>{ const p=placeOf(it); if(cols[p])cols[p].push(it); });
  const EMPTY={inbox:'자유 입력이 여기 쌓입니다.',today:'오늘 기한·점검 건이 없습니다.<br><b>여유 있는 날</b>',doing:'진행 중인 업무가 없습니다.',planned:'예정 건이 없습니다.'};
  for(const k of ['inbox','today','doing','planned']){
    const list=cols[k].sort(sorter);
    $('c-'+k).textContent=list.length;
    putCol($('col-'+k), list.length?list.map(it=>cardHtml(it,k)).join(''):`<div class="empty">${q?'검색 결과가 없습니다.':EMPTY[k]}</div>`);
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
  if(on('view-docs')) renderDocNotes();            // v3.8.0 문서 탭 오른쪽 업무 메모(카드 체크·삭제·양식 저장 뒤)
}
/* v3.8.0 완료 업무 묶음 = 오늘 / 이번 주 / 그 이전은 주별(규칙은 done-weeks.js — 순수 모듈).
   지난 주 묶음은 접힌 채로 그리고(카드도 만들지 않는다 — 쌓일수록 느려지지 않게), 머리줄을 누르면 펼친다.
   접기 상태는 이 모듈 안에만 둔다(저장하지 않음 — 앱을 다시 켜면 기본값으로). 검색어가 있으면 맞는 묶음을 모두 펼친다. */
export {doneGroupOf};
const dgToggled=new Set();             // 기본값과 반대로 바꾼 묶음 키
function groupOpen(key){ return groupOpenByDefault(key) !== dgToggled.has(key); }
/* v3.8.4 오른쪽 달력 띠(소유자 지정 — 한 달 단위). 날 칸의 농도 = 그날 끝낸 건수, 누르면 그날 것만(다시 누르면 풀림).
   보는 달(dcalY/dcalM)·고른 날(dcalDay)은 화면 상태일 뿐 저장하지 않는다. 주는 완료 묶음과 같이 월요일 시작. */
let dcalY=null, dcalM=null, dcalDay=null;
const dayStart = ms => { const d=new Date(ms); d.setHours(0,0,0,0); return d.getTime(); };
export function doneCalHtml(list, y, m, selDay, now){
  const counts=new Map();
  for(const it of list){ if(!it.doneAt) continue; const k=dayStart(it.doneAt); counts.set(k, (counts.get(k)||0)+1); }
  const first=new Date(y, m, 1), days=new Date(y, m+1, 0).getDate(), lead=(first.getDay()+6)%7, today=dayStart(now);
  let total=0, cells='';
  for(let i=0;i<lead;i++) cells+='<span class="dcal-d dcal-x"></span>';
  for(let d=1; d<=days; d++){
    const t=new Date(y, m, d).getTime(), n=counts.get(t)||0; total+=n;
    /* 강조는 둘뿐(소유자 지정): 완료 기록이 있는 날 = 연한 녹색, 오늘 = 진한 녹색. 건수 단계 색은 기준이 안 읽혀 뺐다 */
    cells+=`<button type="button" class="dcal-d${n?' dcal-has':''}${t===today?' dcal-today':''}${t===selDay?' on':''}" data-dcalday="${t}"${n?'':' disabled'} title="${m+1}.${d} · ${n}건"><span class="num">${d}</span>${n?`<b class="num">${n}</b>`:''}</button>`;
  }
  return `<div class="dcal-head"><button type="button" class="dcal-nav" data-dcalnav="-1" aria-label="앞 달">‹</button><b class="num">${y}년 ${m+1}월</b><span class="dcal-total num">${total}건</span><button type="button" class="dcal-nav" data-dcalnav="1" aria-label="다음 달">›</button></div>`
    +`<div class="dcal-dow">${['월','화','수','목','금','토','일'].map(x=>`<span>${x}</span>`).join('')}</div><div class="dcal-grid">${cells}</div>`
    +(selDay!=null ? `<button type="button" class="dcal-clear" data-dcalday="${selDay}">${new Date(selDay).getMonth()+1}.${new Date(selDay).getDate()} 만 보는 중 ×</button>` : '');
}
/* v3.8.4 완료 탭 — 늘 전체를 한 줄 목록으로 보여 준다(거르기·카드 보기 단추는 소유자 지정으로 뺐다) */
/* 한 줄 = 종료시각 · 메모 첫 줄 · 식별정보 · 접수시각 · 마감시각 · 관련인 · 파일 (소유자 지정) */
const DONE_COLS=['완료','메모','식별정보','접수','기한','관련인','파일'];
export const dAt = v => { if(v==null || v==='') return ''; const d=new Date(v); if(isNaN(d)) return '';
  return `${d.getMonth()+1}.${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; };
const baseName = p => String(p||'').split(/[\\/]/).filter(Boolean).pop()||'';
function doneRowHtml(it){
  const memo=(it.memo||'').split(/\r?\n/)[0].trim();
  const ids=(it.ids||[]).filter(x=>x.val).map(x=>`${x.kind?x.kind+' ':''}${x.val}`).join(', ');
  const who=(it.contacts||[]).filter(c=>c.who||c.org).map(c=>[c.org,c.who].filter(Boolean).join(' ')).join(', ');
  const fs=(it.files||[]).map(baseName).filter(Boolean), files=fs.length ? fs[0]+(fs.length>1?` 외 ${fs.length-1}`:'') : '';
  const cell=(cls,v,tip)=>`<span class="${cls}"${v?` title="${escAttr(tip||v)}"`:''}>${esc(v)}</span>`;
  return `<div class="drow" data-open="${it.id}">`
    +cell('drow-c num', dAt(it.doneAt))
    +`<span class="drow-memo">${memo ? linkifyAt(esc(memo), S.phonebook) : '<span class="drow-none">(메모 없음)</span>'}</span>`
    +cell('drow-c', ids)+cell('drow-c num', dAt(it.f&&it.f.received))+cell('drow-c num', dAt(it.f&&it.f.due))
    +cell('drow-c', who)+cell('drow-c', files, fs.join('\n'))+`</div>`;
}
const doneHeadRow = () => `<div class="drow drow-h">${DONE_COLS.map((c,i)=>`<span class="${i===1?'drow-memo':'drow-c'}">${c}</span>`).join('')}</div>`;
export function renderDone(){
  const all=S.items.filter(onBoard).filter(it=>it.done);
  const matched=all.filter(it=>textMatch(it, dq));
  if(dcalY==null){ const d=new Date(); dcalY=d.getFullYear(); dcalM=d.getMonth(); }
  const dc=$('done-cal'); if(dc) dc.innerHTML=doneCalHtml(matched, dcalY, dcalM, dcalDay, Date.now());
  /* v3.8.18 달 단위(소유자 지정): 목록은 달력 띠가 보는 달을 따라간다. 오늘이 든 달이면 지금처럼 전체, 다른 달이면 그 달에
     끝낸 업무만(끝낸 시각 doneAt 기준 — 시각이 없는 옛 완료 업무는 전체 보기에서만 보인다). 날짜를 고르면 그날만(예전 그대로),
     검색어가 있으면 달과 상관없이 전체에서 찾는다. 보는 달은 화면 상태일 뿐 저장하지 않는다(dcalY/dcalM). */
  const monthOnly=doneMonthOnly();
  const mFrom=new Date(dcalY, dcalM, 1).getTime(), mTo=new Date(dcalY, dcalM+1, 1).getTime();
  const inMonth=it=>!monthOnly || (it.doneAt!=null && it.doneAt>=mFrom && it.doneAt<mTo);
  const list=matched.filter(it=>dcalDay==null ? inMonth(it) : (it.doneAt && dayStart(it.doneAt)===dcalDay)).sort((a,b)=>(b.doneAt||b.id)-(a.doneAt||a.id));
  $('done-count').textContent=all.length;
  const now=Date.now();
  const dm=$('done-metrics');
  if(dm){
    const g=all.map(it=>doneGroupOf(it.doneAt, now).key);
    const n=k=>g.filter(x=>x===k).length;
    /* 요약은 둘 — 오늘 / 이번 주(오늘 포함, 누적) */
    dm.innerHTML=`<span class="m-ok"><b>${n('today')}</b>오늘</span><span><b>${n('today')+n('week')}</b>이번 주</span>`;
  }
  const mName=`${dcalY}년 ${dcalM+1}월`;
  const monthNote = monthOnly && dcalDay==null ? `<div class="done-month-note">${mName}에 완료한 업무 <b class="num">${list.length}</b>건</div>` : '';
  if(!list.length){ $('col-done').innerHTML=`<div class="empty">${dq||dcalDay!=null?'검색 결과가 없습니다.':monthOnly?`${mName}에 완료한 업무가 없습니다.`:'완료된 업무가 없습니다.'}</div>`; return; }
  const groups=[], byKey=new Map();     // 묶음 찾기는 Map — 예전 groups.find 는 줄 수 × 묶음 수
  for(const it of list){
    const g=doneGroupOf(it.doneAt, now);
    let grp=byKey.get(g.key);
    if(!grp){ grp=Object.assign({items:[]}, g); groups.push(grp); byKey.set(g.key, grp); }
    grp.items.push(it);
  }
  groups.sort((a,b)=>b.order-a.order);
  /* P6 지연 그리기 — 완료 업무가 쌓이면(1만 건 = 1만 줄) 탭을 열 때 1초 가까이 멈췄다. 앞쪽 DONE_SYNC_ROWS 줄만 바로 그리고
     나머지는 DONE_CHUNK_ROWS 줄씩 잠깐씩 이어 붙인다. 무엇을 어떤 순서로 보여 주는지·묶음·펼침은 그대로다(다 그리면 같다).
     다시 그리면(doneSeq) 이어 그리던 것은 멈춘다. 줄 수가 적으면 예전처럼 한 번에 그린다. */
  const seq=++doneSeq, later=[];
  let budget=DONE_SYNC_ROWS;
  $('col-done').innerHTML=monthNote+groups.map(g=>{
    const open = (dq || dcalDay!=null) ? true : groupOpen(g.key);
    let rows='';
    if(open){
      const head=g.items.slice(0, budget);
      rows=head.map(doneRowHtml).join(''); budget-=head.length;
      if(head.length<g.items.length) later.push({key:g.key, items:g.items.slice(head.length)});
    }
    return `<section class="done-group${open?'':' dg-closed'}" data-group="${g.key}">
      <div class="dg-head" data-dgtoggle="${g.key}" role="button" aria-expanded="${open}"><span class="dg-caret">${open?'▾':'▸'}</span><span class="dg-label">${esc(g.label)}</span><span class="count num">${g.items.length}</span></div>
      ${open ? `<div class="dg-rows">${doneHeadRow()}${rows}</div>` : ''}
    </section>`;
  }).join('');
  if(later.length) setTimeout(()=>fillDoneLater(seq, later), 0);
}
const DONE_SYNC_ROWS=300, DONE_CHUNK_ROWS=400;
/* 다른 달을 보는 중이고 검색어가 없을 때만 그 달 것으로 거른다(오늘이 든 달 = 전체) */
function doneMonthOnly(){
  if(dq || dcalY==null) return false;
  const d=new Date(); return !(dcalY===d.getFullYear() && dcalM===d.getMonth());
}
let doneSeq=0;
function fillDoneLater(seq, later){
  if(seq!==doneSeq) return;                              // 그새 다시 그렸다 — 이 이어 그리기는 낡았다
  let n=DONE_CHUNK_ROWS;
  while(n>0 && later.length){
    const t=later[0], take=t.items.splice(0, n); n-=take.length;
    const box=document.querySelector(`#col-done .done-group[data-group="${t.key}"] .dg-rows`);
    if(box) box.insertAdjacentHTML('beforeend', take.map(doneRowHtml).join(''));
    if(!t.items.length) later.shift();
  }
  if(later.length) setTimeout(()=>fillDoneLater(seq, later), 0);
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
  const dcEl=$('done-cal');
  if(dcEl) dcEl.addEventListener('click',e=>{
    const nav=e.target.closest('[data-dcalnav]');
    if(nav){ const d=new Date(dcalY, dcalM+Number(nav.dataset.dcalnav), 1); dcalY=d.getFullYear(); dcalM=d.getMonth(); renderDone(); return; }
    const day=e.target.closest('[data-dcalday]');
    if(day){ const t=Number(day.dataset.dcalday); dcalDay = dcalDay===t ? null : t; renderDone(); }
  });
  /* 이 모듈이 소유한 화면 둘을 등록한다 (탭 배선은 main.js 가 아니라 여기).
     보드 탭은 보드 모드에 따라 4열/5열 중 하나만 보이고, 검색줄·입력칸이 함께 붙는다. */
  registerView({key:'board', els:[
    {id:'view-board',  display:'grid', when:()=>placeMode()==='time'},
    {id:'view-board5', display:'grid', when:()=>placeMode()==='owner'},
    {id:'strip',       display:'flex'},
    {id:'blankForm',   display:'inline-block'},   // v3.8.5 소유자 지정: 초록 [＋ 입력] 은 보드에만(다른 탭엔 그 탭의 단추가 있다). Ctrl+N 은 어디서나 그대로
  ]});
  registerView({key:'done', els:[{id:'view-done'}], render:renderDone});
  /* 카드 상호작용 */
  document.body.addEventListener('click',async e=>{
    /* 파일 링크 클릭 — 카드 열기(data-open)보다 먼저 처리 */
    const fo=e.target.closest('[data-fopen]');
    if(fo){ e.stopPropagation(); openPath(fo.dataset.fopen).catch(err=>appAlert('파일을 열 수 없습니다:\n'+fo.dataset.fopen+'\n\n'+err)); return; }
    const fr=e.target.closest('[data-freveal]');
    if(fr){ e.stopPropagation(); revealPath(fr.dataset.freveal).catch(err=>appAlert('폴더를 열 수 없습니다:\n'+err)); return; }
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
    /* v3.8.0 캘린더 '점검' 이름표의 × — 그 세부 줄만 지운다(업무는 남김). 양식에서 세부 줄을 지우고 저장한 것과
       같은 결과: 세부 배열에서 빠지고, 남은 세부·업무의 알람 상태는 그대로. 진행 중 업무에만 있는 단추다
       (완료 업무는 캘린더 현행 보기에 안 나온다) — 완료 업무 행은 고치지 않는다(증분 저장 규칙). */
    const ds=e.target.closest('[data-delsub]');
    if(ds){ e.stopPropagation(); const it=S.items.find(x=>x.id==ds.dataset.item);
      const i=it ? (it.subs||[]).findIndex(s=>s.id==ds.dataset.delsub) : -1;
      if(i<0||it.done) return;
      const removed=it.subs[i]; it.subs.splice(i,1); persist();
      showToast('하위 업무 삭제함',()=>{ const cur=S.items.find(x=>x.id===it.id); if(!cur||cur.done) return;
        cur.subs.splice(Math.min(i,cur.subs.length),0,removed); persist(); });
      return; }
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
  $('search').addEventListener('input',e=>{q=e.target.value.trim().toLowerCase(); clearTimeout(qT); qT=setTimeout(render, SEARCH_DEBOUNCE);});
  $('done-search').addEventListener('input',e=>{dq=e.target.value.trim().toLowerCase(); clearTimeout(dqT); dqT=setTimeout(renderDone, SEARCH_DEBOUNCE);});
  /* v3.8.0 완료 묶음: 머리줄 = 접기·펼치기 */
  $('col-done').addEventListener('click',e=>{
    const hd=e.target.closest('[data-dgtoggle]'); if(!hd) return;
    const k=hd.dataset.dgtoggle; dgToggled.has(k)?dgToggled.delete(k):dgToggled.add(k); renderDone();
  });
}

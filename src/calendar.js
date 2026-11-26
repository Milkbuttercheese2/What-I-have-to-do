/* =========================================================================
   캘린더
   ========================================================================= */
import {S, newId} from './state.js';
import {$, esc, escAttr} from './dom-utils.js';
import {DOW, DEFAULT_TIME_DUE} from './datetime.js';
import {registerView} from './views.js';
import {STORE} from './store.js';
import {openForm} from './form.js';

let calY=new Date().getFullYear(), calM=new Date().getMonth(), calSel=null;

/* v3.8.0 보기 = 'live'(현행) | 'done'(종료). 고른 값은 S.settings.calView 에 기억한다(설정 화면 항목은 없음).
   모르는 값은 현행으로 접는다. */
export function calView(){ return S.settings && S.settings.calView==='done' ? 'done' : 'live'; }

/* 캘린더 이벤트.
   현행: '진행 중'인 것만 — 그날이 마감일인 미완료 업무 + 그날이 시각인 미완료 세부 할일.
         완료된 업무·완료된 세부, 부모(주기 정의)는 감춘다.
   종료(v3.8.0): 종료 업무를 **끝낸 날·시각(doneAt)**에 하나씩 — 세부는 그리지 않는다.
         doneAt 이 없는(옛 데이터) 업무와 주기 부모는 그리지 않는다. */
function dayEvents(view){
  return (view||calView())==='done' ? doneEvents() : liveEvents();
}
function doneEvents(){
  const map={};
  S.items.forEach(it=>{
    if(it.recur || !it.done || it.doneAt==null) return;
    const d=new Date(it.doneAt); if(isNaN(d)) return;
    const key=`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    (map[key]=map[key]||[]).push({iso:d.toISOString(), it, fkey:'done', label:'종료'});
  });
  return map;
}
function liveEvents(){
  const map={};
  const push=(iso,payload)=>{ if(!iso)return; const d=new Date(iso); if(isNaN(d))return;
    const key=`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; (map[key]=map[key]||[]).push(Object.assign({iso},payload)); };
  S.items.forEach(it=>{
    if(it.recur || it.done) return;                 // 부모 정의·완료 업무 제외
    push((it.f||{}).due,{it,fkey:'due',label:'기한'});
    (it.subs||[]).filter(s=>s.mid && !s.done).forEach(s=>push(s.mid,{it,fkey:'mid',label:'하위 업무',subTitle:s.title,subDone:s.done,subId:s.id}));
  });
  return map;
}
function pillClass(fkey){ return fkey==='mid'?'p-mid':fkey==='done'?'p-fin':'p-due'; }
const memo1 = it => String(it.memo||'').split('\n')[0]||'(메모 없음)';
/* v3.7.0 상세(옆 칸) = 하루 시간표 (소유자 지정).
   세로축 0~24시, 각 점검·마감은 그 시각 높이에 **가로선**을 긋고 이름표(시각·종류·내용)를 단다.
   이름표를 누르면 그 업무 양식이 열린다(data-open → render.js 카드 열기 위임).
   같은 시각대에 여러 건이면 선은 제자리, 이름표만 아래로 밀어 겹치지 않게 한다.
   오늘이면 지금 시각에 빨간 선. 처음 열 때 첫 일정(없으면 지금/오전 8시) 근처로 스크롤한다. */
export const HOUR_PX = 44;                    // 1시간 높이 — CSS .tl-hour 높이와 같아야 한다
const CHIP_PX = 26;                           // 이름표 높이(겹침 판정) — CSS .tl-chip 와 같아야 한다
export function layoutTimeline(evs){
  const rows = evs.slice().sort((a,b)=>new Date(a.iso)-new Date(b.iso)).map(ev=>{
    const t=new Date(ev.iso); const min=t.getHours()*60+t.getMinutes();
    return {ev, min, line: min/60*HOUR_PX};
  });
  let floor=-Infinity;
  for(const r of rows){ r.chip=Math.max(r.line-CHIP_PX/2, floor); floor=r.chip+CHIP_PX+2; }
  return rows;
}
/* v3.8.0 시간표 높이(px) → 그날 0시부터의 분. 30분 단위로 내려 맞추고(누른 칸의 시작 시각),
   0:00 ~ 23:30 안으로 묶는다 — 시간표 맨 아래(24:00 = 다음 날 0시)를 눌러도 그날 안에 머문다. */
export const SLOT_MIN = 30;
export function minuteAtY(y, step){
  step=step||SLOT_MIN;
  const raw=Math.floor((Number(y)||0)/HOUR_PX*60/step)*step;
  return Math.min(Math.max(raw,0), 24*60-step);
}
/* 날짜 키('2026-10-21' 꼴, 달은 0부터 — dayEvents 의 키와 같다)와 분 → 그 시각의 ISO */
export function slotIso(key, min){
  const [y,m,d]=String(key).split('-').map(Number);
  return new Date(y, m, d, Math.floor(min/60), min%60, 0, 0).toISOString();
}
const hm = min => `${String(Math.floor(min/60)).padStart(2,'0')}:${String(min%60).padStart(2,'0')}`;
/* 빈 새 양식을 열고 첫 세부 줄의 점검시각을 채운다 — 저장 전엔 아무것도 생기지 않는다.
   subFromMemo: 세부 제목을 비운 채 저장해도 줄이 버려져 시각이 사라지지 않게(form.js collectForm).
   세부에 id 를 미리 준다 — id 없는 줄은 collectForm 이 부를 때마다 새 id 를 만들어 '저장본과 같음' 판정이 늘 어긋나,
   손대지 않고 닫아도 '새 업무' 임시저장이 남았다(다음 양식에서 이어 쓸지 묻는 창이 뜬다). */
function openAt(iso){ openForm({subs:[{id:newId(), title:'', mid:iso}]}, {subFromMemo:true}); }
let lastScrollKey=null;
function renderDetail(evMap){
  const dt=$('cal-detail'); if(!dt) return;
  if(!calSel){ const n=new Date(); calSel=`${n.getFullYear()}-${n.getMonth()}-${n.getDate()}`; }
  const view=calView();
  const evs=(evMap||dayEvents(view))[calSel]||[];
  const [y,m,dd]=calSel.split('-').map(Number); const dObj=new Date(y,m,dd);
  $('cal-detail-title').innerHTML=`${m+1}월 ${dd}일 <span class="cal-dw">${DOW[dObj.getDay()]}요일</span><span class="cal-cnt num">${evs.length}건</span>`;
  const rows=layoutTimeline(evs);
  const hours=Array.from({length:25},(_,h)=>`<div class="tl-hour" style="top:${h*HOUR_PX}px"><span class="tl-hl num">${String(h).padStart(2,'0')}:00</span></div>`).join('');
  const lines=rows.map(r=>{
    const ev=r.ev, t=new Date(ev.iso);
    const hm=`${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`;
    const kind=ev.fkey==='mid'?'점검':ev.fkey==='done'?'종료':'기한';
    const what=ev.fkey==='mid' ? `${ev.subTitle} · ${String(ev.it.memo||'').split('\n')[0]}` : memo1(ev.it);
    const cls=ev.fkey==='mid'?'tl-mid':ev.fkey==='done'?'tl-fin':'tl-due';
    return `<div class="tl-line ${cls}" style="top:${r.line}px"></div>`
      +`<div class="tl-chip ${cls}" style="top:${r.chip}px" data-open="${ev.it.id}" title="${escAttr(kind+' '+hm+' · '+what)}">`
      +`<span class="tl-time num">${hm}</span><span class="tl-kind">${kind}</span><span class="tl-what">${esc(what)}</span>`
      /* v3.8.0 × — 카드의 × 와 같은 클래스·같은 위임(render.js). 마감·종료 = 그 업무 삭제(data-del),
         점검 = 그 세부 줄만 삭제(data-delsub). 이름표의 data-open·빈 자리 클릭보다 먼저 먹는다. */
      +(ev.fkey==='mid' ? `<button class="del tl-del" data-delsub="${ev.subId}" data-item="${ev.it.id}" title="하위 업무 삭제">×</button>`
                        : `<button class="del tl-del" data-del="${ev.it.id}" title="삭제">×</button>`)+`</div>`;
  }).join('');
  const now=new Date(); const isToday=now.getFullYear()===y&&now.getMonth()===m&&now.getDate()===dd;
  const nowLine=isToday?`<div class="tl-now" style="top:${(now.getHours()*60+now.getMinutes())/60*HOUR_PX}px"></div>`:'';
  const empty=rows.length?'':`<div class="tl-empty">${view==='done'?'이날 끝낸 업무가 없습니다.':'이날 기한·점검할 업무가 없습니다.'}</div>`;
  /* 현행 보기만: 빈 자리 누르기 = 새 업무. 마우스 자리에 흐린 줄 + 시각(.tl-hover — mousemove 가 옮긴다) */
  const hover=view==='live'?'<div class="tl-hover" aria-hidden="true"><span class="tl-hover-t num"></span></div>':'';
  const box=$('cal-detail-cards');
  const height=Math.max(24*HOUR_PX, rows.length?rows[rows.length-1].chip+CHIP_PX+8:0);
  box.className='cal-timeline'+(view==='live'?' tl-pickable':'');
  box.innerHTML=`${empty}<div class="tl-canvas" style="height:${height}px">${hours}${nowLine}${hover}${lines}</div>`;
  dt.classList.add('on');
  /* 날짜가 바뀔 때만 스크롤 위치를 다시 잡는다(60초 재렌더가 보던 자리를 흔들지 않게) */
  if(lastScrollKey!==calSel+view && box.clientHeight>0){   // 숨은 탭에서는 스크롤이 먹지 않으므로 보일 때 다시 시도
    lastScrollKey=calSel+view;
    const focusMin = rows.length ? rows[0].min : (isToday ? now.getHours()*60 : 8*60);
    try{ box.scrollTop=Math.max(0, focusMin/60*HOUR_PX-HOUR_PX); }catch{}
  }
}
export function renderCal(){
  $('cal-title').textContent=`${calY}년 ${calM+1}월`;
  const g=$('cal-grid'); g.innerHTML='';
  if(!calSel){ const n=new Date(); calSel=`${n.getFullYear()}-${n.getMonth()}-${n.getDate()}`; }
  ['일','월','화','수','목','금','토'].forEach((d,i)=>g.insertAdjacentHTML('beforeend',`<div class="cal-dow ${i===0?'sun':''}${i===6?' sat':''}">${d}</div>`));
  const first=new Date(calY,calM,1); const start=new Date(first); start.setDate(1-first.getDay());
  const view=calView();
  document.querySelectorAll('#cal-mode .seg-btn').forEach(b=>b.classList.toggle('on', b.dataset.v===view));
  const lg=$('cal-legend');
  /* 범례 점은 pill 색과 반드시 같은 토큰을 쓸 것 (v2.5.17) */
  if(lg) lg.innerHTML = view==='done'
    ? '<span><i class="lg" style="background:var(--gray-fg)"></i>끝낸 날</span>'
    : '<span><i class="lg" style="background:var(--cal-mid)"></i>하위 업무 점검일</span><span><i class="lg" style="background:var(--cal-due)"></i>업무 기한</span>';
  const evMap=dayEvents(view); const today=new Date();
  for(let i=0;i<42;i++){
    const d=new Date(start); d.setDate(start.getDate()+i);
    const other=d.getMonth()!==calM; const key=`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const evs=(evMap[key]||[]).sort((a,b)=>new Date(a.iso)-new Date(b.iso));
    let pills=evs.slice(0,4).map(ev=>{ const t=new Date(ev.iso); const hm=`${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`;
      const done = ev.fkey==='mid' ? ev.subDone : ev.fkey==='done' ? false : ev.it.done;   // 종료 보기는 전부 끝난 일 — 줄을 긋지 않는다
      const label = ev.fkey==='mid' ? ev.subTitle : (ev.it.memo||'(메모 없음)');
      return `<div class="pill ${pillClass(ev.fkey)}${done?' p-done':''}" title="${escAttr(ev.label+' · '+label)}">${hm} ${esc(label)}</div>`; }).join('');
    if(evs.length>4)pills+=`<div class="pill p-more">+${evs.length-4}건 더</div>`;
    g.insertAdjacentHTML('beforeend',`<div class="cal-day${other?' other':''}${d.toDateString()===today.toDateString()?' today':''}${d.getDay()===0?' sun-d':''}${d.getDay()===6?' sat-d':''}${calSel===key?' sel':''}${evs.length?' has-ev':''}" data-key="${key}"><div class="dnum">${d.getDate()}</div>${pills}</div>`);
  }
  renderDetail(evMap);
}

export function initCalendar(){
  registerView({key:'cal', els:[{id:'view-cal'}], render:renderCal});
  $('cal-prev').addEventListener('click',()=>{calM--;if(calM<0){calM=11;calY--;}calSel=null;renderCal();});
  $('cal-next').addEventListener('click',()=>{calM++;if(calM>11){calM=0;calY++;}calSel=null;renderCal();});
  $('cal-today').addEventListener('click',()=>{const n=new Date();calY=n.getFullYear();calM=n.getMonth();calSel=null;renderCal();});
  /* 날짜를 누르면 옆(좁으면 아래) 상세가 그날로 바뀐다 — v3.7.0.
     v3.8.0: 달력 칸은 다시 만들지 않고 골라짐 표시만 옮긴다 — 칸을 갈아끼우면 두 번째 누르기가
     새 칸에 떨어져 두 번 누르기(dblclick)가 먹지 않을 수 있다. */
  $('cal-grid').addEventListener('click',e=>{
    const cell=e.target.closest('.cal-day'); if(!cell)return; calSel=cell.dataset.key;
    $('cal-grid').querySelectorAll('.cal-day.sel').forEach(c=>c.classList.remove('sel'));
    cell.classList.add('sel'); renderDetail();
  });
  /* v3.8.0 날짜 두 번 누르기 = 그날 점검 기본 시각(18:00)으로 새 업무 — 현행 보기만 */
  $('cal-grid').addEventListener('dblclick',e=>{
    const cell=e.target.closest('.cal-day'); if(!cell || calView()!=='live') return;
    openAt(slotIso(cell.dataset.key, DEFAULT_TIME_DUE.hh*60+DEFAULT_TIME_DUE.mm));
  });
  /* v3.8.0 현행 | 종료 전환 — 고른 값은 설정 가방에 기억(설정 화면 항목 없음) */
  $('cal-mode').addEventListener('click',e=>{
    const b=e.target.closest('.seg-btn[data-v]'); if(!b || b.dataset.v===calView()) return;
    S.settings.calView=b.dataset.v; window.SETTINGS=S.settings; STORE.saveSettings(S.settings);
    renderCal();
  });
  /* v3.8.0 시간표 빈 자리 누르기 = 그 시각으로 새 업무(현행 보기만).
     이름표(data-open)는 여기서 건너뛰고 render.js 의 카드 열기 위임이 그 업무를 연다. */
  const tl=$('cal-detail-cards');
  const yOf=(e,cv)=>e.clientY-cv.getBoundingClientRect().top;
  tl.addEventListener('click',e=>{
    if(calView()!=='live' || e.target.closest('[data-open],.del')) return;
    const cv=e.target.closest('.tl-canvas'); if(!cv) return;
    openAt(slotIso(calSel, minuteAtY(yOf(e,cv))));
  });
  tl.addEventListener('mousemove',e=>{
    const cv=tl.querySelector('.tl-canvas'), hv=cv&&cv.querySelector('.tl-hover'); if(!hv) return;
    if(e.target.closest('[data-open]') || !e.target.closest('.tl-canvas')){ hv.classList.remove('on'); return; }
    const min=minuteAtY(yOf(e,cv));
    hv.style.top=`${min/60*HOUR_PX}px`; hv.firstElementChild.textContent=hm(min); hv.classList.add('on');
  });
  tl.addEventListener('mouseleave',()=>{ const hv=tl.querySelector('.tl-hover'); if(hv) hv.classList.remove('on'); });
}

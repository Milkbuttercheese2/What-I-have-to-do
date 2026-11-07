/* =========================================================================
   캘린더
   ========================================================================= */
import {S} from './state.js';
import {$, esc, escAttr} from './dom-utils.js';
import {DOW} from './datetime.js';
import {registerView} from './views.js';

let calY=new Date().getFullYear(), calM=new Date().getMonth(), calSel=null;

/* 캘린더 이벤트: '진행 중'인 것만 — 그날이 마감일인 미완료 업무 + 그날이 시각인
   미완료 세부 할일만 표시. 완료된 업무·완료된 세부, 부모(주기 정의)는 감춘다. */
function dayEvents(){
  const map={};
  const push=(iso,payload)=>{ if(!iso)return; const d=new Date(iso); if(isNaN(d))return;
    const key=`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; (map[key]=map[key]||[]).push(Object.assign({iso},payload)); };
  S.items.forEach(it=>{
    if(it.recur || it.done) return;                 // 부모 정의·완료 업무 제외
    push((it.f||{}).due,{it,fkey:'due',label:'마감'});
    (it.subs||[]).filter(s=>s.mid && !s.done).forEach(s=>push(s.mid,{it,fkey:'mid',label:'세부',subTitle:s.title,subDone:s.done}));
  });
  return map;
}
function pillClass(fkey){ return fkey==='mid'?'p-mid':'p-due'; }
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
let lastScrollKey=null;
function renderDetail(evMap){
  const dt=$('cal-detail'); if(!dt) return;
  if(!calSel){ const n=new Date(); calSel=`${n.getFullYear()}-${n.getMonth()}-${n.getDate()}`; }
  const evs=(evMap||dayEvents())[calSel]||[];
  const [y,m,dd]=calSel.split('-').map(Number); const dObj=new Date(y,m,dd);
  $('cal-detail-title').innerHTML=`${m+1}월 ${dd}일 <span class="cal-dw">${DOW[dObj.getDay()]}요일</span><span class="cal-cnt num">${evs.length}건</span>`;
  const rows=layoutTimeline(evs);
  const hours=Array.from({length:25},(_,h)=>`<div class="tl-hour" style="top:${h*HOUR_PX}px"><span class="tl-hl num">${String(h).padStart(2,'0')}:00</span></div>`).join('');
  const lines=rows.map(r=>{
    const ev=r.ev, t=new Date(ev.iso);
    const hm=`${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`;
    const kind=ev.fkey==='mid'?'점검':'마감';
    const what=ev.fkey==='mid' ? `${ev.subTitle} · ${String(ev.it.memo||'').split('\n')[0]}` : (String(ev.it.memo||'').split('\n')[0]||'(메모 없음)');
    const cls=ev.fkey==='mid'?'tl-mid':'tl-due';
    return `<div class="tl-line ${cls}" style="top:${r.line}px"></div>`
      +`<div class="tl-chip ${cls}" style="top:${r.chip}px" data-open="${ev.it.id}" title="${escAttr(kind+' '+hm+' · '+what)}">`
      +`<span class="tl-time num">${hm}</span><span class="tl-kind">${kind}</span><span class="tl-what">${esc(what)}</span></div>`;
  }).join('');
  const now=new Date(); const isToday=now.getFullYear()===y&&now.getMonth()===m&&now.getDate()===dd;
  const nowLine=isToday?`<div class="tl-now" style="top:${(now.getHours()*60+now.getMinutes())/60*HOUR_PX}px"></div>`:'';
  const empty=rows.length?'':'<div class="tl-empty">이날 마감·점검할 업무가 없습니다.</div>';
  const box=$('cal-detail-cards');
  const height=Math.max(24*HOUR_PX, rows.length?rows[rows.length-1].chip+CHIP_PX+8:0);
  box.className='cal-timeline';
  box.innerHTML=`${empty}<div class="tl-canvas" style="height:${height}px">${hours}${nowLine}${lines}</div>`;
  dt.classList.add('on');
  /* 날짜가 바뀔 때만 스크롤 위치를 다시 잡는다(60초 재렌더가 보던 자리를 흔들지 않게) */
  if(lastScrollKey!==calSel && box.clientHeight>0){   // 숨은 탭에서는 스크롤이 먹지 않으므로 보일 때 다시 시도
    lastScrollKey=calSel;
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
  const evMap=dayEvents(); const today=new Date();
  for(let i=0;i<42;i++){
    const d=new Date(start); d.setDate(start.getDate()+i);
    const other=d.getMonth()!==calM; const key=`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const evs=(evMap[key]||[]).sort((a,b)=>new Date(a.iso)-new Date(b.iso));
    let pills=evs.slice(0,4).map(ev=>{ const t=new Date(ev.iso); const hm=`${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`;
      const done = ev.fkey==='mid' ? ev.subDone : ev.it.done;
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
  /* 날짜를 누르면 옆(좁으면 아래) 상세가 그날로 바뀐다 — v3.7.0 */
  $('cal-grid').addEventListener('click',e=>{
    const cell=e.target.closest('.cal-day'); if(!cell)return; calSel=cell.dataset.key; renderCal();
  });
}

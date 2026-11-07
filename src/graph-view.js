/* =========================================================================
   관계도 탭 (v3.7.0, 소유자 지정) — '조달법령 흐름도'의 **행정규칙 근거지도** 화면 구성을 따른다.
     · 위: 도구 패널 — 검색 · [연결 사슬 | 전체 지도] · [선택 해제] · 업무 수, 고리 종류 칩(누르면 그 종류를 끄고 켬)
     · 가운데: 연결 사슬 = 3단(지금 업무 | 고리 | 엮인 업무) 열 머리 + 사각 노드 + 선 색으로 고리 종류 구분(점선·파선 금지 — 소유자 지정)
              전체 지도 = 모든 고리(왼쪽)와 업무(오른쪽)를 한 장에, 고른 업무의 사슬만 진하게
     · 오른쪽: 살피기 칸(inspector) — 고른 업무, 고리별로 엮인 업무 목록 + [열기]
     · 아래: 연결 목록 표 — 업무 | 고리 | 엮인 업무 수 (행을 누르면 그 업무를 고른다)
   노드를 누르면 그 업무를 가운데로 옮겨 따라간다(◀ 로 되돌아감). 양식은 [열기](data-open → render.js 위임).
   엮임 규칙·배치는 links.js(순수). 순 SVG — 외부 라이브러리 없음(내부망 배포). init*() 외 최상위 실행문 없음.
   ========================================================================= */
import {S} from './state.js';
import {$, esc} from './dom-utils.js';
import {textMatch} from './filters.js';
import {linkedItems, graphLayout, linkCounts, linkIndex, GRAPH} from './links.js';
import {registerView} from './views.js';

let selId=null, hist=[], gq='', mode='chain';
/* 성능 상한(v3.7.0 실측: 업무 2천 건에서 표 전체·지도 전체를 그리면 0.5~1.6초) — 그 이상은 화면이 읽히지도 않는다.
   검색·사슬·살피기 칸은 전부를 대상으로 하고, 그리기만 상한을 둔다. */
const TABLE_MAX=200, MAP_MAX=150;
const kindsOn={person:true, id:true, recur:true};
const KIND_NAME={person:'관련인', id:'식별정보', recur:'주기 업무'};
const cut=(t,n)=>{ t=String(t||''); return t.length>n ? t.slice(0,n-1)+'…' : t; };
const first=it=>String((it&&it.memo)||'').split('\n')[0]||'(메모 없음)';
const kinds=()=>Object.keys(kindsOn).filter(k=>kindsOn[k]);
const links=(it,limit)=>linkedItems(S.items, it, limit, {kinds:kinds()});

/* 사각 노드 — 왼쪽 색 막대(근거지도의 뿌리 색 막대와 같은 결) */
function node(x,y,w,cls,label,title,extra=''){
  return `<g class="gn ${cls}" transform="translate(${(x-w/2).toFixed(1)},${(y-15).toFixed(1)})"${extra}><title>${esc(title)}</title>`
    +`<rect class="gn-box" width="${w}" height="30" rx="6"/><rect class="gn-bar" width="4" height="30" rx="2"/>`
    +`<text x="14" y="19.5">${esc(label)}</text></g>`;
}
/* 열 사이에서만 휘는 가로 S자 선 — 고리 종류는 색으로 구분(모두 실선) */
const curve=(x1,y1,x2,y2,cls)=>{ const mx=(x1+x2)/2;
  return `<path class="g-e ${cls}" d="M${x1.toFixed(1)},${y1.toFixed(1)} C${mx.toFixed(1)},${y1.toFixed(1)} ${mx.toFixed(1)},${y2.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}"/>`; };
const HUB_ICON={person:'👤', id:'#', recur:'↻'};

/* 연결 사슬 — 3단 */
export function graphSvg(center, list){
  const {W, H, center:C, hubs, tasks, top}=graphLayout(list);
  const hubBy=new Map(hubs.map(h=>[h.key,h]));
  const CW=GRAPH.wC, HW=GRAPH.wH, TW=GRAPH.wT;
  const heads=[['지금 업무',C.x-CW/2],['고리',GRAPH.colH-HW/2],['엮인 업무',GRAPH.colT-TW/2]]
    .map(([t,x])=>`<text class="g-colhead" x="${x}" y="17">${t}</text>`).join('')+`<line class="g-colline" x1="0" y1="${top-10}" x2="${W}" y2="${top-10}"/>`;
  let edges='', nodes='';
  for(const h of hubs) edges+=curve(C.x+CW/2, C.y, h.x-HW/2, h.y, `g-e-hub g-${h.kind}`);
  for(const t of tasks) for(const k of t.via){ const h=hubBy.get(k); edges+=curve(h.x+HW/2, h.y, t.x-TW/2, t.y, `g-${h.kind}`); }
  for(const t of tasks) nodes+=node(t.x, t.y, TW, `g-task${t.done?' g-done':''}`, (t.done?'✓ ':'')+cut(t.label,17), (t.done?'[완료] ':'[진행] ')+t.label, ` data-gcenter="${t.id}" role="button" tabindex="0"`);
  for(const h of hubs) nodes+=node(h.x, h.y, HW, `g-hub g-${h.kind}`, `${HUB_ICON[h.kind]} ${cut(h.label,13)}`, `${KIND_NAME[h.kind]} · ${h.label}`);
  nodes+=node(C.x, C.y, CW, `g-center${center.done?' g-done':''}`, cut(first(center),14), first(center));
  return `<svg class="link-graph" viewBox="0 0 ${W} ${H}" role="img" aria-label="연결 사슬">${heads}${edges}${nodes}</svg>`;
}

/* 전체 지도 — 왼쪽 열 = 모든 고리, 오른쪽 열 = 엮인 업무가 있는 모든 업무. 고른 업무의 사슬만 진하게 */
let mapCapped=0;
function allMapSvg(){
  const W=GRAPH.W, ROW=30, TOP=34;
  const ix=linkIndex(S.items, {kinds:kinds()});
  const byId=new Map(S.items.map(x=>[x.id,x]));
  let taskRows=[...ix.keysOf].filter(([,ks])=>ks.length).map(([id])=>byId.get(id)).filter(Boolean);
  let capped=0;
  if(taskRows.length>MAP_MAX){
    /* 엮인 수 많은 순으로 MAP_MAX 건 + 고른 업무와 그 이웃은 항상 포함 */
    const cnt=linkCounts(S.items, {kinds:kinds()});
    const keep=new Set(taskRows.slice().sort((a,b)=>(cnt.get(b.id)||0)-(cnt.get(a.id)||0)).slice(0,MAP_MAX).map(t=>t.id));
    if(selId!=null && ix.keysOf.get(selId)){ keep.add(selId); for(const k of ix.keysOf.get(selId)) ix.hubs.get(k).ids.forEach(id=>keep.add(id)); }
    capped=taskRows.length-keep.size; taskRows=taskRows.filter(t=>keep.has(t.id));
  }
  mapCapped=capped;
  const own=new Map(taskRows.map(t=>[t.id, new Map(ix.keysOf.get(t.id).map(k=>[k, ix.hubs.get(k)]))]));
  const hubMap=new Map([...ix.hubs].map(([k,h])=>[k,{key:k, kind:h.kind, label:h.label, n:h.ids.size}]));
  const KORD={person:0,id:1,recur:2};
  const hubs=[...hubMap.values()].sort((a,b)=>(KORD[a.kind]-KORD[b.kind])||(b.n-a.n)||a.label.localeCompare(b.label,'ko'));
  const hi=new Map(hubs.map((h,i)=>[h.key,i]));
  taskRows.sort((a,b)=>Math.min(...[...own.get(a.id).keys()].map(k=>hi.get(k)))-Math.min(...[...own.get(b.id).keys()].map(k=>hi.get(k))) || ((a.done?1:0)-(b.done?1:0)) || b.id-a.id);
  const H=TOP+Math.max(hubs.length, taskRows.length)*ROW+16;
  const hx=200, tx=W-230, HW=230, TW=300;
  const hy=new Map();
  /* 고리 열과 업무 열의 행 수가 다르면 짧은 열을 같은 높이로 고르게 편다 */
  const spread=(i,n,N)=>TOP+ROW/2+(N<=1?0:i*((Math.max(n,N)-1)*ROW)/(N-1));
  const nH=hubs.length, nT=taskRows.length, M=Math.max(nH,nT);
  hubs.forEach((h,i)=>hy.set(h.key, nH>=nT ? TOP+ROW/2+i*ROW : spread(i,M,nH)));
  const ty=new Map(taskRows.map((t,i)=>[t.id, nT>=nH ? TOP+ROW/2+i*ROW : spread(i,M,nT)]));
  const sel=selId;
  const selHubs=sel!=null && own.has(sel) ? new Set(own.get(sel).keys()) : new Set();
  const near=new Set(); if(sel!=null) for(const k of selHubs) (ix.hubs.get(k)||{ids:[]}).ids.forEach(id=>near.add(id));   // 고른 업무와 고리를 함께 쓰는 이웃
  let edges='', nodes='';
  for(const t of taskRows) for(const [k,v] of own.get(t.id)){
    const on=sel==null || t.id===sel || selHubs.has(k);              // 고른 업무의 고리에 걸린 선은 이웃까지 보인다
    edges+=curve(hx+HW/2, hy.get(k), tx-TW/2, ty.get(t.id), `g-${v.kind}${on?'':' g-faint'}${t.id===sel?' g-hot':''}`);
  }
  for(const h of hubs) nodes+=node(hx, hy.get(h.key), HW, `g-hub g-${h.kind}${sel!=null&&!selHubs.has(h.key)?' g-fade':''}`, `${HUB_ICON[h.kind]} ${cut(h.label,15)}`, `${KIND_NAME[h.kind]} · ${h.label} (${h.n}건)`);
  for(const t of taskRows) nodes+=node(tx, ty.get(t.id), TW, `g-task${t.done?' g-done':''}${t.id===sel?' g-sel':''}${sel!=null&&t.id!==sel&&!near.has(t.id)?' g-fade':''}`, (t.done?'✓ ':'')+cut(first(t),22), first(t), ` data-gcenter="${t.id}" role="button" tabindex="0"`);
  const heads=`<text class="g-colhead" x="${hx-HW/2}" y="17">고리</text><text class="g-colhead" x="${tx-TW/2}" y="17">업무</text><line class="g-colline" x1="0" y1="${TOP-10}" x2="${W}" y2="${TOP-10}"/>`;
  return taskRows.length ? `<svg class="link-graph g-all" viewBox="0 0 ${W} ${H}" role="img" aria-label="전체 지도">${heads}${edges}${nodes}</svg>` : '';
}

/* 연결 목록 대상 — 엮인 업무가 1건 이상인 업무만(주기 부모 제외). 진행 먼저 · 엮인 수 많은 순 */
function candidates(){
  const cnt=linkCounts(S.items, {kinds:kinds()}), out=[];
  for(const it of S.items){ if(it.recur) continue; const n=cnt.get(it.id)||0; if(n) out.push({it, n}); }
  return out.sort((a,b)=>((a.it.done?1:0)-(b.it.done?1:0)) || (b.n-a.n) || (b.it.id-a.it.id));
}
/* 업무 하나의 고리 목록(연결 목록 표·칩용) */
function hubsOf(it, ix){ return (ix.keysOf.get(it.id)||[]).map(k=>ix.hubs.get(k)); }

function renderChips(all){
  const el=$('gr-chips'); if(!el) return;
  const cnt={person:0, id:0, recur:0};
  for(const h of linkIndex(S.items).hubs.values()) cnt[h.kind]++;      // 칩 숫자 = 그 종류의 고리 수(꺼져 있어도 셈)
  el.innerHTML=['person','id','recur'].map(k=>`<button type="button" class="gr-chip g-${k}${kindsOn[k]?'':' off'}" data-gkind="${k}" aria-pressed="${kindsOn[k]}">`
    +`<i></i>${KIND_NAME[k]} <b class="num">${cnt[k]}</b></button>`).join('');
  $('gr-total').textContent=`업무 ${all.length}건`;
}

function renderPanel(){
  const p=$('gr-panel'); if(!p) return;
  const it=selId!=null ? S.items.find(x=>x.id===selId) : null;
  if(mode==='all'){
    const svg=allMapSvg();
    p.innerHTML=`<div class="gr-phead"><h3>전체 지도</h3><span class="gr-sub"></span>${legend()}</div>`
      +(svg?`<div class="gr-canvas">${svg}</div>`:'<div class="empty">엮인 업무가 없습니다.</div>');
    p.querySelector('.gr-sub').textContent = svg ? ((it ? `고른 업무: ${cut(first(it),24)}` : '업무를 누르면 그 사슬만 진하게')+(mapCapped?` · 엮인 수 많은 ${MAP_MAX}건만 표시(${mapCapped}건 생략)`:'')) : '';
    return;
  }
  if(!it){
    const top=candidates().slice(0,3);
    p.innerHTML=`<div class="gr-intro"><h3>업무를 고르면 그 업무의 연결 사슬을 그립니다.</h3>`
      +(top.length?`<div class="gr-ex"><span>예시</span>${top.map(x=>`<button type="button" class="gr-exbtn" data-gsel="${x.it.id}">${esc(cut(first(x.it),24))}</button>`).join('')}</div>`:'<div class="empty">엮인 업무가 없습니다.</div>')
      +`</div>`;
    return;
  }
  const list=links(it, 24);
  const nh=new Set(list.flatMap(l=>l.via.map(v=>v.key))).size;
  p.innerHTML=`<div class="gr-phead"><button class="btn btn-cancel gr-back" id="gr-back" ${hist.length?'':'disabled'} title="이전 업무로">◀</button>`
    +`<h3 class="gr-title">${esc(first(it))}</h3><span class="gr-sub">연결 사슬 · 고리 ${nh}개 · 엮인 업무 ${list.length}건</span>${legend()}</div>`
    +(list.length?`<div class="gr-canvas">${graphSvg(it, list)}</div>`:'<div class="empty">엮인 업무가 없습니다.</div>');
}
const legend=()=>`<span class="g-legend"><span class="g-lg g-person">관련인</span><span class="g-lg g-id">식별정보</span><span class="g-lg g-recur">주기 업무</span></span>`;

function renderInspector(){
  const el=$('gr-insp'); if(!el) return;
  const it=selId!=null ? S.items.find(x=>x.id===selId) : null;
  const wrap=document.querySelector('#view-graph .gr-layout');
  if(wrap) wrap.classList.toggle('has-insp', !!it);
  if(!it){ el.innerHTML=''; return; }
  const list=links(it, 99);
  const groups=new Map();
  for(const l of list) for(const v of l.via){ if(!groups.has(v.key)) groups.set(v.key,{v, items:[]}); groups.get(v.key).items.push(l.it); }
  el.innerHTML=`<div class="gi-top"><span class="gi-crumb">${it.done?'완료 업무':'진행 업무'}</span><button type="button" class="fm-x" id="gr-x" aria-label="선택 해제">×</button></div>`
    +`<h3 class="gi-title">${esc(first(it))}</h3>`
    +`<div class="gi-acts"><span class="rel-tag ${it.done?'done':'ongoing'}">${it.done?'완료':'진행'}</span><button class="btn btn-ok gr-open" data-open="${it.id}">열기</button></div>`
    +[...groups.values()].map(g=>`<div class="gi-sec g-${g.v.kind}"><div class="gi-h"><i></i>${KIND_NAME[g.v.kind]} — ${esc(g.v.label)} <b class="num">${g.items.length}</b></div>`
      +g.items.map(o=>`<div class="gi-row"><button type="button" class="gi-go" data-gcenter="${o.id}" title="이 업무를 가운데로"><span class="rel-tag ${o.done?'done':'ongoing'}">${o.done?'완료':'진행'}</span><span class="rel-txt">${esc(first(o))}</span></button>`
        +`<button type="button" class="gi-open" data-open="${o.id}">열기</button></div>`).join('')+`</div>`).join('')
    +(groups.size?'':'<div class="empty">엮인 업무가 없습니다.</div>');
}

function renderTable(all){
  const el=$('gr-table'); if(!el) return;
  const ix=linkIndex(S.items, {kinds:kinds()});
  const rows=all.filter(x=>{ if(!gq) return true; if(textMatch(x.it, gq)) return true; return hubsOf(x.it, ix).some(v=>v.label.toLowerCase().includes(gq)); });
  el.innerHTML=`<div class="gr-tr gr-th"><span>업무</span><span>고리</span><span>엮인 업무</span></div>`
    +(rows.length?rows.slice(0,TABLE_MAX).map(({it,n})=>{ const hs=hubsOf(it, ix);
      return `<div class="gr-tr${it.id===selId?' on':''}" data-gsel="${it.id}"><span class="gr-td1"><span class="rel-tag ${it.done?'done':'ongoing'}">${it.done?'완료':'진행'}</span><span class="rel-txt">${esc(first(it))}</span></span>`
        +`<span class="gr-td2">${hs.slice(0,3).map(v=>`<span class="gr-pill g-${v.kind}">${HUB_ICON[v.kind]} ${esc(cut(v.label,14))}</span>`).join('')}${hs.length>3?`<span class="gr-more">+${hs.length-3}</span>`:''}</span>`
        +`<span class="gr-td3 num">${n}건</span></div>`; }).join('')
      :`<div class="empty">${gq?'검색 결과가 없습니다.':'엮인 업무가 없습니다.'}</div>`)
    +(rows.length>TABLE_MAX?`<div class="gr-capnote">${rows.length}건 중 ${TABLE_MAX}건 — 검색으로 좁히세요</div>`:'');
}

export function renderGraphView(){
  if(!$('gr-panel')) return;
  if(selId!=null && !S.items.some(x=>x.id===selId)){ selId=null; hist=[]; }
  const all=candidates();
  $('gr-mode').querySelectorAll('.seg-btn').forEach(b=>b.classList.toggle('on', b.dataset.v===mode));
  renderChips(all); renderPanel(); renderInspector(); renderTable(all);
}

/* 고르기만 바뀌면 표는 다시 그리지 않고 강조만 옮긴다(업무가 많을 때 가장 무거운 부분) */
function select(id, push){
  if(id===selId) return;
  if(push && selId!=null) hist.push(selId);
  selId=id; renderSel();
}
function renderSel(){
  renderPanel(); renderInspector();
  document.querySelectorAll('#gr-table .gr-tr[data-gsel]').forEach(r=>r.classList.toggle('on', Number(r.dataset.gsel)===selId));
}

/* 다른 화면(양식의 [관계도])에서 이 탭을 그 업무 중심으로 연다 */
export function showGraphFor(id){
  if(selId!=null && selId!==id) hist.push(selId);
  selId=id; mode='chain'; gq=''; const s=$('gr-search'); if(s) s.value='';
  const tab=document.querySelector('.tab[data-view="graph"]');
  if(tab) tab.click();
  if(!$('view-graph').classList.contains('on')) renderGraphView();   // 탭 전환이 그려 주지 않았으면(테스트·배선 전) 직접
}

export function initGraphView(){
  registerView({key:'graph', els:[{id:'view-graph'}], render:renderGraphView});
  $('gr-search').addEventListener('input',e=>{ gq=e.target.value.trim().toLowerCase(); renderTable(candidates()); });
  $('view-graph').addEventListener('click',e=>{
    const md=e.target.closest('#gr-mode .seg-btn'); if(md){ mode=md.dataset.v; $('gr-mode').querySelectorAll('.seg-btn').forEach(b=>b.classList.toggle('on', b.dataset.v===mode)); renderPanel(); return; }
    const kc=e.target.closest('[data-gkind]'); if(kc){ const k=kc.dataset.gkind; kindsOn[k]=!kindsOn[k]; if(!kinds().length) kindsOn[k]=true; renderGraphView(); return; }
    if(e.target.closest('#gr-clear,#gr-x')){ selId=null; hist=[]; renderSel(); return; }
    if(e.target.closest('[data-open]')) return;                                   // 열기는 render.js 위임
    const r=e.target.closest('[data-gsel]'); if(r){ select(Number(r.dataset.gsel), true); return; }
    const g=e.target.closest('[data-gcenter]'); if(g){ select(Number(g.dataset.gcenter), true); return; }
    if(e.target.closest('#gr-back')){ const prev=hist.pop(); if(prev!=null){ selId=prev; renderSel(); } }
  });
  $('view-graph').addEventListener('keydown',e=>{
    const g=e.target.closest('[data-gcenter]');
    if((e.key==='Enter'||e.key===' ') && g && g.tagName.toLowerCase()==='g'){ e.preventDefault(); select(Number(g.dataset.gcenter), true); }
  });
}

/* =========================================================================
   연결된 업무 (v3.7.0) — 순수 모듈(상태·DOM 없음).
   업무 하나를 열면 그 업무와 엮인 업무를 **관계도(그래프)** 로 보여준다(소유자 지정).
     가운데 = 지금 업무 · 안쪽 고리 = 엮은 고리(같은 관련인 / 같은 식별정보 / 같은 주기) ·
     바깥 고리 = 엮인 업무. 선은 '업무 — 고리 — 업무' 로 이어져 무엇 때문에 엮였는지가 그림으로 보인다.

   엮임 기준(셋 중 하나라도):
     · 관련인 — 관련소속·관련인·연락처 3칸이 같은 사람(phonebook-core.entryKey, 이메일 무관)
     · 식별정보 — 명칭과 번호가 모두 같은 것(번호는 공백 무시·대소문자 무시)
     · 주기 업무 — 같은 주기 정의에서 생긴 업무끼리(recurId)
   이름만 같은 사람(동명이인)은 엮지 않는다 — 관련 업무 팝업(v3.1.1)과 같은 원칙.
   ========================================================================= */
import {entryKey} from './phonebook-core.js';

const idKey = x => `${String(x.kind||'').trim()}|${String(x.val||'').replace(/\s+/g,'').toLowerCase()}`;
const personOk = c => !!(String(c.who||'').trim() || String(c.org||'').trim()) && !!String(c.phone||'').replace(/\D/g,'');

/* it 과 엮인 업무 — [{it, why:[문구…], via:[{kind, key, label}]}], 미완료 먼저 · 최근 것 먼저. limit 개까지.
   via.kind = 'person' | 'id' | 'recur', via.key = 고리를 하나로 묶는 키(그래프의 가운데 고리 노드). */
export function linkedItems(items, it, limit=30, opts={}){
  if(!it) return [];
  const on=new Set(opts.kinds||['person','id','recur']);   // 관계도 칩으로 고리 종류를 끄고 켠다
  const myPeople=new Map((it.contacts||[]).filter(personOk).map(c=>[entryKey(c), c]));
  const myIds=new Map((it.ids||[]).filter(x=>String(x.val||'').trim()).map(x=>[idKey(x), x]));
  const myRecur=it.recurId||null;
  const out=[];
  for(const o of items||[]){
    if(!o || o.id===it.id || o.recur) continue;          // 자기 자신·주기 부모(보드 밖) 제외
    const via=[];
    const add=v=>{ if(on.has(v.kind) && !via.some(x=>x.key===v.key)) via.push(v); };
    for(const c of (o.contacts||[])){ const k=entryKey(c); const p=myPeople.get(k); if(p && personOk(c)) add({kind:'person', key:'p:'+k, label:String(p.who||p.org)}); }
    for(const x of (o.ids||[])){ const k=idKey(x); const m=myIds.get(k); if(m) add({kind:'id', key:'i:'+k, label:`${m.kind} ${m.val}`}); }
    if(myRecur && o.recurId===myRecur) add({kind:'recur', key:'r:'+myRecur, label:'같은 주기 업무'});
    if(via.length) out.push({it:o, via, why:via.map(v=>v.kind==='person'?`관련인 ${v.label}`:v.label)});
  }
  out.sort((a,b)=>(a.it.done?1:0)-(b.it.done?1:0) || ((b.it.doneAt||b.it.id)-(a.it.doneAt||a.it.id)));
  return out.slice(0, limit);
}

/* 관계도 배치 — 왼쪽에서 오른쪽으로 흐르는 3단(지금 업무 → 고리 → 엮인 업무).
   원형 배치는 고리가 가운데 선과 겹치고 이름표가 포개져 읽기 어려웠다(첫 시안) — 3단이면
   선이 교차를 거의 하지 않고 이름표가 줄 맞춰 놓인다.
   · 업무: 오른쪽 열에 위→아래로. 첫 번째로 걸린 고리 순서대로 모아 선 교차를 줄인다(같은 고리 안에선 미완료 먼저).
   · 고리: 가운데 열. 자기에게 걸린 업무들 높이의 평균에 두고(무게중심), 서로 최소 간격을 지키게 아래로 민다.
   · 지금 업무: 왼쪽 열 세로 가운데.
   반환(픽셀): {W,H, center:{x,y}, hubs:[{key,kind,label,x,y}], tasks:[{id,label,done,via,x,y}]} */
export const GRAPH = {W:900, colC:118, colH:452, colT:768, wC:216, wH:220, wT:244, rowT:40, rowH:44, pad:16, top:34};   // 근거지도식 3열(열 머리 34px)
export function graphLayout(linked, opts={}){
  const G=Object.assign({}, GRAPH, opts);
  const KIND={person:0, id:1, recur:2};
  const hubMap=new Map();
  for(const l of linked) for(const v of l.via) if(!hubMap.has(v.key)) hubMap.set(v.key, {key:v.key, kind:v.kind, label:v.label});
  const hubs=[...hubMap.values()].sort((a,b)=>(KIND[a.kind]-KIND[b.kind]) || a.label.localeCompare(b.label,'ko'));
  const hi=new Map(hubs.map((h,i)=>[h.key,i]));
  const tasks=linked.map((l,ord)=>({id:l.it.id, label:String(l.it.memo||'').split('\n')[0]||'(메모 없음)', done:!!l.it.done,
    via:l.via.map(v=>v.key), first:Math.min(...l.via.map(v=>hi.get(v.key))), ord}));
  tasks.sort((a,b)=>(a.first-b.first) || ((a.done?1:0)-(b.done?1:0)) || (a.ord-b.ord));
  const body=Math.max(120, tasks.length*G.rowT, hubs.length*G.rowH)+G.pad*2;
  const H=body+G.top;
  const top=G.top+(body-tasks.length*G.rowT)/2+G.rowT/2;
  tasks.forEach((t,i)=>{ t.x=G.colT; t.y=top+i*G.rowT; });
  /* 고리 높이 = 걸린 업무 높이 평균 → 최소 간격으로 아래로 밀고, 넘치면 전체를 위로 당긴다 */
  hubs.forEach(h=>{ const ys=tasks.filter(t=>t.via.includes(h.key)).map(t=>t.y); h.x=G.colH; h.y=ys.reduce((a,b)=>a+b,0)/ys.length; });
  for(let i=1;i<hubs.length;i++) if(hubs[i].y<hubs[i-1].y+G.rowH) hubs[i].y=hubs[i-1].y+G.rowH;
  const over=hubs.length ? hubs[hubs.length-1].y-(H-G.pad-G.rowH/2) : 0;
  const floorY=G.top+G.pad+G.rowH/2;
  if(over>0) hubs.forEach(h=>{ h.y-=over; });
  for(let i=hubs.length-2;i>=0;i--) if(hubs[i].y>hubs[i+1].y-G.rowH) hubs[i].y=hubs[i+1].y-G.rowH;
  if(hubs.length && hubs[0].y<floorY){ const d=floorY-hubs[0].y; hubs.forEach(h=>{ h.y+=d; }); }
  return {W:G.W, H, top:G.top, center:{x:G.colC, y:G.top+body/2}, hubs, tasks};
}

/* 업무별 '엮인 업무 수' — 관계도 탭 목록용. linkedItems 를 업무마다 부르면 n² 이라(업무 2천 건이면
   4백만 번 비교) 고리 키 → 업무 집합 색인을 한 번 만들어 센다. 결과는 linkedItems(…).length 와 같다. */
export function linkCounts(items, opts={}){
  const on=new Set(opts.kinds||['person','id','recur']);
  const idx=new Map();                                   // 고리 키 → Set(업무 id)
  const keysOf=new Map();                                // 업무 id → 고리 키 목록
  const put=(k,id)=>{ let s=idx.get(k); if(!s){ s=new Set(); idx.set(k,s); } s.add(id); };
  for(const it of items||[]){
    if(!it || it.recur) continue;
    const ks=new Set();
    if(on.has('person')) for(const c of (it.contacts||[])) if(personOk(c)) ks.add('p:'+entryKey(c));
    if(on.has('id')) for(const x of (it.ids||[])) if(String(x.val||'').trim()) ks.add('i:'+idKey(x));
    if(on.has('recur') && it.recurId) ks.add('r:'+it.recurId);
    keysOf.set(it.id, ks); ks.forEach(k=>put(k,it.id));
  }
  const out=new Map();
  for(const [id, ks] of keysOf){
    const seen=new Set();
    ks.forEach(k=>idx.get(k).forEach(o=>{ if(o!==id) seen.add(o); }));
    out.set(id, seen.size);
  }
  return out;
}

/* 전체 색인 — 관계도 탭의 칩·연결 목록·전체 지도가 한 번에 쓴다(업무마다 linkedItems 를 부르면 n²).
   hubs: 키 → {key, kind, label, ids:Set} (업무 2건 이상이 걸린 '진짜 고리'만)
   keysOf: 업무 id → 그 업무가 걸린 진짜 고리 키 목록 */
export function linkIndex(items, opts={}){
  const on=new Set(opts.kinds||['person','id','recur']);
  const all=new Map(), keysOf=new Map();
  const put=(key,kind,label,id)=>{ let h=all.get(key); if(!h){ h={key,kind,label,ids:new Set()}; all.set(key,h); } h.ids.add(id); return key; };
  for(const it of items||[]){
    if(!it || it.recur) continue;
    const ks=new Set();
    if(on.has('person')) for(const c of (it.contacts||[])) if(personOk(c)) ks.add(put('p:'+entryKey(c),'person',String(c.who||c.org).trim(),it.id));
    if(on.has('id')) for(const x of (it.ids||[])) if(String(x.val||'').trim()) ks.add(put('i:'+idKey(x),'id',`${x.kind} ${x.val}`,it.id));
    if(on.has('recur') && it.recurId) ks.add(put('r:'+it.recurId,'recur','같은 주기 업무',it.id));
    keysOf.set(it.id, [...ks]);
  }
  const hubs=new Map([...all].filter(([,h])=>h.ids.size>1));
  for(const [id,ks] of keysOf) keysOf.set(id, ks.filter(k=>hubs.has(k)));
  return {hubs, keysOf};
}

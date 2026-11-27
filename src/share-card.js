/* =========================================================================
   업무 공유 메모지 — "무엇을 실을지" 정하는 순수 모듈(상태·DOM·Tauri 없음).
   그리기(미리 보기 창·그림 만들기)는 share.js 가 하고, 여기서는
     shareModel(업무, 맥락)  → 칸 목록(순서·빈 칸 빼기·접기·"외 N명" 표시)
     shareHtml(모델)         → 메모지 마크업(미리 보기와 나가는 그림이 같은 한 벌을 쓴다)
     shareText(업무, 맥락)   → [글자로 복사]의 글(접지 않고 전부)
   를 만든다. 설계: 총괄 docs/뭐하려-했더라-공유-메모지-설계.md (2026-11-27).

   소유자가 정한 것: 칸 순서는 업무 양식과 같게(메모 → 하위 업무 → 접수시각·기한 → 식별정보 → 관련소속·관련인),
   파일·폴더 링크는 싣지 않는다, 길면 접는다. 아래 SHARE_LIMITS 는 총괄 추천값 — 소유자가 바꿀 수 있게 한곳에 모았다.
   ========================================================================= */
import {sectionTitle} from './memo-sections.js';

/* 접는 기준(총괄 추천값). 설정 항목은 만들지 않는다. */
export const SHARE_LIMITS={
  people:2,        // 관련인 — 이만큼 보이고 나머지는 "외 N명"
  memoLines:6,     // 메모 본문(제목 줄 다음, 첫 구역 전) — 줄 수는 그림 폭에서 접혀 보이는 줄로 어림한다
  secLines:3,      // 구역([제목]) 하나
  subsOpen:3,      // 하위 업무 — 이보다 많으면 남은 것 3개만, 끝낸 것은 모두 접음
  ids:3,           // 식별정보
  cpl:38,          // 그림 한 줄에 드는 한글 글자 수 어림(13px 한글 11.2px · 글 칸 442px → 39, 띄어쓰기에서 끊기는 몫을 덜어 38)
  /* 모두 펼쳐도 그림이 지나치게 커지지 않게 하는 위 한도(설계서 9-5). 넘는 것은 그림에 싣지 않고 수를 적는다 — [글자로 복사]에는 다 실린다 */
  max:{memoLines:60, people:25, subs:25, ids:10},   // 모두 펼쳐도 그림 높이 CSS 3천 px 안팎(2.5배로 7~8천 px) — 만드는 데 몇 초 안

};

const DOW=['일','월','화','수','목','금','토'];
const p2=n=>String(n).padStart(2,'0');
const toDate=v=>{ if(v==null||v==='') return null; const d=v instanceof Date?v:new Date(v); return isNaN(d)?null:d; };
/* 2026/11/28 (금) 14:00 */
export function fmtLong(v){ const d=toDate(v); return d?`${d.getFullYear()}/${p2(d.getMonth()+1)}/${p2(d.getDate())} (${DOW[d.getDay()]}) ${p2(d.getHours())}:${p2(d.getMinutes())}`:''; }
/* 11/27(목) 16:00 — 하위 업무 일시(양식·카드와 같은 꼴) */
export function fmtShort(v){ const d=toDate(v); return d?`${d.getMonth()+1}/${d.getDate()}(${DOW[d.getDay()]}) ${p2(d.getHours())}:${p2(d.getMinutes())}`:''; }
/* 2026/11/27 15:20 — 머리의 '기준'·완료 시각 */
export function fmtStamp(v){ const d=toDate(v); return d?`${d.getFullYear()}/${p2(d.getMonth()+1)}/${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`:''; }
/* 뭐하려했더라_공유_20261127_1520.png */
export function shareFileName(v){ const d=toDate(v)||new Date(); return `뭐하려했더라_공유_${d.getFullYear()}${p2(d.getMonth()+1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}.png`; }

/* 임박 — 앱의 시각칩과 같은 조건(datetime.js fmtDue: 지남~2시간 이내). 완료한 업무는 임박으로 치지 않는다 */
export function isImminent(v, now, done){
  const d=toDate(v), n=toDate(now); if(!d||!n||done) return false;
  return Math.round((d-n)/60000)<=120;
}

/* 한 줄이 그림에서 몇 줄로 접혀 보이는가(어림). 한글 한 글자 = 1 로 친 폭 — Pretendard 13px 실측(Edge, 2026-11-27):
   한글 11.2px · 영문 대문자 8.3 · 숫자 7.6 · 소문자 6.6 · 문장부호 4.0 · 공백 3.3 */
function cw(c){
  if(c===32) return 0.3;
  if(c>=48 && c<=57) return 0.68;
  if(c>=65 && c<=90) return 0.74;
  if(c>=97 && c<=122) return 0.6;
  if(c<0x1100) return 0.45;
  return 1;
}
function units(s){ let u=0; for(const ch of String(s)) u+=cw(ch.codePointAt(0)); return u; }
export function visualLines(line, cpl=SHARE_LIMITS.cpl){ return Math.max(1, Math.ceil(units(line)/cpl)); }
/* units 가 n 을 넘지 않는 앞부분 */
function cutUnits(s, n){ let u=0, out=''; for(const ch of String(s)){ const w=units(ch); if(u+w>n) break; u+=w; out+=ch; } return out; }

/* 줄 묶음을 budget(어림 줄 수)까지만 싣는다. → {lines, hidden(어림 줄 수), cut(마지막 줄을 잘랐나)} */
export function foldLines(lines, budget, cpl=SHARE_LIMITS.cpl){
  const out=[]; let used=0, i=0, cut=false;
  for(; i<lines.length; i++){
    const n=visualLines(lines[i], cpl);
    if(used+n<=budget){ out.push(lines[i]); used+=n; continue; }
    const room=budget-used;
    if(room>0 && units(lines[i])>0){ out.push(cutUnits(lines[i], room*cpl-1).replace(/\s+$/,'')+'…'); used+=room; cut=true; i++; }
    break;
  }
  const total=lines.reduce((a,l)=>a+visualLines(l,cpl),0);
  return {lines:out, hidden:Math.max(0,total-used), cut};
}

/* 앞뒤 빈 줄을 떼고 줄 끝 공백을 지운다 */
function trimBlock(lines){
  const a=lines.map(l=>l.replace(/\s+$/,''));
  while(a.length && !a[0].trim()) a.shift();
  while(a.length && !a[a.length-1].trim()) a.pop();
  return a;
}

/* 메모 → {title, body:[줄], sections:[{name, lines}]}.
   첫 글 줄(앞의 빈 줄 건너뜀)이 제목 구실 — 친 글자 그대로 굵게(그 줄이 [제목]이어도 이름표로 바꾸지 않는다, 소유자 지정).
   그 뒤 한 줄이 통째로 [제목]인 줄이 구역 이름표, 그 아래 줄들이 구역 본문. */
export function splitMemo(memo){
  const lines=String(memo??'').replace(/\r\n?/g,'\n').split('\n');
  let i=0; while(i<lines.length && !lines[i].trim()) i++;
  if(i>=lines.length) return {title:'', body:[], sections:[]};
  const title=lines[i].trim();
  const body=[], sections=[]; let cur=null;
  for(let k=i+1;k<lines.length;k++){
    const name=sectionTitle(lines[k]);
    if(name!==null){ cur={name, lines:[]}; sections.push(cur); continue; }
    (cur?cur.lines:body).push(lines[k]);
  }
  return {title, body:trimBlock(body), sections:sections.map(s=>({name:s.name, lines:trimBlock(s.lines)}))};
}

/* 공유 메모지에 실을 칸 목록.
   d   : 양식에 지금 보이는 내용(form.js collectForm 꼴 — {memo, f, contacts, ids, subs})
   ctx : {now, fields:[{key,label}](양식에 보이는 순서), done, doneAt, withContacts, open:Set(펼친 칸 열쇠)}
   열쇠: 'memo'(메모 본문) · 'sec:N'(N번째 구역) · 'subs' · 'ids' · 'people' */
export function shareModel(d, ctx){
  d=d||{}; ctx=ctx||{};
  const L=SHARE_LIMITS, open=ctx.open instanceof Set ? ctx.open : new Set(ctx.open||[]);
  const blocks=[]; let folded=false;
  /* 접을 수 있는 칸이면 {key, open, label}. label = 그림에 싣지 못한 것의 수("외 N명" 등, 다 실렸으면 '').
     펼쳤는데도 위 한도(max)에 걸려 남은 것이 있으면 글자로 복사에는 다 실린다고 덧붙인다 */
  const mk=(key, foldable, isOpen, hidden)=>{
    if(!foldable) return null;
    if(hidden) folded=true;
    return {key, open:isOpen, label: hidden ? hidden+(isOpen?' · 글자로 복사에는 다 실림':'') : ''};
  };
  /* 메모의 위 한도(max.memoLines)는 본문과 구역 전체가 나눠 쓴다 — 구역이 많아도 메모 칸 전체가 그 줄 수를 넘지 않게 */
  let memoUsed=0;
  const lineMore=(key, src, budget)=>{
    const isOpen=open.has(key), f=foldLines(src, isOpen?Math.max(0, L.max.memoLines-memoUsed):budget);
    memoUsed+=f.lines.reduce((a,l)=>a+visualLines(l),0);
    return {lines:f.lines, more:mk(key, foldLines(src, budget).hidden>0, isOpen, f.hidden>0?`아래 ${f.hidden}줄 더 있음`:'')};
  };

  /* 1 메모 */
  const mm=splitMemo(d.memo);
  if(!mm.title) blocks.push({kind:'memo', empty:true, title:'', body:[], sections:[]});
  else {
    const body=lineMore('memo', mm.body, L.memoLines);
    const sections=mm.sections.map((s,n)=>({name:s.name, ...lineMore('sec:'+n, s.lines, L.secLines)}));
    blocks.push({kind:'memo', empty:false, title:mm.title, body:body.lines, more:body.more, sections});
  }

  /* 2 하위 업무 — 양식의 줄 순서. 많으면(SHARE_LIMITS.subsOpen 초과) 남은 것만 앞에서부터, 끝낸 것은 모두 접음 */
  const subs=(d.subs||[]).filter(s=>s && String(s.title||'').trim());
  if(subs.length){
    const row=s=>{ const meta=[String(s.owner||'').trim(), fmtShort(s.mid)].filter(Boolean).join(' · ');
      return {title:String(s.title).trim(), done:!!s.done, meta}; };
    const doneN=subs.filter(s=>s.done).length, isOpen=open.has('subs');
    let rows, label='';
    if(subs.length<=L.subsOpen) rows=subs.map(row);
    else if(isOpen){
      rows=subs.slice(0,L.max.subs).map(row);
      const rest=subs.length-rows.length; if(rest>0) label=`외 ${rest}개`;
    } else {
      const left=subs.filter(s=>!s.done);
      rows=left.slice(0,L.subsOpen).map(row);
      const restLeft=left.length-rows.length;
      label=[restLeft>0?`외 ${restLeft}개`:'', doneN?`끝낸 것 ${doneN}개 접음`:''].filter(Boolean).join(' · ');
    }
    blocks.push({kind:'subs', total:subs.length, doneN, rows, more:mk('subs', subs.length>L.subsOpen, isOpen, label)});
  }

  /* 3 접수시각 · 기한 (+ 양식에 보이는 사용자 칸) — 값이 있는 칸만, 양식의 순서로. 둘 다(모두) 없으면 싣지 않음. 늘 다 보인다 */
  const fields=(ctx.fields&&ctx.fields.length)?ctx.fields:[{key:'received',label:'접수시각'},{key:'due',label:'기한'}];
  const cells=fields.map(f=>{ const v=(d.f||{})[f.key]; const s=fmtLong(v);
    return s?{label:f.label, value:s, strong:f.key==='due', imminent:f.key==='due' && isImminent(v, ctx.now, ctx.done)}:null; }).filter(Boolean);
  if(cells.length) blocks.push({kind:'times', cells});

  /* 4 식별정보 */
  const ids=(d.ids||[]).filter(x=>x && String(x.val||'').trim()).map(x=>({kind:String(x.kind||'').trim(), val:String(x.val).trim()}));
  if(ids.length){
    const isOpen=open.has('ids'), lim=isOpen?L.max.ids:L.ids, rows=ids.slice(0,lim), rest=ids.length-rows.length;
    blocks.push({kind:'ids', rows, more:mk('ids', ids.length>L.ids, isOpen, rest>0?`외 ${rest}개`:'')});
  }

  /* 5 관련소속 · 관련인 — 소속이 앞, 이름이 뒤(양식의 열 순서). 연락처·이메일은 스위치를 켰을 때만 */
  const people=(d.contacts||[]).filter(c=>c && (String(c.who||'').trim()||String(c.org||'').trim()||String(c.phone||'').trim()));
  if(people.length){
    const row=c=>({org:String(c.org||'').trim(), who:String(c.who||'').trim(),
      extra: ctx.withContacts ? [String(c.phone||'').trim(), String(c.email||'').trim()].filter(Boolean).join(' · ') : ''});
    const isOpen=open.has('people'), lim=isOpen?L.max.people:L.people, rows=people.slice(0,lim).map(row), rest=people.length-rows.length;
    blocks.push({kind:'people', total:people.length, rows, more:mk('people', people.length>L.people, isOpen, rest>0?`외 ${rest}명`:'')});
  }
  /* 6 파일·폴더 링크 — 싣지 않는다(내 PC 의 경로라 받는 사람이 열 수 없다) */

  const doneStamp = ctx.done && ctx.doneAt ? fmtStamp(ctx.doneAt) : '';
  return {
    head:{left:'업무 공유', stamp:fmtStamp(ctx.now), done:doneStamp},
    blocks,
    foot:{left:'뭐하려 했더라에서 공유', right:[folded?'접힌 내용 있음':'', ctx.withContacts?'파일 링크는 뺌':'연락처·이메일·파일 링크는 뺌'].filter(Boolean).join(' · ')},
    folded,
  };
}

/* ── 마크업 ───────────────────────────────────────────────────────────────
   미리 보기(DOM)와 나가는 그림(SVG foreignObject 속 XHTML)이 이 함수 하나에서 나온다.
   XHTML 로도 읽혀야 하므로: 빈 요소(<br> 등)를 쓰지 않고, &nbsp; 같은 HTML 전용 이름을 쓰지 않는다.
   controls=true 면 접힌 칸마다 [펼치기]/[접기] 단추를 넣는다(미리 보기 창에서만 — 그림에는 싣지 않는다). */
/* XML 1.0 에 못 쓰는 글자(탭·줄바꿈을 뺀 제어 문자, U+FFFE·U+FFFF, 짝 없는 서로게이트)는 뺀다 — 하나라도 있으면 SVG 를 그림으로
   읽지 못해(짝 없는 서로게이트는 data: 주소로 바꾸다 URIError) [그림 복사]·[파일로 저장]이 통째로 실패했다(워드에서 붙여 넣은 세로 탭 등).
   보이지 않는 글자라 미리 보기에서도 같이 빼 둘이 같게 둔다. (엑셀 내보내기 xlsx-export.js cleanText 와 같은 규칙) */
const XML_BAD=/[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const E=s=>String(s??'').replace(XML_BAD,'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function lines(arr){ return arr.map(l=>`<div class="shl">${l.trim()?E(l):'​'}</div>`).join(''); }
function moreChip(m){ return m && m.label ? `<div class="shc-more"><span>${E(m.label)}</span></div>` : ''; }
function foldBtn(m, controls){
  if(!controls || !m) return '';
  return `<button type="button" class="sh-fold${m.open?' open':''}" data-fold="${E(m.key)}">${m.open?'접기 ▴':'펼치기 ▾'}</button>`;
}
function head(label, m, controls, chip){ return `<div class="shc-h">${E(label)}${chip?`<span class="shc-cnt">${E(chip)}</span>`:''}${foldBtn(m, controls)}</div>`; }

export function shareHtml(model, opts){
  const controls=!!(opts&&opts.controls);
  const out=[];
  const hr=model.head;
  out.push(`<div class="shw"><div class="shc">`);
  out.push(`<div class="shc-hd"><b>${E(hr.left)}</b><span>${hr.done?`완료 ${E(hr.done)} · `:''}${E(hr.stamp)} 기준</span></div><div class="shc-bd">`);
  let first=true;
  const sec=(cls, inner)=>{ out.push(`<div class="shc-sec${first?' first':''}${cls?' '+cls:''}">${inner}</div>`); first=false; };
  for(const b of model.blocks){
    if(b.kind==='memo'){
      if(b.empty){ sec('', `${head('메모')}<div class="shc-none">(메모 없음)</div>`); continue; }
      let inner=`${head('메모', b.more, controls)}<div class="shc-title">${E(b.title)}</div>`;
      if(b.body.length) inner+=`<div class="shc-memo">${lines(b.body)}</div>`;
      inner+=moreChip(b.more);
      for(const s of b.sections){
        inner+=`<div class="shc-part">${head(s.name, s.more, controls)}${s.lines.length?`<div class="shc-memo">${lines(s.lines)}</div>`:''}${moreChip(s.more)}</div>`;
      }
      sec('', inner);
    } else if(b.kind==='subs'){
      const rows=b.rows.map(r=>`<div class="shc-sub${r.done?' d':''}"><span class="shc-chk${r.done?' on':''}"></span><span class="shc-st">${E(r.title)}</span>${r.meta?`<span class="shc-sm">${E(r.meta)}</span>`:''}</div>`).join('');
      sec('', head('하위 업무', b.more, controls, `${b.total}개 중 ${b.doneN}개 끝남`)+rows+moreChip(b.more));
    } else if(b.kind==='times'){
      sec('two', b.cells.map(c=>`<div class="shc-cell">${head(c.label)}<div class="shc-val">${c.strong?`<b class="${c.imminent?'imm':''}">${E(c.value)}</b>`:E(c.value)}</div></div>`).join(''));
    } else if(b.kind==='ids'){
      sec('', head('식별정보', b.more, controls)+`<div class="shc-kv">${b.rows.map(r=>`<span class="k">${E(r.kind)}</span><span class="v">${E(r.val)}</span>`).join('')}</div>`+moreChip(b.more));
    } else if(b.kind==='people'){
      sec('', head('관련소속 · 관련인', b.more, controls, b.total>SHARE_LIMITS.people?`${b.total}명`:'')
        +`<div class="shc-kv">${b.rows.map(r=>`<span class="k">${E(r.org)}</span><span class="v"><b>${E(r.who)}</b>${r.extra?`<small> · ${E(r.extra)}</small>`:''}</span>`).join('')}</div>`+moreChip(b.more));
    }
  }
  out.push(`</div><div class="shc-ft"><span>${E(model.foot.left)}</span><span>${E(model.foot.right)}</span></div></div></div>`);
  return out.join('');
}

/* 그림은 늘 밝은 테마로 만든다(받는 쪽 대화창 바탕을 알 수 없다 — 설계서 4절). 앱이 어두운 테마여도 이 값을 쓴다.
   값은 styles.css :root(밝게)의 토큰을 그대로 옮긴 것 — tests/unit/share-card.test.js 가 둘이 같은지 본다. */
export const SHARE_TOKENS={ink:'#131a24','ink-soft':'#687284','ink-2':'#3a4453',line:'#e0e5eb','line-soft':'#eceff3',paper:'#f2f4f7',card:'#ffffff',sunk:'#f7f8fa',focus:'#2a7c6e','chip-bg':'#eceff3','tag-imm-bg':'#fbe3dd','tag-imm-fg':'#c0392b'};
/* 메모지 모양 — 디자인 정책의 글자 크기 11·12·13·14px, 카드 모서리 12px·1px 테두리, 동그라미 체크 18px, 칸 이름 11px/600.
   단계 색 토막은 넣지 않는다(받는 사람에게 뜻이 없다). 폭은 고정: 카드 480px + 바깥 여백 16px(앱 바탕색). */
export const SHARE_W=480+16*2;
export function shareCss(fontFamily){
  const v=Object.entries(SHARE_TOKENS).map(([k,x])=>`--sh-${k}:${x}`).join(';');
  /* 글자에 닿는 성질은 모두 여기서 못 박는다 — 미리 보기(앱 문서 안)와 그림(SVG 안)이 물려받는 값이 달라 줄바꿈이 어긋나지 않게 */
  return `.shw{${v};width:${SHARE_W}px;box-sizing:border-box;padding:16px;background:var(--sh-paper);font-family:${fontFamily};color:var(--sh-ink);-webkit-font-smoothing:antialiased;
text-align:left;line-height:normal;letter-spacing:0;font-size:13px;font-weight:400;font-style:normal;white-space:normal;word-break:keep-all;overflow-wrap:anywhere;text-indent:0;text-transform:none;font-feature-settings:normal;font-variant:normal}
.shw *{box-sizing:border-box;margin:0;padding:0}
.sh-fold{flex:none;margin-left:auto;font-family:inherit;font-size:11px;font-weight:500;letter-spacing:0;line-height:16px;height:18px;padding:0 8px;border:1px solid var(--sh-line);border-radius:8px;background:var(--sh-card);color:var(--sh-ink-2);cursor:pointer}
.sh-fold:hover,.sh-fold.open{border-color:var(--sh-focus);color:var(--sh-focus)}
.shc{background:var(--sh-card);border:1px solid var(--sh-line);border-radius:12px;overflow:hidden}
.shc-hd{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:12px 18px 10px;border-bottom:1px solid var(--sh-line-soft)}
.shc-hd b{font-size:14px;font-weight:700;flex:none}
.shc-hd span{font-size:11px;color:var(--sh-ink-soft);font-variant-numeric:tabular-nums;text-align:right}
.shc-bd{padding:0 18px 14px}
.shc-sec{border-top:1px solid var(--sh-line-soft);margin:12px -18px 0;padding:10px 18px 0}
.shc-sec.first{border-top:0;margin-top:0;padding-top:12px}
.shc-sec.two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:4px 12px}
.shc-h{display:flex;align-items:center;gap:6px;min-height:18px;font-size:11px;font-weight:600;color:var(--sh-ink-soft);letter-spacing:.04em}
.shc-cnt{font-size:11px;font-weight:500;letter-spacing:0;line-height:1.6;padding:0 7px;border-radius:999px;background:var(--sh-chip-bg);color:var(--sh-ink-soft);font-variant-numeric:tabular-nums}
.shc-title{font-size:14px;font-weight:700;line-height:1.5;margin-top:4px;overflow-wrap:anywhere;white-space:pre-wrap}
.shc-memo{font-size:13px;line-height:1.6;color:var(--sh-ink-2);margin-top:2px}
.shl{white-space:pre-wrap;overflow-wrap:anywhere}
.shc-none{font-size:13px;line-height:1.6;color:var(--sh-ink-soft);margin-top:4px}
.shc-part{border-top:1px solid var(--sh-line-soft);margin-top:9px;padding-top:8px}
.shc-more{margin-top:4px}
.shc-more span{display:inline-block;font-size:11px;font-weight:500;line-height:1.7;padding:0 8px;border-radius:999px;background:var(--sh-chip-bg);color:var(--sh-ink-soft)}
.shc-sub{display:flex;align-items:flex-start;gap:8px;padding:3px 0;margin-top:2px}
.shc-chk{position:relative;flex:none;width:18px;height:18px;margin-top:1px;border:1.6px solid var(--sh-line);border-radius:50%;background:var(--sh-card)}
.shc-chk.on{background:var(--sh-focus);border-color:var(--sh-focus)}
.shc-chk.on::after{content:"";position:absolute;left:5px;top:1.5px;width:4px;height:8px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg)}
.shc-st{flex:1;min-width:0;font-size:13px;line-height:1.55;overflow-wrap:anywhere}
.shc-sub.d .shc-st{color:var(--sh-ink-soft);text-decoration:line-through}
.shc-sm{flex:none;max-width:52%;font-size:12px;line-height:1.7;color:var(--sh-ink-soft);font-variant-numeric:tabular-nums;text-align:right;overflow-wrap:anywhere}
.shc-val{font-size:13px;line-height:1.6;margin-top:4px;font-variant-numeric:tabular-nums}
.shc-val b{font-weight:700}
.shc-val b.imm{color:var(--sh-tag-imm-fg);background:var(--sh-tag-imm-bg);border-radius:999px;padding:1px 7px;margin-left:-7px}
.shc-kv{display:grid;grid-template-columns:minmax(0,110px) minmax(0,1fr);gap:2px 10px;font-size:13px;line-height:1.6;margin-top:4px;font-variant-numeric:tabular-nums}
.shc-kv .k{color:var(--sh-ink-soft);overflow-wrap:anywhere}
.shc-kv .v{overflow-wrap:anywhere}
.shc-kv b{font-weight:600}
.shc-kv small{font-size:12px;color:var(--sh-ink-soft)}
.shc-ft{display:flex;justify-content:space-between;gap:12px;padding:7px 18px 8px;background:var(--sh-sunk);border-top:1px solid var(--sh-line-soft);font-size:11px;color:var(--sh-ink-soft)}
.shc-ft span:last-child{text-align:right}`;
}

/* ── [글자로 복사] ─────────────────────────────────────────────────────────
   접지 않고 전부 싣는다(글자는 길어도 받는 쪽에서 내려 읽으면 되고, 접으면 빠진 줄 모르고 넘어가기 쉽다). 설계서 6절의 꼴. */
export function shareText(d, ctx){
  d=d||{}; ctx=ctx||{};
  const out=[], push=(...a)=>out.push(...a);
  const blank=()=>{ if(out.length && out[out.length-1]!=='') out.push(''); };
  const stamp=fmtStamp(ctx.now), done=ctx.done&&ctx.doneAt?fmtStamp(ctx.doneAt):'';
  push(`[업무 공유] ${stamp} 기준${done?` · 완료 ${done}`:''}`);
  const mm=splitMemo(d.memo);
  if(!mm.title) push('(메모 없음)');
  else {
    push(mm.title, ...mm.body);
    for(const s of mm.sections){ blank(); push(`■ ${s.name}`, ...s.lines); }
  }
  const subs=(d.subs||[]).filter(s=>s && String(s.title||'').trim());
  if(subs.length){
    blank(); push(`■ 하위 업무 (${subs.length}개 중 ${subs.filter(s=>s.done).length}개 끝남)`);
    for(const s of subs){ const meta=[String(s.owner||'').trim(), fmtShort(s.mid)].filter(Boolean).join(' · ');
      push(`${s.done?'✓':'□'} ${String(s.title).trim()}${meta?` — ${meta}`:''}`); }
  }
  const fields=(ctx.fields&&ctx.fields.length)?ctx.fields:[{key:'received',label:'접수시각'},{key:'due',label:'기한'}];
  const times=fields.map(f=>{ const s=fmtLong((d.f||{})[f.key]); return s?`■ ${f.label} ${s}`:null; }).filter(Boolean);
  const ids=(d.ids||[]).filter(x=>x && String(x.val||'').trim()).map(x=>`${String(x.kind||'').trim()} ${String(x.val).trim()}`.trim());
  const people=(d.contacts||[]).filter(c=>c && (String(c.who||'').trim()||String(c.org||'').trim()||String(c.phone||'').trim())).map(c=>{
    const base=[String(c.org||'').trim(), String(c.who||'').trim()].filter(Boolean).join(' ');
    const extra=ctx.withContacts?[String(c.phone||'').trim(), String(c.email||'').trim()].filter(Boolean).join(' · '):'';
    return base+(extra?(base?' · ':'')+extra:''); }).filter(Boolean);
  if(times.length||ids.length||people.length) blank();
  push(...times);
  const list=(name, arr)=>{ if(!arr.length) return; if(arr.length===1) push(`■ ${name} ${arr[0]}`); else push(`■ ${name}`, ...arr.map(x=>`  ${x}`)); };
  list('식별정보', ids);
  list('관련소속 · 관련인', people);
  return out.join('\n').replace(/\n+$/,'');
}

/* =========================================================================
   전화번호부 — 순수 로직 (v2.7.0).
   상태·DOM·Tauri 접근 없음: 필터·중복 판정·@ 토큰 파싱·엑셀 행 매핑만 둔다.
   theme.js 와 같은 '순수 모듈'이라 미니 캡처 창(capture-win.js)에서도 import
   가능하다 — 캡처 창의 "메인 모듈 import 금지" 규칙은 최상위 부작용·이중
   모듈 상태가 이유인데, 이 파일은 둘 다 없다(추가할 때도 없어야 한다).
   ========================================================================= */

/* 전화번호 숫자만 — 010-1234-5678 저장분이 01012345678 검색에 걸리게 (filters.js 규칙과 동일) */
export function phoneDigits(p){ return String(p||'').replace(/[^0-9]/g,''); }

/* 한 건 정규화 — 문자열 강제 + trim (id 는 호출부가 채운다: newId 는 상태 모듈 소관) */
export function normEntry(e){
  e=e||{};
  return {id:e.id, who:String(e.who||'').trim(), org:String(e.org||'').trim(), phone:String(e.phone||'').trim()};
}

/* 중복 판정 키 — 이름·소속은 trim 그대로, 전화는 숫자만 비교(표기 차이 무시) */
export function entryKey(e){ return `${String(e.who||'').trim()}|${String(e.org||'').trim()}|${phoneDigits(e.phone)}`; }

/* 아이템들의 관련인(contacts) 중 전화번호부에 아직 없는 것만 모은다 —
   [아이템에서 가져오기]용. 자기들끼리도 중복 제거. id 는 없는 채로 돌려준다. */
export function gatherFromItems(items, existing){
  const seen=new Set((existing||[]).map(entryKey));
  const out=[];
  for(const it of (items||[])){
    for(const c of (it.contacts||[])){
      const e=normEntry(c);
      if(!(e.who||e.org||e.phone)) continue;
      const k=entryKey(e);
      if(seen.has(k)) continue;
      seen.add(k); out.push(e);
    }
  }
  return out;
}

/* 검색 — 이름·소속·전화(숫자만 버전 포함) 부분일치, limit 건까지.
   빈 검색어는 빈 목록(@ 뒤 한 글자부터 검색 — 미니 창 phonebook_search 와 동일 규칙). */
export function matchEntries(list, q, limit=8){
  q=String(q||'').trim().toLowerCase();
  if(!q) return [];
  const out=[];
  for(const e of (list||[])){
    const hay=`${e.who||''} ${e.org||''} ${e.phone||''} ${phoneDigits(e.phone)}`.toLowerCase();
    if(hay.includes(q)){ out.push(e); if(out.length>=limit) break; }
  }
  return out;
}

/* 메모에 삽입되는 문자열 — 김철수(○○세무서 010-1234-5678) 꼴.
   빈 필드는 자연스럽게 빠진다: 이름만→이름, 이름 없이 소속·전화만→소속(전화). */
export function entryLabel(e){
  e=e||{};
  const who=String(e.who||'').trim(), org=String(e.org||'').trim(), phone=String(e.phone||'').trim();
  const head=who || org;                                        // 이름이 없으면 소속이 머리로 나간다
  const paren=[who?org:'', phone].filter(Boolean).join(' ');
  if(!head) return phone;
  return paren ? `${head}(${paren})` : head;
}

/* 메모에 남는 @태그 텍스트 — @김철수 (이름 없으면 소속, 그것도 없으면 번호) */
export function tagText(e){
  e=e||{};
  return '@'+(String(e.who||'').trim() || String(e.org||'').trim() || String(e.phone||'').trim());
}

/* 이스케이프된 메모 HTML 의 @태그를 클릭 가능한 span 으로 감싼다 (render.js 카드용).
   줄 시작·공백 뒤 @만, '(' 앞까지만 태그로 본다 — 바로 입력의 "@김철수(행정과 010…)" 는
   이름 부분만 태그가 되고 괄호 정보는 평문으로 남는다. 꼬리 문장부호는 태그 밖으로.
   입력이 esc() 를 거친 뒤라 &·<·>·" 는 엔티티(&…;)로 존재한다 — 문자 집합에서 &를
   제외하므로 엔티티를 관통해 태그가 이어지지 않고, data-at 속성 주입도 불가능하다. */
export function linkifyAt(escaped){
  return String(escaped||'').replace(/(^|\s)@([^\s@&<>"'(]{1,30})/g,(m,pre,raw)=>{
    const name=raw.replace(/[.,;:!?·)\]]+$/,'');
    if(!name) return m;
    return `${pre}<span class="at-tag" data-at="${name}">@${name}</span>${raw.slice(name.length)}`;
  });
}

/* @태그 클릭 → 관련 업무 검색 (소유자 지정: 이름 OR 연락처 — 아이템에 이름만
   적었거나 연락처만 적었을 수 있어서). 이름은 관련인·관련소속·메모 본문에서,
   연락처는 관련인 연락처(숫자만 비교)에서 찾는다. 미완료 먼저, 최신순. */
export function relatedItems(items, {name, phones}={}){
  name=String(name||'').trim();
  phones=(phones||[]).map(phoneDigits).filter(Boolean);
  const out=[];
  for(const it of (items||[])){
    if(it.recur) continue;                       // 주기 부모는 보드 밖 — 목록에서 제외
    const cs=it.contacts||[];
    const byName = !!name && (
      cs.some(c=>String(c.who||'').includes(name)||String(c.org||'').includes(name))
      || String(it.memo||'').includes(name));
    const byPhone = !!phones.length && cs.some(c=>phones.includes(phoneDigits(c.phone)));
    if(byName||byPhone) out.push(it);
  }
  return out.sort((a,b)=>(a.done?1:0)-(b.done?1:0) || b.id-a.id);
}

/* 커서 앞의 @토큰 — {start, query} 또는 null.
   @ 는 줄 시작이나 공백 뒤에서만 트리거(이메일 주소 한가운데 @ 는 무시),
   토큰은 공백·@ 없는 1~30자. 커서가 토큰 끝에 있을 때만 활성. */
export function atToken(text, caret){
  text=String(text||''); caret=Math.max(0, Math.min(Number(caret)||0, text.length));
  const before=text.slice(0, caret);
  const m=/(^|[\s])@([^\s@]{0,30})$/.exec(before);
  if(!m) return null;
  const start=caret - m[2].length - 1;          // '@' 위치
  return {start, query:m[2]};
}

/* @토큰을 선택한 항목의 라벨로 치환 — {text, caret} */
export function applyInsert(text, caret, start, label){
  text=String(text||'');
  const next=text.slice(0,start) + label + text.slice(caret);
  return {text:next, caret:start + label.length};
}

/* 엑셀 행(header:1 배열의 배열) → 전화번호부 후보.
   앞쪽 몇 줄에서 헤더(이름/소속/전화 계열 단어)를 찾아 열을 매핑한다.
   이름·전화 중 하나도 못 찾으면 null(형식 안내는 호출부 몫).
   숫자 셀은 문자열화(엑셀이 전화번호를 숫자로 저장해 앞 0 이 빠졌을 수 있음 — 그대로 둔다). */
export function mapSheetRows(rows){
  rows=Array.isArray(rows)?rows:[];
  const RX={who:/이름|성명|관련인|담당/, org:/소속|기관|부서|회사|팀/, phone:/전화|연락처|휴대|핸드폰|폰/};
  const probe=r=>{
    const cells=(rows[r]||[]).map(c=>String(c==null?'':c));
    const found={who:-1, org:-1, phone:-1};
    cells.forEach((c,i)=>{ for(const k of ['who','org','phone']) if(found[k]<0 && RX[k].test(c)) found[k]=i; });
    return {found, hits:['who','org','phone'].filter(k=>found[k]>=0).length};
  };
  /* 2개 이상 맞는 줄을 우선 — "연락처 목록" 같은 제목 줄(1개 일치)이 진짜
     헤더보다 위에 있어도 오인하지 않게. 없으면 1개 일치 줄로 폴백. */
  let head=-1, col={who:-1, org:-1, phone:-1};
  const top=Math.min(rows.length,5);
  for(let r=0; r<top && head<0; r++){ const p=probe(r); if(p.hits>=2){ head=r; col=p.found; } }
  for(let r=0; r<top && head<0; r++){ const p=probe(r); if(p.hits>=1){ head=r; col=p.found; } }
  if(head<0) return null;
  const seen=new Set(), entries=[];
  for(let r=head+1; r<rows.length; r++){
    const row=rows[r]||[];
    const pick=i=>i>=0?String(row[i]==null?'':row[i]).trim():'';
    const e={who:pick(col.who), org:pick(col.org), phone:pick(col.phone)};
    if(!(e.who||e.org||e.phone)) continue;
    const k=entryKey(e);
    if(seen.has(k)) continue;
    seen.add(k); entries.push(e);
  }
  return {entries, cols:col};
}

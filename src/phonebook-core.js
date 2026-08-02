/* =========================================================================
   전화번호부 — 순수 로직 (v2.7.0).
   상태·DOM·Tauri 접근 없음: 필터·중복 판정·@ 토큰 파싱·엑셀 행 매핑만 둔다.
   theme.js 와 같은 '순수 모듈'이라 미니 캡처 창(capture-win.js)에서도 import
   가능하다 — 캡처 창의 "메인 모듈 import 금지" 규칙은 최상위 부작용·이중
   모듈 상태가 이유인데, 이 파일은 둘 다 없다(추가할 때도 없어야 한다).
   ========================================================================= */

/* 전화번호 숫자만 — 010-1234-5678 저장분이 01012345678 검색에 걸리게 (filters.js 규칙과 동일) */
export function phoneDigits(p){ return String(p||'').replace(/[^0-9]/g,''); }

/* 한국 전화번호 표준 하이픈 표기 (v3.2.0 소유자 지정 — 하나의 전화번호 체계).
   원칙: **확실히 인식되는 번호만 바꾸고, 나머지는 원문 그대로**(보수적 파서 —
   내선·교환 표기, 국제번호, 접두/자리수 규칙 밖은 손대지 않아 유실이 없다).
   숫자와 흔한 구분자(하이픈·공백·점·괄호)만으로 이뤄진 입력을 숫자로 접고,
   접두·자리수 규칙으로 분류해 표준형으로 편다:
   - 휴대폰 01X: 11자리 3-4-4 / 10자리 3-3-4 (구형)
   - 서울 02: 10자리 2-4-4 / 9자리 2-3-4
   - 지역 0XX(031~064)·070: 11자리 3-4-4 / 10자리 3-3-4
   - 안심 050X: 12자리 4-4-4 / 11자리 4-3-4
   - 전국대표·공통 15XX/16XX/18XX: 8자리 4-4 */
export function formatPhone(raw){
  const s=String(raw||'').trim();
  if(!s) return '';
  if(!/^[\d\-\s().·]+$/.test(s)) return s;   // 내선·문자(+국제 포함) 등 — 원문 유지
  const d=s.replace(/[^0-9]/g,'');
  const cut=(a,b)=>`${d.slice(0,a)}-${d.slice(a,a+b)}-${d.slice(a+b)}`;
  if(/^01[016789]/.test(d)){
    if(d.length===11) return cut(3,4);
    if(d.length===10) return cut(3,3);
  }else if(/^02/.test(d)){
    if(d.length===10) return cut(2,4);
    if(d.length===9)  return cut(2,3);
  }else if(/^0(3[123]|4[1234]|5[12345]|6[1234]|70)/.test(d)){
    if(d.length===11) return cut(3,4);
    if(d.length===10) return cut(3,3);
  }else if(/^050\d/.test(d)){
    if(d.length===12) return cut(4,4);
    if(d.length===11) return cut(4,3);
  }else if(/^1[568]\d\d$/.test(d.slice(0,4)) && d.length===8){
    return `${d.slice(0,4)}-${d.slice(4)}`;
  }
  return s;                                     // 규칙 밖 자리수 — 원문 유지
}

/* 한 건 정규화 — 문자열 강제 + trim (id 는 호출부가 채운다: newId 는 상태 모듈 소관).
   v3.2.0: 연락처는 표준 하이픈 표기로 정규화(formatPhone — 인식 못 하면 원문). */
export function normEntry(e){
  e=e||{};
  return {id:e.id, who:String(e.who||'').trim(), org:String(e.org||'').trim(), phone:formatPhone(e.phone)};
}

/* 중복 판정 키 — 이름·소속은 trim 그대로, 전화는 숫자만 비교(표기 차이 무시) */
export function entryKey(e){ return `${String(e.who||'').trim()}|${String(e.org||'').trim()}|${phoneDigits(e.phone)}`; }

/* 전화번호부 입력 자격(v2.9.0 소유자 지정): 소속·이름·연락처 **3칸 완비**.
   메모는 자유 형식이지만 전화번호부는 "명함 한 장"만 받는다 — 일부만 아는
   관련인은 메모에 적는다. 모든 입력 경로(직접·엑셀·가져오기·자동 연동) 공통. */
export function isComplete(e){
  e=e||{};
  return !!(String(e.who||'').trim() && String(e.org||'').trim() && phoneDigits(e.phone));
}

/* 아이템들의 관련인(contacts) 중 전화번호부에 아직 없는 것만 모은다 —
   [아이템에서 가져오기]용. 자기들끼리도 중복 제거. id 는 없는 채로 돌려준다.
   v2.9.0: 3칸 완비 관련인만(전화번호부 입력 자격). */
export function gatherFromItems(items, existing){
  const seen=new Set((existing||[]).map(entryKey));
  const out=[];
  for(const it of (items||[])){
    for(const c of (it.contacts||[])){
      const e=normEntry(c);
      if(!isComplete(e)) continue;
      const k=entryKey(e);
      if(seen.has(k)) continue;
      seen.add(k); out.push(e);
    }
  }
  return out;
}

/* 자동완성을 열 만큼 검색어가 익었는가 (v2.10.0 소유자 지정 문턱값).
   - 숫자(전화)형: 3자리 이상, 단 '010'(모든 휴대전화의 공통 접두)은 제외 —
     010 만 쳐도 전부 매칭돼 소음이 되던 문제.
   - 글자(이름)형: 2글자 이상 — '김' 한 글자로 온 동네 김씨가 뜨지 않게. */
export function queryReady(q){
  q=String(q||'').trim();
  if(!q) return false;
  if(/^[\d\-\s]+$/.test(q)){                  // 숫자·하이픈만 = 전화번호 검색
    const d=phoneDigits(q);
    return d.length>=3 && d!=='010';
  }
  return q.length>=2;
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

/* 이스케이프된 메모 HTML 의 @태그를 span 으로 감싼다 (render.js 카드용).
   줄 시작·공백 뒤 @만, '(' 앞까지만 태그로 본다. 꼬리 문장부호는 태그 밖으로.
   입력이 esc() 를 거친 뒤라 &·<·>·" 는 엔티티(&…;)로 존재한다 — 문자 집합에서 &를
   제외하므로 엔티티를 관통해 태그가 이어지지 않고, data-at 속성 주입도 불가능하다.
   v2.11.0(소유자 지정): book 을 주면 **전화번호부에 실존하는 관련인의 태그만** 감싼다 —
   @우성균 에서 '균'만 지워 @우성 이 되면 더는 태그가 아니다(색·칩 모두 해제). */
export function linkifyAt(escaped, book){
  return String(escaped||'').replace(/(^|\s)@([^\s@&<>"'(]{1,30})/g,(m,pre,raw)=>{
    const name=raw.replace(/[.,;:!?·)\]]+$/,'');
    if(!name) return m;
    if(book!==undefined && !entriesForTag(book, name).length) return m;   // 실존 관련인만 태그
    return `${pre}<span class="at-tag" data-at="${name}">@${name}</span>${raw.slice(name.length)}`;
  });
}

/* 전화번호부 항목과 엮인 업무 (v3.1.1 소유자 지정 — 기준은 **하나뿐**이다).
   업무의 관련인 중 **관련소속·관련인·연락처 세 칸이 그 전화번호부 항목과 모두 같은**
   사람이 있을 때만 엮인 것으로 본다(연락처는 숫자만 비교 — 하이픈·공백 무관).
   - v3.0.2 까지 있던 '메모의 @태그가 같으면 엮음' 경로는 폐지했다: 이름만 같은
     동명이인이 걸리고, 화면 설명("관련인·메모에 …이 있거나")도 실제 규칙과 어긋났다.
     @태그로 등록한 업무는 등록 시 관련인 3칸이 자동 첨부되므로(form.js contactsFromTags)
     이 기준만으로도 그대로 걸린다.
   - `name` 은 이제 매칭에 쓰지 않는다(팝업 제목 표시용으로만 넘어온다).
   정렬은 미완료 먼저, 최신순. */
export function relatedItems(items, {entries}={}){
  const es=(entries||[]).map(normEntry);
  const tripleEq=c=>es.some(e=>
    String(c.who||'').trim()===e.who &&
    String(c.org||'').trim()===e.org &&
    phoneDigits(c.phone)===phoneDigits(e.phone));
  if(!es.length) return [];
  const out=[];
  for(const it of (items||[])){
    if(it.recur) continue;                       // 주기 부모는 보드 밖 — 목록에서 제외
    if((it.contacts||[]).some(tripleEq)) out.push(it);
  }
  return out.sort((a,b)=>(a.done?1:0)-(b.done?1:0) || b.id-a.id);
}

/* 원문(이스케이프 전) 텍스트에서 @태그 이름들을 뽑는다 — 중복 제거, 등장 순서.
   linkifyAt 과 같은 문법(줄 시작/공백 뒤 @, '(' 앞까지, 꼬리 문장부호 제거). */
export function extractTags(text){
  const out=[]; const re=/(^|\s)@([^\s@&<>"'(]{1,30})/g; let m;
  text=String(text||'');
  while((m=re.exec(text))){
    const name=m[2].replace(/[.,;:!?·)\]]+$/,'');
    if(name && !out.includes(name)) out.push(name);
  }
  return out;
}

/* 태그 이름에 해당하는 전화번호부 항목들 — 이름 일치, (이름 없는 항목의) 소속 일치,
   번호꼴 태그(숫자 7자리 이상)의 번호 일치(숫자만 비교). 빠른 메모 등록 시
   관련인 자동 첨부(form.js contactsFromTags)가 쓴다. */
export function entriesForTag(list, name){
  name=String(name||'').trim(); if(!name) return [];
  const d=phoneDigits(name);
  return (list||[]).filter(e=>
    e.who===name || (!e.who && e.org===name) || (d.length>=7 && phoneDigits(e.phone)===d));
}

/* 아이템 관련인 → 전화번호부 자동 흡수(v2.9.0, 양식 저장 시) 계산 — 순수.
   반환: {added:[{who,org,phone}], updates:[{id, phone}]} (적용은 호출부).
   무결성 규칙(소유자 지정): **자동 경로는 이름·소속·연락처 3칸이 모두 있는
   관련인만 받는다** — 검토 없이 쌓이는 경로라 반쪽 데이터가 오염의 주범이다.
   (직접 입력·엑셀·[아이템에서 가져오기]는 의도적 행동이므로 부분 입력 허용 유지.)
   꼬임 방지 규칙:
   - 완전히 같은 사람(entryKey: 이름·소속·번호 숫자 비교)은 건너뜀
   - 같은 이름·소속인데 기존 번호가 비어 있으면 **번호만 보강**(항목 추가 없음)
   - 번호가 서로 다르면 새 항목(한 사람이 번호 둘인 것은 전화번호부에서 정상)
   삭제는 계산하지 않는다 — 아이템에서 지워도 전화번호부는 그대로. */
export function absorbContacts(book, contacts){
  const added=[], updates=[];
  const cur=(book||[]).map(e=>({...e}));           // 보강 중복 계산을 위한 작업 사본
  for(const raw of (contacts||[])){
    const c=normEntry(raw);
    if(!isComplete(c)) continue;                 // 3칸 완비만 (전화번호부 입력 자격)
    const k=entryKey(c);
    if(cur.some(e=>entryKey(e)===k) || added.some(e=>entryKey(e)===k)) continue;
    const mate=cur.find(e=>e.who===c.who && e.org===c.org);
    if(mate && !phoneDigits(mate.phone)){ mate.phone=c.phone; updates.push({id:mate.id, phone:c.phone}); continue; }
    added.push({who:c.who, org:c.org, phone:c.phone});
  }
  return {added, updates};
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

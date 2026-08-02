/* =========================================================================
   메모 합치기 (v2.8.0) — 두 아이템을 하나로 병합하는 순수 로직.
   보드에서 카드를 끌어 다른 카드에 놓으면 render.js 가 mergeItems(받는 쪽,
   끌려온 쪽)를 불러 결과로 교체한다. 규칙(소유자 지정):
   - id·알람 상태·담당·완료·주기 링크 = 받는(가만히 있던) 카드 것 유지
   - 메모 = 이어붙임 (받는 쪽 + 빈 줄 + 끌려온 쪽)
   - 접수·마감 = 둘 중 이른 쪽 (마감을 놓치는 사고가 없는 안전한 방향;
     마감이 바뀌면 F2 규칙대로 알람 재무장)
   - 관련인·식별정보·파일 = 이어붙임 + 중복 제거
   - 세부할일 = 합쳐서 점검시각 오름차순, 시각 없는 것은 뒤 (안정 정렬)
   상태·DOM 접근 없음 — 새 객체를 돌려주고 원본은 건드리지 않는다.
   ========================================================================= */
import {entryKey, fillEmail} from './phonebook-core.js';

/* ISO → epoch-ms, 손상/빈 값은 null (F7 계열 가드) */
function T(iso){ const t=new Date(iso||'').getTime(); return isNaN(t)?null:t; }
/* 둘 중 이른 유효 시각 — 한쪽만 유효하면 그쪽, 둘 다 없으면 '' */
function earlier(a,b){
  const ta=T(a), tb=T(b);
  if(ta==null&&tb==null) return '';
  if(ta==null) return b;
  if(tb==null) return a;
  return ta<=tb?a:b;
}

export function mergeItems(target, source){
  const t=JSON.parse(JSON.stringify(target));   // 받는 쪽 기반 — id·al·owner·done·recur 링크 유지

  // 메모: 이어붙임 (빈 쪽은 생략)
  t.memo=[target.memo, source.memo].map(x=>String(x||'').trim()).filter(Boolean).join('\n\n');

  // f: 받는 쪽 우선, 빈 칸은 끌려온 쪽으로 보충 — 접수·마감은 이른 쪽으로 덮음
  const tf=target.f||{}, sf=source.f||{};
  const f={...sf, ...tf};
  for(const k of Object.keys(f)) if(!f[k] && sf[k]) f[k]=sf[k];
  f.received=earlier(tf.received, sf.received);
  f.due=earlier(tf.due, sf.due);
  t.f=f;
  // F2: 마감이 (끌려온 쪽이 더 일러서) 바뀌었으면 알람 재무장
  if((t.f.due||'')!==(tf.due||'')) delete (t.al||{}).due;

  /* 관련인: 이어붙임 + 같은 사람(이름·소속·전화 숫자 비교) 제거.
     v3.5.0: 접을 때 이메일은 **빈 칸이면 채운다** — 이메일은 키가 아니라서 '같은 사람'
     으로 접히는데, 그냥 버리면 한쪽에만 적어 둔 이메일이 병합 한 번에 사라진다.
     원본 불변 계약은 유지한다(원본 객체가 아니라 사본에만 쓴다). */
  const cseen=new Map();
  t.contacts=[...(target.contacts||[]), ...(source.contacts||[])]
    .map(c=>c?{...c}:c)                           // ⚠️ 사본을 **먼저** 뜬다 — 아래 이메일 보강이 원본을 건드리지 않게
    .filter(c=>{
      if(!c||!((c.who||'')||(c.org||'')||(c.phone||'')||(c.email||''))) return false;
      const k=entryKey(c);
      const prev=cseen.get(k);
      if(prev){ prev.email=fillEmail(prev.email, c.email); return false; }
      cseen.set(k,c); return true;
    });
  // 식별정보: 명칭+번호가 같으면 제거
  const iseen=new Set();
  t.ids=[...(target.ids||[]), ...(source.ids||[])].filter(x=>{
    const k=`${x.kind||''}|${x.val||''}`;
    if(iseen.has(k)) return false;
    iseen.add(k); return true;
  });
  // 파일: 같은 경로 제거
  const fseen=new Set();
  t.files=[...(target.files||[]), ...(source.files||[])].filter(p=>{
    if(fseen.has(p)) return false;
    fseen.add(p); return true;
  });

  // 세부할일: 합쳐서 점검시각 오름차순 (시각 없는 것은 뒤, 원래 순서 유지 — 안정 정렬)
  t.subs=[...(target.subs||[]), ...(source.subs||[])]
    .map((s,i)=>({s,i}))
    .sort((a,b)=>{
      const ta=T(a.s.mid), tb=T(b.s.mid);
      if(ta!=null&&tb!=null) return (ta-tb)||(a.i-b.i);
      if(ta!=null) return -1;
      if(tb!=null) return 1;
      return a.i-b.i;
    })
    .map(x=>x.s);

  // 분류 상태: 어느 한쪽이라도 분류를 마쳤으면(양식 저장) 분류 대기로 되돌리지 않는다
  t.staged=!!(target.staged&&source.staged);

  return t;
}

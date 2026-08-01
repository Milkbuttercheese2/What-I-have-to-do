/* =========================================================================
   @ 자동완성 (v2.7.0) — 전화번호부를 세 곳에 잇는 드롭다운.
   - 바로 입력(#inp): @김철 처럼 치면 드롭다운 → 선택 시 "김철수(소속 전화)" 텍스트 삽입
   - 양식 메모(#fm-memo): 같은 트리거 → 선택 시 @토큰을 지우고 관련인 행을 채운다
   - 양식 관련인 칸(.contact-row input): @ 없이 입력값 그대로 검색 → 선택 시 그 행 3칸 채움
   initDtDelegation 과 같은 문서 위임 방식이라 form.js 가 이 모듈을 import 하지
   않는다(새 순환 없음 — 이쪽이 form.js 의 fillContactFromEntry 를 일방향 import).
   토큰 파싱·검색·삽입 계산은 phonebook-core.js(순수), 데이터는 S.phonebook.
   ========================================================================= */
import {S} from './state.js';
import {$, esc} from './dom-utils.js';
import {atToken, applyInsert, tagText, matchEntries} from './phonebook-core.js';
import {fillContactFromEntry} from './form.js';

let drop=null;            // 드롭다운 요소 (#atDrop, body 직속)
let anchor=null;          // 현재 붙어 있는 입력 요소 (null = 닫힘)
let items=[];             // 표시 중인 후보
let sel=0;                // 선택 위치
let token=null;           // memo 계열일 때의 {start, caret} (contact 계열은 null)
let applying=false;       // 선택 적용 중 재진입 방지 (프로그램적 input 이벤트가 다시 열지 않게)
let mirror=null;          // textarea 커서 좌표 측정용 미러

const isMemo=el=>el && (el.id==='inp'||el.id==='fm-memo');
const isContact=el=>el && el.matches && el.matches('#fm-contacts .contact-row input');

function close(){ if(drop) drop.style.display='none'; anchor=null; items=[]; token=null; }

/* textarea 커서의 화면 좌표 — 같은 스타일의 숨은 미러에 커서까지의 텍스트를 붓고
   끝 마커의 위치를 잰다(표준 API 부재로 흔히 쓰는 기법). 실패하면 입력칸 아래로. */
function caretRect(ta){
  try{
    if(!mirror){ mirror=document.createElement('div'); mirror.setAttribute('aria-hidden','true'); document.body.appendChild(mirror); }
    const cs=getComputedStyle(ta);
    for(const p of ['fontFamily','fontSize','fontWeight','lineHeight','letterSpacing','textTransform','wordSpacing','textIndent','paddingTop','paddingRight','paddingBottom','paddingLeft','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','boxSizing'])
      mirror.style[p]=cs[p];
    Object.assign(mirror.style,{position:'fixed',visibility:'hidden',left:'-9999px',top:'0',
      width:ta.clientWidth+'px',whiteSpace:'pre-wrap',wordBreak:'break-word',overflow:'hidden'});
    mirror.textContent=ta.value.slice(0, ta.selectionStart);
    const mark=document.createElement('span'); mark.textContent='​'; mirror.appendChild(mark);
    const tb=ta.getBoundingClientRect(), mb=mirror.getBoundingClientRect(), kb=mark.getBoundingClientRect();
    return {left:tb.left+(kb.left-mb.left)-ta.scrollLeft, top:tb.top+(kb.top-mb.top)-ta.scrollTop, height:kb.height||18};
  }catch{
    const r=ta.getBoundingClientRect();
    return {left:r.left, top:r.bottom-18, height:18};
  }
}

function openAt(el, list, rect){
  anchor=el; items=list; sel=0;
  drop.innerHTML=items.map((e,i)=>`<div class="at-item${i===0?' sel':''}" data-ati="${i}">
    <span class="at-who">${esc(e.who||'—')}</span><span class="at-org">${esc(e.org||'')}</span><span class="at-phone num">${esc(e.phone||'')}</span>
  </div>`).join('');
  drop.style.display='block';
  /* 화면 밖 방지: 우측은 안으로 밀고, 아래 공간이 없으면 위로 편다 */
  const dw=drop.offsetWidth, dh=drop.offsetHeight;
  let left=Math.min(rect.left, window.innerWidth-dw-8);
  let top=rect.top+rect.height+4;
  if(top+dh>window.innerHeight-8) top=rect.top-dh-4;
  drop.style.left=Math.max(8,left)+'px';
  drop.style.top=Math.max(8,top)+'px';
}

function setSel(i){
  if(!items.length) return;
  sel=Math.max(0, Math.min(i, items.length-1));
  [...drop.querySelectorAll('.at-item')].forEach((el,n)=>el.classList.toggle('sel', n===sel));
}

function apply(i){
  const entry=items[i??sel]; const el=anchor;
  if(!entry||!el){ close(); return; }
  applying=true;
  try{
    if(isContact(el)){
      fillContactFromEntry(entry, el.closest('.contact-row'));
      el.dispatchEvent(new Event('input',{bubbles:true}));           // 양식 임시저장 트리거
    }else if(el.id==='fm-memo'){
      /* 양식 메모: 토큰을 완성형 @태그로 남기고(소유자 지정 — 태그는 지우지 않는다)
         관련인 행을 채운다. 같은 사람을 여러 번 골라도 관련인은 한 번만 들어간다
         (중복 판정은 fillContactFromEntry 쪽). */
      const r=applyInsert(el.value, token.caret, token.start, tagText(entry));
      el.value=r.text; el.setSelectionRange(r.caret, r.caret);
      fillContactFromEntry(entry);
      el.dispatchEvent(new Event('input',{bubbles:true}));
    }else{
      /* 바로 입력: 완성형 @태그만 삽입 (v2.9.0 — 괄호 정보 병기는 폐지). 소속·번호는
         등록 시점에 captureMemo 가 태그를 전화번호부와 대조해 관련인으로 자동 첨부하므로
         메모 텍스트에 중복으로 남길 이유가 없다(메모가 어수선해지는 비용만 있었다). */
      const r=applyInsert(el.value, token.caret, token.start, tagText(entry));
      el.value=r.text; el.setSelectionRange(r.caret, r.caret);
      el.dispatchEvent(new Event('input',{bubbles:true}));           // autoGrowInp·초안 흐름 유지
    }
  }finally{ applying=false; }
  close(); el.focus();
}

function onInput(e){
  if(applying) return;
  const el=e.target;
  if(isMemo(el)){
    if(!S.phonebook.length){ if(anchor===el) close(); return; }
    const t=atToken(el.value, el.selectionStart);
    const list=t?matchEntries(S.phonebook, t.query, 8):[];
    if(!list.length){ if(anchor===el) close(); return; }
    token={start:t.start, caret:el.selectionStart};
    openAt(el, list, caretRect(el));
  }else if(isContact(el)){
    if(!S.phonebook.length){ if(anchor===el) close(); return; }
    const list=matchEntries(S.phonebook, el.value.trim(), 8);
    if(!list.length){ if(anchor===el) close(); return; }
    token=null;
    const r=el.getBoundingClientRect();
    openAt(el, list, {left:r.left, top:r.top, height:r.height});
  }else if(anchor){ close(); }
}

/* 캡처 단계 키 처리 — 드롭다운이 열려 있을 때만 해당 입력의 키를 가로챈다.
   (관련인 행의 Enter=다음 행, ESC=양식 닫기 같은 기존 동작보다 먼저 먹어야 한다) */
function onKeydown(e){
  if(!anchor || e.target!==anchor) return;
  if(e.isComposing||e.keyCode===229) return;                 // 한글 IME 조합 중엔 건드리지 않는다
  if(e.ctrlKey||e.metaKey) return;                           // Ctrl+Enter(등록/저장) 등은 그대로 통과
  if(e.key==='ArrowDown'){ e.preventDefault(); e.stopPropagation(); setSel(sel+1); }
  else if(e.key==='ArrowUp'){ e.preventDefault(); e.stopPropagation(); setSel(sel-1); }
  else if(e.key==='Enter'||e.key==='Tab'){ e.preventDefault(); e.stopPropagation(); apply(); }
  else if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); close(); }
}

export function initAtComplete(){
  drop=document.createElement('div');
  drop.id='atDrop'; drop.style.display='none';
  document.body.appendChild(drop);
  /* mousedown: blur 로 닫히기 전에 잡고, preventDefault 로 포커스도 안 뺏는다 */
  drop.addEventListener('mousedown',e=>{
    e.preventDefault();
    const it=e.target.closest('[data-ati]');
    if(it) apply(Number(it.dataset.ati));
  });
  document.addEventListener('input', onInput);
  document.addEventListener('keydown', onKeydown, true);
  /* 입력칸 밖 클릭·포커스 이탈·스크롤이면 닫는다 (스크롤 추적보다 닫는 쪽이 단순·안전) */
  document.addEventListener('mousedown',e=>{ if(anchor && !drop.contains(e.target) && e.target!==anchor) close(); });
  document.addEventListener('focusin',e=>{ if(anchor && e.target!==anchor && !drop.contains(e.target)) close(); });
  window.addEventListener('scroll',()=>{ if(anchor) close(); }, true);
}

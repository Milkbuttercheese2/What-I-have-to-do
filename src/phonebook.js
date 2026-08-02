/* =========================================================================
   전화번호부 탭 (v2.7.0) — 목록·직접 입력·[아이템에서 가져오기]·엑셀 불러오기.
   저장은 S.phonebook 통째 교체(STORE.savePhonebook) — 다른 사이드카(프리셋 등)와
   동일한 replace-not-merge 계약. 표시는 소속→이름 정렬로 파생(배열 순서는 저장
   순서일 뿐 화면 정렬에 안 쓴다 — 수백 건에서 드래그 정렬은 의미가 없다).
   순수 로직(중복 판정·엑셀 매핑)은 phonebook-core.js 에 있다.
   ========================================================================= */
import {S, newId} from './state.js';
import {STORE, invoke} from './store.js';
import {$, esc, escAttr, showToast} from './dom-utils.js';
import {fmtT} from './datetime.js';
import {normEntry, entryKey, isComplete, entriesForTag, gatherFromItems, mapSheetRows, phoneDigits, relatedItems, absorbContacts} from './phonebook-core.js';

let q='';                 // 탭 안 검색어 (모듈 로컬 — render.js 의 q/dq 와 같은 패턴)
let editingPbId=null;     // 수정 중인 항목 id (null = 새로 추가 모드)

function savePb(){ STORE.savePhonebook(S.phonebook); }

/* 로드/백업 복원분 채택 — 정규화 + 빈 껍데기 제거 + id 보정(F12: lastId 시드 포함).
   backup.js reconcileImported 가 부른다. */
export function adoptPhonebook(list){
  S.phonebook=(Array.isArray(list)?list:[]).map(normEntry).filter(e=>e.who||e.org||e.phone)
    .map(e=>{ if(e.id==null||e.id===''){ e.id=newId(); } else { e.id=Number(e.id); if(e.id>S.lastId) S.lastId=e.id; } return e; });
}

/* 관련 업무 수 — 이 사람이 엮인 업무 개수. 팝업과 같은 기준
   (v3.1.1: 관련인 3칸(관련소속·관련인·연락처) 완전 일치만) */
function relCount(e){
  return relatedItems(S.items, {entries:[e]}).length;
}
/* 표시 정렬(v2.11.0 소유자 지정) — ① 관련 업무 수 많은 순 ② 소속 ③ 이름 (ko locale).
   원본 배열은 건드리지 않는다(배열 순서 = 저장 순서). */
function sorted(){
  const cnt=new Map(S.phonebook.map(e=>[e.id, relCount(e)]));
  return S.phonebook.slice().sort((a,b)=>
    (cnt.get(b.id)-cnt.get(a.id))
    || (a.org||'').localeCompare(b.org||'','ko')
    || (a.who||'').localeCompare(b.who||'','ko'))
    .map(e=>({e, n:cnt.get(e.id)}));
}
function matches(e){
  if(!q) return true;
  return `${e.who||''} ${e.org||''} ${e.phone||''} ${phoneDigits(e.phone)}`.toLowerCase().includes(q);
}

export function renderPhonebook(){
  const w=$('pb-list'); if(!w) return;
  $('pb-count').textContent=S.phonebook.length;
  const list=sorted().filter(x=>matches(x.e));
  if(!list.length){
    w.innerHTML=`<div class="empty" style="padding:14px">${S.phonebook.length? '일치하는 관련인이 없습니다.' : '저장된 관련인이 없습니다. 위에서 직접 추가하거나, [새로고침]·[엑셀 불러오기]를 쓰세요.'}</div>`;
    return;
  }
  w.innerHTML=list.map(({e,n})=>`<div class="pb-item" data-pbid="${e.id}" title="누르면 이 관련인과 엮인 업무를 보여줍니다">
    <span class="pb-org">${esc(e.org||'—')}</span>
    <span class="pb-who">${esc(e.who||'—')}</span>
    <span class="pb-phone num">${esc(e.phone||'—')}</span>
    <span class="pb-tail">
      <span class="pb-cnt num" title="엮인 업무 수">업무 ${n}</span>
      <button class="ps-edit" data-pbedit="${e.id}">수정</button>
      <button class="ps-del" data-pbdel="${e.id}">삭제</button>
    </span>
  </div>`).join('');
}

function clearPbForm(){
  editingPbId=null;
  $('pb-org').value=''; $('pb-who').value=''; $('pb-phone').value='';
  $('pb-save').textContent='추가';
  $('pb-cancel').style.display='none';
}
function loadPbForm(id){
  const e=S.phonebook.find(x=>x.id===id); if(!e) return;
  editingPbId=id;
  $('pb-org').value=e.org; $('pb-who').value=e.who; $('pb-phone').value=e.phone;
  $('pb-save').textContent='수정 저장';
  $('pb-cancel').style.display='inline-block';
  $('pb-who').focus();
}
function submitPbForm(){
  const e=normEntry({who:$('pb-who').value, org:$('pb-org').value, phone:$('pb-phone').value});
  if(!(e.who||e.org||e.phone)){ $('pb-who').focus(); return; }
  /* v2.9.0 무결성(소유자 지정): 전화번호부는 3칸 완비만 — 일부만 아는 관련인은 메모에 */
  if(!isComplete(e)){
    alert('전화번호부에는 관련소속·관련인·연락처를 모두 입력해야 합니다.\n(일부만 아는 관련인은 바로 입력·양식 메모에 자유롭게 적어두세요.)');
    (!e.org?$('pb-org'):!e.who?$('pb-who'):$('pb-phone')).focus();
    return;
  }
  const dup=S.phonebook.find(x=>x.id!==editingPbId && entryKey(x)===entryKey(e));
  if(dup){ alert('같은 관련인이 이미 있습니다.'); return; }
  if(editingPbId){
    const cur=S.phonebook.find(x=>x.id===editingPbId);
    if(cur){ cur.who=e.who; cur.org=e.org; cur.phone=e.phone; }
  }else{
    e.id=newId(); S.phonebook.push(e);
  }
  savePb(); clearPbForm(); renderPhonebook(); $('pb-who').focus();
}

/* ── 새로고침·엑셀 공용 확인 팝업 (v2.9.0 — 네이티브 confirm 대신 앱 표준 모달) ──
   찾은 관련인을 목록으로 보여주고 [모두 추가]로 확정한다. */
let pendingSync=[];                 // 팝업에 떠 있는 후보 (id 없는 {who,org,phone})
function openPbSync(title, sub, found){
  pendingSync=found;
  $('pbs-title').textContent=title;
  $('pbs-sub').textContent=sub;
  $('pbs-list').innerHTML=found.map(e=>`<div class="pbs-row">
    <span class="pb-org">${esc(e.org)}</span><span class="pb-who">${esc(e.who)}</span><span class="pb-phone num">${esc(e.phone)}</span>
  </div>`).join('');
  $('pbSyncModal').classList.add('on');
}
function closePbSync(){ $('pbSyncModal').classList.remove('on'); pendingSync=[]; }
function applyPbSync(){
  const n=pendingSync.length;
  pendingSync.forEach(e=>{ S.phonebook.push({id:newId(), who:e.who, org:e.org, phone:e.phone}); });
  closePbSync();
  if(n){ savePb(); renderPhonebook(); showToast(`관련인 ${n}명을 추가했습니다`); }
}

/* [새로고침] — 아이템 관련인 중 전화번호부에 없는 3칸 완비 관련인을 다시 훑어
   추가한다(양식 저장 시 자동 연동을 놓친 과거 데이터·복원분 회수용). */
function refreshFromItems(){
  const found=gatherFromItems(S.items, S.phonebook);
  if(!found.length){ showToast('추가할 새 관련인이 없습니다'); return; }
  openPbSync('전화번호부 새로고침',
    `아이템의 관련인 중 전화번호부에 없는 ${found.length}명을 찾았습니다. (소속·이름·연락처가 모두 있는 관련인만)`,
    found);
}

/* 엑셀(.xlsx/.xls) 불러오기 — vendored SheetJS(XLSX 전역)로 첫 시트를 읽고
   헤더(이름/소속/전화 계열)를 찾아 매핑한다. 파싱은 phonebook-core.mapSheetRows.
   v2.9.0: 3칸 완비 행만 받는다(무결성 규칙). */
function importFromXlsx(file){
  const reader=new FileReader();
  reader.onerror=()=>alert('파일을 읽지 못했습니다.');
  reader.onload=()=>{
    let rows;
    try{
      const wb=XLSX.read(new Uint8Array(reader.result), {type:'array'});
      const ws=wb.Sheets[wb.SheetNames[0]];
      rows=XLSX.utils.sheet_to_json(ws, {header:1, raw:false, defval:''});
    }catch(e){ alert('엑셀 파일을 읽지 못했습니다: '+e); return; }
    const mapped=mapSheetRows(rows);
    if(!mapped){
      alert('관련소속/관련인/연락처 열을 찾지 못했습니다.\n첫 몇 줄 안에 제목 줄이 있어야 합니다 — [엑셀 양식]으로 받은 파일에 채워 넣으면 확실합니다.\n(소속·기관·부서 / 이름·성명·관련인 / 전화·연락처 같은 말이 들어가면 인식됩니다.)');
      return;
    }
    const complete=mapped.entries.filter(isComplete);
    const fresh=complete.filter(e=>!S.phonebook.some(x=>entryKey(x)===entryKey(e))).map(normEntry);
    if(!fresh.length){ showToast('추가할 새 관련인이 없습니다'); return; }
    const dupes=complete.length-fresh.length, partial=mapped.entries.length-complete.length;
    const notes=[dupes?`이미 있는 ${dupes}명`:'', partial?`정보가 빠진 ${partial}명`:''].filter(Boolean).join(' · ');
    openPbSync('엑셀에서 가져오기',
      `관련인 ${fresh.length}명을 찾았습니다.${notes?` (${notes} 제외)`:''}`,
      fresh);
  };
  reader.readAsArrayBuffer(file);
}

/* [엑셀 양식] (v3.1.0) — 제목 줄만 있는 빈 xlsx 를 저장한다.
   '무엇을 어떤 열에 적어야 하나'를 파일 자체가 말해 주게 하는 것이 목적이라
   예시 행은 넣지 않는다(지우지 않고 불러오면 가짜 관련인이 등록되므로).
   v3.1.1(소유자 지정): 제목을 **화면 입력칸과 같은 이름**(관련소속·관련인·연락처)으로.
   불러오기의 헤더 인식(mapSheetRows)은 '소속'·'관련인'·'연락처'를 모두 포함하므로
   이 이름 그대로 왕복된다 — 제목 문구를 바꿀 땐 그 정규식과 함께 본다.
   저장 경로는 XLSX 내보내기(backup.js)와 같다 — F14 주석 참조: {type:'array'} 를
   Uint8Array 로 감싸지 않으면 0바이트 파일이 나온다. */
async function saveXlsxTemplate(){
  try{
    const ws=XLSX.utils.aoa_to_sheet([['관련소속','관련인','연락처']]);   // 화면 입력칸과 같은 이름
    ws['!cols']=[{wch:24},{wch:14},{wch:20}];
    const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'전화번호부');
    const bytes=Array.from(new Uint8Array(XLSX.write(wb,{type:'array',bookType:'xlsx'})));
    const saved=await invoke('save_binary_file',{suggestedName:'전화번호부_양식.xlsx', data:bytes});
    if(saved) showToast('제목 줄 아래에 채운 뒤 [엑셀 불러오기]로 넣으세요');
  }catch(e){ alert('엑셀 양식 저장 실패: '+e); }
}

/* ── 아이템 관련인 → 전화번호부 자동 흡수 (v2.9.0 소유자 지정) ───────────
   양식을 저장할 때(form.js) 그 관련인들을 전화번호부에 자동 반영한다.
   규칙·꼬임 방지는 phonebook-core.absorbContacts — 여기서는 적용·저장만.
   [아이템에서 가져오기] 버튼은 기존 데이터 일괄 흡수용으로 그대로 남는다. */
export function absorbIntoPhonebook(contacts){
  const {added, updates}=absorbContacts(S.phonebook, contacts);
  if(!added.length && !updates.length) return;
  updates.forEach(u=>{ const e=S.phonebook.find(x=>x.id===u.id); if(e) e.phone=u.phone; });
  added.forEach(c=>{ S.phonebook.push({id:newId(), who:c.who, org:c.org, phone:c.phone}); });
  savePb(); renderPhonebook();
}

/* ── 관련 업무 팝업 (v2.7.0 소유자 지정) ─────────────────────────────────
   카드의 @태그(또는 전화번호부 행)를 클릭하면, 그 관련인과 엮인 업무를 모아
   보여준다. v3.1.1: 기준은 **전화번호부 정보 3칸 완전 일치** 하나뿐. 행 클릭은 render.js 의 data-open 위임이 받아
   양식을 연다(여기서는 팝업만 닫는다). */
export function openRelated(name, extraEntries){
  name=String(name||'').trim(); if(!name) return;
  /* 태그 이름 → 그 이름의 전화번호부 항목(entriesForTag)을 찾고, 그 항목의 3칸과
     완전히 같은 관련인을 가진 업무만 엮는다 (v3.1.1 소유자 지정 — 이름·번호 부분일치,
     메모 @태그 경로 모두 폐지: 동명이인이 걸리던 문제) */
  const entries=entriesForTag(S.phonebook, name).concat(extraEntries||[]);
  const matched=relatedItems(S.items, {entries});
  $('rel-title').textContent=`@${name} 관련 업무`;
  $('rel-sub').textContent=`전화번호부 정보(관련소속·관련인·연락처)가 모두 일치하는 업무 ${matched.length}건 — 누르면 양식이 열립니다.`;
  $('rel-list').innerHTML=matched.length?matched.map(it=>{
    const memo=(it.memo||'').split(/\r?\n/)[0].trim()||'(메모 없음)';
    /* v3.1.2: 완료 업무는 완료 날짜도 표시 (완료 탭 카드와 같은 fmtT 표기) */
    const dv=it.done&&it.doneAt!=null?new Date(it.doneAt):null;
    const doneAt=(dv&&!isNaN(dv))?`<span class="rel-done num">${esc(fmtT(dv.toISOString()))}</span>`:'';
    return `<div class="rel-hit" data-open="${it.id}"><span class="rel-tag ${it.done?'done':'ongoing'}">${it.done?'완료':'진행'}</span><span class="rel-txt">${esc(memo)}</span>${doneAt}</div>`;
  }).join(''):'<div class="empty" style="padding:14px">엮인 업무가 없습니다.</div>';
  $('relModal').classList.add('on');
}
export function closeRelated(){ $('relModal').classList.remove('on'); }

export function initPhonebook(){
  document.body.appendChild($('relModal'));           // 어느 탭에서든 뜨도록 (표준 모달 규칙)
  document.body.appendChild($('pbSyncModal'));
  $('pbs-add').addEventListener('click',applyPbSync);
  $('pbs-cancel').addEventListener('click',closePbSync);
  $('pbSyncModal').addEventListener('click',e=>{ if(e.target.id==='pbSyncModal') closePbSync(); });
  $('relClose').addEventListener('click',closeRelated);
  $('relModal').addEventListener('click',e=>{
    if(e.target.id==='relModal'){ closeRelated(); return; }          // 배경 클릭 닫기
    if(e.target.closest('[data-open]')) closeRelated();             // 업무를 열었으니 팝업은 닫는다 (열기는 render.js 위임)
  });
  /* @태그 클릭 → 관련 업무 팝업의 진입점은 v2.11.0부터 **양식 메모 본문**(form.js 가
     hover 기하 판정으로 직접 처리)과 전화번호부 행뿐이다 — v2.9.0의 별도 칩(#fm-tags)은
     '본문에 하이라이트'라는 소유자 지정으로 제거됐다. 카드 위 태그는 색 표시만(불변). */
  $('pb-save').addEventListener('click',submitPbForm);
  $('pb-cancel').addEventListener('click',()=>{ clearPbForm(); });
  [$('pb-org'),$('pb-who'),$('pb-phone')].forEach(inp=>inp.addEventListener('keydown',e=>{
    if(e.key==='Enter'&&!e.isComposing&&e.keyCode!==229){ e.preventDefault(); submitPbForm(); }
  }));
  $('pb-search').addEventListener('input',()=>{ q=$('pb-search').value.trim().toLowerCase(); renderPhonebook(); });
  $('pb-import').addEventListener('click',refreshFromItems);
  $('pb-tmpl').addEventListener('click',saveXlsxTemplate);
  $('pb-xlsx').addEventListener('click',()=>$('pb-file').click());
  $('pb-file').addEventListener('change',()=>{
    const f=$('pb-file').files[0];
    $('pb-file').value='';                       // 같은 파일 재선택도 change 가 다시 뜨게
    if(f) importFromXlsx(f);
  });
  $('pb-list').addEventListener('click',e=>{
    const ed=e.target.closest('[data-pbedit]');
    if(ed){ loadPbForm(Number(ed.dataset.pbedit)); return; }
    const del=e.target.closest('[data-pbdel]');
    if(!del){
      /* 행의 빈 곳 클릭 = 이 사람과 엮인 업무 보기 (카드 @태그 클릭과 같은 팝업) */
      const rowEl=e.target.closest('.pb-item');
      if(rowEl){ const en=S.phonebook.find(x=>x.id===Number(rowEl.dataset.pbid));
        if(en) openRelated(en.who||en.org||en.phone, [en]); }
      return;
    }
    const id=Number(del.dataset.pbdel), entry=S.phonebook.find(x=>x.id===id);
    if(!entry) return;
    if(!confirm(`"${[entry.org,entry.who].filter(Boolean).join(' ')||entry.phone}"을(를) 삭제할까요?`)) return;
    S.phonebook=S.phonebook.filter(x=>x.id!==id);
    if(editingPbId===id) clearPbForm();
    savePb(); renderPhonebook();
  });
}

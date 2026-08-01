/* =========================================================================
   전화번호부 탭 (v2.7.0) — 목록·직접 입력·[아이템에서 가져오기]·엑셀 불러오기.
   저장은 S.phonebook 통째 교체(STORE.savePhonebook) — 다른 사이드카(프리셋 등)와
   동일한 replace-not-merge 계약. 표시는 소속→이름 정렬로 파생(배열 순서는 저장
   순서일 뿐 화면 정렬에 안 쓴다 — 수백 건에서 드래그 정렬은 의미가 없다).
   순수 로직(중복 판정·엑셀 매핑)은 phonebook-core.js 에 있다.
   ========================================================================= */
import {S, newId} from './state.js';
import {STORE} from './store.js';
import {$, esc, escAttr, showToast} from './dom-utils.js';
import {normEntry, entryKey, gatherFromItems, mapSheetRows, phoneDigits} from './phonebook-core.js';

let q='';                 // 탭 안 검색어 (모듈 로컬 — render.js 의 q/dq 와 같은 패턴)
let editingPbId=null;     // 수정 중인 항목 id (null = 새로 추가 모드)

function savePb(){ STORE.savePhonebook(S.phonebook); }

/* 로드/백업 복원분 채택 — 정규화 + 빈 껍데기 제거 + id 보정(F12: lastId 시드 포함).
   backup.js reconcileImported 가 부른다. */
export function adoptPhonebook(list){
  S.phonebook=(Array.isArray(list)?list:[]).map(normEntry).filter(e=>e.who||e.org||e.phone)
    .map(e=>{ if(e.id==null||e.id===''){ e.id=newId(); } else { e.id=Number(e.id); if(e.id>S.lastId) S.lastId=e.id; } return e; });
}

/* 표시 정렬 — 소속 → 이름 (ko locale). 원본 배열은 건드리지 않는다. */
function sorted(){
  return S.phonebook.slice().sort((a,b)=>
    (a.org||'').localeCompare(b.org||'','ko') || (a.who||'').localeCompare(b.who||'','ko'));
}
function matches(e){
  if(!q) return true;
  return `${e.who||''} ${e.org||''} ${e.phone||''} ${phoneDigits(e.phone)}`.toLowerCase().includes(q);
}

export function renderPhonebook(){
  const w=$('pb-list'); if(!w) return;
  $('pb-count').textContent=S.phonebook.length;
  const list=sorted().filter(matches);
  if(!list.length){
    w.innerHTML=`<div class="empty" style="padding:14px">${S.phonebook.length? '일치하는 관련인이 없습니다.' : '저장된 관련인이 없습니다. 위에서 직접 추가하거나, 아이템에서 가져오기·엑셀 불러오기를 쓰세요.'}</div>`;
    return;
  }
  w.innerHTML=list.map(e=>`<div class="pb-item" data-pbid="${e.id}">
    <span class="pb-org">${esc(e.org||'—')}</span>
    <span class="pb-who">${esc(e.who||'—')}</span>
    <span class="pb-phone num">${esc(e.phone||'—')}</span>
    <button class="ps-edit" data-pbedit="${e.id}">수정</button>
    <button class="ps-del" data-pbdel="${e.id}">삭제</button>
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

/* [아이템에서 가져오기] — 아이템 관련인 중 아직 없는 것만 모아 확인 후 일괄 추가.
   자동 동기화가 아니라 명시적 1회 흡수(소유자 결정) — 이후 정리는 목록에서. */
function importFromItems(){
  const found=gatherFromItems(S.items, S.phonebook);
  if(!found.length){ alert('아이템에서 가져올 새 관련인이 없습니다.\n(이미 전화번호부에 있는 관련인은 제외됩니다.)'); return; }
  const preview=found.slice(0,5).map(e=>[e.org,e.who,e.phone].filter(Boolean).join(' · ')).join('\n');
  if(!confirm(`아이템의 관련인 중 전화번호부에 없는 ${found.length}명을 찾았습니다.\n\n${preview}${found.length>5?'\n…':''}\n\n전화번호부에 추가할까요?`)) return;
  found.forEach(e=>{ e.id=newId(); S.phonebook.push(e); });
  savePb(); renderPhonebook();
  showToast(`관련인 ${found.length}명을 가져왔습니다`);
}

/* 엑셀(.xlsx/.xls) 불러오기 — vendored SheetJS(XLSX 전역)로 첫 시트를 읽고
   헤더(이름/소속/전화 계열)를 찾아 매핑한다. 파싱은 phonebook-core.mapSheetRows. */
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
      alert('이름/소속/전화 열을 찾지 못했습니다.\n첫 몇 줄 안에 "이름(또는 성명)", "소속(또는 기관·부서)", "전화(또는 연락처)" 같은 제목 줄이 있어야 합니다.');
      return;
    }
    const fresh=mapped.entries.filter(e=>!S.phonebook.some(x=>entryKey(x)===entryKey(e)));
    if(!fresh.length){ alert('추가할 새 관련인이 없습니다.\n(파일의 관련인이 모두 이미 전화번호부에 있습니다.)'); return; }
    const skipped=mapped.entries.length-fresh.length;
    if(!confirm(`엑셀에서 관련인 ${fresh.length}명을 찾았습니다.${skipped?`\n(이미 있는 ${skipped}명은 제외)`:''}\n전화번호부에 추가할까요?`)) return;
    fresh.forEach(e=>{ e.id=newId(); S.phonebook.push(normEntry(e)); });
    savePb(); renderPhonebook();
    showToast(`엑셀에서 ${fresh.length}명을 가져왔습니다`);
  };
  reader.readAsArrayBuffer(file);
}

export function initPhonebook(){
  $('pb-save').addEventListener('click',submitPbForm);
  $('pb-cancel').addEventListener('click',()=>{ clearPbForm(); });
  [$('pb-org'),$('pb-who'),$('pb-phone')].forEach(inp=>inp.addEventListener('keydown',e=>{
    if(e.key==='Enter'&&!e.isComposing&&e.keyCode!==229){ e.preventDefault(); submitPbForm(); }
  }));
  $('pb-search').addEventListener('input',()=>{ q=$('pb-search').value.trim().toLowerCase(); renderPhonebook(); });
  $('pb-import').addEventListener('click',importFromItems);
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
    if(!del) return;
    const id=Number(del.dataset.pbdel), entry=S.phonebook.find(x=>x.id===id);
    if(!entry) return;
    if(!confirm(`"${[entry.org,entry.who].filter(Boolean).join(' ')||entry.phone}"을(를) 삭제할까요?`)) return;
    S.phonebook=S.phonebook.filter(x=>x.id!==id);
    if(editingPbId===id) clearPbForm();
    savePb(); renderPhonebook();
  });
}

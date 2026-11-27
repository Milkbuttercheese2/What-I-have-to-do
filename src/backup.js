/* =========================================================================
   백업/복원 (JSON·DB) + XLSX 내보내기 + 저장 위치 변경
   ========================================================================= */
import {S, CORE_FIELDS, DEFAULT_SETTINGS, migrateItem, stripTemp, backupObj} from './state.js';
import {STORE, invoke} from './store.js';
import {$, showToast, appAlert, appConfirm, needXlsx} from './dom-utils.js';
import {exportableItems, buildXlsx} from './xlsx-export.js';
import {renderPresets} from './presets.js';
import {applyAlarmOn} from './alarms.js';
import {persist} from './render.js';
import {adoptPhonebook, renderPhonebook} from './phonebook.js';
import {refreshTagHl} from './form.js';

/* [백업 파일 만들기] / Ctrl+S — 저장창을 띄워 폴더·이름 지정.
   한 번 지정하면 그 파일 핸들을 기억해 이후엔 같은 파일에 조용히 저장. */
/* v2.5.11: 백업에 임시 상태 captureDraft 를 넣지 않는다 — 넣으면 복원 후 다음 실행에
   (v2.6.2) 양식 임시저장 formDrafts 도 같은 이유로 뺀다: 복원한 항목을 열었을 때
   백업 시점의 옛 초안이 되살아나 '저장된 내용이 아닌 것'이 보이면 안 된다.
   초안이 유령 항목으로 등록돼(main.js 초안 회수), 백업 안 원본 항목과 중복될 수 있다. */
/* v3.3.4: 페이로드 조립은 state.js backupObj() 하나로 모았다 — 비상 덤프
   (store.js)가 같은 형태를 써야 그 파일도 [백업에서 복원]으로 그대로 복원된다. */
function backupPayload(){ return JSON.stringify(backupObj(),null,1); }
function backupName(){ const n=new Date(); return `뭐하려했더라_백업_${n.getFullYear()}${String(n.getMonth()+1).padStart(2,'0')}${String(n.getDate()).padStart(2,'0')}.json`; }
async function doBackup(){
  const text=backupPayload();
  // Tauri 창은 브라우저가 아니라 blob+<a download> 클릭을 받아줄 다운로드
  // 관리자가 없다 — 네이티브 "저장" 대화상자를 직접 띄워야 실제로 저장된다.
  try{
    const saved=await invoke('save_text_file', {suggestedName:backupName(), content:text});
    if(saved) showToast('백업 파일을 저장했습니다');
  }catch(e){ await appAlert('백업 저장 실패: '+e); }
}
export function reconcileImported(){
  const imp=S.imported;
  if(imp.presets){ S.presets=imp.presets; imp.presets=null; window.PRESETS=S.presets; STORE.savePresets(S.presets); renderPresets(); }
  if(imp.idKinds){ S.idKinds=imp.idKinds.filter(k=>k&&k!=='기타'); imp.idKinds=null; window.ID_KINDS=S.idKinds; STORE.saveIdKinds(S.idKinds); }
  if(imp.settings){ S.settings=Object.assign({},DEFAULT_SETTINGS,imp.settings); imp.settings=null; window.SETTINGS=S.settings; STORE.saveSettings(S.settings); applyAlarmOn(); }   // v3.7.0: 헤더 알람 버튼 폐지 — 복원된 설정이 '끔'이면 뒷정리만
  /* 구 정기함(v2.3) 정의 — 기능은 제거됐지만 데이터는 백업 왕복을 위해 보존만 한다
     (초기 로드는 DB에 이미 있고, JSON 복원은 backup_import 트랜잭션이 이미 저장함) */
  if(imp.recurDefs){ S.recurDefs=imp.recurDefs; imp.recurDefs=null; }
  /* v2.7.0 전화번호부 — 정규화·id 보정(adoptPhonebook) 후 재저장 (다른 사이드카와 동일 패턴) */
  if(imp.phonebook){ adoptPhonebook(imp.phonebook); imp.phonebook=null; STORE.savePhonebook(S.phonebook); renderPhonebook(); refreshTagHl(); }
  if(imp.fields){ let f=imp.fields; imp.fields=null;
    const custom=f.filter(x=>!CORE_FIELDS.some(cf=>cf.key===x.key)&&!['who','org','phone','mid','notice','sr'].includes(x.key));
    S.fields=CORE_FIELDS.map(cf=>{const ex=f.find(x=>x.key===cf.key);return ex?Object.assign({},cf,{on:true,builtin:true}):JSON.parse(JSON.stringify(cf));}).concat(custom);
    window.FIELDS=S.fields; STORE.saveFields(S.fields); }
}

const XLSX_BUSY_AT=500;   // 엑셀로 내보내기: 이 건수부터 '만드는 중' 토스트를 먼저 띄운다
export function initBackup(){
  /* 엑셀로 내보내기 — 2026-11-27 개편: 보기 좋은 업무 목록(구역별 묶음·기한 색·줄바꿈) + 연락처·파일 + 메모 전문 + 원자료.
     파일을 만드는 일은 순수 모듈 xlsx-export.js 가 한다(내보내는 범위와 원자료 시트의 열 순서·값은 예전과 같고, 열 이름 셋만
     v3.9.0 표준용어로 바뀌었다: 마감시각→기한, 세부진행→하위 업무 진행, 세부내역→하위 업무 내역 — tests/unit/xlsx-export.test.js).
     예전엔 32,767자를 넘는 메모가 하나라도 있으면 XLSX.write 가 던져 파일이 통째로 안 나왔다 — 이제 셀마다 자른다. */
  $('xlsx').addEventListener('click', async ()=>{
    const items=S.items, count=exportableItems(items).length;
    if(!count){await appAlert('내보낼 항목이 없습니다 (오늘 처리·진행 중·완료된 업무만 내보냅니다).');return;}
    try{ await needXlsx(); }catch(e){ await appAlert('XLSX 저장 실패: '+e.message); return; }
    /* 업무가 많으면 만드는 데 시간이 든다(2,000건 약 0.4초, 느린 PC 는 몇 배) — 멈춘 것처럼 보이지 않게 먼저 알리고
       한 번 그릴 틈을 준다. 적을 때는 금방 끝나 알릴 것이 없다. */
    if(count>=XLSX_BUSY_AT){ showToast('엑셀 파일을 만드는 중입니다…'); await new Promise(r=>setTimeout(r,30)); }
    let bytes;
    try{ bytes=Array.from(buildXlsx(XLSX, items, {now:new Date()})); }
    catch(e){ await appAlert('XLSX 저장 실패: '+(e&&e.message||e)); return; }
    const n=new Date();
    const name=`뭐하려했더라_업무목록_${n.getFullYear()}${String(n.getMonth()+1).padStart(2,'0')}${String(n.getDate()).padStart(2,'0')}.xlsx`;
    // XLSX.writeFile()은 브라우저의 blob+<a download> 다운로드에 의존하는데,
    // Tauri 창은 그걸 받아줄 다운로드 관리자가 없어 조용히 아무 일도 안 일어난다
    // (JSON 백업도 같은 이유로 안 됐던 것과 동일한 원인) — 바이트를 직접 뽑아
    // 네이티브 저장 대화상자로 넘긴다. (F14: 바이트는 Uint8Array 로 받아 Array.from — buildXlsx 가 Uint8Array 를 돌려준다)
    try{
      const saved=await invoke('save_binary_file', {suggestedName:name, data:bytes});
      if(saved) showToast('XLSX 파일을 저장했습니다');
    }catch(e){ await appAlert('XLSX 저장 실패: '+e); }
  });

  /* 저장 위치 변경 */
  $('dataDirBtn').addEventListener('click', async e=>{
    e.preventDefault();
    let cur; try{ cur=await invoke('get_data_dir'); }catch(err){ await appAlert('저장 위치 확인 실패: '+err); return; }
    if(!await appConfirm(`현재 저장 위치:\n${cur}\n\n다른 위치로 변경할까요?\n(아무 위치나 고르시면 그 안에 전용 폴더를 새로 만듭니다. 데이터는 다음 재시작 때 그 시점의 최신 상태 그대로 새 위치로 옮겨집니다)`))return;
    let picked; try{ picked=await invoke('choose_data_dir'); }catch(err){ await appAlert('위치 선택 실패: '+err); return; }
    if(!picked)return; // 취소함
    if(await appConfirm(`새 저장 위치가 예약되었습니다:\n${picked}\n\n다시 시작할 때 데이터가 새 위치로 옮겨집니다. 지금 재시작할까요?\n(나중에 재시작해도 그때까지의 수정 내용이 전부 함께 옮겨지니 안전합니다)`)){
      invoke('restart_app');
    }
  });

  /* 백업/복원 */
  $('bkExp').addEventListener('click',e=>{ e.preventDefault(); doBackup(); });

  /* 백업에서 복원 — JSON 백업과 DB(.sqlite) 파일 중 아무거나 하나의 파일 선택창으로
     고를 수 있다. JSON은 즉시 반영(재시작 불필요), DB 파일은 통째로 교체 후
     재시작이 필요하다(저장 위치 변경과 동일한 이유 — 열려있는 SQLite 연결을
     그대로 두고 파일만 바꾸는 게 아니라, 안전하게 다시 여는 쪽이 단순하고
     확실하다). */
  $('bkImp').addEventListener('click', async e=>{
    e.preventDefault();
    let result;
    try{ result=await invoke('import_backup_file'); }
    catch(err){ await appAlert('복원 실패: '+err); return; }
    if(result.kind==='Cancelled')return;

    if(result.kind==='Json'){
      let d;
      try{ d=JSON.parse(result.content); if(!Array.isArray(d.items))throw 0; }
      catch{ await appAlert('백업 파일 형식이 올바르지 않습니다.'); return; }
      if(!await appConfirm(`백업 파일에 업무 ${d.items.length}건이 들어 있습니다.\n현재 데이터를 덮어쓰고 복원할까요?`))return;
      // 구버전 백업 호환은 프론트 책임: 아이템 마이그레이션 + 빠진 섹션은
      // 현재 값으로 채워서 완전한 payload를 만든 뒤, Rust의 backup_import로
      // 모든 테이블을 "한 트랜잭션"에 복원한다. (예전 방식은 items는 save_all,
      // 나머지는 각각 따로 fire-and-forget으로 흩어 저장해서, 중간에 앱이
      // 종료되면 반쪽짜리 상태가 남을 수 있었다.)
      const migrated=d.items.map(migrateItem);
      const payload={
        v:5, exported:d.exported||new Date().toISOString(),
        fields:Array.isArray(d.fields)?d.fields:S.fields,
        presets:Array.isArray(d.presets)?d.presets:S.presets,
        idKinds:Array.isArray(d.idKinds)?d.idKinds:S.idKinds,
        /* 임시 상태는 들어오지도 나가지도 않는다(v2.6.2) — 내보낼 때 빼는 것과 대칭.
           손으로 고친 파일이나 예전 개발 빌드가 만든 백업에 초안이 들어 있어도,
           복원 직후 "저장한 적 없는 내용"이 되살아나지 않게 여기서 한 번 더 턴다. */
        settings:stripTemp((d.settings&&typeof d.settings==='object')?d.settings:S.settings),
        recurDefs:Array.isArray(d.recurDefs)?d.recurDefs:S.recurDefs,
        /* pre-v2.7 백업엔 phonebook 키가 없다 — 현재 값으로 채워 복원이 전화번호부를 비우지 않게 */
        phonebook:Array.isArray(d.phonebook)?d.phonebook:S.phonebook,
        items:migrated
      };
      let version;
      try{ version=await invoke('backup_import',{payload}); }
      catch(err){ await appAlert('백업 복원 실패 (데이터는 변경되지 않았습니다): '+err); return; }
      /* 복원은 번호표를 올린다(v3.3.7) — 새 번호를 받아 두지 않으면 아래 persist() 가 옛 번호로 저장해
         '낡은 화면'으로 거절되고, 비상 덤프 + "다른 창이 바꿨다"는 거짓 안내 + 새로고침이 뒤따른다. */
      if(typeof version==='number') S.dataVersion=version;
      /* 시작 때 읽기가 실패한 세션(F1 게이트가 닫힌 채)에서도 이 복원은 시작 안내가 권하는 길이다. 그 세션의 업무는 하나도
         저장된 적이 없는 것(잠긴 동안 미니 창 등으로 적은 것)뿐이라, 첫 읽기(main.js)와 같은 규칙으로 복원분 뒤에 붙여 지킨다. */
      const unsaved = S.loaded ? [] : S.items.filter(p=>!migrated.some(l=>l.id===p.id));
      // DB 복원이 성공한 뒤에만 메모리 상태를 갈아끼운다
      S.items=migrated.concat(unsaved);
      /* DB 와 화면이 이제 같은 데이터이므로 게이트를 연다 — 열지 않으면 복원 뒤 고친 것이 모두 말없이 저장되지 않았다(배너도 없이). */
      S.loaded=true;
      /* v3.6.0: 복원은 DB 를 통째로 갈아끼운다(backup_import 는 전체 교체). 그 전에 쌓인
         '완료 업무 변경 표시'는 이제 없는 데이터를 가리키므로 반드시 비운다 — 남겨두면
         다음 저장에서 deletedDone 으로 나가 **id 가 겹치는 엉뚱한 완료 업무를 지운다.** */
      S.doneDirty.clear();
      /* 위에서 붙인 저장된 적 없는 업무 가운데 완료한 것은 다시 표시한다 — 증분 저장은 완료 업무를 doneDirty 에 있을 때만 보내므로,
         빼면 화면에는 있는데 DB 에 들어가지 않아 다음 시작에 사라진다(첫 읽기는 doneDirty 를 비우지 않아 그대로 저장된다).
         이 업무들은 복원분과 id 가 겹치지 않는 것만 골랐으니 위 ⚠️(엉뚱한 업무 지우기)에 걸리지 않는다. */
      for(const p of unsaved) if(p.done) S.doneDirty.add(p.id);
      S.imported.fields=payload.fields;
      S.imported.presets=payload.presets;
      S.imported.idKinds=payload.idKinds;
      S.imported.settings=payload.settings;
      S.imported.recurDefs=payload.recurDefs;
      S.imported.phonebook=payload.phonebook;
      reconcileImported(); persist();
      showToast(`백업 ${migrated.length}건을 복원했습니다`);
      return;
    }

    // result.kind === 'Db' — 검증·대기 등록까지만 된 상태. JSON 쪽과 같은
    // 문구·같은 확인 절차를 거치고, 거절하면 대기 등록을 실제로 취소한다.
    if(!await appConfirm(`백업 파일에 업무 ${result.items}건이 들어 있습니다.\n현재 데이터를 덮어쓰고 복원할까요?\n(DB 파일 복원은 재시작할 때 적용됩니다)`)){
      /* 취소 = 대기 파일 지우기. 실패를 삼키면 '취소했습니다'라고 보여 놓고 다음 실행 때 사용자가 거절한
         복원이 그대로 적용된다 — 잠깐 쥔 파일(백신 등)일 수 있으니 한 번 더 해 보고, 그래도 안 되면 알린다. */
      let err=null;
      for(let i=0;i<2;i++){
        try{ await invoke('cancel_pending_import'); err=null; break; }
        catch(e){ err=e; await new Promise(r=>setTimeout(r,400)); }
      }
      if(err){
        await appAlert('복원 취소에 실패했습니다: '+err+'\n\n이대로 두면 다음에 앱을 다시 시작할 때 이 복원이 적용됩니다.\n'+
          '앱을 끄기 전에 데이터 폴더의 data\\wmhh.sqlite.pending-import 파일을 지워 주세요.\n([설정] → [저장 위치]에서 데이터 폴더 위치를 볼 수 있습니다)');
        return;
      }
      showToast('복원을 취소했습니다');
      return;
    }
    if(await appConfirm('지금 재시작할까요?')){
      invoke('restart_app');
    }else{
      await appAlert('다음에 앱을 다시 시작하면 복원이 적용됩니다.');
    }
  });
}

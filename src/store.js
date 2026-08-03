/* =========================================================================
   저장 계층 — Rust(SQLite) 백엔드에 Tauri invoke()로 위임.
   실제 값은 모두 SQLite가 단일 진실 공급원이며, 브라우저 저장소(localStorage/
   IndexedDB)는 더 이상 쓰지 않는다.
   ========================================================================= */
import {S, backupObj} from './state.js';
import {showSaveError, clearSaveError, appAlert} from './dom-utils.js';

export const { invoke } = window.__TAURI__.core;

/* ── v3.3.4 저장 실패 복구 ────────────────────────────────────────────────
   예전에는 저장이 실패하면 그 배치를 **버렸다**(_pending 을 비운 뒤 invoke 했고,
   catch 는 경고만 켰다). 화면에는 변경이 남아 있으니 사용자는 저장된 줄 알고
   계속 일하다가 앱을 닫고, 그 사이 작업분은 통째로 사라졌다.

   저장 실패의 실제 원인 대부분(백신 실시간 검사·클라우드 동기화 폴더·탐색기
   미리보기가 파일을 잠깐 쥠)은 **잠시 뒤면 풀리는** 것들이다. 그래서 실패한
   배치는 되돌려 놓고 점점 늦춰가며 계속 다시 시도한다 — 포기하지 않는다.
   Rust 쪽 짧은 재시도(db::with_write_retry, 초 단위 이내)와 한 쌍이며,
   이쪽은 분 단위까지 버틴다. */
const RETRY_DELAYS=[1000,2000,4000,8000,15000,30000];   // 이후 30초 간격 유지
const DUMP_AFTER=3;                                     // 연속 실패 N회 → 비상 덤프
let retryTimer=null, failStreak=0, dumped=false;

/* 저장이 계속 안 될 때의 마지막 그물 — DB 를 건너뛰고 현재 데이터를 JSON
   파일로 떨군다(데이터 폴더 안 emergency/). 평범한 백업과 같은 형태라
   [설정]→[JSON·DB파일 불러오기]로 그대로 복원된다.
   사람이 안내를 못 보고 앱을 닫아도 데이터는 디스크에 남는다는 것이 요점이라
   사용자 확인을 받지 않는다. 한 실패 구간에 한 번만 쓴다. */
async function emergencyDump(){
  if(failStreak<DUMP_AFTER || dumped) return;
  dumped=true;
  try{
    const path=await invoke('emergency_dump',{json:JSON.stringify(backupObj(),null,1)});
    console.warn('비상 덤프 저장됨:',path);
    showSaveError(path);
  }catch(e){ console.warn('비상 덤프 실패',e); dumped=false; }   // 다음 실패 때 다시 시도
}

/* 낡은 화면의 저장이 거절됐을 때 (v3.3.7).
   여기서 중요한 건 **아무것도 잃지 않는 것**이다: 지금 화면 내용을 먼저 파일로
   떨구고(비상 덤프와 같은 형식이라 [불러오기]로 되살릴 수 있다), 그다음 최신
   데이터로 화면을 새로 연다. 화면을 그냥 두면 사용자는 계속 낡은 내용을 고치게 되고
   저장은 매번 거절된다 — 그게 더 나쁘다.
   ⚠️ 자동으로 병합하지 않는다. 어느 쪽이 옳은지는 사람만 안다. */
let staleHandled=false;
async function onStale(res){
  if(staleHandled) return;            // 한 번만 — 여러 저장이 동시에 거절될 수 있다
  staleHandled=true;
  let saved='';
  try{ saved = await invoke('emergency_dump',{json:JSON.stringify(backupObj(),null,1)}); }
  catch(e){ console.warn('거절 시 화면 내용 보관 실패',e); }
  console.warn('낡은 화면의 저장이 거절됨', res);
  /* 안내창이 실패해도 최신을 다시 읽는 것까지는 반드시 한다 — 화면을 낡은 채로
     두면 사용자가 계속 그 위에서 고치고, 저장은 매번 거절된다. */
  try{ await showStaleNotice(saved); }catch(e){ console.warn('거절 안내 실패',e); }
  try{ location.reload(); }catch(e){ console.warn('다시 읽기 실패',e); }
}

async function showStaleNotice(saved){
  await appAlert(
    '다른 창(또는 예전에 켜둔 앱)이 데이터를 바꿔서, 이 화면의 내용은 낡은 상태입니다.\n'+
    '덮어쓰면 그쪽 작업이 사라지므로 저장하지 않았습니다.\n\n'+
    (saved ? '이 화면의 내용은 파일로 남겨두었습니다:\n'+saved+'\n\n' : '')+
    '확인을 누르면 최신 데이터를 다시 불러옵니다.',
    '저장하지 않았습니다');
}

export const STORE = {
  _saving:null, _pending:null,

  /* fields/presets/idKinds/settings는 S.imported 로 비동기 전달되고,
     초기 로드(main.js)가 reconcileImported()를 호출해 그 값을 반영한다
     (기존 IndexedDB 버전도 동일한 패턴이었다 — 동기 기본값으로 시작,
     STORE.load() 완료 후 진짜 값으로 교체). */
  /* v3.4.1: 첫 로드는 **한 번 실패했다고 포기하지 않는다.** 앱을 껐다 곧바로 켜면
     이전 프로세스가 파일을 쥔 찰나가 있고(백신 스캔·네트워크 드라이브도 같은 결),
     그때 한 번 실패했다는 이유로 "DB를 못 열었습니다 / 껐다 켜세요" 경고를 띄우면
     실제로는 멀쩡한데 사용자만 놀란다. Rust 쪽은 이미 열기·무결성 검사에 재시도가
     있으므로(v3.3.1·v3.3.9), 프런트도 같은 태도를 취해 짧게 몇 번 더 물어본다.
     그래도 안 되면 그때 안내한다(= 진짜 문제). */
  async load(){
    let state, lastErr;
    for(let i=0; i<4; i++){
      try{ state = await invoke('load_all'); lastErr=null; break; }
      catch(e){ lastErr=e; console.warn(`load_all 시도 ${i+1} 실패`, e);
        await new Promise(r=>setTimeout(r, 400)); }
    }
    if(lastErr) throw lastErr;
    /* v3.3.7 번호표를 함께 받는다 — 이 시점의 데이터를 보고 있다는 표식 */
    S.dataVersion = Number(state.dataVersion) || 0;
    if(Array.isArray(state.fields)) S.imported.fields=state.fields;
    if(Array.isArray(state.presets)) S.imported.presets=state.presets;
    if(Array.isArray(state.idKinds)) S.imported.idKinds=state.idKinds;
    if(state.settings && typeof state.settings==='object') S.imported.settings=state.settings;
    if(Array.isArray(state.recurDefs)) S.imported.recurDefs=state.recurDefs;
    if(Array.isArray(state.phonebook)) S.imported.phonebook=state.phonebook;
    return Array.isArray(state.items)?state.items:[];
  },

  async saveAll(items){
    if(!S.loaded) return;                     // F1: 초기 로드 완료 전 저장 차단 (기존 데이터 소실 방지)
    this._pending=items;
    return this._run();
  },

  /* 대기 중인 배치가 있으면 비행을 시작한다(이미 비행 중이면 그 프로미스).
     saveAll·재시도 타이머·flush 가 공유하는 단 하나의 진입점이라, 어느 경로로
     들어와도 동시에 두 번 저장되지 않는다. 이 프로미스는 **거절되지 않는다** —
     실패는 배너·재시도로 다루지, 호출한 화면 코드를 깨뜨리지 않는다. */
  _run(){
    if(this._saving) return this._saving;     // 진행 중 배치의 프로미스를 돌려줘 await가 실제로 완료를 기다리게
    if(!this._pending) return Promise.resolve();
    this._saving=(async()=>{
      try{
        while(this._pending){
          const data=this._pending; this._pending=null;
          /* v3.6.0 증분 저장 — 완료 업무 행은 Rust 가 손대지 않는다. 그러니 보낼 것은
             **미완료 전부 + 이번에 변화가 생긴 완료 업무**이고, 지워 없앤 완료 업무는
             id 만 따로 알려준다('목록에 없다'가 지웠다는 뜻인지 원래 안 보낸다는 뜻인지
             Rust 가 구분할 수 없기 때문). 이렇게 하면 저장 비용이 누적 업무 수가 아니라
             '지금 다루는 업무 수'에만 비례한다. */
          const dirty=[...S.doneDirty];
          const alive=new Set(data.map(it=>it.id));
          const send=data.filter(it=>!it.done || S.doneDirty.has(it.id));
          const deletedDone=dirty.filter(id=>!alive.has(id));
          let res;
          try{
            res = await invoke('save_all', {items:send, deletedDone, baseVersion:S.dataVersion});
          }catch(e){
            /* 핵심: 실패한 배치를 버리지 않는다. 그 사이 더 새 배치가 들어왔다면
               그쪽이 이 내용을 이미 포함하므로(전체 교체 저장) 덮어쓰지 않는다. */
            if(!this._pending) this._pending=data;
            throw e;
          }
          /* v3.3.7: 거절(Stale)은 **오류가 아니다** — 낡은 화면이 최신 데이터를
             덮으려 했고 막힌 것이다. 재시도하면 같은 낡은 내용을 계속 밀어 넣는
             꼴이 되므로, 대기열을 비우고 화면 내용을 파일로 남긴 뒤 최신을 다시 읽는다.
             ⚠️ 이 처리는 위 catch **밖**이어야 한다. 안에 두면 안내창이 실패했을 때
             그 catch 가 낡은 배치를 대기열에 되돌려 영원히 재시도하게 된다. */
          if(res && res.kind==='Stale'){ this._pending=null; await onStale(res); return; }
          if(res && typeof res.version==='number') S.dataVersion = res.version;
          /* 저장된 배치에 실렸던 것만 지운다 — 비행 중에 새로 생긴 표시는 남겨서
             다음 배치에 실린다. 실패하면(위 catch) 하나도 지우지 않으므로 재시도에
             그대로 다시 실린다(`_pending` 을 되돌리는 규칙과 같은 성질). */
          dirty.forEach(id=>S.doneDirty.delete(id));
        }
        failStreak=0; dumped=false;
        clearTimeout(retryTimer); retryTimer=null;
        clearSaveError();                       // 아이템 저장 성공 = 쓰기가 다시 됨 → 경고 해제(성공은 조용히)
      }catch(e){                                // 실패는 눈에 보이게 + 조용히 계속 재시도
        console.warn('저장 실패',e); showSaveError();
        failStreak++;
        this._scheduleRetry();
        emergencyDump();
      }
      finally{ this._saving=null; }
    })();
    return this._saving;                       // await STORE.saveAll(...) 가 실제 저장 완료까지 대기
  },

  _scheduleRetry(){
    if(retryTimer || !this._pending) return;
    const wait=RETRY_DELAYS[Math.min(failStreak-1, RETRY_DELAYS.length-1)];
    retryTimer=setTimeout(()=>{ retryTimer=null; this._run(); }, wait);
  },

  /* 지금 당장 디스크까지 밀어 넣는다 — 종료 직전(main.js 의 request-quit)용.
     대기를 기다리지 않고 즉시 한 번 더 시도하며, 전부 기록됐는지를 돌려준다.
     종료 경로에서 이걸 부르지 않으면, 재시도를 기다리던 변경분이 말없이 사라진다. */
  async flush(){
    clearTimeout(retryTimer); retryTimer=null;
    await this._run();
    if(this._pending) await this._run();     // 실패로 되돌아온 배치를 즉시 한 번 더
    /* v3.4.2: 사이드카(설정·전화번호부 등)도 함께 밀어 넣는다 — 재시도를 기다리던
       변경분이 종료로 사라지지 않게(아이템과 같은 이유). 실패해도 종료는 막지 않는다. */
    const pendingSide=Object.keys(this._side).filter(k=>this._side[k] && this._side[k].args);
    for(const k of pendingSide){
      const cur=this._side[k];
      if(cur.timer){ clearTimeout(cur.timer); cur.timer=null; }
      try{ await invoke(cur.cmd, cur.args); cur.args=null; }
      catch(e){ console.warn(`${cur.label} 최종 저장 실패`, e); }
    }
    return !this._pending;                   // true = 남은 것 없음
  },

  /* 사이드카 저장(필드·프리셋·식별정보 명칭·설정·전화번호부).
     v3.4.2: **아이템 저장과 같은 태도로 재시도한다.** 예전엔 실패하면 경고 배너만
     켜고 끝이라, 일시적 잠금(껐다 켠 직후·백신 스캔) 한 번에 전화번호부 추가나
     설정 변경이 조용히 사라질 수 있었다(다음 저장이 덮어쓰기 전에 앱을 닫으면 유실).
     종류별로 **마지막 값 하나만** 들고 재시도한다 — 이 저장들은 전체 교체라
     중간 값을 다시 보낼 이유가 없고, 그래야 큐가 불어나지 않는다.
     성공해도 경고 배너를 끄지는 않는다 — 설정 저장 성공이 아이템 저장 실패를
     가리면 안 되므로, 해제는 아이템 저장(save_all) 성공만 담당한다. */
  _side:{},                                  // kind -> {cmd, args, tries, timer}
  _saveSide(kind, cmd, args, label){
    if(!S.loaded) return;
    const cur=this._side[kind] || (this._side[kind]={tries:0, timer:null});
    cur.cmd=cmd; cur.args=args; cur.label=label;      // 항상 최신 값으로 갱신
    if(cur.timer){ clearTimeout(cur.timer); cur.timer=null; }
    this._runSide(kind);
  },
  _runSide(kind){
    const cur=this._side[kind]; if(!cur||!cur.args) return;
    const {cmd, args}=cur;
    invoke(cmd, args).then(()=>{
      /* 성공: 이 종류의 대기를 비운다. 그 사이 더 새 값이 들어왔다면 그 값이
         args 에 들어와 있으므로, 보낸 것과 같을 때만 비운다. */
      if(this._side[kind] && this._side[kind].args===args){
        this._side[kind].args=null; this._side[kind].tries=0;
      }
    }).catch(e=>{
      console.warn(`${cur.label} 저장 실패`, e);
      showSaveError();
      cur.tries++;
      const wait=RETRY_DELAYS[Math.min(cur.tries-1, RETRY_DELAYS.length-1)];
      cur.timer=setTimeout(()=>{ cur.timer=null; this._runSide(kind); }, wait);
    });
  },
  saveFields(f){ this._saveSide('fields','save_fields',{fields:f},'필드'); },
  savePresets(p){ this._saveSide('presets','save_presets',{presets:p},'프리셋'); },
  saveIdKinds(k){ this._saveSide('idKinds','save_id_kinds',{idKinds:k},'식별정보 명칭'); },
  saveSettings(s){ this._saveSide('settings','save_settings',{settings:s},'설정'); },
  savePhonebook(p){ this._saveSide('phonebook','save_phonebook',{phonebook:p},'전화번호부'); },

  /* 화면 크기(v2.5.15) — 데이터 저장이 아니라 웹뷰 배율 적용이므로 F1 로드
     게이트를 걸지 않는다(로드 완료 전에도 저장된 크기를 그대로 보여줘야 한다). */
  setUiScale(n){ invoke('set_ui_scale', {scale:n}).catch(e=>console.warn('화면 크기 적용 실패',e)); }
};

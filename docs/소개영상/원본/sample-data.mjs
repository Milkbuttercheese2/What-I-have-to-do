// 소개영상 갈무리용 예시 데이터 — 사용 설명서 갈무리(tools/guide-shots.mjs)의 예시 데이터에
// 관계도가 보이도록 엮인 업무 몇 건을 더한다. 전부 가상의 예시다(실제 업무 아님).
export function makeInit(gs){
  let INIT=gs.slice(gs.indexOf('const INIT = `')+14, gs.indexOf('})()`;')+4);
  INIT=INIT.replace("mk({id:6,memo:'완료된 복합기 임차계약 종료 정산',done:true,f:{received:iso,due:at(-1,10,0)}}),",
   "mk({id:6,memo:'완료된 복합기 임차계약 종료 정산',done:true,doneAt:Date.now()-3600e3,f:{received:iso,due:at(-1,10,0)}}),"+
   "mk({id:8,memo:'청사 전기설비 유지관리 용역 착수계 접수',done:true,doneAt:Date.now()-86400e3*12,contacts:[{who:'김계약 주무관',org:'시설관리과',phone:'02-0000-1201',email:''}],ids:[{kind:'계약번호',val:'2026-시설-용역-014'}]}),"+
   "mk({id:9,memo:'전기설비 용역 1차 기성금 지급',done:true,doneAt:Date.now()-86400e3*5,ids:[{kind:'계약번호',val:'2026-시설-용역-014'}]}),"+
   "mk({id:10,memo:'시설관리과 냉난방기 교체 견적 문의 회신',contacts:[{who:'김계약 주무관',org:'시설관리과',phone:'02-0000-1201',email:''}]}),"+
   "mk({id:11,memo:'청소용역 제안서 평가위원 위촉',contacts:[{who:'박조달 주무관',org:'조달계약과',phone:'02-0000-1202',email:''}],ids:[{kind:'입찰공고번호',val:'R26BK0100'}]}),"+
   "mk({id:12,memo:'청소용역 입찰공고 정정 공고',ids:[{kind:'입찰공고번호',val:'R26BK0100'}],done:true,doneAt:Date.now()-86400e3*3}),"+
   "mk({id:13,memo:'청소용역 개찰결과 확인 및 적격심사',contacts:[{who:'박조달 주무관',org:'조달계약과',phone:'02-0000-1202',email:''}],ids:[{kind:'입찰공고번호',val:'R26BK0100'}]}),"+
   "mk({id:14,memo:'청소용역 계약체결 및 보증서 접수',contacts:[{who:'최회계 주무관',org:'회계과',phone:'02-0000-1203',email:''},{who:'박조달 주무관',org:'조달계약과',phone:'02-0000-1202',email:''}],ids:[{kind:'계약번호',val:'2026-청소-001'}]}),"+
   "mk({id:15,memo:'청소용역 선금 지급 요청 검토',contacts:[{who:'최회계 주무관',org:'회계과',phone:'02-0000-1203',email:''}],ids:[{kind:'계약번호',val:'2026-청소-001'}]}),"+
   "mk({id:16,memo:'회계과 지출결의 서류 보완 회신',contacts:[{who:'최회계 주무관',org:'회계과',phone:'02-0000-1203',email:''}],done:true,doneAt:Date.now()-86400e3*8}),"+
   "mk({id:17,memo:'전기설비 용역 2차 기성 검사',ids:[{kind:'계약번호',val:'2026-시설-용역-014'}]}),"+
   "mk({id:18,memo:'주간 계약현황 보고 (11/2)',recurId:7,done:true,doneAt:Date.now()-86400e3*5}),"+
   "mk({id:19,memo:'주간 계약현황 보고 (11/9)',recurId:7}),"+
   "mk({id:20,memo:'시설관리과 승강기 유지보수 계약 연장 협의',contacts:[{who:'김계약 주무관',org:'시설관리과',phone:'02-0000-1201',email:''}],done:true,doneAt:Date.now()-86400e3*20}),");
    INIT=INIT.replace("getVersion:async()=>'3.6.1'","getVersion:async()=>'3.7.0'");
  return INIT;
}

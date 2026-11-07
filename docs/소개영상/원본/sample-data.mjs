// 소개영상 갈무리용 예시 데이터. 시나리오 "서비스계약과 박조달 주무관의 하루"(script.mjs).
// 사람·부서는 조달청 직제(「조달청과 그 소속기관 직제 시행규칙」)에 맞췄다.
//   서비스계약과(기술서비스국)   = 일반용역(학술연구·폐기물처리·운송 등) 총액계약·다수공급자계약 → 주인공
//   디지털조달관리과(디지털공정조달국) = 조달정보화시스템(나라장터)의 개발·운영·관리 → 장애 문의 상대
// 사람 이름·수요기관(한빛시·한빛세무서)·번호는 전부 가상의 예시다(실제 업무 아님).
// makeInit(gs) 는 사용 설명서 갈무리(tools/guide-shots.mjs)의 가짜 Tauri 부분만 빌려 쓴다.

/* 2쪽 보기에서 펼치는 긴 메모 — 기술평가위원회 회의 메모(im-not-ai light 경로 통과, 변경 0%) */
export const BOOK_MEMO = `청사관리 통합용역 기술평가위원회 회의 메모

1. 개요
- 일시: 11월 6일(목) 14:00~17:20
- 장소: 정부대전청사 조달청 평가실
- 대상: 한빛세무서 청사관리 통합용역(시설관리·청소·경비), 협상에 의한 계약
- 평가 방식: 기술능력 80점, 입찰가격 20점
- 제안사: 4개사 참여, 제출 순서대로 발표(업체별 발표 20분, 질의응답 15분)

2. 위원 구성
- 위원 7명(외부 5명, 내부 2명), 위원장은 위원 간 호선으로 선출
- 제척·기피 대상 여부 서약서 7부 받음
- 평가 전 보안 서약서와 청렴 서약서 함께 받음

3. 진행 순서
- 14:00 개회, 평가 방법과 배점표 설명
- 14:20 제안사 발표 시작(가사, 나사, 다사, 라사 순)
- 16:40 위원별 채점표 작성
- 17:00 채점표 회수, 점수 합산
- 17:20 폐회

4. 위원 질의 요지
- 가사: 현재 근무 중인 미화원 고용승계 계획이 구체적인지 질의
  답변은 전원 승계, 다만 정년 도래자 2명은 별도 협의
- 나사: 야간 경비 인원을 2명에서 1명으로 줄인 근거 질의
  무인경비 시스템 도입으로 보완한다고 답변했으나 위원 3명이 미흡하다고 판단
- 다사: 승강기·전기설비 법정 점검 일정표가 제안서에 빠져 있음
  협상 단계에서 보완하기로 함
- 라사: 노임단가를 시중노임단가보다 낮게 적은 항목이 있음
  용역근로자 근로조건 보호지침 위반 소지, 협상 때 반드시 확인

5. 평가 결과(기술능력, 80점 만점)
- 가사 71.4점
- 나사 63.2점
- 다사 69.8점
- 라사 66.1점
- 협상적격자 기준은 기술능력 배점의 85%(68점) 이상
- 기술점수만으로는 가사, 다사가 기준을 넘음
- 가격점수를 합산한 종합점수 순으로 협상 순위를 정함

6. 협상 때 확인할 것
- 고용승계 대상자 명단과 승계 조건을 서면으로 받기
- 법정 점검 일정표를 과업내용서에 맞춰 다시 받기
- 노임단가 산출 근거 다시 확인
- 가격 개찰은 11월 7일 10:00, 개찰 후 바로 종합점수 산정
- 착수일은 12월 1일, 인수인계 기간 1주 반영 여부 확인

7. 후속 조치
- 평가 결과 나라장터 게시(평가위원 명단은 계약 후 공개)
- 우선협상대상자에게 협상 일정 통보
- 협상 결과 보고 후 계약 체결
- 한빛세무서 운영지원과에 진행 상황 공유
- 개찰이 늦어지면 제안사에 지연 사유와 새 개찰 일시 안내

8. 기타
- 위원 수당 지급 서류는 회계 담당에 넘김
- 채점표 원본은 봉투에 봉인해 문서고에 보관
- 다음 평가위원회는 폐기물 수집·운반 용역 재공고 건`;

const P = {
  jeongbo: "{who:'김정보 주무관',org:'디지털조달관리과',phone:'042-000-1201',email:'j.info@example.go.kr'}",
  yongyeok: "{who:'정용역 주무관',org:'서비스계약과',phone:'042-000-1202',email:''}",
  jawon: "{who:'최자원 주무관',org:'한빛시 자원순환과',phone:'042-000-1203',email:'c.recycle@example.go.kr'}",
  semu: "{who:'오세무 주무관',org:'한빛세무서 운영지원과',phone:'042-000-1205',email:''}",
};
const GONGGO = "{kind:'입찰공고번호',val:'R26BK01170042'}";      // 청사관리 통합용역
const GYEYAK_W = "{kind:'계약번호',val:'2026-서비스-0314'}";      // 폐기물 수집·운반 용역
const GYEYAK_C = "{kind:'계약번호',val:'2026-서비스-0402'}";      // 청사관리 통합용역(계약 후)

export function makeInit(gs) {
  const tauri = gs.slice(gs.indexOf("  const noop=async()=>{};"), gs.indexOf("})()`;"));
  return `(()=>{
  const now=new Date();
  const at=(dd,hh,mm)=>{const d=new Date(now);d.setDate(d.getDate()+dd);d.setHours(hh,mm,0,0);return d.toISOString();};
  const iso=now.toISOString(); const D=86400e3;
  const mk=o=>Object.assign({id:1,memo:'',owner:'',f:{received:iso,due:''},contacts:[],ids:[],subs:[],files:[],done:false,staged:false,al:{},recur:null,recurId:null},o);
  const items=[
    mk({id:1,memo:'한빛세무서 요청, 청사관리 통합용역 과업내용서 변경안 검토',staged:true}),
    mk({id:2,memo:'폐기물 수집·운반 용역 계약변경 검토 후 수요기관에 회신\\n수거 대상 공동주택 3개 단지 추가, 차량 1대 증차 요청',f:{received:iso,due:at(0,17,0)},
      contacts:[${P.jawon}],ids:[${GYEYAK_W}],
      files:['C:\\\\서비스계약\\\\2026\\\\폐기물 수집운반 용역_계약변경_검토서.xlsx'],
      subs:[{id:21,title:'변경 사유서와 산출내역서 대조',mid:at(0,16,0),done:false,al:null,owner:''}]}),
    mk({id:3,memo:'청사관리 통합용역 기술평가위원회 결과 정리',f:{received:iso,due:at(4,10,0)},ids:[${GONGGO}],
      subs:[{id:30,title:'평가위원 위촉 공문 발송',mid:at(-1,10,0),done:true,al:null,owner:''},
            {id:31,title:'우선협상대상자에 협상 일정 통보',mid:at(1,9,30),done:false,al:null,owner:'정용역 주무관'}]}),
    mk({id:4,memo:'교통량 조사 학술연구용역 수의계약 견적서 검토 결과 보고',f:{received:iso,due:at(6,15,0)}}),
    mk({id:5,memo:'청사관리 통합용역 입찰공고 정정 요청사항 확인',f:{received:iso,due:at(0,14,0)},ids:[${GONGGO}],
      subs:[{id:51,title:'공고문 정정 사유 확인',mid:at(0,13,0),done:false,al:null,owner:'정용역 주무관'}]}),
    mk({id:6,memo:'청사 복합기 임차용역 종료 정산',done:true,doneAt:Date.now()-3600e3,f:{received:iso,due:at(-1,10,0)}}),
    mk({id:7,memo:'매주 월요일 일반용역 계약현황 보고자료 취합',recur:{type:'dow',dow:[1],time:'09:00',next:at(3,9,0),paused:false}}),
    mk({id:8,memo:'청사관리 통합용역 입찰공고 게시',done:true,doneAt:Date.now()-D*12,ids:[${GONGGO}]}),
    mk({id:9,memo:'폐기물 수집·운반 용역 1차 기성금 지급 확인',done:true,doneAt:Date.now()-D*5,contacts:[${P.jawon}],ids:[${GYEYAK_W}]}),
    mk({id:10,memo:'나라장터 제안서 파일 업로드 오류 문의, 원인 회신 받음',done:true,doneAt:Date.now()-D*9,contacts:[${P.jeongbo}]}),
    mk({id:11,memo:'전자입찰 장애 발생 시 처리 절차 디지털조달관리과와 확인',contacts:[${P.jeongbo}]}),
    mk({id:12,memo:'청사관리 통합용역 입찰공고 정정 공고',done:true,doneAt:Date.now()-D*3,ids:[${GONGGO}]}),
    mk({id:13,memo:'청사관리 통합용역 가격 개찰 및 종합점수 산정',contacts:[${P.yongyeok}],ids:[${GONGGO}]}),
    mk({id:14,memo:'청사관리 통합용역 계약체결 및 보증서 접수',contacts:[${P.semu}],ids:[${GYEYAK_C}]}),
    mk({id:15,memo:'청사관리 통합용역 선금 지급 요청 검토',contacts:[${P.semu}],ids:[${GYEYAK_C}]}),
    mk({id:16,memo:'용역근로자 근로조건 보호 확약서 접수',done:true,doneAt:Date.now()-D*8,ids:[${GYEYAK_W}]}),
    mk({id:17,memo:'폐기물 수집·운반 용역 2차 기성 검사',contacts:[${P.jawon}],ids:[${GYEYAK_W}]}),
    mk({id:18,memo:'주간 계약현황 보고 (11/2)',recurId:7,done:true,doneAt:Date.now()-D*5}),
    mk({id:19,memo:'주간 계약현황 보고 (11/9)',recurId:7}),
    mk({id:20,memo:'나라장터 다수공급자계약 2단계경쟁 화면 개선 요청 회신',done:true,doneAt:Date.now()-D*20,contacts:[${P.jeongbo}]}),
  ];
  const phonebook=[{id:901,who:'김정보 주무관',org:'디지털조달관리과',phone:'042-000-1201',email:'j.info@example.go.kr'},
                   {id:902,who:'이시스 주무관',org:'디지털조달관리과',phone:'042-000-1204',email:''},
                   {id:903,who:'정용역 주무관',org:'서비스계약과',phone:'042-000-1202',email:''},
                   {id:904,who:'최자원 주무관',org:'한빛시 자원순환과',phone:'042-000-1203',email:'c.recycle@example.go.kr'},
                   {id:905,who:'오세무 주무관',org:'한빛세무서 운영지원과',phone:'042-000-1205',email:''}];
  let store={items,phonebook,fields:null,
    presets:[{label:'용역 계약변경 검토',memo:'○○ 용역 계약변경 요청 접수, 변경 사유와 산출내역 검토',subs:[]},
             {label:'입찰공고 정정 확인',memo:'나라장터 입찰공고 정정 사유와 변경사항 확인',subs:[]}],
    idKinds:['계약번호','입찰공고번호'],settings:{alarmOn:false,boardMode:'time',captureDraft:''},recurDefs:[]};
${tauri}})()`.replace("getVersion:async()=>'3.6.1'", "getVersion:async()=>'3.7.1'")
   .replace("'C:\\\\\\\\조달계약\\\\\\\\2026\\\\\\\\입찰공고_정정사유서.hwp'", "'C:\\\\서비스계약\\\\2026\\\\과업내용서_변경대비표.hwp'");
}

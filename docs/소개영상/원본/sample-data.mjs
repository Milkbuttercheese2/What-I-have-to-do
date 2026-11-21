// 소개영상 갈무리용 예시 데이터. 시나리오 "디지털조달관리과 김정보 주무관의 하루"(script.mjs — 전자입찰 장애 대응).
// 부서는 「조달청과 그 소속기관 직제 시행규칙」에 맞췄다: 디지털조달관리과(디지털공정조달국) = 나라장터 등 조달정보화시스템 운영.
// 사람·업체·번호는 전부 가상의 예시다(실제 업무 아님).
// makeInit(gs) 는 사용 설명서 갈무리(tools/guide-shots.mjs)의 가짜 Tauri 를 빌리고, 문서 탭 커맨드(doc_*)를 덧붙인다 —
// 문서 파일은 갈무리 서버가 /__demo/ 로 내주는 demo-docs/ 의 실제 파일(한글 쪽 보기는 진짜 rhwp 가 그린다).
export const DOC_ROOT = "Z:\\디지털조달관리과";
export const DOCS = {
  "": [
    { name: "2026 나라장터 운영", rel: "2026 나라장터 운영", dir: true },
    { name: "참고 자료", rel: "참고 자료", dir: true },
  ],
  "2026 나라장터 운영": [
    { name: "회신 문서", rel: "2026 나라장터 운영/회신 문서", dir: true },
    { name: "센터 지정 회의 메모.md", rel: "2026 나라장터 운영/센터 지정 회의 메모.md" },
    { name: "장애 시간대 투찰 기록 조회.sql", rel: "2026 나라장터 운영/장애 시간대 투찰 기록 조회.sql" },
    { name: "장애 접수 목록.csv", rel: "2026 나라장터 운영/장애 접수 목록.csv" },
    { name: "장애 조치 결과 보고.hwpx", rel: "2026 나라장터 운영/장애 조치 결과 보고.hwpx" },
  ],
  "2026 나라장터 운영/회신 문서": [{ name: "세종시 질의 회신 초안.txt", rel: "2026 나라장터 운영/회신 문서/세종시 질의 회신 초안.txt" }],
  "참고 자료": [{ name: "이용자 등록 처리 기준.md", rel: "참고 자료/이용자 등록 처리 기준.md" }],
};

const P = {
  minjun: "{who:'김민준',org:'㈜한빛정보',phone:'010-2841-5530',email:''}",
  seoyeon: "{who:'박서연',org:'디지털조달관리과',phone:'042-724-7031',email:''}",
  jiwoo: "{who:'한지우',org:'나라장터 운영지원팀',phone:'1588-0800',email:''}",
  seojun: "{who:'윤서준',org:'조달청 감사담당관',phone:'042-724-7105',email:''}",
  jihoon: "{who:'최지훈',org:'부산전자조달지원센터',phone:'051-860-7714',email:''}",
  doyoon: "{who:'정도윤',org:'세종시 회계과',phone:'044-300-3912',email:''}",
};
const GONGGO = "{kind:'입찰공고번호',val:'R26BK01234567'}";
const JANGAE = "{kind:'장애번호',val:'장애-26-1121'}";

export function makeInit(gs) {
  const tauri = gs.slice(gs.indexOf("  const noop=async()=>{};"), gs.indexOf("})()`;"));
  const root = DOC_ROOT.replace(/\\/g, "\\\\");
  return `(()=>{
  const now=new Date();
  const at=(dd,hh,mm)=>{const d=new Date(now);d.setDate(d.getDate()+dd);d.setHours(hh,mm,0,0);return d.toISOString();};
  const iso=now.toISOString(); const D=86400e3;
  const doneAt=(dd,hh)=>{const d=new Date(now);d.setDate(d.getDate()+dd);d.setHours(hh,0,0,0);return d.getTime();};
  const mk=o=>Object.assign({id:1,memo:'',owner:'',f:{received:iso,due:''},contacts:[],ids:[],subs:[],files:[],done:false,staged:false,al:{},recur:null,recurId:null},o);
  const OP='${root}\\\\2026 나라장터 운영\\\\';
  const items=[
    mk({id:1,memo:'장애 조치 결과 보고서 정리',staged:true,files:[OP+'장애 조치 결과 보고.hwpx']}),
    mk({id:2,memo:'전자입찰 장애 — 투찰 화면 멈춤 (공고 R26BK01234567)\\n마감 30분 전 여러 업체 투찰 화면 멈춤. 원인 확인 → 장애 공지 → 마감 연기 검토',f:{received:at(0,15,32),due:at(0,18,0)},
      contacts:[${P.jiwoo}],ids:[${GONGGO},${JANGAE}],files:[OP+'장애 접수 목록.csv'],
      subs:[{id:21,title:'장애 접수·서버 로그 확인',mid:at(0,15,50),done:true,al:null,owner:''},{id:22,title:'장애 공지 게시',mid:at(0,16,30),done:false,al:null,owner:''},{id:23,title:'입찰 마감 연기 검토',mid:at(0,17,0),done:false,al:null,owner:''}]}),
    mk({id:3,memo:'입찰 연기 공고 게시 — R26BK01234567',ids:[${GONGGO}],contacts:[${P.seoyeon}],subs:[{id:31,title:'연기 공고 게시',mid:at(0,17,30),done:false,al:null,owner:'박서연'}]}),
    mk({id:4,memo:'이용자 등록 — ㈜한빛정보 인증서 재발급 문의 회신',f:{received:at(0,9,30),due:at(0,17,40)},contacts:[${P.minjun}]}),
    mk({id:5,memo:'부정 전자조달행위 신고 — 같은 IP 투찰 의심 3개사',contacts:[${P.seojun}],subs:[{id:51,title:'투찰 이력 쿼리',mid:at(0,18,20),done:false,al:null,owner:''}]}),
    mk({id:6,memo:'전자조달지원센터 지정 신청 서류 검토 (부산)',f:{received:iso,due:at(3,17,0)},contacts:[${P.jihoon}],files:[OP+'센터 지정 회의 메모.md']}),
    mk({id:7,memo:'정보공개 청구 — 2026 전자입찰 장애 현황',f:{received:iso,due:at(6,18,0)},ids:[{kind:'접수번호',val:'정공-26-3307'}]}),
    mk({id:8,memo:'혁신제품 시범사용 기관 매칭 회의',subs:[{id:81,title:'매칭 회의',mid:at(4,14,0),done:false,al:null,owner:''}]}),
    mk({id:9,memo:'상용SW 직접구매 대상 확인 — 세종시 질의 회신',contacts:[${P.doyoon},${P.seoyeon}],subs:[{id:91,title:'회신 초안',mid:at(2,10,0),done:false,al:null,owner:'박서연'}]}),
    mk({id:10,memo:'투찰 지연 업체 회신 목록 정리',staged:true}),
    mk({id:11,memo:'나라장터 이용자 문의 일괄 회신',done:true,doneAt:doneAt(0,11),contacts:[${P.minjun}]}),
    mk({id:12,memo:'이용자 인증서 일괄 갱신 안내 발송',done:true,doneAt:doneAt(-1,16)}),
    mk({id:13,memo:'불공정조달 거래정지 통보 3건',done:true,doneAt:doneAt(-2,15),contacts:[${P.seojun}],ids:[{kind:'통보번호',val:'거래정지-26-071'}]}),
    mk({id:14,memo:'평가위원 사전접촉 신고 처리',done:true,doneAt:doneAt(-3,14)}),
    mk({id:15,memo:'직접생산 확인 시스템 연계 점검',done:true,doneAt:doneAt(-4,17)}),
    mk({id:16,memo:'입찰참가자격 등록 매뉴얼 개정',done:true,doneAt:doneAt(-8,16),contacts:[${P.seoyeon}]}),
    mk({id:17,memo:'나라장터 장애 대응 모의훈련 결과 보고',done:true,doneAt:doneAt(-9,15)}),
    mk({id:18,memo:'인증서 오류 문의 처리 — 공고 R26BK01198830',done:true,doneAt:doneAt(-11,11),contacts:[${P.minjun}],ids:[{kind:'입찰공고번호',val:'R26BK01198830'}]}),
    mk({id:19,memo:'투찰 마감 지연 장애 공지 — 공고 R26BK01187702',done:true,doneAt:doneAt(-15,10),ids:[{kind:'입찰공고번호',val:'R26BK01187702'}]}),
  ];
  const phonebook=[{id:901,who:'김민준',org:'㈜한빛정보',phone:'010-2841-5530',email:''},
                   {id:902,who:'박서연',org:'디지털조달관리과',phone:'042-724-7031',email:''},
                   {id:903,who:'한지우',org:'나라장터 운영지원팀',phone:'1588-0800',email:''},
                   {id:904,who:'윤서준',org:'조달청 감사담당관',phone:'042-724-7105',email:''},
                   {id:905,who:'최지훈',org:'부산전자조달지원센터',phone:'051-860-7714',email:''},
                   {id:906,who:'정도윤',org:'세종시 회계과',phone:'044-300-3912',email:''},
                   {id:907,who:'이시스',org:'디지털조달관리과',phone:'042-724-7044',email:''},
                   {id:908,who:'김민서',org:'정보화담당관',phone:'042-724-7210',email:''}];
  let store={items,phonebook,fields:null,presets:[],idKinds:['입찰공고번호','장애번호','접수번호'],
    settings:{alarmOn:false,boardMode:'owner',captureDraft:'',docRoots:['${root}'],docOpen:['0:','0:2026 나라장터 운영'],docSeen:['${root}'],docTreeW:270,docLast:''},recurDefs:[]};
${tauri}
  /* 문서 탭 — 폴더 목록은 고정, 파일 내용은 갈무리 서버의 /__demo/ 에서 */
  const DOCS=${JSON.stringify(DOCS)};
  const mt=new Date(now).setHours(17,52,0,0);
  const url=rel=>'/__demo/'+rel.split('/').map(encodeURIComponent).join('/');
  const inv0=window.__TAURI__.core.invoke;
  window.__TAURI__.core.invoke=async(c,a)=>{
    if(c==='doc_set_roots')return (a.paths||[]).map(p=>({ok:true,path:p,error:''}));
    if(c==='doc_list')return (DOCS[a.rel]||[]).map(e=>({name:e.name,rel:e.rel,dir:!!e.dir,size:e.dir?0:2048,mtime:mt}));
    if(c==='doc_read_text'){const r=await fetch(url(a.rel));if(!r.ok)throw '읽을 수 없습니다';return {text:await r.text(),encoding:'utf-8',mtime:mt};}
    if(c==='doc_read'){const r=await fetch(url(a.rel));if(!r.ok)throw '읽을 수 없습니다';return await r.arrayBuffer();}
    if(c==='doc_search'){const q=(a.query||'');const out=[];for(const k of Object.keys(DOCS))for(const e of DOCS[k]){if(e.name.includes(q))out.push({rel:e.rel,name:e.name,dir:!!e.dir,hit:'name',snippet:''});
        else if(!e.dir&&/\\.(csv|sql|md|txt)$/.test(e.name)){const t=await (await fetch(url(e.rel))).text();const ln=t.split(/\\r?\\n/).find(l=>l.includes(q));if(ln)out.push({rel:e.rel,name:e.name,dir:false,hit:'text',snippet:ln.trim().slice(0,60)});}}return out;}
    if(c==='doc_search_warm')return null;
    if(c==='doc_abs')return '${root}\\\\'+String(a.rel).replace(/\\//g,'\\\\');
    if(c==='doc_preview_open')return false;
    if(c==='doc_preview_close'||c==='doc_preview_show'||c==='doc_preview_place')return null;
    if(c==='doc_write_text')return mt;
    return inv0(c,a);
  };
})()`.replace("getVersion:async()=>'3.7.5'", "getVersion:async()=>'3.8.7'");
}

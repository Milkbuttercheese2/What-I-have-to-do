/* =========================================================================
   카드뉴스용 갈무리 — 실제 앱 실행 없이 guide-shots.mjs 방식으로 찍는다.
   -------------------------------------------------------------------------
   src/ 를 정적 서버로 띄우고 __TAURI__ 스텁 + 예시 데이터를 주입한다
   (공개 게시물이므로 실데이터가 아니라 예시 데이터 — 카드뉴스-도구/README 규칙 여덟).
   viewport 1920×1080 · deviceScaleFactor 2 → 3840×2160 원본. 장면마다 주요
   요소의 물리 픽셀 사각형을 찍어 주므로, 그 수치를 카드 설정의 crops 에 옮긴다.

   실행:  node tools/cardnews-shots.mjs
   출력:  ../발표자료/뭐하려했더라/갈무리원본/*.png
   ========================================================================= */
import http from 'http';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import {createRequire} from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const ROOT = path.join(REPO, 'src');
const OUT  = path.resolve(REPO, '..', '발표자료', '뭐하려했더라', '갈무리원본');
fs.mkdirSync(OUT, {recursive: true});

/* playwright 는 Which-article-was-is 것을 빌린다 — 브라우저가 이미 설치돼 있다 */
const require2 = createRequire(path.resolve(REPO, '..', 'Which-article-was-is', 'package.json'));
const {chromium} = require2('playwright');

const MIME = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.png':'image/png','.svg':'image/svg+xml'};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (e, buf) => {
    if (e) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, {'Content-Type': MIME[path.extname(p)] || 'application/octet-stream'});
    res.end(buf);
  });
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;
const url = p => `http://127.0.0.1:${port}/${p}`;

/* 예시 데이터 — guide-shots.mjs 의 것을 그대로 (공무원 업무 예시) */
const INIT = `(()=>{
  const now=new Date();
  const at=(dd,hh,mm)=>{const d=new Date(now);d.setDate(d.getDate()+dd);d.setHours(hh,mm,0,0);return d.toISOString();};
  const iso=now.toISOString();
  const mk=o=>Object.assign({id:1,memo:'',owner:'',f:{received:iso,due:''},contacts:[],ids:[],subs:[],files:[],done:false,staged:false,al:{},recur:null,recurId:null},o);
  const items=[
    mk({id:1,memo:'행정과 전화 — 회의실 예약 대장 정비 요청. 부서별 사용현황 취합 후 회신',staged:true}),
    mk({id:2,memo:'예산 집행 잔액 정리해서 재무팀에 회신하기',f:{received:iso,due:at(0,17,0)},
      contacts:[{who:'김주무관',org:'재무팀',phone:'02-1234-5678',email:'kim.jm@example.go.kr'}],
      ids:[{kind:'SR번호',val:'SR-2026-0718-0091'}],
      files:['C:\\\\업무\\\\2026\\\\예산_집행내역_정리.xlsx'],
      subs:[{id:21,title:'집행내역 대사 후 잔액 확정',mid:at(0,16,0),done:false,al:null,owner:''}]}),
    mk({id:3,memo:'감사 대비 증빙자료 스캔·정리',f:{received:iso,due:at(4,10,0)},
      subs:[{id:30,title:'담당 부서 지정 및 협조 요청',mid:at(-1,10,0),done:true,al:null,owner:''},
            {id:31,title:'1차 증빙 취합 상태 점검',mid:at(1,9,30),done:false,al:null,owner:'박주무관'}]}),
    mk({id:4,memo:'차기 사업 계획서 초안 작성',f:{received:iso,due:at(6,15,0)}}),
    mk({id:5,memo:'노후 비품 교체 신청 취합',f:{received:iso,due:at(0,14,0)},
      subs:[{id:51,title:'각 팀 신청서 회신 확인',mid:at(0,13,0),done:false,al:null,owner:'최주무관'}]}),
    mk({id:6,memo:'완료된 주간 실적 보고 제출',done:true,f:{received:iso,due:at(-1,10,0)}}),
    mk({id:7,memo:'매주 월요일 주간회의 자료 준비',recur:{type:'dow',dow:[1],time:'09:00',next:at(3,9,0),paused:false}}),
  ];
  const phonebook=[{id:901,who:'김주무관',org:'재무팀',phone:'02-1234-5678',email:'kim.jm@example.go.kr'},
                   {id:902,who:'박주무관',org:'감사담당관실',phone:'02-9876-5432',email:''},
                   {id:903,who:'최주무관',org:'총무과',phone:'010-2222-3333',email:'choi.jm@example.go.kr'}];
  let store={items,phonebook,fields:null,
    presets:[{label:'계약 변경 통보 접수건 처리',memo:'○○ 사업 계약변경 통보 접수 및 검토',subs:[]},
             {label:'감사 자료 제출',memo:'○○ 감사 대비 증빙자료 정리',subs:[]}],
    idKinds:['입찰공고번호','SR번호'],settings:{alarmOn:false,boardMode:'time',captureDraft:''},recurDefs:[]};
  const noop=async()=>{};
  window.__TAURI__={
    core:{invoke:async(c,a)=>{
      if(c==='load_all')return store;
      if(c==='save_all'){store.items=(a&&a.items)||store.items;return null;}
      if(c==='save_settings'){store.settings=(a&&a.settings)||store.settings;return null;}
      if(c==='quick_search'){var q=(a&&(a.query||a.q))||'';if(!q)return[];
        /* 미니 검색 카드용 예시 결과 — 검색어('회신')가 실제로 들어간 문구만 */
        return[
          {id:2,memo:'예산 집행 잔액 정리해서 재무팀에 회신하기',done:false},
          {id:1,memo:'행정과 회의실 예약 대장 정비 — 내일까지 회신',done:false},
          {id:11,memo:'노후 비품 교체 수요조사 회신',done:false},
          {id:12,memo:'보안 점검 결과 조치계획 회신',done:false},
          {id:13,memo:'주간 실적 취합 회신',done:true},
          {id:14,memo:'개인정보 교육 이수 현황 회신',done:true}];}
      if(c==='phonebook_list')return store.phonebook;
      if(c==='phonebook_search'){var q2=(a&&a.query)||'';return store.phonebook.filter(function(e){return (e.who+e.org+e.phone).indexOf(q2)>=0;});}
      if(c==='save_phonebook'){store.phonebook=(a&&a.phonebook)||store.phonebook;return null;}
      if(c==='pick_file_path')return 'C:\\\\업무\\\\2026\\\\회의실_예약대장.hwp';
      return null;}},
    app:{getVersion:async()=>'3.6.1'},
    event:{listen:async()=>()=>{},emit:noop,emitTo:noop,once:async()=>()=>{}},
    window:{getCurrentWindow:()=>({hide:noop,show:noop,setSize:noop,maximize:noop,minimize:noop,toggleMaximize:noop,close:noop,setFocus:noop,label:'main'})}};
  window.Notification={permission:'granted',requestPermission:async()=>'granted'};
})()`;

const browser = await chromium.launch();

async function open(viewport, page_url='index.html') {
  const page = await browser.newPage({viewport, deviceScaleFactor: 2, colorScheme: 'light'});
  await page.addInitScript(INIT);
  await page.goto(url(page_url), {waitUntil: 'networkidle'});
  await page.waitForTimeout(1200);
  return page;
}
const shot = (page, file) => page.screenshot({path: path.join(OUT, file), fullPage: false});

/* 요소들의 물리 픽셀 사각형(×2)을 찍는다 — crops 에 옮겨 적을 실측치 */
async function rects(page, map) {
  for (const [name, sel] of Object.entries(map)) {
    const r = await page.evaluate(s => {
      const el = document.querySelector(s);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return {l: Math.round(b.left*2), t: Math.round(b.top*2), w: Math.round(b.width*2), h: Math.round(b.height*2)};
    }, sel).catch(() => null);
    console.log(r ? `    ${name.padEnd(14)} left:${r.l} top:${r.t} width:${r.w} height:${r.h}`
                  : `    ${name.padEnd(14)} (없음: ${sel})`);
  }
}

/* 본창 장면은 전부 560px 컴팩트(단일 열)로 찍는다 — 창 전체가 1120px(물리)라
   통째로 얹어도 글자가 살고, 헤더·탭까지 보여 '화면 안'이라는 틀이 전달된다. */
const MAIN = {width: 560, height: 1150};

/* ---- 01. 보드 전체 ---------------------------------------------------- */
{
  const page = await open(MAIN);
  await shot(page, '01-보드.png');
  console.log('01-보드.png');
  await rects(page, {
    'capture영역': '#capture',
    '보드전체': '#view-board',
    '분류대기칸': '#view-board .col:nth-child(1)',
    '오늘처리칸': '#view-board .col:nth-child(2)',
    '진행중칸': '#view-board .col:nth-child(3)',
  });
  await page.close();
}
/* ---- 02. 양식(채워진 항목) -------------------------------------------- */
{
  const page = await open(MAIN);
  await page.click('.card:has-text("예산 집행")'); await page.waitForTimeout(700);
  await shot(page, '02-양식.png');
  console.log('02-양식.png');
  await rects(page, {
    '양식패널': '#formPanel .fm-inner',
    '메모칸': '#fm-memo',
    '세부항목': '#fm-subs',
    '관련인': '#fm-contacts',
    '식별정보': '#fm-ids',
    '파일': '#fm-files',
  });
  await page.close();
}
/* ---- 03. 알람창 -------------------------------------------------------- */
{
  const page = await open(MAIN);
  await page.evaluate(()=>{
    const now=new Date();
    const fmtT=d=>String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
    const list=document.getElementById('alarmList');
    if(list) list.innerHTML=
      '<div class="a-item"><b>마감 </b>예산 집행 잔액 정리해서 재무팀에 회신하기<span class="mono">'+fmtT(now)+'</span></div>'+
      '<div class="a-item"><b>점검 </b>각 팀 신청서 회신 확인<span class="mono">'+fmtT(now)+'</span></div>';
    const bg=document.getElementById('alarmBg'); if(bg) bg.classList.add('on');
  });
  await page.waitForTimeout(500);
  await shot(page, '03-알람.png');
  console.log('03-알람.png');
  await rects(page, {'알람창': '#alarmBg .alarm, .alarm'});
  await page.close();
}
/* ---- 04. 달력 ---------------------------------------------------------- */
{
  const page = await open(MAIN);
  await page.click('.tab[data-view="cal"]'); await page.waitForTimeout(700);
  await shot(page, '04-달력.png');
  console.log('04-달력.png');
  await rects(page, {'달력전체': '#view-cal', '달력격자': '#view-cal .cal-grid, #calGrid'});
  await page.close();
}
/* ---- 05. 전화번호부 ---------------------------------------------------- */
{
  const page = await open(MAIN);
  await page.click('.tab[data-view="phone"]'); await page.waitForTimeout(600);
  await shot(page, '05-전화번호부.png');
  console.log('05-전화번호부.png');
  await rects(page, {'탭전체': '#view-phone', '목록': '#pbList, .pb-list'});
  await page.close();
}
/* ---- 06. 관련 업무 팝업 ------------------------------------------------ */
{
  const page = await open(MAIN);
  await page.click('.tab[data-view="phone"]'); await page.waitForTimeout(500);
  await page.click('.pb-item'); await page.waitForTimeout(600);
  await shot(page, '06-관련업무.png');
  console.log('06-관련업무.png');
  await rects(page, {'팝업': '#relModal .modal'});
  await page.close();
}
/* ---- 07. @자동완성 (양식 메모) ----------------------------------------- */
{
  const page = await open(MAIN);
  try{
    await page.click('.card:has-text("감사 대비")'); await page.waitForTimeout(600);
    await page.click('#fm-memo');
    await page.keyboard.press('End');
    await page.keyboard.type('\n@김주', {delay: 60});
    await page.waitForTimeout(800);
    await shot(page, '07-자동완성.png');
    console.log('07-자동완성.png');
    await rects(page, {'드롭다운': '#atDrop', '메모칸': '#fm-memo'});
  }catch(e){ console.log('07 실패:', e.message); }
  await page.close();
}
/* ---- 08. 미니 창 · 내 업무 검색 ---------------------------------------- */
{
  const page = await open({width: 620, height: 350}, 'capture.html');
  await page.evaluate(()=>{ document.documentElement.style.background='#e9e7e2'; document.body.style.padding='10px'; });
  const s = await page.$('#cap-search');
  if(s){ await s.click(); await page.keyboard.type('회신', {delay:16}); }
  await page.waitForTimeout(700);
  await shot(page, '08-미니검색.png');
  console.log('08-미니검색.png  (620×350 CSS → 1240×700 물리픽셀)');
  await page.close();
}
/* ---- 09. 미니 창 · 빠른 메모 ------------------------------------------- */
{
  const page = await open({width: 620, height: 185}, 'capture.html');
  await page.evaluate(()=>{ document.documentElement.style.background='#e9e7e2'; document.body.style.padding='10px'; });
  await page.keyboard.press('Alt'); await page.waitForTimeout(350);
  const inp = await page.$('#cap-inp');
  if(inp){ await inp.click();
    await page.keyboard.type('행정과 회의실 예약 대장 정비 요청', {delay:10});
    await page.keyboard.press('Enter');
    await page.keyboard.type('부서별 사용현황 취합 후 내일까지 회신', {delay:10});
    await page.keyboard.press('Enter');
    await page.keyboard.type('@김주무관 통화 내용 공유', {delay:10}); }
  /* 캐럿 따라 내려간 스크롤을 되돌린다 — 안 하면 첫 줄이 잘린 채 찍힌다 */
  await page.evaluate(()=>{ window.scrollTo(0,0); document.documentElement.scrollTop=0; document.body.scrollTop=0; const t=document.getElementById('cap-inp'); if(t)t.scrollTop=0; });
  await page.waitForTimeout(400);
  await shot(page, '09-빠른메모.png');
  console.log('09-빠른메모.png  (620×185 CSS → 1240×370 물리픽셀)');
  await page.close();
}

await browser.close();
server.close();
console.log(`\n갈무리 완료 → ${OUT}`);

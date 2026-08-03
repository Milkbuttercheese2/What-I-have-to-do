/* 저장 성능 회귀 검사 (v3.6.0)
 *
 * 왜 이게 필요한가
 *   저장은 오랫동안 **전체 교체**였다 — 3년 전에 끝낸 업무도 오늘 체크박스 하나 누를
 *   때마다 같이 기록됐다. 비용이 누적 업무 수에 비례해 무한히 늘어, 월 75건씩 쌓이는
 *   실사용에서 1년쯤 뒤면 체크박스 한 번에 0.3초씩 멈추는 상태가 된다.
 *   v3.6.0 증분 저장은 **완료 업무 행을 다시 쓰지 않아** 비용을 '지금 다루는 업무 수'에만
 *   비례하게 만든다. 이 도구는 그 성질이 유지되는지 수치로 지킨다 —
 *   기능의 존재 이유이므로 말이 아니라 숫자로 못박는다.
 *
 * 실행:  node tools/save-perf-check.mjs
 * 준비:  npm i --no-save playwright-core   (설치돼 있으면 그대로 씀 · Edge 사용)
 * 결과:  기준을 넘으면 종료 코드 1
 *
 * 주의: __TAURI__ 는 스텁이라 **DB 시간은 0**이다. 여기서 재는 것은 순수 JS/DOM 비용이고
 *       실기기에서는 SQLite 쓰기가 더 붙는다(하한선을 재는 셈). 그래도 '누적 건수에
 *       비례하는가'라는 성질은 이 값으로 충분히 판정된다.
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import {fileURLToPath, pathToFileURL} from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const pw = await import(pathToFileURL(path.join(ROOT, 'node_modules', 'playwright-core', 'index.js')).href);
const chromium = (pw.default && pw.default.chromium) || pw.chromium;

const MIME = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};
const server = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(SRC, p), (e, b) => {
    if (e) { r.writeHead(404); r.end('nf'); return; }
    r.writeHead(200, {'Content-Type': MIME[path.extname(p)] || 'application/octet-stream'}); r.end(b);
  });
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;

/* 누적 total 건 중 active 건만 미완료 — 실사용 모양(오래된 완료가 쌓이고 활성은 일정) */
const mkInit = (total, active) => `(()=>{
  const now=new Date(), iso=now.toISOString();
  const at=(dd,hh)=>{const d=new Date(now);d.setDate(d.getDate()+dd);d.setHours(hh,0,0,0);return d.toISOString();};
  const mk=o=>Object.assign({id:1,memo:'',owner:'',f:{received:iso,due:''},contacts:[],ids:[],subs:[],files:[],done:false,staged:false,al:{},recur:null,recurId:null},o);
  const items=[];
  for(let i=1;i<=${total};i++) items.push(mk({id:i,
    memo:'업무 '+i+' — 부서 협조 요청 및 자료 취합 후 회신',
    f:{received:iso,due:at(i%9-2, 9+(i%8))},
    contacts:[{who:'김철수'+(i%15),org:'제'+(i%15)+'부서',phone:'010-1000-'+String(1000+i%15),email:''}],
    ids:[{kind:'SR번호',val:'SR-'+i}],
    subs:[{id:i*10+1,title:'1차 확인',mid:at(i%5-1,10),done:false,al:null,owner:''}],
    done: i > ${active}, doneAt: i > ${active} ? Date.now() : null }));
  let store={items,phonebook:[],fields:null,presets:[],idKinds:['SR번호'],
    settings:{alarmOn:false,boardMode:'time',captureDraft:''},recurDefs:[]};
  const noop=async()=>{};
  window.__saveSizes=[];
  window.__TAURI__={core:{invoke:async(c,a)=>{
      if(c==='load_all')return store;
      if(c==='save_all'){ window.__saveSizes.push((a&&a.items||[]).length); store.items=(a&&a.items)||store.items; return {kind:'Saved',version:1}; }
      if(c==='save_settings'){store.settings=(a&&a.settings)||store.settings;return null;}
      return null;}},
    app:{getVersion:async()=>'3.6.1'},
    event:{listen:async()=>()=>{},emit:noop,emitTo:noop,once:async()=>()=>{}},
    window:{getCurrentWindow:()=>({hide:noop,show:noop,setSize:noop,setFocus:noop,label:'main'})}};
  window.Notification={permission:'granted',requestPermission:async()=>'granted'};
})()`;

const browser = await chromium.launch({channel: process.env.PW_CHANNEL || 'msedge'});
const rows = [];
for (const [total, active] of [[100, 30], [1000, 30], [2000, 30], [2000, 200]]) {
  const page = await browser.newPage({viewport: {width: 1400, height: 900}});
  await page.addInitScript(mkInit(total, active));
  await page.goto(`http://127.0.0.1:${port}/index.html`, {waitUntil: 'networkidle'});
  await page.waitForTimeout(700);
  const m = await page.evaluate(async () => {
    const t = () => performance.now(); const tick = () => new Promise(r => setTimeout(r, 0));
    document.querySelector('.card').click(); await tick();          // 양식 열기
    window.__saveSizes.length = 0;
    const t0 = t();
    document.getElementById('fm-save').click(); await tick();       // 저장(+보드 재렌더)
    const saveMs = t() - t0;
    return {saveMs: Math.round(saveMs), sent: window.__saveSizes[0] ?? -1,
            cards: document.querySelectorAll('.card').length};
  });
  rows.push({total, active, ...m});
  console.log(`누적 ${String(total).padStart(4)}건 · 활성 ${String(active).padStart(3)}건 → 저장 ${String(m.saveMs).padStart(4)}ms · 보낸 건수 ${m.sent}`);
  await page.close();
}
await browser.close(); server.close();

/* 기준 — 이 둘이 이 기능의 계약이다 */
const fails = [];
for (const r of rows) {
  // ① 보내는 건수가 '활성 + 방금 저장한 1건' 수준이어야 한다(누적 건수와 무관).
  if (r.sent > r.active + 5) {
    fails.push(`누적 ${r.total}/활성 ${r.active}: 저장에 ${r.sent}건을 보냈다 — 완료 업무가 실려 나가고 있다`);
  }
}
/* ② 누적이 20배로 늘어도 저장 시간이 그만큼 늘면 안 된다(비례가 끊겼는지).
   기준을 150ms 로 잡은 이유: 전체 교체 시절 이 조건(누적 2000)이 **459ms** 였다.
   되돌아가면 확실히 걸리면서, 정상 범위(실측 60ms 안팎)에서는 헛되이 실패하지 않는 값이다.
   ※ 여기서 남는 증가분은 저장이 아니라 **완료 탭이 완료 업무를 전부 그리는 비용**이다 —
     별개 문제이고, 필요해지면 그때 다룬다. */
const base = rows.find(r => r.total === 100 && r.active === 30);
const big = rows.find(r => r.total === 2000 && r.active === 30);
if (base && big && big.saveMs > Math.max(150, base.saveMs * 4)) {
  fails.push(`누적 100→2000(20배)인데 저장이 ${base.saveMs}ms→${big.saveMs}ms — 누적 건수에 다시 비례하고 있다`);
}

if (fails.length) { console.log('\nFAIL\n  ' + fails.join('\n  ')); process.exit(1); }
console.log('\nOK — 저장 비용이 누적 업무 수와 무관하다');

/* 메인 창 상호작용 검증 — @자동완성 드롭다운 · 관련 업무 팝업 (v3.5.2)
 *
 * 왜 이게 필요한가
 *   이 두 흐름은 **여러 모듈이 문서 위임으로 얽혀 있어** jsdom 단위 테스트로는 절반만
 *   보인다. 실제로 tests/dom/phonebook.test.js 는 `initRender()` 를 부르지 않아서,
 *   "팝업의 업무를 눌러 양식이 열린다"(render.js 의 body 위임)가 한 번도 검증된 적이
 *   없었다. 또 스크롤·클리핑처럼 **실제 레이아웃이 있어야만 드러나는** 결함이 있다:
 *     - 드롭다운 안에서 휠을 굴리면 창 스크롤 리스너가 받아 목록이 닫히던 문제
 *     - ↓ 로 10행을 넘어가면 scrollIntoView 가 그 리스너를 깨워 닫히던 문제
 *     - max-height 어림값 탓에 11번째 행이 아래로 빼꼼 보이던 문제
 *   그래서 capture-check.mjs 와 같은 방식으로 **진짜 앱을 Edge 에 띄워 사람처럼 조작**한다.
 *   (__TAURI__ 는 guide-shots.mjs 와 같은 방식으로 스텁 — 앱 코드는 진짜 그대로 돈다.)
 *
 * 실행:  node tools/interact-check.mjs
 * 준비:  npm i --no-save playwright-core   (설치돼 있으면 그대로 씀 · Edge 사용)
 * 결과:  실패가 하나라도 있으면 종료 코드 1
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import {fileURLToPath, pathToFileURL} from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const pw = await import(pathToFileURL(path.join(ROOT, 'node_modules', 'playwright-core', 'index.js')).href);
const chromium = (pw.default && pw.default.chromium) || pw.chromium;

const MIME = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.png':'image/png','.svg':'image/svg+xml'};
const server = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(SRC, p), (e, b) => {
    if (e) { r.writeHead(404); r.end('nf'); return; }
    r.writeHead(200, {'Content-Type': MIME[path.extname(p)] || 'application/octet-stream'}); r.end(b);
  });
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;

/* 후보 15명(모두 '김철'로 시작 → 10행 넘김) + 그중 한 명과 엮인 업무 3건(완료 1건 포함) */
const INIT = `(()=>{
  const now=new Date(), iso=now.toISOString();
  const mk=o=>Object.assign({id:1,memo:'',owner:'',f:{received:iso,due:''},contacts:[],ids:[],subs:[],files:[],done:false,staged:false,al:{},recur:null,recurId:null},o);
  const phonebook=[];
  for(let i=1;i<=15;i++) phonebook.push({id:900+i,who:'김철수'+i,org:'제'+i+'부서',phone:'010-1000-'+String(1000+i),email:i%3?'':'kim'+i+'@x.go.kr'});
  const P=phonebook[0];
  const rel=()=>[{who:P.who,org:P.org,phone:P.phone,email:P.email}];
  const items=[
    mk({id:1,memo:'예산 집행 잔액 정리해서 회신하기',contacts:rel()}),
    mk({id:2,memo:'세무서 제출용 증빙 사본 준비',contacts:rel()}),
    mk({id:3,memo:'지방세 환급 건 처리 결과 통보',contacts:rel(),done:true,doneAt:Date.now()}),
    mk({id:4,memo:'관련 없는 업무'}),
  ];
  let store={items,phonebook,fields:null,presets:[],idKinds:['SR번호'],
    settings:{alarmOn:false,boardMode:'time',captureDraft:''},recurDefs:[]};
  const noop=async()=>{};
  window.__TAURI__={
    core:{invoke:async(c,a)=>{
      if(c==='load_all')return store;
      if(c==='save_all'){store.items=(a&&a.items)||store.items;return null;}
      if(c==='save_settings'){store.settings=(a&&a.settings)||store.settings;return null;}
      if(c==='save_phonebook'){store.phonebook=(a&&a.phonebook)||store.phonebook;return null;}
      if(c==='phonebook_list')return store.phonebook;
      return null;}},
    app:{getVersion:async()=>'3.6.0'},
    event:{listen:async()=>()=>{},emit:noop,emitTo:noop,once:async()=>()=>{}},
    window:{getCurrentWindow:()=>({hide:noop,show:noop,setSize:noop,setFocus:noop,label:'main'})}};
  window.Notification={permission:'granted',requestPermission:async()=>'granted'};
})()`;

const R = [];
const chk = (name, pass, detail) => { R.push({name, pass}); console.log(`  ${pass?'PASS':'FAIL'}  ${name}${detail?'  — '+detail:''}`); };

const browser = await chromium.launch({channel: process.env.PW_CHANNEL || 'msedge'});
const page = await browser.newPage({viewport:{width:1400, height:900}});
const errs = []; page.on('pageerror', e => errs.push(String(e)));
await page.addInitScript(INIT);
await page.goto(`http://127.0.0.1:${port}/index.html`, {waitUntil:'networkidle'});
await page.waitForTimeout(800);

console.log('\n@ 자동완성 드롭다운');
await page.click('#inp');
await page.type('#inp', '@김철', {delay:40});
await page.waitForTimeout(300);

const d = await page.evaluate(() => {
  const el = document.getElementById('atDrop');
  if (!el || el.style.display === 'none') return null;
  const items = [...el.querySelectorAll('.at-item')];
  const box = el.getBoundingClientRect();
  /* 잘리는 경계는 **패딩 상자**(테두리 안쪽)다 — 바깥 테두리로 재면 실제로는 안 보이는
     행을 '반쯤 걸쳤다'고 잘못 센다. clientHeight = 패딩 포함·테두리 제외. */
  const bt = parseFloat(getComputedStyle(el).borderTopWidth) || 0;
  const clipTop = box.top + bt, clipBottom = clipTop + el.clientHeight;
  const full = items.filter(it => { const r = it.getBoundingClientRect(); return r.top >= clipTop-0.5 && r.bottom <= clipBottom+0.5; }).length;
  const partial = items.filter(it => { const r = it.getBoundingClientRect();
    return (r.top < clipTop-0.5 && r.bottom > clipTop+0.5) || (r.top < clipBottom-0.5 && r.bottom > clipBottom+0.5); }).length;
  return {count: items.length, rowH: Math.round(items[0].getBoundingClientRect().height),
          full, partial, scrollable: el.scrollHeight > el.clientHeight + 1};
});
chk('후보 15명이 목록에 담긴다', !!d && d.count === 15, d ? `count=${d.count}` : '드롭다운이 안 열림');
chk('넘치면 스크롤이 생긴다', !!d && d.scrollable);
chk('한 번에 보이는 행이 정확히 10행', !!d && d.full === 10, d ? `온전=${d.full} rowH=${d.rowH}` : '');
chk('반쯤 걸친 행이 없다', !!d && d.partial === 0, d ? `partial=${d.partial}` : '');

const c = await page.evaluate(() => { const r = document.getElementById('atDrop').getBoundingClientRect(); return {x:r.left+r.width/2, y:r.top+r.height/2}; });
await page.mouse.move(c.x, c.y);
await page.mouse.wheel(0, 200);
await page.waitForTimeout(250);
const w = await page.evaluate(() => { const el = document.getElementById('atDrop');
  return {open: el.style.display !== 'none', scrollTop: Math.round(el.scrollTop)}; });
chk('휠로 굴려도 닫히지 않는다', w.open, `open=${w.open}`);
chk('휠로 실제 스크롤된다', w.scrollTop > 0, `scrollTop=${w.scrollTop}`);

for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowDown');
await page.waitForTimeout(200);
const k = await page.evaluate(() => {
  const el = document.getElementById('atDrop');
  if (el.style.display === 'none') return {open:false};
  const items = [...el.querySelectorAll('.at-item')];
  const i = items.findIndex(x => x.classList.contains('sel'));
  const box = el.getBoundingClientRect(), s = items[i];
  const bt = parseFloat(getComputedStyle(el).borderTopWidth) || 0;
  const r = s.getBoundingClientRect();
  return {open:true, i, last:items.length-1, visible: r.top >= box.top+bt-1 && r.bottom <= box.top+bt+el.clientHeight+1};
});
chk('↓ 를 끝까지 눌러도 닫히지 않는다', k.open === true, JSON.stringify(k));
chk('↓ 가 마지막에서 멈춘다(순환 안 함)', k.open && k.i === k.last, `sel=${k.i}/${k.last}`);
chk('선택 항목이 보이도록 따라 스크롤된다', k.open && k.visible === true);
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
chk('ESC 로만 닫힌다', await page.evaluate(() => document.getElementById('atDrop').style.display === 'none'));

console.log('\n전화번호부 → 관련 업무 팝업 → 양식');
await page.evaluate(() => { document.getElementById('inp').value = ''; });
await page.evaluate(() => [...document.querySelectorAll('.tab')].find(t => t.textContent.includes('전화번호부')).click());
await page.waitForTimeout(400);
chk('전화번호부 목록이 그려진다', (await page.$$('#pb-list .pb-item')).length === 15);

const nth = n => page.evaluate(i => { const el = document.querySelectorAll('#rel-list .rel-hit')[i];
  return el ? el.querySelector('.rel-txt').textContent.trim() : null; }, n);

/* 세 줄(미완료 2 + 완료 1)을 각각 눌러 **누른 줄과 같은 업무**가 열리는지.
   기대값은 화면에 적힌 글자로 잡는다 — 정렬 규칙을 테스트가 다시 추측하면
   앱이 맞아도 틀렸다고 나온다(첫 작성 때 실제로 그랬다). */
for (const i of [0, 1, 2]) {
  await page.click('#pb-list .pb-item:first-child .pb-who'); await page.waitForTimeout(300);
  if (i === 0) {
    const st = await page.evaluate(() => ({on: document.getElementById('relModal').classList.contains('on'),
      hits: document.querySelectorAll('#rel-list .rel-hit').length}));
    chk('행을 누르면 팝업이 열리고 엮인 업무 3건이 나온다', st.on && st.hits === 3, JSON.stringify(st));
  }
  const want = await nth(i);
  await page.click(`#rel-list .rel-hit:nth-child(${i+1})`); await page.waitForTimeout(350);
  const a = await page.evaluate(() => ({modalOn: document.getElementById('relModal').classList.contains('on'),
    formOn: document.getElementById('formPanel').classList.contains('on'),
    memo: (document.getElementById('fm-memo')||{}).value || ''}));
  chk(`${i+1}번째 줄: 팝업이 닫히고 그 업무의 양식이 열린다`,
    a.modalOn === false && a.formOn === true && a.memo.trim() === want, `기대="${want}" 실제="${a.memo.slice(0,24)}"`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(250);
}

/* 배경 클릭으로 닫은 뒤 다시 열기 */
await page.click('#pb-list .pb-item:first-child .pb-who'); await page.waitForTimeout(250);
await page.evaluate(() => document.getElementById('relModal').click());
await page.waitForTimeout(200);
await page.click('#pb-list .pb-item:first-child .pb-who'); await page.waitForTimeout(250);
chk('배경 클릭으로 닫은 뒤 다시 열린다', await page.evaluate(() => document.getElementById('relModal').classList.contains('on')));
await page.evaluate(() => document.getElementById('relClose').click()); await page.waitForTimeout(200);

let flaky = 0;
for (let i = 0; i < 10; i++) {
  await page.click('#pb-list .pb-item:first-child .pb-who'); await page.waitForTimeout(110);
  if (!await page.evaluate(() => document.getElementById('relModal').classList.contains('on')
      && document.querySelectorAll('#rel-list .rel-hit').length === 3)) flaky++;
  await page.evaluate(() => document.getElementById('relClose').click()); await page.waitForTimeout(70);
}
chk('10회 연속 열고 닫아도 매번 정상', flaky === 0, `실패 ${flaky}/10`);

console.log('\n갓 켠 창(로드 직후 최단 경로)');
for (const wait of [0, 60, 150]) {
  const p2 = await browser.newPage({viewport:{width:1400, height:900}});
  const e2 = []; p2.on('pageerror', x => e2.push(String(x)));
  await p2.addInitScript(INIT);
  await p2.goto(`http://127.0.0.1:${port}/index.html`, {waitUntil:'domcontentloaded'});
  await p2.waitForSelector('.tab');
  if (wait) await p2.waitForTimeout(wait);
  const res = {};
  try {
    await p2.evaluate(() => [...document.querySelectorAll('.tab')].find(t => t.textContent.includes('전화번호부')).click());
    await p2.waitForSelector('#pb-list .pb-item', {timeout:4000});
    await p2.click('#pb-list .pb-item:first-child .pb-who'); await p2.waitForTimeout(250);
    res.modalOn = await p2.evaluate(() => document.getElementById('relModal').classList.contains('on'));
    res.hits = await p2.evaluate(() => document.querySelectorAll('#rel-list .rel-hit').length);
    if (res.hits) { await p2.click('#rel-list .rel-hit:first-child'); await p2.waitForTimeout(300);
      res.formOn = await p2.evaluate(() => document.getElementById('formPanel').classList.contains('on')); }
  } catch (err) { res.err = String(err).split('\n')[0].slice(0,90); }
  chk(`대기 ${wait}ms: 전화번호부 → 행 → 업무가 한 번에 된다`,
    res.modalOn === true && res.hits === 3 && res.formOn === true,
    JSON.stringify(res) + (e2.length ? ` 콘솔에러=${e2[0].slice(0,80)}` : ''));
  await p2.close();
}

chk('콘솔 에러 없음', errs.length === 0, errs.join(' | ').slice(0,200));

const fail = R.filter(r => !r.pass).length;
console.log(`\n  ${R.length - fail} PASS / ${fail} FAIL`);
await browser.close(); server.close();
process.exit(fail ? 1 : 0);

/* 성능 재기 — 진짜 앱 화면(src/)을 Edge 에 띄우고 지어낸 자료를 넣어, 사람이 하는 동작마다 화면 스레드가 얼마나 일하는지 잰다.
 *
 * 왜 이게 필요한가
 *   성능 고침은 '재고 나서' 넣는다(점검 지시 원칙 2). 예전 측정(v3.8.13·v3.8.16·v3.8.17)은 그때그때 손으로 짠 스크립트라
 *   다시 돌릴 수 없었다. 이 도구는 같은 자료·같은 방법으로 몇 번이고 다시 잰다 — 고치기 전과 뒤를 같은 숫자로 견준다.
 *
 * 재는 방법
 *   · 자료는 결정적으로 짓는다(같은 씨앗 → 같은 자료). 크기 셋: 보통(진행 50·완료 500) · 많음(300·3,000) · 아주많음(1,000·10,000).
 *     업무마다 하위 업무 0~5·관련인 0~3(전화번호부 1,000명 중)·식별정보 0~3·파일 0~2, 메모는 짧음 60%·중간 30%·긺(3천 자) 9%·아주 긺(2만~5만 자) 1%,
 *     메모 몇에 @태그. 1번 업무는 진행 중이고 메모 5만 자(양식 메모 입력 재기용). 진짜 Rust 는 없다 — __TAURI__ 가짜가
 *     load_all 은 같은 서버의 JSON 을 받아 풀고(IPC 대신), save_all 은 받은 것을 JSON 으로 만들어 본다(IPC 직렬화 흉내).
 *     DB 시간은 Rust 쪽 `cargo test --release --lib perf_big_db -- --ignored --nocapture` 로 따로 잰다.
 *   · 동작 하나를 하는 동안 브라우저 성능 기록(trace)을 켜서, 화면 스레드(CrRendererMain)의 일(RunTask)을 모은다:
 *       길게  = 가장 긴 일 하나(사람이 '멈칫'으로 느끼는 것 — 그동안 화면이 얼어 있다)
 *       합    = 그 동작 뒤 settle 시간 안에 한 일 전부(나눠 그리기·뒤늦은 디바운스 포함)
 *     JS·스타일·배치·그리기 기록이 다 들어간다(래스터는 다른 스레드라 빠진다).
 *   · 동작마다 RUNS 번(기본 7) 돌려 가운데값. 앱 시작은 START_RUNS 번(기본 5) 새로 띄운다.
 *   · 창은 1920×1080 화면에 앱 배율 130% 를 가정해 CSS 1477×830, 화면 밀도 1.3.
 *
 * 실행:  node tools/perf-check.mjs                   (세 크기 모두 — 약 10분)
 *        SIZE=보통 node tools/perf-check.mjs          (보통만 — 회귀 검사용)
 *        ONLY=search,memoKey node tools/perf-check.mjs (고른 것만)
 *        CPU=4 …                                      (CPU 를 4배 느리게 — 느린 사무용 PC 흉내)
 *        JSON=결과.json …                             (숫자를 파일로)
 *        LIMIT=1 …                                    (보통 크기에서 한도를 넘으면 종료 코드 1 — 한도는 아래 LIMITS)
 * 준비:  npm i --no-save playwright-core   (Edge 사용)
 * ⚠️ 숫자는 PC 마다 다르다. 같은 PC 에서 전·후를 견줄 것. 그래서 이 단언은 npm test 에 넣지 않는다.
 */
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); const ROOT = path.join(REPO, 'src');
const pw = await import(pathToFileURL(path.join(REPO, 'node_modules/playwright-core/index.js')).href);
const chromium = (pw.default && pw.default.chromium) || pw.chromium;

const RUNS = +process.env.RUNS || 7, START_RUNS = +process.env.START_RUNS || 5, CPU = +process.env.CPU || 1;
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const SIZES = {보통: [50, 500], 많음: [300, 3000], 아주많음: [1000, 10000]};
const pick = process.env.SIZE ? process.env.SIZE.split(',') : Object.keys(SIZES);
/* LIMIT=1 일 때 보통 크기의 한도(ms, '길게' 기준). 100ms = 바로 느껴지는 문턱, 시작·내보내기·그림은 1초.
   공유 미리 보기 열기만 200ms — 미리 보기 그림을 한 번에 그리는 일이라 이 PC 에서 가운데값이 이미 100ms 언저리이고(혼자 돌려 94~104ms),
   PC 가 조금만 바빠도 120~139ms 로 흩어져(2026-11-27 점검 라운드 5: 같은 날 12회, c3f6c0f 와 그 뒤 코드가 같은 숫자) 100ms 한도는
   앱이 그대로인데도 실패했다. 본 흩어짐의 가장 큰 값(139ms)에 여유를 두고, 두 배로 느려지는 퇴행은 잡히게 200ms. */
const LIMITS = {startup: 1000, render60: 100, save: 100, search: 100, formOpen: 100, formOpenLong: 100, tabCal: 100, tabDone: 100, tabPhone: 100, tabBoard: 100,
  calNext: 100, doneMonth: 100, doneSearch: 100, pbClick: 100, memoKey: 100, capSearch: 100, xlsx: 1000, share: 1000, shareOpen: 200};

/* ── 지어낸 자료 (Rust perf_tests.rs 와 같은 모양) ── */
function makeData(active, done){
  let s = 0x9E3779B9 >>> 0;
  const rnd = n => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s % n; };
  const W = ['입찰공고','정정','사유서','계약','검수','납품','확인','회신','요청','협조','자료','취합','규격','대조표','예산','집행','결재','보고','시설과','총무과','공문','발송','접수','검토','의견','통화','내일','오전','오후','마감'];
  const sent = n => Array.from({length: n}, () => W[rnd(W.length)]).join(' ');
  const book = Array.from({length: 1000}, (_, k) => ({id: 900000 + k, who: `관련인${String(k).padStart(4, '0')}`, org: `제${k % 60}부서`,
    phone: `02-${100 + k % 800}-${1000 + k}`, email: k % 3 === 0 ? `p${k}@example.go.kr` : ''}));
  const now = new Date(); now.setSeconds(0, 0);
  const at = (dd, hh) => { const d = new Date(now); d.setDate(d.getDate() + dd); d.setHours(hh, 0, 0, 0); return d.toISOString(); };
  const memo = (i, force) => {
    const p = force != null ? force : rnd(100);
    let m = `업무 ${i} — ${sent(4)}`;
    if (rnd(10) === 0) m += ` @${book[rnd(book.length)].who}`;
    if (p < 60) return m;
    const lines = p < 90 ? 3 + rnd(6) : p < 99 ? 60 : 400 + rnd(600);
    for (let k = 0; k < lines; k++) m += '\n' + (k % 12 === 5 ? `[구역 ${k}]` : sent(6 + rnd(8)) + (k % 17 === 3 ? ` @${book[rnd(book.length)].who}` : ''));
    return m;
  };
  const items = [];
  for (let i = 1; i <= active + done; i++) {
    const isDone = i > active;
    const subs = Array.from({length: rnd(6)}, (_, k) => ({id: i * 100 + k, title: sent(3), owner: k % 3 === 1 ? '박조달 주무관' : '',
      mid: rnd(3) ? at(rnd(14) - 4, 10 + k) : '', done: isDone || rnd(3) === 0, al: {}}));
    let m = memo(i);
    if (i === 1) { m = memo(1, 99); while (m.length < 50000) m += '\n' + sent(10); m = m.slice(0, 50000); }
    items.push({id: i, memo: m, owner: '', f: {received: at(-rnd(20), 9), due: rnd(10) < 7 ? at(rnd(14) - 4, 9 + rnd(9)) : ''},
      contacts: Array.from({length: rnd(4)}, () => { const e = book[rnd(book.length)]; return {who: e.who, org: e.org, phone: e.phone, email: e.email}; }),
      ids: Array.from({length: rnd(4)}, (_, k) => ({kind: k ? '계약번호' : '공고번호', val: `R26BK${String(i * 7 + k).padStart(8, '0')}`})),
      subs, files: Array.from({length: rnd(3)}, (_, k) => `C:\\업무\\2026\\${i}\\첨부${k}.hwpx`),
      done: isDone, doneAt: isDone ? now.getTime() - (i - active) * 8640000 : null, staged: !isDone && rnd(12) === 0, al: {}, recur: null, recurId: null});
  }
  return {items, phonebook: book, fields: null, presets: [], idKinds: ['공고번호', '계약번호'],
    settings: {alarmOn: false, captureDraft: '', theme: 'light', uiScale: 1.3, uiScaleV373: true, autostart: false}, recurDefs: [], dataVersion: 1};
}

/* ── 서버: src/ + 자료 JSON ── */
let DATA_JSON = '{}';
const MIME = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.json': 'application/json', '.wasm': 'application/wasm'};
const server = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  if (p === '/__perf_data.json') { r.writeHead(200, {'Content-Type': 'application/json'}); r.end(DATA_JSON); return; }
  fs.readFile(path.join(ROOT, p), (e, b) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, {'Content-Type': MIME[path.extname(p)] || 'application/octet-stream'}); r.end(b); }); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const INIT = `(()=>{
  window.__perf={loadCalled:null, loadDone:null, cards:null, paint:null, saved:0, bin:null};
  const noop=async()=>{};
  window.__TAURI__={core:{invoke:async(c,a)=>{
      if(c==='load_all'){ window.__perf.loadCalled=performance.now(); const r=await fetch('/__perf_data.json'); const st=await r.json(); window.__perf.loadDone=performance.now(); return st; }
      if(c==='save_all'){ JSON.stringify(a); window.__perf.saved++; return {kind:'Saved', version:(window.__perfVer=(window.__perfVer||1)+1)}; }
      if(c==='save_settings'||c==='save_phonebook'||c==='save_fields'||c==='save_presets'||c==='save_id_kinds'){ JSON.stringify(a); return null; }
      if(c==='save_binary_file'){ JSON.stringify(a); window.__perf.bin=performance.now(); return true; }
      if(c==='phonebook_list') return [];
      return null;}},
    app:{getVersion:async()=>'0.0.0'},
    event:{listen:async()=>()=>{},emit:noop,emitTo:noop,once:async()=>()=>{}},
    webview:{getCurrentWebview:()=>({onDragDropEvent:async()=>()=>{}})},
    window:{getCurrentWindow:()=>({hide:noop,show:noop,setSize:noop,maximize:noop,minimize:noop,toggleMaximize:noop,close:noop,setFocus:noop,label:'main'})}};
  window.Notification={permission:'denied',requestPermission:async()=>'denied'};
  /* 첫 보드: 카드가 DOM 에 들어간 때(그리기 JS 끝) · 그다음 그림 틀(그려진 때 근사) */
  const mo=new MutationObserver(()=>{ if(window.__perf.cards==null && document.querySelector('#view-board5 .card,#view-board .card')){
    window.__perf.cards=performance.now(); mo.disconnect(); requestAnimationFrame(()=>requestAnimationFrame(()=>{ window.__perf.paint=performance.now(); })); } });
  document.addEventListener('DOMContentLoaded',()=>mo.observe(document.body,{childList:true,subtree:true}));
})()`;

const CATS = ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'toplevel', 'blink.user_timing'];
let browser = await chromium.launch({channel: process.env.PW_CHANNEL || 'msedge'});
const VIEW = {viewport: {width: 1477, height: 830}, deviceScaleFactor: 1.3};

async function newPage(){
  const page = await browser.newPage(VIEW);
  page.on('pageerror', e => console.log('  페이지 오류:', e.message));
  if (CPU > 1) { const s = await page.context().newCDPSession(page); await s.send('Emulation.setCPUThrottlingRate', {rate: CPU}); }
  await page.addInitScript(INIT);
  return page;
}
/* trace 를 켜고 act() 를 한 뒤 settle(ms) 기다려, 화면 스레드의 일을 모은다 */
async function traced(page, act, settle = 300){
  await browser.startTracing(page, {categories: CATS});
  await page.evaluate(() => new Promise(r => setTimeout(r, 30)));    // 기록이 붙을 틈
  const mark0 = await page.evaluate(() => { performance.mark('perf-a'); return performance.timeOrigin + performance.now(); });
  await act();
  await page.waitForTimeout(settle);
  const buf = await browser.stopTracing();
  const tr = JSON.parse(buf.toString());
  const ev = tr.traceEvents || tr;
  const main = ev.find(e => e.ph === 'M' && e.name === 'thread_name' && e.args && e.args.name === 'CrRendererMain' &&
    ev.some(x => x.pid === e.pid && x.name === 'perf-a'));
  const mk = ev.find(e => e.name === 'perf-a');
  if (!main || !mk) return {long: NaN, sum: NaN};
  const tasks = ev.filter(e => e.pid === main.pid && e.tid === main.tid && e.ph === 'X' && (e.name === 'RunTask' || e.name === 'ThreadControllerImpl::RunTask') && e.ts >= mk.ts - 1000);
  let long = 0, sum = 0; for (const t of tasks) { const d = (t.dur || 0) / 1000; sum += d; if (d > long) long = d; }
  return {long, sum};
}
const med = a => { const b = a.filter(x => isFinite(x)).sort((x, y) => x - y); return b.length ? b[b.length >> 1] : NaN; };
const results = [];
function put(size, key, label, runs){
  const r = {size, key, label, long: med(runs.map(x => x.long)), sum: med(runs.map(x => x.sum)), max: Math.max(...runs.map(x => x.long)), n: runs.length};
  results.push(r);
  console.log(`  ${label.padEnd(30)} 길게 ${r.long.toFixed(1).padStart(7)}ms · 합 ${r.sum.toFixed(1).padStart(7)}ms · 가장 나쁨 ${r.max.toFixed(1)}ms`);
}
const want = k => !ONLY || ONLY.has(k);

async function openApp(page){
  await page.goto(BASE + '/index.html', {waitUntil: 'load'});
  await page.waitForFunction(() => window.__perf.paint != null, null, {timeout: 60000});
  await page.waitForTimeout(500);
}

for (const size of pick) {
  const [act, dn] = SIZES[size];
  const data = makeData(act, dn); DATA_JSON = JSON.stringify(data);
  console.log(`\n■ ${size} — 진행 ${act} · 완료 ${dn} · 전화번호부 ${data.phonebook.length} · 자료 JSON ${(DATA_JSON.length / 1048576).toFixed(1)}MB`);

  /* 1 앱 시작 → 첫 보드 */
  if (want('startup')) {
    const rows = [];
    for (let k = 0; k < START_RUNS; k++) {
      const page = await newPage(); await openApp(page);
      rows.push(await page.evaluate(() => ({...window.__perf})));
      await page.close();
    }
    const m = f => med(rows.map(f));
    const r = {size, key: 'startup', label: '앱 시작 → 첫 보드 그림', long: m(x => x.paint), sum: m(x => x.paint), max: Math.max(...rows.map(x => x.paint)), n: rows.length,
      detail: {모듈적재: m(x => x.loadCalled), 자료받기풀기: m(x => x.loadDone - x.loadCalled), 첫그리기: m(x => x.cards - x.loadDone), 그림까지: m(x => x.paint - x.cards)}};
    results.push(r);
    console.log(`  앱 시작 → 첫 보드 그림           ${r.long.toFixed(0)}ms (모듈 적재 ${r.detail.모듈적재.toFixed(0)} · 자료 받기·풀기 ${r.detail.자료받기풀기.toFixed(0)} · 첫 그리기 ${r.detail.첫그리기.toFixed(0)} · 그림까지 ${r.detail.그림까지.toFixed(0)})`);
  }

  const page = await newPage(); await openApp(page);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const closeAll = () => ev(() => { document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})); document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})); });
  const tab = v => ev(v => document.querySelector(`.tab[data-view="${v}"]`).click(), v);

  /* 0 기준선 — 아무것도 안 할 때 같은 300ms 창에 잡히는 일(기록 도구·검사 도구 자체). '합'을 읽을 때 이만큼은 빼고 본다 */
  if (want('idle')) { const runs = [];
    for (let k = 0; k < RUNS; k++) runs.push(await traced(page, () => ev(() => 0)));
    put(size, 'idle', '(기준선: 아무것도 안 함)', runs); }

  /* 2 보드 다시 그리기 — 60초 자동(바뀐 것 없음) */
  if (want('render60')) { const runs = [];
    for (let k = 0; k < RUNS; k++) runs.push(await traced(page, () => ev(async () => { (await import('/render.js')).render(); })));
    put(size, 'render60', '보드 다시 그리기(60초 자동)', runs); }

  /* 3 카드 눌러 양식 열기 (보통 카드 · 메모 5만 자 카드) / 양식 저장 */
  const cardIds = await ev(() => [...document.querySelectorAll('#view-board5 .card[data-open]')].map(c => +c.dataset.open).filter(id => id !== 1).slice(0, 40));
  if (want('formOpen')) { const runs = [];
    for (let k = 0; k < RUNS; k++) { const id = cardIds[k * 3 % cardIds.length];
      runs.push(await traced(page, () => ev(id => document.querySelector(`#view-board5 .card[data-open="${id}"] .card-memo`).click(), id)));
      await closeAll(); }
    put(size, 'formOpen', '카드 눌러 양식 열기', runs); }
  if (want('formOpenLong')) { const runs = [];
    for (let k = 0; k < RUNS; k++) { runs.push(await traced(page, () => ev(() => document.querySelector('#view-board5 .card[data-open="1"] .card-memo').click()))); await closeAll(); }
    put(size, 'formOpenLong', '양식 열기(메모 5만 자)', runs); }
  if (want('save')) { const runs = [];
    for (let k = 0; k < RUNS; k++) { const id = cardIds[k * 5 % cardIds.length];
      await ev(id => document.querySelector(`#view-board5 .card[data-open="${id}"] .card-memo`).click(), id);
      await ev(() => { const m = document.getElementById('fm-memo'); m.value += ' 고침'; m.dispatchEvent(new Event('input', {bubbles: true})); });
      runs.push(await traced(page, () => ev(() => document.getElementById('fm-save').click())));
      await closeAll(); }
    put(size, 'save', '양식 저장(보드 다시 그리기 포함)', runs); }

  /* 4 검색창에 한 글자씩 — 디바운스(120ms) 뒤 그리기까지 한 글자의 일 */
  if (want('search')) { const runs = []; const word = '협조 확인';
    for (let k = 0; k < Math.max(RUNS, word.length); k++) {
      const q = word.slice(0, k % word.length + 1);
      runs.push(await traced(page, () => ev(q => { const g = document.getElementById('g-search'); g.value = q; g.dispatchEvent(new Event('input', {bubbles: true})); }, q), 400));
    }
    await ev(() => { const g = document.getElementById('g-search'); g.value = ''; g.dispatchEvent(new Event('input', {bubbles: true})); }); await page.waitForTimeout(400);
    put(size, 'search', '보드 검색 한 글자(그리기까지)', runs); }

  /* 5 양식 메모에 글자 하나 — 메모 5만 자 */
  if (want('memoKey')) {
    await ev(() => document.querySelector('#view-board5 .card[data-open="1"] .card-memo').click());
    await ev(() => { const m = document.getElementById('fm-memo'); m.focus(); m.setSelectionRange(25000, 25000); });
    const runs = [];
    for (let k = 0; k < RUNS; k++) runs.push(await traced(page, () => ev(() => { const m = document.getElementById('fm-memo'); const p = m.selectionStart;
      m.setRangeText('가', p, p, 'end'); m.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText', data: '가'})); }), 120));
    put(size, 'memoKey', '양식 메모 글자 하나(5만 자)', runs);
    /* 무엇이 그 시간을 쓰는지 — 백드롭 층 다시 만들기를 나눠 잰다(같은 함수들을 직접 불러) */
    const parts = await ev(async () => {
      const {esc} = await import('/dom-utils.js'); const {linkifyAt} = await import('/phonebook-core.js'); const {markSections} = await import('/memo-sections.js'); const {S} = await import('/state.js');
      const v = document.getElementById('fm-memo').value, hl = document.getElementById('fm-memo-hl'); const t = []; const T = () => performance.now();
      const one = () => { const a = T(); const e = esc(v); const b = T(); const l = linkifyAt(e, S.phonebook); const c = T(); const s = markSections(l, v); const d = T();
        hl.innerHTML = s + '\n'; const e2 = T(); void hl.offsetHeight; document.getElementById('fm-memo').offsetHeight; const f = T(); return [b - a, c - b, d - c, e2 - d, f - e2]; };
      for (let k = 0; k < 9; k++) { hl.innerHTML = ''; void hl.offsetHeight; t.push(one()); }
      const m = i => { const a = t.map(x => x[i]).sort((x, y) => x - y); return +a[a.length >> 1].toFixed(2); };
      return {esc: m(0), linkifyAt: m(1), markSections: m(2), innerHTML: m(3), layout: m(4)};
    });
    console.log('    나눠 보기(가운데값 ms):', JSON.stringify(parts));
    results.push({size, key: 'memoKeyParts', label: '메모 글자 하나 나눠 보기', parts});
    await closeAll();
  }

  /* 6 탭 바꾸기 · 캘린더 달 넘기기 · 완료 달 넘기기 · 전화번호부 사람 누르기 */
  const tabRun = async (key, label, v, from, settle) => { if (!want(key)) return; const runs = [];
    for (let k = 0; k < RUNS; k++) { await tab(from); await page.waitForTimeout(settle); runs.push(await traced(page, () => tab(v), settle)); }
    put(size, key, label, runs); };
  await tabRun('tabCal', '탭: 보드 → 캘린더', 'cal', 'board', 300);
  await tabRun('tabDone', '탭: 캘린더 → 완료', 'done', 'cal', 1500);
  await tabRun('tabPhone', '탭: 완료 → 전화번호부', 'phone', 'done', 300);
  await tabRun('tabBoard', '탭: 전화번호부 → 보드', 'board', 'phone', 300);
  if (want('calNext')) { await tab('cal'); await page.waitForTimeout(300); const runs = [];
    for (let k = 0; k < RUNS; k++) runs.push(await traced(page, () => ev(k => document.getElementById(k % 2 ? 'cal-prev' : 'cal-next').click(), k)));
    put(size, 'calNext', '캘린더 달 넘기기', runs); }
  if (want('doneMonth')) { await tab('done'); await page.waitForTimeout(1500); const runs = [];
    for (let k = 0; k < RUNS; k++) runs.push(await traced(page, () => ev(() => document.querySelector('#done-cal [data-dcalnav="-1"]').click()), 600));
    put(size, 'doneMonth', '완료 탭 앞 달로', runs);
    await ev(() => { for (let k = 0; k < 7; k++) document.querySelector('#done-cal [data-dcalnav="1"]').click(); }); }
  if (want('doneSearch')) { await tab('done'); await page.waitForTimeout(1500); const runs = []; const word = '협조 확인';
    for (let k = 0; k < Math.max(RUNS, word.length); k++) {
      const q = word.slice(0, k % word.length + 1);
      runs.push(await traced(page, () => ev(q => { const g = document.getElementById('g-search'); g.focus(); g.value = q; g.dispatchEvent(new Event('input', {bubbles: true})); }, q), 1200));
    }
    await ev(() => { const g = document.getElementById('g-search'); g.value = ''; g.dispatchEvent(new Event('input', {bubbles: true})); g.blur(); }); await page.waitForTimeout(1500);
    put(size, 'doneSearch', '완료 검색 한 글자(그리기까지)', runs); }
  if (want('pbClick')) { await tab('phone'); await page.waitForTimeout(300); const runs = [];
    for (let k = 0; k < RUNS; k++) runs.push(await traced(page, () => ev(k => { const rows = document.querySelectorAll('#pb-list .pb-item'); rows[(k * 37) % rows.length].click(); }, k)));
    put(size, 'pbClick', '전화번호부 사람 누르기', runs); }
  await tab('board'); await page.waitForTimeout(300);

  /* 7 엑셀로 내보내기(파일 바이트를 넘기기까지) · 공유 미리 보기 열기 · 공유 그림 만들기 */
  if (want('xlsx')) { const runs = [];
    await ev(async () => { await (await import('/dom-utils.js')).needXlsx(); });
    for (let k = 0; k < Math.min(RUNS, 5); k++) {
      await ev(() => { window.__perf.bin = null; });
      runs.push(await traced(page, async () => { await ev(() => document.getElementById('xlsx').click()); await page.waitForFunction(() => window.__perf.bin != null, null, {timeout: 120000}); }, 200));
    }
    put(size, 'xlsx', `엑셀로 내보내기(${await ev(async () => (await import('/xlsx-export.js')).exportableItems((await import('/state.js')).S.items).length)}건)`, runs); }
  if (want('share') || want('shareOpen')) {
    const runsO = [], runsS = [];
    for (let k = 0; k < Math.min(RUNS, 5); k++) {
      const id = cardIds[k % cardIds.length];
      await ev(id => document.querySelector(`#view-board5 .card[data-open="${id}"] .card-memo`).click(), id);
      runsO.push(await traced(page, () => ev(() => document.getElementById('fm-share').click()), 400));
      await ev(() => { window.__perf.bin = null; });
      runsS.push(await traced(page, async () => { await ev(() => document.getElementById('share-save').click()); await page.waitForFunction(() => window.__perf.bin != null, null, {timeout: 60000}); }, 200));
      await closeAll(); await closeAll();
    }
    if (want('shareOpen')) put(size, 'shareOpen', '공유 미리 보기 열기', runsO);
    if (want('share')) put(size, 'share', '공유 그림 만들기(파일로 저장)', runsS);
  }
  await page.close();

  /* 8 미니 창 빠른 검색 — 결과 100건(메모 통째, Rust quick_search 가 돌려주는 모양)을 그리기까지 */
  if (want('capSearch')) {
    const hits = data.items.filter(it => it.memo.includes('협')).sort((a, b) => (a.done - b.done) || b.id - a.id).slice(0, 100).map(it => ({id: it.id, memo: it.memo, done: it.done}));
    const cp = await browser.newPage({viewport: {width: 700, height: 406}, deviceScaleFactor: 1.3});
    if (CPU > 1) { const s = await cp.context().newCDPSession(cp); await s.send('Emulation.setCPUThrottlingRate', {rate: CPU}); }
    await cp.addInitScript(h => { window.__TAURI__ = {core: {invoke: async c => c === 'quick_search' ? h : c === 'phonebook_list' ? [] : undefined},
      event: {listen: async () => () => {}, emitTo: async () => {}, emit: async () => {}}, window: {getCurrentWindow: () => ({hide: async () => {}, setFocus: async () => {}})}}; }, hits);
    await cp.goto(BASE + '/capture.html'); await cp.waitForTimeout(500);
    const runs = [];
    for (let k = 0; k < RUNS; k++) runs.push(await traced(cp, () => cp.evaluate(k => { const s = document.getElementById('cap-search'); s.value = k % 2 ? '협조' : '협'; s.dispatchEvent(new Event('input', {bubbles: true})); }, k), 500));
    put(size, 'capSearch', `미니 창 빠른 검색(결과 ${hits.length}건)`, runs);
    await cp.close();
  }
}
await browser.close(); server.close();

/* 느린 순서 표 — 16ms(한 화면)·100ms(바로 느껴짐)·1초(끊김) */
const grade = ms => ms >= 1000 ? '끊김(1초↑)' : ms >= 100 ? '느껴짐(100ms↑)' : ms >= 16 ? '한 화면 넘음' : '괜찮음';
const rows = results.filter(r => r.long != null && isFinite(r.long)).sort((a, b) => b.long - a.long);
console.log('\n| 무엇 | 자료 | 길게(가운데) | 합(가운데) | 가장 나쁨 | 판정 |\n|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.label} | ${r.size} | ${r.long.toFixed(1)}ms | ${r.sum.toFixed(1)}ms | ${r.max.toFixed(1)}ms | ${grade(r.long)} |`);
if (process.env.JSON) fs.writeFileSync(process.env.JSON, JSON.stringify({at: new Date().toISOString(), cpu: CPU, runs: RUNS, results}, null, 1));
if (process.env.LIMIT) {
  const over = results.filter(r => r.size === '보통' && LIMITS[r.key] != null && r.long > LIMITS[r.key]);
  if (over.length) { console.log('\nFAIL — 보통 크기에서 한도를 넘었다:\n  ' + over.map(r => `${r.label}: ${r.long.toFixed(0)}ms > ${LIMITS[r.key]}ms`).join('\n  ')); process.exit(1); }
  console.log('\nOK — 보통 크기에서 모든 동작이 한도 안');
}

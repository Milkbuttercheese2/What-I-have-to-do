/* 업무 공유 메모지·메모 구역 제목 실렌더 검사 — 진짜 앱 화면(지어낸 자료)을 Edge 또는 진짜 WebView2 에 띄워 잰다.
 *
 * 왜 이게 필요한가
 *   공유 그림은 SVG foreignObject 로 만든다(share.js). 글꼴이 그림 안에 실렸는지, 캔버스가 오염되지 않는지, 미리 보기와
 *   나가는 그림의 높이가 맞는지, 아주 긴 업무에서도 그림이 지나치게 커지지 않는지는 jsdom 으로 볼 수 없다.
 *   구역 제목 가로선은 백드롭 층에 끼운 빈 표시인데, 그것이 글자 자리를 밀지 않는지도 실제 레이아웃이 있어야 잰다.
 *
 * 재는 것
 *   1 양식 메모 칸: [제목] 선의 수·자리(앞 줄 글자 아래 ~ 그 줄 글자 위), 선 폭 = 칸 폭, 선을 빼도 백드롭 글자 자리가 그대로인지
 *   2 2쪽 보기: 같은 메모에서 선의 수, 글자 자리 그대로
 *   3 공유: 미리 보기 → [파일로 저장](save_binary_file 가짜가 바이트를 받는다) → PNG 폭 1280(=512×2.5)·높이,
 *     그림 높이 = 미리 보기 메모지 높이(단추 뺀 것)×2.5, 펼치기 → 그림에 반영, 연락처 스위치, 업무를 저장하지 않음
 *   4 긴 내용: 메모 5만 자·하위 업무 60개·관련인 60명을 모두 펼쳐도 그림 높이에 위 한도, 만드는 시간
 *   5 (WV2=1) [그림 복사]·[글자로 복사]가 진짜 클립보드에 들어가는지 — Windows 클립보드를 읽어 본다(글자는 되돌려 둔다)
 * 실행:  node tools/share-check.mjs            (Edge)
 *        WV2=1 node tools/share-check.mjs      (진짜 WebView2 — tools/wv2host, 또는 WV2HOST=exe 경로)
 *        OUT=폴더  → 그림·화면 갈무리를 남긴다
 * 준비:  npm i --no-save playwright-core
 */
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import {spawn, execFileSync} from 'node:child_process';
import {pathToFileURL, fileURLToPath} from 'node:url';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); const ROOT = path.join(REPO, 'src');
const pw = await import(pathToFileURL(path.join(REPO, 'node_modules/playwright-core/index.js')).href);
const chromium = (pw.default && pw.default.chromium) || pw.chromium;
const WV2 = !!process.env.WV2; const OUT = process.env.OUT || '';
const HOST = process.env.WV2HOST || path.join(REPO, 'tools', 'wv2host', 'target', 'debug', 'wv2host.exe');
const MIME = {'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.json':'application/json','.wasm':'application/wasm'};
const server = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (e, b) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, {'Content-Type': MIME[path.extname(p)] || 'application/octet-stream'}); r.end(b); }); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const URL0 = `http://127.0.0.1:${server.address().port}/index.html`;

/* 지어낸 자료 — 전화번호부만 넣고 업무는 비운다(양식은 openForm 으로 직접 연다) */
const INIT = `(()=>{
  const store={items:[],phonebook:[{id:901,who:'김서준 주무관',org:'시설과',phone:'02-000-0000',email:''}],fields:null,presets:[],idKinds:['공고번호','계약번호'],
    settings:{alarmOn:false,boardMode:'time',captureDraft:'',theme:'light'},recurDefs:[]};
  window.__saved=[]; const noop=async()=>{};
  window.__TAURI__={core:{invoke:async(c,a)=>{
      if(c==='load_all')return store;
      if(c==='save_all'){window.__saveAll=(window.__saveAll||0)+1;store.items=(a&&a.items)||store.items;return null;}
      if(c==='save_binary_file'){window.__savedAt=performance.now();window.__saved.push({name:a.suggestedName,data:a.data});return true;}
      if(c==='phonebook_list')return store.phonebook;
      return null;}},
    app:{getVersion:async()=>'0.0.0'},
    event:{listen:async()=>()=>{},emit:noop,emitTo:noop,once:async()=>()=>{}},
    window:{getCurrentWindow:()=>({hide:noop,show:noop,setSize:noop,maximize:noop,minimize:noop,toggleMaximize:noop,close:noop,setFocus:noop,label:'main'})}};
  window.Notification={permission:'granted',requestPermission:async()=>'granted'};
})()`;

let fails = 0; const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
let browser, proc, page;
if (!WV2) {
  browser = await chromium.launch({channel: 'msedge'});
  page = await browser.newPage({viewport: {width: 1280, height: 800}});
  await page.addInitScript(INIT);
  await page.goto(URL0, {waitUntil: 'networkidle'});
} else {
  if (!fs.existsSync(HOST)) { console.error('먼저: cargo build --offline --manifest-path tools/wv2host/Cargo.toml (또는 WV2HOST=경로)'); process.exit(2); }
  const cdp = 9400 + Math.floor(Math.random() * 400);
  /* 앱 배율 1 · 창 1280×800 — 가짜 __TAURI__ 는 첫 화면 전에 넣어야 하므로 빈 쪽으로 띄운 뒤 넣고 이동한다 */
  proc = spawn(HOST, ['about:blank', '1', '1280', '800'], {env: {...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdp}`}, stdio: 'ignore'});
  for (let k = 0; k < 100 && !browser; k++) { try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdp}`); } catch { await new Promise(r => setTimeout(r, 200)); } }
  for (let k = 0; k < 50 && !page; k++) { for (const c of browser.contexts()) for (const p of c.pages()) page = p; if (!page) await new Promise(r => setTimeout(r, 200)); }
  await page.addInitScript(INIT);
  await page.goto(URL0, {waitUntil: 'networkidle'});
  console.log('WebView2:', await page.evaluate(() => navigator.userAgent.match(/Edg\/[\d.]+/)?.[0]));
}
page.on('pageerror', e => { console.log('ERR', e.message); fails++; });
await page.waitForTimeout(800);
if (OUT) fs.mkdirSync(OUT, {recursive: true});
const shot = async (name) => { if (!OUT) return;
  await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.classList.remove('on'); });   // 앞 동작의 알림이 갈무리를 가리지 않게
  await page.waitForTimeout(250); await page.screenshot({path: path.join(OUT, name)}); };

const now = new Date(); const at = (dd, hh, mm) => { const d = new Date(now); d.setDate(d.getDate() + dd); d.setHours(hh, mm, 0, 0); return d.toISOString(); };
const MEMO = '입찰공고 정정 사유 확인\n시설과에서 공고문 규격 부분 정정을 요청했습니다.\n[통화 내용]\n김서준 주무관: 사유서는 내일 오전에 보내기로 함.\n[긴급] 오늘 중 회신\n시행령 [별표 2] 참조\n[검토할 것]\n정정 전후 규격 대조표 만들기';
const SECTION_MEMO = '[제목]\n' + MEMO;    // 맨 처음의 [제목]은 선 없음, [통화 내용]·[검토할 것]만 선
/* 업무마다 id 를 준다 — id 없는 새 양식은 남은 '새 업무' 임시저장과 부딪쳐 묻는 창(appConfirm)이 떠 멈춘다 */
const BASE = {id: 9001, memo: MEMO, f: {received: at(-1, 9, 10), due: at(1, 14, 0)},
  contacts: [{who: '김서준 주무관', org: '시설과', phone: '02-000-0000', email: ''}], ids: [{kind: '공고번호', val: 'R26BK00123456'}],
  subs: [{id: 11, title: '정정 사유서 받기', mid: at(-1, 10, 0), done: true, owner: ''}, {id: 12, title: '공고문 정정안 검토', mid: at(0, 16, 0), done: false, owner: '박조달 주무관'},
         {id: 13, title: '재공고 일정 회신', mid: '', done: false, owner: ''}], files: ['C:\\업무\\2026\\입찰\\정정요청.hwpx']};
const openForm = (it) => page.evaluate(async (it) => { const f = await import('/form.js'); await f.openForm(it); }, it);

/* ── 1 양식 메모 칸의 구역 제목 선 ── */
await openForm({...BASE, id: 9000, memo: SECTION_MEMO});
await page.waitForTimeout(300);
const memoLines = () => page.evaluate(() => {
  const hl = document.getElementById('fm-memo-hl'), ta = document.getElementById('fm-memo');
  const charRects = () => { const out = []; const w = document.createTreeWalker(hl, NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) for (let i = 0; i < n.length; i++) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1); const b = r.getClientRects()[0]; if (b) out.push([b.left, b.top]); } return out; };
  const marks = [...hl.querySelectorAll('.msec')].map(m => {
    const mr = m.getBoundingClientRect(); const t = m.nextSibling; const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 1); const g = r.getClientRects()[0];
    let p = m.previousSibling; while (p && p.nodeType !== 3) p = p.previousSibling;
    let pb = null; if (p && p.length > 1) { const r2 = document.createRange(); r2.setStart(p, p.length - 2); r2.setEnd(p, p.length - 1); pb = r2.getClientRects()[0].bottom; }
    return {y: mr.top, w: mr.width, glyphTop: g.top, prevBottom: pb, next: t.textContent.split('\n')[0]}; });
  const a = charRects(); const saved = hl.innerHTML; hl.querySelectorAll('.msec').forEach(m => m.remove()); const b = charRects(); hl.innerHTML = saved;
  const moved = a.length === b.length ? Math.max(0, ...a.map((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1]))) : 999;
  return {marks, moved, hlW: hl.getBoundingClientRect().width, taH: ta.scrollHeight};
});
const m1 = await memoLines();
ok(m1.marks.length === 2 && m1.marks[0].next === '[통화 내용]' && m1.marks[1].next === '[검토할 것]', `양식 메모: 선 2개([통화 내용]·[검토할 것]) — 맨 처음 [제목]·[긴급] 뒤에 글·[별표 2] 줄은 선 없음 (${m1.marks.map(m => m.next).join(' / ')})`);
ok(m1.marks.every(m => m.prevBottom !== null && m.y >= m.prevBottom - 0.5 && m.y <= m.glyphTop + 0.5), `양식 메모: 선이 앞 줄 글자 아래·그 줄 글자 위에 있음 (${m1.marks.map(m => `${(m.y - m.prevBottom).toFixed(1)}~${(m.glyphTop - m.y).toFixed(1)}px`).join(', ')})`);
ok(m1.marks.every(m => Math.abs(m.w - m1.hlW) < 1), `양식 메모: 선 폭 = 메모 칸 폭 (${m1.marks.map(m => m.w.toFixed(1)).join(', ')} / ${m1.hlW.toFixed(1)})`);
ok(m1.moved < 0.01, `양식 메모: 선 표시를 빼도 백드롭 글자 자리 그대로 (최대 ${m1.moved.toFixed(3)}px)`);
await shot('공유-화면-4-구역제목.png');
/* 메모 칸을 끝까지 내려도 선(·태그 하이라이트)이 글과 같은 자리 — 예전엔 글 칸(textarea)이 inline-block 이라 감싼 칸 아래에 틈이 생겨
   백드롭 층이 글 칸보다 6px 컸고, 끝까지 내리면 백드롭이 6px 덜 내려가 선이 구역 제목 글자를 그었다(칸 아래 테두리 밖으로도 비어져 나옴) */
await openForm({...BASE, id: 8999, memo: SECTION_MEMO + '\n' + Array.from({length: 30}, (_, i) => i % 6 === 2 ? `[구역 ${i}]` : `${i}번째 줄`).join('\n')});
await page.waitForTimeout(300);
const btm = await page.evaluate(() => { const ta = document.getElementById('fm-memo'), hl = document.getElementById('fm-memo-hl');
  ta.scrollTop = 1e6; ta.dispatchEvent(new Event('scroll'));
  const tr = ta.getBoundingClientRect(), hr = hl.getBoundingClientRect(), bw = parseFloat(getComputedStyle(ta).borderBottomWidth);
  return {st: [ta.scrollTop, hl.scrollTop], ch: [ta.clientHeight, hl.clientHeight], over: hr.bottom - (tr.bottom - bw)}; });
ok(btm.st[0] > 0 && Math.abs(btm.st[0] - btm.st[1]) < 0.5 && Math.abs(btm.ch[0] - btm.ch[1]) <= 1 && btm.over <= 0.5,   // 높이는 배율 반올림으로 1px 차이 허용(WebView2 실측)
  `양식 메모: 끝까지 내려도 백드롭이 글 칸과 같은 자리 (scrollTop ${btm.st.join('/')}, 높이 ${btm.ch.join('/')}, 칸 아래로 ${btm.over.toFixed(1)}px)`);
await openForm({...BASE, id: 9000, memo: SECTION_MEMO}); await page.waitForTimeout(300);   // 2쪽 보기는 처음 메모로

/* ── 2 2쪽 보기 ── */
await page.click('#fm-book'); await page.waitForTimeout(700);
const b1 = await page.evaluate(() => {
  const hls = [...document.querySelectorAll('#book-pages .book-hl')];
  const tas = [...document.querySelectorAll('#book-pages .book-ta')];
  const marks = hls.flatMap(h => [...h.querySelectorAll('.msec')].map(m => m.nextSibling.textContent.split('\n')[0]));
  /* 꾸밈 층의 첫 글자 자리 = 쪽 글 칸의 첫 글자 자리(같은 글자 치수·같은 자리) — 글 칸 상자와 견준다 */
  const h = hls[0], t = tas[0]; const hr = h.getBoundingClientRect(), tr = t.getBoundingClientRect();
  return {marks, dx: Math.abs(hr.left - tr.left), dy: Math.abs(hr.top - tr.top), dw: Math.abs(hr.width - tr.width), dh: Math.abs(hr.height - tr.height)};
});
ok(b1.marks.length === 2 && b1.marks[0] === '[통화 내용]', `2쪽 보기: 선 2개 (${b1.marks.join(' / ')})`);
ok(b1.dx < 0.5 && b1.dy < 0.5 && b1.dw < 0.5 && b1.dh < 0.5, `2쪽 보기: 꾸밈 층이 글 칸과 같은 자리·크기 (${[b1.dx, b1.dy, b1.dw, b1.dh].map(x => x.toFixed(2)).join(',')})`);
await page.keyboard.press('Escape'); await page.waitForTimeout(200);

/* ── 3 공유 ── */
await openForm(BASE); await page.waitForTimeout(300);
await shot('공유-화면-1-양식.png');
const btn = await page.evaluate(() => { const b = document.getElementById('fm-share'), a = b.parentElement; const r = b.getBoundingClientRect(), ar = a.getBoundingClientRect();
  return {first: a.firstElementChild === b, label: b.getAttribute('aria-label'), w: r.width, h: r.height, leftGap: r.left - ar.left}; });
ok(btn.first && btn.label === '공유' && Math.round(btn.w) === 34 && Math.round(btn.h) === 34, `공유 버튼: 단추 줄 맨 앞, aria-label 공유, 34×34 (${btn.w}×${btn.h}, 왼쪽에서 ${btn.leftGap.toFixed(0)}px)`);
/* 저장 전 고친 내용이 실리는지 — 메모 첫 줄을 고치고 바로 공유 */
await page.evaluate(() => { const m = document.getElementById('fm-memo'); m.value = m.value.replace('입찰공고 정정 사유 확인', '입찰공고 정정 사유 확인(고침)'); m.dispatchEvent(new Event('input', {bubbles: true})); });
const saves0 = await page.evaluate(() => window.__saveAll || 0);
await page.click('#fm-share'); await page.waitForTimeout(400);
const pv = await page.evaluate(() => ({on: document.getElementById('shareModal').classList.contains('on'), title: document.querySelector('#share-stage .shc-title')?.textContent,
  files: document.getElementById('share-stage').textContent.includes('정정요청'), phone: document.getElementById('share-stage').textContent.includes('02-000-0000')}));
ok(pv.on && pv.title === '입찰공고 정정 사유 확인(고침)', `미리 보기: 저장 전 고친 메모가 실림 (${pv.title})`);
ok(!pv.files && !pv.phone, '미리 보기: 파일 링크·연락처는 기본으로 뺌');
const savePng = async (name) => {
  await page.evaluate(() => { window.__saved = []; window.__t0 = performance.now(); document.getElementById('share-save').click(); });
  await page.waitForFunction(() => window.__saved.length > 0, null, {timeout: 30000});
  /* 그림 바이트는 base64 로 넘긴다(숫자 배열 그대로 넘기면 검사 도구 쪽 전달이 몇 초 걸린다 — 앱과 상관없는 시간) */
  const s = await page.evaluate(() => { const d = window.__saved[0].data; let bin = ''; for (let i = 0; i < d.length; i += 8192) bin += String.fromCharCode.apply(null, d.slice(i, i + 8192));
    return {name: window.__saved[0].name, b64: btoa(bin), ms: window.__savedAt - window.__t0}; });
  const buf = Buffer.from(s.b64, 'base64');
  if (OUT && name) fs.writeFileSync(path.join(OUT, name), buf);
  return {name: s.name, buf, w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), ms: Math.round(s.ms)};
};
const cardH = () => page.evaluate(() => { const w = document.querySelector('#share-stage .shw'); const c = w.cloneNode(true); c.querySelectorAll('.sh-fold').forEach(b => b.remove());
  c.style.zoom = ''; c.style.position = 'fixed'; c.style.left = '-30000px'; document.body.appendChild(c); const h = c.getBoundingClientRect().height; c.remove(); return h; });
const p1 = await savePng('공유-실제-출력.png');
const h1 = await cardH();
ok(p1.w === 1280 && /^뭐하려했더라_공유_\d{8}_\d{4}\.png$/.test(p1.name), `그림: 폭 1280px(카드 480+여백 16 × 2.5), 파일 이름 ${p1.name}`);
ok(Math.abs(p1.h - Math.round(Math.ceil(h1) * 2.5)) <= 3, `그림 높이 = 미리 보기 메모지 높이 × 2.5 (${p1.h} / ${(h1 * 2.5).toFixed(0)})`);
ok(await page.evaluate(() => window.__saveAll || 0) === saves0, '공유는 업무를 저장하지 않음(save_all 0번)');
/* 글꼴: 그림 속 글자가 Pretendard 인지 — 같은 마크업을 맑은 고딕으로만 찍은 그림과 다른지(그림 속 제목 폭을 DOM 의 두 글꼴 폭과 견준다) */
const fontChk = await page.evaluate(async (b64) => {
  const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const st = document.querySelector('#share-stage .shc-title'); const top = st.getBoundingClientRect().top - document.querySelector('#share-stage .shw').getBoundingClientRect().top;
  const y0 = Math.round(top * 2.5), y1 = Math.round((top + 18) * 2.5); const d = g.getImageData(0, y0, c.width, y1 - y0).data;
  let mn = 1e9, mx = -1; for (let y = 0; y < y1 - y0; y++) for (let x = 0; x < c.width; x++) { const k = (y * c.width + x) * 4; if (d[k] < 110 && d[k + 1] < 110) { mn = Math.min(mn, x); mx = Math.max(mx, x); } }
  const w = (mx - mn) / 2.5;
  const meas = (f) => { const s = document.createElement('span'); s.style.cssText = `position:fixed;left:-9999px;font:700 14px ${f};white-space:nowrap`; s.textContent = st.textContent; document.body.appendChild(s); const r = s.getBoundingClientRect().width; s.remove(); return r; };
  return {img: w, pret: meas("'Pretendard'"), malgun: meas("'Malgun Gothic'")};
}, p1.buf.toString('base64'));
ok(Math.abs(fontChk.img - fontChk.pret) < Math.abs(fontChk.img - fontChk.malgun) && Math.abs(fontChk.img - fontChk.pret) < 3, `그림 글꼴: 제목 폭 ${fontChk.img.toFixed(1)}px ≈ Pretendard ${fontChk.pret.toFixed(1)} (맑은 고딕 ${fontChk.malgun.toFixed(1)})`);
/* 연락처 스위치 */
await page.click('#share-contacts'); await page.waitForTimeout(200);
ok(await page.evaluate(() => document.getElementById('share-stage').textContent.includes('02-000-0000') && !document.getElementById('share-stage').textContent.includes('정정요청')), '연락처도 넣기: 연락처만 들어가고 파일 링크는 계속 빠짐');
await page.click('#share-contacts'); await page.waitForTimeout(100);
/* ESC 로 닫히고 양식은 남음 */
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
ok(await page.evaluate(() => !document.getElementById('shareModal').classList.contains('on') && document.getElementById('formPanel').classList.contains('on')), 'ESC: 미리 보기만 닫히고 양식으로');

/* XML 에 못 쓰는 글자(워드에서 붙여 넣은 세로 탭·제어 문자·짝 없는 서로게이트)가 든 메모도 그림이 나온다
   (예전엔 "그림을 만들지 못했습니다: The source image cannot be decoded" / "URI malformed") */
await openForm({...BASE, id: 9004}); await page.waitForTimeout(200);
await page.evaluate(() => { const m = document.getElementById('fm-memo');
  m.value = '워드에서 붙여 넣은 글' + String.fromCharCode(11) + '둘째 줄\n제어' + String.fromCharCode(1, 12, 31) + ' 문자\n반쪽 ' + String.fromCharCode(0xD83D) + ' 이모지';
  m.dispatchEvent(new Event('input', {bubbles: true})); });
await page.click('#fm-share'); await page.waitForTimeout(300);
await page.evaluate(() => { window.__saved = []; document.getElementById('share-save').click(); });
const badOk = await page.waitForFunction(() => window.__saved.length > 0 || document.getElementById('appDialog')?.classList.contains('on'), null, {timeout: 30000})
  .then(() => page.evaluate(() => window.__saved.length > 0 ? 'PNG' : document.getElementById('dlg-msg').textContent));
ok(badOk === 'PNG', `XML 에 못 쓰는 글자(세로 탭·제어 문자·짝 없는 서로게이트)가 든 메모도 그림이 나온다 (${badOk})`);
await page.keyboard.press('Escape'); await page.waitForTimeout(150);
if (badOk !== 'PNG') { await page.keyboard.press('Escape'); await page.waitForTimeout(150); }

/* ── 긴 업무(관련인 5명·하위 업무 7개·구역 셋) — 접기와 펼치기 ── */
const LONG = {id: 9002, memo: '청사 전기설비 유지관리 용역 장기계속 2차 계약\n1차 계약이 12월 말에 끝나 2차 계약을 맺어야 합니다. 과업지시서 변경분과 노임단가 조정이 걸려 있습니다.\n[검토할 것]\n과업지시서 3장 점검 주기 변경이 계약금액에 주는 영향\n노임단가 조정률 산출 근거와 적용 시점\n1차 계약 정산분과 2차 착수 시점이 겹치는지\n장기계속계약 차수별 계약금액 배분\n하자담보책임기간 승계 여부\n[통화 내용]\n운영지원과 윤소이 주무관: 과업지시서 수정본은 다음 주 월요일까지.\n재무과 최민재 사무관: 노임단가 조정은 내년 1월 공표 기준으로.\n[참고]\n2025년 1차 계약 결과 보고(계약번호 2025-0412)',
  f: {received: at(-3, 9, 30), due: at(0, now.getHours() + 1, 0)},
  contacts: [['윤소이 주무관', '운영지원과', '02-000-1001'], ['최민재 사무관', '재무과', '02-000-1002'], ['한지우 주무관', '건설사업단', '02-000-1003'], ['정다은 주무관', '총무과', '02-000-1004'], ['박하린 주무관', '정보화담당관', '02-000-1005']].map(([who, org, phone]) => ({who, org, phone, email: ''})),
  ids: [{kind: '계약번호', val: '2026-0412-2'}, {kind: '공고번호', val: 'R26BK00987654'}],
  subs: ['1차 계약 정산 확인', '과업지시서 변경분 받기', '노임단가 공표 확인', '계약심사 의뢰', '과업지시서 변경분 확인', '노임단가 조정률 검증', '2차 계약 기안'].map((t, i) => ({id: 100 + i, title: t, mid: i === 4 ? at(1, 10, 0) : '', done: i < 4, owner: i === 6 ? '박조달 주무관' : ''})),
  files: []};
await openForm(LONG); await page.waitForTimeout(300);
await page.click('#fm-share'); await page.waitForTimeout(400);
const L1 = await page.evaluate(() => ({folds: [...document.querySelectorAll('#share-stage .sh-fold')].map(b => b.dataset.fold + ':' + b.textContent), more: [...document.querySelectorAll('#share-stage .shc-more span')].map(s => s.textContent), foot: document.querySelector('#share-stage .shc-ft').textContent, imm: !!document.querySelector('#share-stage .shc-val b.imm')}));
ok(L1.more.includes('외 3명') && L1.more.some(s => s === '끝낸 것 4개 접음') && L1.more.some(s => /^아래 \d+줄 더 있음$/.test(s)), `긴 업무: 접힌 칸마다 수를 적음 (${L1.more.join(' / ')})`);
ok(L1.foot.includes('접힌 내용 있음'), `바닥줄: ${L1.foot}`);
ok(L1.imm, '기한이 2시간 안이면 임박 색');
await shot('공유-화면-2-미리보기.png');
const pl1 = await savePng('공유-실제-출력-긴-업무.png');
await page.click('#share-stage .sh-fold[data-fold="people"]'); await page.waitForTimeout(400);
await page.evaluate(() => { const st = document.getElementById('share-stage'), b = st.querySelector('.sh-fold[data-fold="people"]');
  st.scrollTop += b.getBoundingClientRect().top - st.getBoundingClientRect().top - 120; });   // 펼친 관련인 칸이 보이게
await shot('공유-화면-3-펼침.png');
const pl2 = await savePng('');
const L2 = await page.evaluate(() => document.querySelectorAll('#share-stage .shc-kv').length && [...document.querySelectorAll('#share-stage .shc-kv .who')].map(b => b.textContent));
ok(L2.length >= 5 + 0 && L2.includes('박하린 주무관'), `관련인 펼치기: 5명 모두 (${L2.length})`);
ok(pl2.h > pl1.h, `펼친 상태가 그림에 반영됨 (높이 ${pl1.h} → ${pl2.h})`);
await page.keyboard.press('Escape'); await page.waitForTimeout(200);

/* ── 4 아주 긴 내용 ── */
const HUGE = {id: 9003, memo: '아주 긴 메모\n' + ('가나다라마바사아자차카타파하 0123456789 ABCDEFG '.repeat(1100)).slice(0, 49000) + '\n[구역]\n' + '줄\n'.repeat(300),
  f: {received: at(0, 9, 0), due: ''}, contacts: Array.from({length: 60}, (_, i) => ({who: `사람${i} 주무관`, org: `부서${i}`, phone: '', email: ''})),
  ids: Array.from({length: 30}, (_, i) => ({kind: '번호', val: 'N' + i})), subs: Array.from({length: 60}, (_, i) => ({id: 500 + i, title: `하위 업무 ${i}`, mid: '', done: i % 3 === 0, owner: ''})), files: []};
await openForm(HUGE); await page.waitForTimeout(300);
const t0 = Date.now(); await page.click('#fm-share'); await page.waitForTimeout(300);
const openMs = Date.now() - t0;
/* 접힌 칸을 하나씩 펼친다 — 펼칠 때마다 다시 찾는다(메모를 펼쳐 위 한도를 다 쓰면 뒤 구역은 '구역 N개 더 있음'으로 빠져 단추가 없어진다) */
for (let guard = 0; guard < 20; guard++) {
  const k = await page.evaluate(() => document.querySelector('#share-stage .sh-fold:not(.open)')?.dataset.fold);
  if (!k) break; await page.click(`#share-stage .sh-fold[data-fold="${k}"]`); await page.waitForTimeout(80);
}
await page.waitForTimeout(6000);                                  // 펼칠 때마다 미리 만들던 그림이 끝나기를 기다린 뒤
await page.click('#share-contacts'); await page.waitForTimeout(50);  // 새 상태 → 그림 한 장을 처음부터 만드는 시간
const ph = await savePng(OUT ? '공유-긴-내용-모두-펼침.png' : ''); const pngMs = ph.ms;   // [파일로 저장]을 누른 때부터 저장 명령이 불릴 때까지(그림 만들기 + 바이트 꾸리기)
ok(ph.h <= 16000 && ph.w <= 1280, `모두 펼친 아주 긴 업무: 그림 ${ph.w}×${ph.h}px (위 한도 16000), 한 장 만들기 ${pngMs}ms, 창 열기 ${openMs}ms`);
ok(pngMs < 5000, '아주 긴 업무도 5초 안에 그림 한 장을 만든다');
await page.keyboard.press('Escape'); await page.waitForTimeout(200);

/* 줄바꿈 없는 5만 자 메모·구역 1000개 — 접힌 그대로도 그림 폭이 줄지 않는다
   (예전엔 제목·구역 수에 한도가 없어 그림이 279×16000·66×16000px 로 줄어 읽을 수 없었다) */
for (const [nm, memo] of [['줄바꿈 없는 5만 자 메모', '가나다라마바사 아자차카타파하 공고문 규격 정정 '.repeat(2000).slice(0, 50000)],
  ['구역 1000개 메모', '구역 많은 메모\n' + Array.from({length: 1000}, (_, i) => `[구역 ${i}]\n${i}번 구역 첫 줄`).join('\n')]]) {
  await openForm({...BASE, id: 9005 + nm.length, memo, subs: [], contacts: [], ids: []}); await page.waitForTimeout(200);
  await page.click('#fm-share'); await page.waitForTimeout(300);
  const pp = await savePng('');
  ok(pp.w === 1280 && pp.h < 8000, `${nm}: 접힌 그대로 그림 ${pp.w}×${pp.h}px (폭 그대로·높이 한도 안)`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
}

/* ── 좁은 창(375px·560px): 미리 보기가 가로로 넘치지 않는다(메모지만 줄여 보인다) · 공유 버튼이 창 안 ── */
if (!WV2) for (const W of [375, 560]) {
  await page.setViewportSize({width: W, height: 800}); await page.waitForTimeout(200);
  await openForm(BASE); await page.waitForTimeout(300);
  const fb = await page.evaluate(() => { const r = document.getElementById('fm-share').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; });
  await page.click('#fm-share'); await page.waitForTimeout(300);
  const o = await page.evaluate(() => { const st = document.getElementById('share-stage'); const acts = [...document.querySelectorAll('#shareModal .m-actions .btn')].map(b => b.getBoundingClientRect());
    return {page: document.documentElement.scrollWidth <= innerWidth, stage: st.scrollWidth <= st.clientWidth, btns: acts.every(r => r.left >= 0 && r.right <= innerWidth)}; });
  ok(fb && o.page && o.stage && o.btns, `폭 ${W}px: 공유 버튼·미리 보기·단추가 창 안, 가로 넘침 없음 (${JSON.stringify(o)})`);
  if (W === 375) await shot('공유-좁은-창-375.png');
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
}
if (!WV2) await page.setViewportSize({width: 1280, height: 800});

/* ── 5 진짜 클립보드(WV2=1) ── */
if (WV2) {
  const ps = (cmd) => execFileSync('powershell', ['-NoProfile', '-STA', '-Command', cmd], {encoding: 'utf8'}).trim();
  const before = ps('Get-Clipboard -Raw');
  await openForm(BASE); await page.waitForTimeout(300);
  await page.click('#fm-share'); await page.waitForTimeout(1500);
  await page.bringToFront();
  await page.click('#share-img'); await page.waitForTimeout(1200);
  const toast = await page.evaluate(() => document.getElementById('toast-msg')?.textContent);
  const img = ps('Add-Type -AssemblyName System.Windows.Forms; $i=[System.Windows.Forms.Clipboard]::GetImage(); if($i){"$($i.Width)x$($i.Height)"}else{"none"}');
  ok(/^1280x\d+$/.test(img) && /메모지 그림을 복사했습니다/.test(toast || ''), `[그림 복사] → 진짜 클립보드에 PNG ${img} · 토스트 "${toast}"`);
  await page.click('#share-text'); await page.waitForTimeout(800);
  const txt = ps('Get-Clipboard -Raw');
  ok(txt.startsWith('[업무 공유]') && txt.includes('■ 통화 내용'), `[글자로 복사] → 진짜 클립보드 글자 (${txt.split(/\r?\n/)[0]})`);
  if (before) execFileSync('powershell', ['-NoProfile', '-Command', 'Set-Clipboard -Value $input'], {input: before});   // 사용자 클립보드 글자를 되돌린다
}

console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
if (proc) proc.kill(); else await browser.close();
server.close(); process.exit(fails ? 1 : 0);

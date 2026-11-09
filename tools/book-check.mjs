// 2쪽 보기 정확성 검사 — 꽉 찬 쪽에 많이 쓰기·많이 지우기·쪽 경계 Backspace/Delete 후
// ① 쪽을 이어 붙이면 양식 메모와 같다 ② 기대한 글이 기대한 자리에 있다 ③ 정리 후 넘친 쪽이 없다 ④ 정리 후 쪽 수가 처음 나눈 것과 같다
// v3.7.4 — 2쪽 보기를 고치면 이걸 돌린다: PW_CHANNEL 없이 Edge 로 실행. `node tools/book-check.mjs`
// (playwright-core 는 다른 도구처럼 `npm install --no-save playwright-core`)
import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import { pathToFileURL, fileURLToPath } from "node:url";
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); const ROOT = path.join(REPO, "src");
const { makeInit, BOOK_MEMO } = await import(pathToFileURL(path.join(REPO, "docs/소개영상/원본/sample-data.mjs")).href);
const INIT = makeInit(fs.readFileSync(path.join(REPO, "tools/guide-shots.mjs"), "utf8"));
const pw = await import(pathToFileURL(path.join(REPO, "node_modules/playwright-core/index.js")).href);
const chromium = (pw.default && pw.default.chromium) || pw.chromium;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2" };
const server = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split("?")[0]); if (p === "/") p = "/index.html";
  fs.readFile(path.join(ROOT, p), (e, b) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { "Content-Type": MIME[path.extname(p)] || "application/octet-stream" }); r.end(b); }); });
await new Promise((r) => server.listen(0, r));
const b = await chromium.launch({ channel: "msedge" });
const page = await b.newPage({ viewport: { width: 1477, height: 830 } });
page.on("pageerror", (e) => console.log("ERR", e.message));
await page.addInitScript(INIT);
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.evaluate(() => document.querySelector('#view-board5 .card .card-memo, #view-board .card .card-memo').click());
await page.waitForTimeout(400);
const ORIG = Array(8).fill(BOOK_MEMO).join("\n\n");
await page.evaluate((t) => { const m = document.getElementById("fm-memo"); m.value = t; m.dispatchEvent(new Event("input", { bubbles: true })); }, ORIG);
await page.click("#fm-book"); await page.waitForTimeout(800);
let fails = 0; const ok = (c, msg) => { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) fails++; };
const state = () => page.evaluate(() => { const tas = [...document.querySelectorAll("#book-pages .book-ta")];
  return { n: tas.length, joined: tas.map(t => t.value).join(""), memo: document.getElementById("fm-memo").value,
    over: tas.map((t, i) => t.scrollHeight > t.clientHeight + 1 ? i : -1).filter(i => i >= 0), caret: (() => { const a = document.activeElement, i = tas.indexOf(a); return i < 0 ? null : tas.slice(0, i).reduce((s, t) => s + t.value.length, 0) + a.selectionStart; })() }; });
const s0 = await state();
ok(s0.joined === ORIG && s0.over.length === 0, `처음: ${s0.n}쪽, 원문 일치, 넘친 쪽 없음`);
// 1) 첫 쪽 가운데에 400자를 키 단위로 입력(꽉 찬 쪽 → 밀림 발생)
const INS = "가나다라마바사아자차 ".repeat(40);
const at = await page.evaluate(() => { const t = document.querySelector("#book-pages .book-ta"); t.focus(); const p = Math.floor(t.value.length / 2); t.setSelectionRange(p, p); return p; });
const maxMs = await page.evaluate(async (ins) => { let mx = 0;
  for (const ch of ins) { const t = document.activeElement, a = t.selectionStart, t0 = performance.now();
    t.setRangeText(ch, a, a, "end"); t.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: ch }));
    void document.body.offsetHeight; mx = Math.max(mx, performance.now() - t0); await new Promise(r => setTimeout(r, 0)); }
  return mx; }, INS);
let s1 = await state();
const EXP1 = ORIG.slice(0, at) + INS + ORIG.slice(at);
ok(s1.joined === EXP1, "입력 직후: 쪽 이어붙임 = 기대 글(넣은 자리 정확)");
ok(s1.memo === EXP1, "입력 직후: 양식 메모도 같음");
ok(s1.caret === at + INS.length, `입력 직후: 커서가 넣은 글 끝에 있음 (${s1.caret} / ${at + INS.length})`);
ok(s1.over.every(i => i > 1), `입력 직후: 보이는 1·2쪽은 넘치지 않음 (넘친 쪽: ${s1.over.join(",") || "없음"})`);
console.log(`     키 하나 최대 처리 시간 ${maxMs.toFixed(1)}ms`);
await page.waitForTimeout(1500);
let s2 = await state();
ok(s2.joined === EXP1 && s2.over.length === 0, `정리 후: 글 그대로, 넘친 쪽 없음 (${s2.n}쪽)`);
ok(s2.caret === at + INS.length, "정리 후: 커서 자리 유지");
// 2) 방금 넣은 글을 Backspace 로 전부 지움 → 정리 후 처음과 같은 쪽 수
await page.evaluate(async (n) => { for (let i = 0; i < n; i++) { const t = document.activeElement, a = t.selectionStart;
  if (a === 0) { t.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true })); }
  else { t.setRangeText("", a - 1, a, "end"); t.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" })); }
  await new Promise(r => setTimeout(r, 0)); } }, INS.length);
await page.waitForTimeout(1500);
const s3 = await state();
ok(s3.joined === ORIG && s3.memo === ORIG, "모두 지운 뒤: 원문과 같음");
ok(s3.over.length === 0, "모두 지운 뒤: 넘친 쪽 없음");
ok(s3.n === s0.n, `모두 지운 뒤: 쪽 수가 처음과 같음 (${s3.n} / ${s0.n})`);
// 3) 쪽 경계 Backspace — 둘째 쪽 맨 앞에서
const s4b = await page.evaluate(() => { const tas = [...document.querySelectorAll("#book-pages .book-ta")]; const t = tas[1]; t.focus(); t.setSelectionRange(0, 0);
  t.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true })); return tas[0].value.length; });
await page.waitForTimeout(1200);
const s4 = await state();
const cut = s0.joined.length; // 기대: 1쪽 마지막 글자 하나가 지워짐
ok(s4.joined.length === ORIG.length - 1 && s4.memo === s4.joined, "쪽 경계 Backspace: 한 글자만 지워지고 메모와 같음");
// 4) 닫기 → 하이라이트·임시저장 이벤트가 나갔는지(양식 메모 값이 같고 초안이 저장 대기)
await page.click("#bookDone"); await page.waitForTimeout(300);
const fin = await page.evaluate(() => document.getElementById("fm-memo").value.length);
ok(fin === ORIG.length - 1, "닫은 뒤: 양식 메모 길이 일치");
console.log(fails ? `\n${fails} FAIL` : "\nALL PASS");
await b.close(); server.close();

// 소개영상 장면 갈무리 — 실제 앱 화면(src/)을 Edge 에 1920×1080(2배율)으로 띄워 찍고,
// 카메라·강조 테두리가 겨냥할 요소의 위치(shots.json, CSS px)를 함께 기록한다.
// 시나리오 "디지털조달관리과 김정보 주무관의 하루"(script.mjs — 전자입찰 장애 대응)의 장면 순서대로 찍는다.
// 미니 창(빠른 메모·검색)은 실제 capture.html 을 보드 위에 띄운 iframe 으로, 문서 탭은 demo-docs/ 의 실제 파일로 찍는다
// (한글 쪽 보기는 진짜 rhwp WebAssembly 가 그린다). 데이터는 sample-data.mjs 의 가상 예시.
// 실행: node capture.mjs (저장소의 node_modules/playwright-core 사용)
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { makeInit } from "./sample-data.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const ROOT = path.join(REPO, "src"), DEMO = path.join(HERE, "demo-docs");
const INIT = makeInit(fs.readFileSync(path.join(REPO, "tools/guide-shots.mjs"), "utf8"));
const pw = await import(pathToFileURL(path.join(REPO, "node_modules", "playwright-core", "index.js")).href);
const chromium = (pw.default && pw.default.chromium) || pw.chromium;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".png": "image/png", ".svg": "image/svg+xml", ".wasm": "application/wasm",
  ".md": "text/plain; charset=utf-8", ".csv": "text/plain; charset=utf-8", ".sql": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".hwpx": "application/octet-stream" };
const server = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split("?")[0]); if (p === "/") p = "/index.html";
  const file = p.startsWith("/__demo/") ? path.join(DEMO, p.slice(8)) : path.join(ROOT, p);
  fs.readFile(file, (e, b) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { "Content-Type": MIME[path.extname(p)] || "application/octet-stream" }); r.end(b); }); });
await new Promise((r) => server.listen(0, r)); const port = server.address().port;
const b = await chromium.launch({ channel: "msedge" });
const page = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });   // 2배율 — 영상에서 확대해도 글자가 또렷하게
page.on("pageerror", (e) => console.log("ERR", e.message));
await page.addInitScript(INIT);
await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle" });
await page.waitForTimeout(900);
const SHOTS = {};
const wait = (ms) => page.waitForTimeout(ms);
/* 상자 위치: CSS 선택자, 또는 "js:<요소를 돌려주는 식>", 또는 "frame:<iframe 안 선택자>"(iframe 위치를 더한다) */
const box = async (sel) => {
  const r = await page.evaluate((s) => {
    let el, off = { x: 0, y: 0 };
    if (s.startsWith("js:")) el = (0, eval)(s.slice(3));
    else if (s.startsWith("frame:")) { const f = document.getElementById("capFrame"); const fr = f.getBoundingClientRect(); off = { x: fr.x, y: fr.y }; el = f.contentDocument.querySelector(s.slice(6)); }
    else el = document.querySelector(s);
    if (!el) return null; const b = el.getBoundingClientRect();
    return { x: Math.round(b.x + off.x), y: Math.round(b.y + off.y), w: Math.round(b.width), h: Math.round(b.height) };
  }, sel);
  if (!r) throw new Error("no element " + sel); return r;
};
async function shot(name, boxes) {
  await wait(280);
  await page.screenshot({ path: path.join(HERE, "shots", name + ".jpg"), type: "jpeg", quality: 95 });
  SHOTS[name] = {};
  for (const [k, sel] of Object.entries(boxes)) SHOTS[name][k] = await box(sel);
  console.log("shot", name);
}
const park = () => page.mouse.move(1915, 1075);
const esc = async () => { await page.keyboard.press("Escape"); await wait(200); };
const cardBy = (text) => `js:[...document.querySelectorAll('#view-board5 .card')].find(c=>c.textContent.includes(${JSON.stringify(text)}))`;
const openCard = (text) => page.evaluate((s) => (0, eval)(s).querySelector(".card-memo").click(), cardBy(text).slice(3));
const tab = async (v) => { await page.click(`.tab[data-view="${v}"]`); await wait(500); };
const dkey = (rel) => `#dt-tree [data-dkey="0:${rel}"]`;
const pad = (n) => String(n).padStart(2, "0");
const now = new Date(); const today = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())}`;
fs.mkdirSync(path.join(HERE, "shots"), { recursive: true });
/* 미니 창 띄우기 — 실제 capture.html 을 보드 위 작은 창 크기로 */
async function openMini(h) {
  await page.evaluate((h) => { const f = document.createElement("iframe"); f.id = "capFrame"; f.src = "capture.html";
    Object.assign(f.style, { position: "fixed", left: "650px", top: "250px", width: "620px", height: h + "px", border: "0", zIndex: 9999, background: "transparent", colorScheme: "light" });
    f.setAttribute("allowtransparency", "true"); document.body.appendChild(f); }, h);
  await page.evaluate(() => { const d = document.createElement("div"); d.id = "capDim";
    Object.assign(d.style, { position: "fixed", inset: "0", background: "rgba(19,26,36,.38)", zIndex: 9998 }); document.body.appendChild(d); });
  await wait(900);
  return page.frame({ url: /capture\.html/ });
}
/* 미니 창 높이를 실제 내용에 맞추고 그림자를 단다 — 흰 보드 위 흰 창이 묻히지 않게(실제로는 바탕화면 위에 뜨는 창) */
async function fitMini(fr) {
  const h = await fr.evaluate(() => { const el = document.getElementById("cap-shell") || document.body.firstElementChild; return Math.ceil(el.getBoundingClientRect().height); });
  await page.evaluate((h) => { const f = document.getElementById("capFrame"); Object.assign(f.style, { height: h + "px", borderRadius: "16px", boxShadow: "0 28px 70px rgba(0,0,0,.38), 0 4px 14px rgba(0,0,0,.18)" }); }, h);
  await wait(200);
}
const closeMini = () => page.evaluate(() => { document.getElementById("capFrame")?.remove(); document.getElementById("capDim")?.remove(); });

// ── 1. 아침 보드 ───────────────────────────────────────────────
await park();
await shot("board", { board: "#view-board5", colMe: "#view-board5 .col:nth-child(2) .col-head", colOth: "#view-board5 .col:nth-child(3) .col-head", metrics: "#metrics", tabs: "nav.tabs" });

// ── 2. 전자입찰 장애 → 빠른 메모 · @자동완성 ─────────────────────
let fr = await openMini(170);
await fr.click("#cap-search"); await fr.page().keyboard.press("Alt"); await wait(300);
await fr.click("#cap-inp"); await fr.type("#cap-inp", "투찰 화면 멈춤 문의, 장애 복구되면 회신 ", { delay: 8 }); await fitMini(fr); await park();
await shot("mini-memo", { frame: "#capFrame", inp: "frame:#cap-inp" });
await page.evaluate(() => { document.getElementById("capFrame").style.height = "470px"; });
await fr.type("#cap-inp", "@김민", { delay: 30 }); await wait(500); await fitMini(fr); await park();
await shot("mini-at", { frame: "#capFrame", pb: "frame:#cap-pb", inp: "frame:#cap-inp" });
await closeMini();
await page.evaluate(async () => { const m = await import("./form.js"); m.captureMemo("투찰 화면 멈춤 문의, 장애 복구되면 회신 @김민준"); });
await wait(400); await park();
await shot("board-new", { card: cardBy("투찰 화면 멈춤 문의"), inbox: "#view-board5 .col:nth-child(1)" });

// ── 3. 업무로 다듬기 ─────────────────────────────────────────────
await openCard("투찰 화면 멈춤 문의"); await wait(500); await park();
await shot("form-new", { panel: "#formPanel .fm-inner", memo: "#fm-memo", contacts: ".fm-contacts" });
await page.click("#fm-subadd"); await wait(200);
const hh = Math.min(22, now.getHours() + 1);
await page.fill("#fm-subs .fsub-row .fsub-title", "장애 복구 확인 후 업체 회신");
await page.fill("#fm-subs .fsub-row .dt-date", today);
await page.fill("#fm-subs .fsub-row .dt-time", `${pad(hh)}:00`);
await page.locator("#fm-subs .fsub-row .dt-time").blur(); await wait(200); await park();
await shot("form-sub", { subs: ".fm-subs", save: "#fm-save" });
await page.click("#fm-save"); await wait(500); await park();
await shot("board-moved", { card: cardBy("투찰 화면 멈춤 문의"), colMe: "#view-board5 .col:nth-child(2)" });
/* 메모 합치기 — 카드를 끌어 다른 카드 위로(놓기 직전) */
{
  const a = await box(cardBy("투찰 지연 업체 회신 목록 정리")); const t = await box(cardBy("전자입찰 장애"));
  await page.mouse.move(a.x + 60, a.y + 18); await page.mouse.down(); await page.mouse.move(a.x + 90, a.y + 30, { steps: 4 });
  await page.mouse.move(t.x + 120, t.y + 22, { steps: 10 }); await wait(250);
  await shot("merge", { target: "#view-board5 .card.merge-over", ghost: ".drag-ghost", inbox: "#view-board5 .col:nth-child(1)" });
  await page.mouse.move(1900, 1060, { steps: 6 }); await page.mouse.up(); await wait(300);
}

// ── 4. 알림 · 업무 종료 ───────────────────────────────────────────
await page.evaluate(() => {
  const t = new Date(); const hm = String(t.getHours()).padStart(2, "0") + ":" + String(t.getMinutes()).padStart(2, "0");
  document.getElementById("alarmList").innerHTML =
    '<div class="a-item a-mid"><b>점검</b>장애 공지 게시<span class="num">' + hm + "</span></div>" +
    '<div class="a-item a-due"><b>마감</b>이용자 등록 — ㈜한빛정보 인증서 재발급 문의 회신<span class="num">' + hm + "</span></div>";
  document.getElementById("alarmBg").classList.add("on");
}); await park();
await shot("alarm", { alarm: "#alarmBg .alarm" });
await page.evaluate(() => document.getElementById("alarmBg").classList.remove("on"));
await openCard("인증서 재발급 문의 회신"); await wait(500);
await page.evaluate(() => { const p = document.getElementById("formPanel"); p.scrollTop = p.scrollHeight; }); await park();
await shot("form-finish", { finish: "#fm-finish", actions: ".fm-actions" });
await page.click("#fm-finish"); await wait(500); await park();
await shot("finished", { metrics: "#metrics", toast: "#toast" });
await page.click("#toast-undo"); await wait(400);

// ── 5. 문서 탭 ───────────────────────────────────────────────────
await tab("docs"); await wait(600);
await page.click("#g-search"); await page.keyboard.type("투찰", { delay: 60 }); await wait(900); await park();
await shot("docs-search", { tree: "#dt-tree", hits: "js:document.querySelector('#dt-tree .dt-hit').parentElement", search: "#g-search", hit0: "#dt-tree .dt-hit" });
await page.click("#g-search"); await page.keyboard.press("Escape"); await wait(500);
await page.click(dkey("2026 나라장터 운영/장애 조치 결과 보고.hwpx"));
for (let k = 0; k < 80; k++) { if (await page.$("#dv-body img.dv-hwp-pg")) break; await wait(150); }
await wait(1200); await park();
await shot("docs-hwp", { page: "#dv-body img.dv-hwp-pg", body: "#dv-body", file: dkey("2026 나라장터 운영/장애 조치 결과 보고.hwpx") });
await page.click(dkey("2026 나라장터 운영/장애 접수 목록.csv")); await wait(900); await park();
await shot("docs-csv", { table: "#dv-md table", body: "#dv-body" });
await page.click(dkey("2026 나라장터 운영/장애 시간대 투찰 기록 조회.sql")); await wait(1200); await park();
await shot("docs-sql", { code: "#dv-code", body: "#dv-body" });
{ const add = (await page.$("#dn-add2:visible")) ? "#dn-add2" : "#dn-add"; await page.click(add); await wait(700); }
await page.click("#fm-memo"); await page.keyboard.type("장애 시간대 실패 투찰 12건 — 업체별 재투찰 안내", { delay: 6 }); await wait(300); await park();
await shot("docs-dock", { form: "#formPanel", code: "#dv-code", memo: "#fm-memo" });
await esc(); { const d = await page.$("#appDialog.on #dlg-cancel"); if (d) await d.click(); }
await page.evaluate(async () => { const { S } = await import("./state.js"); if (S.settings.formDrafts) delete S.settings.formDrafts.new; });
await wait(300);

// ── 6. 다시 찾기 ──────────────────────────────────────────────────
await tab("board");
fr = await openMini(406);
await fr.click("#cap-search"); await fr.type("#cap-search", "R26BK", { delay: 25 }); await wait(700); await fitMini(fr); await park();
await shot("mini-search", { frame: "#capFrame", results: "frame:#cap-results" });
await closeMini();
await tab("cal"); await wait(400); await park();
await shot("cal", { grid: "#cal-grid", detail: "#cal-detail", chip0: "#cal-detail-cards .tl-chip", now: ".tl-now" });
{ const slot = await page.evaluate(() => { const cv = document.querySelector("#cal-detail-cards .tl-canvas"); const r = cv.getBoundingClientRect(); const h = cv.scrollHeight / 24;
    const sc = [...document.querySelectorAll("#view-cal *")].find((e) => e.scrollHeight > e.clientHeight + 20 && e.contains(cv)); if (sc) sc.scrollTop += (r.top + 20.5 * h) - 560;
    const r2 = cv.getBoundingClientRect(); return { x: r2.left + r2.width * 0.62, y: r2.top + 20.5 * h }; });
  await wait(300); await page.mouse.click(slot.x, slot.y); await wait(600); }
await page.click("#fm-memo"); await page.keyboard.type("장애 원인 분석 보고서 초안", { delay: 6 }); await wait(200); await park();
await shot("cal-new", { panel: "#formPanel .fm-inner", subs: ".fm-subs" });
await esc(); { const d = await page.$("#appDialog.on #dlg-cancel"); if (d) await d.click(); }
await page.evaluate(async () => { const { S } = await import("./state.js"); if (S.settings.formDrafts) delete S.settings.formDrafts.new; });
await tab("done"); await wait(400); await park();
await shot("done", { strip: "#done-cal", list: "#col-done", head: "#col-done .drow-h" });
await page.evaluate(() => { const d = [...document.querySelectorAll("#done-cal .dcal-has:not(.dcal-today)")].pop(); d.click(); }); await wait(400); await park();
await shot("done-day", { strip: "#done-cal", day: "#done-cal .dcal-d.on", list: "#col-done" });
await page.evaluate(() => document.querySelector("#done-cal .dcal-clear")?.click()); await wait(200);

// ── 7. 사람으로 찾기 · 담당자 교체 ─────────────────────────────────
await tab("phone"); await wait(300);
await page.click('#pb-list .pb-item[data-pbid="901"]'); await wait(500); await park();
await shot("phone-side", { list: "#pb-list", row: '#pb-list .pb-item[data-pbid="901"]', side: "#pb-side" });
await page.hover('#pb-list .pb-item[data-pbid="902"]'); await wait(200);
await shot("phone-swap", { row: '#pb-list .pb-item[data-pbid="902"]', swap: '#pb-list [data-pbswap="902"]' });
await page.click('#pb-list [data-pbswap="902"]'); await wait(300);
await page.click('#pbsw-list [data-swapto="907"]'); await wait(250); await park();
await shot("swap", { modal: "#pbSwapModal .modal", pick: '#pbsw-list [data-swapto="907"]', sum: "#pbsw-sum", go: "#pbsw-go" });
await page.click("#pbsw-cancel"); await wait(200);

// ── 8. 화면 테마 · 데이터 ─────────────────────────────────────────
await tab("board");
await page.click("#settingsBtn"); await wait(400);
await page.evaluate(() => { const m = document.querySelector("#settingsModal .modal"); m.scrollTop = 0; }); await wait(250); await park();
await shot("settings-top", { modal: "#settingsModal .modal", theme: "#segTheme" });
await esc();
await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark")); await park();
await shot("board-dark", { board: "#view-board5" });
await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
await page.click("#settingsBtn"); await wait(400);
await page.evaluate(() => { const m = document.querySelector("#settingsModal .modal"); m.scrollTop = m.scrollHeight; }); await wait(250); await park();
await shot("settings-data", { modal: "#settingsModal .modal", data: "js:document.getElementById('bkExp').closest('.set-card')", bk: "#bkExp" });
await esc();

fs.writeFileSync(path.join(HERE, "shots.json"), JSON.stringify(SHOTS, null, 1));
await b.close(); server.close();
console.log("done", Object.keys(SHOTS).length, "shots");

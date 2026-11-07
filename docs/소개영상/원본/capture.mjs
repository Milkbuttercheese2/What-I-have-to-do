// 소개영상 장면 갈무리 — 실제 앱 화면(src/)을 Edge 에 1920×1080(2배율)으로 띄워 찍고,
// 카메라·강조 테두리가 겨냥할 요소의 위치(shots.json, CSS px)를 함께 기록한다.
// 시나리오 "박조달 주무관의 하루"(script.mjs)의 장면 순서대로 찍는다. 미니 창(빠른 메모·검색)은
// 실제 capture.html 을 보드 위에 띄운 iframe 으로 찍는다(실제 앱에서도 보드 위에 떠 있는 작은 창이다).
// 데이터는 sample-data.mjs 의 가상 예시. 실행: node capture.mjs (저장소의 node_modules/playwright-core 사용)
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { makeInit } from "./sample-data.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const ROOT = path.join(REPO, "src");
const INIT = makeInit(fs.readFileSync(path.join(REPO, "tools/guide-shots.mjs"), "utf8")).replace("boardMode:'time'", "boardMode:'owner'");
const pw = await import(pathToFileURL(path.join(REPO, "node_modules", "playwright-core", "index.js")).href);
const chromium = (pw.default && pw.default.chromium) || pw.chromium;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".png": "image/png", ".svg": "image/svg+xml" };
const server = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split("?")[0]); if (p === "/") p = "/index.html";
  fs.readFile(path.join(ROOT, p), (e, b) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { "Content-Type": MIME[path.extname(p)] || "application/octet-stream" }); r.end(b); }); });
await new Promise((r) => server.listen(0, r)); const port = server.address().port;
const b = await chromium.launch({ channel: "msedge" });
const page = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });   // 2배율 — 영상에서 1.5~1.8배 확대해도 글자가 또렷하게(1배율은 뭉개졌다)
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
const pad = (n) => String(n).padStart(2, "0");
const now = new Date(); const today = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())}`;
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
await shot("board", { board: "#view-board5", cols: "#view-board5", colMe: "#view-board5 .col:nth-child(2) .col-head", colOth: "#view-board5 .col:nth-child(3) .col-head",
  metrics: "#metrics", red: "js:document.querySelector('#view-board5 .adot.ad-ring').closest('.card')", tabs: "nav.tabs", presets: "#presets" });

// ── 2. 전화 → 빠른 메모 · @자동완성 ─────────────────────────────
let fr = await openMini(170);
await fr.click("#cap-search"); await fr.page().keyboard.press("Alt"); await wait(300);
await fr.click("#cap-inp"); await fr.type("#cap-inp", "냉난방기 교체 견적 문의 — 금요일까지 회신 ", { delay: 8 }); await fitMini(fr); await park();
await shot("mini-memo", { frame: "#capFrame", inp: "frame:#cap-inp" });
await page.evaluate(() => { document.getElementById("capFrame").style.height = "470px"; });
await fr.type("#cap-inp", "@김계", { delay: 30 }); await wait(500); await fitMini(fr); await park();
await shot("mini-at", { frame: "#capFrame", pb: "frame:#cap-pb", inp: "frame:#cap-inp" });
await closeMini();
/* 등록 — 미니 창은 메인 창으로 이벤트를 보내 captureMemo 를 부른다. 갈무리에선 같은 함수를 직접 부른다 */
await page.evaluate(async () => { const m = await import("./form.js"); m.captureMemo("냉난방기 교체 견적 문의 — 금요일까지 회신 @김계약 주무관"); });
await wait(400); await park();
await shot("board-new", { card: cardBy("냉난방기 교체 견적 문의 — 금요일"), inbox: "#view-board5 .col:nth-child(1)" });

// ── 3. 업무로 다듬기 ─────────────────────────────────────────────
await page.click(cardBy("냉난방기 교체 견적 문의 — 금요일").slice(0, 0) || "body", { trial: true }).catch(() => {});
await page.evaluate((s) => (0, eval)(s).querySelector(".card-memo").click(), cardBy("냉난방기 교체 견적 문의 — 금요일").slice(3)); await wait(500);
await park();
await shot("form-new", { panel: "#formPanel .fm-inner", memo: "#fm-memo", contacts: ".fm-contacts" });
const hh = Math.min(22, now.getHours() + 2);
await page.fill("#fm-subs .fsub-row .fsub-title", "견적서 3곳 받아 비교");
await page.fill("#fm-subs .fsub-row .dt-date", today);
await page.fill("#fm-subs .fsub-row .dt-time", `${pad(hh)}:00`);
await page.locator("#fm-subs .fsub-row .dt-time").blur(); await wait(200); await park();
await shot("form-sub", { subs: ".fm-subs", save: "#fm-save", place: "#fm-place" });
await page.click("#fm-save"); await wait(500); await park();
await shot("board-moved", { card: cardBy("냉난방기 교체 견적 문의 — 금요일"), colMe: "#view-board5 .col:nth-child(2)" });
await page.click("#presets .preset"); await wait(500); await park();
await shot("form-preset", { panel: "#formPanel .fm-inner", memo: "#fm-memo", head: ".fm-head" });
await page.click("#fm-revert"); await wait(200);
await page.evaluate(() => document.querySelector("#appDialog .btn-ok")?.click()); await wait(200); await esc();
/* 파일 끌어다 놓기 */
await page.evaluate((s) => (0, eval)(s).querySelector(".card-memo").click(), cardBy("계약변경 검토 후 회계과에 회신").slice(3)); await wait(500);
await page.evaluate(() => { const p = document.getElementById("formPanel"); p.scrollTop = p.scrollHeight; }); await wait(250);
await page.evaluate(() => { document.querySelector(".fm-files-wrap").classList.add("drop-on"); document.getElementById("dropVeil").classList.add("on"); document.getElementById("dropCard").textContent = "놓으면 이 양식의 링크 칸에 추가합니다"; });
await park();
await shot("form-drop", { files: ".fm-files-wrap", veil: "#dropCard" });
await page.evaluate(() => { document.querySelectorAll(".drop-on").forEach((e) => e.classList.remove("drop-on")); document.getElementById("dropVeil").classList.remove("on"); });
await page.evaluate(async () => { const m = await import("./form.js"); m.addLinkPaths(["C:\\조달계약\\2026\\입찰공고_정정사유서.hwp"]); }); await wait(250); await park();
await shot("form-linked", { files: ".fm-files-wrap", lastFile: "#fm-files .ffile-row:last-child", finish: "#fm-finish" });
/* 업무 종료(같은 양식) */
await page.evaluate(() => { const p = document.getElementById("formPanel"); p.scrollTop = p.scrollHeight; }); await park();
await shot("form-finish", { finish: "#fm-finish", actions: ".fm-actions" });
await page.click("#fm-finish"); await wait(500); await park();
await shot("finished", { metrics: "#metrics", toast: "#toast" });
await page.click("#toast-undo"); await wait(400);
/* 메모 합치기 — 카드를 끌어 다른 카드 위로(놓기 직전) */
{
  const a = await box(cardBy("청소용역 선금 지급 요청 검토")); const t = await box(cardBy("청소용역 계약체결 및 보증서 접수"));
  await page.mouse.move(a.x + 60, a.y + 18); await page.mouse.down(); await page.mouse.move(a.x + 90, a.y + 30, { steps: 4 });
  await page.mouse.move(t.x + 120, t.y + 22, { steps: 10 }); await wait(250);
  await shot("merge", { target: "#view-board5 .card.merge-over", ghost: ".drag-ghost", inbox: "#view-board5 .col:nth-child(1)" });
  await page.mouse.move(1900, 1060, { steps: 6 }); await page.mouse.up(); await wait(300);
}

// ── 4. 알림 · 2쪽 보기 ────────────────────────────────────────────
await page.evaluate(() => {
  const t = new Date(); const hm = String(t.getHours()).padStart(2, "0") + ":" + String(t.getMinutes()).padStart(2, "0");
  document.getElementById("alarmList").innerHTML =
    '<div class="a-item"><b>점검 </b>견적서 3곳 받아 비교 — 냉난방기 교체 견적 문의<span class="num">' + hm + "</span></div>" +
    '<div class="a-item"><b>마감 </b>청사 전기설비 유지관리 용역 계약변경 검토 회신<span class="num">' + hm + "</span></div>";
  document.getElementById("alarmBg").classList.add("on");
}); await park();
await shot("alarm", { alarm: "#alarmBg .alarm" });
await page.evaluate(() => document.getElementById("alarmBg").classList.remove("on"));
await page.evaluate((s) => (0, eval)(s).querySelector(".card-memo").click(), cardBy("제안서 평가자료 준비").slice(3)); await wait(400);
await page.evaluate(() => { const m = document.getElementById("fm-memo"); m.value = Array.from({ length: 70 }, (_, i) => `${i + 1}. 청소용역 제안서 평가 — 평가위원 ${i % 7 + 1}번 의견 정리 및 회신 내용 메모`).join("\n"); m.dispatchEvent(new Event("input", { bubbles: true })); });
await page.click("#fm-book"); await wait(450); await park();
await shot("book", { modal: "#bookModal .modal", view: "#book-view", next: "#book-next" });
await esc();
await page.click("#fm-revert"); await wait(200); await page.evaluate(() => document.querySelector("#appDialog .btn-ok")?.click()); await wait(200); await esc();

// ── 5. 다시 찾기 ──────────────────────────────────────────────────
fr = await openMini(406);
await fr.click("#cap-search"); await fr.type("#cap-search", "청소용역", { delay: 25 }); await wait(700); await fitMini(fr); await park();
await shot("mini-search", { frame: "#capFrame", results: "frame:#cap-results" });
await closeMini();
await page.click('.tab[data-view="done"]'); await wait(400);
await page.evaluate(() => [...document.querySelectorAll("#col-done .card")].find((c) => c.textContent.includes("입찰공고 정정 공고")).querySelector(".card-memo").click()); await wait(500); await park();
await shot("form-ro", { reopen: "#fm-reopen", place: "#fm-place", head: ".fm-head", panel: "#formPanel .fm-inner" });
await esc();
await page.click('.tab[data-view="cal"]'); await wait(500); await park();
await shot("cal", { grid: "#cal-grid", today: ".cal-day.today", detail: "#cal-detail", chip0: "#cal-detail-cards .tl-chip", now: ".tl-now" });
await page.click('.tab[data-view="done"]'); await wait(400); await park();
await shot("done", { groups: "#col-done", today: '#col-done .done-group[data-group="today"]', metrics: "#done-metrics" });

// ── 6. 관계도 ─────────────────────────────────────────────────────
await page.click('.tab[data-view="graph"]'); await wait(400);
await page.click('#gr-table .gr-tr:has-text("청소용역 계약체결")'); await wait(400); await park();
await shot("graph", { panel: "#gr-panel", canvas: "#gr-panel .gr-canvas", center: "#gr-panel .g-center", hub0: "#gr-panel .g-hub", insp: "#gr-insp", node: "#gr-panel .g-task" });
await page.click('#gr-mode .seg-btn[data-v="all"]'); await wait(400); await park();
await shot("graph-all", { panel: "#gr-panel", canvas: "#gr-panel .gr-canvas", sel: "#gr-panel .g-task.g-sel" });
await page.click('#gr-mode .seg-btn[data-v="chain"]'); await wait(200);

// ── 7. 담당자 교체 ────────────────────────────────────────────────
await page.click('.tab[data-view="phone"]'); await wait(400);
await page.hover('#pb-list .pb-item[data-pbid="901"]'); await wait(200);
await shot("phone", { list: "#pb-list", row: '#pb-list .pb-item[data-pbid="901"]', swap: '#pb-list [data-pbswap="901"]', xlsx: "#pb-xlsx", tmpl: "#pb-tmpl", tools: "#view-phone .done-tools" });
await page.click('#pb-list [data-pbswap="901"]'); await wait(300);
await page.click('#pbsw-list [data-swapto="902"]'); await wait(250); await park();
await shot("swap", { modal: "#pbSwapModal .modal", pick: '#pbsw-list [data-swapto="902"]', sum: "#pbsw-sum", go: "#pbsw-go" });
await page.click("#pbsw-cancel"); await wait(200); await park();
await shot("phone-plain", { tools: "#view-phone .done-tools", xlsx: "#pb-xlsx", tmpl: "#pb-tmpl" });

// ── 8. 주기 업무 ──────────────────────────────────────────────────
await page.click('.tab[data-view="board"]'); await wait(300);
await page.click("#settingsBtn"); await wait(300); await page.click("#recurManageBtn"); await wait(500); await park();
await shot("recur", { modal: "#recurModal .modal", list: "#rc-list", form: "#recurModal .ps-new" });
await esc();
await park();
await shot("board-recur", { card: cardBy("주간 계약현황 보고 (11/9)") });

// ── 9. 화면 테마 · 데이터 ─────────────────────────────────────────
await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark")); await park();
await shot("board-dark", { board: "#view-board5" });
await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
await page.click("#settingsBtn"); await wait(400);
await page.evaluate(() => { const m = document.querySelector("#settingsModal .modal"); m.scrollTop = m.scrollHeight; }); await wait(250); await park();
await shot("settings-data", { modal: "#settingsModal .modal", data: "js:document.getElementById('bkExp').closest('.set-card')", bk: "#bkExp" });
await page.evaluate(() => { const m = document.querySelector("#settingsModal .modal"); m.scrollTop = 0; }); await wait(250); await park();
await shot("settings-top", { modal: "#settingsModal .modal", theme: "#segTheme", auto: "#segAutostart" });
await esc();

fs.writeFileSync(path.join(HERE, "shots.json"), JSON.stringify(SHOTS, null, 1));
await b.close(); server.close();
console.log("done", Object.keys(SHOTS).length, "shots");

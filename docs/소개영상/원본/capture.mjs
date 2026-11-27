// 소개영상 장면 갈무리 — 실제 앱 화면(src/)을 Edge 에 1920×1080(2배율)으로 띄워 찍고,
// 카메라·강조 테두리가 겨냥할 요소의 위치(shots.json, CSS px)를 함께 기록한다.
// 시나리오 "디지털조달관리과 김정보 주무관의 하루"(script.mjs — 전자입찰 장애 대응)의 장면 순서대로 찍는다.
// 미니 창(빠른 메모·검색)은 실제 capture.html 을 보드 위에 띄운 iframe 으로, 문서 탭은 demo-docs/ 의 실제 파일로 찍는다
// (한글 쪽 보기는 진짜 rhwp WebAssembly 가 그린다). 데이터는 sample-data.mjs 의 가상 예시.
// 실행: node capture.mjs (저장소의 node_modules/playwright-core 사용)
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { makeInit, DOC_ROOT } from "./sample-data.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const ROOT = path.join(REPO, "src"), DEMO = path.join(HERE, "demo-docs");
const INIT = makeInit(fs.readFileSync(path.join(REPO, "tools/guide-shots.mjs"), "utf8"));
const pw = await import(pathToFileURL(path.join(REPO, "node_modules", "playwright-core", "index.js")).href);
const chromium = (pw.default && pw.default.chromium) || pw.chromium;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".png": "image/png", ".svg": "image/svg+xml", ".wasm": "application/wasm",
  ".md": "text/plain; charset=utf-8", ".csv": "text/plain; charset=utf-8", ".sql": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".hwpx": "application/octet-stream", ".pdf": "application/pdf" };
const PDF_REL = "2026 나라장터 운영/한빛정보 장애 경위서.pdf", PDF_ABS = DOC_ROOT + "\\" + PDF_REL.replace(/\//g, "\\");   // v3.8.19 — 업체가 보내온 보고서(f5·d0·d2b)
const server = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split("?")[0]); if (p === "/") p = "/index.html";
  const file = p.startsWith("/__demo/") ? path.join(DEMO, p.slice(8)) : path.join(ROOT, p);
  fs.readFile(file, (e, b) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { "Content-Type": MIME[path.extname(p)] || "application/octet-stream" }); r.end(b); }); });
await new Promise((r) => server.listen(0, "127.0.0.1", r)); const port = server.address().port;   // 이 PC 안(127.0.0.1)의 빈 포트만
const b = await chromium.launch({ channel: "msedge" });
const page = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });   // 2배율 — 영상에서 확대해도 글자가 또렷하게
page.on("pageerror", (e) => console.log("ERR", e.message));
/* v3.9.0 — 화면 속 시각을 오늘 17:10 으로 묶는다(언제 찍어도 "오후 세 시 반 장애 → 저녁 무렵" 화면이 같게). 타이머는 그대로 흐른다 */
const now = new Date(); now.setHours(17, 10, 0, 0);
await page.clock.setFixedTime(now);
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
const today =`${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())}`;
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
/* (v3.9.0 — 메모 합치기 장면 f4 는 길이 때문에 뺐다) */
/* v3.8.19 f5 — 업체 보고서를 양식 위로 끌어 놓으면 링크 줄이 생긴다. 탐색기 끌기는 브라우저로 찍을 수 없어
   놓기 전(링크 칸)과 놓은 뒤(앱의 끌어 놓기 처리 addLinkPaths 가 만든 링크 줄)를 찍고, 끄는 동작은 영상의 커서로 보여 준다 */
const filesInView = () => page.evaluate(() => { document.getElementById("fm-files").scrollIntoView({ block: "center" }); });
const lastFileRow = "js:[...document.querySelectorAll('#fm-files .ffile-row')].pop()";
await openCard("전자입찰 장애 — 투찰"); await wait(500); await filesInView(); await wait(300); await park();
await shot("form-drop", { panel: "#formPanel .fm-inner", files: "#fm-files" });
await page.evaluate(async (p) => { const m = await import("./form.js"); m.addLinkPaths([p]); }, PDF_ABS); await wait(500); await filesInView(); await wait(200); await park();
await shot("form-linked", { files: "#fm-files", row: lastFileRow });
await page.click("#fm-save"); await wait(500);

// ── 4. 알림 · 업무 완료 ───────────────────────────────────────────
await page.evaluate(() => {
  const t = new Date(); const hm = String(t.getHours()).padStart(2, "0") + ":" + String(t.getMinutes()).padStart(2, "0");
  document.getElementById("alarmList").innerHTML =
    '<div class="a-item a-mid"><b>점검</b>장애 공지 게시<span class="num">' + hm + "</span></div>" +
    '<div class="a-item a-due"><b>기한</b>이용자 등록 — ㈜한빛정보 인증서 재발급 문의 회신<span class="num">' + hm + "</span></div>";
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
/* v3.8.19 d0 — 양식 링크 옆 [문서] → 문서 탭, 트리에서 그 파일 줄이 초록(.reveal) */
await openCard("전자입찰 장애 — 투찰"); await wait(500); await filesInView(); await wait(300); await park();
await shot("form-docbtn", { files: "#fm-files", row: lastFileRow, doc: lastFileRow + ".querySelector('.ffile-doc')" });
await page.evaluate((s) => (0, eval)(s).querySelector(".ffile-doc").click(), lastFileRow.slice(3));
for (let k = 0; k < 40; k++) { if (await page.$("#dt-tree .reveal")) break; await wait(150); }
await wait(1200); await park();
await shot("docs-reveal", { tree: "#dt-tree", reveal: "#dt-tree .reveal", tab: '.tab[data-view="docs"]' });
await tab("docs"); await wait(600);
await page.click("#g-search"); await page.keyboard.type("투찰", { delay: 60 }); await wait(900); await park();
await shot("docs-search", { tree: "#dt-tree", hits: "js:document.querySelector('#dt-tree .dt-hit').parentElement", search: "#g-search", hit0: "#dt-tree .dt-hit" });
await page.click("#g-search"); await page.keyboard.press("Escape"); await wait(500);
await page.click(dkey("2026 나라장터 운영/장애 조치 결과 보고.hwpx"));
for (let k = 0; k < 80; k++) { if (await page.$("#dv-body .dv-hwp-pg img")) break; await wait(150); }
await wait(1200); await park();
await shot("docs-hwp", { page: "#dv-body .dv-hwp-pg img", body: "#dv-body", file: dkey("2026 나라장터 운영/장애 조치 결과 보고.hwpx") });
/* v3.8.19 d2b — 글자 층(한글 .dv-hwp-tl · PDF .textLayer)을 마우스로 끌어 고른다. 고른 범위(Range)의 상자를 함께 적는다 */
const dragText = async (layerSel, lineFrom, lines) => {
  const pts = await page.evaluate(([s, a, n]) => {
    const spans = [...document.querySelectorAll(s + " span")].filter((x) => x.textContent.trim() && x.getBoundingClientRect().width > 2);
    const ys = [...new Set(spans.map((x) => Math.round(x.getBoundingClientRect().top)))].sort((p, q) => p - q);
    const line = (y) => spans.filter((x) => Math.abs(Math.round(x.getBoundingClientRect().top) - y) <= 2).map((x) => x.getBoundingClientRect());
    const l0 = line(ys[Math.min(a, ys.length - 1)]), l1 = line(ys[Math.min(a + n - 1, ys.length - 1)]);
    const f = l0.reduce((m, r) => (r.left < m.left ? r : m)), e = l1.reduce((m, r) => (r.right > m.right ? r : m));
    return { x0: f.left + 1, y0: f.top + f.height / 2, x1: e.right - 1, y1: e.top + e.height / 2, lines: ys.length };
  }, [layerSel, lineFrom, lines]);
  await page.mouse.move(pts.x0, pts.y0); await page.mouse.down();
  await page.mouse.move((pts.x0 + pts.x1) / 2, (pts.y0 + pts.y1) / 2, { steps: 8 }); await page.mouse.move(pts.x1, pts.y1, { steps: 8 });
  await page.mouse.up(); await wait(300);
  return pts;
};
const selBox = "js:window.getSelection().getRangeAt(0)";
console.log("hwp sel", await dragText("#dv-body .dv-hwp-tl", Number(process.env.HWP_LINE || 5), Number(process.env.HWP_N || 2)));
await page.mouse.move(1915, 1075);
await shot("docs-hwp-sel", { sel: selBox, body: "#dv-body", page: "#dv-body .dv-hwp-pg img" });
await page.evaluate(() => window.getSelection().removeAllRanges());
await page.click(dkey(PDF_REL));
for (let k = 0; k < 80; k++) { if (await page.$("#dv-body .textLayer span")) break; await wait(150); }
await wait(1000);
console.log("pdf sel", await dragText("#dv-body .textLayer", Number(process.env.PDF_LINE || 5), Number(process.env.PDF_N || 2)));
await page.mouse.move(1915, 1075);
await shot("docs-pdf-sel", { sel: selBox, body: "#dv-body", file: dkey(PDF_REL) });
await page.evaluate(() => window.getSelection().removeAllRanges());
/* (v3.9.0 — 표 파일 장면 d3 는 길이 때문에 뺐다. SQL 화면은 d4 의 메모 칸 접기에서 쓴다) */
await page.click(dkey("2026 나라장터 운영/장애 시간대 투찰 기록 조회.sql")); await wait(1200); await park();
await shot("docs-sql", { code: "#dv-code", body: "#dv-body", fold: "#dn-fold" });
{ const add = (await page.$("#dn-add2:visible")) ? "#dn-add2" : "#dn-add"; await page.click(add); await wait(700); }
await page.click("#fm-memo"); await page.keyboard.type("장애 시간대 실패 투찰 12건 — 업체별 재투찰 안내", { delay: 6 }); await wait(300); await park();
await shot("docs-dock", { form: "#formPanel", code: "#dv-code", memo: "#fm-memo" });
await esc(); { const d = await page.$("#appDialog.on #dlg-cancel"); if (d) await d.click(); }
await page.evaluate(async () => { const { S } = await import("./state.js"); if (S.settings.formDrafts) delete S.settings.formDrafts.new; });
await wait(300);
/* v3.8.19 d4 — 메모 칸 접기(›) → 문서가 넓어지고 오른쪽에 펼치기 띠(‹ 메모)만 남는다 */
await page.click("#dn-fold"); await wait(500); await park();
await shot("docs-fold", { rail: "#dn-unfold", body: "#dv-body", code: "#dv-code" });
await page.click("#dn-unfold"); await wait(300);

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
await shot("done", { strip: "#done-cal", list: "#col-done", head: "#col-done .drow-h", prev: '#done-cal [data-dcalnav="-1"]' });
/* v3.8.19 s3 — 달력 띠의 ‹ 로 지난달 → 목록도 그 달 것만("…에 끝낸 업무 N건"), 날짜를 누르면 그날만 */
await page.click('#done-cal [data-dcalnav="-1"]'); await wait(500); await park();
await shot("done-prev", { strip: "#done-cal", head: "#done-cal .dcal-head", list: "#col-done", note: "#col-done .done-month-note", prev: '#done-cal [data-dcalnav="-1"]', day: "js:[...document.querySelectorAll('#done-cal .dcal-has')].pop()" });
await page.evaluate(() => { const d = [...document.querySelectorAll("#done-cal .dcal-has")].pop(); d.click(); }); await wait(400); await park();
await shot("done-day", { strip: "#done-cal", day: "#done-cal .dcal-d.on", list: "#col-done" });
await page.evaluate(() => document.querySelector("#done-cal .dcal-clear")?.click()); await wait(200);
await page.click('#done-cal [data-dcalnav="1"]'); await wait(300);

// ── 7. 사람으로 찾기 · 담당자 교체 ─────────────────────────────────
await tab("phone"); await wait(300);
await page.click('#pb-list .pb-item[data-pbid="901"]'); await wait(500); await park();
await shot("phone-side", { list: "#pb-list", row: '#pb-list .pb-item[data-pbid="901"]', side: "#pb-side" });
/* v3.8.18~19 — [수정]·[바꾸기]·[삭제]는 줄이 아니라 오른쪽 칸 위에 있고, 칸에 마우스를 올렸을 때 보인다 */
await page.click('#pb-list .pb-item[data-pbid="902"]'); await wait(500);
await page.hover("#pb-side .pbs-head"); await wait(400);
await shot("phone-swap", { row: '#pb-list .pb-item[data-pbid="902"]', side: "#pb-side", swap: '#pb-side [data-pbswap="902"]' });
await page.click('#pb-side [data-pbswap="902"]'); await wait(300);
await page.click('#pbsw-list [data-swapto="907"]'); await wait(250); await park();
await shot("swap", { modal: "#pbSwapModal .modal", pick: '#pbsw-list [data-swapto="907"]', sum: "#pbsw-sum", go: "#pbsw-go" });
await page.click("#pbsw-cancel"); await wait(200);

// ── 8. (v3.9.0 새 장) 자리를 비우기 전, 일을 넘깁니다 ───────────────────
await tab("board");
const OUT = path.join(HERE, "handover"); fs.mkdirSync(OUT, { recursive: true });
const takeSaved = async () => { for (let k = 0; k < 60; k++) { const s = await page.evaluate(() => { const v = window.__saved; window.__saved = null; return v && { name: v.name, data: Array.from(v.data) }; }); if (s) return s; await wait(150); } throw new Error("저장된 바이트가 없다"); };
/* h1 — 장애 업무의 메모에 [진행 경과]·[남은 일] 줄을 친다 → 그 줄 위에 가로선(.msec) */
const MEMO0 = "전자입찰 장애 — 투찰 화면 멈춤 (공고 R26BK01234567)\n입찰서 제출 30분 전 여러 업체 투찰 화면 멈춤.";
const MEMO1 = MEMO0 + "\n[진행 경과]\n15:50 서버 로그 확인 — 인증 모듈 응답 지연\n16:30 장애 공지 게시";
const MEMO2 = MEMO1 + "\n[남은 일]\n제출 기한 연기 공고 (박서연 주무관과 협의)\n실패 투찰 12건 업체별 재투찰 안내";
await openCard("전자입찰 장애 — 투찰"); await wait(500);
const setMemo = async (t) => { await page.fill("#fm-memo", t); await page.locator("#fm-memo").evaluate((e) => { e.selectionStart = e.selectionEnd = e.value.length; e.dispatchEvent(new Event("input", { bubbles: true })); }); await wait(350); };
await page.evaluate(() => { document.getElementById("formPanel").scrollTop = 0; });
await setMemo(MEMO0); await park();
await shot("memo-0", { panel: "#formPanel .fm-inner", memo: "#fm-memo" });
await setMemo(MEMO1); await park();
await shot("memo-1", { panel: "#formPanel .fm-inner", memo: "#fm-memo", sec0: "#formPanel .msec" });
await setMemo(MEMO2); await park();
await shot("memo-2", { panel: "#formPanel .fm-inner", memo: "#fm-memo", sec0: "js:document.querySelectorAll('#formPanel .msec')[0]", sec1: "js:document.querySelectorAll('#formPanel .msec')[1]" });
/* h2 — 양식 왼쪽 아래 공유 아이콘 → 미리 보기 창 */
await page.evaluate(() => { const p = document.getElementById("formPanel"); p.scrollTop = p.scrollHeight; }); await wait(300); await park();
await shot("form-share", { share: "#fm-share", actions: ".fm-actions", panel: "#formPanel .fm-inner" });
await page.click("#fm-share"); await wait(1500); await park();
await shot("share-preview", { modal: "#shareModal .share-modal", stage: "#share-stage", card: "#share-stage .shw", img: "#share-img" });
/* 나가는 그림 그대로 — [파일로 저장]이 넘기는 PNG(앱의 공유 그림 만들기)를 꺼내 대화창 장면에 쓴다 */
await page.click("#share-save"); { const s = await takeSaved(); fs.writeFileSync(path.join(OUT, "share-card.png"), Buffer.from(s.data)); console.log("share png", s.name, s.data.length); }
await wait(400);
await page.click("#share-img").catch(() => {}); await wait(700); await park();   // [그림 복사] — 갈무리 창에서는 클립보드가 막혀 안내가 뜰 수 있다
await shot("share-copied", { img: "#share-img", toast: "#toast", modal: "#shareModal .share-modal" });
await page.evaluate(() => { const d = document.querySelector("#appDialog.on #dlg-ok"); if (d) d.click(); });
await page.evaluate(async () => { (await import("./share.js")).closeShare(); }); await wait(300);
await esc(); { const d = await page.$("#appDialog.on #dlg-cancel"); if (d) await d.click(); }
await page.evaluate(async () => { const { S } = await import("./state.js"); if (S.settings.formDrafts) for (const k of Object.keys(S.settings.formDrafts)) delete S.settings.formDrafts[k]; });
await wait(300);
/* h4 — 설정 → 데이터 → [엑셀로 내보내기]. 앱이 만든 xlsx 바이트를 그대로 파일로(h5·h6 의 한셀 뷰어 갈무리에 쓴다) */
await page.click("#settingsBtn"); await wait(400);
await page.evaluate(() => { const m = document.querySelector("#settingsModal .modal"); m.scrollTop = m.scrollHeight; }); await wait(250); await park();
await shot("settings-data", { modal: "#settingsModal .modal", data: "js:document.getElementById('bkExp').closest('.set-card')", bk: "#bkExp", xlsx: "#xlsx" });
await page.click("#xlsx"); { const s = await takeSaved(); fs.writeFileSync(path.join(OUT, "업무목록.xlsx"), Buffer.from(s.data)); console.log("xlsx", s.name, s.data.length); }
await wait(500); await park();
await shot("xlsx-saved", { modal: "#settingsModal .modal", xlsx: "#xlsx", toast: "#toast" });
await esc();
/* h3 — 대화창(직접 그린 일반 대화창 — 어떤 메신저의 이름·로고·색도 흉내 내지 않는다). 왼쪽 보내는 사람, 오른쪽 받는 사람.
   메모지 그림은 위에서 앱이 만든 share-card.png 그대로 */
{
  const png = "data:image/png;base64," + fs.readFileSync(path.join(OUT, "share-card.png")).toString("base64");
  const chat = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
  const font = "data:font/woff2;base64," + fs.readFileSync(path.join(ROOT, "fonts", "PretendardVariable.woff2")).toString("base64");
  const html = (sent) => `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:P;src:url('${font}') format('woff2');font-weight:45 920}
*{box-sizing:border-box;margin:0;padding:0}
body{width:1920px;height:1080px;overflow:hidden;background:#E4E7EB;font-family:P,sans-serif;color:#1d2330;letter-spacing:-.01em}
.side{position:absolute;top:40px;bottom:40px;width:880px}.l{left:60px}.r{left:980px}
.who{display:inline-flex;align-items:center;gap:10px;font-size:24px;font-weight:700;color:#3a4150;margin:0 0 14px 6px}
.who i{font-style:normal;font-size:20px;font-weight:600;color:#fff;background:#56606f;border-radius:999px;padding:4px 14px}
.win{position:absolute;top:58px;bottom:0;left:0;right:0;background:#fff;border-radius:18px;box-shadow:0 18px 50px rgba(20,30,45,.18);display:flex;flex-direction:column;overflow:hidden}
.head{height:76px;border-bottom:1px solid #e3e6ea;display:flex;align-items:center;gap:14px;padding:0 24px;font-size:22px;font-weight:650}
.av{width:44px;height:44px;border-radius:50%;background:#cfd6df;color:#46505e;display:grid;place-items:center;font-size:19px;font-weight:700}
.head small{font-size:16px;color:#7b8492;font-weight:500;margin-left:4px}
.log{flex:1;padding:24px 26px;display:flex;flex-direction:column;gap:14px;overflow:hidden;background:#f7f8fa}
.row{display:flex;gap:10px;align-items:flex-end}.row.me{justify-content:flex-end}
.b{max-width:560px;font-size:21px;line-height:1.45;padding:12px 18px;border-radius:16px;background:#fff;border:1px solid #e1e4e8}
.me .b{background:#e6ebf2;border-color:#d6dde7}
.t{font-size:14px;color:#8a929e;white-space:nowrap}
.pic{border-radius:14px;border:1px solid #d6dde7;background:#fff;padding:6px;display:block}
.pic img{display:block;border-radius:9px}
.compose{border-top:1px solid #e3e6ea;padding:14px 18px;display:flex;align-items:flex-end;gap:12px;min-height:84px}
.field{flex:1;min-height:56px;border:1px solid #d5dae1;border-radius:12px;padding:10px 14px;font-size:20px;color:#9aa1ab;display:flex;align-items:center;gap:12px}
.att{border:1px solid #c9d1dc;border-radius:10px;padding:4px;background:#fff}.att img{display:block;height:150px;border-radius:7px}
.send{height:56px;padding:0 26px;border-radius:12px;background:#4b5565;color:#fff;font-size:20px;font-weight:650;display:grid;place-items:center}
</style></head><body>
<div class="side l"><div class="who"><i>보내는 사람</i>김정보 주무관</div><div class="win">
 <div class="head"><div class="av">이</div>이시스<small>디지털조달관리과</small></div>
 <div class="log">
  <div class="row"><div class="b">다음 주 교육 기간에는 제가 장애 건 이어서 볼게요.</div><span class="t">17:02</span></div>
  <div class="row me"><span class="t">17:08</span><div class="b">고마워요. 지금까지 진행된 것 정리해서 보낼게요.</div></div>
  ${sent ? `<div class="row me"><span class="t">17:10</span><div class="pic" id="sentPic"><img src="${png}" style="height:470px"></div></div>` : ""}
 </div>
 <div class="compose">${sent ? `<div class="field">메시지 입력</div>` : `<div class="field" id="field"><div class="att" id="att"><img src="${png}"></div>그림 1장</div>`}<div class="send" id="send">보내기</div></div>
</div></div>
<div class="side r"><div class="who"><i>받는 사람</i>이시스 주무관</div><div class="win">
 <div class="head"><div class="av">김</div>김정보<small>디지털조달관리과</small></div>
 <div class="log">
  <div class="row me"><span class="t">17:02</span><div class="b">다음 주 교육 기간에는 제가 장애 건 이어서 볼게요.</div></div>
  <div class="row"><div class="b">고마워요. 지금까지 진행된 것 정리해서 보낼게요.</div><span class="t">17:08</span></div>
  ${sent ? `<div class="row"><div class="pic" id="recvPic"><img src="${png}" id="recvImg" style="height:640px"></div><span class="t">17:10</span></div>` : ""}
 </div>
 <div class="compose"><div class="field">메시지 입력</div><div class="send">보내기</div></div>
</div></div>
</body></html>`;
  const cbox = async (sel) => chat.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; }, sel);
  for (const [name, sent, sels] of [["chat-paste", false, { att: "#att", field: "#field", send: "#send" }], ["chat-sent", true, { sent: "#sentPic", recv: "#recvPic", img: "#recvImg" }]]) {
    await chat.setContent(html(sent), { waitUntil: "load" }); await chat.evaluate(() => document.fonts.ready); await chat.waitForTimeout(300);
    await chat.screenshot({ path: path.join(HERE, "shots", name + ".jpg"), type: "jpeg", quality: 95 });
    SHOTS[name] = {}; for (const [k, s] of Object.entries(sels)) { const r = await cbox(s); if (!r) throw new Error("no element " + s); SHOTS[name][k] = r; }
    console.log("shot", name);
  }
  await chat.close();
}

fs.writeFileSync(path.join(HERE, "shots.json"), JSON.stringify(SHOTS, null, 1));
await b.close(); server.close();
console.log("done", Object.keys(SHOTS).length, "shots");

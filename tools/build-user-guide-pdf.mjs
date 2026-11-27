// Markdown 사용 설명서(tools/user-guide-source.mjs)를 제품의 시각 정책에 맞는 인쇄용 PDF로 만든다.
// 실행: node tools/build-user-guide-pdf.mjs   (Windows 는 Edge, 그 밖은 PLAYWRIGHT_CHROMIUM 경로 — guide-shots.mjs 와 같은 규칙)
// 색·곡률·선은 앱의 지금 토큰(src/styles.css :root — v3.7.0 블록)과 `디자인 정책.md` §3·§4·§8 을 따른다:
// 카드·표·알림 상자 = 흰 면 1px --line · 곡률 12px, 강조 = 왼쪽 짧은 색 띠(카드의 4×20px 세그먼트),
// 태그·칩 = 알약(999px), 키 = 아이콘 미니 단추 곡률 8px.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import sourceText from "./user-guide-source.mjs";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "뭐하려 했더라 사용설명서.pdf");
const font = resolve(root, "src", "fonts", "PretendardVariable.woff2");
const appIcon = resolve(root, "src-tauri", "icons", "icon.png");
const pw = await import(pathToFileURL(join(root, "node_modules", "playwright-core", "index.js")).href);
const chromium = (pw.default && pw.default.chromium) || pw.chromium;

const escape = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

/* 인라인 코드: 키는 키 모양, 카드의 시각·꼬리표 글자는 청록 태그, 나머지는 회색 칩 */
const KEY = /^(Ctrl|Alt|Shift|Esc|Enter|Delete|F\d+|↑|↓)(\+.*)?$/;
const TAG = new Set(["점검:", "기한:", "반복", "완료:"]);
const codeSpan = (t) => KEY.test(t) ? `<kbd>${t}</kbd>` : TAG.has(t) ? `<span class="tag">${t}</span>` : `<code>${t}</code>`;

/* 링크는 진짜 링크 꼴(#… · http…)만 글자로 바꾼다 — "[켬](기본)" 같은 단추 이름 + 괄호 설명을 지우지 않게 */
const inline = (value) => escape(value)
  .replace(/\[([^\]]+)\]\((?:#|https?:)[^)]*\)/g, "$1")
  .replace(/`([^`]+)`/g, (_, t) => codeSpan(t))
  .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

const imageUrl = (relativePath) => pathToFileURL(resolve(root, relativePath)).href;

function makeTable(rows) {
  const cells = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => inline(cell.trim()));
  const header = cells(rows[0]);
  const body = rows.slice(2).map(cells);
  return `<table><thead><tr>${header.map((cell) => `<th>${cell}</th>`).join("")}</tr></thead><tbody>${body
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function markdownToHtml(markdown) {
  const lines = markdown.replace(/\r/g, "").split("\n");
  const toc = [];
  const chunks = [];
  let sectionOpen = false;
  let contentStarted = false;
  let skipSourceToc = false;
  let i = 0;

  const special = (line) => !line || /^(#{1,3}\s|>\s|[-*]\s|\d+\.\s|\||!\[)/.test(line) || /^---+$/.test(line);
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }
    if (/^#\s/.test(line)) { i += 1; continue; }
    const heading = line.match(/^(#{2,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const label = heading[2];
      if (level === 2) {
        if (label === "목차") { skipSourceToc = true; i += 1; continue; }
        skipSourceToc = false;
        contentStarted = true;
        if (sectionOpen) chunks.push("</section>");
        const id = `section-${toc.length + 1}`;
        toc.push({ id, label });
        chunks.push(`<section class="major" id="${id}"><h2>${inline(label)}</h2>`);
        sectionOpen = true;
      } else {
        chunks.push(`<h3>${inline(label)}</h3>`);
      }
      i += 1;
      continue;
    }
    // 표지와 별도 목차가 소개·목차를 맡으므로 원본의 첫머리와 목차는 넣지 않는다.
    if (!contentStarted || skipSourceToc) { i += 1; continue; }
    const image = line.match(/^!\[(.*)\]\(([^)\s]+\.png)\)$/);   // 그림 설명 안에 [제목] 같은 대괄호가 있어도 된다
    if (image) {
      chunks.push(`<figure><img src="${imageUrl(image[2])}" alt="${escape(image[1])}"><figcaption>${inline(image[1])}</figcaption></figure>`);
      i += 1;
      continue;
    }
    if (/^---+$/.test(line)) { i += 1; continue; }   // 장 사이 구분선 — 장 제목의 밑줄이 맡는다
    if (line.startsWith("|")) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith("|")) { rows.push(lines[i]); i += 1; }
      chunks.push(makeTable(rows));
      continue;
    }
    if (line.startsWith(">")) {
      const quote = [];
      while (i < lines.length && lines[i].startsWith(">")) { quote.push(lines[i].replace(/^>\s?/, "")); i += 1; }
      chunks.push(`<aside>${inline(quote.join(" "))}</aside>`);
      continue;
    }
    if (/^[-*]\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^(\s*)[-*]\s/.test(lines[i])) {
        const sub = /^\s+/.test(lines[i]);
        const text = inline(lines[i].replace(/^\s*[-*]\s/, ""));
        if (sub && items.length) items[items.length - 1].subs.push(text); else items.push({ text, subs: [] });
        i += 1;
      }
      chunks.push(`<ul>${items.map((it) => `<li>${it.text}${it.subs.length ? `<ul>${it.subs.map((s) => `<li>${s}</li>`).join("")}</ul>` : ""}</li>`).join("")}</ul>`);
      continue;
    }
    if (/^\d+\.\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^(\d+\.\s|\s+[-*]\s)/.test(lines[i])) {
        if (/^\s+[-*]\s/.test(lines[i])) { if (items.length) items[items.length - 1].subs.push(inline(lines[i].replace(/^\s*[-*]\s/, ""))); }
        else items.push({ text: inline(lines[i].replace(/^\d+\.\s/, "")), subs: [] });
        i += 1;
      }
      chunks.push(`<ol>${items.map((it) => `<li>${it.text}${it.subs.length ? `<ul>${it.subs.map((s) => `<li>${s}</li>`).join("")}</ul>` : ""}</li>`).join("")}</ol>`);
      continue;
    }
    const paragraph = [];
    while (i < lines.length && !special(lines[i])) { paragraph.push(lines[i].trim()); i += 1; }
    /* 줄 전체가 굵은 글(자주 묻는 질문의 **Q. …**)이면 그 뒤에서 줄을 바꾼다 — 질문과 답이 한 줄로 붙지 않게 */
    if (paragraph.length) chunks.push(`<p${/^\*\*Q\./.test(paragraph[0]) ? ' class="qa"' : ""}>${paragraph
      .map((l, k) => inline(l) + (k < paragraph.length - 1 ? (/^\*\*.*\*\*$/.test(l) ? "<br>" : " ") : "")).join("")}</p>`);
    else i += 1;
  }
  if (sectionOpen) chunks.push("</section>");
  return { content: chunks.join("\n"), toc };
}

/* 표지 아래 줄의 버전·날짜 — 원본 첫머리의 "> vX.Y.Z 기준 · 날짜" 한 줄을 그대로 쓴다(두 곳에 따로 적지 않는다) */
const edition = (sourceText.match(/^>\s*(v\d+\.\d+\.\d+ 기준 · \d{4}-\d{2}-\d{2})\s*$/m) || [])[1];
if (!edition) throw new Error("user-guide-source.mjs 첫머리에 '> vX.Y.Z 기준 · YYYY-MM-DD' 줄이 없습니다");

const { content, toc } = markdownToHtml(sourceText);
/* 그림 줄을 읽지 못하면 말없이 빠진다(설명에 대괄호가 든 그림이 그랬다) — 원본의 그림 줄 수와 실린 그림 수를 견준다 */
const wantShots = (sourceText.match(/^!\[/gm) || []).length, gotShots = (content.match(/<figure>/g) || []).length;
if (wantShots !== gotShots) throw new Error(`그림 ${wantShots}장 가운데 ${gotShots}장만 실렸습니다`);
const tocHtml = toc.map((item) => `<li><a href="#${item.id}">${inline(item.label)}</a></li>`).join("");
/* 인쇄용 HTML 은 임시 폴더에 둔다(저장소에 남기지 않는다) — 글꼴·그림은 절대 file:// 주소라 자리와 상관없다 */
const printHtml = join(tmpdir(), "wmhh-user-guide-print.html");
const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>뭐하려 했더라 사용 설명서</title>
<style>
@font-face{font-family:Pretendard;src:url("${pathToFileURL(font).href}") format("woff2");font-weight:100 900}
@page{size:A4;margin:17mm 16mm 20mm 16mm}
:root{--paper:#f2f4f7;--card:#fff;--sunk:#f7f8fa;--ink:#131a24;--ink-2:#3a4453;--ink-soft:#687284;--line:#e0e5eb;--chip-bg:#eceff3;--brand:#2a7c6e;--brand-weak:#edf4f2;--red:#c0271c}
*{box-sizing:border-box} body{margin:0;color:var(--ink);font-family:Pretendard,'Malgun Gothic',sans-serif;font-size:10.5pt;line-height:1.7;letter-spacing:-.014em}
.cover{height:250mm;background:var(--paper);border-radius:12px;padding:34mm 24mm 22mm;display:flex;flex-direction:column;justify-content:space-between;page-break-after:always}
.eyebrow{color:var(--brand);font-size:10pt;font-weight:700;letter-spacing:.06em}.cover h1{display:flex;align-items:center;gap:5mm;font-size:34pt;line-height:1.18;letter-spacing:-.055em;margin:0 0 7mm}.title-app-icon{width:20mm;height:20mm;flex:none;border-radius:5.5mm;box-shadow:0 1.5mm 4mm rgba(19,26,36,.14)}.cover .lead{font-size:16pt;line-height:1.55;margin:0;max-width:120mm}
.feature-cards{display:grid;gap:3mm}.feature-card{position:relative;min-height:27mm;display:grid;grid-template-columns:54mm 1fr;align-items:center;gap:5mm;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:4.2mm 6mm 4.2mm 8mm}
.feature-card::before,aside::before{content:"";position:absolute;left:0;top:50%;width:4px;height:20px;margin-top:-10px;border-radius:0 4px 4px 0;background:var(--brand)}
.feature-card strong{color:var(--brand);font-size:11pt;line-height:1.35}.feature-card span{font-size:9.5pt;line-height:1.55}
.cover-footer{display:flex;align-items:flex-end;justify-content:space-between}.meta{color:var(--ink-soft);font-size:9pt;margin:0}.meta b{color:var(--ink-2);font-weight:600}
.toc{page-break-after:always;padding-top:8mm}.toc h2{margin-top:0}.toc ol{columns:2;column-gap:15mm;padding-left:0;list-style:none}.toc li{break-inside:avoid;margin:0 0 3mm;padding-right:4mm}.toc a{color:var(--ink);text-decoration:none}
.major{margin-top:0}.major + .major{margin-top:12mm}
h2{font-size:18pt;line-height:1.3;letter-spacing:-.043em;color:var(--ink);margin:0 0 6mm;padding-bottom:3.5mm;border-bottom:2px solid var(--brand);break-after:avoid}
h3{font-size:13pt;line-height:1.4;margin:9mm 0 3mm;color:var(--ink);break-after:avoid}
p{margin:0 0 4.5mm;orphans:2;widows:2}h2 + p,h3 + p{break-inside:avoid}
p.qa{break-inside:avoid;margin-bottom:4mm}p:has(+table){break-after:avoid}
h2:has(+figure),h3:has(+p +figure),h3:has(+p +table +figure),h3 + p:has(+figure),h3 + p:has(+table +figure),h3 + p + table:has(+figure),p:has(+figure),table:has(+figure){break-after:avoid}
strong{font-weight:700;color:var(--ink)}
code{font-family:inherit;font-size:.9em;background:var(--chip-bg);color:var(--ink-2);border-radius:999px;padding:.5px 6px;white-space:nowrap}
.tag{font-size:.86em;font-weight:600;background:var(--brand-weak);color:var(--brand);border-radius:999px;padding:.5px 7px;white-space:nowrap}
kbd{font-family:inherit;font-size:.86em;font-weight:600;color:var(--ink-2);background:var(--card);border:1px solid var(--line);border-bottom-width:2px;border-radius:8px;padding:0 5px;white-space:nowrap}
ul,ol{margin:0 0 4.5mm;padding-left:6.5mm}li{margin:1.5mm 0;padding-left:1mm}li ul{margin:1mm 0 0}
aside{position:relative;margin:5mm 0;padding:4mm 5mm 4mm 7mm;background:var(--brand-weak);border:1px solid #d6e8e3;border-radius:12px;color:var(--ink-2);break-inside:avoid}
figure{margin:6mm auto 7mm;break-inside:avoid;text-align:center}
figure img{display:block;max-width:100%;max-height:128mm;margin:0 auto;border:1px solid var(--line);border-radius:12px;}
figcaption{margin-top:2.5mm;color:var(--ink-soft);font-size:8.7pt}
table{width:100%;border-collapse:separate;border-spacing:0;margin:5mm 0 6mm;font-size:9.2pt;line-height:1.52;break-inside:avoid;border:1px solid var(--line);border-radius:12px;overflow:hidden}
th,td{padding:2.8mm 3.4mm;text-align:left;vertical-align:top;border-right:1px solid var(--line);border-bottom:1px solid var(--line)}th:last-child,td:last-child{border-right:0}tbody tr:last-child td{border-bottom:0}
th{background:var(--sunk);color:var(--ink-2);font-weight:700}td:first-child{font-weight:600}
</style></head><body>
<section class="cover"><div><p class="eyebrow">PERSONAL WORK BOARD · USER GUIDE</p><h1><img class="title-app-icon" src="${pathToFileURL(appIcon).href}" alt="">뭐하려 했더라</h1><p class="lead">떠오른 일을 일단 던져 두면, 시각을 따라 오늘 할 일을 알아서 올려 주는 개인 업무 보드</p></div><div class="feature-cards"><div class="feature-card"><strong>놓치는 일을 줄이려고</strong><span>떠오른 일을 완벽히 정리할 때까지 기다리지 않고, 바로 남길 수 있게 만들었습니다.</span></div><div class="feature-card"><strong>오늘 할 일을 다시 묻지 않으려고</strong><span>기한과 점검 시각을 보고, 지금 처리할 일을 앞에 보여 줍니다.</span></div><div class="feature-card"><strong>요청의 맥락을 잃지 않으려고</strong><span><code>@태그</code>·사람·하위 업무·파일을 남겨, 나중에도 업무 흐름을 이어 줍니다.</span></div></div><div class="cover-footer"><p class="meta"><b>사용 설명서 · ${escape(edition)}</b> · 오프라인 사용 가능 · 설치·계정 불필요</p></div></section>
<section class="toc"><h2>목차</h2><ol>${tocHtml}</ol></section>
${content}
</body></html>`;

await mkdir(dirname(output), { recursive: true });
await writeFile(printHtml, html, "utf8");
const channel = process.env.PW_CHANNEL || (process.platform === "win32" ? "msedge" : "");
const browser = await chromium.launch(channel
  ? { channel, args: ["--allow-file-access-from-files"] }
  : { executablePath: process.env.PLAYWRIGHT_CHROMIUM, args: ["--allow-file-access-from-files"] });
const page = await browser.newPage();
await page.goto(pathToFileURL(printHtml).href, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
/* 갈무리는 모두 같은 축척으로 — 2배로 찍은 그림(guide-shots.mjs deviceScaleFactor 2)을 화면 CSS 픽셀의 0.62 배로 싣는다.
   작은 창(미니 창·공유 창)이 쪽 폭 가득 부풀지 않고, 넓은 화면은 쪽 폭(100%)과 높이 한도(128mm) 안으로 줄인다. */
await page.evaluate(async () => {
  const maxH = 128 * 96 / 25.4;
  for (const img of document.querySelectorAll("figure img")) {
    await img.decode().catch(() => {});
    const box = img.parentElement.clientWidth, ratio = img.naturalHeight / img.naturalWidth;
    let w = Math.min(img.naturalWidth / 2 * 0.62, box);
    if (w * ratio > maxH) w = maxH / ratio;
    img.style.width = `${Math.round(w)}px`;
  }
});
await page.pdf({
  path: output,
  format: "A4",
  printBackground: true,
  preferCSSPageSize: true,
  displayHeaderFooter: true,
  headerTemplate: "<span></span>",
  footerTemplate: "<div style=\"width:100%;padding:0 16mm;color:#687284;font:8px sans-serif;text-align:right\">뭐하려 했더라 · 사용 설명서&nbsp;&nbsp;<span class=\"pageNumber\"></span></div>",
  tagged: true,
});
await browser.close();
console.log(output);

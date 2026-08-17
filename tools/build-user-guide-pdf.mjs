// Markdown 사용 설명서를 제품의 시각 정책에 맞는 인쇄용 PDF로 만든다.
// 실행: node tools/build-user-guide-pdf.mjs
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import sourceTextRaw from "./user-guide-source.mjs";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "뭐하려 했더라 사용설명서.pdf");
const font = resolve(root, "src", "fonts", "PretendardVariable.woff2");
const appIcon = resolve(root, "src-tauri", "icons", "icon.png");
const require = createRequire("C:/Users/rhama/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json");
const { chromium } = require("playwright");

const escape = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

const inline = (value) => escape(value)
  .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
  .replace(/`([^`]+)`/g, "<code>$1</code>")
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

  const special = (line) => !line || /^(#{1,3}\s|>\s|[-*]\s|\d+\.\s|\|)/.test(line) || /^---+$/.test(line);
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }
    if (/^#\s/.test(line)) { i += 1; continue; }
    const image = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (image) {
      chunks.push(`<figure><img src="${imageUrl(image[2])}" alt="${escape(image[1])}"><figcaption>${inline(image[1])}</figcaption></figure>`);
      i += 1;
      continue;
    }
    const heading = line.match(/^(#{2,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const label = heading[2];
      if (level === 2) {
        if (label === "목차") {
          skipSourceToc = true;
          i += 1;
          continue;
        }
        if (skipSourceToc) skipSourceToc = false;
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
    // 표지와 별도 목차에서 이미 소개·목차를 제공하므로 원본의 중복 구간은 넣지 않는다.
    if (!contentStarted || skipSourceToc) { i += 1; continue; }
    if (/^---+$/.test(line)) { chunks.push("<div class=\"rule\"></div>"); i += 1; continue; }
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
      while (i < lines.length && /^[-*]\s/.test(lines[i])) { items.push(lines[i].replace(/^[-*]\s/, "")); i += 1; }
      chunks.push(`<ul>${items.map((item) => `<li>${inline(item)}</li>`).join("")}</ul>`);
      continue;
    }
    if (/^\d+\.\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) { items.push(lines[i].replace(/^\d+\.\s/, "")); i += 1; }
      chunks.push(`<ol>${items.map((item) => `<li>${inline(item)}</li>`).join("")}</ol>`);
      continue;
    }
    const paragraph = [];
    while (i < lines.length && !special(lines[i])) { paragraph.push(lines[i].trim()); i += 1; }
    if (paragraph.length) chunks.push(`<p>${inline(paragraph.join(" "))}</p>`);
    else i += 1;
  }
  if (sectionOpen) chunks.push("</section>");
  return { content: chunks.join("\n"), toc };
}

const sourceText = sourceTextRaw
  .replace(/\n  !\[파일·폴더 링크 — 켜면 클릭으로 열기, 끄면 경로 수정\]\(docs\/screenshots\/filelink\.png\)/, "\n![파일·폴더 링크 — 켜면 클릭으로 열기, 끄면 경로 수정](docs/screenshots/filelink.png)")
  .replace(/\n> \*\*무엇이 '엮인 업무'인가요\?\*\*[\s\S]*?\n> 이름만 같은 사람, 메모에 이름이 적혀만 있는 업무는 엮이지 않습니다 — 동명이인이 섞이지 않게 한 것입니다\.\n?/, "\n");
const { content, toc } = markdownToHtml(sourceText);
const tocHtml = toc.map((item) => `<li><a href="#${item.id}">${inline(item.label)}</a></li>`).join("");
const printHtml = resolve(root, "docs", "_user-guide-print.html");
const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>뭐하려 했더라 사용 설명서</title>
<style>
@font-face{font-family:Pretendard;src:url("${pathToFileURL(font).href}") format("woff2");font-weight:100 900}
@page{size:A4;margin:17mm 16mm 20mm 16mm}
:root{--paper:#f4f3f0;--panel:#fff;--ink:#1f2a33;--ink-soft:#5a6472;--line:#e4e7ea;--brand:#2a7c6e;--brand-weak:#edf4f2;--danger:#c0271c}
*{box-sizing:border-box} body{margin:0;color:var(--ink);font-family:Pretendard,'Malgun Gothic',sans-serif;font-size:10.6pt;line-height:1.7;letter-spacing:-.014em}
.cover{height:250mm;background:var(--paper);border-radius:12px;padding:34mm 24mm 24mm;display:flex;flex-direction:column;justify-content:space-between;page-break-after:always}
.eyebrow{color:var(--brand);font-size:10pt;font-weight:750;letter-spacing:.06em}.cover h1{display:flex;align-items:center;gap:5mm;font-size:34pt;line-height:1.18;letter-spacing:-.055em;margin:0 0 7mm}.title-app-icon{width:20mm;height:20mm;flex:none;border-radius:5.5mm;box-shadow:0 1.5mm 4mm rgba(31,42,51,.14)}.cover .lead{font-size:16pt;line-height:1.55;margin:0;max-width:120mm}.feature-cards{display:grid;gap:3mm}.feature-card{min-height:27mm;display:grid;grid-template-columns:54mm 1fr;align-items:center;gap:5mm;background:var(--panel);border:1px solid var(--line);border-left:5px solid var(--brand);border-radius:12px;padding:4.2mm 6mm}.feature-card strong{color:var(--brand);font-size:11.2pt;line-height:1.35}.feature-card span{font-size:9.7pt;line-height:1.55}.cover-footer{display:flex;align-items:flex-end}.meta{color:var(--ink-soft);font-size:9pt;margin:0}
.toc{page-break-after:always;padding-top:8mm}.toc h2{margin-top:0}.toc ol{columns:2;column-gap:15mm;padding-left:0;list-style:none}.toc li{break-inside:avoid;margin:0 0 3mm;padding-right:4mm}.toc a{color:var(--ink);text-decoration:none}
.major{margin-top:0}h2{font-size:18pt;line-height:1.3;letter-spacing:-.043em;color:var(--ink);margin:0 0 7mm;padding-bottom:4mm;border-bottom:2px solid var(--brand);break-after:avoid}h3{font-size:13.2pt;line-height:1.4;margin:10mm 0 3.5mm;color:var(--ink);break-after:avoid}
p{margin:0 0 5mm}h2 + p{break-after:avoid}h2:has(+figure),h3:has(+p +figure),h3:has(+p +table +figure),h3 + p:has(+figure),h3 + p:has(+table +figure),h3 + p + table:has(+figure),p:has(+figure),table:has(+figure){break-after:avoid}strong{font-weight:760;color:var(--ink)}code{font-family:Pretendard,'Malgun Gothic',sans-serif;font-size:.92em;background:var(--brand-weak);color:var(--brand);border-radius:4px;padding:1px 3px;white-space:normal}ul,ol{margin:0 0 5mm;padding-left:6.5mm}li{margin:1.7mm 0;padding-left:1mm}aside{margin:6mm 0;padding:5mm 5.5mm;background:var(--brand-weak);border-left:4px solid var(--brand);border-radius:0 12px 12px 0;color:#2b564e}figure{margin:7mm auto 8mm;break-inside:avoid;text-align:center}figure img{display:block;max-width:100%;max-height:134mm;margin:0 auto;border:1px solid var(--line);border-radius:12px;box-shadow:0 2mm 6mm rgba(31,42,51,.10)}figcaption{margin-top:2.5mm;color:var(--ink-soft);font-size:8.7pt}
table{width:100%;border-collapse:separate;border-spacing:0;margin:5.5mm 0 7mm;font-size:9.2pt;line-height:1.52;break-inside:avoid;border:1px solid var(--line);border-radius:12px;overflow:hidden}th,td{padding:3.3mm 3.4mm;text-align:left;vertical-align:top;border-right:1px solid var(--line);border-bottom:1px solid var(--line)}th:last-child,td:last-child{border-right:0}tbody tr:last-child td{border-bottom:0}th{background:var(--brand-weak);color:var(--brand);font-weight:760}td:first-child{font-weight:670} .rule{height:1px;background:var(--line);margin:8mm 0}
</style></head><body>
<section class="cover"><div><p class="eyebrow">PERSONAL WORK BOARD · USER GUIDE</p><h1><img class="title-app-icon" src="${pathToFileURL(appIcon).href}" alt="">뭐하려 했더라</h1><p class="lead">떠오른 일을 일단 던져 두면, 시각을 따라 오늘 할 일을 알아서 올려 주는 개인 업무 보드</p></div><div class="feature-cards"><div class="feature-card"><strong>놓치는 일을 줄이려고</strong><span>떠오른 일을 완벽히 정리할 때까지 기다리지 않고, 바로 남길 수 있도록 만들었습니다.</span></div><div class="feature-card"><strong>오늘 할 일을 다시 묻지 않으려고</strong><span>마감과 점검 시각을 기준으로, 지금 처리할 일을 자연스럽게 앞에 보여 줍니다.</span></div><div class="feature-card"><strong>요청의 맥락을 잃지 않으려고</strong><span><code>@태그</code>·사람·세부 할 일·파일을 남겨, 나중에도 업무 흐름을 이어 줍니다.</span></div></div><div class="cover-footer"><p class="meta">사용 설명서 · 오프라인 사용 가능 · 설치·계정 불필요</p></div></section>
<section class="toc"><h2>목차</h2><ol>${tocHtml}</ol></section>
${content}
</body></html>`;

await mkdir(dirname(output), { recursive: true });
await writeFile(printHtml, html, "utf8");
const browser = await chromium.launch({ headless: true, args: ["--allow-file-access-from-files"] });
const page = await browser.newPage();
await page.goto(pathToFileURL(printHtml).href, { waitUntil: "load" });
await page.pdf({
  path: output,
  format: "A4",
  printBackground: true,
  preferCSSPageSize: true,
  displayHeaderFooter: true,
  headerTemplate: "<span></span>",
  footerTemplate: "<div style=\"width:100%;padding:0 16mm;color:#5a6472;font:8px sans-serif;text-align:right\">뭐하려 했더라 · 사용 설명서&nbsp;&nbsp;<span class=\"pageNumber\"></span></div>",
  tagged: true,
});
await browser.close();
console.log(output);

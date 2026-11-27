// 문서 탭 PDF 장면용 예시 PDF(가상의 업체 장애 경위서)를 만든다 — Edge 의 인쇄(page.pdf)로 글자가 든 PDF 를 굽는다.
// 실행: node mkpdf.mjs → demo-docs/2026 나라장터 운영/한빛정보 장애 경위서.pdf (사람·업체·번호는 가상의 예시)
import path from "node:path"; import { fileURLToPath, pathToFileURL } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const pw = await import(pathToFileURL(path.join(REPO, "node_modules", "playwright-core", "index.js")).href);
const chromium = (pw.default && pw.default.chromium) || pw.chromium;
const font = pathToFileURL(path.join(REPO, "src/fonts/PretendardVariable.woff2")).href;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:P;src:url('${font}') format('woff2-variations');font-weight:45 920}
body{font-family:P,sans-serif;margin:0;padding:22mm 20mm;color:#222;font-size:11.5pt;line-height:1.75}
h1{font-size:19pt;text-align:center;margin:0 0 6mm;letter-spacing:.3em}
.meta{border-top:2px solid #333;border-bottom:1px solid #999;padding:3mm 0;margin-bottom:7mm;font-size:10.5pt}
.meta div{display:flex;gap:6mm}.meta b{width:28mm;display:inline-block}
h2{font-size:13pt;margin:7mm 0 2mm}
table{border-collapse:collapse;width:100%;font-size:10.5pt}td,th{border:1px solid #888;padding:2mm 3mm;text-align:left}th{background:#eee}
.sign{margin-top:14mm;text-align:right}
</style></head><body>
<h1>장애 경위서</h1>
<div class="meta">
<div><b>제출 업체</b>㈜한빛정보 (대표 김민준)</div>
<div><b>입찰공고번호</b>R26BK01234567</div>
<div><b>장애 일시</b>2026년 11월 21일 15:30 ~ 16:10</div>
</div>
<h2>1. 발생 경위</h2>
<p>15시 32분 투찰서 전송 단계에서 화면이 멈추고 전송 버튼이 눌리지 않았습니다. 브라우저를 다시 열어도 같은 증상이 이어져 15시 35분 나라장터 콜센터에 접수했습니다.</p>
<h2>2. 업체에서 확인한 사항</h2>
<p>인증서는 정상이었고 사내 네트워크에도 이상이 없었습니다. 같은 시간대에 다른 공고의 투찰 화면도 열리지 않아 시스템 쪽 장애로 판단했습니다.</p>
<h2>3. 요청 사항</h2>
<p>장애 시간대에 투찰하지 못한 업체가 다시 투찰할 수 있도록 입찰서 제출 기한 연기를 요청드립니다.</p>
<table><tr><th>시각</th><th>내용</th></tr>
<tr><td>15:32</td><td>투찰서 전송 화면 멈춤</td></tr>
<tr><td>15:35</td><td>나라장터 콜센터 접수</td></tr>
<tr><td>16:10</td><td>투찰 화면 정상 접속 확인</td></tr></table>
<div class="sign">2026. 11. 21.<br>㈜한빛정보</div>
</body></html>`;
const b = await chromium.launch({ channel: "msedge" });
const p = await b.newPage();
await p.setContent(html, { waitUntil: "networkidle" }); await p.evaluate(() => document.fonts.ready);
const out = path.join(HERE, "demo-docs", "2026 나라장터 운영", "한빛정보 장애 경위서.pdf");
await p.pdf({ path: out, format: "A4", printBackground: true });
await b.close(); console.log("ok", out);

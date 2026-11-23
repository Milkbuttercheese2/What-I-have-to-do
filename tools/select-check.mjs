/* 문서 탭 글자 층(PDF·한글) 끌어 고르기 검증 — 창 크기·화면 배율에 따라 글자 층이 쪽 그림과 어긋나는지
 *
 * 왜 이게 필요한가
 *   PDF(pdf.js 글자 층)와 한글(rhwp 쪽 SVG 위 글자 층)은 '그림' 위에 투명한 글자를 겹쳐 끌어 고르게 한다.
 *   둘의 자리·크기가 어긋나거나 끌기 시작점이 엉뚱하게 잡히면 줄 맨 왼쪽을 눌러도 줄 가운데부터 골라진다.
 *   이것은 실제 글꼴·배율·레이아웃이 있어야만 드러나므로 jsdom 으로는 볼 수 없다 — Edge 에서 진짜로 그려 잰다.
 *   앱의 화면 크기(Ctrl+휠, ui-scale.js)는 CSS zoom 이 아니라 웹뷰 배율이라, 페이지 안에서는
 *   devicePixelRatio 가 (모니터 배율 × 앱 배율)로 바뀌고 CSS 뷰포트가 그만큼 줄어든 것과 같다 —
 *   그래서 deviceScaleFactor 와 뷰포트 크기로 흉내 낸다. 페이지는 앱처럼 lang="ko".
 *
 * 재는 것(첫 쪽)
 *   - 글자 층 상자 vs 그림 상자: 왼쪽·위·폭·높이 차이(px)
 *   - 글자 하나(한글)·글자 덩어리(PDF)의 왼쪽 끝 vs 문서가 말하는 자리 × 배율: 가장 큰 차이(px), PDF 는 덩어리 폭 차이(%)
 *   - 실제 마우스로 줄 앞 4줄을 '첫 글자 위(+0.4px)'와 '첫 글자 3px 왼쪽(여백)'에서 눌러 끌었을 때 고른 글자가 그 줄 첫 글자로 시작하는가,
 *     줄 여러 개에 걸친 끌기, (PDF) 보기 칸 아래 끝에 머물러 다음 쪽까지 넘어가며 고르기
 *   - 쪽 왼쪽 끝이 보기 칸 밖으로 잘려 나가지 않는가(cutLeft — 가로로 끝까지 넘겨도 줄 앞이 안 보이면 줄 가운데부터만 고를 수 있다)
 *   - 같은 것을 창 폭을 줄인 뒤(메모 칸 접기·창 줄이기), (PDF) ＋ 확대 두 번 뒤에 다시
 *   허용: 자리·상자 1.5px(TOL), 글자 덩어리 폭 2%
 *
 * 실행:  node tools/select-check.mjs          부분만: ONLY=pdf  WINS='[[620,800]]'  DPRS='[1.5]'  APP='[1.3]'
 * 준비:  npm i --no-save playwright-core   (Edge 사용)
 * 결과:  실패가 하나라도 있으면 종료 코드 1
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import {fileURLToPath, pathToFileURL} from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const FX = path.join(ROOT, 'tests', 'fixtures');
const pw = await import(pathToFileURL(path.join(ROOT, 'node_modules', 'playwright-core', 'index.js')).href);
const chromium = (pw.default && pw.default.chromium) || pw.chromium;

/* 시험용 PDF — Helvetica 글자 줄 몇 개(왼쪽 여백 72pt, 들여쓴 줄, 작은 글자 줄) × 3쪽. 쪽 끝마다 'Page N end' */
function makePdf(pages=3){
  const lines=n=>[[72,770,14,'First line starts at the left margin'],[72,748,11,'Second line of ordinary body text, a little longer than the first.'],
    [108,726,11,'Indented line'],[72,700,9,'Small text: The quick brown fox jumps over the lazy dog 0123456789'],[300,680,11,'Right column text'],[72,80,11,`Page ${n} end`]];
  const objs=['<< /Type /Catalog /Pages 2 0 R >>', null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids=[];
  for(let n=1;n<=pages;n++){
    const stream=lines(n).map(([x,y,sz,t])=>`BT /F1 ${sz} Tf ${x} ${y} Td (${t}) Tj ET`).join('\n');
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const c=objs.length;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${c} 0 R >>`);
    kids.push(`${objs.length} 0 R`);
  }
  objs[1]=`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages} >>`;
  let out='%PDF-1.4\n'; const offs=[];
  objs.forEach((o,i)=>{ offs.push(out.length); out+=`${i+1} 0 obj\n${o}\nendobj\n`; });
  const x=out.length;
  out+=`xref\n0 ${objs.length+1}\n0000000000 65535 f \n`+offs.map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('');
  out+=`trailer\n<< /Size ${objs.length+1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
const PDF=makePdf();

const HARNESS=`<!doctype html><html lang="ko"><head><meta charset="utf-8"><link rel="stylesheet" href="/styles.css">
<script src="/vendor/xlsx.full.min.js"></script>
<style>html,body{margin:0;height:100%}#wrap{display:flex;height:100vh}#side{width:var(--side,280px);flex:none;background:#eee}#view-docs{display:flex!important;flex:1;min-width:0;padding:0;margin:0;max-width:none}#box{flex:1;min-width:0}</style></head>
<body><div id="wrap"><div id="side"></div><div id="view-docs" class="on"><div class="dv-content" id="box"></div></div></div>
<script type="module">
import {renderPdf, renderHwp, loadRhwp, hwpTextRuns} from '/docs-view.js';
window.H={renderPdf, renderHwp, loadRhwp, hwpTextRuns};
window.ready=true;
</script></body></html>`;

const MIME = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml','.bcmap':'application/octet-stream','.pfb':'application/octet-stream','.ttf':'font/ttf'};
const server = http.createServer((q, r) => {
  const p = decodeURIComponent(q.url.split('?')[0]);
  if (p === '/__h.html') { r.writeHead(200, {'Content-Type':'text/html'}); r.end(HARNESS); return; }
  if (p === '/__fx/sample.pdf') { r.writeHead(200, {'Content-Type':'application/pdf'}); r.end(PDF); return; }
  const file = p.startsWith('/__fx/') ? path.join(FX, p.slice(6)) : path.join(SRC, p);
  fs.readFile(file, (e, b) => {
    if (e) { r.writeHead(404); r.end('nf'); return; }
    r.writeHead(200, {'Content-Type': MIME[path.extname(file)] || 'application/octet-stream'}); r.end(b);
  });
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;

/* 창(CSS px = 실제 창 ÷ 앱 배율) × 모니터 배율 × 앱 배율 */
const env = (k, d) => process.env[k] ? JSON.parse(process.env[k]) : d;
const WINS = env('WINS', [[1280,720],[1920,1080],[900,700],[620,800]]);
const DPRS = env('DPRS', [1, 1.25, 1.5]);
const APP = env('APP', [0.9, 1.0, 1.3]);
const DOCS = [['pdf','sample.pdf'],['hwpx','rhwp-sample.hwpx'],['hwp','rhwp-sample.hwp']];
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const TOL = Number(process.env.TOL || 1.5);

/* 쪽 그림과 글자 층을 잰다(페이지 안에서 돈다) — 첫 쪽 */
const MEASURE = async ({kind})=>{
  const box=document.getElementById('box'), R=e=>e.getBoundingClientRect();
  const pgSel = kind==='pdf' ? '.dv-pdf-pg' : '.dv-hwp-pg', tlSel = kind==='pdf' ? '.textLayer' : '.dv-hwp-tl';
  const pg=box.querySelector(pgSel); if(!pg) return {err:'쪽 없음'};
  const tl=pg.querySelector(tlSel), pic=pg.querySelector(kind==='pdf' ? 'canvas' : 'img');
  if(!tl) return {err:'글자 층 없음'};
  const a=R(pic), b=R(tl);
  const c=R(box);
  /* 쪽 왼쪽 끝이 보기 칸 왼쪽보다 밖이면, 가로로 끝까지 넘겨도(scrollLeft 0) 줄 앞을 볼 수 없다 */
  box.scrollLeft=0;
  const out={box:{dl:b.left-a.left, dt:b.top-a.top, dw:b.width-a.width, dh:b.height-a.height}, maxDx:0, widthErr:0, worst:null, cutLeft:Math.max(0, c.left-R(pic).left)};
  if(kind==='pdf'){
    const {items, pw}=window.__pdfItems, s=a.width/pw;
    const spans=[...tl.querySelectorAll('span:not(.markedContent)')].filter(x=>x.textContent);
    items.forEach((it,k)=>{ const sp=spans[k]; if(!sp) return; const r=R(sp);
      const ex=a.left+it.transform[4]*s, ew=it.width*s, dx=Math.abs(r.left-ex);
      if(dx>out.maxDx){ out.maxDx=dx; out.worst={t:it.str.slice(0,20), dx:+(r.left-ex).toFixed(2)}; }
      if(ew>20) out.widthErr=Math.max(out.widthErr, Math.abs(r.width-ew)/ew); });
  } else {
    const {w, runs}=H.hwpTextRuns(window.__hwpSvg), s=a.width/w;
    const chars=runs.flatMap(r=>r.cs), spans=[...tl.querySelectorAll('span')];
    chars.forEach((c,k)=>{ const sp=spans[k]; if(!sp) return; const d=R(sp).left-(a.left+c.x*s);
      if(Math.abs(d)>out.maxDx){ out.maxDx=Math.abs(d); out.worst={t:c.s, dx:+d.toFixed(2)}; } });
  }
  /* 끌기 대상: 줄의 첫 덩어리(위 덩어리와 높이가 다르면 새 줄) 앞 4줄 */
  const sp=[...tl.querySelectorAll('span:not(.markedContent)')].filter(x=>x.textContent.trim());
  out.starts=[]; let lastTop=-1e9;
  for(const x of sp){ const r=R(x); if(Math.abs(r.top-lastTop)>r.height*0.5){ out.starts.push({x:r.left, y:r.top+r.height/2, t:x.textContent.trim()[0]}); lastTop=r.top; } if(out.starts.length>=4) break; }
  return out;
};
const badMeasure = m => !!(m.err || m.cutLeft > 0.5 || Math.max(Math.abs(m.box.dl), Math.abs(m.box.dt)) > TOL || Math.abs(m.box.dw) > TOL+1 || m.maxDx > TOL || m.widthErr > 0.02);
const fmt = m => m.err ? {err:m.err} : {box:Object.fromEntries(Object.entries(m.box).map(([k,v])=>[k,+v.toFixed(2)])), maxDx:+m.maxDx.toFixed(2), cutLeft:+m.cutLeft.toFixed(1), widthErr:+(m.widthErr*100).toFixed(1)+'%', worst:m.worst};

const browser = await chromium.launch({channel: process.env.PW_CHANNEL || 'msedge'});
const rows=[]; let fails=0;
for (const [kind, file] of DOCS) {
  if (ONLY && !ONLY.includes(kind)) continue;
  for (const [W,Hh] of WINS) for (const dpr of DPRS) for (const app of APP) {
    const vw=Math.round(W/app), vh=Math.round(Hh/app);
    const ctx = await browser.newContext({viewport:{width:vw, height:vh}, deviceScaleFactor:dpr*app});
    const page = await ctx.newPage();
    const errs=[]; page.on('pageerror', e=>errs.push(String(e)));
    await page.goto(`http://127.0.0.1:${port}/__h.html`);
    await page.waitForFunction(()=>window.ready);
    const side = Math.round(vw*0.22);
    await page.evaluate(async ({kind, file, side})=>{
      document.documentElement.style.setProperty('--side', side+'px');
      const bytes=new Uint8Array(await (await fetch('/__fx/'+file)).arrayBuffer());
      const box=document.getElementById('box'), sleep=ms=>new Promise(r=>setTimeout(r,ms));
      if(kind==='pdf'){
        await H.renderPdf(box, bytes.slice());
        const doc=await (await import('/vendor/pdfjs/pdf.min.mjs')).getDocument({data:bytes.slice()}).promise;
        const p1=await doc.getPage(1);
        window.__pdfItems={items:(await p1.getTextContent()).items.filter(i=>i.str), pw:p1.getViewport({scale:1}).width};
      } else {
        await H.renderHwp(box, bytes, await H.loadRhwp());
      }
      const pgSel = kind==='pdf' ? '.dv-pdf-pg' : '.dv-hwp-pg', tlSel = kind==='pdf' ? '.textLayer' : '.dv-hwp-tl';
      for(let k=0;k<100;k++){ const pg=box.querySelector(pgSel); if(pg && pg.querySelector(tlSel+' span') && (kind!=='pdf' || pg.querySelector('canvas').width>1)) break; await sleep(50); }
      if(kind!=='pdf') window.__hwpSvg=await (await fetch(box.querySelector('.dv-hwp-pg img').src)).text();
      await sleep(300);
    }, {kind, file, side});
    const drag=async(x, y, x2, y2, hold=0)=>{
      await page.evaluate(()=>getSelection().removeAllRanges());
      await page.mouse.move(x, y); await page.mouse.down();
      for(let k=1;k<=10;k++) await page.mouse.move(x+(x2-x)*k/10, y+(y2-y)*k/10);
      if(hold) await page.waitForTimeout(hold);
      await page.mouse.up();
      return page.evaluate(()=>String(getSelection()));
    };
    const drags=[];
    const dragLines=async (m, tag)=>{
      for(const [k, st] of (m.starts||[]).entries()) for(const off of [0.4, -3]){   // 글자 위(첫 글자 왼쪽 반 — 좁은 글자는 1px 만 들어가도 오른쪽 반이라 그 글자 뒤가 시작점이 맞다) · 여백
        const got=await drag(st.x+off, st.y, st.x+off+150, st.y);
        drags.push({tag, line:k, off, want:st.t, got:got.trim().slice(0,6), ok:got.trim()[0]===st.t});
      }
      if((m.starts||[]).length>=3){ const a=m.starts[0], c=m.starts[2];
        const got=await drag(a.x-3, a.y, c.x+100, c.y);
        drags.push({tag, line:'0→2', off:-3, want:a.t, got:got.trim().slice(0,6), ok:got.trim()[0]===a.t}); }
    };
    const m0 = await page.evaluate(MEASURE, {kind});
    if(!m0.err) await dragLines(m0, 'first');
    /* 여러 쪽에 걸쳐: 첫 줄 앞에서 눌러 보기 칸 아래 끝으로 끌고 머물면 저절로 넘어가 다음 쪽까지 골라져야 한다 */
    if(kind==='pdf' && !m0.err){
      const a=m0.starts[0], bottom=await page.evaluate(()=>document.getElementById('box').getBoundingClientRect().bottom);
      const got=await drag(a.x-3, a.y, a.x+60, bottom-4, 2500);
      drags.push({tag:'autoscroll', want:'Page 1 end', got:got.replace(/\s+/g,' ').slice(-24), ok:got.includes('Page 1 end') && got.trim().startsWith('First line')});
      await page.evaluate(()=>{ document.getElementById('box').scrollTop=0; });
    }
    /* 창 폭을 줄인 뒤(메모 칸 접기·창 줄이기와 같은 일) — 글자 층이 따라오는가 */
    await page.setViewportSize({width:Math.round(vw*0.72), height:vh});
    await page.waitForTimeout(700);
    const m1 = await page.evaluate(MEASURE, {kind});
    if(!m1.err) await dragLines(m1, 'resized');
    /* PDF 확대(＋ 두 번) 뒤 */
    let m2=null;
    if(kind==='pdf'){
      await page.evaluate(()=>{ const b=document.querySelector('[data-pdfz="1"]'); b.click(); b.click(); document.getElementById('box').scrollTop=0; });
      await page.waitForTimeout(900);
      m2 = await page.evaluate(MEASURE, {kind});
      if(!m2.err) await dragLines(m2, 'zoomed');
    }
    const dragBad=drags.filter(d=>!d.ok);
    const bad = badMeasure(m0) || badMeasure(m1) || (m2 && badMeasure(m2)) || dragBad.length>0 || errs.length>0;
    if (bad) fails++;
    rows.push({kind, win:`${W}x${Hh}`, dpr, app, ok:!bad, first:fmt(m0), resized:fmt(m1), ...(m2?{zoomed:fmt(m2)}:{}), drags:drags.length, dragFail:dragBad, errs:errs.slice(0,2)});
    await ctx.close();
  }
}
await browser.close(); server.close();
for (const r of rows) console.log(JSON.stringify(r));
console.log(fails ? `실패 ${fails}/${rows.length}` : `모두 통과 ${rows.length}`);
process.exit(fails ? 1 : 0);

/* 문서 탭 글자 층(PDF·한글) 끌어 고르기 검증 — 창 크기·화면 배율·누르는 자리에 따라 시작점이 어긋나는지
 *
 * 왜 이게 필요한가
 *   PDF(pdf.js 글자 층)와 한글(rhwp 쪽 SVG 위 글자 층)은 '그림' 위에 투명한 글자를 겹쳐 끌어 고르게 한다.
 *   글자 층이 그림과 어긋나거나 끌기 시작점이 엉뚱하게 잡히면 줄 맨 왼쪽부터 고르려 해도 줄 가운데부터 골라진다.
 *   실제 글꼴·배율·레이아웃이 있어야만 드러나므로 jsdom 으로는 볼 수 없다 — 진짜로 그려 마우스로 끈다.
 *   v3.8.21 에서 글자 층 '안'을 누르는 경우만 고쳤는데 사용자는 여전히 줄 가운데부터 골라졌다 — 줄 왼쪽부터 고르려는
 *   사람은 쪽 밖 회색 여백·쪽 가장자리에서 누르기 쉽다. 그래서 그 자리들을 모두 시험한다.
 *
 * 두 가지로 돈다
 *   - 기본: Edge(Playwright). 앱의 화면 크기(Ctrl+휠, ui-scale.js)는 CSS zoom 이 아니라 웹뷰 배율이라, 페이지 안에서는
 *     devicePixelRatio 가 (모니터 배율 × 앱 배율)로 바뀌고 CSS 뷰포트가 그만큼 줄어든 것과 같다 — deviceScaleFactor 와 뷰포트로 흉내.
 *   - WV2=1: 진짜 WebView2. tools/wv2host(앱과 같은 wry/tao)가 창을 띄우고 앱처럼 웹뷰 배율(zoom)을 건 뒤 CDP 로 조작한다.
 *     모니터 배율은 이 PC 그대로. 먼저 한 번: cargo build --offline --manifest-path tools/wv2host/Cargo.toml
 *
 * 재는 것(첫 쪽)
 *   - 글자 층 상자 vs 그림 상자, 글자(한글)·덩어리(PDF) 자리 vs 문서 좌표 × 배율, 폭(PDF 덩어리 · 한글 글자 칸 ↔ 다음 글자 자리)
 *   - 쪽 왼쪽이 보기 칸 밖으로 잘렸는지(cutLeft)
 *   - 실제 마우스 끌기, 앞 4줄마다 누르는 자리: 첫 글자 위(+0.4px) · 3px 왼쪽 · 30/60/100px 왼쪽 · 보기 칸 왼쪽 끝(쪽 밖 회색 여백).
 *     그 줄의 첫 몇 글자부터 골라져야 한다. 여러 줄에 걸친 끌기, 쪽 사이에서 눌러 다음 쪽으로, (PDF) 아래 끝에 머물러 다음 쪽까지.
 *     확대 단추 줄·스크롤 막대를 누르는 것은 고르기로 가로채지 않아야 한다.
 *   - 파란 선택 표시가 그림 글자를 덮는가: 줄을 보기 칸 왼쪽 끝부터 줄 끝 너머까지 고른 앞뒤 화면 캡처 — 앞 화면의 글자(진한 점) 가로 범위를
 *     뒤 화면에서 바뀐 점(선택 표시)의 가로 범위가 그 줄 글자 자리(문서 좌표 — PDF 덩어리, 한글 SVG 글자)를 덮어야 한다
 *     (상자 테두리·띠 같은 그림은 글자가 아니므로 진한 점이 아니라 문서 좌표로 본다). SHOTS=폴더 면 앞뒤 캡처를 남긴다
 *   - 같은 것을 보기 칸을 좁힌 뒤(옆 칸이 넓어짐 = 메모 칸 펼치기·트리 넓히기), (PDF) ＋ 확대 두 번 뒤에 다시
 *   허용: 자리·상자 1.5px(TOL), 폭 2%
 *
 * 실행:  node tools/select-check.mjs        부분: ONLY=pdf,ko-pdf  WINS='[[620,800]]'  DPRS='[1.5]'  APP='[1.3]'  WV2=1
 * 준비:  npm i --no-save playwright-core   (Edge 사용)
 * 결과:  실패가 하나라도 있으면 종료 코드 1
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import {spawn} from 'child_process';
import zlib from 'zlib';
import {fileURLToPath, pathToFileURL} from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const FX = path.join(ROOT, 'tests', 'fixtures');
const pw = await import(pathToFileURL(path.join(ROOT, 'node_modules', 'playwright-core', 'index.js')).href);
const chromium = (pw.default && pw.default.chromium) || pw.chromium;
const WV2 = !!process.env.WV2;
const HOST = path.join(ROOT, 'tools', 'wv2host', 'target', 'debug', 'wv2host.exe');

/* 시험용 PDF ① — Helvetica(문서에 글꼴 없음 — 대체 글꼴로 그린다) 글자 줄 × 3쪽. 쪽 끝마다 'Page N end' */
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
/* 시험용 PDF ② — 한글 글꼴(맑은 고딕·바탕)을 품은 공문서 꼴 3쪽. Edge 의 인쇄(PDF)로 만든다(글꼴이 문서에 박힌다) */
async function makeKoPdf(browser){
  const ctx=await browser.newContext(); const p=await ctx.newPage();
  const block=n=>`<section style="page-break-after:always">
    <h1 style="font:bold 20pt '맑은 고딕';margin:0 0 14pt">${n}. 전자입찰 장애 조치 결과 보고</h1>
    <p style="font:13pt 'Batang','바탕';margin:0 0 8pt">□ 지난 화요일 10:00 경 입찰서 제출 화면에서 응답 지연이 발생함</p>
    <p style="font:13pt 'Batang','바탕';margin:0 0 8pt;padding-left:18pt">ㅇ 같은 시간대 접속자가 평소보다 많아 서버 부하가 높았음(Server load 87%)</p>
    <p style="font:11pt '맑은 고딕';margin:0 0 8pt">※ 장애 재발 시 담당자: 조달정보과 ○○○ (전화 02-0000-0000)</p>
    <p style="font:13pt 'Batang','바탕';margin:0 0 8pt">□ 접속 서버를 두 대 늘리고 세션 유지 시간을 조정함 — 입찰 마감 시각을 한 시간 늦춤</p>
    <p style="font:13pt '맑은 고딕';margin:300pt 0 0">${n}쪽 끝 줄</p></section>`;
  await p.setContent(`<html lang="ko"><body style="margin:0">${[1,2,3].map(block).join('')}</body></html>`);
  const pdf=await p.pdf({format:'A4', margin:{top:'25mm', left:'25mm', right:'20mm', bottom:'20mm'}});
  await ctx.close();
  return pdf;
}

const HARNESS=`<!doctype html><html lang="ko"><head><meta charset="utf-8"><link rel="stylesheet" href="/styles.css">
<script src="/vendor/xlsx.full.min.js"></script>
<style>html,body{margin:0;height:100%}#wrap{display:flex;height:100vh}#side{width:var(--side,280px);flex:none;background:#eee}#view-docs{display:flex!important;flex:1;min-width:0;padding:0;margin:0;max-width:none}#box{flex:1;min-width:0}</style></head>
<body><div id="wrap"><div id="side"></div><div id="view-docs" class="on"><div class="dv-content" id="box"></div></div></div>
<script type="module">
import {renderPdf, renderHwp, loadRhwp, hwpTextRuns} from '/docs-view.js';
window.H={renderPdf, renderHwp, loadRhwp, hwpTextRuns};
window.ready=true;
</script></body></html>`;

const FILES = {};
const MIME = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml','.bcmap':'application/octet-stream','.pfb':'application/octet-stream','.ttf':'font/ttf'};
const server = http.createServer((q, r) => {
  const p = decodeURIComponent(q.url.split('?')[0]);
  if (p === '/__h.html') { r.writeHead(200, {'Content-Type':'text/html'}); r.end(HARNESS); return; }
  if (p.startsWith('/__gen/') && FILES[p.slice(7)]) { r.writeHead(200, {'Content-Type':'application/pdf'}); r.end(FILES[p.slice(7)]); return; }
  const file = p.startsWith('/__fx/') ? path.join(FX, p.slice(6)) : path.join(SRC, p);
  fs.readFile(file, (e, b) => {
    if (e) { r.writeHead(404); r.end('nf'); return; }
    r.writeHead(200, {'Content-Type': MIME[path.extname(file)] || 'application/octet-stream'}); r.end(b);
  });
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;

const env = (k, d) => process.env[k] ? JSON.parse(process.env[k]) : d;
const WINS = env('WINS', WV2 ? [[1280,720],[900,700]] : [[1280,720],[1920,1080],[900,700],[620,800]]);
const DPRS = env('DPRS', [1, 1.25, 1.5]);
const APP = env('APP', [0.9, 1.0, 1.3]);
const DOCS = [['pdf','/__gen/sample.pdf'],['ko-pdf','/__gen/ko.pdf'],['hwpx','/__fx/rhwp-sample.hwpx'],['hwp','/__fx/rhwp-sample.hwp'],
  ['ko-hwpx-myeongjo','/__fx/ko-myeongjo.hwpx'],['ko-hwpx-gothic','/__fx/ko-gothic.hwpx']];
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const TOL = Number(process.env.TOL || 1.5);
const isPdf = k => k.endsWith('pdf');

/* 쪽 그림과 글자 층을 잰다(페이지 안에서 돈다) — 첫 쪽. 끌기 대상(줄 앞)과 쪽 사이 자리도 돌려준다 */
const MEASURE = async ({pdf})=>{
  const box=document.getElementById('box'), R=e=>e.getBoundingClientRect();
  const pgSel = pdf ? '.dv-pdf-pg' : '.dv-hwp-pg', tlSel = pdf ? '.textLayer' : '.dv-hwp-tl';
  const pgs=[...box.querySelectorAll(pgSel)], pg=pgs[0]; if(!pg) return {err:'쪽 없음'};
  const tl=pg.querySelector(tlSel), pic=pg.querySelector(pdf ? 'canvas' : 'img');
  if(!tl) return {err:'글자 층 없음'};
  box.scrollLeft=0;
  const a=R(pic), b=R(tl), c=R(box);
  const out={box:{dl:b.left-a.left, dt:b.top-a.top, dw:b.width-a.width, dh:b.height-a.height}, maxDx:0, widthErr:0, worst:null, cutLeft:Math.max(0, c.left-a.left)};
  if(pdf){
    const {items, pw}=window.__pdfItems, s=a.width/pw;
    const spans=[...tl.querySelectorAll('span:not(.markedContent)')].filter(x=>x.textContent);
    items.forEach((it,k)=>{ const sp=spans[k]; if(!sp) return; const r=R(sp);
      const ex=a.left+it.transform[4]*s, ew=it.width*s, dx=Math.abs(r.left-ex);
      if(dx>out.maxDx){ out.maxDx=dx; out.worst={t:it.str.slice(0,12), dx:+(r.left-ex).toFixed(2)}; }
      if(ew>20 && it.str.length>2){ const e=Math.abs(r.width-ew)/ew; if(e>out.widthErr){ out.widthErr=e; out.worstW={t:it.str.slice(0,16), got:+r.width.toFixed(1), want:+ew.toFixed(1), font:getComputedStyle(sp).fontFamily, tf:sp.style.transform}; } } });
  } else {
    const {w, runs}=H.hwpTextRuns(window.__hwpSvg), s=a.width/w;
    const spans=[...tl.querySelectorAll('span')]; let k=0;
    for(const run of runs) run.cs.forEach((ch, j)=>{ const sp=spans[k++]; if(!sp) return; const r=R(sp), d=r.left-(a.left+ch.x*s);
      if(Math.abs(d)>out.maxDx){ out.maxDx=Math.abs(d); out.worst={t:ch.s, dx:+d.toFixed(2)}; }
      const nc=run.cs[j+1]; if(nc && /\S/.test(ch.s) && !/\s$/.test(sp.textContent)){ const want=(nc.x-ch.x)*s; if(want>3) out.widthErr=Math.max(out.widthErr, Math.abs(r.width-want)/want); } });
  }
  /* 줄 앞 4줄(위 덩어리와 높이가 다르면 새 줄) — 그 줄 첫 세 글자(빈칸 빼고)를 기억 */
  const sp=[...tl.querySelectorAll('span:not(.markedContent)')].filter(x=>x.textContent.trim());
  out.starts=[]; let lastTop=-1e9;
  for(let k=0;k<sp.length;k++){ const x=sp[k], r=R(x);
    if(Math.abs(r.top-lastTop)>r.height*0.5){
      let t=''; for(let j=k;j<sp.length && t.length<3 && Math.abs(R(sp[j]).top-r.top)<r.height*0.5;j++) t+=sp[j].textContent.replace(/\s+/g,'');
      let right=r.right; for(let j=k;j<sp.length && Math.abs(R(sp[j]).top-r.top)<r.height*0.5;j++) right=Math.max(right, R(sp[j]).right);
      out.starts.push({x:r.left, y:r.top+r.height/2, top:r.top, bottom:r.bottom, right, t:t.slice(0,3)}); lastTop=r.top; }
    if(out.starts.length>=4) break; }
  out.p1len=tl.textContent.replace(/\s+/g,'').length;
  /* 줄마다 문서가 말하는 글자 가로 범위(그림 글자 자리) — PDF 는 덩어리 시작~폭, 한글은 SVG 글자 자리 */
  for(const st of out.starts){
    let L=1e9, Rr=-1e9;
    if(pdf){
      const {items, pw}=window.__pdfItems, s=a.width/pw, spans=[...tl.querySelectorAll('span:not(.markedContent)')].filter(x=>x.textContent);
      items.forEach((it,k)=>{ const sp=spans[k]; if(!sp || !it.str.trim()) return; const r=R(sp), cy=r.top+r.height/2; if(cy<st.top || cy>st.bottom) return;
        L=Math.min(L, a.left+it.transform[4]*s); Rr=Math.max(Rr, a.left+(it.transform[4]+it.width)*s); });
    } else {
      const {w, runs}=H.hwpTextRuns(window.__hwpSvg), s=a.width/w;
      for(const run of runs){ const cy=a.top+(run.y-run.size*0.35)*s; if(cy<st.top || cy>st.bottom) continue;
        for(const ch of run.cs){ if(!ch.s.trim()) continue; L=Math.min(L, a.left+ch.x*s); Rr=Math.max(Rr, a.left+(ch.x+ch.w)*s); } }
    }
    if(Rr>L){ st.expL=L; st.expR=Rr; }
  }
  out.boxLeft=c.left; out.boxRight=c.right; out.boxTop=c.top; out.boxBottom=c.bottom; out.clientW=box.clientWidth;
  /* 쪽 사이(첫 쪽 아래 ↔ 둘째 쪽 위) — 둘째 쪽 첫 줄 */
  if(pgs[1]){ const tl2=pgs[1].querySelector(tlSel); const f=tl2 && [...tl2.querySelectorAll('span:not(.markedContent)')].find(x=>x.textContent.trim());
    if(f){ const r=R(f); out.gap={y:(R(pg).bottom+R(pgs[1]).top)/2, x:r.left, x2:r.left+60, y2:r.top+r.height/2, t:f.textContent.replace(/\s+/g,'').slice(0,3)}; } }
  return out;
};
const badMeasure = m => !!(m.err || m.cutLeft > 0.5 || Math.max(Math.abs(m.box.dl), Math.abs(m.box.dt)) > TOL || Math.abs(m.box.dw) > TOL+1 || m.maxDx > TOL || m.widthErr > 0.02);
const fmt = m => m.err ? {err:m.err} : {box:Object.fromEntries(Object.entries(m.box).map(([k,v])=>[k,+v.toFixed(2)])), maxDx:+m.maxDx.toFixed(2), cutLeft:+m.cutLeft.toFixed(1), widthErr:+(m.widthErr*100).toFixed(1)+'%', worst:m.worst, ...(m.worstW&&m.widthErr>0.02?{worstW:m.worstW}:{})};
const norm = s => String(s).replace(/\s+/g,'');
/* 화면 캡처(PNG) → {w, h, px(RGBA)} — 8비트 RGB/RGBA 만(Playwright 캡처) */
function decodePng(buf){
  let o=8, w=0, h=0, ct=0; const idat=[];
  while(o<buf.length){ const len=buf.readUInt32BE(o), type=buf.toString('latin1', o+4, o+8), d=buf.subarray(o+8, o+8+len);
    if(type==='IHDR'){ w=d.readUInt32BE(0); h=d.readUInt32BE(4); ct=d[9]; } else if(type==='IDAT') idat.push(d); else if(type==='IEND') break;
    o+=12+len; }
  const bpp=ct===6?4:3, raw=zlib.inflateSync(Buffer.concat(idat)), stride=w*bpp, out=Buffer.alloc(w*h*4), prev=Buffer.alloc(stride), cur=Buffer.alloc(stride);
  for(let y=0;y<h;y++){ const f=raw[y*(stride+1)]; raw.copy(cur, 0, y*(stride+1)+1, (y+1)*(stride+1));
    for(let i=0;i<stride;i++){ const a=i>=bpp?cur[i-bpp]:0, b=prev[i], c=i>=bpp?prev[i-bpp]:0;
      const p=f===1?a:f===2?b:f===3?((a+b)>>1):f===4?((q=>{const pa=Math.abs(q-a),pb=Math.abs(q-b),pc=Math.abs(q-c); return pa<=pb&&pa<=pc?a:pb<=pc?b:c;})(a+b-c)):0;
      cur[i]=(cur[i]+p)&255; }
    for(let x=0;x<w;x++){ for(let k=0;k<3;k++) out[(y*w+x)*4+k]=cur[x*bpp+k]; out[(y*w+x)*4+3]=255; }
    cur.copy(prev); }
  return {w, h, px:out};
}

let zoomNow=0;                                                           // WV2: 지금 창의 웹뷰 배율(캡처 자르기용)
async function runCase(page, kind, url){
  const errs=[]; page.on('pageerror', e=>errs.push(String(e)));
  const pdf=isPdf(kind);
  await page.waitForFunction(()=>window.ready);
  const vw=await page.evaluate(()=>innerWidth);
  await page.evaluate(async ({url, pdf, side})=>{
    document.documentElement.style.setProperty('--side', side+'px');
    const bytes=new Uint8Array(await (await fetch(url)).arrayBuffer());
    const box=document.getElementById('box'), sleep=ms=>new Promise(r=>setTimeout(r,ms));
    if(pdf){
      await H.renderPdf(box, bytes.slice());
      const doc=await (await import('/vendor/pdfjs/pdf.min.mjs')).getDocument({data:bytes.slice()}).promise;
      const p1=await doc.getPage(1);
      window.__pdfItems={items:(await p1.getTextContent()).items.filter(i=>i.str), pw:p1.getViewport({scale:1}).width};
    } else await H.renderHwp(box, bytes, await H.loadRhwp());
    const pgSel = pdf ? '.dv-pdf-pg' : '.dv-hwp-pg', tlSel = pdf ? '.textLayer' : '.dv-hwp-tl';
    for(let k=0;k<120;k++){ const pg=box.querySelector(pgSel); if(pg && pg.querySelector(tlSel+' span') && (!pdf || pg.querySelector('canvas').width>1)) break; await sleep(50); }
    if(!pdf) window.__hwpSvg=await (await fetch(box.querySelector('.dv-hwp-pg img').src)).text();
    await sleep(400);
  }, {url, pdf, side:Math.round(vw*0.22)});
  const drag=async(x, y, x2, y2, hold=0)=>{
    await page.evaluate(()=>getSelection().removeAllRanges());
    await page.mouse.move(x, y); await page.mouse.down();
    for(let k=1;k<=10;k++) await page.mouse.move(x+(x2-x)*k/10, y+(y2-y)*k/10);
    if(hold) await page.waitForTimeout(hold);
    await page.mouse.up();
    return page.evaluate(()=>String(getSelection()));
  };
  /* 맨 위로 — WebView2 는 스크롤 막대를 끈 뒤에도 잠깐 더 움직여(잰 값: 되돌린 뒤 250ms 에 69px) 멈출 때까지 되돌린다 */
  const toTop=async()=>{ for(let k=0;k<20;k++){ const t=await page.evaluate(()=>{ const b=document.getElementById('box'); const v=b.scrollTop; b.scrollTop=0; return v; }); await page.waitForTimeout(120); if(t===0 && await page.evaluate(()=>document.getElementById('box').scrollTop)===0) return; } };
  const drags=[];
  const dragLines=async (m, tag)=>{
    for(const [k, st] of (m.starts||[]).entries()){
      const pts=[['glyph',st.x+0.4],['3px',st.x-3],['30px',st.x-30],['60px',st.x-60],['100px',st.x-100],['gray',m.boxLeft+4]];
      for(const [name, px] of pts){
        if(px<m.boxLeft+2 && name!=='gray') continue;                       // 보기 칸 밖 — 'gray' 가 맡는다
        const got=await drag(px, st.y, st.x+150, st.y);
        drags.push({tag, line:k, at:name, want:st.t, got:norm(got).slice(0,6), ok:norm(got).startsWith(st.t)});
      }
    }
    if((m.starts||[]).length>=3){ const a=m.starts[0], c=m.starts[2];
      const got=await drag(m.boxLeft+4, a.y, c.x+100, c.y);
      drags.push({tag, line:'0→2', at:'gray', want:a.t, got:norm(got).slice(0,6), ok:norm(got).startsWith(a.t)}); }
    if(m.gap && m.gap.y<m.boxBottom-10){
      const got=await drag(m.gap.x, m.gap.y, m.gap.x2, m.gap.y2);
      drags.push({tag, line:'gap', at:'between', want:m.gap.t, got:norm(got).slice(-6), ok:norm(got).length>0 && norm(got).includes(m.gap.t)});
    }
  };
  /* 파란 선택 표시가 쪽 그림의 글자를 덮는가 — 줄을 보기 칸 왼쪽 끝부터 줄 끝 너머까지 끌어 고른 앞뒤 화면을 캡처해,
     앞 화면의 진한 점(글자) 가로 범위와 뒤 화면에서 바뀐 점(선택 표시) 가로 범위를 비교한다(줄 높이 가운데 절반만) */
  const paints=[];
  /* 화면 전체를 찍어 잘라 낸다 — WebView2 는 웹뷰 배율(zoom)이 걸리면 캡처의 잘라 낼 자리(clip)가 어긋난다(잰 값: 줄 대신 빈 여백이 찍힘).
     실측: WebView2 의 CDP 캡처는 'CSS px × 웹뷰 배율' 크기로 화면 왼쪽 위 일부만 찍는다(모니터 배율은 안 곱함) — 그래서 WebView2 는
     배율(zoom)로, Edge 는 '그림 폭 ÷ CSS 폭'으로 직접 자르고, 찍힌 범위 밖 줄은 건너뛴다 */
  let vis={w:1e9, h:1e9};
  const shot=async clip=>{
    const buf=await page.screenshot(), F=decodePng(buf), iw=await page.evaluate(()=>innerWidth), s=zoomNow ? zoomNow : F.w/iw;
    vis={w:F.w/s, h:F.h/s};
    const X=Math.round(clip.x*s), Y=Math.round(clip.y*s), w=Math.max(1, Math.min(F.w-X, Math.round(clip.width*s))), h=Math.max(1, Math.min(F.h-Y, Math.round(clip.height*s)));
    const px=Buffer.alloc(w*h*4); for(let y=0;y<h;y++) F.px.copy(px, y*w*4, ((Y+y)*F.w+X)*4, ((Y+y)*F.w+X+w)*4);
    return {w, h, px, buf};
  };
  const paintLines=async (m, tag)=>{
    await shot({x:0, y:0, width:1, height:1});                              // 찍히는 범위(vis)
    for(const [k, st] of (m.starts||[]).entries()){
      const x0=Math.ceil(m.boxLeft), x1=Math.floor(Math.min(m.boxLeft+m.clientW, m.boxRight, vis.w)), y0=Math.floor(st.top-2), y1=Math.ceil(st.bottom+2);
      if(x1-x0<20 || y1-y0<4 || y0<m.boxTop || y1>m.boxBottom || y1>vis.h || st.expL===undefined || st.expL>x1-10) continue;
      const clip={x:x0, y:y0, width:x1-x0, height:y1-y0};
      if(zoomNow){
        /* WebView2: 백그라운드 창의 CDP 캡처는 지난 화면을 돌려줘(앞뒤가 같음) 점으로 못 잰다 — 선택 범위의 상자(Range.getClientRects,
           브라우저가 칠하는 자리)를 그 줄 높이에서 모아 같은 기준으로 비교한다 */
        await drag(m.boxLeft+4, st.y, Math.min(st.right+30, x1-4), st.y);
        const hr=await page.evaluate(({t,b})=>{ const s=getSelection(); if(!s.rangeCount) return null; let L=1e9,R=-1e9;
          for(const r of s.getRangeAt(0).getClientRects()){ const cy=r.top+r.height/2; if(r.width<0.5 || cy<t || cy>b) continue; L=Math.min(L,r.left); R=Math.max(R,r.right); }
          return R>L ? [L,R] : null; }, {t:st.top, b:st.bottom});
        const h=st.bottom-st.top, tol=Math.max(3, h*0.45), expR=Math.min(st.expR, x1-2);
        const res={tag, line:k, want:st.t, glyphs:[+st.expL.toFixed(1), +st.expR.toFixed(1)], hi:hr&&hr.map(v=>+v.toFixed(1)), by:'rects'};
        res.ok=!!hr && hr[0]<=st.expL+2 && hr[0]>=st.expL-tol && hr[1]>=expR-tol;
        paints.push(res); continue;
      }
      await page.evaluate(()=>getSelection().removeAllRanges()); await page.waitForTimeout(60);
      const A=await shot(clip);
      await drag(m.boxLeft+4, st.y, Math.min(st.right+30, x1-4), st.y); await page.waitForTimeout(80);
      const B=await shot(clip);
      if(process.env.SHOTS){ const d=process.env.SHOTS; fs.mkdirSync(d,{recursive:true}); fs.writeFileSync(path.join(d,`${kind}-${tag}-${k}-sel.png`), B.buf); }
      const sx=A.w/clip.width, sy=A.h/clip.height;
      const r0=Math.floor((st.top+(st.bottom-st.top)*0.25-y0)*sy), r1=Math.ceil((st.top+(st.bottom-st.top)*0.75-y0)*sy);
      let inkL=1e9, inkR=-1, hiL=1e9, hiR=-1;
      for(let y=Math.max(0,r0);y<Math.min(A.h,r1);y++) for(let x=0;x<A.w;x++){ const i=(y*A.w+x)*4;
        const lum=0.3*A.px[i]+0.59*A.px[i+1]+0.11*A.px[i+2];
        if(lum<150){ inkL=Math.min(inkL,x); inkR=Math.max(inkR,x); }
        if(Math.abs(A.px[i]-B.px[i])+Math.abs(A.px[i+1]-B.px[i+1])+Math.abs(A.px[i+2]-B.px[i+2])>30){ hiL=Math.min(hiL,x); hiR=Math.max(hiR,x); } }
      if(st.expL===undefined) continue;
      const c=v=>+(x0+v/sx).toFixed(1), h=st.bottom-st.top, tol=Math.max(3, h*0.45);
      const res={tag, line:k, want:st.t, glyphs:[+st.expL.toFixed(1), +st.expR.toFixed(1)], hi:hiR<0?null:[c(hiL), c(hiR)], ink:inkR<0?null:[c(inkL), c(inkR)]};
      /* 선택 표시가 그 줄 글자 범위를 덮어야 — 왼쪽 끝은 첫 글자 자리에서 2px 안쪽 ~ 글자 크기 45% 바깥, 오른쪽 끝은 마지막 글자 끝 2px 안쪽까지 */
      /* 선택 표시는 '곱하기'(mix-blend-mode:multiply)로 칠해 진한 바탕(남색 장 번호 칸 등) 위에서는 보이지 않는다(소유자가 고른 방식 —
         반투명으로 하면 글자 칸이 겹친 곳이 얼룩진다). 첫 글자 자리 ~ 선택 표시 시작 사이가 진한 바탕이면 그 때문으로 본다(darkCell) */
      const expR=Math.min(st.expR, x1-2);                                   // 보기 칸 밖(가로로 넘친 부분)은 캡처에 없다
      let dark=0, all=0;
      if(hiR>=0 && c(hiL)>st.expL+2) for(let y=Math.max(0,r0);y<Math.min(A.h,r1);y++) for(let x=Math.max(0,Math.floor((st.expL-x0)*sx));x<hiL;x++){ const i=(y*A.w+x)*4; all++; if(0.3*A.px[i]+0.59*A.px[i+1]+0.11*A.px[i+2]<110) dark++; }
      res.darkCell = all>0 && dark/all>0.5;
      res.ok = hiR>=0 && (c(hiL) <= st.expL+2 || res.darkCell) && c(hiL) >= st.expL-tol && c(hiR) >= expR-tol;
      paints.push(res);
    }
    await page.evaluate(()=>getSelection().removeAllRanges());
  };
  const m0 = await page.evaluate(MEASURE, {pdf});
  if(!m0.err){ await paintLines(m0, 'first'); await dragLines(m0, 'first'); }
  if(pdf && !m0.err){
    /* 확대 단추 줄·스크롤 막대는 가로채지 않는다 */
    const bar=await page.evaluate(()=>{ const r=document.querySelector('.dv-pdf-bar .num').getBoundingClientRect(); return {x:r.left+2, y:r.top+r.height/2}; });
    const got=await drag(bar.x, bar.y, bar.x+80, bar.y+40);
    drags.push({tag:'first', line:'bar', at:'toolbar', want:'(고르기 시작 안 함)', got:norm(got).slice(0,6), ok:!norm(got) || !m0.starts.some(s=>norm(got).includes(s.t))});
    if(m0.clientW < m0.boxRight-m0.boxLeft-2){
      const sx=m0.boxRight-3, before=await page.evaluate(()=>document.getElementById('box').scrollTop);
      await drag(sx, m0.boxTop+30, sx, m0.boxTop+160);
      const after=await page.evaluate(()=>document.getElementById('box').scrollTop);
      drags.push({tag:'first', line:'scrollbar', at:'scrollbar', want:'scroll', got:String(after-before), ok:after>before});
      await toTop();
    }
    /* 여러 쪽에 걸쳐 — 아래 끝에 머물면 저절로 넘어간다 */
    const a=m0.starts[0];
    const top0=await page.evaluate(()=>document.getElementById('box').scrollTop);
    const got2=await drag(m0.boxLeft+4, a.y, a.x+60, m0.boxBottom-4, 2500);
    drags.push({tag:'autoscroll', at:'gray', want:a.t+'…2쪽', got:norm(got2).slice(0,6)+'…'+norm(got2).slice(-10)+' ('+norm(got2).length+') scrollTop@press='+top0, ok:norm(got2).startsWith(a.t) && norm(got2).length>m0.p1len+5});   // 첫 쪽보다 길어야(다음 쪽까지)
    await toTop();
  }
  /* 보기 칸을 좁힌 뒤(옆 칸이 넓어짐) */
  await page.evaluate(()=>{ document.documentElement.style.setProperty('--side', Math.round(innerWidth*0.42)+'px'); });
  await page.waitForTimeout(800);
  const m1 = await page.evaluate(MEASURE, {pdf});
  if(!m1.err){ await paintLines(m1, 'narrow'); await dragLines(m1, 'narrow'); }
  let m2=null;
  if(pdf){
    await page.evaluate(()=>{ const b=document.querySelector('[data-pdfz="1"]'); b.click(); b.click(); document.getElementById('box').scrollTop=0; });
    await page.waitForTimeout(1000);
    m2 = await page.evaluate(MEASURE, {pdf});
    if(!m2.err){ await paintLines(m2, 'zoomed'); await dragLines(m2, 'zoomed'); }
  }
  const dpr=await page.evaluate(()=>devicePixelRatio);
  return {m0, m1, m2, drags, paints, errs, dpr};
}

const rows=[]; let fails=0;
const record=(kind, conf, r)=>{
  const dragBad=r.drags.filter(d=>!d.ok), paintBad=(r.paints||[]).filter(d=>!d.ok);
  const bad = paintBad.length>0 || badMeasure(r.m0) || badMeasure(r.m1) || (r.m2 && badMeasure(r.m2)) || dragBad.length>0 || r.errs.length>0;
  if (bad) fails++;
  rows.push({kind, ...conf, dprSeen:+r.dpr.toFixed(3), ok:!bad, first:fmt(r.m0), narrow:fmt(r.m1), ...(r.m2?{zoomed:fmt(r.m2)}:{}), drags:r.drags.length, dragFail:dragBad, paints:(r.paints||[]).length, darkCells:(r.paints||[]).filter(p=>p.darkCell).length, paintFail:paintBad, errs:r.errs.slice(0,2)});
};

const edge = await chromium.launch({channel: process.env.PW_CHANNEL || 'msedge'});
FILES['sample.pdf']=makePdf();
FILES['ko.pdf']=await makeKoPdf(edge);
const want = DOCS.filter(([k])=>!ONLY || ONLY.includes(k));

if (!WV2) {
  for (const [kind, url] of want) for (const [W,Hh] of WINS) for (const dpr of DPRS) for (const app of APP) {
    const vw=Math.round(W/app), vh=Math.round(Hh/app);
    const ctx = await edge.newContext({viewport:{width:vw, height:vh}, deviceScaleFactor:dpr*app});
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${port}/__h.html`);
    record(kind, {win:`${W}x${Hh}`, dpr, app}, await runCase(page, kind, url));
    await ctx.close();
  }
} else {
  if (!fs.existsSync(HOST)) { console.error('먼저: cargo build --offline --manifest-path tools/wv2host/Cargo.toml'); process.exit(2); }
  let cdp = 9400;
  for (const [kind, url] of want) for (const [W,Hh] of WINS) for (const app of APP) {
    cdp++;
    const proc = spawn(HOST, [`http://127.0.0.1:${port}/__h.html`, String(app), String(W), String(Hh)],
      {env:{...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${cdp}`}, stdio:'ignore'});
    let browser=null;
    try{
      for(let k=0;k<100 && !browser;k++){ try{ browser=await chromium.connectOverCDP(`http://127.0.0.1:${cdp}`); }catch{ await new Promise(r=>setTimeout(r,200)); } }
      if(!browser) throw new Error('WebView2 CDP 연결 실패');
      let page=null;
      for(let k=0;k<50 && !page;k++){ page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('__h.html')); if(!page) await new Promise(r=>setTimeout(r,200)); }
      if(!page) throw new Error('창을 찾지 못함');
      await page.bringToFront();
      zoomNow=app;
      record(kind, {win:`${W}x${Hh}`, app, wv2:true}, await runCase(page, kind, url));
    }catch(e){ fails++; rows.push({kind, win:`${W}x${Hh}`, app, wv2:true, ok:false, err:String(e)}); }
    finally{ try{ await browser?.close(); }catch{} proc.kill(); await new Promise(r=>setTimeout(r,400)); }
  }
}
await edge.close(); server.close();
for (const r of rows) console.log(JSON.stringify(r));
console.log(fails ? `실패 ${fails}/${rows.length}` : `모두 통과 ${rows.length}`);
process.exit(fails ? 1 : 0);

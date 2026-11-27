/* =========================================================================
   업무 공유 — 미리 보기 창과 그림 만들기 (설계: 총괄 docs/뭐하려-했더라-공유-메모지-설계.md).
   무엇을 실을지는 순수 모듈 share-card.js 가 정하고, 여기서는 그리기·클립보드·파일 저장만 한다.

   그림 만들기 길(설계서 9-1, 2026-11-27 진짜 WebView2 158 에서 시험해 고름):
     미리 보기와 나가는 그림이 **같은 마크업·같은 CSS 한 벌**(shareHtml·shareCss)에서 나온다.
     그림은 그 마크업을 SVG foreignObject 에 넣어 <img> 로 읽고 캔버스에 옮긴다. 캔버스에 글자를 직접 그리는 길은
     줄바꿈·칩·체크 모양을 따로 다시 짜야 해서 미리 보기와 두 벌이 된다.
   ⚠️ SVG 는 반드시 data: 주소로 읽는다 — blob: 주소로 읽으면 WebView2 가 캔버스를 '오염'시켜 PNG 를 뽑지 못한다(실측).
   ⚠️ SVG 그림 안에서는 바깥 글꼴을 못 읽는다 — Pretendard 를 data: 로 품어 넣는다(설계서 9-3). 높이는 같은 마크업을
      화면 밖에서 앱의 Pretendard 로 재서 정한다(같은 글꼴 파일이라 줄바꿈이 같다).
   그림은 늘 밝은 테마, 폭 고정(카드 480 + 바깥 여백 16), 125% 배율 × 화면 밀도 2배 = 2.5배로 찍는다.
   ========================================================================= */
import {$, appAlert, showToast} from './dom-utils.js';
import {invoke} from './store.js';
import {openModal, closeModal} from './modals.js';
import {logWarn} from './logs.js';
import {shareModel, shareHtml, shareText, shareCss, shareFileName, SHARE_W} from './share-card.js';
import {shareSource} from './form.js';

const PREVIEW_FONT="'Pretendard','Malgun Gothic','맑은 고딕',sans-serif";
const IMAGE_FONT="'WMHShareFont','Pretendard','Malgun Gothic','맑은 고딕',sans-serif";
const SCALE=2.5;            // 125% × 2
const MAX_PX=16000;         // 캔버스 한 변 상한 — 아주 긴 그림은 배율을 낮춰 이 안에 넣는다
const NO_CLIP='이 PC에서는 그림을 클립보드에 넣을 수 없습니다.\n[파일로 저장]으로 그림 파일을 만든 뒤 대화창에 끌어다 놓아 주세요.';

let src=null, now=null, open=new Set(), withContacts=false;
let png=null, pending=null, pngTimer=null, fontP=null, gen=0;

function ctx(){ return {now, fields:src.fields, done:src.done, doneAt:src.doneAt, withContacts, open}; }
const sig=()=>[...open].sort().join(',')+'|'+(withContacts?1:0);

/* 양식의 [공유] — 지금 양식에 보이는 내용(저장 전 고친 것 포함)으로. 업무는 저장하지 않는다 */
export function openShare(){
  src=shareSource(); now=new Date(); open=new Set(); withContacts=false; png=null; pending=null; gen++;
  const sw=$('share-contacts'); if(sw) sw.checked=false;
  ensureCss();
  /* save 는 일부러 빈 동작 — 이 창이 떠 있을 때 Ctrl+S 가 밑의 양식을 저장해 버리지 않게(공유는 저장하지 않는다) */
  openModal('shareModal', {close:closeShare, save:()=>{}});
  paint();
  schedulePng(0);
}
export function closeShare(){ gen++; clearTimeout(pngTimer); png=null; pending=null; closeModal('shareModal'); }

function ensureCss(){
  if($('share-css')) return;
  const st=document.createElement('style'); st.id='share-css'; st.textContent=shareCss(PREVIEW_FONT);
  document.head.appendChild(st);
}
function paint(){
  const stage=$('share-stage'); if(!stage||!src) return;
  const top=stage.scrollTop;
  stage.innerHTML=shareHtml(shareModel(src.d, ctx()), {controls:true});
  fitStage(); stage.scrollTop=top;
}
/* 좁은 창에서는 미리 보기만 줄여 보인다(가로 스크롤 금지 — 디자인 정책 §0). 나가는 그림의 폭은 그대로 */
function fitStage(){
  const stage=$('share-stage'), w=stage && stage.querySelector('.shw'); if(!w) return;
  const z=Math.min(1, (stage.clientWidth||SHARE_W)/SHARE_W);
  w.style.zoom = z<1 ? String(z) : '';
}

/* ── 그림 ─────────────────────────────────────────────────────────────── */
function fontData(){
  if(!fontP) fontP=fetch('fonts/PretendardVariable.woff2').then(r=>{ if(!r.ok) throw new Error('글꼴 '+r.status); return r.blob(); })
    .then(b=>new Promise((res,rej)=>{ const fr=new FileReader(); fr.onload=()=>res(String(fr.result)); fr.onerror=()=>rej(fr.error); fr.readAsDataURL(b); }))
    .catch(e=>{ logWarn('share-font', e); fontP=null; return ''; });     // 글꼴을 못 품으면 맑은 고딕으로라도 찍는다(다음에 다시 시도)
  return fontP;
}
/* 같은 마크업을 화면 밖에 놓고 높이를 잰다(문서의 Pretendard — 그림에 품는 것과 같은 파일) */
async function measure(html){
  try{ if(document.fonts && document.fonts.load) await document.fonts.load("13px 'Pretendard'"); }catch{}
  const box=document.createElement('div');
  box.style.cssText='position:fixed;left:-20000px;top:0;visibility:hidden;pointer-events:none;contain:layout';
  box.innerHTML=html; document.body.appendChild(box);
  const h=Math.ceil(box.firstElementChild.getBoundingClientRect().height);
  box.remove();
  return Math.max(1,h);
}
/* 글꼴을 품은 <style> 은 2.7MB 라 주소 꼴로 바꾸는 값이 크다 — 한 번만 바꿔 둔다 */
let styleEnc=null;
function encodedStyle(font){
  if(styleEnc && styleEnc.font===font) return styleEnc.enc;
  const css=(font?`@font-face{font-family:'WMHShareFont';src:url(${font}) format('woff2');font-weight:45 920;font-style:normal}`:'')+shareCss(font?IMAGE_FONT:PREVIEW_FONT);
  styleEnc={font, enc:encodeURIComponent(`<style><![CDATA[${css}]]></style>`)};
  return styleEnc.enc;
}
async function makePng(){
  const html=shareHtml(shareModel(src.d, ctx()), {controls:false});
  const [font, h]=await Promise.all([fontData(), measure(html)]);
  const head=`<svg xmlns="http://www.w3.org/2000/svg" width="${SHARE_W}" height="${h}"><foreignObject x="0" y="0" width="${SHARE_W}" height="${h}">`
    +`<div xmlns="http://www.w3.org/1999/xhtml">`;
  const img=new Image();
  img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(head)+encodedStyle(font)+encodeURIComponent(`${html}</div></foreignObject></svg>`);
  await img.decode();
  const k=Math.min(SCALE, MAX_PX/h);
  const c=document.createElement('canvas'); c.width=Math.round(SHARE_W*k); c.height=Math.round(h*k);
  const g=c.getContext('2d'); g.scale(k,k); g.drawImage(img,0,0,SHARE_W,h);
  const blob=await new Promise((res,rej)=>c.toBlob(b=>b?res(b):rej(new Error('그림을 만들지 못했습니다')),'image/png'));
  return blob;
}
/* 지금 상태(펼침·연락처 스위치)의 그림 — 만들어 둔 것이 있으면 그것을 */
function currentPng(){
  const s=sig(), g=gen;
  if(png && png.sig===s) return Promise.resolve(png.blob);
  if(pending && pending.sig===s) return pending.p;
  const p=makePng();
  pending={sig:s, p};
  p.then(b=>{ if(g===gen && sig()===s) png={sig:s, blob:b}; }, e=>logWarn('share-png', e))
   .finally(()=>{ if(pending && pending.p===p) pending=null; });
  return p;
}
/* 미리 만들어 둔다 — [그림 복사]를 누른 그 자리에서 클립보드에 바로 넣을 수 있게(누른 뒤 만들면 오래된 웹뷰에서 클립보드가 거절될 수 있다) */
function schedulePng(ms){ clearTimeout(pngTimer); pngTimer=setTimeout(()=>{ if(src) currentPng().catch(()=>{}); }, ms); }

/* ── 세 동작 ──────────────────────────────────────────────────────────── */
async function copyImage(){
  const cb=navigator.clipboard;
  if(!cb || typeof cb.write!=='function' || typeof window.ClipboardItem!=='function'){ await appAlert(NO_CLIP); return; }
  const s=sig();
  const data=(png && png.sig===s) ? png.blob : currentPng();
  try{
    await cb.write([new window.ClipboardItem({'image/png': data})]);
    showToast('메모지 그림을 복사했습니다 · 붙여 넣으세요');
  }catch(e){
    logWarn('share-copy-image', e);
    await appAlert(NO_CLIP+'\n\n('+(e&&e.message||e)+')');
  }
}
async function copyTextNow(){
  const t=shareText(src.d, ctx());
  let ok=false;
  try{ if(navigator.clipboard && navigator.clipboard.writeText){ await navigator.clipboard.writeText(t); ok=true; } }catch(e){ logWarn('share-copy-text', e); }
  if(!ok){
    const ta=document.createElement('textarea'); ta.value=t; ta.setAttribute('readonly','');
    ta.style.cssText='position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta); ta.select();
    try{ ok=!!document.execCommand('copy'); }catch{}
    ta.remove();
  }
  if(ok) showToast('글자로 복사했습니다');
  else await appAlert('글자를 클립보드에 넣지 못했습니다.');
}
async function saveFile(){
  let blob;
  try{ blob=await currentPng(); }catch(e){ await appAlert('그림을 만들지 못했습니다: '+(e&&e.message||e)); return; }
  const bytes=Array.from(new Uint8Array(await blob.arrayBuffer()));
  try{
    const saved=await invoke('save_binary_file', {suggestedName:shareFileName(now), data:bytes});
    if(saved) showToast('그림 파일을 저장했습니다');
  }catch(e){ await appAlert('그림 저장 실패: '+e); }
}

export function initShare(){
  const m=$('shareModal'); if(!m) return;
  document.body.appendChild(m);                                   // 양식 위에서도 뜨도록 body 직속
  m.addEventListener('click', e=>{ if(e.target===m) closeShare(); });   // 배경 클릭 = 닫기
  $('share-stage').addEventListener('click', e=>{
    const b=e.target.closest('.sh-fold'); if(!b) return;
    const k=b.dataset.fold; open.has(k)?open.delete(k):open.add(k);
    paint(); schedulePng(150);
  });
  $('share-contacts').addEventListener('change', e=>{ withContacts=!!e.target.checked; paint(); schedulePng(150); });
  $('share-img').addEventListener('click', copyImage);
  $('share-text').addEventListener('click', copyTextNow);
  $('share-save').addEventListener('click', saveFile);
  window.addEventListener('resize', ()=>{ if(m.classList.contains('on')) fitStage(); });
}

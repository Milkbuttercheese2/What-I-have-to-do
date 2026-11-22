/* v3.8.0 문서 탭 — 미리보기 변환(HWPX·PPTX·XLSX) · 트리·메모 배선 · 오른쪽 업무 메모.
   핵심 불변식: (1) 화면은 상대 경로만 넘기고 파일을 쓰는 명령은 부르지 않는다. (2) 오른쪽 메모는 보드와 같은 업무 데이터다(따로 저장하지 않는다). */
import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {setupEnv} from '../helpers/env.js';

mock.timers.enable({apis:['setTimeout','setInterval']});
const env = setupEnv();
const require = createRequire(import.meta.url);
const XLSX = require('../../src/vendor/xlsx.full.min.js');
env.window.XLSX = XLSX; globalThis.XLSX = XLSX;
if(!globalThis.DOMParser) globalThis.DOMParser = env.window.DOMParser;
const {S} = await import('../../src/state.js');
const {docKind, openLabel, unzip, hwpxHtml, pptxHtml, xlsxBook, _setRhwpLoader} = await import('../../src/docs-view.js');
const {initDocs, renderDocs, docTarget, dropOk, resolveRel} = await import('../../src/docs.js');
const {showView} = await import('../../src/views.js');
initDocs(); (await import('../../src/dom-utils.js')).initToast();

const $ = id => env.document.getElementById(id);
const doc = env.document;
const click = el => el.dispatchEvent(new env.window.MouseEvent('click', {bubbles:true, cancelable:true}));
const zip = files => { const z=XLSX.CFB.utils.cfb_new(); for(const [p,s] of Object.entries(files)) XLSX.CFB.utils.cfb_add(z, p, Buffer.from(s,'utf8')); return new Uint8Array(XLSX.CFB.write(z,{fileType:'zip', type:'array'})); };
const HP = 'xmlns:hp="urn:hp" xmlns:hs="urn:hs"';
const p = t => `<hp:p><hp:run><hp:t>${t}</hp:t></hp:run></hp:p>`;
const cell = t => `<hp:tc><hp:subList>${p(t)}</hp:subList></hp:tc>`;

test('docKind · openLabel: 확장자별 종류와 열기 단추 이름', () => {
  assert.deepEqual(['a.HWPX','b.hwp','c.pptx','d.xlsx','e.csv','f.pdf','g.PNG','h.md','i.txt','j.json','k.mp4','l.docx','m.zip','n.html','o.7z','noext'].map(docKind),
    ['hwpx','hwp','pptx','xlsx','csv','pdf','img','md','text','text','media','docx','zip','html','other','other']);
  assert.deepEqual(['hwpx','xlsx','pptx','docx','other'].map(openLabel), ['한글에서 열기','엑셀에서 열기','파워포인트에서 열기','워드에서 열기','열기']);
});

test('HWPX: 섹션 순서대로 문단 글자 + 표(표 안 글자는 표에만) · 빈 문단은 하나로 · 글자는 이스케이프', () => {
  const files = unzip(zip({
    'Contents/section1.xml': `<hs:sec ${HP}>${p('둘째 섹션')}</hs:sec>`,
    'Contents/section0.xml': `<hs:sec ${HP}>${p('제목 &lt;b&gt;')}${p('')}${p('')}<hp:p><hp:run><hp:tbl><hp:tr>${cell('가')}${cell('나')}</hp:tr></hp:tbl></hp:run></hp:p>${p('끝')}</hs:sec>`,
  }));
  const html = hwpxHtml(files);
  const box = doc.createElement('div'); box.innerHTML = html;
  assert.deepEqual([...box.querySelectorAll('section > p:not(.dv-blank)')].map(x=>x.textContent), ['제목 <b>', '끝', '둘째 섹션']);
  assert.equal(box.querySelectorAll('.dv-blank').length, 1);
  assert.deepEqual([...box.querySelectorAll('td')].map(x=>x.textContent), ['가','나']);
  assert.ok(!box.querySelector('b'), '문서 글자는 태그로 해석되지 않는다');
  assert.throws(()=>hwpxHtml(unzip(zip({'x.xml':'<a/>'}))), /HWPX/);
});

test('PPTX: 슬라이드 번호 순서(1, 2, 10) · 슬라이드마다 글자', () => {
  const A='xmlns:a="urn:a" xmlns:p="urn:p"';
  const s = t => `<p:sld ${A}><p:txBody><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:txBody></p:sld>`;
  const box = doc.createElement('div');
  box.innerHTML = pptxHtml(unzip(zip({'ppt/slides/slide10.xml':s('열'), 'ppt/slides/slide2.xml':s('둘'), 'ppt/slides/slide1.xml':s('하나')})));
  assert.deepEqual([...box.querySelectorAll('.dv-slide')].map(x=>x.querySelector('p').textContent), ['하나','둘','열']);
});

test('XLSX: 시트 이름 · 표 · 시트 전환', () => {
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['품목','수량'],['노트북',12]]), '목록');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), '빈');
  const b = xlsxBook(new Uint8Array(XLSX.write(wb,{type:'array', bookType:'xlsx'})));
  assert.deepEqual(b.names, ['목록','빈']);
  const box = doc.createElement('div'); box.innerHTML = b.html(0);
  assert.deepEqual([...box.querySelectorAll('tr')].map(r=>[...r.children].map(c=>c.textContent)), [['1','품목','수량'],['2','노트북','12']]);
  assert.match(b.html(1), /빈 시트/);
});

const mk = o => Object.assign({id:Math.floor(Math.random()*1e9), memo:'', owner:'', done:false, doneAt:null, staged:false, f:{}, contacts:[], ids:[], subs:[], files:[], al:{}, recur:null, recurId:null}, o);
/* 가짜 Rust: lists() = {'번호:상대경로': 항목들} */
function fakeFs(lists, opts={}){
  env.onInvoke('doc_set_roots', a=>a.paths.map(p=>({ok:!(opts.bad||[]).includes(p), path:p, error:(opts.bad||[]).includes(p)?'폴더가 없습니다':''})));
  env.onInvoke('doc_list', a=>{ const v=lists()[`${a.root}:${a.rel}`]; if(v===undefined) throw '없음'; return v; });
  env.onInvoke('doc_abs', a=>`${S.settings.docRoots[a.root]}\\${a.rel.replace(/\//g,'\\')}`);
  env.onInvoke('doc_preview_open', ()=>false);
  env.onInvoke('doc_preview_close', ()=>null);
}
const openDocs = async () => { doc.querySelectorAll('.tab').forEach(t=>t.classList.toggle('on', t.dataset.view==='docs')); showView('docs'); await env.flush(8); };
const row = key => doc.querySelector(`#dt-tree [data-dkey="${key}"]`);
const memos = () => [...doc.querySelectorAll('#dn-list .card .card-memo')].map(x=>x.textContent);
const typeIn = (el, v) => { el.value=v; el.dispatchEvent(new env.window.Event('input',{bubbles:true})); };

test('경로 규칙: docTarget(링크 → 몇 번 폴더의 어디) · dropOk(같은 폴더 안만) · resolveRel(밖으로 못 나감)', async () => {
  await env.resetS(); S.loaded = true;
  S.settings.docRoots=['D:\\공유', '\\\\srv\\팀'];
  assert.deepEqual(docTarget('d:/공유/가 폴더/표.xlsx'), {i:0, rel:'가 폴더/표.xlsx'});
  assert.deepEqual(docTarget('D:\\공유'), {i:0, rel:''});
  assert.deepEqual(docTarget('\\\\SRV\\팀\\회의\\'), {i:1, rel:'회의'});
  assert.equal(docTarget('D:\\공유2\\x'), null, '이름이 같게 시작하는 다른 폴더는 아니다');
  assert.equal(docTarget('C:\\다른\\x'), null);
  assert.ok(dropOk('0:a/b.txt', '0:c'));
  assert.ok(!dropOk('0:a/b.txt', '1:c'), '다른 문서 폴더로는 옮기지 않는다');
  assert.ok(!dropOk('0:a', '0:a/b'), '자기 안으로는 못 옮긴다');
  assert.ok(!dropOk('0:a/b.txt', '0:a'), '이미 그 폴더');
  assert.equal(resolveRel('가/나', '../그림/x.png'), '가/그림/x.png');
  assert.equal(resolveRel('', '../x'), null);
  assert.equal(resolveRel('가', 'C:/x'), null);
});

test('여러 폴더: 옛 docRoot 를 첫 폴더로 옮김 · 폴더마다 트리 · 없는 폴더는 그 자리에 오류 · [×]로 목록에서 빼기', async () => {
  await env.resetS(); S.loaded = true;
  S.settings.docRoot='D:\\하나'; S.settings.docOpen=['가']; S.settings.docLast='가/a.zip';
  fakeFs(()=>({'0:':[{name:'가',rel:'가',dir:true,size:0,mtime:1}], '0:가':[{name:'a.zip',rel:'가/a.zip',dir:false,size:3,mtime:1}], '2:':[]}), {bad:['E:\\없음']});
  env.onInvoke('doc_read_text', ()=>{ throw '글자 파일이 아닙니다'; });
  await openDocs();
  assert.deepEqual(S.settings.docRoots, ['D:\\하나']);
  assert.equal(S.settings.docRoot, undefined);
  assert.ok(S.settings.docOpen.includes('0:가'), '옛 펼침 열쇠도 0번 폴더로');
  assert.ok(row('0:가/a.zip').classList.contains('on'), '옛 마지막 파일도 0번 폴더로');
  S.settings.docRoots.push('E:\\없음', 'F:\\셋');
  await renderDocs(); await env.flush(8);
  assert.equal(doc.querySelectorAll('#dt-tree .dt-root').length, 3);
  assert.match(doc.querySelector('#dt-tree').textContent, /폴더가 없습니다/);
  env.answerConfirm(true);
  click(doc.querySelector('#dt-tree [data-unroot="1"]')); await env.flush(8);
  assert.deepEqual(S.settings.docRoots, ['D:\\하나', 'F:\\셋']);
  assert.equal(doc.querySelectorAll('#dt-tree .dt-root').length, 2);
  assert.ok(row('0:가/a.zip'), '앞 폴더의 펼침은 그대로');
  assert.ok(env.invokeCalls.filter(c=>c.cmd==='doc_list').every(c=>Number.isInteger(c.args.root) && !/^[A-Za-z]:|^\//.test(c.args.rel)), '폴더 번호 + 상대 경로만 넘긴다');
});

test('▸ 는 접기·펼치기만(고른 것 유지) · 폴더 줄을 누르면 펼치고 고른다', async () => {
  await env.resetS(); S.loaded = true;
  S.settings.docRoots=['G:\\접기'];
  fakeFs(()=>({'0:':[{name:'가',rel:'가',dir:true,size:0,mtime:1}], '0:가':[{name:'b.txt',rel:'가/b.txt',dir:false,size:1,mtime:1}]}));
  await openDocs();
  assert.ok(row('0:가'), '처음 보는 폴더는 펼친 채');
  click(row('0:가').querySelector('.dt-caret')); await env.flush(6);
  assert.ok(row('0:가/b.txt'), '▸ 로 펼침');
  assert.ok(!row('0:가').classList.contains('on'), '▸ 는 고르지 않는다');
  click(row('0:가').querySelector('.dt-caret')); await env.flush(6);
  assert.ok(!row('0:가/b.txt'), '다시 누르면 접힘');
  click(row('0:가').querySelector('.dt-name')); await env.flush(6);
  assert.ok(row('0:가').classList.contains('on') && row('0:가/b.txt'));
});

test('문서 탭: 폴더 미지정 → 안내 · 지정되면 트리 · XLSX(처리기 없음) → 표 대체본 · 오른쪽 = 그 폴더의 업무 메모', async () => {
  await env.resetS(); S.loaded = true;
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['값',1]]), 'S');
  const xbytes=new Uint8Array(XLSX.write(wb,{type:'array', bookType:'xlsx'}));
  fakeFs(()=>({'0:':[{name:'가 폴더',rel:'가 폴더',dir:true,size:0,mtime:1}], '0:가 폴더':[{name:'표.xlsx',rel:'가 폴더/표.xlsx',dir:false,size:10,mtime:2}]}));
  env.onInvoke('doc_read', ()=>xbytes.buffer);
  await openDocs();
  assert.ok(!$('view-docs').classList.contains('has-root'), '미지정이면 안내만');
  S.settings.docRoots=['D:\\공유'];
  S.items.push(
    mk({memo:'폴더에 링크한 업무', files:['d:/공유/가 폴더/']}),
    mk({memo:'폴더 안 파일에 링크한 종료 업무', files:['D:\\공유\\가 폴더\\표.xlsx'], done:true, doneAt:5}),
    mk({memo:'다른 폴더 업무', files:['D:\\공유\\나 폴더\\x.hwpx']}),
    mk({memo:'더 깊은 곳 업무', files:['D:\\공유\\가 폴더\\안\\y.hwpx']}),
  );
  await renderDocs(); await env.flush(6);
  assert.ok($('view-docs').classList.contains('has-root'));
  click(row('0:가 폴더')); await env.flush(6);
  assert.ok(S.settings.docOpen.includes('0:가 폴더'), '펼친 폴더를 기억');
  assert.deepEqual(memos(), ['폴더에 링크한 업무', '폴더 안 파일에 링크한 종료 업무']);
  assert.equal($('dn-count').textContent, '2');
  click(row('0:가 폴더/표.xlsx')); await env.flush(10);
  assert.ok(env.invokeCalls.some(c=>c.cmd==='doc_preview_open' && c.args.root===0 && c.args.rel==='가 폴더/표.xlsx'), '먼저 탐색기 미리 보기를 시도');
  assert.match($('dv-body').textContent, /값/, '처리기가 없으면 표 대체본');
  assert.equal($('dv-body').querySelector('[data-dopen]').textContent, '엑셀에서 열기');
  assert.equal(S.settings.docLast, '0:가 폴더/표.xlsx');
  assert.equal($('dn-title').textContent, '가 폴더');
  click(row('0:')); await env.flush(6);
  assert.deepEqual(memos(), [], '폴더 바로 안만 — 깊은 곳 업무는 그 폴더에서');
});

test('v3.8.5 한글(HWP·HWPX)은 늘 앱이 읽어 보여 준다 — 한컴 탐색기 미리 보기 처리기가 있어도 부르지 않는다 · rhwp 가 실패하면 글자·표 보기', async () => {
  await env.resetS(); S.loaded = true;
  _setRhwpLoader(()=>Promise.reject(new Error('rhwp 없음')));
  S.settings.docRoots=['H:\\한글'];
  fakeFs(()=>({'0:':[{name:'a.hwpx',rel:'a.hwpx',dir:false,size:1,mtime:1}]}));
  const bytes=zip({'Contents/section0.xml': `<hs:sec ${HP}>${p('한글 본문')}</hs:sec>`});
  env.onInvoke('doc_read', ()=>bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset+bytes.byteLength));
  env.onInvoke('doc_preview_open', ()=>true);       // 처리기가 '있다'고 답하는 PC(한컴 2022 등)
  await openDocs();
  const n0=env.invokeCalls.filter(c=>c.cmd==='doc_preview_open').length;
  click(row('0:a.hwpx')); await env.flush(12);
  assert.equal(env.invokeCalls.filter(c=>c.cmd==='doc_preview_open').length, n0, '탐색기 미리 보기를 부르지 않는다');
  assert.match($('dv-body').textContent, /한글 본문/);
  assert.ok($('dv-body').querySelector('[data-dopen]'), '[한글에서 열기] 는 그대로');
});

test('v3.8.7 한글은 rhwp 로 쪽 모양 그대로 — 쪽마다 <img>(SVG 는 화면에 직접 넣지 않음) · 다른 파일로 가면 정리(free)', async () => {
  await env.resetS(); S.loaded = true;
  S.settings.docRoots=['R:\\rhwp'];
  fakeFs(()=>({'0:':[{name:'r.hwpx',rel:'r.hwpx',dir:false,size:1,mtime:1},{name:'b.txt',rel:'b.txt',dir:false,size:1,mtime:1}]}));
  env.onInvoke('doc_read', ()=>new Uint8Array([9,9]).buffer);
  env.onInvoke('doc_read_text', ()=>({text:'글', encoding:'utf-8', mtime:1}));
  const W=env.window.URL; let made=0, revoked=0;
  const keep={c:W.createObjectURL, r:W.revokeObjectURL, gc:globalThis.URL.createObjectURL, gr:globalThis.URL.revokeObjectURL};
  W.createObjectURL=globalThis.URL.createObjectURL=()=>`blob:pg${++made}`; W.revokeObjectURL=globalThis.URL.revokeObjectURL=()=>{ revoked++; };
  let freed=0, got=null;
  class HwpDocument{ constructor(b){ got=b; } pageCount(){ return 3; } renderPageSvg(i){ return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 140"><text x="10" y="20" font-size="10">${i+1}</text><script>alert(1)</script></svg>`; } free(){ freed++; } }
  _setRhwpLoader(()=>Promise.resolve({HwpDocument}));
  try{
    await openDocs();
    click(row('0:r.hwpx')); await env.flush(12);
    for(let k=0;k<4;k++){ mock.timers.tick(1); await env.flush(3); }
    assert.deepEqual([...got], [9,9], '파일 바이트를 그대로 넘긴다');
    const imgs=[...$('dv-body').querySelectorAll('.dv-hwp-pg > img')];
    assert.equal(imgs.length, 3, '쪽마다 그림 하나');
    assert.match(imgs[0].getAttribute('src'), /^blob:/);
    assert.ok(!$('dv-body').querySelector('.dv-hwp svg'), 'SVG 를 화면에 직접 넣지 않는다');
    assert.ok(!$('dv-body').querySelector('script'), '문서의 스크립트는 화면에 들어오지 않는다');
    const tls=[...$('dv-body').querySelectorAll('.dv-hwp-tl')];
    assert.equal(tls.length, 3, '쪽마다 투명 글자 층');
    assert.equal(tls[1].textContent, '2', '글자는 글자로만(textContent)');
    assert.match($('dv-body').textContent, /3쪽/);
    click(row('0:b.txt')); await env.flush(12);
    assert.equal(freed, 1, '다른 파일로 가면 문서를 놓아 준다');
    assert.equal(revoked, 3, '쪽 그림 주소도 놓아 준다');
  } finally {
    W.createObjectURL=keep.c; W.revokeObjectURL=keep.r; globalThis.URL.createObjectURL=keep.gc; globalThis.URL.revokeObjectURL=keep.gr;
    _setRhwpLoader(()=>Promise.reject(new Error('rhwp 없음')));
  }
});

test('탐색기 미리 보기: 처리기가 있으면 자리(물리 px)를 넘겨 띄우고, 다른 파일로 가면 앞 창을 닫는다', async () => {
  await env.resetS(); S.loaded = true;
  S.settings.docRoots=['H:\\오피스'];
  fakeFs(()=>({'0:':[{name:'a.xlsx',rel:'a.xlsx',dir:false,size:1,mtime:1},{name:'b.docx',rel:'b.docx',dir:false,size:1,mtime:1}]}));
  env.onInvoke('doc_preview_open', ()=>true);
  env.onInvoke('doc_preview_show', ()=>null);
  env.onInvoke('doc_preview_place', ()=>null);
  await openDocs();
  click(row('0:a.xlsx')); await env.flush(10);
  const call=env.invokeCalls.filter(c=>c.cmd==='doc_preview_open').at(-1).args;
  assert.deepEqual(Object.keys(call).sort(), ['h','rel','root','w','x','y']);
  assert.ok($('dv-native'), '자리표시');
  const shows=()=>env.invokeCalls.filter(c=>c.cmd==='doc_preview_show').map(c=>c.args.on);
  const tick=async()=>{ await env.flush(3); mock.timers.tick(20); await env.flush(6); };
  const m=doc.createElement('div'); m.className='modal-bg'; doc.body.appendChild(m);
  m.classList.add('on'); await tick();
  assert.equal(shows().at(-1), false, '팝업이 뜨면 숨긴다(웹뷰 위에 뜬 별도 창이라 팝업을 가린다)');
  m.classList.remove('on'); await tick();
  assert.equal(shows().at(-1), true, '팝업이 닫히면 다시 보인다');
  m.remove();
  showView('board'); await tick();
  assert.equal(shows().at(-1), false, '다른 탭에선 숨긴다');
  showView('docs'); await tick();
  assert.equal(shows().at(-1), true);
  const n0=env.invokeCalls.filter(c=>c.cmd==='doc_preview_close').length;
  click(row('0:b.docx')); await env.flush(10);
  assert.ok(env.invokeCalls.filter(c=>c.cmd==='doc_preview_close').length>n0, '다른 파일로 가면 앞 창을 닫는다');
});

/* 글자를 칠 때마다 저장 표시('고치는 중')를 같은 글자로 다시 쓰면 그때마다 화면 전체의 스타일을 다시 계산한다 —
   파일이 많은 폴더를 펼쳐 둔 채 쓰면 그만큼 입력이 느려졌다(Edge 실측: 2만 줄 트리에서 글자 190개에 스타일 계산 1.5초).
   표시가 바뀔 때만 쓴다. */
test('글자 파일: 고치는 동안 저장 표시는 바뀔 때만 다시 쓴다', async () => {
  await env.resetS(); S.loaded = true;
  S.settings.docRoots=['T:\\표시'];
  fakeFs(()=>({'0:':[{name:'표시.txt',rel:'표시.txt',dir:false,size:6,mtime:100}]}));
  env.onInvoke('doc_read_text', ()=>({text:'첫 줄', encoding:'utf-8', mtime:100}));
  env.onInvoke('doc_write_text', a=>a.baseMtime+1);
  await openDocs();
  click(row('0:표시.txt')); await env.flush(10);
  let writes=0;
  const mo=new env.window.MutationObserver(l=>{ writes+=l.length; });
  mo.observe($('dv-save'), {childList:true, characterData:true, subtree:true});
  for(const v of ['첫 줄a','첫 줄ab','첫 줄abc','첫 줄abcd']) typeIn($('dv-ta'), v);
  await env.flush(2);
  mo.disconnect();
  assert.match($('dv-save').textContent, /고치는 중/);
  assert.ok(writes<=2, `글자 네 번에 표시를 ${writes}번 다시 썼다(한 번이면 충분)`);
  mock.timers.tick(1300); await env.flush(8);
});

test('글자 파일: 보는 즉시 고침 → 잠깐 쉬면 원래 인코딩·고친 시각과 함께 저장 · 충돌이면 알리고 글자는 그대로', async () => {
  await env.resetS(); S.loaded = true;
  S.settings.docRoots=['T:\\글'];
  fakeFs(()=>({'0:':[{name:'메모.txt',rel:'메모.txt',dir:false,size:6,mtime:100},{name:'b.txt',rel:'b.txt',dir:false,size:1,mtime:1}]}));
  env.onInvoke('doc_read_text', a=>({text:a.rel==='메모.txt'?'첫 줄':'b', encoding:'cp949', mtime:100}));
  const writes=[]; let fail=false;
  env.onInvoke('doc_write_text', a=>{ writes.push(a); if(fail) throw '다른 프로그램이 이 파일을 고쳤습니다. 다시 열어 주세요'; return a.baseMtime+1; });
  await openDocs();
  click(row('0:메모.txt')); await env.flush(10);
  assert.equal($('dv-ta').value, '첫 줄');
  assert.match($('dv-save').textContent, /EUC-KR/);
  typeIn($('dv-ta'), '첫 줄\n둘째 줄');
  assert.match($('dv-save').textContent, /고치는 중/);
  mock.timers.tick(1300); await env.flush(8);
  assert.equal(writes.length, 1);
  const w=writes[0];
  assert.deepEqual({root:w.root, rel:w.rel, text:w.text, encoding:w.encoding, baseMtime:w.baseMtime}, {root:0, rel:'메모.txt', text:'첫 줄\n둘째 줄', encoding:'cp949', baseMtime:100});
  assert.match($('dv-save').textContent, /저장됨/);
  /* 그새 다른 프로그램이 고쳤으면: 내 고침은 '(내 고침)' 새 파일로, 원래 파일은 다시 연다 — 알림은 한 번 */
  const created=[]; env.onInvoke('doc_create', a=>{ created.push(a); return `${a.dir?a.dir+'/':''}${a.name}`; });
  typeIn($('dv-ta'), '셋');
  fail=true; env.alerts.length=0;
  env.onInvoke('doc_write_text', a=>{ writes.push(a); if(a.rel==='메모.txt') throw '다른 프로그램이 이 파일을 고쳤습니다. 다시 열어 주세요'; return 9; });
  mock.timers.tick(1300); await env.flush(20);
  assert.equal(writes[1].baseMtime, 101, '두 번째 저장은 새 고친 시각으로');
  assert.equal(created[0].name, '메모 (내 고침).txt');
  assert.deepEqual([writes.at(-1).rel, writes.at(-1).text, writes.at(-1).encoding], ['메모 (내 고침).txt', '셋', 'cp949'], '내 고침은 같은 인코딩으로 새 파일에');
  assert.equal(env.alerts.filter(a=>/내 고침/.test(a)).length, 1, '알림은 한 번');
  assert.equal($('dv-ta').value, '첫 줄', '원래 파일을 다시 읽었다');
  const n=writes.length;
  click(row('0:b.txt')); await env.flush(10);
  assert.equal(writes.length, n, '떠날 때 다시 저장을 시도하지 않는다(충돌 고리 없음)');
  assert.equal($('dv-ta').value, 'b');
});

test('글자 파일: CRLF 로 된 파일은 저장할 때도 CRLF', async () => {
  await env.resetS(); S.loaded = true;
  S.settings.docRoots=['W:\\줄'];
  fakeFs(()=>({'0:':[{name:'w.txt',rel:'w.txt',dir:false,size:1,mtime:1}]}));
  env.onInvoke('doc_read_text', ()=>({text:'가\r\n나\r\n', encoding:'utf-8', mtime:1}));
  const writes=[]; env.onInvoke('doc_write_text', a=>{ writes.push(a); return 2; });
  await openDocs();
  click(row('0:w.txt')); await env.flush(10);
  typeIn($('dv-ta'), '가\n나\n다');
  mock.timers.tick(1300); await env.flush(8);
  assert.equal(writes[0].text, '가\r\n나\r\n다');
});

test('MD: [보기|편집] — 보기는 안전한 HTML(스크립트 제거)이고 고른 쪽을 기억 · CSV: [표|편집]', async () => {
  await env.resetS(); S.loaded = true;
  S.settings.docRoots=['M:\\마크'];
  fakeFs(()=>({'0:':[{name:'r.md',rel:'r.md',dir:false,size:1,mtime:1},{name:'t.csv',rel:'t.csv',dir:false,size:1,mtime:1}]}));
  env.onInvoke('doc_read_text', a=>a.rel==='r.md' ? {text:'# 제목\n\n**굵게** <script>alert(1)</script><img src="x.png" onerror="alert(1)">', encoding:'utf-8', mtime:1} : {text:'이름,수량\n펜,3', encoding:'utf-8', mtime:1});
  env.onInvoke('doc_read', ()=>{ throw '없음'; });
  await openDocs();
  click(row('0:r.md')); await env.flush(40);
  const v=$('dv-md');
  assert.equal(v.querySelector('h1').textContent, '제목');
  assert.equal(v.querySelector('strong').textContent, '굵게');
  assert.ok(!v.querySelector('script') && !v.innerHTML.includes('onerror'), '스크립트·이벤트 속성 제거');
  assert.equal($('dv-code').style.display, 'none');
  click(doc.querySelector('[data-tmode="edit"]')); await env.flush(6);
  assert.equal(S.settings.docMdMode, 'edit');
  assert.equal($('dv-code').style.display, '');
  click(row('0:t.csv')); await env.flush(10);
  assert.deepEqual([...$('dv-md').querySelectorAll('tr')].map(r=>[...r.children].map(c=>c.textContent).slice(1)), [['이름','수량'],['펜','3']]);
});

test('Ctrl+S: 문서 탭에서 고친 글자가 있으면 그 파일을 저장(백업이 아니라)', async () => {
  await env.resetS(); S.loaded = true;
  S.settings.docRoots=['K:\\키'];
  fakeFs(()=>({'0:':[{name:'k.txt',rel:'k.txt',dir:false,size:1,mtime:5}]}));
  env.onInvoke('doc_read_text', ()=>({text:'a', encoding:'utf-8', mtime:5}));
  const writes=[]; env.onInvoke('doc_write_text', a=>{ writes.push(a); return 6; });
  await openDocs();
  click(row('0:k.txt')); await env.flush(10);
  typeIn($('dv-ta'), 'ab');
  const ev=new env.window.KeyboardEvent('keydown',{key:'s', ctrlKey:true, bubbles:true, cancelable:true});
  doc.dispatchEvent(ev); await env.flush(6);
  assert.ok(ev.defaultPrevented);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].text, 'ab');
});

test('[＋ 메모] = 그 폴더 링크가 든 새 양식 · 저장하면 오른쪽 칸에 · 양식 파일 링크의 [문서] → 문서 탭에서 그 파일', async () => {
  const {initForm, closeForm, openForm} = await import('../../src/form.js');
  const {initRender} = await import('../../src/render.js');
  const {isOpen} = await import('../../src/modals.js');
  initForm(); initRender();
  await env.resetS(); S.loaded = true; S.settings.formDrafts={};
  S.settings.docRoots=['D:\\공유'];
  fakeFs(()=>({'0:':[{name:'가 폴더',rel:'가 폴더',dir:true,size:0,mtime:1}], '0:가 폴더':[{name:'보고.zip',rel:'가 폴더/보고.zip',dir:false,size:1,mtime:1}]}));
  env.onInvoke('doc_read_text', ()=>{ throw '글자 파일이 아닙니다'; });
  await openDocs();
  click(row('0:가 폴더')); await env.flush(6);
  /* v3.8.4: 문서 탭에서는 같은 양식이 팝업이 아니라 오른쪽 칸(fm-dock)으로 열린다 — 세부·마감·관련인 등 모든 칸 그대로 */
  env.window.innerWidth=1500;
  click($('dn-add')); await env.flush(6);
  assert.ok(isOpen('formPanel') && $('formPanel').classList.contains('fm-dock'), '옆 칸 양식');
  assert.equal(doc.querySelector('#fm-files .ffile-path').value, 'D:\\공유\\가 폴더', '그 폴더 링크가 들어 있다');
  assert.ok($('fm-subadd') && $('fm-contactadd') && $('fm-grid'), '양식의 칸이 모두 있다');
  $('fm-memo').value='회신 기한 11.28';
  click($('fm-save')); await env.flush(6);
  assert.ok(!$('formPanel').classList.contains('fm-dock'), '닫히면 옆 칸 표시도 풀린다');
  assert.equal(S.items.length, 1);
  assert.deepEqual(S.items[0].files, ['D:\\공유\\가 폴더']);
  assert.deepEqual(memos(), ['회신 기한 11.28']);
  /* 오른쪽 칸의 카드를 눌러도 옆 칸 양식 — 끝난 업무는 읽기 전용 */
  click(doc.querySelector('#dn-list .card .card-memo')); await env.flush(4);
  assert.ok(isOpen('formPanel') && $('formPanel').classList.contains('fm-dock'));
  assert.equal($('fm-memo').value, '회신 기한 11.28');
  /* 옆 칸 양식을 연 채 다른 탭으로 가면 평소 팝업으로 바뀐다(쓰던 글은 그대로) */
  $('fm-memo').value='고치는 중';
  click(doc.querySelector('.tab[data-view="board"]')); await env.flush(4);
  assert.ok(isOpen('formPanel') && !$('formPanel').classList.contains('fm-dock'));
  assert.equal($('fm-memo').value, '고치는 중');
  closeForm();
  doc.querySelectorAll('.tab').forEach(t=>t.classList.toggle('on', t.dataset.view==='docs')); showView('docs'); await env.flush(6);
  /* 다른 곳(보드 등)에서 여는 양식은 평소처럼 팝업 */
  openForm(S.items[0]); await env.flush(4);
  assert.ok(isOpen('formPanel') && !$('formPanel').classList.contains('fm-dock'));
  closeForm();
  /* 창이 좁으면 문서 탭에서도 팝업 */
  env.window.innerWidth=700;
  click($('dn-add')); await env.flush(4);
  assert.ok(isOpen('formPanel') && !$('formPanel').classList.contains('fm-dock'));
  closeForm(); env.window.innerWidth=1500;
  openForm({files:['D:\\공유\\가 폴더\\보고.zip', 'C:\\밖\\x.txt']}); await env.flush(4);
  const btns=[...doc.querySelectorAll('#fm-files .ffile-doc')];
  assert.deepEqual(btns.map(b=>b.style.display), ['', 'none'], '문서 폴더 안 링크에만 [문서]');
  doc.querySelectorAll('.tab').forEach(t=>t.classList.toggle('on', t.dataset.view==='board'));
  click(btns[0]); await env.flush(14);
  assert.ok(!isOpen('formPanel'), '양식을 닫고');
  assert.ok($('view-docs').classList.contains('on'), '문서 탭으로');
  assert.deepEqual([...doc.querySelectorAll('.tab.on')].map(x=>x.dataset.view), ['docs'], '탭 줄 표시도 문서로(보드에 남지 않는다)');
  assert.ok(row('0:가 폴더/보고.zip').classList.contains('on'), '그 파일을 고른다');
  openForm({id:77, done:true, files:['D:\\공유\\가 폴더']}, {readonly:true}); await env.flush(4);
  assert.equal(doc.querySelector('#fm-files .ffile-doc').disabled, false, '완료 업무(읽기 전용)에서도 [문서]는 눌린다');
  closeForm();
});

test('끌어 옮기기: 파일을 폴더에 놓으면 확인 후 doc_move(폴더 번호 포함) · 링크가 새 경로로(종료 업무는 doneDirty) · [실행 취소]', async () => {
  const {relinkFiles} = await import('../../src/docs.js');
  const its=[{id:1, files:['D:\\공유\\가\\보고서.hwpx','D:\\공유\\나\\x.xlsx']}, {id:2, files:['d:/공유/가']}, {id:3, files:['D:\\공유\\가나\\y']}];
  const ch=relinkFiles(its, ['d:/공유/가'], 'D:\\공유\\나\\가');
  assert.deepEqual(ch.map(x=>x.id), [1,2], '가나(이름이 가로 시작하는 다른 폴더)는 건드리지 않는다');
  assert.deepEqual(its[0].files, ['D:\\공유\\나\\가\\보고서.hwpx','D:\\공유\\나\\x.xlsx']);
  assert.deepEqual(its[1].files, ['D:\\공유\\나\\가']);

  await env.resetS(); S.loaded = true; S.doneDirty.clear();
  S.settings.docRoots=['E:\\이동'];
  const done=mk({id:10, memo:'끝난 업무', done:true, doneAt:1, files:['E:\\이동\\표.xlsx']});
  const live=mk({id:11, memo:'진행 업무', files:['E:\\이동\\표.xlsx']});
  S.items.push(done, live);
  const F=(n,r,d)=>({name:n,rel:r,dir:d,size:1,mtime:1});
  let lists={'0:':[F('가 폴더','가 폴더',true),F('표.xlsx','표.xlsx',false)], '0:가 폴더':[]};
  const moves=[];
  fakeFs(()=>lists);
  env.onInvoke('doc_read', ()=>{ throw '없음'; });
  env.onInvoke('doc_move', a=>{ moves.push([a.root,a.from,a.toDir]); const to=(a.toDir?a.toDir+'/':'')+a.from.split('/').pop();
    lists = a.toDir ? {'0:':[F('가 폴더','가 폴더',true)], '0:가 폴더':[F('표.xlsx',to,false)]} : {'0:':[F('가 폴더','가 폴더',true),F('표.xlsx','표.xlsx',false)], '0:가 폴더':[]};
    return to; });
  await openDocs();
  const ms = (el, type, x, y) => el.dispatchEvent(new env.window.MouseEvent(type, {bubbles:true, cancelable:true, button:0, buttons:type==='mouseup'?0:1, clientX:x, clientY:y}));
  ms(row('0:표.xlsx'),'mousedown',10,10); ms(row('0:가 폴더'),'mousemove',12,11); ms(row('0:가 폴더'),'mouseup',12,11);
  await env.flush(4);
  assert.equal(moves.length, 0, '조금만 움직이면 끌기가 아니다');
  env.answerConfirm(true);
  ms(row('0:표.xlsx'),'mousedown',10,10); ms(row('0:가 폴더'),'mousemove',10,60);
  assert.ok(row('0:가 폴더').classList.contains('drop-on'), '놓을 수 있는 폴더 표시');
  ms(row('0:가 폴더'),'mouseup',10,60);
  await env.flush(12);
  assert.deepEqual(moves, [[0,'표.xlsx','가 폴더']]);
  assert.deepEqual(live.files, ['E:\\이동\\가 폴더\\표.xlsx']);
  assert.deepEqual(done.files, ['E:\\이동\\가 폴더\\표.xlsx']);
  const last=env.invokeCalls.filter(c=>c.cmd==='save_all').at(-1).args;
  assert.ok(last.items.some(x=>x.id===10), '종료 업무가 이번 저장 배치에');
  click($('toast-undo')); await env.flush(12);
  assert.deepEqual(moves[1], [0,'가 폴더/표.xlsx','']);
  assert.deepEqual(live.files, ['E:\\이동\\표.xlsx']);
  env.answerConfirm(false);
  ms(row('0:표.xlsx'),'mousedown',10,10); ms(row('0:가 폴더'),'mousemove',10,60); ms(row('0:가 폴더'),'mouseup',10,60);
  await env.flush(6);
  assert.equal(moves.length, 2, '[취소]면 옮기지 않는다');
});

test('오른쪽 클릭: 새 텍스트 문서(이름 겹치면 (2)) → 바로 이름 바꾸기 → 링크도 따라감 · 파일엔 새로 만들기 없음', async () => {
  const {freeName} = await import('../../src/docs.js');
  assert.equal(freeName([{name:'새 메모.md'},{name:'새 메모 (2).MD'}], '새 메모', '.md'), '새 메모 (3).md');
  assert.equal(freeName([], '새 폴더', ''), '새 폴더');
  await env.resetS(); S.loaded = true;
  S.settings.docRoots=['R:\\만들기'];
  let lists={'0:':[{name:'가',rel:'가',dir:true,size:0,mtime:1}], '0:가':[{name:'새 텍스트 문서.txt',rel:'가/새 텍스트 문서.txt',dir:false,size:0,mtime:1}]};
  fakeFs(()=>lists);
  const made=[], renamed=[];
  env.onInvoke('doc_create', a=>{ made.push(a); const rel=`${a.dir}/${a.name}`; lists['0:가']=[...lists['0:가'], {name:a.name,rel,dir:a.isDir,size:0,mtime:2}]; return rel; });
  env.onInvoke('doc_rename', a=>{ renamed.push(a); const rel=`가/${a.name}`; lists['0:가']=lists['0:가'].map(e=>e.rel===a.rel?{...e,name:a.name,rel}:e); return rel; });
  env.onInvoke('doc_read_text', ()=>({text:'', encoding:'utf-8', mtime:2}));
  const it=mk({memo:'링크 업무', files:['R:\\만들기\\가\\새 텍스트 문서 (2).txt']}); S.items.push(it);
  await openDocs();
  { const t=Date.now(); while(Date.now()-t<350){} }           // 앞 시험의 끌기 직후 클릭 무시(300ms)가 지나가게
  click(row('0:가')); await env.flush(6);
  const ctx = el => el.dispatchEvent(new env.window.MouseEvent('contextmenu', {bubbles:true, cancelable:true, clientX:50, clientY:50}));
  ctx(row('0:가/새 텍스트 문서.txt'));
  assert.ok(!doc.querySelector('.dt-menu [data-mnew]'), '파일 메뉴엔 새로 만들기가 없다');
  assert.ok(doc.querySelector('.dt-menu [data-mren]'));
  ctx(row('0:가'));
  assert.equal(doc.querySelectorAll('.dt-menu').length, 1, '메뉴는 하나만');
  click(doc.querySelector('.dt-menu [data-mnew="txt"]')); await env.flush(12);
  assert.deepEqual({dir:made[0].dir, name:made[0].name, isDir:made[0].isDir}, {dir:'가', name:'새 텍스트 문서 (2).txt', isDir:false});
  const inp=doc.querySelector('#dt-tree .dt-rename');
  assert.ok(inp, '만들자마자 이름 바꾸기 칸');
  assert.equal(inp.selectionEnd, '새 텍스트 문서 (2)'.length, '확장자 앞까지 골라 둔다');
  inp.value='회신 초안.txt';
  inp.dispatchEvent(new env.window.KeyboardEvent('keydown', {key:'Enter', bubbles:true, cancelable:true})); await env.flush(12);
  assert.deepEqual({rel:renamed[0].rel, name:renamed[0].name}, {rel:'가/새 텍스트 문서 (2).txt', name:'회신 초안.txt'});
  assert.ok(row('0:가/회신 초안.txt').classList.contains('on'), '바꾼 이름으로 골라진 채');
  assert.deepEqual(it.files, ['R:\\만들기\\가\\회신 초안.txt'], '그 파일을 가리키던 업무 링크도 따라간다');
  /* ESC 는 취소 */
  ctx(row('0:가/회신 초안.txt')); click(doc.querySelector('.dt-menu [data-mren]')); await env.flush(2);
  const inp2=doc.querySelector('#dt-tree .dt-rename'); inp2.value='딴 이름.txt';
  inp2.dispatchEvent(new env.window.KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true})); await env.flush(6);
  assert.equal(renamed.length, 1);
  assert.ok(row('0:가/회신 초안.txt'));
});

test('탐색기에서 끌어 와 문서 폴더 줄에 놓으면 그 폴더로 복사(doc_import) · 다른 탭이면 문서 폴더로 치지 않는다', async () => {
  const {dropTarget, applyDrop} = await import('../../src/filedrop.js');
  await env.resetS(); S.loaded = true;
  S.settings.docRoots=['P:\넣기'];
  let lists={'0:':[{name:'받은 자료',rel:'받은 자료',dir:true,size:0,mtime:1}], '0:받은 자료':[]};
  fakeFs(()=>lists);
  const calls=[];
  env.onInvoke('doc_import', a=>{ calls.push(a); lists['0:받은 자료']=[{name:'견적.pdf',rel:'받은 자료/견적.pdf',dir:false,size:1,mtime:3}]; return ['받은 자료/견적.pdf']; });
  env.onInvoke('doc_read', ()=>{ throw '없음'; });
  await openDocs();
  const t=dropTarget(row('0:받은 자료').querySelector('.dt-name'));
  assert.equal(t.kind, 'docdir');
  assert.equal(t.key, '0:받은 자료');
  assert.equal(dropTarget(doc.querySelector('#dn-list')).kind, 'new', '오른쪽 메모 칸은 예전처럼 새 양식');
  applyDrop(t, ['C:\Users\me\Desktop\견적.pdf']); await env.flush(12);
  assert.deepEqual({root:calls[0].root, dir:calls[0].dir, paths:calls[0].paths}, {root:0, dir:'받은 자료', paths:['C:\Users\me\Desktop\견적.pdf']});
  assert.ok(row('0:받은 자료/견적.pdf').classList.contains('on'), '넣은 파일을 고른다');
  const r=row('0:받은 자료');
  showView('board'); await env.flush(4);
  assert.notEqual(dropTarget(r).kind, 'docdir', '문서 탭이 아니면 문서 폴더로 치지 않는다');
});

test('오른쪽 클릭: 새 한글·엑셀·파워포인트 → doc_create_doc → 이름을 정하면 그 프로그램으로 연다', async () => {
  await env.resetS(); S.loaded = true;
  S.settings.docRoots=['Q:\\오피스'];
  let lists={'0:':[]};
  fakeFs(()=>lists);
  const made=[], opened=[];
  env.onInvoke('doc_create_doc', a=>{ made.push(a); lists['0:']=[{name:a.name,rel:a.name,dir:false,size:9,mtime:1}]; return a.name; });
  env.onInvoke('doc_rename', a=>{ lists['0:']=[{name:a.name,rel:a.name,dir:false,size:9,mtime:1}]; return a.name; });
  env.onInvoke('open_file_path', a=>{ opened.push(a.path); return null; });
  await openDocs();
  { const t=Date.now(); while(Date.now()-t<350){} }
  row('0:').dispatchEvent(new env.window.MouseEvent('contextmenu', {bubbles:true, cancelable:true, clientX:20, clientY:20}));
  assert.deepEqual([...doc.querySelectorAll('.dt-menu [data-mnew]')].map(b=>b.dataset.mnew), ['dir','txt','md','hwpx','xlsx','pptx']);
  click(doc.querySelector('.dt-menu [data-mnew="hwpx"]')); await env.flush(12);
  assert.deepEqual({dir:made[0].dir, name:made[0].name}, {dir:'', name:'새 한글 문서.hwpx'});
  assert.equal(opened.length, 0, '이름을 정하기 전엔 열지 않는다(열리면 이름을 못 바꾼다)');
  const inp=doc.querySelector('#dt-tree .dt-rename'); inp.value='회의 결과.hwpx';
  inp.dispatchEvent(new env.window.KeyboardEvent('keydown', {key:'Enter', bubbles:true, cancelable:true})); await env.flush(14);
  assert.deepEqual(opened, ['Q:\\오피스\\회의 결과.hwpx'], '바꾼 이름으로 바로 연다');
  /* 이름을 그대로 두어도(ESC) 연다 */
  row('0:').dispatchEvent(new env.window.MouseEvent('contextmenu', {bubbles:true, cancelable:true, clientX:20, clientY:20}));
  click(doc.querySelector('.dt-menu [data-mnew="xlsx"]')); await env.flush(12);
  doc.querySelector('#dt-tree .dt-rename').dispatchEvent(new env.window.KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true})); await env.flush(10);
  assert.equal(opened.at(-1), 'Q:\\오피스\\새 엑셀 문서.xlsx');
});

test('v3.8.3 휴지통으로: 확인 → doc_trash · 고른 것은 위 폴더로 · 업무 링크는 남김(건수 안내)', async () => {
  const {linkedCount} = await import('../../src/docs.js');
  await env.resetS(); S.loaded = true;
  S.settings.docRoots=['V:\\버림'];
  let lists={'0:':[{name:'가',rel:'가',dir:true,size:0,mtime:1}], '0:가':[{name:'x.zip',rel:'가/x.zip',dir:false,size:1,mtime:1}]};
  fakeFs(()=>lists);
  const trashed=[]; env.onInvoke('doc_trash', a=>{ trashed.push(a); lists['0:가']=[]; return null; });
  env.onInvoke('doc_read_text', ()=>{ throw '글자 파일이 아닙니다'; });
  const it=mk({files:['V:\\버림\\가\\x.zip']}); S.items.push(it);
  assert.equal(linkedCount(S.items, ['v:/버림/가']), 1, '폴더 안 파일 링크도 센다');
  await openDocs();
  { const t=Date.now(); while(Date.now()-t<350){} }
  click(row('0:가')); await env.flush(6);
  click(row('0:가/x.zip')); await env.flush(8);
  const confirms=[]; const oc=env.window.confirm; env.window.confirm=m=>{ confirms.push(m); return true; };
  row('0:가/x.zip').dispatchEvent(new env.window.MouseEvent('contextmenu', {bubbles:true, cancelable:true, clientX:20, clientY:20}));
  click(doc.querySelector('.dt-menu [data-mtrash]')); await env.flush(14);
  env.window.confirm=oc;
  assert.match(confirms[0], /휴지통/); assert.match(confirms[0], /업무 1건/);
  assert.deepEqual({root:trashed[0].root, rel:trashed[0].rel}, {root:0, rel:'가/x.zip'});
  assert.ok(!row('0:가/x.zip'), '트리에서 사라짐');
  assert.ok(row('0:가').classList.contains('on'), '고른 것은 위 폴더로');
  assert.deepEqual(it.files, ['V:\\버림\\가\\x.zip'], '링크는 남긴다');
  /* 문서 폴더 자체 메뉴엔 휴지통이 없다 */
  row('0:').dispatchEvent(new env.window.MouseEvent('contextmenu', {bubbles:true, cancelable:true, clientX:20, clientY:20}));
  assert.ok(!doc.querySelector('.dt-menu [data-mtrash]'));
  /* 대신 [문서 폴더 해지] — 목록에서만 뺀다 */
  assert.ok(!trashed.some(x=>x.rel===''));
  env.answerConfirm(true);
  click(doc.querySelector('.dt-menu [data-munroot]')); await env.flush(10);
  assert.deepEqual(S.settings.docRoots, [], '문서 폴더 목록에서 빠진다');
  assert.ok(!$('view-docs').classList.contains('has-root'));
});

test('v3.8.3 문서 찾기: 모든 문서 폴더에서 · 결과는 트리 자리 · 누르면 그 파일(위 폴더 펼침) · ESC 로 트리로', async () => {
  await env.resetS(); S.loaded = true;
  S.settings.docRoots=['A:\\하나','B:\\둘'];
  fakeFs(()=>({'0:':[{name:'깊은',rel:'깊은',dir:true,size:0,mtime:1}], '0:깊은':[{name:'견적 회신.txt',rel:'깊은/견적 회신.txt',dir:false,size:1,mtime:1}], '1:':[]}));
  const asked=[];
  env.onInvoke('doc_search', a=>{ asked.push(a); return a.root===0 ? [{rel:'깊은/견적 회신.txt', name:'견적 회신.txt', dir:false, hit:'name', snippet:''}] : [{rel:'메모.md', name:'메모.md', dir:false, hit:'text', snippet:'…견적 기한 11.28…'}]; });
  env.onInvoke('doc_read_text', a=>({text:'본문', encoding:'utf-8', mtime:1}));
  await openDocs();
  doc.body.dispatchEvent(new env.window.MouseEvent('mousedown',{bubbles:true}));   // 앞 시험의 오른쪽 클릭 메뉴 닫기
  const s=$('dc-search'); s.value='견적'; s.dispatchEvent(new env.window.Event('input',{bubbles:true}));
  mock.timers.tick(350); await env.flush(12);
  assert.deepEqual(asked.map(a=>[a.root,a.query]), [[0,'견적'],[1,'견적']]);
  const hits=[...doc.querySelectorAll('#dt-tree .dt-hit')];
  assert.equal(hits.length, 2);
  assert.match(hits[1].textContent, /둘/, '폴더가 여럿이면 어느 폴더인지');
  assert.match(hits[1].textContent, /견적 기한 11\.28/, '내용으로 걸린 줄');
  click(hits[0]); await env.flush(12);
  assert.equal($('dv-ta').value, '본문');
  assert.ok(S.settings.docOpen.includes('0:깊은'), '위 폴더를 펼쳐 둔다');
  s.dispatchEvent(new env.window.KeyboardEvent('keydown',{key:'Escape', bubbles:true, cancelable:true}));
  await env.flush(4);
  assert.equal(s.value, '');
  assert.ok(row('0:깊은/견적 회신.txt').classList.contains('on'), '트리로 돌아오면 그 파일이 보이고 골라져 있다');
});

test('v3.8.4 문서 찾기: 찾는 도중 검색어를 지우면 늦게 끝난 찾기가 트리를 덮지 않는다', async () => {
  await env.resetS(); S.loaded = true;
  S.settings.docRoots=['A:\하나'];
  fakeFs(()=>({'0:':[{name:'보고.txt',rel:'보고.txt',dir:false,size:1,mtime:1}]}));
  let release; env.onInvoke('doc_search', ()=>new Promise(r=>{ release=()=>r([]); }));
  await openDocs();
  const s=$('dc-search'); s.value='없는말'; s.dispatchEvent(new env.window.Event('input',{bubbles:true}));
  mock.timers.tick(350); await env.flush(4);
  s.value=''; s.dispatchEvent(new env.window.Event('input',{bubbles:true}));
  await env.flush(2);
  assert.ok(row('0:보고.txt'), '지우자마자 트리');
  release(); await env.flush(8);
  assert.ok(row('0:보고.txt'), '늦게 끝난 찾기가 덮지 않는다');
  assert.ok(!/찾은 것 없음/.test($('dt-tree').textContent));
});

test('v3.8.3 탐색기에서 끌어 오기: Shift 를 누른 채 놓으면 옮기기(mv) · 아니면 복사', async () => {
  const {handleDragDrop, dropTarget, applyDrop} = await import('../../src/filedrop.js');
  await env.resetS(); S.loaded = true;
  S.settings.docRoots=['C:\\받기'];
  fakeFs(()=>({'0:':[{name:'모음',rel:'모음',dir:true,size:0,mtime:1}], '0:모음':[]}));
  const calls=[]; env.onInvoke('doc_import', a=>{ calls.push(a); return []; });
  let shift=true; env.onInvoke('key_shift_down', ()=>shift);
  await openDocs();
  const t=dropTarget(row('0:모음'));
  t.mv=true; applyDrop(t, ['D:\\a.txt']); await env.flush(8);
  assert.equal(calls[0].mv, true);
  const t2=dropTarget(row('0:모음')); applyDrop(t2, ['D:\\b.txt']); await env.flush(8);
  assert.equal(calls[1].mv, false, 'Shift 없으면 복사');
  /* 진짜 놓기 경로: 놓는 순간 Windows 에 Shift 를 묻는다 */
  const orig=doc.elementFromPoint; doc.elementFromPoint=()=>row('0:모음');
  await handleDragDrop({type:'drop', paths:['D:\\c.txt'], position:{x:1,y:1}}); await env.flush(8);
  shift=false;
  await handleDragDrop({type:'drop', paths:['D:\\d.txt'], position:{x:1,y:1}}); await env.flush(8);
  doc.elementFromPoint=orig;
  assert.deepEqual(calls.slice(2).map(c=>[c.paths[0], c.mv]), [['D:\\c.txt', true], ['D:\\d.txt', false]]);
});

/* ───────────── v3.8.4 ───────────── */
test('v3.8.4 CSV 규칙: 따옴표·쉼표·줄바꿈이 든 칸을 잃지 않고 왕복', async () => {
  const {parseCsv, toCsv, csvEditHtml, docxHtml, hwpText, docThumb, zipList} = await import('../../src/docs-view.js');
  const src='이름,메모\r\n"김, 철수","그는 ""네""라고\n했다"\r\n빈,\r\n';
  const rows=parseCsv(src);
  assert.deepEqual(rows, [['이름','메모'],['김, 철수','그는 "네"라고\n했다'],['빈','']]);
  assert.deepEqual(parseCsv(toCsv(rows)), rows, '다시 읽어도 같다');
  assert.deepEqual(parseCsv('a\tb\n1\t2', '\t'), [['a','b'],['1','2']]);
  assert.equal(csvEditHtml(Array.from({length:2001},()=>['x'])), null, '너무 큰 표는 읽기 전용');
  /* DOCX: 문단과 표 */
  const W='xmlns:w="urn:w"';
  const dx=unzip(zip({'word/document.xml':`<w:document ${W}><w:body><w:p><w:r><w:t>제목</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>칸</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`}));
  const box=doc.createElement('div'); box.innerHTML=docxHtml(dx);
  assert.equal(box.querySelector('section > p').textContent, '제목');
  assert.equal(box.querySelector('td').textContent, '칸');
  /* HWP 미리 보기 글자(UTF-16LE) · 첫 쪽 그림 판별 · ZIP 목록 */
  assert.equal(hwpText({PrvText:new Uint8Array(Buffer.from('한글 문서\r\n둘째','utf16le'))}), '한글 문서\r\n둘째');
  const png=new Uint8Array(200); png.set([0x89,0x50,0x4E,0x47]);
  assert.equal(docThumb({'Preview/PrvImage.png':png}).mime, 'image/png');
  assert.equal(docThumb({'x.xml':png}), null);
  /* 진짜 zip(Windows 로 만든 것, 이름이 UTF-8 바이트) — 한글 이름을 되살린다 */
  const realZip=new Uint8Array(Buffer.from('UEsDBBQAAAgIAMRrdV1T/FFnBAAAAAIAAAASAAAA7JWIXOqwgCDrrLjshJwudHh0M+QCAFBLAwQUAAAICADEa3Vdg1UL1QUAAAADAAAACAAAAOuCmC5od3B4MzLiAgBQSwECFAAUAAAICADEa3VdU/xRZwQAAAACAAAAEgAAAAAAAAAAAAAAAAAAAAAA7JWIXOqwgCDrrLjshJwudHh0UEsBAhQAFAAACAgAxGt1XYNVC9UFAAAAAwAAAAgAAAAAAAAAAAAAAAAANAAAAOuCmC5od3B4UEsFBgAAAAACAAIAdgAAAF8AAAAAAA==','base64'));
  assert.deepEqual(zipList(realZip).map(f=>[f.name,f.size]), [['나.hwpx',3],['안/가 문서.txt',2]]);
});

test('v3.8.4 CSV 표에서 칸을 고치면 글자로 되돌려 저장 · [＋ 행]', async () => {
  await env.resetS(); S.loaded = true;
  S.settings.docRoots=['Y:\\표'];
  fakeFs(()=>({'0:':[{name:'명단.csv',rel:'명단.csv',dir:false,size:1,mtime:1}]}));
  env.onInvoke('doc_read_text', ()=>({text:'이름,수량\r\n펜,3\r\n', encoding:'utf-8-bom', mtime:1}));
  const writes=[]; env.onInvoke('doc_write_text', a=>{ writes.push(a); return a.baseMtime+1; });
  await openDocs();
  { const t=Date.now(); while(Date.now()-t<350){} }
  click(row('0:명단.csv')); await env.flush(10);
  const td=doc.querySelector('.dv-csv td[data-r="1"][data-c="1"]');
  assert.equal(td.textContent, '3');
  td.textContent='12, 급함'; td.dispatchEvent(new env.window.Event('input',{bubbles:true}));
  mock.timers.tick(1300); await env.flush(8);
  assert.equal(writes[0].text, '이름,수량\r\n펜,"12, 급함"\r\n', '쉼표가 든 칸은 따옴표 · 줄바꿈·인코딩은 원래대로');
  assert.equal(writes[0].encoding, 'utf-8-bom');
  click(doc.querySelector('[data-csvadd="row"]')); await env.flush(6);
  assert.equal(doc.querySelectorAll('.dv-csv tr').length, 3);
  mock.timers.tick(1300); await env.flush(8);
  assert.equal(writes.at(-1).text, '이름,수량\r\n펜,"12, 급함"\r\n,\r\n');
});

test('v3.8.4 저장 대상 고정: 저장이 도는 중에 다른 파일로 가도 고친 글자는 원래 파일에 끝까지 쓴다', async () => {
  await env.resetS(); S.loaded = true;
  S.settings.docRoots=['Z:\\경합'];
  fakeFs(()=>({'0:':[{name:'a.txt',rel:'a.txt',dir:false,size:1,mtime:1},{name:'b.txt',rel:'b.txt',dir:false,size:1,mtime:1}]}));
  env.onInvoke('doc_read_text', a=>({text:a.rel, encoding:'utf-8', mtime:1}));
  const writes=[]; let release;
  env.onInvoke('doc_write_text', a=>{ writes.push({rel:a.rel, text:a.text}); return writes.length===1 ? new Promise(r=>{ release=()=>r(2); }) : 3; });
  await openDocs();
  { const t=Date.now(); while(Date.now()-t<350){} }
  click(row('0:a.txt')); await env.flush(10);
  typeIn($('dv-ta'), '첫 고침');
  mock.timers.tick(1300); await env.flush(4);           // 첫 저장이 멈춰 있다
  typeIn($('dv-ta'), '둘째 고침');                      // 그 사이 더 고치고
  click(row('0:b.txt')); await env.flush(6);            // 다른 파일로
  assert.equal(writes.length, 1);
  release(); await env.flush(14);
  assert.deepEqual(writes, [{rel:'a.txt', text:'첫 고침'}, {rel:'a.txt', text:'둘째 고침'}], '나중 고침도 a.txt 에');
  assert.equal($('dv-ta').value, 'b.txt', '그 뒤에 b 가 열린다');
});

test('v3.8.4 HTML [보기|편집] · ZIP 목록 · 큰 파일은 오류 대신 안내와 [열기] · 복제 · F2/Delete', async () => {
  await env.resetS(); S.loaded = true;
  S.settings.docRoots=['X:\\여러'];
  const F=(n,d)=>({name:n,rel:n,dir:!!d,size:5,mtime:1});
  let lists={'0:':[F('p.html'),F('묶음.zip'),F('큰.pdf'),F('k.txt')]};
  fakeFs(()=>lists);
  env.onInvoke('doc_read_text', a=>({text:a.rel==='p.html'?'<html><head><title>t</title><style>p{color:red}</style></head><body><h2>공지</h2><script>x()</script><p onclick="y()">본문</p></body></html>':'k', encoding:'utf-8', mtime:1}));
  env.onInvoke('doc_read', a=>{ if(a.rel==='큰.pdf') throw '미리보기 상한(30MB) 초과'; return zip({'in/a.txt':'1','b.hwpx':'22'}).buffer; });
  const opened=[]; env.onInvoke('open_file_path', a=>{ opened.push(a.path); return null; });
  await openDocs();
  { const t=Date.now(); while(Date.now()-t<350){} }
  click(row('0:p.html')); await env.flush(40);
  const fr=$('dv-md').querySelector('iframe.dv-frame');
  assert.ok(fr, 'HTML 은 모래상자 프레임에');
  assert.ok(!/allow-same-origin|allow-top-navigation/.test(fr.getAttribute('sandbox')), '앱 화면에 닿는 권한은 주지 않는다');
  assert.match(fr.getAttribute('src'), /^http:\/\/wmhhdoc\.localhost\/0\/p\.html\?t=/, '문서 폴더 전용 주소(폴더 번호 + 상대 경로)');
  const {docUrl} = await import('../../src/docs.js');
  assert.equal(docUrl(1, '가 폴더/a+b #1.html'), 'http://wmhhdoc.localhost/1/%EA%B0%80%20%ED%8F%B4%EB%8D%94/a%2Bb%20%231.html');
  click(row('0:묶음.zip')); await env.flush(12);
  assert.deepEqual([...doc.querySelectorAll('.dv-zrow .dv-fname')].map(x=>x.textContent), ['b.hwpx','in/a.txt']);
  click(row('0:큰.pdf')); await env.flush(12);
  assert.ok(!$('dv-body').querySelector('.dv-err'), '큰 파일은 오류가 아니다');
  click($('dv-body').querySelector('.dv-info [data-dopen]')); await env.flush(6);
  assert.equal(opened.at(-1), 'X:\\여러\\큰.pdf');
  /* 복제 */
  env.onInvoke('doc_copy', a=>{ lists={'0:':[...lists['0:'], F('k (2).txt')]}; return 'k (2).txt'; });
  row('0:k.txt').dispatchEvent(new env.window.MouseEvent('contextmenu', {bubbles:true, cancelable:true, clientX:9, clientY:9}));
  click(doc.querySelector('.dt-menu [data-mcopy]')); await env.flush(14);
  assert.ok(row('0:k (2).txt').classList.contains('on'), '복제본을 고른다');
  /* F2 = 이름 칸 · Delete = 휴지통 확인 */
  doc.body.dispatchEvent(new env.window.KeyboardEvent('keydown', {key:'F2', bubbles:true, cancelable:true})); await env.flush(4);
  assert.ok(doc.querySelector('#dt-tree .dt-rename'));
  doc.querySelector('#dt-tree .dt-rename').dispatchEvent(new env.window.KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true})); await env.flush(4);
  const tr=[]; env.onInvoke('doc_trash', a=>{ tr.push(a.rel); lists={'0:':lists['0:'].filter(e=>e.rel!==a.rel)}; return null; });
  env.answerConfirm(true);
  doc.body.dispatchEvent(new env.window.KeyboardEvent('keydown', {key:'Delete', bubbles:true, cancelable:true})); await env.flush(14);
  assert.deepEqual(tr, ['k (2).txt']);
  /* 두 번 누르면 그 프로그램으로 */
  row('0:k.txt').dispatchEvent(new env.window.MouseEvent('dblclick', {bubbles:true})); await env.flush(6);
  assert.equal(opened.at(-1), 'X:\\여러\\k.txt');
});

test('v3.8.4 트리 폭: 180~560 으로 묶고, 손잡이를 끌면 settings.docTreeW 에 기억 · 두 번 누르면 기본', async () => {
  const {clampTreeW} = await import('../../src/docs.js');
  assert.deepEqual([50, 300, 9999, 'x', undefined].map(clampTreeW), [180, 300, 560, 260, 260]);
  await env.resetS(); S.loaded = true;
  S.settings.docRoots=['U:\폭']; fakeFs(()=>({'0:':[]}));
  await openDocs();
  const sp=$('dc-split'), ms=(el,type,x,b)=>el.dispatchEvent(new env.window.MouseEvent(type,{bubbles:true,cancelable:true,button:0,buttons:b,clientX:x,clientY:5}));
  ms(sp,'mousedown',260,1); ms(doc.body,'mousemove',340,1);
  assert.equal(S.settings.docTreeW, 340);
  assert.equal(doc.querySelector('#view-docs .dc-layout').style.getPropertyValue('--dc-tree-w'), '340px');
  ms(doc.body,'mouseup',340,0);
  mock.timers.tick(900); await env.flush(2);
  assert.ok(env.invokeCalls.some(c=>c.cmd==='save_settings'), '놓으면 저장(잠깐 모아서)');
  sp.dispatchEvent(new env.window.MouseEvent('dblclick',{bubbles:true}));
  assert.equal(S.settings.docTreeW, 260);
});

test('v3.8.4 코드·쿼리 색 강조: SQL 파일은 색 층이 깔리고 입력을 따라 다시 칠한다 · txt 는 색 없음 · MD 코드 블록', async () => {
  const {codeLang, codeHtml} = await import('../../src/docs-view.js');
  assert.deepEqual(['q.SQL','a.py','b.json','c.txt','d.csv','e.yml'].map(codeLang), ['sql','python','json',null,null,'yaml']);
  const h=await codeHtml("SELECT name FROM t WHERE id = 3 -- 주석 <b>", 'sql');
  assert.match(h, /hljs-keyword">SELECT</); assert.match(h, /hljs-number">3</); assert.match(h, /hljs-comment/);
  assert.ok(!h.includes('<b>'), '글자는 이스케이프된다');
  assert.equal(await codeHtml('x', 'nope-lang'), null);
  await env.resetS(); S.loaded = true;
  S.settings.docRoots=['L:\\색']; S.settings.docMdMode='view';
  fakeFs(()=>({'0:':[{name:'q.sql',rel:'q.sql',dir:false,size:1,mtime:1},{name:'n.txt',rel:'n.txt',dir:false,size:1,mtime:1},{name:'m.md',rel:'m.md',dir:false,size:1,mtime:1}]}));
  env.onInvoke('doc_read_text', a=>({text:a.rel==='q.sql'?'SELECT 1':a.rel==='m.md'?'```sql\nSELECT 2\n```\n':'그냥 글', encoding:'utf-8', mtime:1}));
  env.onInvoke('doc_write_text', a=>a.baseMtime+1);
  env.onInvoke('doc_read', ()=>{ throw '없음'; });
  await openDocs();
  { const t=Date.now(); while(Date.now()-t<350){} }
  click(row('0:q.sql')); await env.flush(30);
  assert.ok($('dv-ta').classList.contains('dv-ta-hl'), '색 층이 켜지면 입력칸 글자는 투명');
  assert.match($('dv-hl').innerHTML, /hljs-keyword">SELECT</);
  typeIn($('dv-ta'), 'UPDATE t SET a = 1'); await env.flush(30);
  assert.match($('dv-hl').innerHTML, /hljs-keyword">UPDATE</, '고치면 다시 칠한다');
  assert.equal($('dv-hl').textContent, 'UPDATE t SET a = 1\n', '색 층의 글자는 입력칸과 같다');
  click(row('0:n.txt')); await env.flush(30);
  assert.ok(!$('dv-ta').classList.contains('dv-ta-hl') && $('dv-hl').innerHTML==='', 'txt 는 색 없음');
  click(row('0:m.md')); await env.flush(60);
  assert.ok($('dv-md').querySelector('pre code .hljs-keyword'), 'MD 코드 블록에 색');
});

test('v3.8.5 초록 [+ 입력] 은 보드 탭에서만 보인다', async () => {
  await env.resetS(); S.loaded = true;
  for(const v of ['cal','docs','done','phone']){ showView(v); assert.equal($('blankForm').style.display, 'none', v); }
  showView('board'); assert.equal($('blankForm').style.display, 'inline-block');
});

test('v3.8.8 문서 탭 메모 칸: 카드는 줄어들지 않는다(넘치면 목록이 스크롤) — .card 의 overflow:hidden 때문에 세로 flex 에서 눌려 잘렸다', () => {
  const css = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.dn-list\{[^}]*overflow:auto/);
  assert.match(css, /\.dn-list>\*\{flex-shrink:0\}/);
});

test('v3.8.8 파워포인트(PPT·PPTX)는 읽지 않고 [파워포인트에서 열기] 만 안내 — 탐색기 미리 보기·파일 읽기를 부르지 않는다', async () => {
  await env.resetS(); S.loaded = true;
  S.settings.docRoots=['P:\\발표'];
  fakeFs(()=>({'0:':[{name:'보고.pptx',rel:'보고.pptx',dir:false,size:1,mtime:1},{name:'옛.ppt',rel:'옛.ppt',dir:false,size:1,mtime:1}]}));
  env.onInvoke('doc_preview_open', ()=>true);
  await openDocs();
  for(const f of ['보고.pptx','옛.ppt']){
    const n0=env.invokeCalls.filter(c=>c.cmd==='doc_preview_open'||c.cmd==='doc_read').length;
    click(row('0:'+f)); await env.flush(10);
    assert.equal(env.invokeCalls.filter(c=>c.cmd==='doc_preview_open'||c.cmd==='doc_read').length, n0, f+': 미리 보기·읽기 없음');
    assert.match($('dv-body').textContent, /파워포인트에서 열어 보세요/);
    assert.ok($('dv-body').querySelector('.dv-info [data-dopen]'), f+': [파워포인트에서 열기]');
  }
});

test('v3.8.9 앱이 켜지면 문서 폴더를 미리 알린다(그때 Rust 가 찾기 색인을 뒤에서 만든다) · 폴더가 없으면 부르지 않는다', async () => {
  const {primeDocRoots} = await import('../../src/docs.js');
  await env.resetS(); S.loaded = true;
  S.settings.docRoots=[];
  const n0=env.invokeCalls.filter(c=>c.cmd==='doc_set_roots').length;
  await primeDocRoots(); await env.flush(4);
  assert.equal(env.invokeCalls.filter(c=>c.cmd==='doc_set_roots').length, n0, '폴더가 없으면 부르지 않는다');
  S.settings.docRoots=['Y:\\미리'];
  env.onInvoke('doc_set_roots', a=>a.paths.map(p=>({ok:true,path:p,error:''})));
  await primeDocRoots(); await env.flush(4);
  const call=env.invokeCalls.filter(c=>c.cmd==='doc_set_roots').at(-1);
  assert.deepEqual(call.args.paths, ['Y:\\미리']);
});

test('v3.8.9 폴더를 접으면 그 아래 펼쳐 둔 폴더도 모두 접힌다 — 다시 펼치면 하위 폴더는 접힌 채로', async () => {
  const {collapseKeys} = await import('../../src/docs.js');
  const set=new Set(['0:','0:가','0:가/나','0:가/나/다','0:가나다','0:라','1:가']);
  collapseKeys(set, 0, '가');
  assert.deepEqual([...set].sort(), ['0:','0:가나다','0:라','1:가'].sort(), "'가' 와 그 아래만 — 이름이 '가' 로 시작하는 다른 폴더(가나다)·다른 문서 폴더는 그대로");
  collapseKeys(set, 0, '');
  assert.deepEqual([...set], ['1:가'], '문서 폴더 자체를 접으면 그 안 전부');
});

test('v3.8.9 메모 칸 접기 — 메모가 있을 때만 note-fold, 설정에 기억, 펼치면 해제', async () => {
  const {setNoteFold} = await import('../../src/docs.js');
  await env.resetS(); S.loaded = true;
  const v=document.getElementById('view-docs');
  setNoteFold(true); await env.flush(4);
  assert.equal(S.settings.docNoteFold, true);
  if(v.classList.contains('no-note')) assert.equal(v.classList.contains('note-fold'), false, '메모가 없으면 접기 표시를 하지 않는다(칸 자체가 없다)');
  setNoteFold(false); await env.flush(4);
  assert.equal(S.settings.docNoteFold, false);
  assert.equal(v.classList.contains('note-fold'), false);
  assert.ok(document.getElementById('dn-fold') && document.getElementById('dn-unfold'), '접기·펼치기 단추가 있다');
});

test('v3.8.9 파워포인트 아이콘은 PP(PDF 의 P 와 구분)', () => {
  const css=fs.readFileSync(new URL('../../src/styles.css', import.meta.url),'utf8');
  assert.match(css, /\.dt-ico\.ico-pptx::before\{content:"PP"\}/);
});

test('v3.8.9 한글 글자 층 — 글자를 줄로 묶고, 조금 벌어지면 띄어쓰기, 많이 벌어지거나 높이가 다르면 새 덩어리, 돌린 글자는 뺀다', async () => {
  const {hwpTextRuns} = await import('../../src/docs-view.js');
  const T=(x,y,c,sz=10)=>`<text x="${x}" y="${y}" font-size="${sz}">${c}</text>`;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300">${T(10,20,'전')}${T(20,20,'자')}${T(33,20,'입')}${T(43,20,'찰')}${T(150,20,'표')}${T(10,40,'둘')}<g transform="rotate(90)">${T(60,60,'돌')}</g></svg>`;
  const r=hwpTextRuns(svg);
  assert.equal(r.w, 200); assert.equal(r.h, 300);
  assert.deepEqual(r.runs.map(x=>x.text), ['전자 입찰','표','둘']);
  assert.deepEqual(hwpTextRuns('<svg xmlns="http://www.w3.org/2000/svg"></svg>').runs, []);
  assert.deepEqual(hwpTextRuns('깨진').runs, []);
});

test('v3.8.9 끌어 놓기: 문서 탭 가운데(문서 보기)는 놓는 자리가 아니다 — 안내도 동작도 없음', async () => {
  const {dropTarget, applyDrop} = await import('../../src/filedrop.js');
  await openDocs();
  const v=$('dv-body');
  assert.equal(dropTarget(v).kind, 'none');
  assert.equal(applyDrop({kind:'none'}, ['C:\\a.txt']), false);
});

test('v3.8.10 한글 글자 층 — 줄마다 <br>(복사 때 줄바꿈), 끌어 고르기 받침(.endOfContent)이 붙는다', async () => {
  const {guardSelection} = await import('../../src/docs-view.js');
  const d=document.createElement('div'); d.className='dv-hwp-tl'; d.innerHTML='<span>가</span>'; document.body.appendChild(d);
  guardSelection(d);
  assert.equal(d.lastElementChild.className, 'endOfContent');
  d.dispatchEvent(new window.MouseEvent('mousedown', {bubbles:true}));
  assert.ok(d.classList.contains('selecting'), '누르는 동안 받침이 층 전체를 덮는다');
  document.dispatchEvent(new window.MouseEvent('mouseup', {bubbles:true}));
  assert.ok(!d.classList.contains('selecting'));
  d.remove();
});

test('v3.8.11 한글 글자 층은 글자 하나 단위 — 글자마다 자기 자리, 띄어쓰기·줄바꿈은 복사 글에 살린다', async () => {
  const {hwpTextRuns} = await import('../../src/docs-view.js');
  const T=(x,y,c,sz=10)=>`<text x="${x}" y="${y}" font-size="${sz}">${c}</text>`;
  const r=hwpTextRuns(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300">${T(10,20,'전')}${T(20,20,'자')}${T(33,20,'입')}</svg>`);
  assert.deepEqual(r.runs[0].cs.map(c=>[c.x,c.s]), [[10,'전'],[20,'자'],[33,'입']]);
});

test('v3.8.12 장평 글자(transform="translate() scale()")도 글자 층에 들어간다 — 예전엔 빠져서 끌어 고를 때 건너뛰었다', async () => {
  const {hwpTextRuns} = await import('../../src/docs-view.js');
  const P=(tx,c)=>`<text transform="translate(${tx},50) scale(0.95,1)" font-size="20">${c}</text>`;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><text x="10" y="20" font-size="10">가</text>${P(100,'2')}${P(109.5,'0')}${P(119,'년')}<g transform="translate(5,5)"><text x="10" y="100" font-size="10">나</text></g><text transform="rotate(30)" x="1" y="1" font-size="10">돌</text></svg>`;
  const r=hwpTextRuns(svg);
  assert.deepEqual(r.runs.map(x=>x.text), ['가','20년','나'], '돌린 글자만 빠진다');
  assert.equal(r.runs[1].x, 100); assert.equal(r.runs[1].y, 50);
  assert.deepEqual([r.runs[2].x, r.runs[2].y], [15, 105], '묶음(g)의 옮기기도 더한다');
});

test('양식 [문서] 로 넘어오면 그 줄을 초록 강조(reveal)·트리 가운데로 · 다른 줄을 누르면 강조가 풀린다', async () => {
  const {showDoc} = await import('../../src/docs.js');
  await env.resetS(); S.loaded = true;
  S.settings.docRoots=['Z:\\가운데']; S.settings.docOpen=[]; S.settings.docSeen=['Z:\\가운데'];
  env.onInvoke('doc_set_roots', a=>a.paths.map(p=>({ok:true,path:p,error:''})));
  env.onInvoke('doc_list', a=>a.rel==='' ? [{name:'깊은',rel:'깊은',dir:true,size:0,mtime:1},{name:'z.txt',rel:'z.txt',dir:false,size:1,mtime:1}]
    : a.rel==='깊은' ? Array.from({length:40},(_,k)=>({name:`f${String(k).padStart(2,'0')}.txt`,rel:`깊은/f${String(k).padStart(2,'0')}.txt`,dir:false,size:1,mtime:1})) : []);
  env.onInvoke('doc_read_text', ()=>({text:'x',encoding:'utf-8',mtime:1}));
  const tree=document.getElementById('dt-tree');
  /* jsdom 은 배치를 안 하므로 줄 높이·자리를 흉내 낸다: 줄마다 28px, 트리 높이 280px */
  Object.defineProperty(tree, 'clientHeight', {configurable:true, get:()=>280});
  const rowsTop=()=>[...tree.querySelectorAll('.dt-row')];
  const origGB=window.HTMLElement.prototype.getBoundingClientRect;
  window.HTMLElement.prototype.getBoundingClientRect=function(){ if(this===tree) return {top:100-0, bottom:380, left:0, right:200, height:280, width:200};
    const k=rowsTop().indexOf(this); if(k>=0) return {top:100+k*28-tree.scrollTop, bottom:128+k*28-tree.scrollTop, left:0, right:200, height:28, width:200}; return origGB.call(this); };
  Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', {configurable:true, get(){ return this.classList&&this.classList.contains('dt-row') ? 28 : 0; }});
  try{
    await showDoc('Z:\\가운데\\깊은\\f30.txt'); await env.flush(12);
    const rows=rowsTop(), k=rows.findIndex(r=>r.dataset.dkey==='0:깊은/f30.txt');
    assert.ok(k>0, '상위 폴더를 펼쳐 그 파일 줄이 보인다');
    assert.ok(rows[k].classList.contains('reveal') && rows[k].classList.contains('on'), '초록 강조 + 고른 표시');
    assert.equal(rows.filter(r=>r.classList.contains('reveal')).length, 1);
    assert.equal(tree.scrollTop, k*28-(280-28)/2, '그 줄이 트리 세로 가운데');
    rows.find(r=>r.dataset.dkey==='0:z.txt').click(); await env.flush(12);
    assert.equal(tree.querySelectorAll('.dt-row.reveal').length, 0, '다른 줄을 누르면 강조가 풀린다');
  } finally {
    window.HTMLElement.prototype.getBoundingClientRect=origGB; delete window.HTMLElement.prototype.offsetHeight; delete tree.clientHeight;
  }
});

test('v3.8.14 MD 편집 색 층: 제목 줄(# ~ ######, 앞 공백 3칸까지)은 위쪽 내용과 상관없이 제목 색 · 코드 울타리 안은 그대로', async () => {
  const {codeHtml} = await import('../../src/docs-view.js');
  const sections = async text => {
    const d=env.window.document.createElement('div'); d.innerHTML=await codeHtml(text, 'markdown');
    assert.equal(d.textContent, text, '색 층의 글자는 입력칸과 같다(글자 추가·빠짐 없음)');
    return [...d.querySelectorAll('.hljs-section')].map(s=>s.textContent.trim());
  };
  // 1) 앞 공백이 있는 제목
  assert.deepEqual(await sections('- 목록\n   ## 들여쓴 제목\n본문'), ['## 들여쓴 제목']);
  // 2) 위쪽의 닫지 않은 ** · * · _ 가 아래 제목까지 번지지 않는다
  for(const open of ['**굵게 시작', '*기울임 시작', '_밑줄 시작']){
    const s=await sections(`${open} 안 닫음\n\n## 제목 하나\n\n본문\n### 제목 둘`);
    assert.deepEqual(s, ['## 제목 하나','### 제목 둘'], open);
  }
  // 3) 닫지 않은 ``` 아래는 코드라 제목 색이 아니다 · 닫힌 울타리 안의 # 도 코드
  assert.deepEqual(await sections('# 위 제목\n```\n## 코드 속\n'), ['# 위 제목']);
  assert.deepEqual(await sections('~~~sh\n# 주석\n~~~\n## 뒤 제목'), ['## 뒤 제목']);
  assert.deepEqual(await sections('````\n```\n# 안쪽\n````\n# 밖'), ['# 밖'], '짧은 울타리로는 닫히지 않는다');
  // 제목이 아닌 것: 4칸 들여쓰기 · #뒤 공백 없음 · 7개
  assert.deepEqual(await sections('    ## 코드\n#해시태그\n####### 일곱'), []);
  // 줄 끝의 # 하나도 제목(빈 제목)
  assert.deepEqual(await sections('본문\n#\n끝'), ['#']);
  // 강조 색은 그대로 나온다(같은 문단 안)
  assert.match(await codeHtml('**굵게** 글', 'markdown'), /hljs-strong/);
  // md 가 아닌 언어는 예전 그대로
  const sql=await codeHtml('SELECT 1', 'sql'); assert.match(sql, /hljs-keyword">SELECT</);
});

test('v3.8.16 찾기를 지우면 그려 둔 트리를 그대로 다시 보인다(다시 만들지 않음) · 스크롤 자리 · 고른 줄 · 폴더가 바뀌었으면 다시 그린다', async () => {
  await env.resetS(); S.loaded = true;
  S.settings.docRoots=['A:\하나'];
  const big=[]; for(let k=0;k<250;k++){ const n='f'+String(k).padStart(3,'0')+'.txt'; big.push({name:n, rel:'큰/'+n, dir:false, size:1, mtime:1}); }
  fakeFs(()=>({'0:':[{name:'큰',rel:'큰',dir:true,size:0,mtime:1},{name:'작은',rel:'작은',dir:true,size:0,mtime:1}], '0:큰':big, '0:작은':[{name:'a.txt',rel:'작은/a.txt',dir:false,size:1,mtime:1}]}));
  S.settings.docOpen=['0:','0:큰']; S.settings.docSeen=['A:\하나'];
  let hit={rel:'큰/f005.txt', name:'f005.txt', dir:false, hit:'name', snippet:''};
  env.onInvoke('doc_search', ()=>[hit]);
  env.onInvoke('doc_read_text', ()=>({text:'본문', encoding:'utf-8', mtime:1}));
  await openDocs();
  const tree=$('dt-tree');
  /* 줄 묶음: 100줄씩, 높이는 줄 높이 합(스크롤 길이가 예전과 같게) */
  const chunks=[...tree.querySelectorAll('.dt-rows .dt-chunk')];
  assert.equal(chunks.length, 3, '폴더 줄 2 + 큰 폴더 파일 250 = 252줄 → 100줄씩 3묶음');
  assert.match(chunks[0].getAttribute('style'), /contain-intrinsic-height:auto 2800px/);
  assert.match(chunks[2].getAttribute('style'), /contain-intrinsic-height:auto 1456px/, '52줄 × 28px');
  assert.equal(chunks[0].querySelectorAll('.dt-row').length, 100);
  const kept=row('0:큰/f200.txt'), rowsBox=tree.querySelector('.dt-rows');
  tree.scrollTop=1234;
  const s=$('dc-search'); s.value='f005'; s.dispatchEvent(new env.window.Event('input',{bubbles:true}));
  mock.timers.tick(350); await env.flush(10);
  assert.ok(tree.classList.contains('searching'));
  assert.ok(row('0:큰/f005.txt').classList.contains('dt-hit'), '찾는 동안 같은 열쇠의 결과 줄이 먼저 잡힌다');
  click(row('0:큰/f005.txt')); await env.flush(12);
  assert.equal($('dv-ta').value, '본문');
  s.dispatchEvent(new env.window.KeyboardEvent('keydown',{key:'Escape', bubbles:true, cancelable:true})); await env.flush(4);
  assert.ok(!tree.classList.contains('searching'));
  assert.equal(tree.querySelector('.dt-hitlist').children.length, 0, '결과 줄은 치운다');
  assert.strictEqual(tree.querySelector('.dt-rows'), rowsBox); assert.strictEqual(row('0:큰/f200.txt'), kept, '트리 줄을 다시 만들지 않았다');
  assert.equal(tree.scrollTop, 1234, '찾기 전 스크롤 자리');
  assert.ok(row('0:큰/f005.txt').classList.contains('on'), '결과에서 고른 파일이 트리에서도 골라져 있다');
  assert.equal(tree.querySelectorAll('.dt-rows .dt-row.on').length, 1, '고른 줄은 하나');
  /* 접혀 있던 폴더의 결과를 고르면 폴더가 펼쳐지므로, 지울 때 트리를 새로 그린다 */
  hit={rel:'작은/a.txt', name:'a.txt', dir:false, hit:'name', snippet:''};
  S.settings.docOpen=S.settings.docOpen.filter(k=>k!=='0:작은');
  s.value='a.txt'; s.dispatchEvent(new env.window.Event('input',{bubbles:true}));
  mock.timers.tick(350); await env.flush(10);
  click(row('0:작은/a.txt')); await env.flush(12);
  s.value=''; s.dispatchEvent(new env.window.Event('input',{bubbles:true})); await env.flush(4);
  assert.ok(row('0:작은/a.txt') && row('0:작은/a.txt').classList.contains('on'));
  assert.notStrictEqual(row('0:큰/f200.txt'), kept, '펼침이 바뀌었으면 새로 그렸다');
  assert.equal(tree.querySelectorAll('.dt-rows .dt-row.on').length, 1);
});

test('v3.8.16 파일을 누르면 트리 줄을 다시 만들지 않고 고른 줄 표시만 옮긴다 · 이름 바꾸기를 그만두면 줄이 되돌아온다', async () => {
  await env.resetS(); S.loaded = true;
  S.settings.docRoots=['A:\하나'];
  fakeFs(()=>({'0:':[{name:'가.txt',rel:'가.txt',dir:false,size:1,mtime:1},{name:'나.txt',rel:'나.txt',dir:false,size:1,mtime:1}]}));
  env.onInvoke('doc_read_text', ()=>({text:'본문', encoding:'utf-8', mtime:1}));
  await openDocs();
  const ga=row('0:가.txt'), na=row('0:나.txt');
  click(ga); await env.flush(10);
  assert.strictEqual(row('0:가.txt'), ga, '같은 줄 그대로'); assert.ok(ga.classList.contains('on'));
  click(na); await env.flush(10);
  assert.strictEqual(row('0:나.txt'), na); assert.ok(na.classList.contains('on')); assert.ok(!ga.classList.contains('on'));
  assert.equal(doc.querySelectorAll('#dt-tree .dt-row.on').length, 1);
  /* 이름 바꾸기 입력칸은 줄을 직접 바꾼다 — ESC 로 그만두면 줄이 다시 그려져 이름이 돌아온다 */
  na.dispatchEvent(new env.window.KeyboardEvent('keydown',{key:'F2', bubbles:true, cancelable:true})); await env.flush(4);
  const inp=doc.querySelector('#dt-tree .dt-rename');
  assert.ok(inp, 'F2 로 이름 바꾸기'); { inp.dispatchEvent(new env.window.KeyboardEvent('keydown',{key:'Escape', bubbles:true, cancelable:true})); await env.flush(6);
    assert.ok(!doc.querySelector('#dt-tree .dt-rename')); assert.equal(row('0:나.txt').querySelector('.dt-name').textContent, '나.txt'); }
});

test('v3.8.16 큰 폴더를 고르면 가운데 파일 목록을 100줄 묶음으로(첫 묶음만 바로, 나머지는 화면 밖이면 건너뜀) · 작은 폴더는 예전 그대로', async () => {
  await env.resetS(); S.loaded = true;
  S.settings.docRoots=['A:\하나'];
  const many=n=>Array.from({length:n},(_,k)=>({name:'f'+k+'.txt', rel:'d'+n+'/f'+k+'.txt', dir:false, size:1, mtime:1}));
  fakeFs(()=>({'0:':[{name:'d250',rel:'d250',dir:true,size:0,mtime:1},{name:'d200',rel:'d200',dir:true,size:0,mtime:1}], '0:d250':many(250), '0:d200':many(200)}));
  S.settings.docOpen=['0:']; S.settings.docSeen=['A:\\하나'];
  await openDocs();
  click(row('0:d250').querySelector('.dt-name')); await env.flush(10);
  const ch=[...doc.querySelectorAll('#dv-body .dv-flist > .dv-fchunk')];
  assert.deepEqual(ch.map(c=>c.children.length), [100,100,50]);
  assert.ok(!ch[0].classList.contains('dv-cv') && ch[1].classList.contains('dv-cv'), '첫 묶음은 늘 그린다');
  assert.equal(doc.querySelectorAll('#dv-body .dv-frow').length, 250);
  click(row('0:d200').querySelector('.dt-name')); await env.flush(10);
  assert.equal(doc.querySelectorAll('#dv-body .dv-fchunk').length, 0, '200줄 이하는 묶지 않는다');
  assert.equal(doc.querySelectorAll('#dv-body .dv-flist > .dv-frow').length, 200);
});

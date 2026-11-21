/* v3.8.0 문서 탭 — 미리보기 변환(HWPX·PPTX·XLSX) · 트리·메모 배선 · 오른쪽 업무 메모.
   핵심 불변식: (1) 화면은 상대 경로만 넘기고 파일을 쓰는 명령은 부르지 않는다. (2) 오른쪽 메모는 보드와 같은 업무 데이터다(따로 저장하지 않는다). */
import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {setupEnv} from '../helpers/env.js';

mock.timers.enable({apis:['setTimeout','setInterval']});
const env = setupEnv();
const require = createRequire(import.meta.url);
const XLSX = require('../../src/vendor/xlsx.full.min.js');
env.window.XLSX = XLSX; globalThis.XLSX = XLSX;
if(!globalThis.DOMParser) globalThis.DOMParser = env.window.DOMParser;
const {S} = await import('../../src/state.js');
const {docKind, openLabel, unzip, hwpxHtml, pptxHtml, xlsxBook} = await import('../../src/docs-view.js');
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
  assert.deepEqual(['a.HWPX','b.hwp','c.pptx','d.xlsx','e.csv','f.pdf','g.PNG','h.md','i.txt','j.json','k.mp4','l.docx','m.zip','noext'].map(docKind),
    ['hwpx','hwp','pptx','xlsx','csv','pdf','img','md','text','text','media','docx','other','other']);
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

test('탐색기 미리 보기: 처리기가 있으면 자리(물리 px)를 넘겨 띄우고, 다른 파일로 가면 앞 창을 닫는다', async () => {
  await env.resetS(); S.loaded = true;
  S.settings.docRoots=['H:\\한글'];
  fakeFs(()=>({'0:':[{name:'a.hwpx',rel:'a.hwpx',dir:false,size:1,mtime:1},{name:'b.hwp',rel:'b.hwp',dir:false,size:1,mtime:1}]}));
  env.onInvoke('doc_preview_open', ()=>true);
  env.onInvoke('doc_preview_show', ()=>null);
  env.onInvoke('doc_preview_place', ()=>null);
  await openDocs();
  click(row('0:a.hwpx')); await env.flush(10);
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
  click(row('0:b.hwp')); await env.flush(10);
  assert.ok(env.invokeCalls.filter(c=>c.cmd==='doc_preview_close').length>n0, '다른 파일로 가면 앞 창을 닫는다');
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
  assert.equal($('dv-ta').style.display, 'none');
  click(doc.querySelector('[data-tmode="edit"]')); await env.flush(6);
  assert.equal(S.settings.docMdMode, 'edit');
  assert.equal($('dv-ta').style.display, '');
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
  click($('dn-add')); await env.flush(6);
  assert.ok(isOpen('formPanel'));
  assert.equal(doc.querySelector('#fm-files .ffile-path').value, 'D:\\공유\\가 폴더');
  $('fm-memo').value='회신 기한 11.28';
  click($('fm-save')); await env.flush(6);
  assert.equal(S.items.length, 1);
  assert.deepEqual(S.items[0].files, ['D:\\공유\\가 폴더']);
  assert.deepEqual(memos(), ['회신 기한 11.28']);
  openForm({files:['D:\\공유\\가 폴더\\보고.zip', 'C:\\밖\\x.txt']}); await env.flush(4);
  const btns=[...doc.querySelectorAll('#fm-files .ffile-doc')];
  assert.deepEqual(btns.map(b=>b.style.display), ['', 'none'], '문서 폴더 안 링크에만 [문서]');
  doc.querySelectorAll('.tab').forEach(t=>t.classList.toggle('on', t.dataset.view==='board'));
  click(btns[0]); await env.flush(14);
  assert.ok(!isOpen('formPanel'), '양식을 닫고');
  assert.ok($('view-docs').classList.contains('on'), '문서 탭으로');
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

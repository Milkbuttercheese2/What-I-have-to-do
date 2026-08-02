/* 미니 창(빠른 메모·빠른 검색) 종합 검증 — 실기기 조건을 흉내 낸 실렌더 검사 (v3.4.9)
 *
 * 왜 이게 필요한가
 *   v3.2~v3.4.8 에서 "행이 다 안 보인다"를 여섯 번 고치고도 매번 되돌아왔다. 원인은
 *   Windows 접근성의 **텍스트 크기 조정**(이 프로젝트 소유자 기기 135%)이 WebView2 에서
 *   페이지 확대로 곱해지는 것이었는데, 브라우저 프로브에는 그 조건이 없어 늘 정상으로
 *   나왔다. 그래서 이 도구는 **그 불일치를 직접 재현한다**:
 *     실제 배율 Z = uiScale(1.2) × 텍스트 배율(1.35) = 1.62
 *     창(논리 px) = Rust 가 정함 → 웹뷰가 보는 CSS px = 창 ÷ Z
 *   그리고 Rust 의 `note_capture_ratio` 와 같은 계산(창 논리 폭 ÷ innerWidth)을 그대로
 *   구현해, 프런트↔Rust 왕복 전체를 검증한다.
 *
 * 실행:  node tools/capture-check.mjs            (기본 배율 1.2 × 1.35)
 *        UI=1.0 TEXT=1.0 node tools/capture-check.mjs   (배율 없는 환경)
 * 준비:  npm i --no-save playwright-core   (설치돼 있으면 그대로 씀 · Edge 사용)
 * 결과:  케이스별 PASS/FAIL 표. FAIL 이 하나라도 있으면 종료 코드 1.
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import {fileURLToPath, pathToFileURL} from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const UI = Number(process.env.UI || 1.2);        // 앱 화면 크기 설정(uiScale)
const TEXT = Number(process.env.TEXT || 1.35);   // Windows 텍스트 크기 조정
const Z = UI * TEXT;                             // 웹뷰가 실제로 그리는 배율
const CAPTURE_W = 600;                           // commands.rs CAPTURE_W 와 같아야 한다
const PB_MAX_ROWS = 10;                          // capture-win.js PB_MAX_ROWS 와 같아야 한다

const pw = await import(pathToFileURL(path.join(ROOT, 'node_modules', 'playwright-core', 'index.js')).href);
const chromium = (pw.default && pw.default.chromium) || pw.chromium;
const MIME = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.woff2':'font/woff2'};
const server = http.createServer((q, r) => {
  const p = path.join(SRC, decodeURIComponent(q.url.split('?')[0]).replace(/^\//, ''));
  try { const b = fs.readFileSync(p); r.writeHead(200, {'Content-Type': MIME[path.extname(p)] || 'application/octet-stream'}); r.end(b); }
  catch { r.writeHead(404); r.end(); }
});
await new Promise(r => server.listen(0, r));
const PORT = server.address().port;
const browser = await chromium.launch({channel: 'msedge'});

/* ── 검사 대상 상태 안에서 확인할 불변식 ──────────────────────────────────
   페이지 안에서 도는 코드다. 하나라도 깨지면 그 케이스는 FAIL. */
const CHECKS = `(() => {
  const out = [];
  const R = el => el.getBoundingClientRect();
  const add = (ok, name, detail) => out.push({ok: !!ok, name, detail: detail == null ? '' : String(detail)});
  const doc = document.scrollingElement;
  const shell = document.getElementById('cap-shell');
  const body = document.body;
  const memo = body.classList.contains('search') ? null : document.getElementById('cap-inp');
  const pb = document.getElementById('cap-pb');
  const items = document.getElementById('cap-items');

  // 1) 창이 스크롤되어 내용이 잘려 올라가면 안 된다
  add(doc.scrollTop === 0, '창 스크롤 0', 'body ' + doc.scrollTop);
  add(shell.scrollTop === 0, '패널 스크롤 0', 'shell ' + shell.scrollTop);

  // 2) 패널이 창 안에 들어와야 한다 (아래가 잘리면 목록·힌트가 사라진다)
  add(R(shell).bottom <= innerHeight + 1, '패널이 창 안', Math.round(R(shell).bottom) + ' vs ' + innerHeight);
  add(shell.scrollHeight <= shell.clientHeight + 1, '패널 내용 넘침 없음',
      shell.scrollHeight + '>' + shell.clientHeight);

  // 3) 가로 넘침 없음
  add(doc.scrollWidth <= doc.clientWidth + 1, '가로 넘침 없음', doc.scrollWidth + '>' + doc.clientWidth);

  // 4) 힌트줄은 언제나 보인다 (조작 안내가 잘리면 안 된다)
  const hint = document.getElementById('cap-hint');
  add(R(hint).bottom <= innerHeight + 1 && R(hint).top >= -1, '힌트줄 보임', Math.round(R(hint).top) + '~' + Math.round(R(hint).bottom));
  {  // 힌트줄은 한 줄이어야 한다 (접히면 창 폭이 문구를 못 담는다는 뜻)
    const cs = getComputedStyle(hint);
    const lh = parseFloat(cs.lineHeight) || 16;
    const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const lines = Math.round((R(hint).height - pad) / lh);
    add(lines <= 1, '힌트줄 한 줄', lines + '줄');
  }

  // 5) 목록: 보이는 행은 전부 온전해야 하고, 상한은 min(N,10) 이다
  const listOf = (box, sel) => {
    if (!box || getComputedStyle(box).display === 'none') return null;
    const rows = [...box.querySelectorAll(sel)];
    if (!rows.length) return null;
    const b = R(box);
    const fully = rows.filter(r => R(r).top >= b.top - 0.5 && R(r).bottom <= b.bottom + 0.5).length;
    const peek = rows.filter(r => R(r).top < b.bottom - 0.5 && R(r).bottom > b.bottom + 0.5).length;
    const firstOk = R(rows[0]).top >= b.top - 0.5 && R(rows[0]).bottom <= b.bottom + 0.5;
    return {n: rows.length, fully, peek, firstOk, scrollTop: Math.round(box.scrollTop)};
  };
  /* 목록을 사용자가 일부러 내린 상태에서는 첫 행이 안 보이는 것이 정상이다.
     맨 위(scrollTop 0)일 때만 '첫 행 온전 · 11번째 행 빼꼼 없음'을 요구하고,
     그 밖에는 **고른 행이 온전히 보이는가**를 본다. */
  const selOk = (box, sel) => {
    const el = box && box.querySelector(sel + '.sel');
    if (!el) return null;
    const b = R(box), r = R(el);
    return r.top >= b.top - 0.5 && r.bottom <= b.bottom + 0.5;
  };
  const L = listOf(pb, '.cap-pb-it');
  if (L) {
    add(L.fully >= Math.min(L.n, ${PB_MAX_ROWS}), '@목록 ' + Math.min(L.n, ${PB_MAX_ROWS}) + '행 온전', '온전 ' + L.fully + '/' + L.n);
    if (L.scrollTop === 0) {
      add(L.firstOk, '@목록 첫 행 온전', 'scrollTop 0');
      add(L.peek === 0, '@목록 반쯤 걸친 행 없음', '빼꼼 ' + L.peek);
    }
    const so = selOk(pb, '.cap-pb-it');
    if (so !== null) add(so, '@목록 고른 행 온전', 'scrollTop ' + L.scrollTop);
  }
  const S = listOf(items, '.cap-hit');
  if (S && !body.classList.contains('pb')) {
    if (S.scrollTop === 0) add(S.firstOk, '검색 첫 행 온전', 'scrollTop 0');
    const so = selOk(items, '.cap-hit');
    if (so !== null) add(so, '검색 고른 행 온전', 'scrollTop ' + S.scrollTop);
  }

  // 5-2) 입력칸이 통째로 보여야 한다 — 긴 메모에서 첫 줄이 창 위로 잘리던 버그(v3.4.9)
  /* 등록 플래시(body.flash) 중에는 입력줄 자체가 숨는다 — 그때는 검사 대상이 아니다 */
  const barEl = document.getElementById('cap-bar');
  const memoShown = memo && getComputedStyle(memo).display !== 'none'
                 && getComputedStyle(barEl).display !== 'none' && memo.clientHeight > 0;
  if (memoShown) {
    const m = R(memo), bar = R(barEl);
    add(m.top >= -0.5 && m.bottom <= innerHeight + 0.5, '입력칸이 창 안', Math.round(m.top) + '~' + Math.round(m.bottom) + ' / ' + innerHeight);
    add(m.top >= bar.top - 0.5 && m.bottom <= bar.bottom + 0.5, '입력칸이 입력줄 안', Math.round(m.top - bar.top) + ',' + Math.round(bar.bottom - m.bottom));
    /* 한도에 걸려 스크롤될 때 마지막 줄이 반쯤 걸치면 안 된다 — 줄 단위로 맞춰야 한다 */
    const cs = getComputedStyle(memo);
    const lh = parseFloat(cs.lineHeight) || 21;
    const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const inner = memo.clientHeight - pad;
    add(Math.abs(inner - Math.round(inner / lh) * lh) < 1.5, '입력칸에 반 줄 없음',
        inner.toFixed(1) + ' / 행간 ' + lh);
    /* (검사하지 않음) 메모가 한도(4줄)를 넘겨 스크롤될 때 맨 윗줄이 몇 px 걸쳐
       보이는 것은 일반 입력칸과 같은 동작이다. 줄 경계까지 맞추려면 패딩을 바깥
       상자로 옮겨야 하는데(그래야 캐럿 기준 스크롤이 행 배수가 된다) 위험 대비
       이득이 적어 두었다. 여기서 막는 것은 '창이 내용을 자르는' 종류의 결함이다. */
  }

  // 6) 태그 하이라이트 백드롭이 입력칸과 같은 위치여야 한다
  if (memoShown) {
    const hl = document.getElementById('cap-hl');
    add(hl.scrollTop === memo.scrollTop, '하이라이트 스크롤 동기', 'hl ' + hl.scrollTop + ' vs inp ' + memo.scrollTop);
    /* 백드롭과 입력칸의 **글자 배치가 같은가** — 폰트·행간·패딩이 하나라도 어긋나면
       내용 높이가 달라진다. 태그가 화면 밖으로 스크롤된 경우까지 포함해 늘 성립해야 한다. */
    /* 허용치가 한 줄(21px)인 이유: 백드롭은 끝에 빈 줄 하나를 더 그린다(textarea 가
       마지막 줄 뒤에 캐럿 자리를 두는 것과 맞추려고 — form.js 와 같은 기법).
       그 상수 차이는 정렬과 무관하고, **줄마다 누적되면** 폰트·행간이 어긋난 것이다
       (실측: 1·2줄에서 4px, 5·12·20줄에서 0px → 누적 없음). */
    add(Math.abs(hl.scrollHeight - memo.scrollHeight) <= 24, '백드롭 글자 배치 일치',
        hl.scrollHeight + ' vs ' + memo.scrollHeight);
  }

  // 7) 좌우 대칭 — 행 글자의 좌우 여백이 같아야 한다
  const anyRow = (pb && pb.querySelector('.cap-pb-it')) || (items && items.querySelector('.cap-hit'));
  if (anyRow && getComputedStyle(anyRow.parentElement).display !== 'none') {
    const r = R(anyRow);
    const left = Math.round(r.left), right = Math.round(innerWidth - r.right);
    add(Math.abs(left - right) <= 1, '행 좌우 대칭', left + ' / ' + right);
  }

  // 8) 창 폭은 설계값 그대로
  add(Math.abs(innerWidth - ${CAPTURE_W}) <= 2, '창 폭 ${CAPTURE_W}', innerWidth);
  return out;
})()`;

const PEOPLE = n => Array.from({length: n}, (_, i) => ({
  id: i + 1, who: '사람' + String(i + 1).padStart(2, '0'), org: '조달청',
  phone: '010-' + (2000 + i) + '-' + (1000 + i * 7),
}));
const TASKS = n => Array.from({length: n}, (_, i) => ({id: i + 1, memo: '업무 ' + (i + 1) + ' 상세 내용', done: i % 3 === 0}));

async function newWin({people = 5, tasks = 5} = {}) {
  let logicalW = CAPTURE_W, logicalH = 150;                 // tauri.conf 초기값
  const css = () => ({width: Math.max(50, Math.round(logicalW / Z)), height: Math.max(50, Math.round(logicalH / Z))});
  const ctx = await browser.newContext({viewport: css()});
  const page = await ctx.newPage();
  const resizes = [];
  await page.exposeFunction('__resize', async (h, vw) => {
    if (vw > 0) {                                          // Rust note_capture_ratio 와 동일
      const r = logicalW / vw;
      if (isFinite(r) && r >= 0.5 && r <= 5) newWin.ratio = r;
    }
    const ratio = newWin.ratio || UI;
    const hc = Math.max(64, Math.min(640, Math.round(h)));
    logicalW = CAPTURE_W * ratio;
    logicalH = hc * ratio;
    resizes.push(Math.round(logicalH));
    await page.setViewportSize(css());
  });
  await page.addInitScript(({people, tasks}) => {
    window.__TAURI__ = {
      core: {invoke: async (c, a) => {
        if (c === 'resize_capture') { window.__resize(a.height, a.viewportWidth); return; }
        if (c === 'quick_search') return tasks;
        if (c === 'phonebook_search') return people;
        if (c === 'phonebook_list') return people;
        return undefined; }},
      event: {listen: async () => () => {}, emitTo: async () => {}},
      window: {getCurrentWindow: () => ({hide: async () => {}})},
    };
  }, {people: PEOPLE(people), tasks: TASKS(tasks)});
  await page.goto(`http://127.0.0.1:${PORT}/capture.html`);
  await page.waitForTimeout(350);
  return {page, ctx, resizes, size: () => ({logicalW: Math.round(logicalW), logicalH: Math.round(logicalH)})};
}

const results = [];
async function run(name, people, tasks, steps) {
  newWin.ratio = null;
  const w = await newWin({people, tasks});
  try {
    await steps(w.page);
    const checks = await w.page.evaluate(CHECKS);
    const bad = checks.filter(c => !c.ok);
    results.push({name, ok: bad.length === 0, bad, size: w.size(), resizes: w.resizes});
  } catch (e) {
    results.push({name, ok: false, bad: [{name: '실행 오류', detail: e.message}], size: w.size(), resizes: w.resizes});
  }
  await w.ctx.close();
}

const toMemo = async page => { await page.keyboard.press('Alt'); await page.waitForTimeout(300); };
const typeMemo = async (page, text) => { await page.focus('#cap-inp'); await page.keyboard.type(text); await page.waitForTimeout(700); };

/* ── 케이스 ──────────────────────────────────────────────────────────── */
/* 첫 화면이 '빠른 메모'인 설정(capStart=memo)으로 뜨는 경로 — 입력칸이 처음부터 보인다.
   숨어 있을 때 잰 0 이 높이로 굳으면 이 케이스에서 드러난다. */
await run('첫 화면이 빠른 메모(설정)', 5, 5, async p => {
  await p.evaluate(() => { localStorage.setItem('wmhhCapStart', 'memo'); localStorage.setItem('wmhhCapSecond', 'search'); });
  await p.reload(); await p.waitForTimeout(600);
  await p.focus('#cap-inp'); await p.keyboard.type('첫 화면 메모');
  await p.waitForTimeout(600);
});
await run('첫 화면이 빠른 메모 + 긴 메모', 5, 5, async p => {
  await p.evaluate(() => { localStorage.setItem('wmhhCapStart', 'memo'); localStorage.setItem('wmhhCapSecond', 'search'); });
  await p.reload(); await p.waitForTimeout(600);
  await p.focus('#cap-inp');
  await p.keyboard.type(Array.from({length: 9}, (_, i) => '줄 ' + (i + 1)).join('\n'));
  await p.waitForTimeout(700);
});
await run('검색: 결과 없음', 5, 0, async p => { await p.focus('#cap-search'); await p.keyboard.type('없는말'); await p.waitForTimeout(600); });
await run('검색: 3건', 5, 3, async p => { await p.focus('#cap-search'); await p.keyboard.type('업무'); await p.waitForTimeout(600); });
await run('검색: 30건', 5, 30, async p => { await p.focus('#cap-search'); await p.keyboard.type('업무'); await p.waitForTimeout(600); });
await run('검색: 30건 + 아래끝 스크롤', 5, 30, async p => {
  await p.focus('#cap-search'); await p.keyboard.type('업무'); await p.waitForTimeout(600);
  await p.evaluate(() => { const l = document.getElementById('cap-items'); l.scrollTop = l.scrollHeight; });
  await p.waitForTimeout(200);
});
await run('검색: ↓ 25회 이동', 5, 30, async p => {
  await p.focus('#cap-search'); await p.keyboard.type('업무'); await p.waitForTimeout(600);
  for (let i = 0; i < 25; i++) { await p.keyboard.press('ArrowDown'); await p.waitForTimeout(25); }
  await p.waitForTimeout(200);
});
await run('메모: 빈 상태', 5, 5, async p => { await toMemo(p); });
await run('메모: 한 줄', 5, 5, async p => { await toMemo(p); await typeMemo(p, '전화 회신 건'); });
await run('메모: 12줄(스크롤 발생)', 5, 5, async p => {
  await toMemo(p);
  await typeMemo(p, Array.from({length: 12}, (_, i) => '메모 줄 ' + (i + 1)).join('\n'));
});
await run('메모: 12줄 + 끝에 @태그', 5, 5, async p => {
  await toMemo(p);
  await typeMemo(p, Array.from({length: 12}, (_, i) => '메모 줄 ' + (i + 1)).join('\n') + '\n@사람01');
});
await run('메모: 앞줄 @태그 + 12줄', 5, 5, async p => {
  await toMemo(p);
  await typeMemo(p, '@사람01 통화\n' + Array.from({length: 12}, (_, i) => '메모 줄 ' + (i + 1)).join('\n'));
});
for (const n of [1, 5, 10, 12, 50]) {
  await run(`@자동완성: 후보 ${n}명`, n, 5, async p => { await toMemo(p); await typeMemo(p, '통화 @사람'); });
}
await run('@자동완성: 후보 50명 + ↓ 20회', 50, 5, async p => {
  await toMemo(p); await typeMemo(p, '통화 @사람');
  for (let i = 0; i < 20; i++) { await p.keyboard.press('ArrowDown'); await p.waitForTimeout(25); }
  await p.waitForTimeout(200);
});
await run('@자동완성: ↓20 후 ↑20 (되돌아오기)', 50, 5, async p => {
  await toMemo(p); await typeMemo(p, '통화 @사람');
  for (let i = 0; i < 20; i++) { await p.keyboard.press('ArrowDown'); await p.waitForTimeout(20); }
  for (let i = 0; i < 20; i++) { await p.keyboard.press('ArrowUp'); await p.waitForTimeout(20); }
  await p.waitForTimeout(200);
});
await run('@자동완성 → 선택 삽입(Enter)', 12, 5, async p => {
  await toMemo(p); await typeMemo(p, '통화 @사람');
  await p.keyboard.press('ArrowDown'); await p.waitForTimeout(100);
  await p.keyboard.press('Enter'); await p.waitForTimeout(600);
});
await run('@자동완성 → ESC 로 접기', 12, 5, async p => {
  await toMemo(p); await typeMemo(p, '통화 @사람');
  await p.keyboard.press('Escape'); await p.waitForTimeout(500);
});
await run('@자동완성 열고 → 검색 화면 전환', 12, 30, async p => {
  await toMemo(p); await typeMemo(p, '통화 @사람');
  await p.keyboard.press('Alt'); await p.waitForTimeout(600);
});
await run('모드 토글 10회 왕복', 12, 30, async p => {
  for (let i = 0; i < 10; i++) { await p.keyboard.press('Alt'); await p.waitForTimeout(150); }
  await p.waitForTimeout(400);
});
await run('메모: 아주 긴 한 줄(가로 넘침 검사)', 5, 5, async p => {
  await toMemo(p); await typeMemo(p, '가'.repeat(400));
});
await run('메모: 등록 플래시 상태', 5, 5, async p => {
  await toMemo(p); await typeMemo(p, '등록할 메모');
  await p.keyboard.press('Control+Enter'); await p.waitForTimeout(200);
});
await run('@자동완성: 이름·소속·번호가 아주 긴 후보', 6, 5, async p => {
  await p.evaluate(() => {
    const long = Array.from({length: 6}, (_, i) => ({id: i + 1,
      who: '아주아주긴이름' + '가'.repeat(12) + i, org: '엄청나게긴소속기관명칭' + '나'.repeat(14),
      phone: '010-1234-5678 (내선 12345)'}));
    const inv = window.__TAURI__.core.invoke;
    window.__TAURI__.core.invoke = async (c, a) => (c === 'phonebook_search' || c === 'phonebook_list') ? long : inv(c, a);
  });
  await toMemo(p); await typeMemo(p, '통화 @아주');
});
await run('검색: 아주 긴 메모의 결과', 5, 8, async p => {
  await p.evaluate(() => {
    const long = Array.from({length: 8}, (_, i) => ({id: i + 1, memo: '아주 긴 업무 제목 ' + '다'.repeat(120) + i, done: false}));
    const inv = window.__TAURI__.core.invoke;
    window.__TAURI__.core.invoke = async (c, a) => c === 'quick_search' ? long : inv(c, a);
  });
  await p.focus('#cap-search'); await p.keyboard.type('업무'); await p.waitForTimeout(700);
});
await run('@자동완성: 후보 11명 (상한 경계)', 11, 5, async p => { await toMemo(p); await typeMemo(p, '통화 @사람'); });
await run('@자동완성: 후보 9명 (상한 직전)', 9, 5, async p => { await toMemo(p); await typeMemo(p, '통화 @사람'); });
await run('@자동완성: 글자 지워 후보가 줄어드는 경우', 12, 5, async p => {
  await toMemo(p); await typeMemo(p, '통화 @사람01');
  await p.evaluate(() => {
    const few = [{id: 1, who: '사람01', org: '조달청', phone: '010-1'}];
    const inv = window.__TAURI__.core.invoke;
    window.__TAURI__.core.invoke = async (c, a) => (c === 'phonebook_search') ? few : inv(c, a);
  });
  await p.keyboard.press('Backspace'); await p.waitForTimeout(700);
});
await run('긴 메모 → 자동완성 → 검색 → 메모 복귀', 12, 30, async p => {
  await toMemo(p);
  await typeMemo(p, Array.from({length: 10}, (_, i) => '줄 ' + (i + 1)).join('\n') + '\n@사람');
  await p.keyboard.press('Alt'); await p.waitForTimeout(400);
  await p.keyboard.press('Alt'); await p.waitForTimeout(600);
});

await browser.close();
server.close();

/* ── 결과 ────────────────────────────────────────────────────────────── */
const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - [...String(s)].reduce((a, c) => a + (c.charCodeAt(0) > 0x2000 ? 2 : 1), 0)));
console.log(`\n미니 창 검증 — uiScale ${UI} × 텍스트배율 ${TEXT} = 실제 ${Z.toFixed(2)}배 · 창 폭 ${CAPTURE_W} CSS px\n`);
for (const r of results) {
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${pad(r.name, 34)} 창 ${r.size.logicalW}x${r.size.logicalH}`);
  for (const b of r.bad) console.log(`        ↳ ${b.name}${b.detail ? ' — ' + b.detail : ''}`);
}
const failed = results.filter(r => !r.ok).length;
console.log(`\n  ${results.length - failed} PASS / ${failed} FAIL\n`);
process.exit(failed ? 1 : 0);

/* 안내 문구가 부르는 단추 이름은 화면에 실제로 있는 이름이어야 한다(2026-11 표준용어).
   예전엔 안내가 옛 단추 이름([저장 위치 확인·변경]·[JSON·DB파일 불러오기]·[설정 → JSON파일 백업])을 불러
   사용자가 설정에서 그 단추를 찾지 못했다. 시작 실패 안내는 앞쪽 JS(main.js)와 Rust(commands.rs 두 곳)가
   같은 세 단계를 함께 보여 주므로(JS 안내 + '상세 오류'의 Rust 글) 두 벌의 글이 같아야 한다.
   사용설명서(tools/user-guide-source.mjs)도 같다 — 설명서가 부르는 단추·칸·창·시트 이름이 화면 코드에 있어야 하고,
   옛 이름·쓰지 않는 말이 없어야 한다(2026-11-27, v3.9.0 뒤 설명서 정비). 설명서는 .mjs 라 import 로 읽는다. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
function walk(dir, ext){
  const out = [];
  for(const e of fs.readdirSync(path.join(ROOT, dir), {withFileTypes:true})){
    const rel = path.join(dir, e.name);
    if(e.isDirectory()){ if(e.name!=='vendor') out.push(...walk(rel, ext)); }
    else if(ext.some(x=>e.name.endsWith(x))) out.push(rel);
  }
  return out;
}
const SOURCES = [...walk('src', ['.js', '.html']), ...walk(path.join('src-tauri', 'src'), ['.rs'])];
const html = read('src/index.html');
const settingLabels = new Set([...html.matchAll(/class="set-lab">([^<]+)</g)].map(m=>m[1].trim()));

test('설정 단추 이름표가 표준용어로 있다', () => {
  for(const n of ['저장 위치', '백업 파일 만들기', '백업에서 복원', '엑셀로 내보내기', '반복 업무'])
    assert.ok(settingLabels.has(n), n);
});

test('"[설정] → [X]" 꼴 안내가 부르는 X 는 모두 설정 화면에 있는 이름이다', () => {
  const cited = [];
  for(const rel of SOURCES){
    const c = read(rel);
    for(const m of c.matchAll(/\[설정\]\s*→\s*\[([^\]]+)\]|\[설정 → ([^\]]+)\]/g)) cited.push([rel, (m[1]||m[2]).trim()]);
  }
  assert.ok(cited.length >= 8, `안내를 찾았다(${cited.length}곳)`);
  for(const [rel, name] of cited) assert.ok(settingLabels.has(name), `${rel}: [${name}] 는 설정에 없는 이름`);
});

test('옛 단추 이름은 소스에 남지 않는다', () => {
  for(const rel of SOURCES){
    const c = read(rel);
    for(const old of ['저장 위치 확인·변경]', 'JSON·DB파일 불러오기', 'JSON파일 백업', '[엑셀 불러오기]'])
      assert.ok(!c.includes(old), `${rel}: ${old}`);
  }
});

/* ---- 사용설명서(tools/user-guide-source.mjs) ---- */
const guideText = async () => (await import(pathToFileURL(path.join(ROOT, 'tools', 'user-guide-source.mjs')).href)).default;
/* 설명서의 [대괄호]인데 단추·칸 이름이 아니라 메모에 쓰는 예시 글인 것(메모 구역 제목 설명) */
const GUIDE_EXAMPLES = new Set(['통화 내용', '남은 일', '제목', '긴급', '별표 2', '가', '나']);

test('설명서의 "[설정] → [X]" 는 설정 화면에 있는 이름이다', async () => {
  const g = await guideText();
  const cited = [...g.matchAll(/\[설정\]\s*→\s*\[([^\]]+)\]/g)].map(m=>m[1].trim());
  assert.ok(cited.length >= 6, `설명서 안내 ${cited.length}곳`);
  for(const name of cited) assert.ok(settingLabels.has(name), `설명서: [${name}] 는 설정에 없는 이름`);
});

test('설명서가 [대괄호]로 부르는 단추·칸 이름은 모두 화면 코드에 있다', async () => {
  const g = (await guideText()).split('\n').filter(l=>!/^!\[/.test(l)).join('\n');   // 그림 설명 줄은 뺀다
  const ui = SOURCES.map(read).join('\n');
  const names = new Set([...g.matchAll(/\[([^\]\[\n]+)\]/g)].flatMap(m=>m[1].split(' | ')).map(s=>s.trim()));
  assert.ok(names.size >= 60, `이름 ${names.size}개`);
  const missing = [...names].filter(n=>!GUIDE_EXAMPLES.has(n) && !ui.includes(n));
  assert.deepEqual(missing, [], '화면에 없는 이름');
});

test('설명서가 다루는 v3.9.0 화면 이름(공유 단추·엑셀 시트·알림 창)이 화면과 같다', async () => {
  const g = await guideText();
  const xl = read('src/xlsx-export.js'), lib = read('src-tauri/src/lib.rs');
  const sheets = /SHEET_NAMES=\{list:'([^']+)', contacts:'([^']+)', memo:'([^']+)', raw:'([^']+)'\}/.exec(xl);
  assert.ok(sheets, 'SHEET_NAMES');
  for(const s of sheets.slice(1)) assert.ok(g.includes(`| ${s} |`), `시트 표에 '${s}'`);
  for(const h of /LIST_HEAD=\[([^\]]+)\]/.exec(xl)[1].split(',').map(s=>s.replace(/'/g,'').trim()))
    assert.ok(g.includes(h), `업무 목록 열 '${h}'`);
  for(const id of ['share-img', 'share-text', 'share-save'])
    assert.ok(g.includes(`[${new RegExp(`id="${id}">([^<]+)<`).exec(html)[1]}]`), id);
  assert.ok(g.includes(`'${/<input type="checkbox" id="share-contacts">\s*([^<]+)</.exec(html)[1].trim()}'`), '연락처도 넣기');
  assert.ok(html.includes('시각 도래 알림') && g.includes("'시각 도래 알림'"), '알림 창 이름');
  assert.ok(lib.includes('.title("저장소 알림")') && g.includes("'저장소 알림'"), '저장소 알림');
  assert.ok(lib.includes('.title("실행 불가")') && g.includes("'실행 불가'"), '실행 불가');
  assert.ok(read('src/recur-box.js').includes("p.recur.paused?'재개':'정지'") && g.includes('[정지]') && g.includes('[재개]'), '반복 업무 정지·재개');
});

test('설명서에 옛 이름·쓰지 않는 말이 없다(표준용어)', async () => {
  const g = await guideText();
  for(const old of ['세부 할 일', '알람', '불러오기', '[업무 종료]', '현행', '주기 업무', '엮인 업무', '일시정지', '[새로고침]', '[엑셀 불러오기]', 'JSON파일 백업', '백업 내보내기'])
    assert.ok(!g.includes(old), old);
  assert.ok(!/마감(?!시각 →)/.test(g), "'마감'(엑셀 열 이름이 바뀐 것을 알리는 곳 말고)");
});

test('설명서 첫머리의 버전이 앱 버전과 같고, 설명서가 부르는 그림이 모두 있다', async () => {
  const g = await guideText();
  const v = JSON.parse(read('package.json')).version;
  assert.match(g, new RegExp(`^> v${v.replace(/\./g,'\\.')} 기준 · \\d{4}-\\d{2}-\\d{2}$`, 'm'));
  const shots = [...g.matchAll(/^!\[.*\]\(([^)\s]+\.png)\)$/gm)].map(m=>m[1]);   // 설명 안의 [제목] 대괄호도 받는다(PDF 도구와 같은 식)
  assert.ok(shots.length >= 16, `그림 ${shots.length}장`);
  for(const s of shots) assert.ok(fs.existsSync(path.join(ROOT, s)), s);
  for(const s of ['share.png', 'memo-sections.png', 'xlsx-list.png']) assert.ok(shots.includes(`docs/screenshots/${s}`), s);
});

test('시작 실패 안내 세 단계: main.js 와 commands.rs(두 곳)가 같은 글', () => {
  const js = read('src/main.js'), rs = read('src-tauri/src/commands.rs');
  const steps = [...js.matchAll(/'([123]\. [^'\\]+)(?:\\n)+'/g)].map(m=>m[1]);
  assert.equal(steps.length, 3, '1·2·3 단계');
  assert.match(steps[2], /\[백업에서 복원\]/);
  for(const s of steps) assert.equal(rs.split(s).length - 1, 2, `commands.rs 두 곳에 같은 글: ${s}`);
  const paren = '(데이터 폴더 안 backups 폴더의 최신 .sqlite 파일, 또는 따로 저장해 둔 JSON 백업)';
  assert.ok(js.includes(paren));
  assert.equal(rs.split(paren).length - 1, 2);
});

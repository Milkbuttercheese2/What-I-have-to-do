/* 안내 문구가 부르는 단추 이름은 화면에 실제로 있는 이름이어야 한다(2026-11 표준용어).
   예전엔 안내가 옛 단추 이름([저장 위치 확인·변경]·[JSON·DB파일 불러오기]·[설정 → JSON파일 백업])을 불러
   사용자가 설정에서 그 단추를 찾지 못했다. 시작 실패 안내는 앞쪽 JS(main.js)와 Rust(commands.rs 두 곳)가
   같은 세 단계를 함께 보여 주므로(JS 안내 + '상세 오류'의 Rust 글) 두 벌의 글이 같아야 한다. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

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

/* v3.8.25 보안 2차 — 창별 명령 권한. 세 목록(lib.rs generate_handler · build.rs COMMANDS · capabilities/*.json)이 어긋나면
   그 명령이 화면에서 소리 없이 거부된다(실행해 봐야 안다). 그래서 여기서 글자로 맞춰 본다. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const rd = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const kebab = c => 'allow-' + c.replace(/_/g, '-');

const handler = [...rd('src-tauri/src/lib.rs').match(/generate_handler!\[([\s\S]*?)\]/)[1].matchAll(/::([a-z_0-9]+)/g)].map(m => m[1]);
const built = [...rd('src-tauri/build.rs').match(/COMMANDS: &\[&str\] = &\[([\s\S]*?)\];/)[1].matchAll(/"([a-z_0-9]+)"/g)].map(m => m[1]);
const main = JSON.parse(rd('src-tauri/capabilities/default.json'));
const cap = JSON.parse(rd('src-tauri/capabilities/capture.json'));
const invokedIn = f => [...new Set([...rd(f).matchAll(/invoke\('([a-z_0-9]+)'/g)].map(m => m[1]))].sort();

test('build.rs 의 명령 목록 = lib.rs 에 등록한 명령', () => {
  assert.ok(handler.length > 40);
  assert.deepEqual([...built].sort(), [...handler].sort());
});

test('main 창은 모든 명령을 받는다', () => {
  for(const c of handler) assert.ok(main.permissions.includes(kebab(c)), `default.json 에 ${kebab(c)} 없음`);
  assert.deepEqual(main.windows, ['main']);
});

test('빠른 메모 창은 자기가 부르는 명령만 받는다', () => {
  const need = invokedIn('src/capture-win.js');
  const got = cap.permissions.filter(p => p.startsWith('allow-') && p !== 'core:window:allow-hide').sort();
  assert.deepEqual(got, need.map(kebab).sort(), 'capture.json = capture-win.js 가 invoke 하는 명령');
  assert.deepEqual(cap.windows, ['capture']);
  for(const bad of ['doc_import', 'doc_trash', 'save_all', 'open_file_path', 'backup_import']) assert.ok(!cap.permissions.includes(kebab(bad)), bad);
});

test('wmhhdoc 응답 모래상자: allow-same-origin 없음, sandbox allow-scripts 있음', () => {
  const csp = rd('src-tauri/src/docs.rs').match(/pub const DOC_CSP: &str = "([^"]*)"/)[1];
  assert.match(csp, /sandbox allow-scripts(;|$)/);
  assert.doesNotMatch(csp, /allow-same-origin|allow-popups|allow-top-navigation/);
});

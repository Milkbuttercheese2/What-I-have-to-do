/* 판 번호는 세 파일(package.json·Cargo.toml·tauri.conf.json)에 같이 적고, Cargo.lock 의 wmhh-desktop 도 따라가야 한다.
   lock 만 옛 번호로 남으면 그 뒤 빌드마다 작업 트리가 더러워진다(v3.3.7·v3.3.8 에서 두 번 났다 — CLAUDE.md 판 규칙).
   CHANGELOG 에도 그 판 항목이 있어야 한다(배포할 때마다 항목을 더하는 규칙). */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const rd = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

test('세 매니페스트와 Cargo.lock 의 판 번호가 같다', () => {
  const pkg = JSON.parse(rd('package.json')).version;
  const conf = JSON.parse(rd('src-tauri/tauri.conf.json')).version;
  const toml = rd('src-tauri/Cargo.toml').match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m)[1];
  const lock = rd('src-tauri/Cargo.lock').match(/\[\[package\]\]\r?\nname = "wmhh-desktop"\r?\nversion = "([^"]+)"/)[1];
  assert.match(pkg, /^\d+\.\d+\.\d+$/);
  assert.deepEqual({conf, toml, lock}, {conf: pkg, toml: pkg, lock: pkg});
});

test('CHANGELOG 에 지금 판 항목이 있다', () => {
  const v = JSON.parse(rd('package.json')).version;
  assert.match(rd('CHANGELOG.md'), new RegExp('^## v' + v.replace(/\./g, '\\.') + '\\b', 'm'));
});

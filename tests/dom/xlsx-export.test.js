/* 설정 → 데이터 → [엑셀로 내보내기] 연결 — 버튼을 누르면 xlsx-export.js 가 만든 바이트가 save_binary_file 로 간다 */
import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {setupEnv} from '../helpers/env.js';

mock.timers.enable({apis:['setTimeout','setInterval']});
const env = setupEnv();
const require = createRequire(import.meta.url);
const XLSX = require('../../src/vendor/xlsx.full.min.js');
env.window.XLSX = XLSX; globalThis.XLSX = XLSX;
const {S} = await import('../../src/state.js');
const {initBackup} = await import('../../src/backup.js');
initBackup();
const $ = id => env.document.getElementById(id);
const iso = min => new Date(Date.now() + min*60e3).toISOString();

test('설명 글과 버튼 이름', () => {
  const row = $('xlsx');
  assert.equal(row.querySelector('.set-lab').textContent, '엑셀로 내보내기');
  assert.equal(row.querySelector('.set-desc').textContent, '업무 목록을 보기 좋은 엑셀 파일로 저장합니다');
});

test('누르면 네 시트짜리(잘린 메모가 없으면 셋) xlsx 를 같은 파일 이름으로 저장하고 토스트', async () => {
  await env.resetS(); S.loaded = true;
  S.items.push({id:1, memo:'오늘 처리할 업무\n내용 한 줄', done:false, f:{due:iso(-30)}, contacts:[{who:'김가상', org:'가상과', phone:'02-000-0000', email:''}], ids:[], subs:[], files:[]});
  S.items.push({id:2, memo:'분류 대기(빠진다)', done:false, f:{}, contacts:[], ids:[], subs:[], files:[]});
  let got = null;
  env.onInvoke('save_binary_file', args => { got = args; return true; });
  $('xlsx').click(); await env.flush(6);
  assert.ok(got, 'save_binary_file 호출');
  assert.match(got.suggestedName, /^뭐하려했더라_업무목록_\d{8}\.xlsx$/);
  assert.ok(Array.isArray(got.data) && got.data.length > 1000, '바이트 배열(0바이트 아님 — F14)');
  const wb = XLSX.read(new Uint8Array(got.data), {type:'array'});
  assert.deepEqual(wb.SheetNames, ['업무 목록','연락처·파일','원자료']);
  assert.equal(XLSX.utils.sheet_to_json(wb.Sheets['원자료']).length, 1, '분류 대기는 빠진다');
  assert.ok(env.document.body.textContent.includes('XLSX 파일을 저장했습니다'));
});

test('내보낼 업무가 없으면 예전과 같은 안내', async () => {
  await env.resetS(); S.loaded = true;
  S.items.push({id:3, memo:'분류 대기', done:false, f:{}, contacts:[], ids:[], subs:[], files:[]});
  $('xlsx').click(); await env.flush(6);
  assert.deepEqual(env.alerts, ['내보낼 항목이 없습니다 (오늘 처리·진행 중·완료된 업무만 내보냅니다).']);
  assert.ok(!env.invokeCalls.some(c => c.cmd === 'save_binary_file'));
});

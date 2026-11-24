/* v3.8.24 보안 점검 — 실행 형식 파일 링크는 한 번 묻고 연다(store.js openPath) */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setupEnv} from '../helpers/env.js';

const env = setupEnv();
const {openPath} = await import('../../src/store.js');

/* Rust open_file_path 흉내: 실행 형식은 allowExec 없이 오면 'EXEC_BLOCKED' 로 거절 */
const opened = [];
env.onInvoke('open_file_path', a => {
  if(/\.(exe|bat|lnk)$/i.test(a.path) && !a.allowExec) throw 'EXEC_BLOCKED';
  opened.push(a); return null;
});
const reset = async () => { await env.resetS(); opened.length = 0; };

test('일반 문서는 묻지 않고 바로 연다', async () => {
  await reset();
  assert.equal(await openPath('C:\\a\\보고서.hwp'), true);
  assert.deepEqual(opened, [{path:'C:\\a\\보고서.hwp'}]);
  assert.equal(env.alerts.length, 0);
});

test('실행 파일: [취소]면 열지 않는다', async () => {
  await reset(); env.answerConfirm(false);
  assert.equal(await openPath('C:\\a\\setup.exe'), false);
  assert.equal(opened.length, 0);
});

test('실행 파일: [확인]이면 allowExec 로 다시 연다', async () => {
  await reset(); env.answerConfirm(true);
  assert.equal(await openPath('C:\\a\\run.bat'), true);
  assert.deepEqual(opened, [{path:'C:\\a\\run.bat', allowExec:true}]);
});

test('그 밖의 실패는 예전처럼 던진다(묻지 않는다)', async () => {
  await reset();
  env.onInvoke('open_file_path', () => { throw '없는 파일'; });
  await assert.rejects(openPath('C:\\a\\없음.pdf'), /없는 파일/);
});

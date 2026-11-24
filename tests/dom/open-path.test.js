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

/* v3.8.25: 공유 폴더 — 'NET_BLOCKED' 면 서버 이름을 보여 주고 묻는다. 실행 확인과는 따로 묻는다. */
test('공유 폴더: [확인]이면 allowNet 으로, 실행 형식이면 이어서 한 번 더 묻는다', async () => {
  await reset();
  const asked = [];
  env.onInvoke('open_file_path', a => {
    if(/^\\\\/.test(a.path) && !a.allowNet) throw 'NET_BLOCKED';
    if(/\.exe$/i.test(a.path) && !a.allowExec) throw 'EXEC_BLOCKED';
    opened.push(a); return null;
  });
  const real = env.window.confirm;
  env.window.confirm = m => { asked.push(String(m)); return true; };
  try{
    assert.equal(await openPath('\\\\srv\\공유\\a.pdf'), true);
    assert.deepEqual(opened.at(-1), {path:'\\\\srv\\공유\\a.pdf', allowNet:true});
    assert.match(asked[0], /서버 'srv'/, '서버 이름을 보여 준다');
    assert.equal(await openPath('\\\\srv\\공유\\setup.exe'), true);
    assert.deepEqual(opened.at(-1), {path:'\\\\srv\\공유\\setup.exe', allowNet:true, allowExec:true});
    assert.equal(asked.length, 3, '공유 폴더 1 + (공유 폴더 1 + 실행 1)');
  }finally{ env.window.confirm = real; }
});

test('공유 폴더: [취소]면 열지 않는다', async () => {
  await reset(); env.answerConfirm(false);
  env.onInvoke('open_file_path', a => { if(!a.allowNet) throw 'NET_BLOCKED'; opened.push(a); return null; });
  assert.equal(await openPath('\\\\srv\\s\\a.pdf'), false);
  assert.equal(opened.length, 0);
});

test('탐색기에서 보이기(revealPath)도 공유 폴더는 묻는다', async () => {
  const {revealPath} = await import('../../src/store.js');
  await reset(); env.answerConfirm(true);
  const shown = [];
  env.onInvoke('reveal_file_path', a => { if(/^\\\\/.test(a.path) && !a.allowNet) throw 'NET_BLOCKED'; shown.push(a); return null; });
  assert.equal(await revealPath('C:\\a\\b.pdf'), true);
  assert.equal(await revealPath('\\\\srv\\s\\b.pdf'), true);
  assert.deepEqual(shown, [{path:'C:\\a\\b.pdf'}, {path:'\\\\srv\\s\\b.pdf', allowNet:true}]);
});

test('그 밖의 실패는 예전처럼 던진다(묻지 않는다)', async () => {
  await reset();
  env.onInvoke('open_file_path', () => { throw '없는 파일'; });
  await assert.rejects(openPath('C:\\a\\없음.pdf'), /없는 파일/);
});

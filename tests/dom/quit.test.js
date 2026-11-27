/* 종료 플러시(quit.js) — 트레이 [종료]·종료 요청(wmhh://request-quit) 때 화면에만 있는 것을 디스크로 밀어 넣고 quit_now.
   점검 라운드 3: 열린 양식에서 방금 친 글(임시저장 700ms 디바운스가 아직 안 돈 것)도 임시저장분으로 남긴다. */
import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {setupEnv} from '../helpers/env.js';

mock.timers.enable({apis:['setTimeout','setInterval']});
const env = setupEnv();
const {S, newId} = await import('../../src/state.js');
const {initToast} = await import('../../src/dom-utils.js');
const {initForm, openForm, closeForm} = await import('../../src/form.js');
const {initQuit} = await import('../../src/quit.js');
initToast(); initForm(); initQuit();

const $ = id => env.document.getElementById(id);
const input = el => el.dispatchEvent(new env.window.Event('input', {bubbles:true}));
const mk = o => Object.assign({id:newId(), memo:'업무', owner:'', done:false, doneAt:null, staged:false, f:{}, contacts:[], ids:[], subs:[], files:[], al:{}, recur:null, recurId:null}, o);

test('종료 요청: 열린 양식에서 방금 친 글이 임시저장분으로 디스크에 실린 뒤 quit_now', async () => {
  await env.resetS(); S.loaded = true;
  const it = mk({memo:'회신 업무'});
  S.items.push(it);
  openForm(it); await env.flush();
  $('fm-memo').value = '회신 업무 — 방금 친 글'; input($('fm-memo'));   // 700ms 가 지나기 전에
  env.invokeCalls.length = 0;
  env.fireEvent('wmhh://request-quit');
  for(let i=0;i<5;i++){ mock.timers.tick(100); await env.flush(4); }
  const cmds = env.invokeCalls.map(c=>c.cmd);
  const set = env.invokeCalls.filter(c=>c.cmd==='save_settings').at(-1);
  assert.ok(set, '설정(임시저장분)이 저장에 나간다');
  assert.equal(set.args.settings.formDrafts[String(it.id)].data.memo, '회신 업무 — 방금 친 글');
  assert.ok(cmds.indexOf('quit_now') > cmds.lastIndexOf('save_settings'), '저장을 보낸 뒤에 끈다');
  closeForm();
});

/* v3.8.16 엑셀 도구(SheetJS)는 앱을 켤 때 읽지 않고 처음 쓸 때 불러온다 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {setupEnv} from '../helpers/env.js';
const env = setupEnv();
const {needXlsx} = await import('../../src/dom-utils.js');

test('index.html 은 xlsx.full.min.js 를 싣지 않는다', () => {
  const html = fs.readFileSync(new URL('../../src/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /<script[^>]*xlsx\.full\.min\.js/);
});

test('needXlsx: 없으면 스크립트를 한 번만 붙이고, 있으면 바로 돌려준다', async () => {
  const doc = env.document;
  delete env.window.XLSX;
  const p1 = needXlsx(), p2 = needXlsx();
  assert.strictEqual(p1, p2, '같은 약속');
  const tags = doc.querySelectorAll('script[src="vendor/xlsx.full.min.js"]');
  assert.equal(tags.length, 1);
  env.window.XLSX = {ok:true}; tags[0].onload();
  assert.deepEqual(await p1, {ok:true});
  assert.deepEqual(await needXlsx(), {ok:true});
  assert.equal(doc.querySelectorAll('script[src="vendor/xlsx.full.min.js"]').length, 1, '다시 붙이지 않는다');
});

/* v3.8.7 rhwp(vendor/rhwp) — 진짜 WASM 으로 한글 문서를 연다. 앱이 쓰는 호출(HwpDocument·pageCount·renderPageSvg·free)이
   판을 올린 뒤에도 그대로 도는지 지키는 시험. 시험 문서(tests/fixtures/rhwp-sample.*)는 가상 내용으로 만든 것. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/* 브라우저에선 canvas 로 재는 글자 폭 — 시험에선 대충(한글 1em, 나머지 0.55em) */
globalThis.measureTextWidth = (font, text) => { const m=/(\d+(?:\.\d+)?)px/.exec(font), px=m?+m[1]:16; let w=0; for(const ch of text) w += ch.charCodeAt(0)>0x2e80 ? px : px*0.55; return w; };
const rhwp = await import(pathToFileURL(path.join(ROOT, 'src', 'vendor', 'rhwp', 'rhwp.js')).href);
rhwp.initSync({module: fs.readFileSync(path.join(ROOT, 'src', 'vendor', 'rhwp', 'rhwp_bg.wasm'))});
const open = f => new rhwp.HwpDocument(new Uint8Array(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', f))));

for (const f of ['rhwp-sample.hwpx', 'rhwp-sample.hwp']) {
  test(`rhwp: ${f} 를 쪽 SVG 로 그린다(글자는 <text>, 스크립트 없음)`, () => {
    const d = open(f);
    try {
      assert.ok(d.pageCount() >= 1);
      const svg = d.renderPageSvg(0);
      assert.match(svg, /^<svg[\s>]/);
      assert.ok(/<text[^>]*>전<\/text>/.test(svg) && /<text[^>]*>장<\/text>/.test(svg), '제목 글자가 들어 있다');
      assert.ok(!/<script/i.test(svg));
    } finally { d.free(); }
  });
}

test('rhwp: 한글 문서가 아니면 예외 — 앱은 이걸 받아 글자·표 보기로 돌아간다', () => {
  assert.throws(() => new rhwp.HwpDocument(new Uint8Array([1, 2, 3, 4])));
});

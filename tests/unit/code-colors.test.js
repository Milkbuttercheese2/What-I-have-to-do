/* v3.8.15 문서 탭 코드 색 강조 = VS Code 기본 테마(Light+ / Dark+) 색.
   ① 두 테마가 같은 --hl-* 토큰을 모두 정의한다 ② 색 강조 규칙은 토큰만 쓰고 굵기·기울임을 주지 않는다(색 층과 입력칸의 글자 폭이 어긋난다)
   ③ highlight.js 가 실제로 붙이는 이름(11판의 'hljs-title function_' 같은 하위 이름 포함)이 규칙에 잡힌다. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
const darkAt = css.indexOf('html[data-theme="dark"]{');
const block = (from) => css.slice(from, css.indexOf('}', from));
const tokens = t => Object.fromEntries([...t.matchAll(/--(hl-[a-z-]+):(#[0-9A-Fa-f]{6})/g)].map(m => [m[1], m[2].toUpperCase()]));
const LIGHT = tokens(block(css.indexOf(':root{')));
const DARK = tokens(block(darkAt));
// 색 강조 규칙 줄(.hljs-… 로 시작하는 줄)만
const RULES = css.split(/\r?\n/).filter(l => /^\s*\.hljs-[^{]*\{/.test(l));

test('두 테마가 같은 코드 색 토큰을 모두 정의한다', () => {
  assert.ok(Object.keys(LIGHT).length >= 20, '밝은 테마 토큰');
  assert.deepEqual(Object.keys(DARK).sort(), Object.keys(LIGHT).sort(), '어두운 테마도 같은 토큰');
});

test('VS Code 기본 테마의 대표 색(밝음 / 어두움)', () => {
  const want = {
    'hl-comment': ['#008000', '#6A9955'], 'hl-keyword': ['#0000FF', '#569CD6'], 'hl-string': ['#A31515', '#CE9178'],
    'hl-regexp': ['#811F3F', '#D16969'], 'hl-number': ['#098658', '#B5CEA8'], 'hl-func': ['#795E26', '#DCDCAA'],
    'hl-type': ['#267F99', '#4EC9B0'], 'hl-var': ['#001080', '#9CDCFE'], 'hl-tag': ['#800000', '#569CD6'],
    'hl-attr-name': ['#E50000', '#9CDCFE'], 'hl-heading': ['#800000', '#569CD6'],
  };
  for (const [k, [l, d]] of Object.entries(want)) { assert.equal(LIGHT[k], l, k + ' 밝음'); assert.equal(DARK[k], d, k + ' 어두움'); }
});

test('색 강조 규칙은 토큰 색만 쓰고 굵기·기울임·글자 크기를 바꾸지 않는다', () => {
  assert.ok(RULES.length >= 15);
  for (const r of RULES.filter(l => !l.includes('.dv-mdv'))) {
    assert.doesNotMatch(r, /font|letter-spacing|padding|margin/, r);
    const vals = [...r.matchAll(/color:([^;}]+)/g)].map(m => m[1].trim());
    assert.ok(vals.length, r);
    for (const v of vals) assert.match(v, /^var\(--(hl-[a-z-]+|ink)\)$/, r);
  }
});

test('highlight.js 가 붙이는 이름이 규칙에 잡힌다(js·java·py·sql·md·xml·css·diff)', async () => {
  const h = (await import('../../src/vendor/highlight.min.js')).default;
  const S = {
    javascript: 'import x from "y";\nclass A extends B { f(a=1){ return /a+/g.test(`t${a}`) ? this.k : null; } }\nconst N=3; f(2);',
    java: '@Override\npublic class Foo { private int n = 10; /* c */ String run(String s){ return s + "x"; } }',
    python: '@dec\ndef f(a: int) -> str:\n    """doc"""\n    print(len(a), True, self)\nclass K(Base): pass',
    sql: '-- c\nSELECT COUNT(*) AS n FROM t WHERE a = \'s\' AND b > 3;',
    markdown: '# 제목\n- 목록\n> 인용\n**굵게** *기울임* `코드`',
    xml: '<div class="a"><!-- c --><span>&amp;</span></div>',
    css: '.a #b > p:hover { color: #fff; }',
    diff: '@@ -1 +1 @@\n-old\n+new',
  };
  // 규칙 없이 기본 글자색으로 두는 이름(VS Code 도 기본 글자색)
  const PLAIN = new Set(['hljs-operator', 'hljs-punctuation', 'hljs-link', 'hljs-function', 'hljs-class']);
  const selectors = RULES.map(l => l.slice(0, l.indexOf('{'))).join(',');
  const covered = cls => {
    const [base, ...sub] = cls.split(' ');
    const full = '.' + base + sub.map(x => '.' + x).join('');
    return selectors.split(',').some(sel => { const last = sel.trim().split(/\s+/).pop(); return last === '.' + base || last === full; });
  };
  const seen = new Set();
  for (const [lang, code] of Object.entries(S))
    for (const m of h.highlight(code, {language: lang, ignoreIllegals: true}).value.matchAll(/class="([^"]+)"/g)) seen.add(m[1]);
  for (const c of ['hljs-title function_', 'hljs-title class_', 'hljs-keyword', 'hljs-string', 'hljs-section', 'hljs-name']) assert.ok(seen.has(c), c + ' 가 실제로 나온다');
  const missing = [...seen].filter(c => !PLAIN.has(c.split(' ')[0]) && !covered(c));
  assert.deepEqual(missing, [], '규칙에 없는 이름');
  // 하위 이름이 따로 잡히는 것: 함수 이름 ≠ 클래스 이름, this ≠ 변수
  assert.match(selectors, /\.hljs-title\.class_/); assert.match(selectors, /\.hljs-variable\.language_/);
});

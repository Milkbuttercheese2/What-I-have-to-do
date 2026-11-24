/* v3.8.24 보안 점검 — MD 미리 보기 소독 · 양식 필드 key 이스케이프 */
import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {setupEnv} from '../helpers/env.js';

mock.timers.enable({apis:['setTimeout','setInterval']});
const env = setupEnv();
const {S, CORE_FIELDS} = await import('../../src/state.js');
const {mdHtml} = await import('../../src/docs-view.js');
const {openForm, closeForm, initForm} = await import('../../src/form.js');
initForm();

const parse = html => { const d=env.document.createElement('div'); d.innerHTML=html; return d; };

test('MD: 앱 동작용 data-* · 앱 class · id 는 빠진다', async () => {
  const evil = [
    '<div class="modal-bg on" data-fopen="C:\\x\\a.lnk" id="toast-msg">계속하려면 누르세요</div>',
    '<span data-del="1" data-open="2" name="rel-list">지우기</span>',
    '<a href="#" data-pbdel="3" class="btn" id="x">링크</a>',
  ].join('\n\n');
  const d = parse(await mdHtml(evil));
  assert.ok(d.textContent.includes('계속하려면 누르세요'), '글은 남는다');
  for(const el of d.querySelectorAll('*')){
    for(const a of el.attributes){
      assert.ok(!/^data-/.test(a.name), `data 속성이 남음: ${a.name}`);
      assert.ok(a.name!=='id' && a.name!=='class', `${a.name} 이(가) 남음`);
    }
    const nm = el.getAttribute('name');
    assert.ok(nm===null || nm.startsWith('user-content-'), `name 이 그대로 남음: ${nm}`);
  }
  assert.equal(d.querySelector('.modal-bg'), null);
  assert.equal(d.querySelector('#toast-msg'), null);
});

test('MD: 보통 마크다운(제목·표·링크·코드 블록 언어)은 그대로', async () => {
  const md = '# 제목\n\n| 가 | 나 |\n|---|---|\n| 1 | 2 |\n\n[보고서](보고서.md)\n\n```sql\nSELECT 1;\n```\n';
  const d = parse(await mdHtml(md));
  assert.equal(d.querySelector('h1').textContent, '제목');
  assert.equal(d.querySelectorAll('table td').length, 2);
  assert.equal(decodeURIComponent(d.querySelector('a').getAttribute('href')), '보고서.md');   // marked 가 %-인코딩한다(링크 처리기가 되돌린다)
  const code = d.querySelector('pre code');
  assert.equal(code.getAttribute('class'), 'language-sql', '코드 색칠용 언어 class 는 남는다');
  assert.equal(code.textContent.trim(), 'SELECT 1;');
});

test('MD: 언어 class 가 아니면 code 에서도 class 를 뺀다', async () => {
  const d = parse(await mdHtml('<code class="modal-bg on">x</code>'));
  assert.equal(d.querySelector('code').getAttribute('class'), null);
});

test('양식: 필드 key 의 따옴표는 data-fkey 속성 밖으로 나가지 않는다', async () => {
  await env.resetS();
  const key = 'x" autofocus data-evil="1';
  S.fields = JSON.parse(JSON.stringify(CORE_FIELDS)).concat([{key, label:'추가', type:'datetime', on:true}]);
  openForm({});
  const g = env.document.getElementById('fm-grid');
  assert.equal(g.querySelector('[data-evil]'), null, '속성이 새로 생기면 안 된다');
  assert.equal(g.querySelector('[autofocus]'), null);
  assert.ok([...g.querySelectorAll('[data-fkey]')].some(el => el.getAttribute('data-fkey') === key), 'key 는 값 그대로 보존');
  closeForm();
});

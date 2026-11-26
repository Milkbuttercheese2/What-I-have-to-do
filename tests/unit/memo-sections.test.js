/* memo-sections — 메모의 `[제목]` 줄을 구역 제목으로 알아보는 규칙(소유자 지정 2026-11-27)
   한 줄이 통째로 [제목]일 때만 · 메모 맨 처음의 [제목]은 위에 선 없음 */
import {test} from 'node:test';
import assert from 'node:assert/strict';

const {sectionTitle, sectionLines, markSections, sectionLinesIn, SEC_MARK} = await import('../../src/memo-sections.js');

test('구역 제목: 한 줄이 통째로 [제목]', () => {
  assert.equal(sectionTitle('[통화 내용]'), '통화 내용');
  assert.equal(sectionTitle('[별표 2]'), '별표 2');
  assert.equal(sectionTitle('  [검토할 것]  '), '검토할 것', '앞뒤 공백 허용');
  assert.equal(sectionTitle('\t[참고]'), '참고');
  assert.equal(sectionTitle('[ 안쪽 공백 ]'), '안쪽 공백', '안의 앞뒤 공백은 뺀 이름');
});

test('구역 제목이 아닌 것: 뒤에 글 · 줄 가운데 · 빈 대괄호 · 닫히지 않음 · 대괄호 둘', () => {
  for(const s of ['[긴급] 오늘 중 회신', '시행령 [별표 2] 참조', '[]', '[   ]', '[통화 내용', '통화 내용]',
                  '[가] [나]', '[[가]]', '앞글 [제목]', '[제목] .', '', '   ', '일반 글'])
    assert.equal(sectionTitle(s), null, JSON.stringify(s));
});

test('선을 긋는 줄: 앞에 글이 있는 구역 제목만', () => {
  const memo='입찰공고 정정 사유 확인\n시설과에서 정정을 요청했습니다.\n[통화 내용]\n사유서는 내일 오전에.\n[검토할 것]\n대조표 만들기';
  assert.deepEqual(sectionLines(memo), [2,4]);
});

test('경계: 메모 첫 줄이 [제목]이면 선 없음(제목 구실)', () => {
  assert.deepEqual(sectionLines('[제목]\n본문\n[통화 내용]\n내용'), [2]);
});

test('경계: 빈 줄·공백 줄 뒤의 첫 [제목]도 선 없음', () => {
  assert.deepEqual(sectionLines('\n\n   \n[제목]\n본문'), []);
  assert.deepEqual(sectionLines('\n  \n[제목]\n\n[둘째]\n'), [4], '첫 [제목]이 글이라 둘째부터 선');
});

test('경계: 글 뒤의 첫 [제목]은 선을 긋는다', () => {
  assert.deepEqual(sectionLines('메모 첫 줄\n[통화 내용]'), [1]);
  assert.deepEqual(sectionLines('메모 첫 줄\n\n[통화 내용]'), [2], '사이의 빈 줄은 상관없음');
});

test('선을 긋지 않는 대괄호 줄은 글로 쳐서 다음 [제목]에 선이 생긴다', () => {
  assert.deepEqual(sectionLines('[긴급] 오늘 중 회신\n[통화 내용]'), [1]);
});

test('빈 메모·대괄호 없는 메모는 선 없음', () => {
  assert.deepEqual(sectionLines(''), []);
  assert.deepEqual(sectionLines(null), []);
  assert.deepEqual(sectionLines('그냥 메모\n둘째 줄'), []);
});

test('markSections: 표시는 줄 앞에만 끼우고 줄 수·글자는 그대로', () => {
  const text='가\n[나]\n다';
  const out=markSections('가\n[나]\n다', text);
  assert.equal(out, `가\n${SEC_MARK}[나]\n다`);
  assert.equal(out.split('\n').length, text.split('\n').length);
  assert.equal(markSections('x', 'x'), 'x');
});

test('sectionLinesIn: 쪽으로 나눈 글에서도 같은 줄에 선', () => {
  const full='첫 줄\n[통화 내용]\n본문 한 줄\n[검토할 것]\n끝';
  // 한 조각 = 전체
  assert.deepEqual(sectionLinesIn(full, 0, full.length), sectionLines(full));
  // 둘째 쪽이 [검토할 것] 줄 머리에서 시작 — 앞쪽에 글이 있으므로 선
  const s=full.indexOf('[검토할 것]');
  assert.deepEqual(sectionLinesIn(full, s, full.length), [0]);
  assert.deepEqual(sectionLinesIn(full, 0, s), [1], '첫 쪽: [통화 내용]만(쪽 끝의 빈 토막은 없음)');
  // 쪽이 줄 가운데에서 시작하면 그 토막은 줄 머리가 아니다
  const mid=full.indexOf('통화 내용]');
  assert.deepEqual(sectionLinesIn(full, mid, full.length), [2]);
  // 첫 쪽이 [제목] 하나뿐이고 둘째 쪽에 다음 [제목]이 있으면
  const f2='[제목]\n[다음]';
  assert.deepEqual(sectionLinesIn(f2, 0, 5), []);
  assert.deepEqual(sectionLinesIn(f2, 5, f2.length), [0], '앞 쪽의 [제목]이 글이므로 둘째 쪽 첫 줄에 선');
});

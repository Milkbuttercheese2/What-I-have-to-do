/* 테마 설정 정규화 (v2.6.0) — 저장된 값이 깨져 있어도 항상 아는 값으로 떨어진다 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {THEME_DEFAULTS, normTheme, normCapScreen, normCapPair, captureConfig} from '../../src/theme.js';

test('기본값은 기존 화면 그대로 — 밝게 · 검색 먼저 · Alt=빠른 메모', () => {
  assert.deepEqual(THEME_DEFAULTS, {theme:'light', capStart:'search', capSecond:'memo'});
});

test('아는 값만 통과하고 나머지는 기본값 — undefined·오타·객체 모두 안전', () => {
  assert.equal(normTheme('dark'), 'dark');
  assert.equal(normTheme('light'), 'light');
  assert.equal(normTheme(undefined), 'light');
  assert.equal(normTheme('DARK'), 'light');          // 대문자는 아는 값이 아니다
  assert.equal(normCapScreen('memo'), 'memo');
  assert.equal(normCapScreen('form'), 'form');   // v2.6.3 양식 메모
  assert.equal(normCapScreen({}), 'search');
});

test('captureConfig: 미니 창에 보낼 값만 추린다(초안·다른 설정은 안 샌다) — 테마는 앱 전체 값', () => {
  const cfg = captureConfig({theme:'dark', capStart:'memo', capSecond:'form',
                             captureDraft:'비밀 메모', alarmOn:false});
  assert.deepEqual(cfg, {theme:'dark', capStart:'memo', capSecond:'form'});
  assert.deepEqual(captureConfig(undefined), {theme:'light', capStart:'search', capSecond:'memo'});
});

test('배치(3P2): 첫 화면과 둘째 화면이 겹치면 조용히 다른 화면으로 민다', () => {
  assert.deepEqual(normCapPair({capStart:'memo', capSecond:'memo'}), {capStart:'memo', capSecond:'search'});
  assert.deepEqual(normCapPair({capStart:'search', capSecond:'search'}), {capStart:'search', capSecond:'memo'});
  assert.deepEqual(normCapPair({capStart:'form', capSecond:'form'}), {capStart:'form', capSecond:'search'});
  assert.deepEqual(normCapPair({capStart:'form', capSecond:'memo'}), {capStart:'form', capSecond:'memo'});
  assert.deepEqual(normCapPair({}), {capStart:'search', capSecond:'memo'});   // 기존 동작
});

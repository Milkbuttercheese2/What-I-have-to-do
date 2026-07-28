/* 테마 설정 정규화 (v2.6.0) — 저장된 값이 깨져 있어도 항상 아는 값으로 떨어진다 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {THEME_DEFAULTS, normTheme, normCapTheme, normCapStart, normCapSubmit, captureConfig} from '../../src/theme.js';

test('기본값: 메인=밝게, 미니 창=어둡게·검색 먼저·분류 대기 등록', () => {
  assert.deepEqual(THEME_DEFAULTS, {theme:'light', capTheme:'dark', capStart:'search', capSubmit:'inbox'});
});

test('아는 값만 통과하고 나머지는 기본값 — undefined·오타·객체 모두 안전', () => {
  assert.equal(normTheme('dark'), 'dark');
  assert.equal(normTheme('light'), 'light');
  assert.equal(normTheme(undefined), 'light');
  assert.equal(normTheme('DARK'), 'light');          // 대문자는 아는 값이 아니다
  assert.equal(normCapTheme(undefined), 'dark');     // 미니 창은 검정이 기본
  assert.equal(normCapTheme('light'), 'light');
  assert.equal(normCapStart('memo'), 'memo');
  assert.equal(normCapStart({}), 'search');
  assert.equal(normCapSubmit('form'), 'form');
  assert.equal(normCapSubmit(null), 'inbox');
});

test('captureConfig: 미니 창에 보낼 세 값만 추린다(초안·다른 설정은 안 샌다)', () => {
  const cfg = captureConfig({capTheme:'light', capStart:'memo', capSubmit:'form',
                             captureDraft:'비밀 메모', theme:'dark', alarmOn:false});
  assert.deepEqual(cfg, {capTheme:'light', capStart:'memo', capSubmit:'form'});
  assert.deepEqual(captureConfig(undefined), {capTheme:'dark', capStart:'search', capSubmit:'inbox'});
});

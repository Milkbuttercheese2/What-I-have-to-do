/* 팝업 스택 — ESC 가 '실제로 맨 위인 것'을 닫는가, close 콜백이 반드시 불리는가.
   예전에는 이 순서가 main.js 의 손으로 적은 목록이었고 세 번 어긋났다(modals.js 주석 참조).
   여기서 고정하는 것은 그 세 사고가 다시 나지 않는다는 것. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setupEnv} from '../helpers/env.js';

const env = setupEnv();
const {openModal, closeModal, closeTop, topSave, isOpen} = await import('../../src/modals.js');

const $ = id => env.document.getElementById(id);
const on = id => $(id).classList.contains('on');
/* jsdom 은 <link> 스타일시트를 읽지 않아 CSS 의 z-index 가 계산되지 않는다.
   실제 화면의 겹침을 재현하려면 styles.css 와 같은 값을 인라인으로 준다. */
const setZ = (id, z) => { $(id).style.zIndex = String(z); $(id).style.position = 'fixed'; };
setZ('formPanel', 60); setZ('relModal', 70); setZ('alarmBg', 120);
setZ('presetModal', 50); setZ('settingsModal', 50); setZ('recurModal', 50);
setZ('pbSyncModal', 50); setZ('boardModeModal', 50);

/* 각 테스트가 남긴 스택을 비운다 (closeTop 은 비면 false) */
const drain = () => { while(closeTop()); };

test('열고 닫기: on 클래스 · isOpen · 빈 스택에서 closeTop 은 false', () => {
  drain();
  assert.equal(closeTop(), false);
  openModal('presetModal');
  assert.ok(on('presetModal')); assert.ok(isOpen('presetModal'));
  closeModal('presetModal');
  assert.ok(!on('presetModal')); assert.ok(!isOpen('presetModal'));
  assert.equal(closeTop(), false);
});

test('같은 z 면 나중에 연 것이 위 — ESC 는 그것부터 닫는다', () => {
  drain();
  openModal('settingsModal');
  openModal('recurModal');                 // 설정 팝업에서 여는 주기 업무 팝업
  closeTop();
  assert.ok(!on('recurModal'), '주기 업무 팝업이 먼저 닫혀야 한다');
  assert.ok(on('settingsModal'), '밑의 설정 팝업은 남아 있어야 한다');
  closeTop();
  assert.ok(!on('settingsModal'));
});

test('v2.11.0 회귀: 양식 위의 관련 업무 팝업이 먼저 닫힌다 — 여는 순서와 무관', () => {
  drain();
  openModal('formPanel'); openModal('relModal');
  closeTop();
  assert.ok(!on('relModal')); assert.ok(on('formPanel'), 'ESC 가 밑의 양식을 닫으면 안 된다');
  drain();

  /* z 가 높으면 먼저 열렸어도 위다 — 순서만 보던 목록이 놓치던 경우 */
  openModal('relModal'); openModal('formPanel');
  closeTop();
  assert.ok(!on('relModal'), 'z70 이 z60 보다 위이므로 여전히 관련 업무가 먼저');
  assert.ok(on('formPanel'));
  drain();
});

test('알림창(z120)은 무엇 위에서든 가장 먼저 닫힌다', () => {
  drain();
  openModal('alarmBg'); openModal('formPanel'); openModal('relModal');
  closeTop();
  assert.ok(!on('alarmBg'));
  assert.ok(on('relModal') && on('formPanel'));
  drain();
});

test('close 콜백은 ESC 로 닫을 때도 반드시 불린다 (동기화 팝업 대기 목록 잔존 회귀)', () => {
  drain();
  let cleaned = 0;
  openModal('pbSyncModal', {close: () => { cleaned++; closeModal('pbSyncModal'); }});
  closeTop();
  assert.equal(cleaned, 1, 'ESC 도 화면만 감추지 않고 정리까지 해야 한다');
  assert.ok(!on('pbSyncModal'));
  assert.ok(!isOpen('pbSyncModal'), 'close 안에서 closeModal 을 불러도 유령이 남지 않는다');
});

test('close 안에서 closeModal 을 불러도 재귀하지 않는다', () => {
  drain();
  let calls = 0;
  const close = () => { calls++; closeModal('presetModal'); };
  openModal('presetModal', {close});
  closeTop();
  assert.equal(calls, 1);
});

test('close 가 던져도 스택은 정리된다 — 팝업 하나가 앱 전체를 막지 않는다', () => {
  drain();
  openModal('presetModal', {close: () => { throw new Error('boom'); }});
  assert.doesNotThrow(() => closeTop());
  assert.ok(!isOpen('presetModal'));
});

test('같은 팝업을 다시 열면 맨 위로 올라간다 (중복 등록 없음)', () => {
  drain();
  openModal('presetModal'); openModal('settingsModal'); openModal('presetModal');
  closeTop();
  assert.ok(!on('presetModal'));
  assert.ok(on('settingsModal'));
  closeTop();
  assert.equal(closeTop(), false, '스택에 유령이 남으면 안 된다');
});

test('closeModal 은 스택에 없는 팝업도 화면에서 닫는다', () => {
  drain();
  $('relModal').classList.add('on');        // 스택을 거치지 않고 켜진 상태
  closeModal('relModal');
  assert.ok(!on('relModal'));
});

test('topSave: 저장 가능한 팝업만, 위에서부터', () => {
  drain();
  assert.equal(topSave(), null);
  let saved = '';
  openModal('presetModal', {save: () => { saved = 'preset'; }});
  openModal('relModal');                    // 저장 없음 — 건너뛴다
  topSave()();
  assert.equal(saved, 'preset', '위에 저장 없는 팝업이 있어도 그 밑의 저장을 찾아야 한다');

  openModal('formPanel', {save: () => { saved = 'form'; }});
  topSave()();
  assert.equal(saved, 'form', 'z 가 더 높은 양식이 우선');
  drain();
  assert.equal(topSave(), null, '다 닫히면 저장 대상도 없다');
});

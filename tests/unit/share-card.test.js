/* share-card — 공유 메모지에 무엇을 실을지(칸 순서·빈 칸 빼기·접기·표시·연락처 스위치·임박 색·글자로 복사) */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const {shareModel, shareText, shareHtml, splitMemo, foldLines, visualLines, isImminent, fmtLong, fmtShort, fmtStamp, shareFileName,
       SHARE_LIMITS, SHARE_TOKENS} = await import('../../src/share-card.js');

const NOW = new Date(2026, 10, 27, 15, 20);                 // 2026/11/27 (금) 15:20 — 설계서 6절 보기 글의 요일은 지어낸 것이라 실제 달력 요일로 적는다
const T = (d, h, m) => new Date(2026, 10, d, h, m).toISOString();
const FIELDS = [{key:'received', label:'접수시각'}, {key:'due', label:'기한'}];
const SAMPLE = {
  memo:'입찰공고 정정 사유 확인\n시설과에서 공고문 규격 부분 정정을 요청했습니다.\n[통화 내용]\n사유서는 내일 오전에 보내기로 함.',
  f:{received:T(26,9,10), due:T(28,14,0)},
  contacts:[{who:'김서준 주무관', org:'시설과', phone:'02-000-0000', email:'kim@example.go.kr'}],
  ids:[{kind:'공고번호', val:'R26BK00123456'}],
  subs:[{title:'정정 사유서 받기', mid:T(26,10,0), done:true, owner:''},
        {title:'공고문 정정안 검토', mid:T(27,16,0), done:false, owner:'박조달 주무관'},
        {title:'재공고 일정 회신', mid:'', done:false, owner:''}],
  files:['C:\\업무\\2026\\입찰\\정정요청.hwpx'],
};
const ctx = (o) => Object.assign({now:NOW, fields:FIELDS, done:false, doneAt:null, withContacts:false, open:new Set()}, o||{});
const kinds = m => m.blocks.map(b=>b.kind);

test('칸 순서는 업무 양식과 같다: 메모 → 하위 업무 → 접수시각·기한 → 식별정보 → 관련소속·관련인 (파일 링크는 싣지 않음)', () => {
  const m = shareModel(SAMPLE, ctx());
  assert.deepEqual(kinds(m), ['memo','subs','times','ids','people']);
  assert.ok(!JSON.stringify(m).includes('정정요청'), '파일 링크는 어디에도 없다');
});

test('빈 칸은 싣지 않는다 — 순서는 그대로 당겨진다', () => {
  assert.deepEqual(kinds(shareModel({...SAMPLE, ids:[], subs:[]}, ctx())), ['memo','times','people']);
  assert.deepEqual(kinds(shareModel({memo:'메모만'}, ctx())), ['memo']);
  assert.deepEqual(kinds(shareModel({memo:'x', f:{received:'', due:''}}, ctx())), ['memo'], '접수시각·기한 둘 다 없으면 싣지 않음');
  assert.deepEqual(shareModel({memo:'x', f:{due:T(28,14,0)}}, ctx()).blocks[1].cells.map(c=>c.label), ['기한'], '있는 칸만');
  /* 제목이 빈 하위 업무, 번호가 빈 식별정보, 세 칸이 빈 관련인은 없는 것으로 */
  assert.deepEqual(kinds(shareModel({memo:'x', subs:[{title:'  '}], ids:[{kind:'공고번호', val:''}], contacts:[{who:'',org:'',phone:'',email:'a@b'}]}, ctx())), ['memo']);
});

test('메모가 비면 "(메모 없음)"', () => {
  const m = shareModel({memo:'  \n '}, ctx());
  assert.equal(m.blocks[0].empty, true);
  assert.match(shareHtml(m), /\(메모 없음\)/);
  assert.match(shareText({memo:''}, ctx()), /^\[업무 공유\] 2026\/11\/27 15:20 기준\n\(메모 없음\)$/);
});

test('메모: 첫 글 줄은 제목(굵게), [제목] 한 줄은 구역 이름표, 그 아래가 구역 본문', () => {
  const s = splitMemo('\n\n입찰공고 정정\n본문 1\n\n[통화 내용]\n통화 1\n[긴급] 오늘 중\n시행령 [별표 2] 참조\n[검토할 것]\n');
  assert.equal(s.title, '입찰공고 정정');
  assert.deepEqual(s.body, ['본문 1']);
  assert.deepEqual(s.sections, [{name:'통화 내용', lines:['통화 1','[긴급] 오늘 중','시행령 [별표 2] 참조']}, {name:'검토할 것', lines:[]}],
    '뒤에 글이 붙은 [긴급]·줄 가운데 [별표 2]는 구역이 아니라 본문');
});

test('경계: 메모 맨 처음의 [제목]은 이름표로 바꾸지 않고 친 글자 그대로 굵게', () => {
  const s = splitMemo('  \n[정기 점검]\n본문\n[참고]\n끝');
  assert.equal(s.title, '[정기 점검]');
  assert.deepEqual(s.body, ['본문']);
  assert.deepEqual(s.sections.map(x=>x.name), ['참고']);
  assert.match(shareHtml(shareModel({memo:'[정기 점검]\n본문'}, ctx())), /<div class="shc-title">\[정기 점검\]<\/div>/);
});

test('접기: 관련인 2명까지 보이고 "외 N명"', () => {
  const many = n => ({memo:'x', contacts:Array.from({length:n},(_,i)=>({who:`사람${i}`, org:'과', phone:'', email:''}))});
  const b2 = shareModel(many(2), ctx()).blocks.find(b=>b.kind==='people');
  assert.equal(b2.rows.length, 2); assert.equal(b2.more, null, '2명은 접을 것이 없다');
  const m5 = shareModel(many(5), ctx()), b5 = m5.blocks.find(b=>b.kind==='people');
  assert.equal(b5.rows.length, 2); assert.equal(b5.more.label, '외 3명'); assert.equal(b5.more.open, false);
  assert.equal(m5.folded, true); assert.match(m5.foot.right, /^접힌 내용 있음 · /);
  const o5 = shareModel(many(5), ctx({open:new Set(['people'])})).blocks.find(b=>b.kind==='people');
  assert.equal(o5.rows.length, 5); assert.equal(o5.more.label, ''); assert.equal(o5.more.open, true, '펼친 칸은 [접기]');
  assert.deepEqual(b5.rows.map(r=>r.who), ['사람0','사람1'], '양식에 적힌 순서대로');
});

test('접기: 식별정보 3개까지, "외 N개"', () => {
  const ids = n => ({memo:'x', ids:Array.from({length:n},(_,i)=>({kind:'번호', val:'N'+i}))});
  assert.equal(shareModel(ids(3), ctx()).blocks[1].more, null);
  const b = shareModel(ids(5), ctx()).blocks[1];
  assert.equal(b.rows.length, 3); assert.equal(b.more.label, '외 2개');
});

test('접기: 하위 업무 — 3개 이하면 모두, 많으면 남은 것 3개만·끝낸 것은 모두 접음', () => {
  const subs = (done, left) => ({memo:'x', subs:[...Array.from({length:done},(_,i)=>({title:'끝'+i, done:true})), ...Array.from({length:left},(_,i)=>({title:'남'+i, done:false}))]});
  const s3 = shareModel(subs(1,2), ctx()).blocks[1];
  assert.equal(s3.rows.length, 3); assert.equal(s3.more, null); assert.equal(s3.rows[0].done, true, '3개면 끝낸 것도 보임');
  const s7 = shareModel(subs(4,3), ctx()).blocks[1];
  assert.deepEqual(s7.rows.map(r=>r.title), ['남0','남1','남2']); assert.equal(s7.more.label, '끝낸 것 4개 접음');
  assert.equal(s7.total, 7); assert.equal(s7.doneN, 4);
  const s8 = shareModel(subs(4,5), ctx()).blocks[1];
  assert.equal(s8.rows.length, 3); assert.equal(s8.more.label, '외 2개 · 끝낸 것 4개 접음');
  assert.equal(shareModel(subs(0,5), ctx()).blocks[1].more.label, '외 2개');
  const o8 = shareModel(subs(4,5), ctx({open:new Set(['subs'])})).blocks[1];
  assert.equal(o8.rows.length, 9); assert.deepEqual(o8.rows.slice(0,2).map(r=>r.title), ['끝0','끝1'], '펼치면 양식의 줄 순서 그대로');
});

test('하위 업무 줄: 칩 "N개 중 M개 끝남", 담당·일시는 있을 때만', () => {
  const b = shareModel(SAMPLE, ctx()).blocks[1];
  assert.deepEqual(b.rows.map(r=>r.meta), ['11/26(목) 10:00', '박조달 주무관 · 11/27(금) 16:00', '']);
  assert.match(shareHtml(shareModel(SAMPLE, ctx())), /3개 중 1개 끝남/);
});

test('접기: 메모 본문 6줄·구역 3줄 — "아래 N줄 더 있음"', () => {
  const body = Array.from({length:9},(_,i)=>'본문'+i).join('\n'), sec = Array.from({length:5},(_,i)=>'구역'+i).join('\n');
  const m = shareModel({memo:`제목\n${body}\n[검토할 것]\n${sec}`}, ctx()).blocks[0];
  assert.equal(m.body.length, 6); assert.equal(m.more.label, '아래 3줄 더 있음');
  assert.equal(m.sections[0].lines.length, 3); assert.equal(m.sections[0].more.label, '아래 2줄 더 있음'); assert.equal(m.sections[0].more.key, 'sec:0');
  const o = shareModel({memo:`제목\n${body}\n[검토할 것]\n${sec}`}, ctx({open:new Set(['memo','sec:0'])})).blocks[0];
  assert.equal(o.body.length, 9); assert.equal(o.sections[0].lines.length, 5);
  const short = shareModel({memo:'제목\n한 줄\n[구역]\n둘'}, ctx()).blocks[0];
  assert.equal(short.more, null); assert.equal(short.sections[0].more, null, '짧으면 접을 것이 없다');
});

test('접기: 긴 한 줄은 그림에서 접혀 보이는 줄로 어림해 센다(말없이 자르지 않고 … 와 수를 적는다)', () => {
  assert.equal(visualLines('가'.repeat(SHARE_LIMITS.cpl)), 1);
  assert.equal(visualLines('가'.repeat(SHARE_LIMITS.cpl+1)), 2);
  assert.equal(visualLines('a'.repeat(SHARE_LIMITS.cpl)), 1, '영문은 좁게');
  assert.equal(visualLines(''), 1);
  const f = foldLines(['가'.repeat(SHARE_LIMITS.cpl*10)], 6);
  assert.equal(f.lines.length, 1); assert.ok(f.lines[0].endsWith('…')); assert.equal(f.hidden, 4); assert.equal(f.cut, true);
});

test('펼쳐도 위 한도 — 넘는 것은 싣지 않고 "글자로 복사에는 다 실림"', () => {
  const n = SHARE_LIMITS.max.people + 7;
  const b = shareModel({memo:'x', contacts:Array.from({length:n},(_,i)=>({who:'p'+i, org:'', phone:'', email:''}))}, ctx({open:new Set(['people'])})).blocks[1];
  assert.equal(b.rows.length, SHARE_LIMITS.max.people);
  assert.equal(b.more.label, '외 7명 · 글자로 복사에는 다 실림');
  const huge = shareModel({memo:'제목\n'+'긴 글 '.repeat(20000)}, ctx({open:new Set(['memo'])})).blocks[0];
  const lines = huge.body.reduce((a,l)=>a+visualLines(l),0);
  assert.ok(lines <= SHARE_LIMITS.max.memoLines, `메모 5만 자도 ${lines}줄 이하`);
  assert.match(huge.more.label, /글자로 복사에는 다 실림$/);
});

test('연락처·이메일·파일 링크는 기본으로 빠지고, 스위치를 켜면 연락처·이메일만 들어간다', () => {
  const off = shareModel(SAMPLE, ctx()), on = shareModel(SAMPLE, ctx({withContacts:true}));
  const pOff = off.blocks.find(b=>b.kind==='people').rows[0], pOn = on.blocks.find(b=>b.kind==='people').rows[0];
  assert.deepEqual(pOff, {org:'시설과', who:'김서준 주무관', extra:''});
  assert.deepEqual(pOn, {org:'시설과', who:'김서준 주무관', extra:'02-000-0000 · kim@example.go.kr'});
  assert.equal(off.foot.right, '연락처·이메일·파일 링크는 뺌');
  assert.equal(on.foot.right, '파일 링크는 뺌');
  for(const m of [off, on]) assert.ok(!shareHtml(m).includes('정정요청'));
  assert.ok(!shareHtml(off).includes('02-000-0000') && !shareHtml(off).includes('kim@'));
  assert.ok(shareHtml(on).includes('02-000-0000'));
  assert.ok(!shareText(SAMPLE, ctx()).includes('02-000-0000'));
  assert.ok(shareText(SAMPLE, ctx({withContacts:true})).includes('김서준 주무관 · 02-000-0000 · kim@example.go.kr'));
  assert.ok(!shareText(SAMPLE, ctx({withContacts:true})).includes('정정요청'));
});

test('임박 색: 앱의 시각칩과 같은 조건(지남~2시간 이내), 완료 업무는 아님', () => {
  const now = new Date(2026,10,27,15,20);
  assert.equal(isImminent(new Date(2026,10,27,17,20), now), true, '꼭 2시간');
  assert.equal(isImminent(new Date(2026,10,27,17,21), now), false, '2시간 1분');
  assert.equal(isImminent(new Date(2026,10,27,9,0), now), true, '지난 기한');
  assert.equal(isImminent(new Date(2026,10,27,16,0), now, true), false, '완료 업무');
  assert.equal(isImminent('', now), false); assert.equal(isImminent('nope', now), false);
  const c = shareModel({memo:'x', f:{received:T(26,9,10), due:T(27,16,0)}}, ctx()).blocks[1].cells;
  assert.deepEqual(c.map(x=>[x.label, x.strong, x.imminent]), [['접수시각',false,false],['기한',true,true]], '기한은 굵게, 임박이면 임박 색');
  assert.match(shareHtml(shareModel({memo:'x', f:{due:T(27,16,0)}}, ctx())), /<b class="imm">2026\/11\/27 \(금\) 16:00<\/b>/);
});

test('사용자 칸도 양식과 같은 순서로 3번 칸에', () => {
  const fields=[{key:'received',label:'접수시각'},{key:'due',label:'기한'},{key:'c1',label:'회신 기한'}];
  const b = shareModel({memo:'x', f:{received:T(26,9,10), c1:T(29,9,0)}}, ctx({fields})).blocks[1];
  assert.deepEqual(b.cells.map(c=>c.label), ['접수시각','회신 기한']);
});

test('완료한 업무는 머리에 완료 시각', () => {
  const m = shareModel(SAMPLE, ctx({done:true, doneAt:new Date(2026,10,26,17,0).getTime()}));
  assert.equal(m.head.done, '2026/11/26 17:00');
  assert.match(shareHtml(m), /완료 2026\/11\/26 17:00 · 2026\/11\/27 15:20 기준/);
  assert.equal(shareModel(SAMPLE, ctx()).head.done, '');
  assert.equal(shareModel(SAMPLE, ctx()).blocks.find(b=>b.kind==='times').cells[1].imminent, false, '11/28 14:00 은 임박 아님');
});

test('[글자로 복사]: 설계서 6절의 꼴 그대로', () => {
  assert.equal(shareText(SAMPLE, ctx()), [
    '[업무 공유] 2026/11/27 15:20 기준',
    '입찰공고 정정 사유 확인',
    '시설과에서 공고문 규격 부분 정정을 요청했습니다.',
    '',
    '■ 통화 내용',
    '사유서는 내일 오전에 보내기로 함.',
    '',
    '■ 하위 업무 (3개 중 1개 끝남)',
    '✓ 정정 사유서 받기 — 11/26(목) 10:00',
    '□ 공고문 정정안 검토 — 박조달 주무관 · 11/27(금) 16:00',
    '□ 재공고 일정 회신',
    '',
    '■ 접수시각 2026/11/26 (목) 09:10',
    '■ 기한 2026/11/28 (토) 14:00',
    '■ 식별정보 공고번호 R26BK00123456',
    '■ 관련소속 · 관련인 시설과 김서준 주무관',
  ].join('\n'));
});

test('[글자로 복사]는 접지 않고 전부 싣는다', () => {
  const d = {memo:'제목\n'+Array.from({length:20},(_,i)=>'줄'+i).join('\n'),
    contacts:Array.from({length:6},(_,i)=>({who:'p'+i, org:'과', phone:'', email:''})),
    subs:Array.from({length:8},(_,i)=>({title:'s'+i, done:i<4}))};
  const t = shareText(d, ctx());
  assert.ok(t.includes('줄19')); assert.ok(t.includes('s0') && t.includes('s7')); assert.ok(t.includes('과 p5'));
  assert.ok(t.includes('■ 관련소속 · 관련인\n  과 p0\n'), '여럿이면 한 줄씩');
  assert.ok(!t.includes('외 '), '"외 N명" 표시가 없다');
});

test('날짜 꼴과 파일 이름', () => {
  assert.equal(fmtLong(T(28,14,0)), '2026/11/28 (토) 14:00');
  assert.equal(fmtShort(T(27,16,0)), '11/27(금) 16:00');
  assert.equal(fmtStamp(NOW), '2026/11/27 15:20');
  assert.equal(fmtLong('잘못된 값'), '');
  assert.equal(shareFileName(new Date(2026,0,5,9,7)), '뭐하려했더라_공유_20260105_0907.png');
});

test('마크업: 글은 이스케이프하고, 단추는 미리 보기에서만(controls)', () => {
  const m = shareModel({memo:'<b>꺾쇠</b> & "따옴표"', contacts:Array.from({length:3},()=>({who:'a', org:'', phone:'', email:''}))}, ctx());
  const h = shareHtml(m);
  assert.ok(h.includes('&lt;b&gt;꺾쇠&lt;/b&gt; &amp; &quot;따옴표&quot;'));
  assert.ok(!h.includes('sh-fold'), '나가는 그림에는 단추가 없다');
  assert.ok(shareHtml(m, {controls:true}).includes('class="sh-fold" data-fold="people">펼치기 ▾'));
  assert.ok(!/<br|&nbsp;/.test(h), 'SVG 안 XHTML 로도 읽히게 빈 요소·HTML 전용 이름을 쓰지 않는다');
});

test('그림 색은 늘 밝은 테마 — styles.css :root(밝게) 토큰과 같은 값', () => {
  const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'styles.css'), 'utf8');
  const root = css.slice(css.indexOf(':root{'), css.indexOf('}', css.indexOf(':root{')));
  for(const [k, v] of Object.entries(SHARE_TOKENS)){
    const m = new RegExp(`--${k}:\\s*(#[0-9a-fA-F]{3,8})`).exec(root);
    assert.ok(m, `--${k} 가 :root 에 있다`);
    assert.equal(m[1].toLowerCase(), v.toLowerCase(), `--${k}`);
  }
});

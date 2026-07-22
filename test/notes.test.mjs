// 법률노트 — {[법령명-조항]} 참조 해석 검증
//
// 노트는 평범한 텍스트다. 특별한 건 참조 표기 하나뿐이라, 그 하나가 정확해야 한다.
// 특히 "없는 조를 조용히 법령 링크로 떨어뜨리지 않는다" 가 핵심이다 —
// 잘못 적은 걸 눈치채지 못하면 노트가 틀린 근거를 붙들고 있게 된다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const LawNotes = createRequire(import.meta.url)("../src/notes.js");

// 실제 그래프와 같은 모양의 최소 노드 집합
const NODES = [
  { id: "law:nca", kind: "법령", type: "법률", label: "국가계약법", name: "국가를 당사자로 하는 계약에 관한 법률" },
  { id: "law:nca-e", kind: "법령", type: "시행령", label: "국가계약법 시행령", name: "국가를 당사자로 하는 계약에 관한 법률 시행령" },
  { id: "law:pps", kind: "법령", type: "법률", label: "조달사업법", name: "조달사업에 관한 법률" },
  { id: "art:nca:7", kind: "조문", label: "제7조", title: "계약의 방법", lawId: "nca" },
  { id: "art:nca:5의2", kind: "조문", label: "제5조의2", title: "청렴계약", lawId: "nca" },
  { id: "art:nca-e:10", kind: "조문", label: "제10조", title: "경쟁방법", lawId: "nca-e" },
];

test("조 번호 표기를 정규화한다", () => {
  for (const s of ["제7조", "7조", "7"]) assert.equal(LawNotes.joNo(s), "7", s);
  for (const s of ["제5조의2", "5조의2", "5의2"]) assert.equal(LawNotes.joNo(s), "5의2", s);
  assert.equal(LawNotes.joNo("계약의 방법"), null, "조 표기가 아니면 null");
  assert.equal(LawNotes.joNo(""), null);
});

test("참조를 법령명과 조로 가른다", () => {
  assert.deepEqual(LawNotes.splitRef("국가계약법-제7조"), { name: "국가계약법", jo: "7" });
  assert.deepEqual(LawNotes.splitRef("국가계약법 제7조"), { name: "국가계약법", jo: "7" });
  assert.deepEqual(LawNotes.splitRef("국가계약법"), { name: "국가계약법", jo: null });
  // 법령명에 공백이 있어도 마지막 토큰만 조로 본다
  assert.deepEqual(LawNotes.splitRef("국가계약법 시행령-10조"), { name: "국가계약법 시행령", jo: "10" });
});

test("본문에서 참조를 위치와 함께 뽑는다", () => {
  const refs = LawNotes.parseRefs("앞부분 {[국가계약법-제7조]} 뒤에 {[조달사업법]} 끝");
  assert.equal(refs.length, 2);
  assert.equal(refs[0].name, "국가계약법");
  assert.equal(refs[0].jo, "7");
  assert.equal(refs[1].jo, null);
  assert.equal("앞부분 {[국가계약법-제7조]} 뒤에 {[조달사업법]} 끝".slice(refs[0].start, refs[0].end), refs[0].raw);
});

test("약칭과 정식명을 모두 받는다", () => {
  assert.equal(LawNotes.findLaw("국가계약법", NODES).id, "law:nca");
  assert.equal(LawNotes.findLaw("국가를 당사자로 하는 계약에 관한 법률", NODES).id, "law:nca");
  assert.equal(LawNotes.findLaw("국가계약법시행령", NODES).id, "law:nca-e", "공백 없이 써도 찾는다");
});

test("참조를 노드 id 로 푼다", () => {
  assert.equal(LawNotes.resolve({ name: "국가계약법", jo: "7" }, NODES), "art:nca:7");
  assert.equal(LawNotes.resolve({ name: "국가계약법", jo: null }, NODES), "law:nca");
  assert.equal(LawNotes.resolve({ name: "국가계약법 시행령", jo: "10" }, NODES), "art:nca-e:10");
  assert.equal(LawNotes.resolve({ name: "국가계약법", jo: "5의2" }, NODES), "art:nca:5의2");
});

test("없는 조는 법령으로 떨어뜨리지 않고 실패시킨다", () => {
  // 조용히 법령 링크로 바꾸면 잘못 적은 걸 눈치채지 못한다.
  assert.equal(LawNotes.resolve({ name: "국가계약법", jo: "9999" }, NODES), null);
  assert.equal(LawNotes.resolve({ name: "없는법", jo: null }, NODES), null);
});

test("법령명 자동완성 — 일부만 쳐도 목록을 준다", () => {
  const s = LawNotes.suggest("국가", NODES);
  assert.ok(s.length >= 2, "국가계약법 계열이 나와야 한다");
  assert.ok(s.every((x) => x.kind === "법령"));
  assert.ok(s.some((x) => x.label === "국가계약법"));
  assert.equal(s[0].insert, "국가계약법", "삽입할 문자열을 함께 준다");
});

test("빈 입력이면 전체 법령을 준다", () => {
  const s = LawNotes.suggest("", NODES);
  assert.ok(s.length > 0);
  assert.ok(s.every((x) => x.kind === "법령"));
});

test("'-' 를 찍으면 그 법령의 조문으로 좁힌다", () => {
  const s = LawNotes.suggest("국가계약법-", NODES);
  assert.ok(s.length >= 2);
  assert.ok(s.every((x) => x.kind === "조문"));
  assert.ok(s.some((x) => x.label === "제7조"));
  assert.ok(!s.some((x) => x.label === "제10조"), "다른 법령의 조문이 섞이면 안 된다");
  assert.equal(s.find((x) => x.label === "제7조").insert, "국가계약법-제7조");
});

test("조 번호를 치면 더 좁힌다", () => {
  const s = LawNotes.suggest("국가계약법-5", NODES);
  assert.ok(s.some((x) => x.label === "제5조의2"));
  assert.ok(!s.some((x) => x.label === "제7조"));
});

test("HTML 로 만들 때 찾은 것은 링크, 못 찾은 것은 표시", () => {
  const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const link = (id, text) => `<a data-go="${id}">${esc(text)}</a>`;
  const miss = (text) => `<span class="miss">${esc(text)}</span>`;

  const html = LawNotes.toHtml("근거는 {[국가계약법-제7조]} 이고 {[없는법-제1조]} 는 오타", NODES, esc, link, miss);
  assert.match(html, /<a data-go="art:nca:7">/);
  assert.match(html, /<span class="miss">/);
  assert.match(html, /근거는 /);
  assert.match(html, / 는 오타$/);
});

test("참조가 없으면 그냥 텍스트다", () => {
  const esc = (t) => String(t);
  const html = LawNotes.toHtml("그냥 메모입니다", NODES, esc, () => "L", () => "M");
  assert.equal(html, "그냥 메모입니다");
});

test("HTML 을 이스케이프한다 — 노트에 태그를 써도 안전해야 한다", () => {
  const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const html = LawNotes.toHtml("<script>alert(1)</script>", NODES, esc, () => "L", () => "M");
  assert.ok(!html.includes("<script>"), "생 태그가 새어나가면 안 된다");
});

test("기록 보관함 — 담기·불러오기·지우기", () => {
  const data = new Map();
  LawNotes.useStore({
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, v),
  });

  assert.deepEqual(LawNotes.archiveList(), []);
  const a = LawNotes.archive("첫 메모 {[국가계약법-제7조]}\n둘째 줄", new Date("2026-07-22T01:00:00Z"));
  const b = LawNotes.archive("둘째 메모", new Date("2026-07-22T02:00:00Z"));

  const list = LawNotes.archiveList();
  assert.equal(list.length, 2);
  assert.equal(list[0].id, b.id, "최근 것이 위로");
  assert.equal(LawNotes.archiveGet(a.id).text, "첫 메모 {[국가계약법-제7조]}\n둘째 줄");

  assert.equal(LawNotes.archiveRemove(a.id), true);
  assert.equal(LawNotes.archiveList().length, 1);
  assert.equal(LawNotes.archiveRemove("없는id"), false);
});

test("제목은 첫 줄에서 따되 참조 표기는 벗긴다", () => {
  assert.equal(LawNotes.titleOf("근거 {[국가계약법-제7조]} 확인\n다음 줄"), "근거 국가계약법-제7조 확인");
  assert.equal(LawNotes.titleOf(""), "(제목 없음)");
  assert.equal(LawNotes.titleOf("   \n내용"), "(제목 없음)");
  assert.ok(LawNotes.titleOf("가".repeat(60)).endsWith("…"));
});

test("빈 노트는 보관하지 않는다", () => {
  const data = new Map();
  LawNotes.useStore({ getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) });
  assert.equal(LawNotes.archive("   \n  "), null);
  assert.deepEqual(LawNotes.archiveList(), []);
});

test("보관함이 손상돼도 페이지가 죽지 않는다", () => {
  const data = new Map([[LawNotes.ARCHIVE, "{망가진 JSON"]]);
  LawNotes.useStore({ getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) });
  assert.deepEqual(LawNotes.archiveList(), []);
  assert.doesNotThrow(() => LawNotes.archive("새 메모"));
});

test("저장·복원과 저장소 실패 내성", () => {
  const data = new Map();
  LawNotes.useStore({
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, v),
  });
  assert.equal(LawNotes.load(), "");
  assert.equal(LawNotes.save("메모 {[국가계약법-제7조]}"), true);
  assert.equal(LawNotes.load(), "메모 {[국가계약법-제7조]}");

  // 던지는 저장소여도 페이지가 죽으면 안 된다
  LawNotes.useStore({
    getItem: () => { throw new Error("boom"); },
    setItem: () => { throw new Error("quota"); },
  });
  assert.equal(LawNotes.load(), "");
  assert.equal(LawNotes.save("x"), false);
});

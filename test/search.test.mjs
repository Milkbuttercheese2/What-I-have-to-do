// 검색 랭킹 검증
//
// 브라우저에 인라인되는 src/search-runtime.js 를 그대로 불러 검증한다 (단일 원천).
// 데이터는 픽스처 기반 — 실수집 결과(data/snapshot.json)는 gitignore 대상이라 테스트가 의존하면 안 된다.
//
// 실측 배경: 1,223조문에서 선형 스캔이 타건당 2~3ms 라 속도는 병목이 아니다.
// 문제는 "수의계약" 한 번에 60건이 순위 없이 쏟아지는 것 → 이 파일은 랭킹을 검증한다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { buildGraph } from "../src/extract.mjs";

const require = createRequire(import.meta.url);
const LawSearch = require("../src/search-runtime.cjs");

const snapshot = JSON.parse(readFileSync(new URL("./fixture-snapshot.json", import.meta.url), "utf8"));
const g = buildGraph(snapshot);
const idx = LawSearch.create(g.nodes);

const top = (q, k = 1) => idx.search(q, k).map((h) => h.node);
const label = (n) => (n.kind === "조문" ? `${n.group} ${n.label}` : n.label);

test("조번호 표기를 하나로 모은다", () => {
  const p = LawSearch.parseQuery;
  assert.equal(p("제7조").jo, "7");
  assert.equal(p("7조").jo, "7");
  assert.equal(p("제 7 조").jo, "7");
  assert.equal(p("제2조의2").jo, "2의2");
  assert.equal(p("42").jo, "42", "숫자만 쳐도 조번호로 본다");
  // 조번호와 키워드를 섞어 치는 게 실무 패턴이다
  const mix = p("7조 보증금");
  assert.equal(mix.jo, "7");
  assert.deepEqual(mix.terms, ["보증금"]);
});

test("초성 변환", () => {
  assert.equal(LawSearch.chosung("수의계약"), "ㅅㅇㄱㅇ");
  assert.equal(LawSearch.chosung("공동계약"), "ㄱㄷㄱㅇ");
  assert.equal(LawSearch.chosung("abc123"), "abc123", "한글이 아니면 그대로");
});

test("띄어쓰기·구두점을 무시한다", () => {
  assert.equal(LawSearch.normalize("공동 계약 운용요령"), "공동계약운용요령");
  assert.equal(LawSearch.normalize("「국가계약법」 제7조"), "국가계약법제7조");
});

test("조번호 검색이 그 조문을 최상위로 올린다", () => {
  assert.equal(label(top("제72조")[0]), "국가계약법 시행령 제72조");
  assert.equal(label(top("2조의2")[0]), "공동계약운용요령 제2조의2");
});

test("조번호만 물으면 다른 조문은 아예 빼낸다", () => {
  const hits = idx.search("제72조");
  assert.ok(hits.length > 0);
  assert.ok(hits.every((h) => h.node.label === "제72조"), "제72조가 아닌 결과가 섞였다");
});

test("조번호 + 키워드 조합", () => {
  // 픽스처에서 제1조는 두 예규 모두에 있다. 키워드로 갈라져야 한다.
  const hits = idx.search("1조 종합계약", 3);
  assert.equal(label(hits[0].node), "종합계약집행요령 제1조");
});

test("조문제목 매치가 본문 매치를 이긴다", () => {
  // "공동계약"은 시행령 제72조의 제목이자 여러 조문의 본문에 등장한다.
  const first = top("공동계약")[0];
  assert.ok(
    first.title?.includes("공동계약") || first.label?.includes("공동계약"),
    `제목 매치가 최상위가 아니다: ${label(first)} (${first.title})`,
  );
});

test("초성만으로도 찾는다", () => {
  const hits = idx.search("ㄱㄷㄱㅇ", 5); // 공동계약
  assert.ok(hits.length > 0, "초성 검색 결과가 없다");
  assert.ok(
    hits.some((h) => (h.node.title || "").includes("공동계약") || (h.node.label || "").includes("공동계약")),
    "초성으로 공동계약 조문을 못 찾았다",
  );
});

test("검색어가 모두 걸려야 한다 (AND)", () => {
  assert.equal(idx.search("공동계약 존재하지않는단어").length, 0);
});

test("빈 질의는 결과 없음", () => {
  assert.equal(idx.search("").length, 0);
  assert.equal(idx.search("   ").length, 0);
});

test("동점이면 상위 법령이 앞선다", () => {
  // 픽스처의 법률(국가계약법) vs 시행령 — 같은 조건이면 법률이 먼저.
  const w = LawSearch.score;
  const mk = (type) => ({ kind: "조문", type, label: "제1조", title: "계약", group: "X", text: "" });
  const ix = LawSearch.indexNode(mk("법률"));
  const q = LawSearch.parseQuery("계약");
  assert.ok(w(mk("법률"), ix, q) > w(mk("시행령"), ix, q));
  assert.ok(w(mk("시행령"), ix, q) > w(mk("계약예규"), ix, q));
});

test("결과 수 제한이 동작한다", () => {
  assert.ok(idx.search("계약", 3).length <= 3);
});

test("검색 대상 스코프 — 법령/행정규칙을 가른다", () => {
  // scopeOf: 법률/시행령 계열은 법령, 계약예규·훈령 등은 행정규칙, 외부법은 법령.
  assert.equal(LawSearch.scopeOf({ kind: "조문", type: "법률" }), "법령");
  assert.equal(LawSearch.scopeOf({ kind: "조문", type: "시행규칙" }), "법령");
  assert.equal(LawSearch.scopeOf({ kind: "조문", type: "계약예규" }), "행정규칙");
  assert.equal(LawSearch.scopeOf({ kind: "별표", type: "훈령" }), "행정규칙");
  assert.equal(LawSearch.scopeOf({ kind: "외부법", type: "외부" }), "법령");

  const mini = LawSearch.create([
    { id: "a", kind: "조문", type: "법률", label: "제1조", title: "계약", group: "국가계약법", text: "" },
    { id: "b", kind: "조문", type: "계약예규", label: "제1조", title: "계약", group: "공사계약일반조건", text: "" },
  ]);
  const 전체 = mini.search("계약", 60);
  const 법령 = mini.search("계약", 60, { scope: "법령" });
  const 행정 = mini.search("계약", 60, { scope: "행정규칙" });
  assert.equal(전체.length, 2, "전체는 둘 다");
  assert.deepEqual(법령.map((h) => h.node.id), ["a"], "법령 스코프는 법률만");
  assert.deepEqual(행정.map((h) => h.node.id), ["b"], "행정규칙 스코프는 예규만");
});

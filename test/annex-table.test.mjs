// 별표 罫線 표 → 실제 표 변환 검증
//
// 브라우저에 인라인되는 src/annex-table.js 를 그대로 불러 검증한다 (단일 원천).
// 입력은 tidyAnnexText 를 거친 형태(罫線 + 원문 줄바꿈)를 쓴다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { tidyAnnexText } from "../src/lawapi.mjs";

const AnnexTable = createRequire(import.meta.url)("../src/annex-table.js");

// 실제 별표에서 딴 최소 표 (罫線 형태)
const RAW =
  "1. 일반기준\n" +
  "가. 어쩌고 저쩌고 기준을 적용한다.\n" +
  "2. 개별기준\n" +
  "┌─────────────────┬──────┐\n" +
  "│입찰참가자격 제한사유       │제재기간   │\n" +
  "├─────────────────┼──────┤\n" +
  "│가. 부실벌점이 150점 이상인 자 │2년      │\n" +
  "│나. 부실벌점이 100점 이상인 자 │1년      │\n" +
  "└─────────────────┴──────┘";

test("표 앞뒤 산문과 표를 블록으로 가른다", () => {
  const blocks = AnnexTable.parse(RAW);
  assert.deepEqual(blocks.map((b) => b.type), ["text", "table"]);
});

test("첫 구분선 위 1행을 머리글로 잡는다", () => {
  const t = AnnexTable.parse(RAW).find((b) => b.type === "table");
  assert.deepEqual(t.head, ["입찰참가자격 제한사유", "제재기간"]);
  assert.equal(t.rows.length, 2);
  assert.deepEqual(t.rows[0], ["가. 부실벌점이 150점 이상인 자", "2년"]);
});

test("셀 안에서 줄바꿈된 조각을 앞 행에 이어붙인다", () => {
  // "부실시공 또는 부실설계" + "ㆍ감리를 한 자" (가운뎃점 시작 → 공백 없이 붙임)
  const raw =
    "┌────────┬────┐\n" +
    "│사유         │기간  │\n" +
    "├────────┼────┤\n" +
    "│1. 부실시공 또는 부실설계 │    │\n" +
    "│ㆍ감리를 한 자        │2년   │\n" +
    "└────────┴────┘";
  const t = AnnexTable.parse(raw).find((b) => b.type === "table");
  assert.equal(t.rows.length, 1, "두 줄이 한 행으로 합쳐져야 한다");
  assert.equal(t.rows[0][0], "1. 부실시공 또는 부실설계ㆍ감리를 한 자");
  assert.equal(t.rows[0][1], "2년", "둘째 칸도 이어져야 한다");
});

test("항목 기호로 시작하는 셀은 새 행이다 (오병합 방지)", () => {
  const t = AnnexTable.parse(RAW).find((b) => b.type === "table");
  // "가." 와 "나." 는 각각 새 행 — 합쳐지면 안 된다
  assert.equal(t.rows[1][0], "나. 부실벌점이 100점 이상인 자");
});

test("HTML 로 렌더 — thead/tbody 구조", () => {
  const html = AnnexTable.toHtml(AnnexTable.parse(RAW));
  assert.match(html, /<table class="ann">/);
  assert.match(html, /<th>제재기간<\/th>/);
  assert.match(html, /<td>2년<\/td>/);
  assert.match(html, /class="ann-tw"/, "가로 스크롤 래퍼가 있어야 한다");
});

test("HTML 산문 블록은 renderText 콜백으로 그린다 (인용 링크 주입점)", () => {
  const html = AnnexTable.toHtml(AnnexTable.parse(RAW), (t) => `<X>${t}</X>`);
  assert.match(html, /<X>1\. 일반기준/);
});

test("HTML 이스케이프 — 셀에 든 꺾쇠", () => {
  const raw = "┌────┬───┐\n│<b>사유│기간 │\n├────┼───┤\n│위험 &amp; 태그│1년 │\n└────┴───┘";
  const html = AnnexTable.toHtml(AnnexTable.parse(raw));
  assert.ok(!html.includes("<b>사유"), "셀 안 태그가 살아있으면 안 된다");
  assert.match(html, /&lt;b&gt;/);
});

test("마크다운 — 표가 개행 하나로 묶여 성립한다", () => {
  const md = AnnexTable.toMarkdown(AnnexTable.parse(RAW));
  const lines = md.split("\n");
  const sep = lines.findIndex((l) => /^\|\s*---/.test(l));
  assert.ok(sep > 0, "구분선이 있어야 한다");
  assert.match(lines[sep - 1], /입찰참가자격 제한사유/, "구분선 바로 위가 머리글");
  assert.match(lines[sep + 1], /가\. 부실벌점/, "구분선 바로 아래가 첫 데이터행");
  assert.ok(!/\|\n\n\|/.test(md), "표 행 사이에 빈 줄이 끼면 안 된다");
});

test("마크다운 셀 안의 파이프를 이스케이프한다", () => {
  const raw = "┌────┬───┐\n│사유    │기간 │\n├────┼───┤\n│A | B 조건│1년 │\n└────┴───┘";
  const md = AnnexTable.toMarkdown(AnnexTable.parse(raw));
  assert.match(md, /A \\\| B 조건/);
});

test("표 없는 순수 산문은 그대로 통과한다", () => {
  const blocks = AnnexTable.parse("제1조 목적\n제2조 정의");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "text");
});

test("실데이터 tidyAnnexText 출력에서 표를 뽑아낸다", () => {
  // tidyAnnexText 를 거친 罫線 텍스트가 그대로 파싱되는지 (파이프라인 연결 확인)
  const raw =
    "2. 개별기준          ,┌────┬───┐,│사유    │기간 │,├────┼───┤,│가. 갑    │2년  │,└────┴───┘";
  const tidied = tidyAnnexText(raw);
  const t = AnnexTable.parse(tidied).find((b) => b.type === "table");
  assert.ok(t, "표 블록이 나와야 한다");
  assert.deepEqual(t.head, ["사유", "기간"]);
  assert.deepEqual(t.rows[0], ["가. 갑", "2년"]);
});

// 별표 본문 복원 검증
//
// 입력 조각은 「국가계약법 시행규칙 [별표 2] 부정당업자의 입찰참가자격 제한기준」
// 실제 API 응답에서 따온 것이다 (표기·패딩까지 원문 그대로).
//
// API는 별표를 개행 없이 한 줄로 주고, 원래 줄바꿈은 `,` 로, 표는 罫線 문자로 인코딩한다.
// 실측: 줄바꿈 마커 4,132건 / 문장 쉼표 3,865건 — 앞 글자로 갈린다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { tidyAnnexText } from "../src/lawapi.mjs";

test("줄바꿈 마커(앞이 공백인 쉼표)를 개행으로 되돌린다", () => {
  const raw = "그 처분일부터 입찰       ,  참가자격제한기간 종료 후 6개월이";
  const lines = tidyAnnexText(raw).split("\n");
  assert.equal(lines.length, 2);
  assert.equal(lines[0], "그 처분일부터 입찰", "오른쪽 패딩은 제거");
  // 마커 뒤 공백은 들여쓰기라 남긴다 (아래 들여쓰기 테스트 참조)
  assert.equal(lines[1].trimStart(), "참가자격제한기간 종료 후 6개월이");
});

test("문장 쉼표(앞이 일반 글자)는 건드리지 않는다", () => {
  const raw = "2분의 1 범위에서 줄일 수 있으며, 위반의 정도가 현저히 경미한 경우";
  assert.equal(tidyAnnexText(raw), raw);
  assert.equal(tidyAnnexText(raw).split("\n").length, 1);
});

test("한 문자열에 마커와 쉼표가 섞여 있어도 구분한다", () => {
  const raw = "제재기간을               ,  2분의 1 범위에서 줄일 수 있으며, 위반의 정도가";
  const lines = tidyAnnexText(raw).split("\n");
  assert.equal(lines.length, 2, "마커 1개만 개행이어야 한다");
  assert.match(lines[1], /줄일 수 있으며, 위반의/, "문장 쉼표가 살아있어야 한다");
});

test("罫線 표 줄을 그대로 보존한다 (열 정렬이 깨지면 표가 아니다)", () => {
  const raw =
    "┌─────────┬──────┐,│입찰참가자격 제한사유    │제재기간   │," +
    "├─────────┼──────┤,│  가. 부실벌점이 150점 이상인 자 │2년      │,└─────────┴──────┘";
  const lines = tidyAnnexText(raw).split("\n");
  assert.equal(lines.length, 5);
  assert.ok(lines[0].startsWith("┌"), "표 상단 테두리");
  assert.ok(lines[3].includes("│2년"), "셀 구분자와 내용이 유지돼야 한다");
  assert.ok(lines[4].startsWith("└"), "표 하단 테두리");
});

test("오른쪽 패딩은 지우고 왼쪽 들여쓰기는 남긴다", () => {
  // 들여쓰기는 항목 계층을 나타내므로 의미가 있다.
  const raw = "1. 일반기준          ,    가. 각 중앙관서의 장은";
  const lines = tidyAnnexText(raw).split("\n");
  assert.equal(lines[0], "1. 일반기준", "오른쪽 패딩 제거");
  assert.match(lines[1], /^ {2,}가\./, "왼쪽 들여쓰기 보존");
});

test("줄을 합치지 않는다 — 합치면 원문이 왜곡된다", () => {
  // "등" + "을 고려하여" 는 붙여야 맞고, "제재기간을" + "2분의" 는 띄어야 맞다.
  // 패딩 길이로 구분되지 않으므로 어느 쪽으로 합쳐도 한쪽이 틀린다 → 원문 줄바꿈을 유지한다.
  const a = tidyAnnexText("횟수 등            ,  을 고려하여 제2호에");
  const b = tidyAnnexText("정한 제재기간을               ,  2분의 1 범위에서");
  assert.equal(a.split("\n").length, 2);
  assert.equal(b.split("\n").length, 2);
  assert.ok(!a.includes("등을"), "임의로 붙이지 않는다");
  assert.ok(!b.includes("제재기간을 2분의"), "임의로 띄우지 않는다");
});

test("빈 입력·공백 입력을 안전하게 처리한다", () => {
  assert.equal(tidyAnnexText(""), "");
  assert.equal(tidyAnnexText(null), "");
  assert.equal(tidyAnnexText(undefined), "");
  assert.equal(tidyAnnexText("   ,   ,   "), "");
});

test("검색 정규화와 맞물린다 — 줄이 나뉘어도 용어가 걸린다", async () => {
  const { createRequire } = await import("node:module");
  const LawSearch = createRequire(import.meta.url)("../src/search-runtime.js");
  const out = tidyAnnexText("그 처분일부터 입찰       ,  참가자격제한기간 종료 후");
  // 줄바꿈을 유지해도 검색은 공백·개행을 지우고 대조하므로 영향이 없다.
  assert.ok(LawSearch.normalize(out).includes("입찰참가자격제한기간"));
});

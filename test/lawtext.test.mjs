// 조문 본문 들여쓰기 검증
//
// 실제 「국가계약법 시행령」 제76조 응답에서 딴 조각을 쓴다.
// API 는 항·호·목을 줄로는 나누지만 전부 왼쪽에 붙여 보내서 계층이 안 보인다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const LawText = createRequire(import.meta.url)("../src/lawtext.js");

const 실원문 = [
  "제76조(부정당업자의 입찰참가자격 제한)",
  "① 법 제27조제1항제8호에서 \"대통령령으로 정하는 기준에 따른 사망 등 중대한 위해\"란 …",
  "② 법 제27조제1항제9호 각 목 외의 부분에서 \"대통령령으로 정하는 자\"란 다음 각 호의 구분에 따른 자를 말한다.",
  "1.  경쟁의 공정한 집행을 저해할 염려가 있는 자로서 다음 각 목의 어느 하나에 해당하는 자",
  "가.  입찰 또는 계약에 관한 서류를 위조ㆍ변조하거나 부정하게 행사한 자",
  "나.  고의로 무효의 입찰을 한 자.",
  "2.  계약의 적정한 이행을 해칠 염려가 있는 자",
].join("\n");

test("항 0칸 · 호 2칸 · 목 4칸", () => {
  const out = LawText.indent(실원문).split("\n");
  assert.equal(out[0], "제76조(부정당업자의 입찰참가자격 제한)", "조문 머리는 붙는다");
  assert.ok(out[1].startsWith("① "), "항은 들여쓰지 않는다");
  assert.ok(out[3].startsWith("  1."), "호는 2칸");
  assert.ok(out[4].startsWith("    가."), "목은 4칸");
  assert.ok(out[6].startsWith("  2."), "다음 호도 2칸");
});

test("깊이 판정", () => {
  assert.equal(LawText.depthOf("① 어쩌고"), 0);
  assert.equal(LawText.depthOf("1.  어쩌고"), 1);
  assert.equal(LawText.depthOf("가.  어쩌고"), 2);
  assert.equal(LawText.depthOf("1)  어쩌고"), 3);
  assert.equal(LawText.depthOf("가)  어쩌고"), 3);
  assert.equal(LawText.depthOf("그냥 문장이다"), -1, "표시가 없으면 -1");
});

test("문장 속 숫자를 호로 착각하지 않는다", () => {
  // "2013.12.30." 같은 날짜나 "제1항제2호" 는 줄 첫머리의 "N. " 형태가 아니다
  assert.equal(LawText.depthOf("2013.12.30. 개정된 내용"), -1);
  assert.equal(LawText.depthOf("제1항제2호에 따라"), -1);
});

test("표시 없는 줄은 앞 줄 깊이를 물려받는다", () => {
  const src = ["1.  첫 호의 시작", "이어지는 문장이다", "2.  다음 호"].join("\n");
  const out = LawText.indent(src).split("\n");
  assert.ok(out[0].startsWith("  1."));
  assert.ok(out[1].startsWith("  이어지는"), "이어지는 문장도 같은 블록으로 보여야 한다");
  assert.ok(out[2].startsWith("  2."));
});

test("원문에 이미 있던 앞 공백은 걷어내고 다시 매긴다", () => {
  const out = LawText.indent("      1.  들쭉날쭉하게 들여쓴 호").split("\n");
  assert.equal(out[0], "  1.  들쭉날쭉하게 들여쓴 호");
});

test("빈 줄과 빈 입력을 안전하게 다룬다", () => {
  assert.equal(LawText.indent(""), "");
  assert.equal(LawText.indent(null), "");
  assert.equal(LawText.indent(undefined), "");
  const out = LawText.indent("1.  가\n\n2.  나").split("\n");
  assert.equal(out[1], "", "빈 줄은 빈 줄로");
});

test("글자를 더하거나 빼지 않는다 — 공백만 바뀐다", () => {
  const before = 실원문.replace(/\s/g, "");
  const after = LawText.indent(실원문).replace(/\s/g, "");
  assert.equal(after, before, "공백을 지우면 원문과 같아야 한다(검색·인용 매칭의 전제)");
});

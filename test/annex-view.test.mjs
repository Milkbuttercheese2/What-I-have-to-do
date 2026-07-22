// 별표 원본 뷰어 — 표시는 원본, 검색은 텍스트
//
// 핵심 계약: 파일이 있으면 PDF iframe 을 본체로, 없으면 다운로드 링크 + 파싱표로 물러난다.
// 어느 경우든 파싱표(검색·복사용)는 남는다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const AnnexView = createRequire(import.meta.url)("../src/annex-view.js");
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

const 별표 = {
  kind: "별표", label: "[별표 2]", title: "부정당업자 제한기준",
  pdfSeq: "160399157", hwpSeq: "160399155",
  pdfName: "제한기준.pdf", hwpName: "제한기준.hwp",
  text: "표 내용",
};

test("파일이 있으면 PDF iframe 을 본체로 건다", () => {
  const avail = new Set(["160399157.pdf", "160399155.hwp"]);
  const html = AnnexView.render(별표, { avail, esc, tableHtml: "<table></table>" });
  assert.match(html, /<iframe[^>]+src="annex\/160399157\.pdf"/, "로컬 PDF iframe");
  assert.match(html, /href="annex\/160399157\.pdf"[^>]*download/, "PDF 로컬 다운로드");
  assert.match(html, /href="annex\/160399155\.hwp"[^>]*download/, "HWP 로컬 다운로드");
  // 파싱표는 접혀 있다(원본이 본체)
  assert.match(html, /<details class="parsed">/);
  assert.doesNotMatch(html, /<details class="parsed" open>/);
});

test("파일이 없으면 법제처 링크 + 파싱표를 펼친다", () => {
  const html = AnnexView.render(별표, { avail: new Set(), esc, tableHtml: "<table></table>" });
  assert.doesNotMatch(html, /<iframe/, "로컬 파일이 없으면 iframe 을 걸지 않는다");
  assert.match(html, /flDownload\.do\?flSeq=160399157/, "PDF 는 법제처 링크로 폴백");
  assert.match(html, /flDownload\.do\?flSeq=160399155/, "HWP 도 법제처 링크로 폴백");
  assert.match(html, /target="_blank"/, "외부 링크는 새 탭");
  assert.match(html, /<details class="parsed" open>/, "뷰어가 없으면 파싱표를 펼친다");
});

test("pdfSeq 만 있어도 동작한다 (HWP 링크 없음)", () => {
  const only = { kind: "별표", label: "[별표 1]", pdfSeq: "111", text: "x" };
  const html = AnnexView.render(only, { avail: new Set(["111.pdf"]), esc });
  assert.match(html, /annex\/111\.pdf/);
  assert.doesNotMatch(html, /HWP 원본/);
});

test("파일도 파싱표도 없으면 조용히 안내만", () => {
  const bare = { kind: "별표", label: "[별지 1]", text: "" };
  const html = AnnexView.render(bare, { avail: new Set(), esc });
  assert.match(html, /novip/, "뷰어 안내 문구");
  assert.doesNotMatch(html, /<details/, "파싱표가 없으면 details 도 없다");
});

test("avail 은 Set 과 배열을 모두 받는다", () => {
  assert.equal(AnnexView.has(["a.pdf"], "a.pdf"), true);
  assert.equal(AnnexView.has(new Set(["a.pdf"]), "a.pdf"), true);
  assert.equal(AnnexView.has(new Set(), "a.pdf"), false);
  assert.equal(AnnexView.has(null, "a.pdf"), false);
});

test("esc 로 속성을 이스케이프한다", () => {
  const evil = { kind: "별표", label: '"><x', pdfSeq: "1", text: "t" };
  const html = AnnexView.render(evil, { avail: new Set(["1.pdf"]), esc });
  assert.doesNotMatch(html, /title="[^"]*"><x/, "제목이 속성을 탈출하면 안 된다");
});

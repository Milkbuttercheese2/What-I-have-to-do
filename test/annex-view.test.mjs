// 별표·별지(서식) 원본 뷰어 — 표시는 원문(PDF/HWP)만, 검색은 노드 텍스트(비표시)로
//
// 핵심 계약: 파일이 있으면 PDF iframe 을 본체로, 없으면 다운로드 링크로 물러난다.
// 파싱표(罫線 → HTML)는 신뢰할 수 없어 제거했다 — 어느 경우에도 파싱표를 그리지 않는다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const AnnexView = createRequire(import.meta.url)("../src/annex-view.cjs");
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

const 별표 = {
  kind: "별표", label: "[별표 2]", title: "부정당업자 제한기준",
  pdfSeq: "160399157", hwpSeq: "160399155",
  pdfName: "제한기준.pdf", hwpName: "제한기준.hwp",
};

test("파일이 있으면 PDF iframe 을 본체로 건다", () => {
  const avail = new Set(["160399157.pdf", "160399155.hwp"]);
  const html = AnnexView.render(별표, { avail, esc, native: true });
  assert.match(html, /<iframe[^>]+src="annex\/160399157\.pdf"/, "로컬 PDF iframe");
  assert.match(html, /href="annex\/160399157\.pdf"[^>]*download/, "PDF 로컬 다운로드");
  assert.match(html, /href="annex\/160399155\.hwp"[^>]*download/, "HWP 로컬 다운로드");
});

test("브라우저(native 아님)에서는 avail 에 있어도 iframe 대신 법제처 카드", () => {
  // 이게 사용자가 겪은 버그: 브라우저엔 PDF 가 동봉 안 됐는데 avail 이 있다고 해 빈 iframe 이 떴다.
  const html = AnnexView.render(별표, { avail: new Set(["160399157.pdf"]), esc /* native 없음 */ });
  assert.doesNotMatch(html, /<iframe/, "브라우저에서는 iframe 을 걸지 않는다");
  assert.match(html, /법제처에서 원문 보기/, "법제처 원문 링크를 크게 제공");
  assert.match(html, /flDownload\.do\?flSeq=160399157/);
});

test("파일이 없으면 법제처 링크로 폴백한다", () => {
  const html = AnnexView.render(별표, { avail: new Set(), esc });
  assert.doesNotMatch(html, /<iframe/, "로컬 파일이 없으면 iframe 을 걸지 않는다");
  assert.match(html, /flDownload\.do\?flSeq=160399157/, "PDF 는 법제처 링크로 폴백");
  assert.match(html, /flDownload\.do\?flSeq=160399155/, "HWP 도 법제처 링크로 폴백");
  assert.match(html, /target="_blank"/, "외부 링크는 새 탭");
});

test("파싱표(罫線 → HTML)는 어떤 경우에도 그리지 않는다", () => {
  const withFile = AnnexView.render(별표, { avail: new Set(["160399157.pdf"]), esc, native: true });
  const noFile = AnnexView.render(별표, { avail: new Set(), esc });
  assert.doesNotMatch(withFile, /<details/, "원본이 있어도 파싱표 없음");
  assert.doesNotMatch(noFile, /<details/, "원본이 없어도 파싱표 없음");
});

test("pdfSeq 만 있어도 동작한다 (HWP 링크 없음)", () => {
  const only = { kind: "별표", label: "[별표 1]", pdfSeq: "111" };
  const html = AnnexView.render(only, { avail: new Set(["111.pdf"]), esc, native: true });
  assert.match(html, /annex\/111\.pdf/);
  assert.doesNotMatch(html, /HWP 원본/);
});

test("파일만 있는 별지 서식(텍스트 없음)도 뷰어로 연다", () => {
  const 서식 = { kind: "서식", label: "[서식 1]", title: "공동수급표준협정서", pdfSeq: "222", formOnly: true };
  const html = AnnexView.render(서식, { avail: new Set(["222.pdf"]), esc, native: true });
  assert.match(html, /<iframe[^>]+src="annex\/222\.pdf"/, "서식도 원본 PDF 로 열린다");
});

test("파일이 하나도 없으면 조용히 안내만", () => {
  const bare = { kind: "서식", label: "[별지 1]" };
  const html = AnnexView.render(bare, { avail: new Set(), esc });
  assert.match(html, /novip/, "뷰어 안내 문구");
  assert.doesNotMatch(html, /<details/, "파싱표 없음");
});

test("avail 은 Set 과 배열을 모두 받는다", () => {
  assert.equal(AnnexView.has(["a.pdf"], "a.pdf"), true);
  assert.equal(AnnexView.has(new Set(["a.pdf"]), "a.pdf"), true);
  assert.equal(AnnexView.has(new Set(), "a.pdf"), false);
  assert.equal(AnnexView.has(null, "a.pdf"), false);
});

test("esc 로 속성을 이스케이프한다", () => {
  const evil = { kind: "별표", label: '"><x', pdfSeq: "1" };
  const html = AnnexView.render(evil, { avail: new Set(["1.pdf"]), esc, native: true });
  assert.doesNotMatch(html, /title="[^"]*"><x/, "제목이 속성을 탈출하면 안 된다");
});

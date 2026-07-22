/* 몇 조항이더라 — 조문 본문 들여쓰기 (브라우저 인라인용, 모듈 아님)
 *
 * 빌드 시 template.html 의 자리표시자에 삽입되고, test/lawtext.test.mjs 가 같은 파일을
 * 읽어 검증한다 — 단일 원천.
 *
 * 법제처 API 의 조문 본문은 항·호·목이 줄로는 나뉘어 있지만 **전부 왼쪽에 붙어 나온다**:
 *
 *     ② 법 제27조제1항제9호 … 다음 각 호의 구분에 따른 자를 말한다.
 *     1.  경쟁의 공정한 집행을 저해할 염려가 있는 자로서 …
 *     가.  입찰 또는 계약에 관한 서류 …
 *
 * 이러면 "1." 이 ②에 속한 호인지, "가." 가 그 호의 목인지가 눈에 안 들어온다.
 * 계층을 들여쓰기로 세운다.
 *
 * **원문을 고치지 않는다.** 검색 색인과 인용 링크는 수집한 원문 그대로를 쓰고,
 * 이 변환은 화면에 그릴 때만 끼운다. 들여쓰기용 공백을 넣어도 인용 매칭은
 * 공백을 지운 사본에서 위치를 찾으므로(linkify) 영향을 받지 않는다.
 */
var LawText = (function () {
  "use strict";

  // 항: ①②③… (U+2460~) — 원문에서 항 번호로 쓰인다
  var HANG = /^\s*[①-⑳]/;
  // 호: "1." "12." — 마침표 뒤에 공백이 오는 형태만 (문장 속 숫자와 구분)
  var HO = /^\s*\d+\s*\.\s/;
  // 목: "가." "나." … 한글 한 글자 + 마침표
  var MOK = /^\s*[가-힣]\s*\.\s/;
  // 세목: "1)" "가)"
  var SEMOK = /^\s*(?:\d+|[가-힣])\s*\)\s/;

  var STEP = "  "; // 한 단계 = 스페이스 2칸

  /** 줄 하나의 깊이. 못 알아보면 -1 (앞 줄에 이어지는 문장). */
  function depthOf(line) {
    if (!line || !line.trim()) return -1;
    if (HANG.test(line)) return 0;
    if (HO.test(line)) return 1;
    if (SEMOK.test(line)) return 3;
    if (MOK.test(line)) return 2;
    return -1;
  }

  /**
   * 조문 본문에 계층 들여쓰기를 넣는다.
   *   항 0칸 · 호 2칸 · 목 4칸 · 세목 6칸
   * 표시가 없는 줄(앞 줄에서 이어지는 문장)은 직전 줄의 깊이를 물려받아
   * 같은 블록으로 보이게 한다.
   */
  function indent(text) {
    var src = String(text == null ? "" : text);
    if (!src) return "";
    var lines = src.split("\n");
    var out = [];
    var last = -1;
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];
      var body = raw.replace(/^[ \t]+/, ""); // 원문에 이미 있던 앞 공백은 걷어낸다
      if (!body.trim()) { out.push(""); continue; }

      var d = depthOf(body);
      if (d < 0) {
        // 조문 머리("제76조(…)")는 첫 줄이고 깊이 0 이다. 그 외 표시 없는 줄은 이어지는 문장.
        d = i === 0 ? 0 : (last < 0 ? 0 : last);
      }
      last = d;

      var pad = "";
      for (var k = 0; k < d; k++) pad += STEP;
      out.push(pad + body);
    }
    return out.join("\n");
  }

  return { indent: indent, depthOf: depthOf, STEP: STEP };
})();

if (typeof module !== "undefined" && module.exports) module.exports = LawText;

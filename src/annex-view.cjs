/* 몇 조항이더라 — 별표 원본 뷰어 (브라우저 인라인용, 모듈 아님)
 *
 * 이 파일은 빌드 시 template.html 의 뷰어 자리표시자 주석 위치에 그대로 삽입된다.
 * 동시에 test/annex-view.test.mjs 가 같은 파일을 읽어 검증한다 — 단일 원천.
 *
 * 별표·서식의 罫線 텍스트 복원은 한계가 있다(굵은 罫線을 못 읽는 표가 60%).
 * 그래서 방향을 바꾼다: **원본 PDF 를 그대로 보여주고**, 검색은 파싱 텍스트로 한다.
 *   - 표시: web/annex/<flSeq>.pdf 를 iframe 으로. 브라우저·Tauri 둘 다 same-origin 상대경로.
 *   - 검색: 노드의 text(파싱본)는 검색 색인이 그대로 쓴다 — 여기선 손대지 않는다.
 *   - 파일이 없으면(부분 배포/브라우저 프리뷰) 다운로드 링크 + 파싱표로 물러난다.
 *
 * 이 파일은 DOM 을 모른다 — HTML 문자열만 만든다. esc 와 파싱표 HTML 은 호출측이 준다.
 */
var AnnexView = (function () {
  "use strict";

  var LAW = "https://www.law.go.kr/LSW/flDownload.do?flSeq=";

  function has(avail, name) {
    if (!avail || !name) return false;
    return typeof avail.has === "function" ? avail.has(name) : avail.indexOf(name) >= 0;
  }

  /**
   * @param n 별표 노드 { pdfSeq, hwpSeq, pdfName, hwpName, label, title }
   * @param opts { avail:Set<string>, esc:fn, native:boolean }
   *   avail   web/annex 에 실제로 있는 파일명 집합("<flSeq>.pdf" 등)
   *   native  데스크톱 앱(Tauri)인가. 앱에서만 동봉 PDF 를 iframe 으로 띄운다.
   *
   * 별표(표)·별지(서식)는 **원문(PDF/HWP)만** 보여준다. 罫線 텍스트를 표로 되살리는
   * 파싱은 굵은 罫線을 못 읽는 표가 많아 신뢰할 수 없어 제거했다 — 원문이 진실이다.
   *
   * ★ 브라우저에는 원본 PDF 가 동봉돼 있지 않다(앱 전용). 그래서 브라우저에서는 iframe 을
   *   걸지 않고 **법제처 원문 링크 카드**를 보여준다 — 빈 화면이 뜨지 않게.
   */
  function render(n, opts) {
    opts = opts || {};
    var esc = opts.esc || function (s) { return String(s == null ? "" : s); };
    var avail = opts.avail;
    var native = !!opts.native;

    var pdfLocal = native && n.pdfSeq && has(avail, n.pdfSeq + ".pdf") ? "annex/" + n.pdfSeq + ".pdf" : null;
    var hwpLocal = native && n.hwpSeq && has(avail, n.hwpSeq + ".hwp") ? "annex/" + n.hwpSeq + ".hwp" : null;

    var parts = ['<div class="body annexview">'];

    // 1) 원본 PDF 뷰어 — 앱에 동봉된 PDF 가 있으면 이게 본체다
    if (pdfLocal) {
      parts.push('<iframe class="pdfview" src="' + esc(pdfLocal) + '" title="' +
        esc((n.label || "") + " " + (n.title || "")) + '"></iframe>');
    } else {
      // 브라우저(또는 미동봉) — 빈 화면 대신 법제처 원문으로 보내는 카드.
      var kind = (n.label || "").indexOf("서식") >= 0 ? "서식(별지)" : "별표";
      parts.push('<div class="novip"><b>' + esc(n.label || kind) + "</b> " + esc(n.title || "") +
        '<div class="novip-sub">원문(PDF)은 데스크톱 앱에 동봉되어 바로 열립니다. ' +
        '브라우저에서는 아래 <b>법제처에서 원문 보기</b>로 원본을 여세요.</div></div>');
    }

    // 2) 원본 열기/내려받기 — 앱은 동봉 파일, 브라우저는 법제처 원문 링크
    var dl = [];
    if (n.pdfSeq) {
      dl.push('<a class="dl' + (pdfLocal ? "" : " primary") + '" href="' + esc(pdfLocal || (LAW + n.pdfSeq)) + '"' +
        (pdfLocal ? ' download="' + esc(n.pdfName || (n.pdfSeq + ".pdf")) + '"' : ' target="_blank" rel="noopener"') +
        ">" + (pdfLocal ? "PDF 원본" : "법제처에서 원문 보기 (PDF)") + "</a>");
    }
    if (n.hwpSeq) {
      dl.push('<a class="dl" href="' + esc(hwpLocal || (LAW + n.hwpSeq)) + '"' +
        (hwpLocal ? ' download="' + esc(n.hwpName || (n.hwpSeq + ".hwp")) + '"' : ' target="_blank" rel="noopener"') +
        ">" + (hwpLocal ? "HWP 원본" : "HWP 내려받기") + "</a>");
    }
    if (dl.length) parts.push('<div class="dlrow">' + dl.join("") + "</div>");

    parts.push("</div>");
    return parts.join("");
  }

  return { render: render, has: has };
})();

if (typeof module !== "undefined" && module.exports) module.exports = AnnexView;

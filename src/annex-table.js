/* 몇 조항이더라 — 별표 罫線 표 → 실제 표 변환 (브라우저 인라인용, 모듈 아님)
 *
 * 빌드 시 template.html 의 표 자리표시자 주석 위치에 삽입되고,
 * test/annex-table.test.mjs 가 같은 파일을 읽어 검증한다 — 단일 원천.
 *
 * 왜 렌더 시점에 변환하나:
 *   저장되는 별표 텍스트는 원문 줄바꿈을 그대로 둔 "충실한 사본"이어야 한다
 *   (합치면 왜곡된다 — src/lawapi.mjs tidyAnnexText 주석 참조).
 *   검색도 그 텍스트를 쓴다. 그래서 표 구조는 화면에 그릴 때만 만든다.
 *   스냅샷에 표 구조를 중복 저장하지 않으므로 산출물이 커지지 않는다.
 */
var AnnexTable = (function () {
  "use strict";

  var BORDER = /^[\s┌┬┐├┼┤└┴┘─]+$/; // 테두리만 있는 줄
  var HAS_RULE = /[─]/;
  var ROW = /^\s*│/; // 셀이 있는 줄
  // 새 항목의 시작 — 이게 아니면 앞 줄에서 넘어온 이어짐으로 본다
  var ITEM = /^\s*(?:\d+\.|[가-힣]\.|[①-⑳]|[㉠-㉻]|[a-zA-Z]\.)/;

  function splitCells(line) {
    var t = line.trim();
    if (t.charAt(0) === "│") t = t.slice(1);
    if (t.charAt(t.length - 1) === "│") t = t.slice(0, -1);
    return t.split("│").map(function (c) { return c.trim(); });
  }

  /**
   * 텍스트를 블록으로 나눈다.
   *   { type:"text",  lines:[...] }
   *   { type:"table", head:[...]|null, rows:[[cell,...],...] }
   */
  function parse(text) {
    var lines = String(text == null ? "" : text).split("\n");
    var blocks = [];
    var i = 0;

    while (i < lines.length) {
      // 표 시작: 테두리 줄 다음에 셀 줄이 오는 지점
      if (BORDER.test(lines[i]) && HAS_RULE.test(lines[i]) && ROW.test(lines[i + 1] || "")) {
        var rows = [];
        var seps = []; // 구분선이 나온 행 위치 — 첫 구분선 위가 머리글이다
        i++;
        while (i < lines.length) {
          var ln = lines[i];
          if (ROW.test(ln)) {
            var cells = splitCells(ln);
            var prev = rows[rows.length - 1];
            // 셀 안에서 줄이 바뀐 경우: 첫 칸이 새 항목으로 시작하지 않으면 앞 행에 이어붙인다
            var isCont = prev && cells[0] !== "" && !ITEM.test(cells[0]) &&
              prev.length === cells.length;
            if (isCont) {
              for (var c = 0; c < cells.length; c++) {
                if (!cells[c]) continue;
                // 고정폭 절단이라 이어지는 조각이다. 가운뎃점으로 시작하면 원래 붙어 있던 말이다.
                var glue = /^[ㆍ·,)\]]/.test(cells[c]) ? "" : " ";
                prev[c] = prev[c] ? prev[c] + glue + cells[c] : cells[c];
              }
            } else if (cells.some(function (c) { return c !== ""; })) {
              rows.push(cells);
            }
            i++;
          } else if (BORDER.test(ln) && HAS_RULE.test(ln)) {
            seps.push(rows.length);
            i++;
            // 표 끝(└┴┘)이고 다음 줄이 셀이 아니면 종료
            if (/[└┘┴]/.test(ln) && !ROW.test(lines[i] || "")) break;
          } else break;
        }
        if (rows.length) {
          // 첫 구분선이 1행 뒤에 있으면 그 1행이 머리글
          var head = seps.length && seps[0] === 1 ? rows.shift() : null;
          blocks.push({ type: "table", head: head, rows: rows });
        }
        continue;
      }

      // 표가 아닌 구간
      var buf = [];
      while (i < lines.length && !(BORDER.test(lines[i]) && HAS_RULE.test(lines[i]) && ROW.test(lines[i + 1] || ""))) {
        buf.push(lines[i]);
        i++;
      }
      if (buf.join("").trim()) blocks.push({ type: "text", lines: buf });
    }
    return blocks;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c];
    });
  }

  /** 블록 → HTML. text 블록은 호출자가 넘긴 renderText 로 그린다(인용 링크 때문). */
  function toHtml(blocks, renderText) {
    var out = [];
    for (var b = 0; b < blocks.length; b++) {
      var blk = blocks[b];
      if (blk.type === "text") {
        var t = blk.lines.join("\n").replace(/^\n+|\n+$/g, "");
        out.push('<div class="ann-text">' + (renderText ? renderText(t) : esc(t)) + "</div>");
        continue;
      }
      var h = ['<div class="ann-tw"><table class="ann">'];
      if (blk.head) {
        h.push("<thead><tr>");
        for (var i = 0; i < blk.head.length; i++) h.push("<th>" + esc(blk.head[i]) + "</th>");
        h.push("</tr></thead>");
      }
      h.push("<tbody>");
      for (var r = 0; r < blk.rows.length; r++) {
        h.push("<tr>");
        for (var c = 0; c < blk.rows[r].length; c++) h.push("<td>" + esc(blk.rows[r][c]) + "</td>");
        h.push("</tr>");
      }
      h.push("</tbody></table></div>");
      out.push(h.join(""));
    }
    return out.join("");
  }

  /** 블록 → 마크다운 (표 복사용) */
  function toMarkdown(blocks) {
    var out = [];
    for (var b = 0; b < blocks.length; b++) {
      var blk = blocks[b];
      if (blk.type === "text") {
        out.push(blk.lines.join("\n").replace(/^\n+|\n+$/g, ""));
        continue;
      }
      var n = Math.max.apply(null, blk.rows.map(function (r) { return r.length; }).concat(blk.head ? [blk.head.length] : [1]));
      var pad = function (row) {
        var a = (row || []).slice();
        while (a.length < n) a.push("");
        return a.map(function (c) { return String(c).replace(/\|/g, "\\|"); });
      };
      var head = blk.head || new Array(n).fill("");
      var tb = ["| " + pad(head).join(" | ") + " |", "|" + new Array(n).fill(" --- ").join("|") + "|"];
      for (var r = 0; r < blk.rows.length; r++) tb.push("| " + pad(blk.rows[r]).join(" | ") + " |");
      out.push(tb.join("\n")); // 표 내부는 개행 하나로 묶어야 마크다운 표가 성립한다
    }
    return out.join("\n\n");
  }

  return { parse: parse, toHtml: toHtml, toMarkdown: toMarkdown };
})();

if (typeof module !== "undefined" && module.exports) module.exports = AnnexTable;

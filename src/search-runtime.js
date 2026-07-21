/* LawEverything — 검색 런타임 (브라우저 인라인용, 모듈 아님)
 *
 * 이 파일은 빌드 시 template.html 의 검색 자리표시자 주석 위치에 그대로 삽입된다.
 * 동시에 test/search.test.mjs 가 같은 파일을 읽어 검증한다 — 단일 원천.
 * 따라서 import/export 를 쓰지 않고 전역 LawSearch 를 노출한다.
 *
 * 설계 근거 (실측):
 *   1,223조문 0.45MB 에서 단순 선형 스캔이 타건당 2~3ms. 속도는 병목이 아니다.
 *   진짜 문제는 "수의계약" 한 번에 60건이 순위 없이 쏟아지는 것 —
 *   그래서 이 파일의 핵심은 색인이 아니라 **랭킹**이다.
 */
var LawSearch = (function () {
  "use strict";

  var CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";

  /** 한글 음절 → 초성. "수의계약" → "ㅅㅇㄱㅇ" (초성 검색용) */
  function chosung(s) {
    var out = "";
    for (var i = 0; i < s.length; i++) {
      var code = s.charCodeAt(i) - 0xac00;
      out += code >= 0 && code < 11172 ? CHO[Math.floor(code / 588)] : s[i];
    }
    return out;
  }

  /** 공백·구두점 제거 + 소문자. 실무자는 띄어쓰기를 신경 쓰지 않는다. */
  function normalize(s) {
    return String(s == null ? "" : s).toLowerCase().replace(/[\s·ㆍ,.()（）「」<>·:;'"\-_/]/g, "");
  }

  /**
   * 조문 번호 표기를 하나로 모은다.
   *   "7조" · "제7조" · "제 7 조" · "7-2" · "제7조의2"  →  {jo:"7"} / {jo:"7의2"}
   * 실무자는 "7조 보증금" 처럼 조번호와 키워드를 섞어 친다.
   */
  function parseQuery(raw) {
    var q = String(raw == null ? "" : raw).trim();
    var jo = null;
    var rest = q.replace(/제?\s*(\d+)\s*조(?:\s*의\s*(\d+))?/g, function (_, a, b) {
      jo = b ? a + "의" + b : a;
      return " ";
    });
    // 조번호를 못 찾았고 질의가 숫자만이면 그것도 조번호로 본다 ("42")
    if (!jo && /^\d+$/.test(q)) jo = q;
    var terms = normalize(rest).length ? [normalize(rest)] : [];
    return { raw: q, jo: jo, terms: terms, cho: chosung(normalize(rest)) };
  }

  /** 노드 1건의 색인 — 빌드 시 1회 계산해 두고 타건마다 재사용한다. */
  function indexNode(n) {
    // 조문제목("계약보증금")과 소속 법령명("공사계약일반조건")을 분리해 색인한다.
    // 합쳐두면 법령명 매치가 조문제목 매치를 덮어버린다 —
    // "예정가격"을 치면 「예정가격작성기준」의 모든 조문이 상위를 점령하고
    // 정작 국가계약법 제8조의2(예정가격의 작성)가 밀린다.
    var own = n.kind === "조문" ? n.title || "" : n.label || "";
    var owner = n.kind === "조문" ? (n.group || "") + " " + (n.label || "") : n.name || "";
    return {
      ti: normalize(own), // 조문제목 (법령 노드는 법령명)
      t: normalize(owner), // 소속 법령명 + 조번호
      ci: chosung(normalize(own)), // 조문제목 초성 (ㅅㅇㄱㅇ → 수의계약)
      c: chosung(normalize(own + " " + owner)), // 전체 초성
      s: normalize(own + " " + owner + " " + (n.text || "")), // 전문
      jo: n.kind === "조문" && n.label ? String(n.label).replace(/^제|조$/g, "").replace(/조의/, "의") : null,
    };
  }

  // 상위 법령일수록, 원문이 있는 조문일수록 유용하다.
  var TYPE_W = { 법률: 40, 시행령: 32, 시행규칙: 24, 계약예규: 16, 훈령: 12, 고시: 12, 지침: 10, 외부: 0 };

  /** 점수. 0 이하면 결과에서 뺀다. */
  function score(n, ix, q) {
    var sc = 0;
    var matchedSomething = false;

    if (q.jo) {
      if (ix.jo === q.jo) {
        sc += 1000;
        matchedSomething = true;
      } else if (q.terms.length === 0) {
        return 0; // 조번호만 물었는데 그 조가 아니면 볼 필요 없다
      }
    }

    for (var i = 0; i < q.terms.length; i++) {
      var t = q.terms[i];
      if (!t) continue;
      // 조문제목 매치가 가장 강하다 — 실무자가 찾는 건 대개 "그 주제의 조문"이다.
      if (ix.ti === t) { sc += 700; matchedSomething = true; }
      else if (ix.ti.indexOf(t) === 0) { sc += 450; matchedSomething = true; }
      else if (ix.ti.indexOf(t) >= 0) { sc += 300; matchedSomething = true; }
      // 그 다음이 소속 법령명 매치
      else if (ix.t.indexOf(t) === 0) { sc += 220; matchedSomething = true; }
      else if (ix.t.indexOf(t) >= 0) { sc += 160; matchedSomething = true; }
      else if (ix.s.indexOf(t) >= 0) {
        // 본문 매치. 빈도를 조금 반영하되 장문이 무조건 이기지 않도록 상한을 둔다.
        var c = ix.s.split(t).length - 1;
        sc += 60 + Math.min(c, 5) * 8;
        matchedSomething = true;
      } else if (t.length >= 2 && ix.ci.indexOf(t) >= 0) {
        // 초성으로 쳤다는 건 그 단어를 정확히 안다는 뜻이다. 제목 매치급으로 쳐준다.
        sc += ix.ci === t ? 500 : 380;
        matchedSomething = true;
      } else if (t.length >= 2 && ix.c.indexOf(t) >= 0) {
        sc += 140; // 법령명까지 포함한 초성 매치
        matchedSomething = true;
      } else {
        return 0; // 모든 검색어가 걸려야 한다 (AND)
      }
    }

    if (!matchedSomething) return 0;
    sc += TYPE_W[n.type] || 0;
    if (n.kind === "조문") sc += 10;
    else if (n.kind === "법령") sc += 5;
    return sc;
  }

  function create(nodes) {
    var index = new Array(nodes.length);
    for (var i = 0; i < nodes.length; i++) index[i] = indexNode(nodes[i]);

    return {
      index: index,
      /** 상위 limit 건을 점수 내림차순으로 */
      search: function (raw, limit) {
        var q = parseQuery(raw);
        if (!q.jo && !q.terms.length) return [];
        var hits = [];
        for (var i = 0; i < nodes.length; i++) {
          var sc = score(nodes[i], index[i], q);
          if (sc > 0) hits.push({ node: nodes[i], score: sc });
        }
        hits.sort(function (a, b) {
          return b.score - a.score || (a.node.label || "").localeCompare(b.node.label || "");
        });
        return limit ? hits.slice(0, limit) : hits;
      },
    };
  }

  return { create: create, parseQuery: parseQuery, chosung: chosung, normalize: normalize, indexNode: indexNode, score: score };
})();

if (typeof module !== "undefined" && module.exports) module.exports = LawSearch;

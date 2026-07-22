/* 몇 조항이더라 — 검색 런타임 (브라우저 인라인용, 모듈 아님)
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

    // **띄어쓴 단어를 각각의 조건으로 쪼갠다.**
    //
    // 예전에는 질의 전체를 붙여 한 덩어리로 만들었다. 그래서 제명을 정확히 기억하지
    // 못하면 아무것도 안 나왔다 — "공공주택 종합심사" 로는
    // 「조달청 공공주택 *공사계약* 종합심사낙찰제 심사세부기준」이 안 걸린다.
    // 가운데 한 단어를 빠뜨렸을 뿐인데 결과가 0이면 도구를 못 믿게 된다.
    // 점수 계산부는 이미 여러 단어를 AND 로 다루고 있었다(하나라도 안 걸리면 0점).
    var terms = [];
    var parts = rest.split(/\s+/);
    for (var i = 0; i < parts.length; i++) {
      var t = normalize(parts[i]);
      if (t.length && terms.indexOf(t) < 0) terms.push(t);
    }
    // 붙여 친 전체 문자열도 함께 넘긴다 — 제명을 통째로 맞힌 경우를 위에 올리려고.
    var phrase = normalize(rest);
    return { raw: q, jo: jo, terms: terms, phrase: phrase, cho: chosung(phrase) };
  }

  /** 노드 1건의 색인 — 빌드 시 1회 계산해 두고 타건마다 재사용한다. */
  function indexNode(n) {
    // 조문제목("계약보증금")과 소속 법령명("공사계약일반조건")을 분리해 색인한다.
    // 합쳐두면 법령명 매치가 조문제목 매치를 덮어버린다 —
    // "예정가격"을 치면 「예정가격작성기준」의 모든 조문이 상위를 점령하고
    // 정작 국가계약법 제8조의2(예정가격의 작성)가 밀린다.
    // 조문과 별표는 같은 구조로 다룬다 — 둘 다 "제목 + 소속 법령" 이다.
    // 별표를 빼먹으면 「부정당업자 입찰참가자격 제한기준」 같은 실무 핵심 표가
    // 본문 매치(60점)로만 걸려 조문에 밀린다.
    var isUnit = n.kind === "조문" || n.kind === "별표";
    var own = isUnit ? n.title || n.label || "" : n.label || "";
    var owner = isUnit ? (n.group || "") + " " + (n.label || "") : n.name || "";
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

    var ownHits = 0; // 이 노드 **자신의 이름**에 걸린 단어 수
    for (var i = 0; i < q.terms.length; i++) {
      var t = q.terms[i];
      if (!t) continue;
      // 조문제목 매치가 가장 강하다 — 실무자가 찾는 건 대개 "그 주제의 조문"이다.
      if (ix.ti === t) { sc += 700; matchedSomething = true; ownHits++; }
      else if (ix.ti.indexOf(t) === 0) { sc += 450; matchedSomething = true; ownHits++; }
      else if (ix.ti.indexOf(t) >= 0) { sc += 300; matchedSomething = true; ownHits++; }
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

    // 띄어쓴 단어를 쪼개 찾다 보니 "여러 단어가 흩어져 걸린 문서"와
    // "제명을 통째로 맞힌 문서"가 같은 점수가 된다. 후자를 위로 올린다.
    if (q.phrase && q.terms.length > 1) {
      if (ix.ti.indexOf(q.phrase) >= 0) sc += 400;
      else if (ix.t.indexOf(q.phrase) >= 0) sc += 250;
    }

    // 법령명을 통째로 물었으면 **그 법령이 자기 조문·별표보다 위**여야 한다.
    // 소속 법령명은 조문·별표의 색인에도 통째로 들어가 있어서(ix.t),
    // 별지 제목이 우연히 앞부분 일치(450점)만 해도 본체 법령(300+300)을 제친다.
    // 실측: "공공주택 종합심사" → 별지 632 vs 본체 훈령 617.
    // 사용자가 문서 이름을 쳤는데 그 문서가 목록 아래에 있으면 못 찾았다고 여긴다.
    if (n.kind === "법령" && ownHits === q.terms.length && q.terms.length > 0) sc += 350;

    sc += TYPE_W[n.type] || 0;
    if (n.kind === "조문" || n.kind === "별표") sc += 10;
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

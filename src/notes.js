/* 몇 조항이더라 — 법률노트 (브라우저 인라인용, 모듈 아님)
 *
 * 이 파일은 빌드 시 template.html 의 노트 자리표시자 주석 위치에 그대로 삽입된다.
 * 동시에 test/notes.test.mjs 가 같은 파일을 읽어 검증한다 — 단일 원천.
 *
 * 노트는 **평범한 텍스트**다. 서식도 마크다운도 없다. 딱 하나만 특별하다:
 *
 *     {[국가계약법-제7조]}   →  그 조문으로 가는 링크
 *     {[국가계약법]}          →  그 법령으로 가는 링크
 *
 * 왜 이 표기인가: 실무자가 메모장에 쓰던 걸 그대로 붙여넣어도 깨지지 않아야 한다.
 * 중괄호+대괄호는 법령 문서에 거의 안 나오는 조합이라 오탐이 없다.
 * (「」 는 법령 원문에서 인용 표기로 이미 쓰이므로 피했다.)
 */
var LawNotes = (function () {
  "use strict";

  var KEY = "law-notes";
  var REF = /\{\[([^\]]*)\]\}/g; // {[...]} — 닫는 대괄호 전까지
  var override = null;

  function store() {
    if (override) return override;
    try {
      return typeof localStorage !== "undefined" ? localStorage : null;
    } catch (e) {
      return null;
    }
  }

  function load() {
    var s = store();
    if (!s) return "";
    try {
      return s.getItem(KEY) || "";
    } catch (e) {
      return "";
    }
  }

  function save(text) {
    var s = store();
    if (!s) return false;
    try {
      s.setItem(KEY, String(text == null ? "" : text));
      return true;
    } catch (e) {
      return false;
    }
  }

  /** 공백·중점을 지우고 비교한다 — "국가계약법 시행령" 과 "국가계약법시행령" 은 같은 말이다. */
  function norm(s) {
    return String(s == null ? "" : s).replace(/[\s·ㆍ]/g, "").toLowerCase();
  }

  /**
   * 조 표기를 정규화한다.
   *   "제7조" "7조" "7" → "7"      |  "제5조의2" "5조의2" "5의2" → "5의2"
   * 그래프의 조문 id 가 `art:<법령>:<번호>` 형태라 이 번호가 그대로 열쇠가 된다.
   */
  function joNo(s) {
    var t = String(s == null ? "" : s).replace(/\s/g, "");
    if (!t) return null;
    var m = t.match(/^제?(\d+)조?(?:의(\d+))?$/);
    if (!m) return null;
    return m[2] ? m[1] + "의" + m[2] : m[1];
  }

  /**
   * "{[ ... ]}" 안쪽을 법령명과 조 번호로 가른다.
   * 구분자는 `-` 를 우선하되, 없으면 마지막 공백 토큰이 조 표기인지 본다.
   * 법령명 자체에 `-` 가 들어가는 경우는 없다(법제처 제명 규칙).
   */
  function splitRef(inner) {
    var raw = String(inner == null ? "" : inner).trim();
    if (!raw) return { name: "", jo: null };
    var i = raw.lastIndexOf("-");
    if (i >= 0) {
      return { name: raw.slice(0, i).trim(), jo: joNo(raw.slice(i + 1)) };
    }
    var parts = raw.split(/\s+/);
    if (parts.length > 1) {
      var maybe = joNo(parts[parts.length - 1]);
      if (maybe) return { name: parts.slice(0, -1).join(" ").trim(), jo: maybe };
    }
    return { name: raw, jo: null };
  }

  /** 노트 본문에서 모든 참조를 위치와 함께 뽑는다. */
  function parseRefs(text) {
    var out = [];
    var s = String(text == null ? "" : text);
    REF.lastIndex = 0;
    var m;
    while ((m = REF.exec(s))) {
      var p = splitRef(m[1]);
      out.push({ raw: m[0], inner: m[1], start: m.index, end: m.index + m[0].length, name: p.name, jo: p.jo });
    }
    return out;
  }

  // ── 노드 조회 ──────────────────────────────────────────────────────────────

  function laws(nodes) {
    var out = [];
    for (var i = 0; i < nodes.length; i++) if (nodes[i].kind === "법령") out.push(nodes[i]);
    return out;
  }

  /** 법령명(약칭·정식명 모두)으로 법령 노드를 찾는다. 정확일치 → 접두일치 → 포함 순. */
  function findLaw(name, nodes) {
    var q = norm(name);
    if (!q) return null;
    var ls = laws(nodes);
    var i, n;
    for (i = 0; i < ls.length; i++) {
      n = ls[i];
      if (norm(n.label) === q || norm(n.name) === q) return n;
    }
    for (i = 0; i < ls.length; i++) {
      n = ls[i];
      if (norm(n.label).indexOf(q) === 0 || norm(n.name).indexOf(q) === 0) return n;
    }
    for (i = 0; i < ls.length; i++) {
      n = ls[i];
      if (norm(n.label).indexOf(q) >= 0 || norm(n.name).indexOf(q) >= 0) return n;
    }
    return null;
  }

  /**
   * 참조 → 노드 id. 못 찾으면 null (링크로 만들지 않고 글자 그대로 남긴다).
   * 조를 지정했는데 그 조가 없으면 **법령으로 떨어뜨리지 않고 실패**시킨다 —
   * 없는 조를 조용히 법령 링크로 바꾸면 잘못 적은 걸 눈치채지 못한다.
   */
  function resolve(ref, nodes) {
    var law = findLaw(ref.name, nodes);
    if (!law) return null;
    if (!ref.jo) return law.id;
    var want = "art:" + String(law.id).replace(/^law:/, "") + ":" + ref.jo;
    for (var i = 0; i < nodes.length; i++) if (nodes[i].id === want) return want;
    return null;
  }

  /**
   * 자동완성 후보. 사용자가 `{[` 를 열고 몇 글자 치는 중에 부른다.
   * 법령명만 친 단계면 법령들을, `-` 를 찍었으면 그 법령의 조문들을 준다.
   */
  function suggest(inner, nodes, limit) {
    var lim = limit || 8;
    var p = splitRef(inner);
    var raw = String(inner == null ? "" : inner);
    var hasSep = raw.indexOf("-") >= 0;
    var out = [];
    var i, n;

    if (!hasSep) {
      var q = norm(p.name);
      var ls = laws(nodes);
      var starts = [], holds = [];
      for (i = 0; i < ls.length; i++) {
        n = ls[i];
        var a = norm(n.label), b = norm(n.name);
        if (!q || a.indexOf(q) === 0 || b.indexOf(q) === 0) starts.push(n);
        else if (a.indexOf(q) >= 0 || b.indexOf(q) >= 0) holds.push(n);
      }
      var all = starts.concat(holds);
      for (i = 0; i < all.length && out.length < lim; i++) {
        out.push({ kind: "법령", id: all[i].id, label: all[i].label, sub: all[i].type, insert: all[i].label });
      }
      return out;
    }

    // 법령이 정해진 뒤 — 그 법령의 조문을 좁혀서 준다
    var law = findLaw(p.name, nodes);
    if (!law) return [];
    var prefix = "art:" + String(law.id).replace(/^law:/, "") + ":";
    var jotxt = raw.slice(raw.lastIndexOf("-") + 1).replace(/\s/g, "");
    var digits = (jotxt.match(/\d+(?:의\d+)?/) || [""])[0];
    for (i = 0; i < nodes.length && out.length < lim; i++) {
      n = nodes[i];
      if (n.kind !== "조문" || String(n.id).indexOf(prefix) !== 0) continue;
      var no = String(n.id).slice(prefix.length);
      if (digits && no.indexOf(digits) !== 0) continue;
      out.push({
        kind: "조문", id: n.id, label: n.label, sub: n.title || "",
        insert: law.label + "-" + n.label,
      });
    }
    return out;
  }

  /**
   * 노트를 HTML 로. esc 와 link 는 호출측이 준다(이 파일은 DOM 을 모른다).
   *   esc(text)            → 이스케이프된 문자열
   *   link(id, text, ref)  → 링크 HTML
   * 못 찾은 참조는 miss 로 감싸 눈에 띄게 한다 — 오타를 알아야 고친다.
   */
  function toHtml(text, nodes, esc, link, miss) {
    var s = String(text == null ? "" : text);
    var refs = parseRefs(s);
    var out = "", pos = 0;
    for (var i = 0; i < refs.length; i++) {
      var r = refs[i];
      out += esc(s.slice(pos, r.start));
      var id = resolve(r, nodes);
      var shown = r.jo ? r.name + " " + "제" + r.jo + "조" : r.name;
      out += id ? link(id, shown, r) : miss(shown || r.raw);
      pos = r.end;
    }
    return out + esc(s.slice(pos));
  }

  function useStore(s) { override = s || null; }

  return {
    KEY: KEY,
    load: load,
    save: save,
    parseRefs: parseRefs,
    splitRef: splitRef,
    joNo: joNo,
    findLaw: findLaw,
    resolve: resolve,
    suggest: suggest,
    toHtml: toHtml,
    useStore: useStore,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = LawNotes;

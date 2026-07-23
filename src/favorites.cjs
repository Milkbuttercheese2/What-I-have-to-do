/* 몇 조항이더라 — 즐겨찾기 (브라우저 인라인용, 모듈 아님)
 *
 * 이 파일은 빌드 시 template.html 의 즐겨찾기 자리표시자 주석 위치에 그대로 삽입된다.
 * 동시에 test/favorites.test.mjs 가 같은 파일을 읽어 검증한다 — 단일 원천.
 * 따라서 import/export 를 쓰지 않고 전역 LawFavs 를 노출한다.
 *
 * 저장 단위는 그래프 노드 id 다:
 *   law:nca            법 단위
 *   art:nca-e:10       조 단위
 *   byl:nca-r:별표:2   별표 단위 (조문과 동급이고 조달 실무에서 가장 자주 찾는 표다)
 *
 * id 는 seed 식별자 + 조문번호로 만들어져 재수집·재빌드해도 변하지 않는다.
 * 그래서 localStorage 에 id 만 담아두면 월간 재빌드를 넘겨도 즐겨찾기가 살아남는다.
 *
 * **모르는 id 를 지우지 않는다** — 시드에서 법령 하나가 잠시 빠졌다고 사용자의
 * 즐겨찾기를 조용히 증발시키면 안 된다. 걸러내는 것은 화면에 그릴 때뿐이다(grouped).
 */
var LawFavs = (function () {
  "use strict";

  var KEY = "law-favs";
  var override = null; // 테스트용 저장소 주입구

  /** localStorage 는 file:// · 프라이빗 모드에서 접근만으로도 던질 수 있다. */
  function store() {
    if (override) return override;
    try {
      return typeof localStorage !== "undefined" ? localStorage : null;
    } catch (e) {
      return null;
    }
  }

  /** 저장된 id 목록. 손상된 값은 조용히 빈 목록으로 (즐겨찾기 때문에 페이지가 죽으면 안 된다). */
  function list() {
    var s = store();
    if (!s) return [];
    var raw;
    try {
      raw = s.getItem(KEY);
    } catch (e) {
      return [];
    }
    if (!raw) return [];
    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    var out = [];
    for (var i = 0; i < parsed.length; i++) {
      var v = parsed[i];
      if (typeof v === "string" && v && out.indexOf(v) < 0) out.push(v);
    }
    return out;
  }

  function save(ids) {
    var s = store();
    if (!s) return false;
    try {
      s.setItem(KEY, JSON.stringify(ids));
      return true;
    } catch (e) {
      return false; // 용량 초과 등 — 실패를 숨기되 호출측이 알 수 있게 false
    }
  }

  function has(id) {
    return !!id && list().indexOf(id) >= 0;
  }

  function add(id) {
    if (!id) return false;
    var ids = list();
    if (ids.indexOf(id) >= 0) return false;
    ids.push(id); // 추가한 순서를 유지한다 — 목록이 갑자기 재배열되면 손이 헤맨다
    save(ids);
    return true;
  }

  function remove(id) {
    if (!id) return false;
    var ids = list();
    var i = ids.indexOf(id);
    if (i < 0) return false;
    ids.splice(i, 1);
    save(ids);
    return true;
  }

  /** 켜졌으면 true, 꺼졌으면 false 를 반환한다 (버튼 상태를 바로 쓰라고). */
  function toggle(id) {
    if (has(id)) {
      remove(id);
      return false;
    }
    add(id);
    return true;
  }

  function count() {
    return list().length;
  }

  /**
   * 화면용으로 법/조/별표로 나눈다.
   * byId 는 Map 이든 평범한 객체든 받는다. 여기서 처음으로 "실재하는 노드"만 걸러진다 —
   * 저장소는 건드리지 않는다.
   */
  function grouped(byId) {
    var get = byId && typeof byId.get === "function"
      ? function (k) { return byId.get(k); }
      : function (k) { return byId ? byId[k] : undefined; };

    var out = { 법: [], 조: [], 별표: [], 사라짐: [] };
    var ids = list();
    for (var i = 0; i < ids.length; i++) {
      var n = get(ids[i]);
      if (!n) {
        out.사라짐.push(ids[i]); // 저장소엔 남겨두고 화면에만 안 그린다
        continue;
      }
      if (n.kind === "법령") out.법.push(n);
      else if (n.kind === "별표") out.별표.push(n);
      else out.조.push(n);
    }
    return out;
  }

  /** 테스트에서 localStorage 대역을 끼워넣는다. null 이면 원래대로. */
  function useStore(s) {
    override = s || null;
  }

  return {
    list: list,
    has: has,
    add: add,
    remove: remove,
    toggle: toggle,
    count: count,
    grouped: grouped,
    useStore: useStore,
    KEY: KEY,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = LawFavs;

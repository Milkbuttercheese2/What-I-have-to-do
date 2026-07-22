// 즐겨찾기 — 법·조 단위 저장 검증
//
// 즐겨찾기는 사용자가 직접 쌓아올린 유일한 데이터다. 수집물은 재빌드하면 되지만
// 이건 날아가면 복구할 방법이 없다. 그래서 "잃지 않는다"를 중심으로 검증한다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const LawFavs = createRequire(import.meta.url)("../src/favorites.js");

/** localStorage 대역. 던지는 저장소도 흉내낼 수 있다. */
function stubStore(initial, opts = {}) {
  const data = new Map(Object.entries(initial ?? {}));
  return {
    getItem(k) {
      if (opts.throwOnGet) throw new Error("boom");
      return data.has(k) ? data.get(k) : null;
    },
    setItem(k, v) {
      if (opts.throwOnSet) throw new Error("quota");
      data.set(k, String(v));
    },
    _raw: () => data.get(LawFavs.KEY),
  };
}

const fresh = (initial, opts) => {
  const s = stubStore(initial, opts);
  LawFavs.useStore(s);
  return s;
};

test("법·조·별표를 모두 담는다", () => {
  fresh();
  assert.equal(LawFavs.toggle("law:nca"), true, "켜면 true");
  LawFavs.toggle("art:nca-e:10");
  LawFavs.toggle("byl:nca-r:별표:2");
  assert.deepEqual(LawFavs.list(), ["law:nca", "art:nca-e:10", "byl:nca-r:별표:2"]);
});

test("토글은 껐다 켰다 하며 상태를 반환한다", () => {
  fresh();
  assert.equal(LawFavs.toggle("law:nca"), true);
  assert.equal(LawFavs.has("law:nca"), true);
  assert.equal(LawFavs.toggle("law:nca"), false, "다시 누르면 false");
  assert.equal(LawFavs.has("law:nca"), false);
  assert.equal(LawFavs.count(), 0);
});

test("추가한 순서를 유지한다 — 목록이 재배열되면 손이 헤맨다", () => {
  fresh();
  ["art:nca:7", "law:nca", "art:nca-e:33"].forEach((id) => LawFavs.add(id));
  assert.deepEqual(LawFavs.list(), ["art:nca:7", "law:nca", "art:nca-e:33"]);
});

test("같은 id 를 두 번 넣어도 하나만 남는다", () => {
  fresh();
  assert.equal(LawFavs.add("law:nca"), true);
  assert.equal(LawFavs.add("law:nca"), false, "이미 있으면 false");
  assert.equal(LawFavs.count(), 1);
});

test("사라진 id 를 저장소에서 지우지 않는다", () => {
  // 시드에서 법령이 잠시 빠졌다고 사용자의 즐겨찾기를 증발시키면 안 된다.
  fresh({ [LawFavs.KEY]: JSON.stringify(["law:nca", "law:없어진법"]) });
  const byId = new Map([["law:nca", { kind: "법령", label: "국가계약법" }]]);

  const g = LawFavs.grouped(byId);
  assert.equal(g.법.length, 1, "화면엔 실재하는 것만");
  assert.deepEqual(g.사라짐, ["law:없어진법"], "사라진 것은 따로 보고");
  assert.deepEqual(LawFavs.list(), ["law:nca", "law:없어진법"], "저장소는 그대로여야 한다");
});

test("grouped 는 법/조/별표로 나눈다", () => {
  fresh();
  ["law:nca", "art:nca-e:10", "byl:nca-r:별표:2"].forEach((id) => LawFavs.add(id));
  const byId = new Map([
    ["law:nca", { kind: "법령", label: "국가계약법" }],
    ["art:nca-e:10", { kind: "조문", label: "제10조" }],
    ["byl:nca-r:별표:2", { kind: "별표", label: "[별표 2]" }],
  ]);
  const g = LawFavs.grouped(byId);
  assert.equal(g.법[0].label, "국가계약법");
  assert.equal(g.조[0].label, "제10조");
  assert.equal(g.별표[0].label, "[별표 2]");
});

test("grouped 는 Map 과 평범한 객체를 모두 받는다", () => {
  fresh();
  LawFavs.add("law:nca");
  const plain = { "law:nca": { kind: "법령", label: "국가계약법" } };
  assert.equal(LawFavs.grouped(plain).법.length, 1);
});

test("손상된 JSON 이 페이지를 죽이지 않는다", () => {
  fresh({ [LawFavs.KEY]: "{이건 JSON 이 아니다" });
  assert.deepEqual(LawFavs.list(), []);
  assert.equal(LawFavs.has("law:nca"), false);
  // 손상된 상태에서도 새로 담을 수 있어야 한다
  assert.equal(LawFavs.add("law:nca"), true);
  assert.deepEqual(LawFavs.list(), ["law:nca"]);
});

test("배열이 아닌 값·이물질 항목을 걸러낸다", () => {
  fresh({ [LawFavs.KEY]: JSON.stringify({ law: "nca" }) });
  assert.deepEqual(LawFavs.list(), [], "객체가 오면 빈 목록");

  fresh({ [LawFavs.KEY]: JSON.stringify(["law:nca", null, 42, "", "law:nca"]) });
  assert.deepEqual(LawFavs.list(), ["law:nca"], "문자열만, 중복 제거");
});

test("저장소를 못 쓰는 환경에서도 던지지 않는다", () => {
  // file:// 로 열거나 프라이빗 모드면 localStorage 접근만으로도 예외가 난다.
  fresh({}, { throwOnGet: true });
  assert.deepEqual(LawFavs.list(), []);
  assert.equal(LawFavs.has("law:nca"), false);
  assert.doesNotThrow(() => LawFavs.toggle("law:nca"));

  fresh({}, { throwOnSet: true });
  assert.doesNotThrow(() => LawFavs.add("law:nca"));
});

test("저장소가 아예 없어도(null) 안전하다", () => {
  LawFavs.useStore(null);
  const saved = globalThis.localStorage;
  try {
    delete globalThis.localStorage;
    assert.deepEqual(LawFavs.list(), []);
    assert.doesNotThrow(() => LawFavs.add("law:nca"));
  } finally {
    if (saved !== undefined) globalThis.localStorage = saved;
  }
});

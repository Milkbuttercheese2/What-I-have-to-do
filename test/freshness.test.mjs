// 법령 신선도 검증
//
// 추출 규칙 테스트(extract.test.mjs)와 달리 여기는 날짜 로직이 대상이라 합성 데이터를 쓴다.
// 기준일(asOf)을 고정해 "오늘"에 의존하지 않게 한다 — 시간이 지나도 결과가 바뀌면 안 된다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph } from "../src/extract.mjs";
import { assess, report, daysBetween, parseYmd } from "../src/freshness.mjs";

const ASOF = new Date(Date.UTC(2026, 6, 21, 12)); // 2026-07-21

/** 현행 1 + 시행예정 1(같은 법의 미래 버전) + 확인일이 낡은 1 */
const snapshot = {
  meta: { domain: "테스트" },
  documents: [
    {
      id: "law-a",
      name: "가나다법",
      shortName: "가나다법",
      docType: "법률",
      family: "a",
      parent: null,
      verification: { 확인일: "2026-07-20T00:00:00.000Z", 시행일: "20260101" },
      articles: [{ no: "1", title: "목적", text: "제1조(목적) 「라마바법」 제5조에 따라 정한다." }],
    },
    {
      id: "law-a-future",
      name: "가나다법",
      shortName: "가나다법(시행예정)",
      docType: "법률",
      family: "a",
      parent: null,
      verification: { 확인일: "2026-07-20T00:00:00.000Z", 시행일: "20261201" },
      articles: [{ no: "1", title: "목적", text: "제1조(목적) 개정 예정 조문." }],
    },
    {
      id: "law-b",
      name: "라마바법",
      shortName: "라마바법",
      docType: "법률",
      family: "b",
      parent: null,
      verification: { 확인일: "2026-01-05T00:00:00.000Z", 시행일: "20250101" }, // 197일 경과
      articles: [{ no: "5", title: "적용", text: "제5조(적용) 이 법을 적용한다." }],
    },
  ],
};

const g = buildGraph(snapshot, { asOf: ASOF, maxAgeDays: 45 });
const node = (id) => g.nodes.find((n) => n.id === id);

test("시행일이 미래면 '시행예정' — 아직 효력이 없다", () => {
  const a = assess(snapshot.documents[1], { asOf: ASOF });
  assert.equal(a.status, "시행예정");
  assert.equal(a.citable, false, "시행예정본이 인용 대상으로 열려 있다");
});

test("시행일이 과거면 '현행'", () => {
  const a = assess(snapshot.documents[0], { asOf: ASOF });
  assert.equal(a.status, "현행");
  assert.equal(a.citable, true);
});

test("★ 최신 데이터만 인용 — 시행예정본을 가리키는 관계는 만들지 않는다", () => {
  const intoFuture = g.edges.filter((e) => e.target.includes("law-a-future") && e.kind !== "소속");
  assert.equal(intoFuture.length, 0, "시행예정본으로 향하는 인용/위임 엣지가 생겼다");
});

test("동명 법령이 현행/시행예정으로 둘 다 있으면 현행을 고른다", () => {
  // 「가나다법」을 인용하면 law-a 로 붙어야 한다.
  const g2 = buildGraph(
    {
      meta: {},
      documents: [
        ...snapshot.documents,
        {
          id: "law-c",
          name: "사아자법",
          shortName: "사아자법",
          docType: "법률",
          family: "c",
          parent: null,
          verification: { 확인일: "2026-07-20T00:00:00.000Z", 시행일: "20260101" },
          articles: [{ no: "1", title: "인용", text: "제1조(인용) 「가나다법」 제1조를 준용한다." }],
        },
      ],
    },
    { asOf: ASOF, maxAgeDays: 45 },
  );
  assert.ok(
    g2.edges.some((e) => e.source === "art:law-c:1" && e.target === "art:law-a:1"),
    "현행본(law-a)으로 붙지 않았다",
  );
});

test("확인일이 임계를 넘으면 낡음으로 표시한다", () => {
  const a = assess(snapshot.documents[2], { asOf: ASOF, maxAgeDays: 45 });
  assert.equal(a.stale, true);
  assert.ok(a.경과일 > 190, `경과일 계산 오류: ${a.경과일}`);
  assert.equal(node("law:law-b").낡음, true, "노드에 낡음 표시가 없다");
});

test("노드에 확인일·시행일 스탬프가 붙는다", () => {
  const n = node("art:law-a:1");
  assert.equal(n.시행일, "20260101");
  assert.equal(n.확인일, "20260720");
  assert.equal(n.상태, "현행");
});

test("차단된 관계는 조용히 버리지 않고 감사에 남는다", () => {
  assert.ok(Array.isArray(g.audit.신선도차단));
  assert.equal(g.audit.신선도.시행예정, 1);
  assert.equal(g.audit.신선도.낡음.length, 1);
});

test("확인일 메타가 없으면(구 스키마) 아무것도 걸러내지 않는다", () => {
  // 프로토타입 샘플이 신선도 도입으로 조용히 망가지면 안 된다.
  const plain = {
    meta: {},
    documents: [
      { id: "x", name: "엑스법", shortName: "엑스법", docType: "법률", family: "x", parent: null,
        articles: [{ no: "1", title: "t", text: "제1조(t) 「와이법」 제2조." }] },
      { id: "y", name: "와이법", shortName: "와이법", docType: "법률", family: "y", parent: null,
        articles: [{ no: "2", title: "t", text: "제2조(t) 본문." }] },
    ],
  };
  const gp = buildGraph(plain, { asOf: ASOF });
  assert.equal(gp.audit.신선도.미확인, 2);
  assert.ok(gp.edges.some((e) => e.source === "art:x:1" && e.target === "art:y:2"), "미확인인데 인용이 끊겼다");
});

test("날짜 헬퍼", () => {
  assert.equal(daysBetween("20260101", "20260111"), 10);
  assert.equal(parseYmd("20260721").getUTCFullYear(), 2026);
  assert.equal(parseYmd("엉터리"), null);
  assert.equal(report({ documents: [] }, { asOf: ASOF }).문서수, 0);
});

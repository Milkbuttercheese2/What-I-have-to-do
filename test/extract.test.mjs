// 추출 규칙 검증 — 법제처 실원문 픽스처 기준
//   node --test test/
//
// docs/scope.md §5.3 에 기록한 "현재 규칙이 놓치는 패턴" 하나하나를 회귀 테스트로 고정한다.
// 실데이터에서 확인된 표기만 다룬다. 가상의 예문으로 통과시키지 않는다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildGraph } from "../src/extract.mjs";

const snapshot = JSON.parse(readFileSync(new URL("./fixture-snapshot.json", import.meta.url), "utf8"));
const g = buildGraph(snapshot);

const has = (source, target, kind) => g.edges.some((e) => e.source === source && e.target === target && e.kind === kind);
const edge = (source, target, kind) => g.edges.find((e) => e.source === source && e.target === target && e.kind === kind);
const node = (id) => g.nodes.find((n) => n.id === id);

test("연결형 위임 — '대통령령으로 정하는 바에 따라'를 잡는다", () => {
  // 종결형('정한다')만 잡던 규칙의 구멍. 실원문에는 연결형이 훨씬 흔하다.
  assert.ok(has("art:nca:7", "law:nca-e", "위임"), "국가계약법 제7조 → 시행령 위임이 없다");
});

test("역방향 위임근거 — 예규 제1조에서 근거 조문을 도출한다", () => {
  // Layer 3 의 핵심. 정방향('장관이 정하는')은 대상이 없으므로 역방향으로 뒤집는다.
  assert.ok(has("art:nca-e:72", "law:ye-gongdong", "위임"), "시행령 제72조 → 공동계약운용요령");
  assert.ok(has("art:nca-e:71", "law:ye-jonghap", "위임"), "시행령 제71조 → 종합계약집행요령");
});

test("위임근거 커버리지 100% (픽스처 기준)", () => {
  const c = g.audit.위임근거_커버리지;
  assert.equal(c.행정규칙수, 2);
  assert.equal(c.근거도출, 2, `미도출: ${c.미도출.join(", ")}`);
});

test("행정규칙이 근거 법령의 family 를 상속한다", () => {
  assert.equal(node("law:ye-gongdong").family, "nca");
  assert.equal(node("art:ye-gongdong:1").family, "nca");
});

test("지역별칭 — 예규의 '시행령 제N조'를 해석한다", () => {
  // 예규 제1조의 (이하 "시행령"이라 한다) 정의를 읽어야만 해석된다.
  assert.ok(has("art:ye-gongdong:4", "art:nca-e:36", "인용"), "시행령 제36조");
  assert.ok(has("art:ye-jonghap:10", "art:nca-e:36", "인용"), "시행령 제36조 (종합계약)");
});

test("항·호·목을 근거에 남긴다", () => {
  const e = edge("art:ye-gongdong:4", "art:nca-e:42", "인용");
  assert.ok(e, "시행령 제42조 인용이 없다");
  assert.match(e.evidence, /제4항/, `항이 근거에 없다: ${e.evidence}`);
});

test("'법률 제N조' 표기 — '법 제N조'만 알던 구멍", () => {
  assert.ok(has("art:ye-gongdong:13", "art:nca:27", "인용"), "법률 제27조");
  const e = edge("art:ye-gongdong:13", "art:nca:27", "인용");
  assert.match(e.evidence, /제1항제3호/, `항·호가 없다: ${e.evidence}`);
});

test("범위 인용 '제64조내지 제66조'를 개별 조문으로 펼친다", () => {
  for (const no of ["64", "65", "66"]) {
    assert.ok(has("art:ye-gongdong:12", `art:nca-e:${no}`, "인용"), `제${no}조가 빠졌다`);
  }
});

test("가지조문 제2조의2 를 하나의 조문으로 다룬다", () => {
  assert.ok(node("art:ye-gongdong:2의2"), "가지조문 노드가 없다");
  assert.equal(node("art:ye-gongdong:2의2").label, "제2조의2");
});

test("외부법 노드 — 스냅샷에 없는 타부처 법령", () => {
  for (const name of ["건설산업기본법", "독점규제및공정거래에관한법률", "건설기술진흥법", "도로법"]) {
    assert.ok(node(`ext:${name}`), `외부법 노드 없음: ${name}`);
  }
});

test("'같은 영' 문맥 — 직전 「건설기술 진흥법 시행령」을 가리킨다", () => {
  // "제69조에 따른 … 또는 같은 영 제71조에 따른 …"
  // '같은 영'이 자기 계열 시행령(nca-e)으로 잘못 붙으면 안 된다.
  assert.ok(node("ext:건설기술진흥법시행령"), "건설기술 진흥법 시행령 외부노드가 없다");
  assert.ok(
    !has("art:nca-e:42", "art:nca-e:71", "인용"),
    "'같은 영 제71조'가 자기 시행령 제71조로 오인됐다",
  );
});

test("자기 자신 인용은 엣지로 만들지 않는다", () => {
  assert.ok(!has("art:nca-e:42", "art:nca-e:42", "인용"));
});

test("미매칭 행정규칙 위임을 감사 목록으로 남긴다", () => {
  // 시행령 제42조의 "재정경제부장관이 정하는 심사기준"은 픽스처에 대응 예규가 없다.
  // 조용히 버리지 말고 사람이 확인할 목록으로 올라와야 한다.
  const pend = g.audit.미매칭_행정규칙위임;
  assert.ok(pend.some((p) => p.article === "제42조"), "제42조 미매칭이 보고되지 않았다");
});

test("구 스키마(laws/type/parent) 스냅샷도 그대로 돈다", () => {
  // 프로토타입 샘플의 기준선. family 필드가 없어도 부모 체인으로 법령군을 유추해야 한다.
  const legacy = JSON.parse(readFileSync(new URL("../data/procurement-laws.json", import.meta.url), "utf8"));
  const lg = buildGraph(legacy);
  assert.equal(lg.stats.위임, 5, "위임 기준선 5");
  assert.equal(lg.stats.인용, 12, "인용 기준선 12");
});

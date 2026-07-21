// LawEverything — 빌드: 스냅샷 → 관계추출 → 자족형 오프라인 페이지
//
// 이 스크립트가 "온라인 빌드 단계"의 마지막 조립이다.
// 산출물 web/index.html 은 외부 의존성 0 → 내부망에 반입해 더블클릭으로 연다.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildGraph } from "./extract.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// collect.mjs 가 만든 실데이터 스냅샷이 있으면 그것을, 없으면 프로토타입 샘플을 쓴다.
const real = join(root, "data/snapshot.json");
const sample = join(root, "data/procurement-laws.json");
const src = existsSync(real) ? real : sample;
if (src === sample) {
  console.warn("⚠️  data/snapshot.json 이 없어 샘플로 빌드합니다. 실데이터는 `npm run collect` 후 재빌드하세요.\n");
}

const snapshot = JSON.parse(readFileSync(src, "utf8"));
const graph = buildGraph(snapshot);
const template = readFileSync(join(root, "src/template.html"), "utf8");

// 감사 정보는 빌드 산출물에 실을 필요가 없다 (내부망 페이지는 가볍게 유지).
const { audit, ...page } = graph;
const html = template.replace("/*__GRAPH__*/", JSON.stringify(page));

mkdirSync(join(root, "web"), { recursive: true });
writeFileSync(join(root, "web/index.html"), html);
// 그래프·감사 데이터는 별도 저장 (다른 도구/디버깅/커버리지 추적용)
writeFileSync(join(root, "web/graph.json"), JSON.stringify(page, null, 2));
writeFileSync(join(root, "data/audit.json"), JSON.stringify(audit, null, 2));

const s = graph.stats;
console.log(`빌드 완료 → web/index.html  (입력: ${src.replace(root, ".")})`);
console.log(`  문서 ${s.documents} · 노드 ${s.nodes} (조문 ${s.articleNodes} · 외부법 ${s.externalNodes})`);
console.log(`  엣지 ${s.edges} — 위임 ${s.위임} · 인용 ${s.인용} · 소속 ${s.소속}`);

const c = audit.위임근거_커버리지;
if (c.행정규칙수) console.log(`  ★ 위임근거 커버리지 ${c.근거도출}/${c.행정규칙수} (${c.비율}%)`);
if (audit.미매칭_행정규칙위임.length)
  console.log(`  ⚠️  미매칭 행정규칙 위임 ${audit.미매칭_행정규칙위임.length}건 → data/audit.json`);

// LawEverything — 빌드: 스냅샷 → 관계추출 → 자족형 오프라인 페이지
//
// 이 스크립트가 "온라인 빌드 단계"의 마지막 조립이다.
// 산출물 web/index.html 은 외부 의존성 0 → 내부망에 반입해 더블클릭으로 연다.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildGraph } from "./extract.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const snapshot = JSON.parse(readFileSync(join(root, "data/procurement-laws.json"), "utf8"));
const graph = buildGraph(snapshot);
const template = readFileSync(join(root, "src/template.html"), "utf8");

const html = template.replace("/*__GRAPH__*/", JSON.stringify(graph));

mkdirSync(join(root, "web"), { recursive: true });
writeFileSync(join(root, "web/index.html"), html);
// 그래프 데이터도 별도 저장 (다른 도구/디버깅용)
writeFileSync(join(root, "web/graph.json"), JSON.stringify(graph, null, 2));

console.log("빌드 완료 → web/index.html");
console.log("스냅샷:", graph.stats.laws, "법령 /", graph.stats.nodes, "노드 /", graph.stats.edges, "엣지",
  `(위임 ${graph.stats.위임} · 인용 ${graph.stats.인용} · 소속 ${graph.stats.소속})`);

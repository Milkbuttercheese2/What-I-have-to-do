// 빌드 산출물 스모크 — web/index.html 이 내부망에서 실제로 열리는 물건인지 확인
//   node test/smoke.mjs
//
// 브라우저 없이 확인 가능한 것만 본다:
//   1) 그래프 데이터가 유효하게 주입됐는가 (+ 확인일 메타 포함)
//   2) 인라인 스크립트에 문법 오류가 없는가
//   3) 외부 의존성이 0인가 (AGENTS.md 불변원칙 1)
// 클릭·검색 같은 상호작용은 브라우저 스모크의 몫이다.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "web/index.html"), "utf8");

const fail = (msg) => {
  console.error(`❌ ${msg}`);
  process.exit(1);
};

// 1) 주입된 GRAPH
const m = html.match(/const GRAPH\s*=\s*([\s\S]*?);\s*<\/script>/);
if (!m) fail("GRAPH 주입 지점을 찾지 못했습니다.");
let g;
try {
  g = JSON.parse(m[1]);
} catch (e) {
  fail(`GRAPH 가 유효한 JSON 이 아닙니다: ${e.message}`);
}
console.log(`✅ GRAPH 파싱 — 노드 ${g.nodes.length} · 엣지 ${g.edges.length}`);

if (!g.meta?.기준일) fail("meta.기준일 이 없습니다 — 페이지가 '언제 기준 데이터'인지 표시할 수 없습니다.");
console.log(`✅ 확인일 메타 — 기준일 ${g.meta.기준일} · ${JSON.stringify(g.meta.확인요약)}`);

if (g.audit) fail("audit 이 페이지에 실려 있습니다. 내부망 산출물은 가볍게 유지해야 합니다.");

// 노드 스탬프가 UI 로 넘어갔는지 (확인일 메타가 있는 스냅샷일 때만)
if (g.meta.확인요약?.현행 > 0) {
  const stamped = g.nodes.filter((n) => n.확인일 || n.시행일).length;
  if (stamped === 0) fail("노드에 확인일·시행일 스탬프가 하나도 없습니다.");
  console.log(`✅ 노드 스탬프 ${stamped}/${g.nodes.length}`);
}

// 2) 검색 런타임이 인라인됐는가 (별도 파일이라 치환 실패해도 조용히 넘어갈 수 있다)
if (!/var LawSearch\s*=/.test(html)) fail("검색 런타임이 인라인되지 않았습니다 (검색 자리표시자 치환 실패).");
if (!/var AnnexTable\s*=/.test(html)) fail("별표 표 변환기가 인라인되지 않았습니다 (표 자리표시자 치환 실패).");
if (!/var LawFavs\s*=/.test(html)) fail("즐겨찾기 모듈이 인라인되지 않았습니다 (즐겨찾기 자리표시자 치환 실패).");
if (!/var LawNotes\s*=/.test(html)) fail("법률노트 모듈이 인라인되지 않았습니다 (노트 자리표시자 치환 실패).");
if (/\bSEARCH__\b|\bANNEX__\b|\bFAVS__\b|\bNOTES__\b/.test(html)) fail("치환되지 않은 자리표시자가 남아 있습니다.");
console.log("✅ 검색 런타임 인라인");

// 3) 인라인 스크립트 문법
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1]);
scripts.forEach((s, i) => {
  try {
    new Function(s);
  } catch (e) {
    fail(`script[${i}] 문법 오류: ${e.message}`);
  }
});
console.log(`✅ 인라인 스크립트 ${scripts.length}개 문법 OK`);

// 4) 외부 의존성 0 — 폐쇄망에서 깨지는 가장 흔한 원인
const ext = html.match(/(?:src|href)\s*=\s*["'](?:https?:)?\/\//gi);
if (ext) fail(`외부 리소스 참조 ${ext.length}건: ${[...new Set(ext)].join(", ")}`);
const fetches = html.match(/\b(?:fetch|XMLHttpRequest|WebSocket|importScripts)\s*\(/g);
if (fetches) fail(`네트워크 호출 발견: ${[...new Set(fetches)].join(", ")}`);
console.log("✅ 외부 의존성 0");

console.log(`\n산출물 ${(Buffer.byteLength(html) / 1024).toFixed(1)} KB — 더블클릭으로 열리는 상태입니다.`);

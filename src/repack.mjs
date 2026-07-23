// 재조립: 이미 빌드된 web/index.html 에서 실데이터(GRAPH·ANNEX_AVAIL)를 뽑아
// **현재 템플릿·모듈**로 다시 조립한다. 라이브 수집(LAW_OC) 없이 최신 UI 를 실데이터에 입히는 경로.
//
// 쓰임: 시크릿이 준비되기 전에 커밋된 실데이터(320문서)로 Windows exe 를 뽑을 때.
//   node src/repack.mjs            web/index.html 을 제자리에서 재조립
//   node src/repack.mjs <입력.html> <출력.html>
//
// 정식 빌드(src/build.mjs)는 data/snapshot.json 을 필요로 한다. 이 스크립트는 스냅샷 없이
// 산출물 자체에 박힌 GRAPH 를 재사용하므로, 관계추출을 다시 하지 않는다(데이터는 그대로).

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const inPath = process.argv[2] || join(root, "web/index.html");
const outPath = process.argv[3] || inPath;

const src = readFileSync(inPath, "utf8");
function pick(re, name) {
  const m = src.match(re);
  if (!m) throw new Error(`재조립 실패: ${name} 를 ${inPath} 에서 찾지 못했습니다. 실데이터 산출물이 맞는지 확인하세요.`);
  return m[1];
}
const GRAPH = pick(/const GRAPH = (\{.*?\});\s*\n<\/script>/s, "GRAPH");
// 리포에 별표 원본 파일(web/annex)은 커밋하지 않는다(gitignore). 그래서 브라우저용 산출물의
// 가용 파일 목록은 비운다 — 뷰어가 빈 iframe 대신 법제처 원문 링크 카드를 띄우게.
// (데스크톱 앱 빌드는 web/annex 를 채우고 build.mjs 가 실제 목록을 넣는다.)
const AVAIL = "[]";

const inl = (p) => readFileSync(join(root, p), "utf8");
const template = readFileSync(join(root, "src/template.html"), "utf8");
let html = template
  .replace("/*__SEARCH__*/", () => inl("src/search-runtime.cjs"))
  .replace("/*__ANNEXVIEW__*/", () => inl("src/annex-view.cjs"))
  .replace("/*__FAVS__*/", () => inl("src/favorites.cjs"))
  .replace("/*__NOTES__*/", () => inl("src/notes.cjs"))
  .replace("/*__BACKUP__*/", () => inl("src/backup.cjs"))
  .replace("/*__LAWTEXT__*/", () => inl("src/lawtext.cjs"))
  .replace("/*__ANNEX_AVAIL__*/", () => AVAIL)
  .replace("/*__GRAPH__*/", () => GRAPH);

const fontPath = join(root, "assets/PretendardVariable.woff2");
try {
  html = html.replace("/*__FONT__*/", `data:font/woff2;base64,${readFileSync(fontPath).toString("base64")}`);
} catch {
  html = html.replace("/*__FONT__*/", "");
}

writeFileSync(outPath, html);
const docs = (GRAPH.match(/"documents":(\d+)/) || [])[1] || "?";
console.log(`재조립 완료 → ${outPath.replace(root, ".")}  (문서 ${docs} · GRAPH ${(GRAPH.length / 1048576).toFixed(1)}MB, 최신 템플릿)`);

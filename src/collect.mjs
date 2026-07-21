// LawEverything — 수집: seed.json → 법제처 오픈API → data/snapshot.json
//
// 온라인 빌드 단계의 첫 걸음. 인터넷 PC에서 실행한다.
//   node src/collect.mjs            수집 (캐시 있으면 재사용)
//   node src/collect.mjs --refresh  캐시 무시하고 새로 받기
//   node src/collect.mjs --only nca 특정 문서만
//
// 캐시(.cache/)를 두는 이유: 30종 수집 중 하나가 실패해도 처음부터 다시 받지 않기 위함.
// 법 개정 반영은 --refresh 로 통째로 다시 받는다(월 1회 상정).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fetchLaw, fetchAdminRule, resolveCurrentMst, LawApiError } from "./lawapi.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = join(root, ".cache");

const args = process.argv.slice(2);
const refresh = args.includes("--refresh");
const onlyIdx = args.indexOf("--only");
const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null;

/** 루트 .env 를 최소 파싱 (의존성 추가 없이) */
function loadDotEnv() {
  const p = join(root, ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const val = m[2].replace(/^["']|["']$/g, "");
    if (!process.env[m[1]]) process.env[m[1]] = val;
  }
}

const cachePath = (id) => join(cacheDir, `${id}.json`);

async function cached(id, fn) {
  if (!refresh && existsSync(cachePath(id))) {
    return { ...JSON.parse(readFileSync(cachePath(id), "utf8")), _cached: true };
  }
  // 확인일은 "법제처와 실제로 대조한 시각"이다. 캐시를 읽은 시각이 아니다.
  // 캐시 안에 함께 저장해, 재빌드해도 확인일이 앞당겨지지 않게 한다.
  const data = { ...(await fn()), 확인일: new Date().toISOString() };
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cachePath(id), JSON.stringify(data, null, 2));
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  loadDotEnv();

  const seed = JSON.parse(readFileSync(join(root, "data/seed.json"), "utf8"));
  const wanted = (d) => !only || d.id === only;
  const laws = seed.laws.filter(wanted);
  const rules = seed.adminRules.filter(wanted);

  const documents = [];
  const failures = [];

  console.log(`수집 시작 — 법령 ${laws.length}종 · 행정규칙 ${rules.length}종\n`);

  for (const l of laws) {
    try {
      const data = await cached(l.id, async () => {
        // MST는 개정되면 바뀐다. seed의 값이 낡았을 수 있으니 현행을 재확인한다.
        const cur = await resolveCurrentMst(l.name);
        if (cur?.mst && cur.mst !== l.mst) {
          console.log(`  ℹ ${l.shortName}: MST 변경 감지 ${l.mst} → ${cur.mst} (seed.json 갱신 권장)`);
        }
        await sleep(200);
        const body = await fetchLaw({ mst: cur?.mst || l.mst, lawId: l.lawId });
        return { ...body, 사용MST: cur?.mst || l.mst, 현행일치: cur?.mst ? cur.mst === l.mst : null, 효력: cur?.효력 ?? null };
      });
      documents.push({
        id: l.id,
        name: l.name,
        shortName: l.shortName,
        docType: l.docType,
        family: l.family,
        parent: l.parent,
        aliases: l.aliases ?? [],
        source: { kind: "law", mst: l.mst, lawId: l.lawId },
        // 신선도 판정의 원재료 (src/freshness.mjs)
        verification: {
          확인일: data.확인일,
          사용MST: data.사용MST ?? l.mst,
          seedMST: l.mst,
          현행일치: data.현행일치 ?? null,
          효력: data.효력 ?? null,
          시행일: data.시행일 ?? null,
          공포일: data.공포일 ?? null,
        },
        articles: data.articles,
      });
      console.log(`  ✅ ${l.shortName} — ${data.articles.length}개 조문${data._cached ? " (캐시)" : ""}`);
    } catch (e) {
      failures.push({ id: l.id, name: l.shortName, error: e.message });
      console.error(`  ❌ ${l.shortName} — ${e.message}`);
      if (e instanceof LawApiError && /LAW_API_OC/.test(e.message)) process.exit(1);
    }
    if (!refresh) await sleep(100);
  }

  for (const r of rules) {
    try {
      const data = await cached(r.id, () => fetchAdminRule({ seq: r.seq, ruleId: r.ruleId }));
      documents.push({
        id: r.id,
        name: r.name,
        shortName: r.shortName,
        docType: r.docType,
        family: null, // 위임근거 역파싱으로 extract 단계에서 채운다
        parent: null,
        aliases: [r.shortName],
        source: { kind: "admrul", seq: r.seq, ruleId: r.ruleId },
        // 본문에 위임근거가 없는 문서용 수기 매핑 (seed.json). 있으면 추출기가 최우선으로 쓴다.
        ...(r.위임근거 ? { 위임근거: r.위임근거 } : {}),
        verification: {
          확인일: data.확인일,
          seq: r.seq,
          // 행정규칙은 발령일이 곧 시행일인 경우가 많으나 항상 그렇지는 않다.
          // 별도 시행일이 없으면 null 로 두고 "현행"으로 다루되, 단정하지 않는다.
          시행일: data.시행일 ?? null,
          발령일: data.발령일 ?? null,
        },
        articles: data.articles,
      });
      console.log(`  ✅ ${r.shortName} — ${data.articles.length}개 조문${data._cached ? " (캐시)" : ""}`);
    } catch (e) {
      failures.push({ id: r.id, name: r.shortName, error: e.message });
      console.error(`  ❌ ${r.shortName} — ${e.message}`);
    }
    await sleep(100);
  }

  const snapshot = {
    meta: {
      title: "조달 법령군 스냅샷 (Phase 1 — 핵심 30종)",
      collectedAt: new Date().toISOString(),
      source: "법제처 국가법령정보 오픈API",
      documents: documents.length,
      articles: documents.reduce((n, d) => n + d.articles.length, 0),
    },
    documents,
  };

  writeFileSync(join(root, "data/snapshot.json"), JSON.stringify(snapshot, null, 2));

  console.log(`\n수집 완료 → data/snapshot.json`);
  console.log(`  문서 ${snapshot.meta.documents} · 조문 ${snapshot.meta.articles}`);
  if (failures.length) {
    console.log(`\n⚠️  실패 ${failures.length}건:`);
    for (const f of failures) console.log(`  · ${f.name} — ${f.error}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e instanceof LawApiError ? `\n${e.message}\n` : e);
  process.exit(1);
});

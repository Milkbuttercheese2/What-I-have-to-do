// 몇 조항이더라 — 수집: seed.json → 법제처 오픈API → data/snapshot.json
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
import { fetchLaw, fetchAdminRule, resolveCurrentMst, searchAdminRules, LawApiError } from "./lawapi.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = join(root, ".cache");

const args = process.argv.slice(2);
const refresh = args.includes("--refresh");
const onlyIdx = args.indexOf("--only");
const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null;
// 열거로 수집할 행정규칙 상한. 검증·데모용으로 규모를 줄일 때 쓴다.
// 지정하지 않으면 소관부처 전수(조달청 = 약 290종)를 모두 받는다.
const maxRulesIdx = args.indexOf("--max-rules");
const maxRules = maxRulesIdx >= 0 ? Number(args[maxRulesIdx + 1]) : Infinity;

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

// 전수조사(법령 88 + 행정규칙 300여)는 순차로 받으면 오래 걸린다. 동시성을 제한한 풀로
// 병렬 수집한다. 상한을 두는 이유는 법제처에 대한 예의 + 순간 폭주로 인한 차단 회피다.
const concIdx = args.indexOf("--concurrency");
// 법제처가 대량 동시호출에 연결을 끊는다(throttling). 4 정도가 병렬 이득과 안정의 균형.
// (getJson 은 자체 재시도가 있어 일시 실패는 대부분 복구된다.)
const concurrency = concIdx >= 0 ? Math.max(1, Number(args[concIdx + 1]) || 1) : 4;

/** items 를 worker 로 처리하되 동시에 최대 limit 개만 진행한다. 입력 순서와 무관하게 완료. */
async function mapPool(items, limit, worker) {
  let idx = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      await worker(items[i], i);
    }
  });
  await Promise.all(runners);
}

/** 별표는 조달 실무의 핵심(제재기준·심사표)이라 수집 로그에 따로 드러낸다. */
const annexNote = (d) => (d.annexes?.length ? ` · 별표/서식 ${d.annexes.length}` : "");

async function main() {
  loadDotEnv();

  const seed = JSON.parse(readFileSync(join(root, "data/seed.json"), "utf8"));
  const wanted = (d) => !only || d.id === only;
  const laws = seed.laws.filter(wanted);
  // 관련법령(부처 교차, §2·§2.5) — 조달 조문이 인용하는 타부처 개별법. 핵심 법령과 같은 방식으로 전문 수집한다.
  const related = (seed.relatedLaws ?? []).filter(wanted);
  const allLaws = [...laws, ...related];
  const rules = seed.adminRules.filter(wanted);

  const documents = [];
  const failures = [];

  console.log(`수집 시작 — 핵심 법령 ${laws.length}종 · 관련법령 ${related.length}종 · 행정규칙 ${rules.length}종 (동시성 ${concurrency})\n`);

  await mapPool(allLaws, concurrency, async (l) => {
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
        // 관련법령(부처 교차)은 핵심 조달 법령과 구분해 표기·필터할 수 있게 카테고리를 남긴다.
        ...(l.category ? { category: l.category } : {}),
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
        annexes: data.annexes ?? [],
        // 소관부처·담당부서·연락처 — 화면에 "누구 소관인지" 를 띄우기 위한 것
        ...(data.소관부처 ? { 소관부처: data.소관부처, 소관부처코드: data.소관부처코드 ?? null } : {}),
        ...(data.연락부서?.length ? { 연락부서: data.연락부서 } : {}),
        ...(data.약칭 ? { 약칭: data.약칭 } : {}),
      });
      console.log(`  ✅ ${l.shortName} — ${data.articles.length}개 조문${annexNote(data)}${data._cached ? " (캐시)" : ""}`);
    } catch (e) {
      failures.push({ id: l.id, name: l.shortName, error: e.message });
      console.error(`  ❌ ${l.shortName} — ${e.message}`);
      if (e instanceof LawApiError && /LAW_API_OC/.test(e.message)) process.exit(1);
    }
  });

  // 수집할 행정규칙 = 수기 지정(계약예규 등) + 소관부처 전수 열거(조달청 등).
  // 열거가 '조달청 행정규칙 전부'를 담당한다. seq 로 중복 제거한다.
  const ruleList = [...rules];
  if (!only) {
    const seenSeq = new Set(rules.map((r) => r.seq));
    for (const srcCfg of seed.adminRuleSources ?? []) {
      try {
        const { total, items } = await searchAdminRules(srcCfg);
        let added = 0;
        for (const it of items) {
          if (seenSeq.has(it.seq)) continue;
          if (ruleList.length - rules.length >= maxRules) break;
          seenSeq.add(it.seq);
          ruleList.push({
            id: `adm-${it.seq}`,
            name: it.name,
            shortName: it.name,
            docType: it.kind || "행정규칙",
            seq: it.seq,
            ruleId: it.ruleId,
          });
          added += 1;
        }
        const capped = Number.isFinite(maxRules) ? ` [상한 ${maxRules} 적용]` : "";
        console.log(`  ▸ ${srcCfg.label ?? srcCfg.org} 행정규칙 열거 ${items.length}/${total}종 → 신규 ${added}종${capped}`);
      } catch (e) {
        console.error(`  ❌ 행정규칙 열거 실패 (${srcCfg.label ?? srcCfg.org}) — ${e.message}`);
      }
    }
  }

  await mapPool(ruleList, concurrency, async (r) => {
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
        // 별표(본문 텍스트). 조문 텍스트엔 없는 별표를 리더에서 테이블로 렌더한다.
        annexes: data.annexes ?? [],
        ...(data.소관부처 ? { 소관부처: data.소관부처, 소관부처코드: data.소관부처코드 ?? null } : {}),
        ...(data.연락부서?.length ? { 연락부서: data.연락부서 } : {}),
        ...(data.전화번호 ? { 전화번호: data.전화번호 } : {}),
      });
      console.log(`  ✅ ${r.shortName} — ${data.articles.length}개 조문${annexNote(data)}${data._cached ? " (캐시)" : ""}`);
    } catch (e) {
      failures.push({ id: r.id, name: r.shortName, error: e.message });
      console.error(`  ❌ ${r.shortName} — ${e.message}`);
    }
  });

  const attempted = documents.length + failures.length;
  const snapshot = {
    meta: {
      title: "조달 법령군 스냅샷 (법령 + 조달청 행정규칙 전수)",
      collectedAt: new Date().toISOString(),
      source: "법제처 국가법령정보 오픈API",
      documents: documents.length,
      articles: documents.reduce((n, d) => n + d.articles.length, 0),
      annexes: documents.reduce((n, d) => n + (d.annexes?.length ?? 0), 0),
      ...(failures.length ? { 수집실패: failures.length } : {}),
    },
    documents,
  };

  writeFileSync(join(root, "data/snapshot.json"), JSON.stringify(snapshot, null, 2));

  console.log(`\n수집 완료 → data/snapshot.json`);
  console.log(`  문서 ${snapshot.meta.documents} · 조문 ${snapshot.meta.articles} · 별표/서식 ${snapshot.meta.annexes}`);
  if (failures.length) {
    console.log(`\n⚠️  실패 ${failures.length}/${attempted}건:`);
    for (const f of failures.slice(0, 30)) console.log(`  · ${f.name} — ${f.error}`);
    if (failures.length > 30) console.log(`  · … 외 ${failures.length - 30}건`);
    writeFileSync(join(root, "data/collect-failures.json"), JSON.stringify(failures, null, 2));
  }
  // 부분 실패는 빌드를 막지 않는다 — 재시도 후에도 남은 소수 실패보다, 받은 대다수를 반영한
  // 산출물이 낫다. 다만 전멸(0건)이나 절반 이상 실패는 근본 문제이므로 중단시킨다.
  if (documents.length === 0) {
    console.error("\n❌ 수집된 문서가 0건입니다 — OC/네트워크/스키마를 확인하세요.");
    process.exitCode = 1;
  } else if (failures.length > attempted * 0.5) {
    console.error(`\n❌ 실패율이 과반(${failures.length}/${attempted})입니다 — throttling/네트워크 문제로 보고 중단합니다.`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e instanceof LawApiError ? `\n${e.message}\n` : e);
  process.exit(1);
});

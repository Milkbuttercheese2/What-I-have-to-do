// LawEverything — 규칙기반 법령 관계 추출기 (AI 없음)
//
// 입력:  data/snapshot.json  { meta, documents[] }
// 출력:  { nodes, edges, stats, audit } — 위임/인용 그래프
//
// 관계를 3계층으로 나눠 전부 규칙으로 도출한다 (docs/scope.md §5.6):
//   Layer 1  문서 위임   법률 → 시행령 → 시행규칙        (seed의 parent + 위임문구)
//   Layer 2  조문 인용   「법명」제N조 / 시행령 제N조 …    (정규식 + 문맥 상태머신)
//   Layer 3  조문→행정규칙 위임
//            "재정경제부장관이 정하는 심사기준" 은 대상이 안 적혀 있다.
//            대신 행정규칙 제1조(목적)가 근거 조문을 밝힌다:
//              "「…시행령」 제72조에 의한 공동계약의 체결방법 …을 정함을 목적으로 한다"
//            → 역방향으로 수집해 뒤집으면 정방향 위임 엣지가 완성된다.
//
// 런타임이 아니라 "온라인 빌드 단계"에서 1회 실행되어 정적 그래프를 굽는다.

// ── 위임 문구 ──────────────────────────────────────────────────────────────
// 실데이터에서 압도적으로 흔한 형태는 종결형("정한다")이 아니라
// 연결형("정하는 바에 따라")이다. 어미를 넓게 잡는다.
const 정하다 = "정(?:한다|하는|하여|하되|할|함)";

const DELEGATION_RULES = [
  { re: new RegExp(`대통령령으로\\s*${정하다}`), childType: "시행령" },
  { re: new RegExp(`(?:총리령|[가-힣]{2,10}부령)으로\\s*${정하다}`), childType: "시행규칙" },
];

// 법령 → 행정규칙 위임. 대상이 명시되지 않아 이 단계에서는 "위임이 있었다"만 안다.
// 실제 대상은 행정규칙 제1조 역파싱(Layer 3)으로 이어붙인다.
const ADMIN_DELEGATION_RE = new RegExp(
  `(?:([가-힣]{2,12}(?:부장관|장관|청장|위원장))|각\\s*중앙관서의\\s*장)\\s*이\\s*${정하다}`,
  "g",
);

// ── 인용 정규식 ────────────────────────────────────────────────────────────
const JO = String.raw`제(\d+)조(?:의(\d+))?`;

// 범위 인용: "제64조내지 제66조", "제4조부터 제6조까지" — 개별 조문으로 펼친다.
const RANGE_RE = new RegExp(
  String.raw`(?:「([^」]+)」|(시행령|시행규칙|법률|법|영|규칙))?\s*${JO}\s*(?:내지|부터)\s*${JO}(?:\s*까지)?`,
  "g",
);

// 단건 인용. 왼→오른쪽으로 훑으며 문맥(lastDoc)을 유지한다.
const CITE_RE = new RegExp(
  [
    String.raw`「([^」]+)」\s*(?:${JO})?`, // 1:법명 2:조 3:가지
    String.raw`같은\s*(법률|법|영|규칙|조)\s*(?:${JO})?`, // 4:종류 5:조 6:가지
    String.raw`(시행령|시행규칙|법률|법|영|규칙)\s*${JO}`, // 7:별칭 8:조 9:가지
    String.raw`${JO}`, // 10:조 11:가지
  ].join("|"),
  "g",
);

// 인용 뒤에 붙는 항·호 — 엣지 근거를 정밀하게 남기기 위해서만 쓴다(노드는 조문 단위).
const SUBUNIT_RE = /^\s*(?:제(\d+)항)?\s*(?:제(\d+)호)?\s*(?:([가-힣])목)?/;

import { assess, report as freshnessReport, DEFAULT_MAX_AGE_DAYS } from "./freshness.mjs";

const norm = (s) => String(s ?? "").replace(/\s+/g, "");
const extId = (name) => `ext:${norm(name)}`;
const joKey = (no, branch) => (branch ? `${no}의${branch}` : String(no));
/** "2의2" → "제2조의2" (가지조문). 키는 조 단위로 하나지만 표기는 법령 관행을 따른다. */
const joLabel = (no) => {
  const [base, branch] = String(no).split("의");
  return branch ? `제${base}조의${branch}` : `제${base}조`;
};

export function buildGraph(snapshot, options = {}) {
  // 구 스키마(laws) 호환 — 프로토타입 스냅샷도 그대로 돌아간다.
  const docs = snapshot.documents ?? snapshot.laws ?? [];
  const byId = new Map(docs.map((d) => [d.id, d]));

  // ── 신선도 ───────────────────────────────────────────────────────────────
  // 시행예정본은 인용 대상에서 제외한다. 아직 효력이 없는 조문이 현행 조문을
  // 대체해 보이면 실무자가 잘못된 근거를 든다 (src/freshness.mjs 참조).
  const asOf = options.asOf ?? new Date();
  const maxAgeDays = options.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
  const fresh = new Map(docs.map((d) => [d.id, assess(d, { asOf, maxAgeDays })]));
  const citable = (docId) => fresh.get(docId)?.citable !== false;
  const blocked = []; // 신선도 때문에 끊은 관계 — 조용히 버리지 않고 감사에 남긴다

  const isLaw = (d) => ["법률", "시행령", "시행규칙"].includes(d.docType ?? d.type);
  const typeOf = (d) => d.docType ?? d.type;

  // ── 문서 해석 ────────────────────────────────────────────────────────────
  /** 법령명/약칭으로 스냅샷 내 문서 찾기 (없으면 null → 외부법 노드) */
  const resolveDoc = (name) => {
    const n = norm(name);
    if (!n) return null;
    // 같은 법령의 현행본과 시행예정본이 함께 들어올 수 있다. 항상 현행을 고른다.
    const pick = (list) => list.find((d) => citable(d.id)) ?? list[0] ?? null;

    const exact = docs.filter(
      (d) => norm(d.name) === n || norm(d.shortName) === n || (d.aliases ?? []).some((a) => norm(a) === n),
    );
    if (exact.length) return pick(exact);

    // 부분일치는 오탐이 쉬우므로 충분히 긴 경우만
    if (n.length >= 6) {
      const partial = docs.filter((d) => norm(d.name).includes(n) || n.includes(norm(d.name)));
      if (partial.length) return pick(partial);
    }
    return null;
  };

  const rootOf = (d) => {
    let cur = d;
    const seen = new Set();
    while (cur?.parent && byId.has(cur.parent) && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = byId.get(cur.parent);
    }
    return cur;
  };
  // family 가 명시되지 않은 구 스키마에서는 부모 체인의 뿌리를 법령군으로 본다.
  const familyOf = (d) => d.family ?? rootOf(d).id;
  const siblingOfType = (d, t) =>
    docs.find((x) => isLaw(x) && familyOf(x) === familyOf(d) && typeOf(x) === t) ?? null;

  /**
   * 문서 지역 별칭. 예규 제1조의 `「…시행령」(이하 "시행령"이라 한다)` 같은 정의문을
   * 읽어 그 문서 안에서 "시행령"이 무엇을 가리키는지 확정한다.
   * 이게 없으면 계약예규의 "시행령 제72조"를 해석할 수 없다.
   */
  const localAliases = (doc) => {
    const map = new Map();
    // 따옴표는 곧은("), 둥근(" "), 홑(' ') 이 뒤섞여 나온다. 어미도 "이라/라/이" 모두 쓰인다.
    const Q = `["'“”‘’]`;
    const re = new RegExp(String.raw`「([^」]+)」\s*\(\s*이하\s*${Q}([^"'“”‘’]+)${Q}\s*(?:이라|라|이)\s*한다\s*\)`, "g");
    for (const art of doc.articles ?? []) {
      let m;
      while ((m = re.exec(art.text)) !== null) {
        const target = resolveDoc(m[1]);
        if (target) map.set(norm(m[2]), target);
      }
    }
    return map;
  };

  // ── 그래프 컨테이너 ──────────────────────────────────────────────────────
  const nodes = new Map();
  const edges = [];
  const seenEdge = new Set();

  const addNode = (n) => {
    if (!nodes.has(n.id)) nodes.set(n.id, n);
    return nodes.get(n.id);
  };
  /** 노드 id("art:xxx:7" | "law:xxx" | "ext:...")에서 문서 id 추출 */
  const docIdOf = (nodeId) => {
    const [kind, id] = String(nodeId).split(":");
    return kind === "ext" ? null : id;
  };

  const addEdge = (source, target, kind, evidence) => {
    if (!source || !target || source === target) return false;

    // ★ 최신 데이터만 인용 — 시행예정본을 가리키는 관계는 만들지 않는다.
    //   소속(문서 내부 구조)은 신선도와 무관하므로 통과시킨다.
    if (kind !== "소속") {
      const td = docIdOf(target);
      if (td && !citable(td)) {
        blocked.push({ source, target, kind, evidence, 사유: "시행예정본" });
        return false;
      }
    }

    const key = `${source}|${target}|${kind}`;
    if (seenEdge.has(key)) return false;
    seenEdge.add(key);
    edges.push({ source, target, kind, evidence });
    return true;
  };

  const hasArticle = (doc, jo) => (doc.articles ?? []).some((a) => a.no === jo);
  const artId = (doc, jo) => `art:${doc.id}:${jo}`;
  /** 조문이 스냅샷에 있으면 조문 노드, 없으면 문서 노드로 떨어뜨린다 */
  const targetIdFor = (doc, jo) => (jo && hasArticle(doc, jo) ? artId(doc, jo) : `law:${doc.id}`);

  // ── 1) 노드 ──────────────────────────────────────────────────────────────
  for (const doc of docs) {
    const f = fresh.get(doc.id);
    // 확인일·시행일은 UI가 그대로 보여줘야 한다. 실무자가 근거로 쓰려면
    // "언제 기준 데이터인지"를 볼 수 있어야 한다.
    const stamp = { 확인일: f.확인일, 시행일: f.시행일, 상태: f.status, ...(f.stale ? { 낡음: true } : {}) };

    addNode({
      id: `law:${doc.id}`,
      kind: "법령",
      type: typeOf(doc),
      family: familyOf(doc),
      label: doc.shortName,
      name: doc.name,
      ...stamp,
    });
    for (const art of doc.articles ?? []) {
      addNode({
        id: artId(doc, art.no),
        kind: "조문",
        type: typeOf(doc),
        family: familyOf(doc),
        label: joLabel(art.no),
        title: art.title,
        text: art.text,
        lawId: doc.id,
        group: doc.shortName,
        ...stamp,
      });
      addEdge(`law:${doc.id}`, artId(doc, art.no), "소속");
    }
  }

  // ── 2) Layer 3 먼저: 행정규칙 제1조 → 위임근거 역파싱 ────────────────────
  // 정방향("장관이 정하는")은 대상이 없으므로, 역방향을 먼저 확정한 뒤
  // 정방향 위임문구와 대조해 매칭 여부를 감사한다.
  const 근거 = new Map(); // 행정규칙 id → { doc, jo, evidence }
  for (const doc of docs) {
    if (isLaw(doc)) continue;
    const first = (doc.articles ?? [])[0];
    if (!first) continue;
    const aliases = localAliases(doc);

    // 제1조(목적)에서 처음으로 해석되는 「법령」 제N조 인용이 곧 위임근거다.
    const re = new RegExp(String.raw`「([^」]+)」[^。\n]{0,40}?${JO}`, "g");
    let m;
    while ((m = re.exec(first.text)) !== null) {
      const target = resolveDoc(m[1]) ?? aliases.get(norm(m[1]));
      if (!target || !isLaw(target)) continue;
      const jo = joKey(m[2], m[3]);
      근거.set(doc.id, { doc: target, jo, evidence: m[0].trim() });
      break;
    }
  }

  // 역방향을 정방향 위임 엣지로 뒤집는다. 동시에 행정규칙의 family 를 상속시켜
  // 그래프에서 같은 법령군으로 물들게 한다.
  for (const [ruleId, g] of 근거) {
    const rule = byId.get(ruleId);
    addEdge(targetIdFor(g.doc, g.jo), `law:${ruleId}`, "위임", `근거: ${g.evidence}`);
    const fam = familyOf(g.doc);
    nodes.get(`law:${ruleId}`).family = fam;
    for (const art of rule.articles ?? []) nodes.get(artId(rule, art.no)).family = fam;
  }

  // ── 3) Layer 1 + 2: 문서별 스캔 ──────────────────────────────────────────
  const pendingAdminDelegation = []; // "장관이 정하는"인데 대응 행정규칙을 못 찾은 건

  for (const doc of docs) {
    const aliases = localAliases(doc);

    // 별칭 해석의 기준 문서.
    // 법령은 자기 자신이 기준이고, 행정규칙은 Layer 3 에서 도출한 위임근거 법령이 기준이다.
    // (예규가 "법률 제27조"라고만 써도, 근거가 국가계약법 시행령이면 그 법령군의 법률을 가리킨다)
    const ctx = isLaw(doc) ? doc : (근거.get(doc.id)?.doc ?? null);

    /** 별칭 문자열 → 대상 문서 */
    const byAlias = (word) => {
      const w = norm(word);
      if (aliases.has(w)) return aliases.get(w); // 문서가 스스로 정의한 별칭 우선
      if (!ctx) return null;
      if (w === "법" || w === "법률") return rootOf(ctx);
      if (w === "영" || w === "시행령") return siblingOfType(ctx, "시행령");
      if (w === "규칙" || w === "시행규칙") return siblingOfType(ctx, "시행규칙");
      return null;
    };

    for (const art of doc.articles ?? []) {
      if (art.structural) continue;
      const from = artId(doc, art.no);
      let text = art.text;

      // 3-a) 하위법령 위임 — "대통령령으로 정하는 바에 따라"
      if (isLaw(doc)) {
        for (const rule of DELEGATION_RULES) {
          if (!rule.re.test(text)) continue;
          const child = siblingOfType(doc, rule.childType);
          if (child) addEdge(from, `law:${child.id}`, "위임", `${rule.childType}에 위임`);
        }
      }

      // 3-b) 행정규칙 위임 — "○○장관이 정하는"
      // 대상이 텍스트에 없으므로, 이 조문을 근거로 지목한 행정규칙이 있는지 역으로 찾는다.
      // 매칭된 건은 역방향(Layer 3)에서 이미 엣지를 만들었으므로 중복 생성하지 않는다.
      const claimed = [...근거.values()].some((g) => g.doc.id === doc.id && g.jo === art.no);
      if (!claimed) {
        ADMIN_DELEGATION_RE.lastIndex = 0;
        const seenAuthority = new Set();
        let am;
        while ((am = ADMIN_DELEGATION_RE.exec(text)) !== null) {
          const authority = am[1] ?? "각 중앙관서의 장";
          if (seenAuthority.has(authority)) continue; // 한 조문에 같은 주체가 여러 번 나와도 1건
          seenAuthority.add(authority);
          pendingAdminDelegation.push({
            from,
            doc: doc.shortName,
            article: joLabel(art.no),
            authority,
            snippet: text.slice(Math.max(0, am.index - 30), am.index + 30).replace(/\n/g, " ").trim(),
          });
        }
      }

      // 3-c) 범위 인용 — "제64조내지 제66조"를 개별 조문으로 펼친 뒤 텍스트에서 제거
      RANGE_RE.lastIndex = 0;
      let rm;
      const blanks = [];
      while ((rm = RANGE_RE.exec(text)) !== null) {
        const [full, quoted, alias, a1, a2, b1, b2] = rm;
        const target = quoted ? (resolveDoc(quoted) ?? { external: true, name: quoted })
          : alias ? byAlias(alias)
          : doc;
        blanks.push([rm.index, rm.index + full.length]);
        if (!target || target.external) continue;
        const [lo, hi] = [Number(a1), Number(b1)].sort((x, y) => x - y);
        if (hi - lo > 100) continue; // 비정상 범위 방어
        for (let n = lo; n <= hi; n++) {
          const jo = n === Number(a1) ? joKey(a1, a2) : n === Number(b1) ? joKey(b1, b2) : String(n);
          if (target.id === doc.id && jo === art.no) continue;
          addEdge(from, targetIdFor(target, jo), "인용", full.trim());
        }
      }
      for (const [s, e] of blanks.reverse()) {
        text = text.slice(0, s) + " ".repeat(e - s) + text.slice(e);
      }

      // 3-d) 단건 인용 — 문맥(lastDoc)을 유지하며 순서대로
      let lastDoc = null;
      CITE_RE.lastIndex = 0;
      let m;
      while ((m = CITE_RE.exec(text)) !== null) {
        const [full, quoted, qJo, qJoB, sameKind, sJo, sJoB, alias, aJo, aJoB, bJo, bJoB] = m;
        let target = null;
        let jo = null;

        if (quoted !== undefined) {
          target = resolveDoc(quoted) ?? aliases.get(norm(quoted)) ?? { external: true, name: quoted };
          jo = qJo ? joKey(qJo, qJoB) : null;
          lastDoc = target;
        } else if (sameKind !== undefined) {
          // "같은 조"는 자기 조문 → 엣지 없음
          if (sameKind === "조") continue;
          target = lastDoc ?? byAlias(sameKind);
          jo = sJo ? joKey(sJo, sJoB) : null;
        } else if (alias !== undefined) {
          target = byAlias(alias);
          jo = joKey(aJo, aJoB);
          if (target) lastDoc = target;
        } else if (bJo !== undefined) {
          target = doc; // 표기 없는 "제N조" → 같은 문서
          jo = joKey(bJo, bJoB);
          if (jo === art.no) continue; // 자기 자신 제외
        }
        if (!target) continue;

        // 항·호까지 근거에 남긴다 (노드는 조문 단위 유지)
        const tail = text.slice(m.index + full.length).match(SUBUNIT_RE);
        const detail = tail
          ? [tail[1] && `제${tail[1]}항`, tail[2] && `제${tail[2]}호`, tail[3] && `${tail[3]}목`]
              .filter(Boolean)
              .join("")
          : "";

        let to;
        if (target.external) {
          addNode({
            id: extId(target.name),
            kind: "외부법",
            type: "외부",
            label: target.name,
            name: target.name,
          });
          to = extId(target.name);
        } else {
          to = targetIdFor(target, jo);
        }
        addEdge(from, to, "인용", (full.trim() + detail).trim());
      }
    }
  }

  // ── 4) 통계 · 감사 ───────────────────────────────────────────────────────
  const nodeArr = [...nodes.values()];
  const count = (k) => edges.filter((e) => e.kind === k).length;
  const adminDocs = docs.filter((d) => !isLaw(d));
  const linked = adminDocs.filter((d) => 근거.has(d.id));

  const 신선도 = freshnessReport(snapshot, { asOf, maxAgeDays });

  return {
    // 페이지가 "언제 기준 데이터인지" 항상 표시할 수 있도록 meta 에 박아 보낸다.
    meta: { ...snapshot.meta, 기준일: 신선도.기준일, 확인요약: {
      현행: 신선도.현행, 시행예정: 신선도.시행예정, 미확인: 신선도.미확인,
      최고경과일: 신선도.최고경과일, 낡음: 신선도.낡음.length,
    } },
    nodes: nodeArr,
    edges,
    stats: {
      documents: docs.length,
      nodes: nodeArr.length,
      articleNodes: nodeArr.filter((n) => n.kind === "조문").length,
      externalNodes: nodeArr.filter((n) => n.kind === "외부법").length,
      edges: edges.length,
      소속: count("소속"),
      위임: count("위임"),
      인용: count("인용"),
    },
    audit: {
      // ★ Phase 1 핵심 지표 — 행정규칙이 근거 조문에 자동 연결된 비율.
      //   이 숫자가 규칙기반 노선의 성패를 말해준다 (docs/scope.md §5.6).
      위임근거_커버리지: {
        행정규칙수: adminDocs.length,
        근거도출: linked.length,
        비율: adminDocs.length ? +(linked.length / adminDocs.length * 100).toFixed(1) : null,
        미도출: adminDocs.filter((d) => !근거.has(d.id)).map((d) => d.shortName),
      },
      근거목록: [...근거].map(([id, g]) => ({
        행정규칙: byId.get(id)?.shortName ?? id,
        근거: `${g.doc.shortName} ${joLabel(g.jo)}`,
        원문: g.evidence,
      })),
      // 규칙이 못 잡은 잔여 위임 — 사람이 확인해 seed 에 반영하는 대상
      미매칭_행정규칙위임: pendingAdminDelegation,
      // 법령 신선도 — 낡은 데이터를 최신인 것처럼 보여주지 않기 위한 근거
      신선도,
      // 시행예정본이라 끊어낸 관계 (조용히 버리지 않는다)
      신선도차단: blocked,
    },
  };
}

// CLI: `node src/extract.mjs [--json]`
if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync, existsSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");

  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const snapPath = join(root, "data/snapshot.json");
  const path = existsSync(snapPath) ? snapPath : join(root, "data/procurement-laws.json");

  const g = buildGraph(JSON.parse(readFileSync(path, "utf8")));

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(g.audit, null, 2));
  } else {
    console.log(`입력: ${path.replace(root, ".")}\n`);
    console.log("추출 결과:", JSON.stringify(g.stats, null, 2));

    const c = g.audit.위임근거_커버리지;
    console.log(`\n★ 위임근거 커버리지: ${c.근거도출}/${c.행정규칙수} (${c.비율 ?? "-"}%)`);
    for (const r of g.audit.근거목록) console.log(`  ✅ ${r.행정규칙}  ←  ${r.근거}`);
    for (const n of c.미도출) console.log(`  ❌ ${n} — 제1조에서 근거 조문 미검출`);

    const pend = g.audit.미매칭_행정규칙위임;
    if (pend.length) {
      console.log(`\n⚠️  미매칭 행정규칙 위임 ${pend.length}건 (사람 확인 대상, 상위 10건):`);
      for (const p of pend.slice(0, 10)) {
        console.log(`  · ${p.doc} ${p.article} — "${p.authority}이 정하는" … ${p.snippet}`);
      }
    }
  }
}

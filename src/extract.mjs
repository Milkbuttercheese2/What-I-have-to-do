// LawEverything — 규칙기반 법령 관계 추출기 (AI 없음)
//
// 입력:  data/procurement-laws.json 형태의 스냅샷
// 출력:  { nodes, edges, stats } — 위임/인용 그래프
//
// 두 종류의 관계를 순수 규칙(정규식 + 문맥 상태머신)으로 도출한다.
//   · 위임(DELEGATES): 법률 조문의 "대통령령/부령으로 정한다" → 하위 법령
//   · 인용(CITES)    : 「법명」 제N조 / 법 제N조 / 영 제N조 / 같은 법 제N조 / 제N조
//
// 런타임이 아니라 "온라인 빌드 단계"에서 1회 실행되어 정적 그래프를 굽는다.

/** 위임 문구 → 하위 법령 유형 매핑 */
const DELEGATION_RULES = [
  { re: /대통령령으로\s*정(?:한다|하는)/, childType: "시행령" },
  { re: /(?:총리령|부령|기획재정부령|행정안전부령)으로\s*정(?:한다|하는)/, childType: "시행규칙" },
];

/** 조문 안의 인용 표기를 왼→오른쪽 순서로 훑는 마스터 정규식 */
const CITE_RE =
  /「([^」]+)」\s*(?:제(\d+)조(?:의(\d+))?(?:제(\d+)항)?)?|같은\s*법\s*제(\d+)조|영\s*제(\d+)조|법\s*제(\d+)조|제(\d+)조/g;

const norm = (s) => s.replace(/\s+/g, "");
const extId = (name) => `ext:${norm(name)}`;

export function buildGraph(snapshot) {
  const laws = snapshot.laws;
  const byId = new Map(laws.map((l) => [l.id, l]));

  // 이름/약칭으로 스냅샷 내 법령 찾기 (없으면 null → 외부법)
  const resolveLaw = (name) => {
    const n = norm(name);
    for (const l of laws) {
      if (norm(l.name) === n || norm(l.shortName) === n) return l;
    }
    for (const l of laws) {
      if (n.includes(norm(l.shortName)) || norm(l.name).includes(n)) return l;
    }
    return null;
  };

  const rootLawOf = (law) => (law.type === "법률" ? law.id : law.parent);
  const childLaw = (rootId, childType) =>
    laws.find((l) => l.parent === rootId && l.type === childType) || null;

  const nodes = new Map();
  const edges = [];
  const seenEdge = new Set();

  const addNode = (node) => {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
    return nodes.get(node.id);
  };
  const addEdge = (source, target, kind, evidence) => {
    if (!source || !target || source === target) return;
    const key = `${source}|${target}|${kind}`;
    if (seenEdge.has(key)) return;
    seenEdge.add(key);
    edges.push({ source, target, kind, evidence });
  };

  // 1) 노드 생성: 법령 노드 + 조문 노드
  for (const law of laws) {
    addNode({
      id: `law:${law.id}`,
      kind: "법령",
      type: law.type,
      family: rootLawOf(law),
      label: law.shortName,
      name: law.name,
    });
    for (const art of law.articles) {
      const artId = `art:${law.id}:${art.no}`;
      addNode({
        id: artId,
        kind: "조문",
        type: law.type,
        family: rootLawOf(law),
        label: `제${art.no}조`,
        title: art.title,
        text: art.text,
        lawId: law.id,
        group: law.shortName,
      });
      // 소속 관계 (법령 → 조문)
      addEdge(`law:${law.id}`, artId, "소속");
    }
  }

  // 2) 관계 추출: 조문 텍스트 스캔
  for (const law of laws) {
    const rootId = rootLawOf(law);
    for (const art of law.articles) {
      const artId = `art:${law.id}:${art.no}`;

      // 2-a) 위임 — "~령으로 정한다"
      for (const rule of DELEGATION_RULES) {
        if (rule.re.test(art.text)) {
          const child = childLaw(rootId, rule.childType);
          if (child) addEdge(artId, `law:${child.id}`, "위임", rule.childType + "에 위임");
        }
      }

      // 2-b) 인용 — 문맥(lastLaw)을 유지하며 순서대로 파싱
      let lastLaw = null; // 직전에 명시된 법 (같은 법 해석용)
      CITE_RE.lastIndex = 0;
      let m;
      while ((m = CITE_RE.exec(art.text)) !== null) {
        const [full, quoted, qJo, , , sameJo, ryeongJo, beobJo, bareJo] = m;
        let targetLaw = null; // law 객체 또는 {external:true,name}
        let jo = null;

        if (quoted !== undefined) {
          const resolved = resolveLaw(quoted);
          targetLaw = resolved || { external: true, name: quoted };
          jo = qJo || null;
          lastLaw = targetLaw;
        } else if (sameJo !== undefined) {
          targetLaw = lastLaw; // "같은 법" → 직전 법
          jo = sameJo;
        } else if (ryeongJo !== undefined) {
          targetLaw = childLaw(rootId, "시행령"); // "영" → 같은 계열 시행령
          jo = ryeongJo;
        } else if (beobJo !== undefined) {
          targetLaw = byId.get(rootId); // "법" → 상위 법률
          jo = beobJo;
        } else if (bareJo !== undefined) {
          targetLaw = law; // 표기 없는 "제N조" → 같은 법령
          jo = bareJo;
          if (jo === art.no) continue; // 자기 자신 인용 제외
        }
        if (!targetLaw) continue;

        // 대상 노드 id 결정
        let targetId;
        if (targetLaw.external) {
          addNode({ id: extId(targetLaw.name), kind: "외부법", type: "외부", label: targetLaw.name, name: targetLaw.name });
          targetId = extId(targetLaw.name);
        } else if (jo && byId.get(targetLaw.id)?.articles.some((a) => a.no === jo)) {
          targetId = `art:${targetLaw.id}:${jo}`;
        } else {
          targetId = `law:${targetLaw.id}`;
        }
        addEdge(artId, targetId, "인용", full.trim());
      }
    }
  }

  const nodeArr = [...nodes.values()];
  const count = (k) => edges.filter((e) => e.kind === k).length;
  return {
    meta: snapshot.meta,
    nodes: nodeArr,
    edges,
    stats: {
      laws: laws.length,
      nodes: nodeArr.length,
      articleNodes: nodeArr.filter((n) => n.kind === "조문").length,
      externalNodes: nodeArr.filter((n) => n.kind === "외부법").length,
      edges: edges.length,
      소속: count("소속"),
      위임: count("위임"),
      인용: count("인용"),
    },
  };
}

// CLI: `node src/extract.mjs` → 통계 출력
if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import("node:fs");
  const url = new URL("../data/procurement-laws.json", import.meta.url);
  const snapshot = JSON.parse(readFileSync(url, "utf8"));
  const g = buildGraph(snapshot);
  console.log("추출 결과:", JSON.stringify(g.stats, null, 2));
  console.log("\n위임/인용 엣지:");
  for (const e of g.edges.filter((x) => x.kind !== "소속")) {
    console.log(`  [${e.kind}] ${e.source}  →  ${e.target}   ⟨${e.evidence}⟩`);
  }
}

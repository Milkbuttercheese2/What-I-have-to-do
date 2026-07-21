// LawEverything — 법령 신선도 판정
//
// 법령 도구에서 가장 위험한 실패는 "틀린 답"이 아니라 "낡은 답을 최신인 것처럼 보여주는 것"이다.
// 실무자가 근거로 쓰기 때문에 낡음은 항상 눈에 보여야 한다. 조용히 넘어가지 않는다.
//
// 서로 다른 두 가지를 구분한다 — 섞으면 판단을 그르친다:
//
//   1) 시행 상태 (현행 / 시행예정)
//      문서 자체의 성질. 시행일과 기준일만 비교하면 확정된다.
//      법제처는 시행예정 개정본을 별도 MST로 함께 제공하므로 섞여 들어올 수 있다.
//
//   2) 확인 신선도 (확인일로부터 며칠)
//      우리 스냅샷의 성질. 2026-07-21에 "현행"으로 확인한 문서가
//      2026-08-01에 개정됐을 수 있다 — 재수집 전에는 알 수 없다.
//      그래서 "현행"은 단정이 아니라 *확인일 시점의 주장*이며, 경과일을 함께 제시해야 한다.

/** 법제처 표기 "YYYYMMDD" → Date (UTC 정오 기준, 타임존 밀림 방지) */
export function parseYmd(s) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(s ?? "").trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function toYmd(date) {
  const d = new Date(date);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** ISO 문자열이든 YYYYMMDD든 Date로 */
export function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  const s = String(v);
  return /^\d{8}$/.test(s) ? parseYmd(s) : (Number.isNaN(Date.parse(s)) ? null : new Date(Date.parse(s)));
}

export const daysBetween = (a, b) => Math.floor((toDate(b) - toDate(a)) / 86400000);

/** 기본 신선도 임계 — 법령 개정 주기를 감안한 보수적 값 */
export const DEFAULT_MAX_AGE_DAYS = 45;

/**
 * 문서 하나의 신선도 판정.
 * verification 메타가 없는 문서(구 스키마·샘플)는 "미확인"으로 두고 아무것도 걸러내지 않는다.
 */
export function assess(doc, { asOf = new Date(), maxAgeDays = DEFAULT_MAX_AGE_DAYS } = {}) {
  const v = doc.verification ?? {};
  const 확인일 = toDate(v.확인일);
  const 시행일 = toDate(v.시행일 ?? doc.시행일);

  if (!확인일) {
    return { status: "미확인", 확인일: null, 시행일: v.시행일 ?? doc.시행일 ?? null, 경과일: null, stale: false, citable: true };
  }

  const 경과일 = Math.max(0, daysBetween(확인일, asOf));
  // 시행일이 기준일보다 미래면 아직 효력이 없다 — 현행 조문을 대체해선 안 된다.
  const 시행예정 = 시행일 ? toDate(시행일) > toDate(asOf) : false;

  return {
    status: 시행예정 ? "시행예정" : "현행",
    확인일: toYmd(확인일),
    시행일: 시행일 ? toYmd(시행일) : null,
    경과일,
    stale: 경과일 > maxAgeDays,
    // ★ 인용 대상 자격 — 시행예정본은 그래프의 인용 대상이 되지 않는다.
    //   "최신 데이터만 인용"의 실제 구현 지점.
    citable: !시행예정,
  };
}

/** 스냅샷 전체 신선도 리포트 */
export function report(snapshot, opts = {}) {
  const { asOf = new Date(), maxAgeDays = DEFAULT_MAX_AGE_DAYS } = opts;
  const docs = snapshot.documents ?? snapshot.laws ?? [];
  const rows = docs.map((d) => ({
    id: d.id,
    name: d.shortName ?? d.name,
    ...assess(d, { asOf, maxAgeDays }),
  }));

  const by = (s) => rows.filter((r) => r.status === s);
  const ages = rows.map((r) => r.경과일).filter((n) => n != null);

  return {
    기준일: toYmd(asOf),
    임계일수: maxAgeDays,
    문서수: rows.length,
    현행: by("현행").length,
    시행예정: by("시행예정").length,
    미확인: by("미확인").length,
    최고경과일: ages.length ? Math.max(...ages) : null,
    낡음: rows.filter((r) => r.stale).map((r) => ({ name: r.name, 확인일: r.확인일, 경과일: r.경과일 })),
    인용제외: by("시행예정").map((r) => ({ name: r.name, 시행일: r.시행일 })),
    rows,
  };
}

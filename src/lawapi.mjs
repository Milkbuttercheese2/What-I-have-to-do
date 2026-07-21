// LawEverything — 법제처 국가법령정보 오픈API 클라이언트 (빌드 단계 전용)
//
// 왜 MCP가 아니라 오픈API인가:
//   korean-law MCP는 에이전트 세션에서만 접근 가능해 build.mjs가 직접 호출할 수 없다.
//   무인 월간 재빌드를 하려면 빌드 스크립트가 스스로 데이터를 받아와야 한다.
//   (MCP는 탐색·검증용, 오픈API는 빌드용 — docs/scope.md §5.2)
//
// 인증: OC = 법제처에 등록한 이메일의 @ 앞부분. 환경변수 LAW_API_OC 로 주입한다.
//   키를 소스에 적지 말 것. .env.example 참조.

const BASE = "https://www.law.go.kr/DRF";

export class LawApiError extends Error {
  constructor(message, { url, status, body } = {}) {
    super(message);
    this.name = "LawApiError";
    this.url = url;
    this.status = status;
    this.body = body;
  }
}

function requireOC() {
  const oc = process.env.LAW_API_OC?.trim();
  if (!oc) {
    throw new LawApiError(
      "환경변수 LAW_API_OC 가 없습니다.\n" +
        "  법제처 오픈API 신청 후 발급받은 OC(이메일 @ 앞부분)를 지정하세요.\n" +
        "  예:  LAW_API_OC=hong  node src/collect.mjs\n" +
        "  또는 프로젝트 루트에 .env 를 만들고 LAW_API_OC=... (.env.example 참조)",
    );
  }
  return oc;
}

/** JSON 응답을 받되, 법제처가 오류를 HTML/텍스트로 주는 경우를 구분해 알린다. */
async function getJson(path, params) {
  const url = new URL(`${BASE}/${path}`);
  url.searchParams.set("OC", requireOC());
  url.searchParams.set("type", "JSON");
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, String(v));
  }

  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const body = await res.text();

  if (!res.ok) {
    throw new LawApiError(`HTTP ${res.status} — ${path}`, { url: url.href, status: res.status, body: body.slice(0, 300) });
  }
  // 인증 실패 시 법제처는 200 + HTML 안내페이지를 준다. JSON 파싱 실패로 잡는다.
  try {
    return JSON.parse(body);
  } catch {
    const hint = /OC|인증|등록|권한/.test(body)
      ? " (OC 인증 실패로 보입니다. 법제처에 등록한 이메일 앞부분이 맞는지, 해당 OC로 API 신청이 승인됐는지 확인하세요.)"
      : "";
    throw new LawApiError(`JSON 이 아닌 응답 — ${path}${hint}`, { url: url.href, status: res.status, body: body.slice(0, 300) });
  }
}

// ── 응답 정규화 ────────────────────────────────────────────────────────────
// 법제처 JSON은 target/버전에 따라 키 구조가 흔들린다(단일객체 vs 배열, 래퍼 유무).
// 스키마를 단정하지 않고 필요한 키를 재귀로 찾는다. 실패 시 조용히 넘어가지 않고 던진다.

/** 객체 트리에서 주어진 이름의 키를 깊이우선으로 찾아 첫 값을 반환 */
function findKey(obj, ...names) {
  const want = new Set(names);
  const stack = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (cur == null || typeof cur !== "object") continue;
    for (const [k, v] of Object.entries(cur)) {
      if (want.has(k)) return v;
      if (v && typeof v === "object") stack.push(v);
    }
  }
  return undefined;
}

const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

/** 문자열/배열/객체가 섞여 오는 본문 필드를 평평한 텍스트로 */
function flattenText(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(flattenText).filter(Boolean).join("\n");
  if (typeof v === "object") return Object.values(v).map(flattenText).filter(Boolean).join("\n");
  return String(v);
}

const clean = (s) =>
  String(s ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();

/**
 * 항·호·목 본문을 순서대로 이어붙인다.
 *
 * 응답 구조: 조문단위 → 항 → 호 → 목
 * 법령의 실질은 대부분 **호**에 있다 — "다음 각 호의 어느 하나에 해당하는 자"가 그렇다.
 * 항내용만 취하면 "다음 각 호의 …" 라고 해놓고 정작 각 호가 사라진다.
 * 부정당업자 제재사유, 수의계약 사유가 전부 호이므로 이걸 놓치면 본문이 껍데기가 된다.
 */
function mokText(mok) {
  return clean(flattenText(mok.목내용 ?? findKey(mok, "목내용") ?? ""));
}
function hoText(ho) {
  const parts = [clean(flattenText(ho.호내용 ?? findKey(ho, "호내용") ?? ""))];
  for (const mok of asArray(ho.목 ?? findKey(ho, "목"))) parts.push(mokText(mok));
  return parts.filter(Boolean).join("\n");
}
function paraText(p) {
  const parts = [clean(flattenText(p.항내용 ?? findKey(p, "항내용") ?? ""))];
  for (const ho of asArray(p.호 ?? findKey(p, "호"))) parts.push(hoText(ho));
  return parts.filter(Boolean).join("\n");
}

/**
 * 조문 단위 정규화.
 * 가지조문(제2조의2)은 no="2의2" 로 표기해 하나의 키로 다룬다.
 */
function normalizeArticles(raw) {
  const out = [];
  for (const a of asArray(raw)) {
    const no = clean(findKey(a, "조문번호") ?? "");
    if (!no) continue;
    const branch = clean(findKey(a, "조문가지번호") ?? "");
    // 조문여부="전문" 인 편/장/절 제목 행은 조문이 아니다
    const isArticle = clean(findKey(a, "조문여부") ?? "조문") !== "전문";

    const title = clean(findKey(a, "조문제목") ?? "");
    const head = clean(findKey(a, "조문내용") ?? "");
    const paras = asArray(a.항 ?? findKey(a, "항")).map(paraText).filter(Boolean);
    // 항 없이 조문 밑에 바로 호가 달리는 조문도 있다
    const bareHos = a.항 ? [] : asArray(a.호 ?? findKey(a, "호")).map(hoText).filter(Boolean);

    const text = [head, ...paras, ...bareHos].filter(Boolean).join("\n");
    if (!text) continue;

    out.push({
      no: branch && branch !== "0" ? `${no}의${branch}` : no,
      title: title || null,
      text,
      ...(isArticle ? {} : { structural: true }),
    });
  }
  return out;
}

/**
 * 별표 본문 복원.
 *
 * API는 별표를 **개행 없이 한 줄로** 준다. 원래 문서의 줄바꿈은 `,` 로 표시되고,
 * 표는 罫線 문자(│ ┌ ┬ ┐ ├ ┼ ┤ └ ┴ ┘ ─)로 그려져 있다. 즉 구조가 사라진 게 아니라
 * 인코딩되어 있을 뿐이다 — 복원이 가능하다.
 *
 * 줄바꿈 마커와 문장 쉼표를 가르는 기준(실측: 마커 4,132 / 문장 쉼표 3,865):
 *   앞 글자가 공백이나 罫線이면 줄 끝, 일반 글자면 문장 쉼표.
 *   ("…입찰       ,  참가자격…" 은 줄바꿈, "…줄일 수 있으며, 위반의…" 는 쉼표)
 *
 * **줄을 합치지 않는다.** 원문이 고정폭이라 단어 중간에서 줄이 바뀌는데,
 * 원래 그 자리에 공백이 있었는지는 패딩에 흡수되어 복원할 수 없다:
 *   "…등            ,  을 고려하여"      → 붙여야 맞고("등을")
 *   "…제재기간을               ,  2분의"  → 띄어야 맞다
 * 패딩 길이로도 구분되지 않으므로 어느 쪽으로 합쳐도 원문이 왜곡된다.
 * 줄바꿈을 그대로 두면 왜곡이 0이고, 법령 PDF와 같은 모양이라 실무자에게 익숙하다.
 * 검색은 공백·개행을 제거한 뒤 대조하므로("입찰참가자격제한기간") 영향이 없다.
 */
export function tidyAnnexText(raw) {
  if (!raw) return "";
  return String(raw)
    // 마커 뒤의 공백은 남긴다 — 그게 항목 계층 들여쓰기다 ("1. 일반기준" vs "    가. …")
    .replace(/(?<=[\s│┌┐└┘├┤┬┴─])[ \t]*,/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+$/, "")) // 오른쪽 패딩만 제거 (들여쓰기는 의미가 있다)
    .filter((l, i, a) => l.trim() || (a[i - 1]?.trim() && a[i + 1]?.trim())) // 빈 줄 연속 제거
    .join("\n")
    .trim();
}

/**
 * 별표·서식 정규화.
 *
 * 법령 본문 응답에 `별표단위`로 함께 온다 — 추가 호출이 필요 없다.
 * 그리고 본문이 **텍스트로 들어 있다**. HWP/PDF 파일 링크도 같이 오지만 파싱할 필요가 없다.
 * (국가계약법 시행규칙 [별표 2] 부정당업자 입찰참가자격 제한기준 = 13,022자)
 *
 * 조달 실무에서 가장 자주 찾는 표들이 여기 있는데 조문 검색만으로는 절대 안 걸린다.
 */
function normalizeAnnexes(raw) {
  const out = [];
  for (const b of asArray(raw)) {
    if (!b || typeof b !== "object") continue;
    const text = tidyAnnexText(clean(findKey(b, "별표내용") ?? ""));
    if (!text) continue;

    const no = clean(findKey(b, "별표번호") ?? "");
    const branch = clean(findKey(b, "별표가지번호") ?? "");
    const kind = clean(findKey(b, "별표구분") ?? "별표"); // 별표 | 서식
    const title = clean(findKey(b, "별표제목") ?? "");

    // 번호는 "0002" 처럼 0채움으로 온다 → "2"
    const n = String(Number(no) || no).replace(/^0+(?=\d)/, "");
    const key = branch && branch !== "00" ? `${n}의${Number(branch)}` : n;

    out.push({
      kind, // 별표 / 서식
      no: key,
      title: title || null,
      text,
      // 파일 링크는 참고용으로만 남긴다. 인증정보가 섞여 나오는 경우가 있어 OC 파라미터는 제거한다.
      files: {
        hwp: clean(findKey(b, "별표HWP파일명") ?? "") || null,
        pdf: clean(findKey(b, "별표PDF파일명") ?? "") || null,
      },
    });
  }
  return out;
}

// ── 공개 API ───────────────────────────────────────────────────────────────

/** 법령명으로 현행 MST 재확인. 개정되면 MST가 바뀌므로 수집 전 항상 부른다. */
export async function resolveCurrentMst(name) {
  const json = await getJson("lawSearch.do", { target: "law", query: name, display: 20 });
  const items = asArray(findKey(json, "law", "Law"));
  const norm = (s) => String(s).replace(/\s+/g, "");
  const hit =
    items.find((it) => norm(clean(findKey(it, "법령명한글") ?? "")) === norm(name)) ?? items[0];
  if (!hit) return null;
  return {
    mst: clean(findKey(hit, "법령일련번호", "법령MST") ?? "") || null,
    name: clean(findKey(hit, "법령명한글") ?? name),
    효력: clean(findKey(hit, "현행연혁코드") ?? ""),
    시행일: clean(findKey(hit, "시행일자") ?? ""),
  };
}

/** 법령 본문 조회 → { name, 시행일, articles[] } */
export async function fetchLaw({ mst, lawId }) {
  if (!mst && !lawId) throw new LawApiError("fetchLaw: mst 또는 lawId 가 필요합니다.");
  const json = await getJson("lawService.do", { target: "law", MST: mst, ID: lawId });

  const articles = normalizeArticles(findKey(json, "조문단위"));
  if (articles.length === 0) {
    throw new LawApiError(`법령 본문에서 조문을 찾지 못했습니다 (MST=${mst}). 응답 스키마 확인 필요.`, {
      body: JSON.stringify(json).slice(0, 400),
    });
  }
  return {
    name: clean(findKey(json, "법령명_한글", "법령명한글") ?? ""),
    시행일: clean(findKey(json, "시행일자") ?? ""),
    공포일: clean(findKey(json, "공포일자") ?? ""),
    articles,
    annexes: normalizeAnnexes(findKey(json, "별표단위")),
  };
}

/**
 * 행정규칙 본문 조회 → { name, articles[] }
 * 행정규칙은 조문 구조가 법령만큼 정형화되어 있지 않아, 조문단위가 없으면
 * 본문 텍스트를 "제N조(제목)" 경계로 직접 쪼갠다.
 */
export async function fetchAdminRule({ seq, ruleId }) {
  if (!seq && !ruleId) throw new LawApiError("fetchAdminRule: seq 또는 ruleId 가 필요합니다.");
  const json = await getJson("lawService.do", { target: "admrul", ID: seq ?? ruleId });

  let articles = normalizeArticles(findKey(json, "조문단위"));
  if (articles.length === 0) {
    const body = clean(flattenText(findKey(json, "조문내용", "행정규칙내용", "본문")));
    articles = splitArticlesFromText(body);
  }
  if (articles.length === 0) {
    throw new LawApiError(`행정규칙 본문에서 조문을 찾지 못했습니다 (ID=${seq ?? ruleId}).`, {
      body: JSON.stringify(json).slice(0, 400),
    });
  }
  return {
    name: clean(findKey(json, "행정규칙명") ?? ""),
    발령일: clean(findKey(json, "발령일자", "공포일자") ?? ""),
    annexes: normalizeAnnexes(findKey(json, "별표단위")),
    articles,
  };
}

/**
 * 평문에서 조문 추출 — 행정규칙 폴백 경로.
 * "제12조의2(제목) 본문..." 형태를 경계로 자른다. 부칙 이후는 버린다.
 */
export function splitArticlesFromText(text) {
  if (!text) return [];
  const body = text.split(/\n\s*부\s*칙\s*(?:<|\n)/)[0];
  const re = /^제(\d+)조(?:의(\d+))?\s*[（(]([^）)]*)[）)]/gm;

  const marks = [];
  let m;
  while ((m = re.exec(body)) !== null) {
    marks.push({ no: m[2] ? `${m[1]}의${m[2]}` : m[1], title: m[3].trim(), start: m.index });
  }
  return marks.map((mark, i) => ({
    no: mark.no,
    title: mark.title || null,
    text: body.slice(mark.start, i + 1 < marks.length ? marks[i + 1].start : undefined).trim(),
  }));
}

// 몇 조항이더라 — 법제처 국가법령정보 오픈API 클라이언트 (빌드 단계 전용)
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
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    const hint = /OC|인증|등록|권한/.test(body)
      ? " (OC 인증 실패로 보입니다. 법제처에 등록한 이메일 앞부분이 맞는지, 해당 OC로 API 신청이 승인됐는지 확인하세요.)"
      : "";
    throw new LawApiError(`JSON 이 아닌 응답 — ${path}${hint}`, { url: url.href, status: res.status, body: body.slice(0, 300) });
  }

  // ...그런데 **유효한 JSON 으로** 인증 실패를 주는 경로도 있다:
  //   { "result": "사용자 정보 검증에 실패하였습니다.", "msg": "...IP주소 및 도메인주소를 등록해 주세요." }
  // HTTP 200 + 파싱 성공이라 위 그물을 그대로 빠져나간다. 그러면 열거 API 는 빈 배열을 반환하고
  // 수집기는 "0/0종 → 신규 0종" 만 찍고 성공으로 끝난다 — 아무것도 못 받았는데 성공처럼 보인다.
  // 조용한 실패는 이 도구에서 가장 위험한 실패다(AGENTS.md 원칙 6). 여기서 끊는다.
  if (json && typeof json.result === "string") {
    throw new LawApiError(
      `법제처가 요청을 거부했습니다 — ${path}\n  ${json.result}` +
        (json.msg ? `\n  ${json.msg}` : "") +
        "\n  · OC 는 법제처에 등록한 이메일의 @ 앞부분입니다(예: hong). 서비스키·UUID 가 아닙니다." +
        "\n  · 오픈API 신청 시 등록한 서버 IP/도메인에서만 호출이 허용됩니다.",
      { url: url.href, status: res.status, body: body.slice(0, 300) },
    );
  }
  return json;
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
  // 응답의 링크는 "/LSW/flDownload.do?flSeq=..." 형태의 상대경로다.
  const abs = (p) => {
    const s = clean(p ?? "");
    return s ? (/^https?:/.test(s) ? s : `https://www.law.go.kr${s}`) : null;
  };
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
      // 원본 파일 링크.
      //
      // `별표HWP파일명`/`별표PDF파일명` 을 읽고 있었는데 그건 **파일명일 뿐이고 3%에만 있다**.
      // 실제 내려받을 수 있는 경로는 `별표서식파일링크`(HWP)·`별표서식PDF파일링크`(PDF) 이고
      // 이쪽은 100% 온다(실측: 국가계약법 시행규칙 20/20).
      // 罫線 텍스트 복원이 깨지는 별표는 결국 원본을 봐야 하므로 이 링크가 생명줄이다.
      files: {
        hwp: abs(findKey(b, "별표서식파일링크")),
        pdf: abs(findKey(b, "별표서식PDF파일링크")),
        images: String(clean(findKey(b, "별표서식이미지파일링크") ?? ""))
          .split(",").map((s) => abs(s)).filter(Boolean),
        // 파일명도 같이 남긴다 — 내려받을 때 사람이 알아볼 이름이 된다.
        hwpName: clean(findKey(b, "별표HWP파일명") ?? "") || null,
        pdfName: clean(findKey(b, "별표PDF파일명") ?? "") || null,
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
    ...소관정보(json),
  };
}

/**
 * 소관부처·담당부서·연락처.
 *
 * 화면에 "이 법이 누구 소관인지"가 없으면 실무자는 어디에 물어야 할지를 모른다.
 * 다행히 기본정보에 전부 들어 있다(실측: 국가계약법 → 재정경제부 / 계약정책과 /
 * 044-215-5211). 연락부서는 여럿 올 수 있어(소관부처 + 조달청 등) 전부 담되
 * 대표 한 곳을 앞세운다.
 */
function 소관정보(json) {
  // findKey 는 깊이우선이라 `연락부서.부서단위[].소관부처명` 이 먼저 잡힐 수 있다.
  // 기본정보의 값을 명시 경로로 먼저 집는다.
  const 기본 = json?.법령?.기본정보 ?? null;
  const 부처 = (기본 && 기본.소관부처) ?? findKey(json, "소관부처");
  const name = clean(typeof 부처 === "object" ? findKey(부처, "content") ?? "" : 부처 ?? "");
  const code = clean(typeof 부처 === "object" ? findKey(부처, "소관부처코드") ?? "" : "");

  const 부서 = asArray((기본 && 기본.연락부서 && 기본.연락부서.부서단위) ?? findKey(json, "부서단위"))
    .map((d) => ({
      부서명: clean(findKey(d, "부서명") ?? ""),
      연락처: clean(findKey(d, "부서연락처") ?? ""),
      소관부처: clean(findKey(d, "소관부처명") ?? ""),
    }))
    .filter((d) => d.부서명 || d.연락처);

  const out = {};
  if (name) out.소관부처 = name;
  if (code) out.소관부처코드 = code;
  if (부서.length) out.연락부서 = 부서;
  const 약칭 = clean(findKey(json, "법령명약칭") ?? "");
  if (약칭) out.약칭 = 약칭;
  return out;
}

/**
 * 행정규칙 본문 조회 → { name, articles[] }
 * 행정규칙은 조문 구조가 법령만큼 정형화되어 있지 않아, 조문단위가 없으면
 * 본문 텍스트를 "제N조(제목)" 경계로 직접 쪼갠다.
 */
export async function fetchAdminRule({ seq, ruleId }) {
  if (!seq && !ruleId) throw new LawApiError("fetchAdminRule: seq 또는 ruleId 가 필요합니다.");
  const json = await getJson("lawService.do", { target: "admrul", ID: seq ?? ruleId });

  const name = clean(findKey(json, "행정규칙명") ?? "");
  let articles = normalizeArticles(findKey(json, "조문단위"));
  let bodyText = "";
  if (articles.length === 0) {
    bodyText = clean(flattenText(findKey(json, "조문내용", "행정규칙내용", "본문")));
    articles = splitArticlesFromText(bodyText);
  }

  const annexes = normalizeAnnexes(findKey(json, "별표단위"));

  // ★ "무조건 다 와야 한다": 조문 구조가 없는 문서(공고·고시·별표전용)도 버리지 않는다.
  //   통짜 본문이 있으면 단일 조문으로, 그마저 없으면 별표 참조 스텁으로 노드를 남긴다.
  //   스텁 제목은 collectByulpyo 로 뽑는다 — normalizeAnnexes 는 본문 없는 별표(HWP/PDF 링크만
  //   있는 서식)를 버리므로, 그것만으로는 별표전용 문서가 "(본문 없음)" 으로 뭉개진다.
  if (articles.length === 0) {
    const refs = collectByulpyo(json).map((a) => a.title).filter(Boolean).join(", ");
    const text = bodyText || (refs ? `(본문 없음 — 별표/서식 참조: ${refs})` : "(본문 없음)");
    articles = [{ no: "1", title: name || null, text, ...(bodyText ? {} : { 별표전용: true }) }];
  }

  return {
    name,
    발령일: clean(findKey(json, "발령일자", "공포일자") ?? ""),
    annexes,
    articles,
    // ★ 시행일·효력을 여기서 읽지 않아 행정규칙 307건 **전부**(전체 문서의 95.9%)가
    //   신선도 판정 없이 지나가고 있었다. "낡음은 항상 눈에 보여야 한다"(원칙 6)가
    //   문서 대부분에서 무력했다는 뜻이다.
    시행일: clean(findKey(json, "시행일자") ?? "") || null,
    효력: clean(findKey(json, "현행연혁코드", "효력") ?? "") || null,

    // 소관부처는 `상위부처명` 을 쓴다. `소관부처명` 은 8건(2.6%)이 부서명으로 오염돼
    // 있다(`조달등록팀` 등). 상위부처명은 307/307 정상.
    ...(clean(findKey(json, "상위부처명") ?? "") ? { 소관부처: clean(findKey(json, "상위부처명")) } : {}),
    ...(clean(findKey(json, "담당부서기관명") ?? "") || clean(findKey(json, "전화번호") ?? "")
      ? {
          연락부서: [
            {
              부서명: clean(findKey(json, "담당부서기관명") ?? ""),
              연락처: clean(findKey(json, "전화번호") ?? ""),
              소관부처: clean(findKey(json, "상위부처명") ?? ""),
            },
          ],
        }
      : {}),
    // 담당자 실명은 인사이동으로 부서보다 훨씬 빨리 낡는다. 담되 화면 기본 표기에서는 뺀다.
    ...(clean(findKey(json, "담당자명") ?? "") ? { 담당자: clean(findKey(json, "담당자명")) } : {}),
  };
}

/**
 * 별표·서식 수집.
 * - 표 내용(별표내용)이 배열로 오면 행렬로 정규화해 리더에서 테이블로 렌더한다.
 * - 실제 서식은 대개 HWP/PDF 파일이라 링크도 남긴다(kordoc 파싱 대상).
 */
function collectByulpyo(json) {
  const abs = (p) => (p ? `https://www.law.go.kr${clean(p)}` : null);
  const out = [];
  for (const b of asArray(findKey(json, "별표단위"))) {
    const hwp = abs(findKey(b, "별표서식파일링크"));
    const pdf = abs(findKey(b, "별표서식PDF파일링크"));
    const rows = normalizeTable(findKey(b, "별표내용"));
    if (!hwp && !pdf && rows.length === 0) continue;
    out.push({
      title: clean(findKey(b, "별표제목") ?? ""),
      번호: clean(findKey(b, "별표번호") ?? ""),
      구분: clean(findKey(b, "별표구분") ?? ""),
      rows,
      hwp,
      pdf,
    });
  }
  return out;
}

/** 별표내용을 2차원 문자열 배열(행×열)로 정규화. 문자열/1차원/2차원을 모두 받는다. */
function normalizeTable(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    if (raw.length && raw.every((r) => Array.isArray(r))) {
      return raw.map((r) => r.map((c) => clean(flattenText(c)))).filter((r) => r.some(Boolean));
    }
    return raw.map((r) => [clean(flattenText(r))]).filter((r) => r[0]);
  }
  const s = clean(flattenText(raw));
  return s ? [[s]] : [];
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

/**
 * 소관부처(org)별 행정규칙 전수 열거 — 페이지네이션.
 *
 * seed.json 수기 나열의 한계("쿼리당 20건")를 넘는다. 목록 API는 display 최대 100 +
 * page 로 넘길 수 있어, 소관부처 기준 완전열거가 실제로 가능하다.
 * (조달청 org=1230000 → 훈령·예규·지침·고시·공고 전부. docs/scope.md §5.3)
 *
 *   const { total, items } = await searchAdminRules({ org: "1230000" });
 *
 * @param {object}   opts
 * @param {string}   opts.org      소관부처 코드 (예: 조달청 "1230000")
 * @param {string}  [opts.query]   추가 검색어(선택)
 * @param {string[]}[opts.kinds]   포함할 행정규칙종류. null 이면 전부.
 * @param {number}  [opts.max]     안전 상한
 * @returns {Promise<{total:number, items:Array}>}
 */
export async function searchAdminRules({ org, query, kinds = null, max = 5000 } = {}) {
  const display = 100;
  const seen = new Set();
  const items = [];
  let page = 1;
  let total = 0;

  for (;;) {
    const json = await getJson("lawSearch.do", { target: "admrul", org, query, display, page });
    total = Number(clean(findKey(json, "totalCnt") ?? total)) || total;
    const rows = asArray(findKey(json, "admrul"));
    if (rows.length === 0) break;

    for (const it of rows) {
      const seq = clean(findKey(it, "행정규칙일련번호") ?? "");
      if (!seq || seen.has(seq)) continue;
      const kind = clean(findKey(it, "행정규칙종류") ?? "");
      if (kinds && !kinds.includes(kind)) continue;
      seen.add(seq);
      items.push({
        seq,
        ruleId: clean(findKey(it, "행정규칙ID") ?? ""),
        name: clean(findKey(it, "행정규칙명") ?? ""),
        kind,
        시행일: clean(findKey(it, "시행일자") ?? ""),
        소관: clean(findKey(it, "소관부처명") ?? ""),
      });
      if (items.length >= max) return { total, items };
    }

    if (rows.length < display || seen.size >= total) break;
    page += 1;
  }
  return { total, items };
}

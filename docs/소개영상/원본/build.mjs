// 소개영상 타임라인 — 내레이션 길이(durations.json)로 큐(T.id)를 정하고 그 위에 화면 사건을 얹어 timeline.js·cues.json 을 쓴다.
// 장면 엔진(index.html)과 사건 형식은 '조달법령 흐름도' 시연 영상(koneps-flow docs/시연)과 같다. 실행: node build.mjs
// v3.8.7 시나리오 "디지털조달관리과 김정보 주무관의 하루"(전자입찰 장애 대응) — 장(①~⑧)마다 알약 제목 → 창 → 문장마다 한 동작.
import { readFileSync, writeFileSync } from "node:fs";
import { LINES } from "./script.mjs";
const SHOTS = JSON.parse(readFileSync("shots.json", "utf8"));
let DUR = {}; try { DUR = JSON.parse(readFileSync("durations.json", "utf8")); } catch {}
const dur = (id, say) => DUR[id] ?? Math.max(2.4, say.length * 0.1 + 0.6);
const GAP = .5;
/* 동작(클릭·화면 전환)이 문장 끝에 붙는 곳은 조금 더 머문다 */
const HOLD = { o2: .6, m1: .4, c1: .8, c2: .6, c3: .6, f1: .5, f3: .5, f4: .6, f5: .6, n1: .4, n2: .6, d0: .6, d1: .6, d2: .8, d2b: .6, d3: .6, d4: .6, s1: .5, s2: 1.0, s3: .5, p1: .6, p2: .4, k1: .3, k2: .6, e1: 1.4 };
const T = {}; const CAPS = []; let clock = .8;
for (const [id, say, cap] of LINES) { T[id] = clock; const d = dur(id, say); CAPS.push([clock - .05, clock + d + .15, cap]); clock += d + GAP + (HOLD[id] || 0); }
const TOTAL = clock + 2.6;

const E = []; const at = (t, o) => E.push({ b: t, ...o });
const WIDE = "full";
const chapter = (id, title, w, next, shot, cam = WIDE) => {
  at(T[id] - .15, { shape: w, label: title, ring: null, cam: WIDE });
  at(T[id] + .9, { cur: [960, 590], stage: true, lead: .1 });
  at(T[next] - .2, { shape: "window", label: "", shot, hard: true, cam, click: true });
};
const ZOOM_LEFT = [0, 60, 1300, 731];
const FORM = [380, 0, 1160, 653];

// 오프닝 — 출근, 컴퓨터를 켜면 함께 열린다
at(0, { label: "오전 9시, 출근" });
at(T.o2 - .1, { shape: "window", label: "", shot: "board", hard: true, cam: WIDE });

// ① 아침, 오늘 할 일
chapter("ch1", "① 아침, 오늘 할 일", 600, "m1", "board", WIDE);
at(T.m1 + .1, { ring: "board", tag: "담당자 · 시각으로 다섯 칸", cur: [960, 560] });
at(T.m1 + 4.4, { ring: "colMe", tag: "내가 할 일", cam: [200, 160, 1280, 720], cur: "colMe" });
at(T.m1 + 6.2, { ring: "colOth", tag: "맡긴 일", cur: "colOth" });
at(T.m2 - .1, { ring: "metrics", tag: "한눈 요약", cam: [0, 90, 1100, 619], cur: "metrics" });

// ② 전자입찰 장애 → 업체 전화를 받으며 빠른 메모
chapter("ch2", "② 오후 3시 반, 전자입찰 장애", 700, "c1", "board", WIDE);
at(T.c1 + dur("c1", "") * .58, { shot: "mini-memo", hard: true, ring: "frame", tag: "빠른 메모 창 · Ctrl+Alt+Space", cam: [380, 110, 1160, 653], cur: "inp" });
at(T.c2 - .1, { shot: "mini-at", ring: "pb", tag: "전화번호부에서 찾기", cur: "pb" });
at(T.c2 + 3.4, { click: true });
at(T.c3 - .1, { ring: null, cam: WIDE });
at(T.c3 + 1.6, { shot: "board-new", hard: true, ring: "card", tag: "분류 대기 + 관련인 자동", cam: ZOOM_LEFT, cur: "card" });

// ③ 업무로 다듬기
chapter("ch3", "③ 업무로 다듬기", 520, "f1", "board-new", ZOOM_LEFT);
at(T.f1 + .1, { ring: "card", tag: "", cur: "card" });
at(T.f1 + 1.0, { click: true });
at(T.f1 + 1.15, { shot: "form-new", hard: true, ring: "panel", tag: "", cam: FORM, cur: [1300, 700] });
at(T.f2 - .1, { shot: "form-sub", ring: "subs", tag: "점검 시각 · 담당", cam: [380, 120, 1160, 653], cur: "subs" });
at(T.f2 + 2.6, { ring: "save", tag: "", cur: "save" });
at(T.f2 + 3.4, { click: true });
at(T.f3 - .1, { shot: "board-moved", hard: true, ring: "card", tag: "오늘 처리 칸으로", cam: ZOOM_LEFT, cur: "card" });
at(T.f4 - .1, { shot: "merge", hard: true, ring: "target", tag: "끌어서 하나로", cam: [0, 120, 1100, 619], cur: [400, 760] });
/* v3.8.19 f5 — 탐색기에서 끌어 온 보고서를 양식 위에 놓는다(커서가 화면 밖에서 링크 칸으로) → 링크 줄이 생김 */
const FILES_CAM = [380, 430, 1160, 653];
at(T.f5 - .1, { shot: "form-drop", hard: true, ring: "files", tag: "탐색기에서 끌어 놓기", cam: FILES_CAM, cur: [1560, 1060], lead: .05 });
at(T.f5 + 1.4, { cur: "files" });
at(T.f5 + 3.2, { click: true });
at(T.f5 + 3.4, { shot: "form-linked", ring: "row", tag: "링크로 붙음", cur: "row" });

// ④ 알림과 업무 종료
chapter("ch4", "④ 시각이 되면", 520, "n1", "alarm", WIDE);
at(T.n1 + .2, { ring: "alarm", tag: "시각 도래 알림", cam: [460, 220, 1000, 563], cur: [1240, 640] });
at(T.n2 - .1, { shot: "form-finish", hard: true, ring: "finish", tag: "", cam: [760, 520, 1000, 563], cur: "finish" });
at(T.n2 + 2.8, { click: true });
at(T.n2 + 3.0, { shot: "finished", hard: true, ring: "metrics", tag: "오늘 완료 +1", cam: [0, 80, 1100, 619], cur: [700, 300] });
at(T.n2 + 5.6, { ring: "toast", tag: "실행 취소", cam: WIDE, cur: "toast" });

// ⑤ 문서 탭
chapter("ch5", "⑤ 문서도 이 안에서", 600, "d0", "form-docbtn", FILES_CAM);
/* v3.8.19 d0 — 양식 링크 옆 [문서] → 문서 탭, 왼쪽 목록에서 그 파일 줄이 초록 */
at(T.d0 + .2, { ring: "doc", tag: "문서 단추", cur: "doc" });
at(T.d0 + 3.4, { click: true });
at(T.d0 + 3.6, { shot: "docs-reveal", hard: true, ring: "reveal", tag: "어느 폴더의 파일인지 초록으로", cam: [0, 60, 1100, 619], cur: "reveal" });
at(T.d1 - .1, { shot: "docs-search", hard: true, ring: "search", tag: "문서 찾기", cam: [900, 0, 1020, 574], cur: "search" });
at(T.d1 + 3.0, { ring: "hits", tag: "이름 · 내용까지", cam: [0, 60, 1100, 619], cur: "hit0" });
at(T.d2 - .1, { shot: "docs-hwp", hard: true, ring: "page", tag: "한컴오피스 없이 · 쪽 모양 그대로", cam: [380, 120, 1160, 653], cur: "file" });
/* v3.8.19 d2b — 한글 쪽의 글자를 끌어 고르고, PDF 에서도 똑같이 */
at(T.d2b - .1, { shot: "docs-hwp-sel", ring: "sel", tag: "끌어 골라 복사", cur: "sel" });
at(T.d2b + dur("d2b", "") * .6, { shot: "docs-pdf-sel", hard: true, ring: "sel", tag: "PDF도 똑같이", cur: "sel" });
at(T.d3 - .1, { shot: "docs-csv", hard: true, ring: "table", tag: "표 그대로 고치기", cam: [380, 120, 1160, 653], cur: "table" });
at(T.d3 + dur("d3", "") * .5, { shot: "docs-sql", ring: "code", tag: "VS Code 색", cur: "code" });
at(T.d4 - .1, { shot: "docs-dock", hard: true, ring: "form", tag: "보면서 메모", cam: [700, 60, 1220, 686], cur: "memo" });
/* v3.8.19 d4 — 메모 칸 접기 → 문서가 넓어지고 오른쪽에 '‹ 메모' 띠만 */
/*   양식을 닫은 문서 화면(docs-sql — 메모 칸이 보인다)에서 메모 칸 머리의 › (#dn-fold, 화면 좌표 ≈ 1689,169) 를 누른다 */
const FOLD_BTN = [1687, 167, 24, 24];
at(T.d4 + dur("d4", "") * .48, { shot: "docs-sql", hard: true, ring: FOLD_BTN, tag: "접기", cam: [700, 60, 1220, 686], cur: FOLD_BTN });
at(T.d4 + dur("d4", "") * .48 + 1.0, { click: true });
at(T.d4 + dur("d4", "") * .48 + 1.2, { shot: "docs-fold", hard: true, ring: "rail", tag: "메모 칸 접기", cam: [300, 60, 1620, 911], cur: "rail" });

// ⑥ 다시 찾기
chapter("ch6", "⑥ 며칠 뒤, 다시 찾기", 600, "s1", "mini-search", [380, 110, 1160, 653]);
at(T.s1 + .2, { ring: "results", tag: "진행 · 완료 함께 검색", cur: "results" });
at(T.s2 - .1, { shot: "cal", hard: true, ring: "detail", tag: "하루 시간표", cam: [860, 90, 1060, 596], cur: "chip0" });
at(T.s2 + 3.6, { click: true });
at(T.s2 + 3.8, { shot: "cal-new", hard: true, ring: "subs", tag: "그 시각으로 새 업무", cam: FORM, cur: "subs" });
/* v3.8.19 s3 — 달력 띠의 ‹ 로 지난달(목록도 그 달 것만) → 날짜를 누르면 그날만 */
at(T.s3 - .1, { shot: "done", hard: true, ring: "strip", tag: "달력 띠", cam: [900, 40, 1020, 574], cur: "prev" });
at(T.s3 + 1.6, { click: true });
at(T.s3 + 1.8, { shot: "done-prev", hard: true, ring: "list", tag: "지난달 끝낸 일", cam: [200, 40, 1500, 844], cur: "prev" });
at(T.s3 + dur("s3", "") * .5, { ring: "day", tag: "", cur: "day" });
at(T.s3 + dur("s3", "") * .5 + 1.2, { click: true });
at(T.s3 + dur("s3", "") * .5 + 1.4, { shot: "done-day", hard: true, ring: "list", tag: "그날 끝낸 일", cur: "day" });

// ⑦ 사람으로 찾기 · 담당자 교체
chapter("ch7", "⑦ 사람으로 찾기", 520, "p1", "phone-side", [100, 40, 1500, 844]);
at(T.p1 + .2, { ring: "row", tag: "", cur: "row" });
at(T.p1 + 1.4, { click: true });
at(T.p1 + 1.6, { ring: "side", tag: "관련 업무 · 진행/완료", cam: [800, 40, 1100, 619], cur: "side" });
at(T.p2 - .1, { shot: "phone-swap", hard: true, ring: "swap", tag: "바꾸기", cam: [400, 40, 1400, 788], cur: "swap" });
at(T.p2 + 1.6, { click: true });
at(T.p2 + 1.8, { shot: "swap", hard: true, ring: "sum", tag: "완료 업무까지 한 번에", cam: [260, 0, 1400, 788], cur: "go" });

// ⑧ 내 PC 안에서
chapter("ch8", "⑧ 데이터는, 내 PC 안에", 640, "k1", "settings-top", [420, 40, 1080, 608]);
at(T.k1 + .2, { ring: "theme", tag: "밝게 · 어둡게", cur: "theme" });
at(T.k1 + 1.8, { shot: "board-dark", hard: true, ring: null, cam: WIDE, cur: [1500, 600] });
at(T.k2 - .1, { shot: "settings-data", hard: true, ring: "data", tag: "백업 · 복원", cam: [420, 300, 1080, 608], cur: "bk" });

// 마무리
at(T.e1 - .15, { shape: 760, label: "던져두기 · 정리 · 이어보기", ring: null, cam: WIDE, cur: [1760, 960], stage: true });
at(T.e2 - .15, { shape: 460, label: "뭐하려 했더라", ring: null, cam: WIDE, cur: [1760, 960], stage: true });

const endCards = [[T.e1 + .2, "던져두기", "떠오른 일을<br>잊기 전에 한 줄로", T.e2 - .2, 333], [T.e1 + 1.4, "정리", "시각 · 담당자로<br>저절로 제 칸에", T.e2 - .2, 760], [T.e1 + 2.6, "이어보기", "검색 · 문서 · 시간표로<br>다시 찾기", T.e2 - .2, 1187]];
const STAGE = { cards: endCards, ask: [1e6, ""], out: 1e6 };
writeFileSync("timeline.js", `const SHOTS=${JSON.stringify(SHOTS)};\nconst TIMELINE=${JSON.stringify(E.sort((a, b) => a.b - b.b))};\nconst CAPTIONS=${JSON.stringify(CAPS)};\nconst LOADER=[1e6,1e6,1e6];\nconst BTN_W=380;\nconst TOTAL=${TOTAL};\nconst STAGE=${JSON.stringify(STAGE)};\n`);
writeFileSync("cues.json", JSON.stringify({ T, TOTAL, clicks: E.filter((e) => e.click).map((e) => e.b), morphs: E.filter((e) => e.shape).map((e) => e.b) }, null, 1));
console.log("총 길이", TOTAL.toFixed(1), "초, 사건", E.length, "자막", CAPS.length);

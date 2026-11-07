// 소개영상 타임라인 — 내레이션 길이(durations.json)로 큐(T.id)를 정하고 그 위에 화면 사건을 얹어 timeline.js·cues.json 을 쓴다.
// 장면 엔진(index.html)과 사건 형식은 '조달법령 흐름도' 시연 영상(koneps-flow docs/시연)과 같다. 실행: node build.mjs
// v3 시나리오 "서비스계약과 박조달 주무관의 하루" — 장(①~⑧)마다 알약 제목 → 창 → 문장마다 한 동작.
import { readFileSync, writeFileSync } from "node:fs";
import { LINES } from "./script.mjs";
const SHOTS = JSON.parse(readFileSync("shots.json", "utf8"));
let DUR = {}; try { DUR = JSON.parse(readFileSync("durations.json", "utf8")); } catch {}
const dur = (id, say) => DUR[id] ?? Math.max(2.4, say.length * 0.1 + 0.6);
const GAP = .5;
/* 동작(클릭·화면 전환)이 문장 끝에 붙는 곳은 조금 더 머문다 */
const HOLD = { o2: .6, m1: .4, m3: .5, c1: .8, c2: .6, c3: .6, f1: .5, f3: .5, f4: .9, f6: .4, f7: .6, n1: .4, n2: .8, n3: .6, n4: .5, s1: .5, s2: .5, s3: 1.2, s4: .4, p1: .9, p2: .4, k1: .3, k2: .5, d1: .6, d2: .6, e1: 1.4 };
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

// 오프닝 — 출근, 컴퓨터를 켜면 함께 열린다
at(0, { label: "오전 9시, 출근" });
at(T.o2 - .1, { shape: "window", label: "", shot: "board", hard: true, cam: WIDE });

// ① 아침, 오늘 할 일
chapter("ch1", "① 아침, 오늘 할 일", 600, "m1", "board", WIDE);
at(T.m1 + .1, { ring: "cols", tag: "담당자 · 시간으로 다섯 칸", cur: [960, 560] });
at(T.m1 + 4.4, { ring: "colMe", tag: "내가 할 일", cam: [200, 160, 1280, 720], cur: "colMe" });
at(T.m1 + 6.0, { ring: "colOth", tag: "맡긴 일", cur: "colOth" });
at(T.m2 - .1, { ring: "metrics", tag: "한눈 요약", cam: [0, 90, 1100, 619], cur: "metrics" });
at(T.m3 - .1, { ring: "red", tag: "점검 시각 지남", cam: [150, 120, 1000, 563], cur: "red" });

// ② 나라장터 장애 → 디지털조달관리과에 전화하며 빠른 메모
chapter("ch2", "② 그때, 나라장터가 멈춥니다", 660, "c1", "board", WIDE);
at(T.c1 + dur("c1", "") * .58, { shot: "mini-memo", hard: true, ring: "frame", tag: "빠른 메모 창 · Ctrl+Alt+Space", cam: [380, 110, 1160, 653], cur: "inp" });
at(T.c2 - .1, { shot: "mini-at", ring: "pb", tag: "전화번호부에서 찾기", cur: "pb" });
at(T.c2 + 3.0, { click: true });
at(T.c3 - .1, { ring: null, cam: WIDE });
at(T.c3 + 1.6, { shot: "board-new", hard: true, ring: "card", tag: "분류 대기 + 관련인 자동", cam: ZOOM_LEFT, cur: "card" });

// ③ 업무로 다듬기
chapter("ch3", "③ 업무로 다듬기", 520, "f1", "board-new", ZOOM_LEFT);
at(T.f1 + .1, { ring: "card", tag: "", cur: "card" });
at(T.f1 + 1.0, { click: true });
at(T.f1 + 1.15, { shot: "form-new", hard: true, ring: "panel", tag: "", cam: [380, 0, 1160, 653], cur: [1300, 700] });
at(T.f2 - .1, { shot: "form-sub", ring: "subs", tag: "점검 시각 · 담당", cam: [380, 120, 1160, 653], cur: "subs" });
at(T.f2 + 2.6, { ring: "save", tag: "", cur: "save" });
at(T.f2 + 3.4, { click: true });
at(T.f3 - .1, { shot: "board-moved", hard: true, ring: "card", tag: "오늘 처리 칸으로", cam: [0, 60, 1300, 731], cur: "card" });
at(T.f4 - .1, { shot: "board", hard: true, ring: "presets", tag: "프리셋", cam: [700, 40, 1220, 686], cur: "presets" });
at(T.f4 + 1.5, { click: true });
at(T.f4 + 1.65, { shot: "form-preset", hard: true, ring: "memo", tag: "미리 채워진 양식", cam: [380, 0, 1160, 653], cur: [1200, 300] });
at(T.f5 - .1, { shot: "form-drop", hard: true, ring: "files", tag: "끌어다 놓기", cam: [380, 330, 1160, 653], cur: "files" });
at(T.f6 - .1, { shot: "form-linked", ring: "lastFile", tag: "링크 연결", cur: "lastFile" });
at(T.f7 - .1, { shot: "merge", hard: true, ring: "target", tag: "끌어서 하나로", cam: [0, 120, 1100, 619], cur: [400, 760] });

// ④ 알림과 마무리
chapter("ch4", "④ 시각이 되면", 520, "n1", "alarm", WIDE);
at(T.n1 + .2, { ring: "alarm", tag: "시각 도래 알림", cam: [460, 220, 1000, 563], cur: [1240, 640] });
at(T.n2 - .1, { shot: "book", hard: true, ring: "pages", tag: "두 쪽 · 세로 스크롤", cam: WIDE, cur: [700, 420] });
at(T.n2 + 3.4, { ring: "page1", tag: "그 자리에서 편집", cam: [300, 60, 1160, 653], cur: [760, 300] });
at(T.n3 - .1, { shot: "form-finish", hard: true, ring: "finish", tag: "", cam: [760, 520, 1000, 563], cur: "finish" });
at(T.n3 + 2.6, { click: true });
at(T.n4 - .1, { shot: "finished", hard: true, ring: "metrics", tag: "오늘 완료 +1", cam: [0, 80, 1100, 619], cur: [700, 300] });

// ⑤ 다시 찾기
chapter("ch5", "⑤ 며칠 뒤, 다시 찾기", 600, "s1", "mini-search", [380, 110, 1160, 653]);
at(T.s1 + .2, { ring: "results", tag: "진행 · 완료 함께 검색", cur: "results" });
at(T.s2 - .1, { shot: "form-ro", hard: true, ring: "place", tag: "읽기 전용", cam: [380, 0, 1160, 653], cur: "place" });
at(T.s2 + 3.2, { ring: "reopen", tag: "다시 진행", cam: [700, 480, 1060, 596], cur: "reopen" });
at(T.s3 - .1, { shot: "cal", hard: true, ring: "today", tag: "", cam: WIDE, cur: "today" });
at(T.s3 + 1.4, { click: true });
at(T.s3 + 1.7, { ring: "detail", tag: "하루 시간표 0~24시", cam: [860, 90, 1060, 596], cur: "chip0" });
at(T.s3 + 4.6, { ring: "now", tag: "지금" });
at(T.s4 - .1, { shot: "done", hard: true, ring: "today", tag: "오늘 · 이번 주 · 이번 달", cam: [80, 60, 1400, 788], cur: "today" });

// ⑦ 담당자 교체
chapter("ch7", "⑥ 담당자가 바뀌면", 560, "p1", "phone", [100, 40, 1500, 844]);
at(T.p1 + .2, { ring: "row", tag: "", cur: "swap" });
at(T.p1 + 2.6, { ring: "swap", tag: "바꾸기", cur: "swap" });
at(T.p1 + 3.4, { click: true });
at(T.p1 + 3.6, { shot: "swap", hard: true, ring: "pick", tag: "새 담당자", cam: [260, 0, 1400, 788], cur: "pick" });
at(T.p2 - .1, { ring: "sum", tag: "완료 업무까지 한 번에", cur: "go" });
at(T.p3 - .1, { shot: "phone-plain", hard: true, ring: "add", tag: "", cam: [700, 40, 1220, 686], cur: "add" });
at(T.p3 + .9, { click: true });
at(T.p3 + 1.05, { shot: "pb-add", hard: true, ring: "modal", tag: "관련인 추가", cam: [420, 0, 1080, 608], cur: "save" });
at(T.p3 + 4.2, { shot: "phone-plain", hard: true, ring: "tools", tag: "엑셀 양식 · 불러오기", cam: [700, 40, 1220, 686], cur: "xlsx" });

// ⑧ 반복되는 일
chapter("ch8", "⑦ 반복되는 일", 520, "k1", "recur", [300, 0, 1320, 742]);
at(T.k1 + .2, { ring: "form", tag: "매주 · 매월", cur: [960, 400] });
at(T.k2 - .1, { shot: "board-recur", hard: true, ring: "card", tag: "자동 생성", cam: [0, 60, 1300, 731], cur: "card" });

// ⑨ 내 PC 안에서
chapter("ch9", "⑧ 데이터는, 내 PC 안에", 640, "d1", "settings-top", [420, 40, 1080, 608]);
at(T.d1 + .2, { ring: "theme", tag: "밝게 · 어둡게", cur: "theme" });
at(T.d1 + 1.6, { shot: "board-dark", hard: true, ring: null, cam: WIDE, cur: [1500, 600] });
at(T.d2 - .1, { shot: "settings-data", hard: true, ring: "data", tag: "백업 · 복원", cam: [420, 300, 1080, 608], cur: "bk" });

// 마무리
at(T.e1 - .15, { shape: 760, label: "던져두기 · 정리 · 이어보기", ring: null, cam: WIDE, cur: [1760, 960], stage: true });
at(T.e2 - .15, { shape: 460, label: "뭐하려 했더라", ring: null, cam: WIDE, cur: [1760, 960], stage: true });

const endCards = [[T.e1 + .2, "던져두기", "떠오른 일을<br>잊기 전에 한 줄로", T.e2 - .2, 333], [T.e1 + 1.4, "정리", "시각 · 담당자로<br>저절로 제 칸에", T.e2 - .2, 760], [T.e1 + 2.6, "이어보기", "검색 · 시간표로<br>다시 찾기", T.e2 - .2, 1187]];
const STAGE = { cards: endCards, ask: [1e6, ""], out: 1e6 };
writeFileSync("timeline.js", `const SHOTS=${JSON.stringify(SHOTS)};\nconst TIMELINE=${JSON.stringify(E.sort((a, b) => a.b - b.b))};\nconst CAPTIONS=${JSON.stringify(CAPS)};\nconst LOADER=[1e6,1e6,1e6];\nconst BTN_W=380;\nconst TOTAL=${TOTAL};\nconst STAGE=${JSON.stringify(STAGE)};\n`);
writeFileSync("cues.json", JSON.stringify({ T, TOTAL, clicks: E.filter((e) => e.click).map((e) => e.b), morphs: E.filter((e) => e.shape).map((e) => e.b) }, null, 1));
console.log("총 길이", TOTAL.toFixed(1), "초, 사건", E.length, "자막", CAPS.length);

// 소개영상 타임라인 — 내레이션 길이(durations.json)로 큐(T.id)를 정하고 그 위에 화면 사건을 얹어 timeline.js·cues.json 을 쓴다.
// 장면 엔진(index.html)과 사건 형식은 '조달법령 흐름도' 시연 영상(koneps-flow docs/시연)과 같다. 실행: node build.mjs
// v3.8.7 시나리오 "디지털조달관리과 김정보 주무관의 하루"(전자입찰 장애 대응) — 장(①~⑨)마다 알약 제목 → 창 → 문장마다 한 동작.
// v3.9.0: 새 장 ⑧ "자리를 비우기 전, 일을 넘깁니다"(chh·h1~h6). 알약 아래 장 진행 표시(n / 9), 누르는 자리 물결, 단축키 키 칩,
// 강조 테두리 바깥 어둡게(index.html), 끝 요약 카드 셋(던져두기 / 알아서 정리 / 넘길 땐 한 장). 효과 값은 awesome-ai-motion 카드
// (spotlight 주변 농도 .25 · cursor-click 물결 .65초 2.4배 · progressive-disclosure 단계 간격 .7초)에서 시작했다.
import { readFileSync, writeFileSync } from "node:fs";
import { LINES } from "./script.mjs";
const SHOTS = JSON.parse(readFileSync("shots.json", "utf8"));
let DUR = {}; try { DUR = JSON.parse(readFileSync("durations.json", "utf8")); } catch {}
const dur = (id, say) => DUR[id] ?? Math.max(2.4, say.length * 0.1 + 0.6);
const GAP = .40;
/* 동작(클릭·화면 전환)이 문장 끝에 붙는 곳은 조금 더 머문다 */
const HOLD = { o2: .4, m1: .3, c1: .4, c2: .5, c3: .5, f1: .4, f3: .4, f5: .5, n1: .3, n2: .5, d0: .5, d1: .4, d2: .4, d2b: .5, d4: .5, s1: .4, s2: .6, s3: .4, p1: .5, p2: .3,
  h1: .4, h2: .5, h3: .6, h4: .5, h5: .4, h6: .5, k2: .5, e1: 1.0 };
const T = {}; const CAPS = []; let clock = .8;
for (const [id, say, cap] of LINES) { T[id] = clock; const d = dur(id, say); CAPS.push([clock - .05, clock + d + .15, cap]); clock += d + GAP + (HOLD[id] || 0); }
const TOTAL = clock + 2.6;
const D = (id) => dur(id, "");

const E = []; const at = (t, o) => E.push({ b: t, ...o });
const WIDE = "full";
/* 장 제목 알약 + 그 아래 진행 표시(n / 9) */
const CH = ["ch1", "ch2", "ch3", "ch4", "ch5", "ch6", "ch7", "chh", "ch8"];
const PROG = [];
const chapter = (id, title, w, next, shot, cam = WIDE) => {
  at(T[id] - .15, { shape: w, label: title, ring: null, cam: WIDE });
  at(T[id] + .9, { cur: [1250, 700], stage: true, lead: .1 });   /* 알약·진행 표시를 가리지 않게 오른쪽 아래로 */
  at(T[next] - .2, { shape: "window", label: "", shot, hard: true, cam, click: true });
  PROG.push([T[id] + .05, T[next] - .35, CH.indexOf(id) + 1, CH.length]);
};
const ZOOM_LEFT = [0, 60, 1300, 731];
const FORM = [380, 0, 1160, 653];
/* 상자 안의 일부(비율) — 받는 사람 화면의 메모지 그림처럼 한 장의 그림 안 자리를 가리킬 때 */
const part = (shot, name, fx, fy, fw, fh) => { const b = SHOTS[shot][name]; return [b.x + b.w * fx, b.y + b.h * fy, b.w * fw, b.h * fh]; };

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
at(T.c1 + D("c1") * .58, { shot: "mini-memo", hard: true, ring: "frame", tag: "빠른 메모 창", cam: [380, 110, 1160, 653], cur: "inp" });
at(T.c2 - .1, { shot: "mini-at", ring: "pb", tag: "전화번호부에서 찾기", cur: "pb" });
at(T.c2 + 3.4, { click: true });
at(T.c3 - .1, { ring: null, cam: WIDE });
at(T.c3 + 1.6, { shot: "board-new", hard: true, ring: "card", tag: "분류 대기 + 관련인 자동", cam: ZOOM_LEFT, cur: "card" });
const KEYS = [[T.c1 + D("c1") * .52, T.c1 + D("c1") + .4, ["Ctrl", "Alt", "Space"]], [T.c3 - .05, T.c3 + 1.9, ["Ctrl", "Enter"]]];

// ③ 업무로 다듬기
chapter("ch3", "③ 업무로 다듬기", 520, "f1", "board-new", ZOOM_LEFT);
at(T.f1 + .1, { ring: "card", tag: "", cur: "card" });
at(T.f1 + 1.0, { click: true });
at(T.f1 + 1.15, { shot: "form-new", hard: true, ring: "panel", tag: "", cam: FORM, cur: [1300, 700] });
at(T.f2 - .1, { shot: "form-sub", ring: "subs", tag: "하위 업무 · 점검 시각", cam: [380, 120, 1160, 653], cur: "subs" });
at(T.f2 + 2.6, { ring: "save", tag: "", cur: "save" });
at(T.f2 + 3.4, { click: true });
at(T.f3 - .1, { shot: "board-moved", hard: true, ring: "card", tag: "오늘 처리 칸으로", cam: ZOOM_LEFT, cur: "card" });
/* v3.8.19 f5 — 탐색기에서 끌어 온 보고서를 양식 위에 놓는다(커서가 화면 밖에서 링크 칸으로) → 링크 줄이 생김 */
const FILES_CAM = [380, 430, 1160, 653];
at(T.f5 - .1, { shot: "form-drop", hard: true, ring: "files", tag: "탐색기에서 끌어 놓기", cam: FILES_CAM, cur: [1560, 1060], lead: .05 });
at(T.f5 + 1.4, { cur: "files" });
at(T.f5 + 3.2, { click: true });
at(T.f5 + 3.4, { shot: "form-linked", ring: "row", tag: "링크로 붙음", cur: "row" });

// ④ 알림과 업무 완료
chapter("ch4", "④ 시각이 되면", 520, "n1", "alarm", WIDE);
at(T.n1 + .2, { ring: "alarm", tag: "시각 도래 알림", cam: [460, 220, 1000, 563], cur: [1240, 640] });
at(T.n2 - .1, { shot: "form-finish", hard: true, ring: "finish", tag: "업무 완료", cam: [760, 520, 1000, 563], cur: "finish" });
at(T.n2 + 2.8, { click: true });
at(T.n2 + 3.0, { shot: "finished", hard: true, ring: "metrics", tag: "오늘 완료 +1", cam: [0, 80, 1100, 619], cur: [700, 300] });
at(T.n2 + 5.4, { ring: "toast", tag: "실행 취소", cam: WIDE, cur: "toast" });

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
at(T.d2b + D("d2b") * .6, { shot: "docs-pdf-sel", hard: true, ring: "sel", tag: "PDF도 똑같이", cur: "sel" });
at(T.d4 - .1, { shot: "docs-dock", hard: true, ring: "form", tag: "보면서 메모", cam: [700, 60, 1220, 686], cur: "memo" });
/* v3.8.19 d4 — 메모 칸 접기(›) → 문서가 넓어지고 오른쪽에 '‹ 메모' 띠만 */
at(T.d4 + D("d4") * .48, { shot: "docs-sql", hard: true, ring: "fold", tag: "접기", cam: [700, 60, 1220, 686], cur: "fold" });
at(T.d4 + D("d4") * .48 + 1.0, { click: true });
at(T.d4 + D("d4") * .48 + 1.2, { shot: "docs-fold", hard: true, ring: "rail", tag: "메모 칸 접기", cam: [300, 60, 1620, 911], cur: "rail" });

// ⑥ 다시 찾기
chapter("ch6", "⑥ 며칠 뒤, 다시 찾기", 600, "s1", "mini-search", [380, 110, 1160, 653]);
at(T.s1 + .2, { ring: "results", tag: "진행 중 · 완료 함께 검색", cur: "results" });
at(T.s2 - .1, { shot: "cal", hard: true, ring: "detail", tag: "하루 시간표", cam: [860, 90, 1060, 596], cur: "chip0" });
at(T.s2 + 3.6, { click: true });
at(T.s2 + 3.8, { shot: "cal-new", hard: true, ring: "subs", tag: "그 시각으로 새 업무", cam: FORM, cur: "subs" });
at(T.s3 - .1, { shot: "done", hard: true, ring: "strip", tag: "달마다 넘기기", cam: [900, 40, 1020, 574], cur: "prev" });
at(T.s3 + 1.6, { click: true });
at(T.s3 + 1.8, { shot: "done-prev", hard: true, ring: "list", tag: "지난달 끝낸 일", cam: [200, 40, 1500, 844], cur: "prev" });
at(T.s3 + D("s3") * .5, { ring: "day", tag: "", cur: "day" });
at(T.s3 + D("s3") * .5 + 1.2, { click: true });
at(T.s3 + D("s3") * .5 + 1.4, { shot: "done-day", hard: true, ring: "list", tag: "그날 끝낸 일", cur: "day" });

// ⑦ 사람으로 찾기 · 담당자 교체
chapter("ch7", "⑦ 사람으로 찾기", 520, "p1", "phone-side", [100, 40, 1500, 844]);
at(T.p1 + .2, { ring: "row", tag: "", cur: "row" });
at(T.p1 + 1.4, { click: true });
at(T.p1 + 1.6, { ring: "side", tag: "관련 업무 · 진행 중/완료", cam: [800, 40, 1100, 619], cur: "side" });
at(T.p2 - .1, { shot: "phone-swap", hard: true, ring: "swap", tag: "바꾸기", cam: [400, 40, 1400, 788], cur: "swap" });
at(T.p2 + 1.6, { click: true });
at(T.p2 + 1.8, { shot: "swap", hard: true, ring: "sum", tag: "완료 업무까지 한 번에", cam: [260, 0, 1400, 788], cur: "go" });

// ⑧ (v3.9.0 새 장) 자리를 비우기 전, 일을 넘깁니다 — 다음 주 교육으로 자리를 비워 장애 후속 조치를 옆자리 이시스 주무관에게 넘긴다
const MEMO_CAM = [560, 110, 840, 473];
/* 구역 제목 줄 — 선(.msec, 높이 1)과 그 아래 [제목] 글줄을 함께 두른다 */
const secRow = (shot, name) => { const b = SHOTS[shot][name]; return [b.x, b.y - 8, b.w, 32]; };
chapter("chh", "⑧ 자리를 비우기 전, 일 넘기기", 720, "h1", "memo-0", MEMO_CAM);
/* h1 — [진행 경과]·[남은 일] 줄을 치면 그 위에 가는 가로선 */
at(T.h1 + .1, { ring: "memo", tag: "메모", cur: "memo" });
at(T.h1 + D("h1") * .3, { shot: "memo-1", ring: secRow("memo-1", "sec0"), tag: "[진행 경과] 위에 선", cur: secRow("memo-1", "sec0") });
at(T.h1 + D("h1") * .6, { shot: "memo-2", ring: secRow("memo-2", "sec1"), tag: "[남은 일] 위에 선", cur: secRow("memo-2", "sec1") });
/* h2 — 양식 왼쪽 아래 공유 아이콘(작은 단추라 카메라를 당긴다) → 미리 보기 창 */
at(T.h2 - .1, { shot: "form-share", hard: true, ring: "share", tag: "공유", cam: [560, 900, 560, 315], cur: "share" });
at(T.h2 + 2.5, { click: true });
at(T.h2 + 2.7, { shot: "share-preview", hard: true, ring: "card", tag: "메모지 한 장", cam: [480, 60, 960, 900], cur: [1300, 520] });
/* h3 — [그림 복사] → 대화창에 붙여 넣기(왼쪽 보내는 사람) → 보내기 → 받는 사람 화면(오른쪽)의 메모지 */
at(T.h3 - .1, { ring: "img", tag: "그림 복사", cur: "img" });
at(T.h3 + .9, { click: true });
at(T.h3 + 1.0, { shot: "share-copied", ring: "toast", tag: "", cur: "img" });
at(T.h3 + 2.0, { shot: "chat-paste", hard: true, ring: "att", tag: "붙여 넣기", cam: WIDE, cur: "att" });
at(T.h3 + 3.0, { ring: "send", tag: "", cur: "send" });
at(T.h3 + 3.5, { click: true });
at(T.h3 + 3.7, { shot: "chat-sent", hard: true, ring: "recv", tag: "받는 사람 화면", cur: [1500, 640] });
at(T.h3 + D("h3") * .52, { ring: part("chat-sent", "img", .03, .3, .94, .12), tag: "남은 일", cam: [1060, 300, 640, 760] });
at(T.h3 + D("h3") * .66, { ring: part("chat-sent", "img", .03, .615, .94, .09), tag: "기한" });
at(T.h3 + D("h3") * .8, { ring: part("chat-sent", "img", .02, .945, .96, .05), tag: "연락처·파일 링크는 뺌" });
/* h4 — 설정 → 데이터 → [엑셀로 내보내기] */
at(T.h4 - .1, { shot: "settings-data", hard: true, ring: "xlsx", tag: "엑셀로 내보내기", cam: [500, 600, 900, 480], cur: "xlsx" });
at(T.h4 + D("h4") * .72, { click: true });
at(T.h4 + D("h4") * .72 + .2, { shot: "xlsx-saved", hard: true, ring: "toast", tag: "저장", cam: [460, 700, 1000, 380], cur: "toast" });
/* h5 — 한셀 뷰어로 연 첫 시트 '업무 목록': 구역 줄 → 붉은 기한 → 하위 업무 칸 */
at(T.h5 - .1, { shot: "xlsx-list", hard: true, ring: "sec", tag: "구역별로", cam: [0, 40, 1300, 731], cur: "sec" });
at(T.h5 + D("h5") * .3, { ring: "late", tag: "기한 지남 · 붉게", cam: [440, 40, 760, 428], cur: "late" });
at(T.h5 + D("h5") * .58, { ring: "subs", tag: "하위 업무 진행", cam: [700, 40, 960, 540], cur: "subs" });
/* h6 — 시트 탭을 '연락처·파일'로(탭 줄은 직접 그린 표시) */
at(T.h6 - .7, { ring: "tab1", tag: "다른 시트", cam: [0, 520, 1000, 563], cur: "tab1" });   /* h5 가 끝나는 쉼에서 미리 탭 줄로 */
at(T.h6 + .9, { click: true });
at(T.h6 + 1.1, { shot: "xlsx-contacts", hard: true, ring: "people", tag: "소속 · 이름 · 연락처", cam: [0, 0, 1500, 844], cur: "people" });
at(T.h6 + D("h6") * .4, { ring: "files", tag: "파일·폴더 위치", cur: "files" });

// ⑨ 내 PC 안에서
chapter("ch8", "⑨ 데이터는, 내 PC 안에", 640, "k2", "settings-data", [420, 560, 1080, 520]);
at(T.k2 + .2, { ring: "data", tag: "백업 · 복원", cur: "bk" });

// 마무리 — 세 줄 요약 카드(단계 간격 .7초)
at(T.e1 - .15, { shape: 820, label: "던져두기 · 알아서 정리 · 넘길 땐 한 장", ring: null, cam: WIDE, cur: [1760, 960], stage: true });
at(T.e2 - .15, { shape: 460, label: "뭐하려 했더라", ring: null, cam: WIDE, cur: [1760, 960], stage: true });

const endCards = [[T.e1 + .2, "던져두기", "떠오른 일을<br>잊기 전에 한 줄로", T.e2 - .2, 333], [T.e1 + .9, "알아서 정리", "시각 · 담당자로<br>저절로 제 칸에", T.e2 - .2, 760], [T.e1 + 1.6, "넘길 땐 한 장", "공유 메모지 · 엑셀로<br>그대로 넘기기", T.e2 - .2, 1187]];
const STAGE = { cards: endCards, ask: [1e6, ""], out: 1e6, prog: PROG, keys: KEYS };
writeFileSync("timeline.js", `const SHOTS=${JSON.stringify(SHOTS)};\nconst TIMELINE=${JSON.stringify(E.sort((a, b) => a.b - b.b))};\nconst CAPTIONS=${JSON.stringify(CAPS)};\nconst LOADER=[1e6,1e6,1e6];\nconst BTN_W=380;\nconst TOTAL=${TOTAL};\nconst STAGE=${JSON.stringify(STAGE)};\n`);
writeFileSync("cues.json", JSON.stringify({ T, TOTAL, clicks: E.filter((e) => e.click).map((e) => e.b), morphs: E.filter((e) => e.shape).map((e) => e.b) }, null, 1));
console.log("총 길이", TOTAL.toFixed(1), "초, 사건", E.length, "자막", CAPS.length);

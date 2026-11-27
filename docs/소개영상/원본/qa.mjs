// 렌더한 영상 검사: node qa.mjs [영상] → qa/*.jpg(장마다·새 장 정지 화면, 영상에서 ffmpeg 로 뽑음) + 길이·자막·음성 대조
// 자막 시각(timeline.js CAPTIONS)과 음성 길이(durations.json), 영상 길이(cues.json TOTAL)를 견주고, 소리의 클리핑·긴 무음을 본다.
import { readFileSync, mkdirSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { LINES } from "./script.mjs";
const clip = process.argv[2] || "clip.mp4";
const { T, TOTAL } = JSON.parse(readFileSync("cues.json", "utf8"));
const DUR = JSON.parse(readFileSync("durations.json", "utf8"));
const caps = JSON.parse(readFileSync("timeline.js", "utf8").match(/const CAPTIONS=(.*);/)[1]);
let bad = 0;
LINES.forEach(([id, , cap], i) => { const [a, b, text] = caps[i]; const d = b - a - .2; if (text !== cap || Math.abs(d - DUR[id]) > .01) { bad++; console.log("자막·음성 어긋남", id, d.toFixed(2), DUR[id]); } });
const sum = LINES.reduce((s, [id]) => s + DUR[id], 0);
const fmt = (k) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", k]).toString());
console.log(`문장 ${LINES.length} · 음성 합 ${sum.toFixed(1)}초 · 타임라인 ${TOTAL.toFixed(1)}초 · 영상 ${fmt(clip).toFixed(1)}초 · 자막 어긋남 ${bad}`);
/* 문장끼리 겹치지 않는가(다음 문장 시작 ≥ 이 문장 끝) */
LINES.forEach(([id], i) => { const n = LINES[i + 1]; if (n && T[id] + DUR[id] > T[n[0]] - .1) console.log("음성 겹침", id, n[0]); });
/* 소리: 최고 수준·클리핑(astats), 1.2초 넘는 무음(silencedetect, 음악이 깔려 있어 처음·끝 말고는 없어야 한다) */
const st = spawnSync("ffmpeg", ["-hide_banner", "-i", clip, "-vn", "-af", "astats,silencedetect=n=-45dB:d=1.2", "-f", "null", "-"], { encoding: "utf8" }).stderr;
const ov = st.slice(st.lastIndexOf("Overall"));
console.log("소리:", (ov.match(/Peak level dB: [-\d.]+/) || [""])[0], "·", (ov.match(/Number of (?:clipped|samples clipped)[^\n]*|Clipped[^\n]*/) || ["클리핑 항목 없음"])[0].trim());
console.log("무음:", [...st.matchAll(/silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+)/g)].map((m) => `${(+m[1]).toFixed(1)}~${(+m[2]).toFixed(1)}`).join(", ") || "없음");
mkdirSync("qa", { recursive: true });
const shots = { o2: T.o2 + 1.5 }; for (const id of ["ch1", "ch2", "ch3", "ch4", "ch5", "ch6", "ch7", "chh", "ch8"]) shots[id] = T[id] + 1.2;
Object.assign(shots, { m2: T.m2 + 3, c1: T.c1 + DUR.c1 * .8, f5: T.f5 + 5, n2: T.n2 + 1.5, d0: T.d0 + 7, d4: T.d4 + DUR.d4 * .8, s3: T.s3 + 3, p1: T.p1 + 4,
  h1: T.h1 + DUR.h1 * .85, h2: T.h2 + 1.8, h2b: T.h2 + 4.5, h3: T.h3 + 4.6, h3b: T.h3 + DUR.h3 * .58, h3c: T.h3 + DUR.h3 * .9, h4: T.h4 + 1.6, h5: T.h5 + DUR.h5 * .45, h5b: T.h5 + DUR.h5 * .8, h6: T.h6 + .3, h6b: T.h6 + DUR.h6 * .7, k2: T.k2 + 2, e1: T.e1 + 3, e2: T.e2 + 1 });
for (const [k, t] of Object.entries(shots)) execFileSync("ffmpeg", ["-y", "-v", "error", "-ss", t.toFixed(3), "-i", clip, "-frames:v", "1", "-q:v", "3", `qa/${k}.jpg`]);
console.log("qa frames", Object.keys(shots).length);

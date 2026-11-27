// 미리보기 정지 화면: node stills.mjs → stills/*.jpg (렌더 전에 장면 확인)
// v3.9.0: 새 장(chh·h1~h6)과 장 제목 알약의 진행 표시·키 칩·끝 요약 카드를 함께 본다. 빠진 줄(f4·d3·k1)은 뺐다.
import { join } from "node:path"; import { pathToFileURL } from "node:url"; import { readFileSync, mkdirSync } from "node:fs";
const pw = await import(pathToFileURL(join(process.cwd(), "../../../node_modules/playwright-core/index.js")).href); const chromium = (pw.default && pw.default.chromium) || pw.chromium;
const { T } = JSON.parse(readFileSync("cues.json", "utf8"));
const DUR = JSON.parse(readFileSync("durations.json", "utf8"));
const mid = (id, f) => T[id] + DUR[id] * f;
const times = { "board": T.o2 + 1.2, "ch1": T.ch1 + 1, "cols": T.m1 + 2, "me": T.m1 + 5, "metrics": T.m2 + 2, "ch2": T.ch2 + 1.2, "memo": T.c1 + 6.5, "at": T.c2 + 2, "new": T.c3 + 1, "new2": T.c3 + 3.5,
  "form": T.f1 + 2.5, "sub": T.f2 + 1.5, "moved": T.f3 + 2, "f5drag": T.f5 + 2.4, "f5link": T.f5 + 5, "alarm": T.n1 + 2, "finish": T.n2 + 1.5, "done1": T.n2 + 4.5,
  "d0btn": T.d0 + 2, "d0reveal": T.d0 + 7, "search": T.d1 + 1.5, "hits": T.d1 + 4.5, "hwp": T.d2 + 2, "d2bhwp": T.d2b + 2, "d2bpdf": T.d2b + 6, "dock": T.d4 + 2.5, "d4fold0": mid("d4", .48) + .6, "d4fold": T.d4 + 7.5,
  "msearch": T.s1 + 2.5, "cal": T.s2 + 2, "calnew": T.s2 + 5, "donetab": T.s3 + 1.2, "s3prev": T.s3 + 3, "doneday": T.s3 + 5.5, "side": T.p1 + 3, "swap": T.p2 + 3,
  "chh": T.chh + 1.2, "h1a": T.h1 + 1.2, "h1b": mid("h1", .45), "h1c": mid("h1", .8), "h2a": T.h2 + 1.5, "h2b": T.h2 + 4.5, "h3a": T.h3 + .5, "h3b": T.h3 + 2.6, "h3c": T.h3 + 4.6,
  "h3d": mid("h3", .58), "h3e": mid("h3", .72), "h3f": mid("h3", .9), "h4a": T.h4 + 1.5, "h4b": mid("h4", .9), "h5a": T.h5 + 1.2, "h5b": mid("h5", .45), "h5c": mid("h5", .8),
  "h6a": T.h6 + .2, "h6b": T.h6 + 2, "h6c": mid("h6", .75), "ch8": T.ch8 + 1, "data": T.k2 + 2, "end": T.e1 + 3, "last": T.e2 + 1 };
mkdirSync("stills", { recursive: true });
const b = await chromium.launch({ channel: "msedge", args: ["--allow-file-access-from-files"] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
p.on("pageerror", (e) => console.log("ERR", e.message));
await p.goto(pathToFileURL(join(process.cwd(), "index.html")).href); await p.evaluate(() => window.ready);
for (const [k, t] of Object.entries(times)) { if (!Number.isFinite(t)) throw new Error("시각 없음 " + k); await p.evaluate((t) => window.seek(t), t); await p.waitForTimeout(60); await p.screenshot({ path: `stills/${k}.jpg`, type: "jpeg", quality: 80 }); }
await b.close(); console.log("stills", Object.keys(times).length);

// 미리보기 정지 화면: node stills.mjs → stills/*.jpg (렌더 전에 장면 확인)
import { join } from "node:path"; import { pathToFileURL } from "node:url"; import { readFileSync, mkdirSync } from "node:fs";
const pw = await import(pathToFileURL(join(process.cwd(), "../../../node_modules/playwright-core/index.js")).href); const chromium = (pw.default && pw.default.chromium) || pw.chromium;
const { T } = JSON.parse(readFileSync("cues.json", "utf8"));
const times = { "board": T.o2+1.2, "cols": T.m1+2, "me": T.m1+5, "metrics": T.m2+2, "memo": T.c1+6.5, "at": T.c2+2, "new": T.c3+3.5, "form": T.f1+2.5, "sub": T.f2+1.5, "moved": T.f3+2, "merge": T.f4+2, "alarm": T.n1+2, "finish": T.n2+1.5, "done1": T.n2+4.5, "search": T.d1+1.5, "hits": T.d1+4.5, "hwp": T.d2+2, "csv": T.d3+1.5, "sql": T.d3+6, "dock": T.d4+2.5, "msearch": T.s1+2.5, "cal": T.s2+2, "calnew": T.s2+5, "donetab": T.s3+1.5, "doneday": T.s3+4, "side": T.p1+3, "swap": T.p2+3, "dark": T.k1+2.3, "data": T.k2+2, "end": T.e1+3.5, "last": T.e2+1 };
mkdirSync("stills", { recursive: true });
const b = await chromium.launch({ channel: "msedge", args: ["--allow-file-access-from-files"] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
p.on("pageerror", (e) => console.log("ERR", e.message));
await p.goto(pathToFileURL(join(process.cwd(), "index.html")).href); await p.evaluate(() => window.ready);
for (const [k, t] of Object.entries(times)) { await p.evaluate((t) => window.seek(t), t); await p.waitForTimeout(60); await p.screenshot({ path: `stills/${k}.jpg`, type: "jpeg", quality: 80 }); }
await b.close(); console.log("stills", Object.keys(times).length);

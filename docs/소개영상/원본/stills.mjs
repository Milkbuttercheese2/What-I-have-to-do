// 미리보기 정지 화면: node stills.mjs → stills/*.jpg (렌더 전에 장면 확인)
import { join } from "node:path"; import { pathToFileURL } from "node:url"; import { readFileSync, mkdirSync } from "node:fs";
const pw = await import(pathToFileURL(join(process.cwd(), "../../../node_modules/playwright-core/index.js")).href); const chromium = (pw.default && pw.default.chromium) || pw.chromium;
const { T } = JSON.parse(readFileSync("cues.json", "utf8"));
const times = { "board": T.o2+1.2, "cols": T.m1+2, "me": T.m1+5, "metrics": T.m2+2, "red": T.m3+1.5, "memo": T.c1+6.5, "at": T.c2+2, "new": T.c3+3.5, "form": T.f1+2.5, "sub": T.f2+1.5, "moved": T.f3+2, "preset": T.f4+3, "drop": T.f5+1.5, "linked": T.f6+2, "merge": T.f7+2, "alarm": T.n1+2, "book": T.n2+1.5, "bookedit": T.n2+4.5, "finish": T.n3+1.5, "done1": T.n4+2, "search": T.s1+2.5, "ro": T.s2+4.5, "cal": T.s3+3, "donetab": T.s4+2, "swap": T.p1+4.8, "sum": T.p2+1.5, "pbadd": T.p3+2.5, "xl": T.p3+5, "recur": T.k1+2, "rchild": T.k2+1.5, "dark": T.d1+2.5, "data": T.d2+2, "end": T.e1+3.5, "last": T.e2+1, "last2": T.e2+1.2, "last3": T.e2+1.4 };
mkdirSync("stills", { recursive: true });
const b = await chromium.launch({ channel: "msedge", args: ["--allow-file-access-from-files"] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
p.on("pageerror", (e) => console.log("ERR", e.message));
await p.goto(pathToFileURL(join(process.cwd(), "index.html")).href); await p.evaluate(() => window.ready);
for (const [k, t] of Object.entries(times)) { await p.evaluate((t) => window.seek(t), t); await p.waitForTimeout(60); await p.screenshot({ path: `stills/${k}.jpg`, type: "jpeg", quality: 80 }); }
await b.close(); console.log("stills", Object.keys(times).length);

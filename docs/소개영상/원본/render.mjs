// 프레임 조각 렌더: node render.mjs <시작프레임> <끝프레임(미포함)> <출력.mp4>. 프레임당 4개 부분프레임을 ffmpeg tmix로 섞어 60fps.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const pw = await import(pathToFileURL(join(process.cwd(), "../../../node_modules/playwright-core/index.js")).href); const chromium = (pw.default && pw.default.chromium) || pw.chromium;
const [f0, f1, out] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4]];
const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", "240", "-c:v", "mjpeg", "-i", "-",
  "-vf", "tmix=frames=4,select='not(mod(n-3\,4))',setpts=N/60/TB", "-r", "60", "-c:v", "libx264", "-preset", "medium", "-crf", "10", "-pix_fmt", "yuv420p", out], { stdio: ["pipe", "inherit", "inherit"] });
const b = await chromium.launch({ channel: "msedge", args: ["--allow-file-access-from-files"] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
p.on("pageerror", (e) => console.log("ERR", e.message));
await p.goto(pathToFileURL(join(process.cwd(), "index.html")).href);
await p.evaluate(() => window.ready);
let prevKey = null, prevBuf = null, shots = 0;
const started = Date.now();
const write = (buf) => new Promise((ok) => ff.stdin.write(buf) ? ok() : ff.stdin.once("drain", ok));
for (let sub = 4 * f0 - 3; sub <= 4 * (f1 - 1); sub++) {
  const key = await p.evaluate((t) => window.seek(t), sub / 240);
  if (key !== prevKey) { prevBuf = await p.screenshot({ type: "jpeg", quality: 96 }); prevKey = key; shots++; }
  await write(prevBuf);
}
ff.stdin.end();
await new Promise((ok) => ff.once("close", ok));
await b.close();
console.log(`${out}: frames ${f1 - f0}, screenshots ${shots}, ${Math.round((Date.now() - started) / 1000)}s`);

// 몇 조항이더라 — 별표 원본 파일 수집 (Tauri 배포용)
//
// 별표·서식의 罫線 텍스트 복원은 한계가 있다(굵은 罫線을 못 읽는 표가 60%).
// 그래서 방향을 바꾼다: **원본 HWP/PDF 를 그대로 보여주고**, 검색은 파싱 텍스트로 한다.
// 표시는 원본, 색인은 텍스트 — 텍스트(n.text)는 이미 스냅샷에 있으니 여기선 파일만 받는다.
//
// 받은 파일은 web/annex/<flSeq>.<ext> 에 둔다. web/ 은 Tauri 의 frontendDist 라
// 브라우저(dev 서버)와 Tauri(webview) 둘 다 같은 상대경로 `annex/<flSeq>.pdf` 로 연다.
// asset 프로토콜·권한 설정이 필요 없다 — 한 경로로 끝난다.
//
//   node src/fetch-annexes.mjs                전량 (약 200MB, 오래 걸림)
//   node src/fetch-annexes.mjs --sample 5     문서 5개만 (파이프라인 검증용)
//   node src/fetch-annexes.mjs --pdf-only     PDF 만 (HWP 는 뷰어가 못 여니 생략 가능)
//   node src/fetch-annexes.mjs --refresh      이미 받은 파일도 다시 받기

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "web", "annex");

const argv = process.argv.slice(2);
const sampleIdx = argv.indexOf("--sample");
const sample = sampleIdx >= 0 ? Number(argv[sampleIdx + 1]) : Infinity;
const pdfOnly = argv.includes("--pdf-only");
const refresh = argv.includes("--refresh");

/** URL 의 flSeq 값. 이게 파일의 안정적 열쇠다 (빌드·프론트가 같은 값을 쓴다). */
function flSeqOf(url) {
  const m = String(url ?? "").match(/[?&]flSeq=(\d+)/);
  return m ? m[1] : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function download(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // 인증 실패는 HTML 안내페이지로 온다(수백 바이트). 파일이 아니면 버린다.
  if (buf.length < 200 && /html|<!DOCTYPE/i.test(buf.toString("utf8"))) {
    throw new Error("파일이 아닌 응답(HTML)");
  }
  writeFileSync(dest, buf);
  return buf.length;
}

async function main() {
  const snapshot = JSON.parse(readFileSync(join(root, "data/snapshot.json"), "utf8"));
  mkdirSync(outDir, { recursive: true });

  // 받을 목록을 flSeq 로 유니크하게 모은다 (같은 파일이 여러 별표에 걸릴 수 있다).
  const jobs = new Map(); // flSeq → { url, ext }
  let docCount = 0;
  for (const d of snapshot.documents) {
    if (docCount >= sample) break;
    let touched = false;
    for (const a of d.annexes ?? []) {
      for (const [ext, url] of [
        ["pdf", a.files?.pdf],
        ...(pdfOnly ? [] : [["hwp", a.files?.hwp]]),
      ]) {
        const seq = flSeqOf(url);
        if (seq && !jobs.has(`${seq}.${ext}`)) {
          jobs.set(`${seq}.${ext}`, { seq, ext, url });
          touched = true;
        }
      }
    }
    if (touched) docCount += 1;
  }

  console.log(`별표 파일 수집 — 대상 ${jobs.size}개${Number.isFinite(sample) ? ` (문서 ${sample}개 표본)` : " (전량)"}\n`);

  let ok = 0, skip = 0, fail = 0, bytes = 0;
  const failures = [];
  for (const { seq, ext, url } of jobs.values()) {
    const dest = join(outDir, `${seq}.${ext}`);
    if (!refresh && existsSync(dest) && statSync(dest).size > 0) {
      skip += 1;
      continue;
    }
    try {
      const n = await download(url, dest);
      bytes += n;
      ok += 1;
      if (ok % 25 === 0) console.log(`  … ${ok}개 받음`);
    } catch (e) {
      fail += 1;
      failures.push({ seq, ext, error: e.message });
    }
    await sleep(80); // 법제처에 예의
  }

  console.log(`\n완료 → web/annex/`);
  console.log(`  받음 ${ok} · 건너뜀(이미 있음) ${skip} · 실패 ${fail} · ${(bytes / 1048576).toFixed(1)}MB`);
  if (failures.length) {
    console.log(`\n⚠️  실패 ${failures.length}건 (상위 5):`);
    for (const f of failures.slice(0, 5)) console.log(`  · ${f.seq}.${f.ext} — ${f.error}`);
    process.exitCode = failures.length === jobs.size ? 1 : 0;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

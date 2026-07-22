// 플레이스홀더 앱 아이콘 생성 — 단색 사각형(테마 강조색).
//   node src-tauri/gen-icons.mjs
// 진짜 아이콘이 생기면 `cargo tauri icon icons/icon.png` 로 교체하면 된다.
// 여기서는 외부 도구 없이(zlib 만으로) 유효한 PNG·ICO 를 굽는다.

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = join(dirname(fileURLToPath(import.meta.url)), "icons");
mkdirSync(dir, { recursive: true });

const RGBA = [0x4d, 0x93, 0x8a, 0xff]; // --accent(라이트)

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function png(size) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  // 각 행: 필터바이트(0) + size*4 픽셀
  const row = Buffer.alloc(1 + size * 4);
  for (let x = 0; x < size; x++) {
    row[1 + x * 4] = RGBA[0];
    row[1 + x * 4 + 1] = RGBA[1];
    row[1 + x * 4 + 2] = RGBA[2];
    row[1 + x * 4 + 3] = RGBA[3];
  }
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// PNG 들
const sizes = { "32x32.png": 32, "128x128.png": 128, "128x128@2x.png": 256, "icon.png": 512 };
const pngs = {};
for (const [name, s] of Object.entries(sizes)) {
  pngs[name] = png(s);
  writeFileSync(join(dir, name), pngs[name]);
}

// ICO — Vista+ 는 ICO 안에 PNG 를 넣을 수 있다. 256/128/32 세 장을 담는다.
function ico(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);
  let offset = 6 + entries.length * 16;
  const dirs = [];
  const datas = [];
  for (const { size, data } of entries) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size; // 256 은 0 으로 표기
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4);   // color planes
    e.writeUInt16LE(32, 6);  // bpp
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    dirs.push(e);
    datas.push(data);
  }
  return Buffer.concat([header, ...dirs, ...datas]);
}
writeFileSync(join(dir, "icon.ico"), ico([
  { size: 32, data: pngs["32x32.png"] },
  { size: 128, data: pngs["128x128.png"] },
  { size: 256, data: pngs["128x128@2x.png"] },
]));

// icon.icns(mac) 는 Windows 빌드엔 불필요 — tauri.conf 에서 뺐다.
// mac 배포 시 `cargo tauri icon icons/icon.png` 로 생성할 것.
console.log("아이콘 생성 완료 → src-tauri/icons/ (32/128/256/512 PNG + icon.ico)");

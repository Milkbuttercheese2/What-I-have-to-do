// 백업/내보내기 검증 — 무의존 JSON·XLSX 생성
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const Backup = createRequire(import.meta.url)("../src/backup.cjs");

test("CRC32 표준 벡터", () => {
  const bytes = new TextEncoder().encode("123456789");
  assert.equal(Backup.crc32(bytes) >>> 0, 0xcbf43926);
});

test("JSON 왕복", () => {
  const data = { version: 1, note: "가나다", archive: [{ id: "1", title: "t", text: "본문", at: "2026" }] };
  const str = Backup.toJson(data);
  const back = Backup.fromJson(str);
  assert.equal(back.note, "가나다");
  assert.equal(back.archive[0].text, "본문");
});

test("fromJson 은 잘못된 형식을 거부한다", () => {
  assert.throws(() => Backup.fromJson("[]"));
  assert.throws(() => Backup.fromJson('{"foo":1}'));
});

test("toXlsx 는 유효한 ZIP(xlsx) 바이트를 만든다", () => {
  const data = { exportedAt: "2026-07-23", note: "현재 노트", archive: [{ title: "제목1", at: "2026", text: "내용1" }] };
  const bytes = Backup.toXlsx(data);
  assert.ok(bytes instanceof Uint8Array && bytes.length > 100);
  // ZIP 로컬 헤더 시그니처 "PK\x03\x04"
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  // 끝에 중앙디렉터리 종료 시그니처 "PK\x05\x06"
  const tail = [...bytes.slice(-22, -18)];
  assert.deepEqual(tail, [0x50, 0x4b, 0x05, 0x06]);
  // 필수 파트가 이름으로 들어 있다
  const asStr = Buffer.from(bytes).toString("latin1");
  for (const part of ["[Content_Types].xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"]) {
    assert.ok(asStr.includes(part), part);
  }
  // 셀 내용이 인라인 문자열로 실렸다
  assert.ok(asStr.includes("내용1") || Buffer.from(bytes).includes(Buffer.from("내용1")));
});

test("zip 항목 수가 중앙디렉터리에 반영된다", () => {
  const bytes = Backup.toXlsx({ archive: [] });
  // EOCD 의 total entries(오프셋 -22+10, u16 LE) == 5 파트
  const dv = new DataView(bytes.buffer, bytes.byteOffset + bytes.length - 22);
  assert.equal(dv.getUint16(10, true), 5);
});

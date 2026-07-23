/* 몇 조항이더라 — 법령노트 백업/내보내기 (브라우저 인라인용, 모듈 아님)
 *
 * 빌드 시 template.html 의 자리표시자에 삽입되고, test/backup.test.mjs 가 같은 파일을
 * 읽어 검증한다 — 단일 원천.
 *
 * 오프라인 단일 파일 원칙(외부 의존성 0)이라 XLSX 도 라이브러리 없이 직접 만든다.
 * XLSX = 특정 XML 들을 담은 ZIP. 압축은 store(무압축) + CRC32 로 충분하다(노트 양은 작다).
 */
var Backup = (function () {
  "use strict";

  // ── CRC32 (ZIP 무압축 항목에 필요) ──
  var CRC = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function utf8(str) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(str);
    // 폴백(테스트/구형): Buffer
    return Uint8Array.from(Buffer.from(str, "utf8"));
  }

  // ── 무압축 ZIP 조립 (store) ──
  function zip(files) {
    var chunks = [], central = [], offset = 0;
    var u16 = function (n) { return [n & 255, (n >>> 8) & 255]; };
    var u32 = function (n) { return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]; };
    for (var i = 0; i < files.length; i++) {
      var nameBytes = utf8(files[i].name);
      var data = files[i].data;
      var crc = crc32(data);
      var local = [].concat(
        u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0)
      );
      chunks.push(Uint8Array.from(local), nameBytes, data);
      var localLen = local.length + nameBytes.length + data.length;
      central.push([].concat(
        u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length),
        u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset)
      ), nameBytes);
      offset += localLen;
    }
    var cdStart = offset, cdBytes = [];
    for (var j = 0; j < central.length; j += 2) {
      cdBytes.push(Uint8Array.from(central[j]), central[j + 1]);
      offset += central[j].length + central[j + 1].length;
    }
    var cdSize = offset - cdStart;
    var end = Uint8Array.from([].concat(
      u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
      u32(cdSize), u32(cdStart), u16(0)
    ));
    var all = chunks.concat(cdBytes, [end]);
    var total = all.reduce(function (s, a) { return s + a.length; }, 0);
    var out = new Uint8Array(total), p = 0;
    for (var m = 0; m < all.length; m++) { out.set(all[m], p); p += all[m].length; }
    return out;
  }

  function xesc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/\r/g, "");
  }
  function cellInline(s) {
    return '<c t="inlineStr"><is><t xml:space="preserve">' + xesc(s) + "</t></is></c>";
  }
  function row(cells) {
    return "<row>" + cells.map(cellInline).join("") + "</row>";
  }

  // ── 공개 ──
  function toJson(data) {
    return JSON.stringify(data, null, 2);
  }
  function fromJson(str) {
    var o = JSON.parse(str);
    if (!o || typeof o !== "object") throw new Error("백업 형식이 아닙니다");
    if (typeof o.note !== "string" && !Array.isArray(o.archive)) throw new Error("노트/보관함이 없습니다");
    return o;
  }

  /** exportData() 결과 → XLSX 바이트(Uint8Array). 시트 1장: 제목·작성시각·내용. */
  function toXlsx(data) {
    var rows = [row(["제목", "작성시각", "내용"])];
    var arc = (data && data.archive) || [];
    // 현재 노트를 맨 위에 함께 싣는다(있으면).
    if (data && data.note && data.note.trim()) {
      rows.push(row(["(현재 노트)", data.exportedAt || "", data.note]));
    }
    for (var i = 0; i < arc.length; i++) {
      rows.push(row([arc[i].title || "", arc[i].at || "", arc[i].text || ""]));
    }
    var sheet =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<cols><col min="1" max="1" width="24"/><col min="2" max="2" width="22"/><col min="3" max="3" width="80"/></cols>' +
      "<sheetData>" + rows.join("") + "</sheetData></worksheet>";
    var wb =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="법령노트" sheetId="1" r:id="rId1"/></sheets></workbook>';
    var wbRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>';
    var rels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
    var ct =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>';
    return zip([
      { name: "[Content_Types].xml", data: utf8(ct) },
      { name: "_rels/.rels", data: utf8(rels) },
      { name: "xl/workbook.xml", data: utf8(wb) },
      { name: "xl/_rels/workbook.xml.rels", data: utf8(wbRels) },
      { name: "xl/worksheets/sheet1.xml", data: utf8(sheet) },
    ]);
  }

  return { crc32: crc32, zip: zip, toJson: toJson, fromJson: fromJson, toXlsx: toXlsx };
})();

if (typeof module !== "undefined" && module.exports) module.exports = Backup;

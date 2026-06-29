// miniprogram/utils/pdf/miniPdf.js
// -----------------------------------------------------------------------------
// 最小可用的手写 PDF 1.3 容器
// 设计取舍：
//   1. 不依赖 jsPDF / pdf-lib / Buffer / Blob —— 完全用 Uint8Array 拼装。
//   2. 每一页就是一张占满 MediaBox 的 JPEG（DCTDecode），没有矢量文字、没有字体。
//      所有文字、表格、水印都画在 Canvas 上再转 JPEG，外层 PDF 只做"封皮"。
//   3. A4 portrait：MediaBox = [0 0 595 842]（点单位，1pt = 1/72 inch）。
//
// PDF 对象编号约定：
//   1                = Catalog
//   2                = Pages
//   3*i              = Page i      (i 从 1 起算)
//   3*i + 1          = Contents i  （内容流，只有一句 "q w 0 0 h 0 0 cm /Im1 Do Q"）
//   3*i + 2          = Image i     (JPEG XObject)
// 对象总数 = 2 + 3 * pageCount
// -----------------------------------------------------------------------------

'use strict';

/**
 * 把 ASCII / latin1 字符串按"低 8 位"逐字符塞进 Uint8Array。
 * PDF 语法只使用 ASCII 与 8-bit 二进制，不要走 TextEncoder（会变 UTF-8）。
 */
function strToLatin1(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    out[i] = str.charCodeAt(i) & 0xff;
  }
  return out;
}

/**
 * 简单的字节累加器：内部记 chunks + 总长度，最后一次性拷成 Uint8Array。
 * pos() 用来记录每个 obj 的起始 offset（xref 表需要）。
 */
function createWriter() {
  const chunks = [];
  let length = 0;
  return {
    writeStr(s) {
      const u = strToLatin1(s);
      chunks.push(u);
      length += u.length;
    },
    writeBytes(u) {
      chunks.push(u);
      length += u.length;
    },
    pos() { return length; },
    toUint8() {
      const out = new Uint8Array(length);
      let off = 0;
      for (let i = 0; i < chunks.length; i++) {
        out.set(chunks[i], off);
        off += chunks[i].length;
      }
      return out;
    }
  };
}

/** 把数字左补零到 10 位，xref 偏移列要求固定宽度。 */
function pad10(n) {
  let s = String(n);
  while (s.length < 10) s = '0' + s;
  return s;
}

/**
 * 构造 PDF 字节流。
 *
 * @param {Array} pages 每页一个对象：
 *   {
 *     jpeg: Uint8Array,   // 完整 JPEG（含 SOI/EOI 标记）
 *     imgW: number,       // JPEG 实际像素宽
 *     imgH: number,       // JPEG 实际像素高
 *     pageW: number,      // 该页 MediaBox 宽，点单位（A4 = 595）
 *     pageH: number       // 该页 MediaBox 高，点单位（A4 = 842）
 *   }
 * @returns {Uint8Array} 可直接写文件的 PDF 字节
 */
function buildPdf(pages) {
  if (!pages || pages.length === 0) {
    throw new Error('buildPdf: 至少需要 1 页');
  }

  const w = createWriter();
  const n = pages.length;
  const totalObjs = 2 + 3 * n;
  const offsets = new Array(totalObjs + 1).fill(0); // offsets[i] = obj i 的字节偏移

  // ---------- Header ----------
  // %PDF-1.3 + 4 字节 >127 的 "二进制" 提示，让阅读器把文件认成二进制 PDF。
  w.writeStr('%PDF-1.3\n');
  w.writeBytes(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));

  // ---------- obj 1: Catalog ----------
  offsets[1] = w.pos();
  w.writeStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  // ---------- obj 2: Pages ----------
  offsets[2] = w.pos();
  let kids = '';
  for (let i = 1; i <= n; i++) {
    if (i > 1) kids += ' ';
    kids += (3 * i) + ' 0 R';
  }
  w.writeStr('2 0 obj\n<< /Type /Pages /Kids [' + kids + '] /Count ' + n + ' >>\nendobj\n');

  // ---------- 每页三组对象 ----------
  for (let i = 1; i <= n; i++) {
    const p = pages[i - 1];
    const pageObj     = 3 * i;
    const contentsObj = 3 * i + 1;
    const imageObj    = 3 * i + 2;

    // ----- Page -----
    offsets[pageObj] = w.pos();
    w.writeStr(
      pageObj + ' 0 obj\n' +
      '<< /Type /Page /Parent 2 0 R ' +
      '/MediaBox [0 0 ' + p.pageW + ' ' + p.pageH + '] ' +
      '/Resources << /XObject << /Im1 ' + imageObj + ' 0 R >> /ProcSet [/PDF /ImageC] >> ' +
      '/Contents ' + contentsObj + ' 0 R ' +
      '>>\nendobj\n'
    );

    // ----- Contents stream -----
    // "q W 0 0 H 0 0 cm /Im1 Do Q"
    //   q / Q              = 保存 / 恢复图形状态
    //   W 0 0 H 0 0 cm     = 把 1×1 单位图缩放到 W×H，并定位到 (0,0)
    //   /Im1 Do            = 绘制资源里的 Im1（也就是 JPEG XObject）
    const contentStr = 'q ' + p.pageW + ' 0 0 ' + p.pageH + ' 0 0 cm /Im1 Do Q\n';
    const contentBytes = strToLatin1(contentStr);
    offsets[contentsObj] = w.pos();
    w.writeStr(contentsObj + ' 0 obj\n<< /Length ' + contentBytes.length + ' >>\nstream\n');
    w.writeBytes(contentBytes);
    w.writeStr('endstream\nendobj\n');

    // ----- Image XObject (JPEG) -----
    offsets[imageObj] = w.pos();
    w.writeStr(
      imageObj + ' 0 obj\n' +
      '<< /Type /XObject /Subtype /Image ' +
      '/Width ' + p.imgW + ' /Height ' + p.imgH + ' ' +
      '/ColorSpace /DeviceRGB /BitsPerComponent 8 ' +
      '/Filter /DCTDecode /Length ' + p.jpeg.length + ' >>\n' +
      'stream\n'
    );
    w.writeBytes(p.jpeg);
    w.writeStr('\nendstream\nendobj\n');
  }

  // ---------- xref ----------
  const xrefStart = w.pos();
  w.writeStr('xref\n0 ' + (totalObjs + 1) + '\n');
  w.writeStr('0000000000 65535 f \n'); // free object 0
  for (let i = 1; i <= totalObjs; i++) {
    w.writeStr(pad10(offsets[i]) + ' 00000 n \n');
  }

  // ---------- trailer ----------
  w.writeStr('trailer\n<< /Size ' + (totalObjs + 1) + ' /Root 1 0 R >>\n');
  w.writeStr('startxref\n' + xrefStart + '\n%%EOF\n');

  return w.toUint8();
}

module.exports = {
  buildPdf,
  // 暴露给单测的低级工具（业务代码不应直接用）
  _internal: { strToLatin1, pad10, createWriter }
};

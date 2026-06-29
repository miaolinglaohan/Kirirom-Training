// miniprogram/utils/pdf/pdfCanvas.js
// -----------------------------------------------------------------------------
// A4 Canvas 工具：尺寸常量 / 准备画布 / 画白底 / 画水印 / canvas → JPEG 字节
//
// 设计要点：
//   - A4 portrait，PDF 点单位 595×842（1pt = 1/72 inch）。
//   - 实际绘制用 144 DPI，即点单位 × 2 = 像素 1190×1684。这样文字够清晰，
//     JPEG 体积也不至于太大（typical 单页 80~150KB @ quality 0.85）。
//   - 不在这个文件里创建 canvas —— 由调用方传入 `<canvas type="2d">` 的 node。
//     这是小程序里最稳的路径：`wx.canvasToTempFilePath` 配 type=2d canvas 在所有
//     近代基础库版本里都能用，比 offscreen.toDataURL 稳很多。
// -----------------------------------------------------------------------------

'use strict';

const A4_PT = { w: 595, h: 842 };  // PDF MediaBox 点单位
const DEFAULT_SCALE = 2;            // 像素/点。2 → 1190×1684 px。

/**
 * 返回 A4 在指定 scale 下的像素尺寸。
 */
function getA4PixelSize(scale) {
  const s = scale || DEFAULT_SCALE;
  return {
    widthPx:  A4_PT.w * s,
    heightPx: A4_PT.h * s,
    scale: s
  };
}

/**
 * 把传入的 canvas node 调成 A4 像素尺寸，并返回 ctx + 尺寸信息。
 * 调用方必须先通过 createSelectorQuery 拿到 type=2d 的 canvas node。
 *
 * @param {*} canvas type=2d 的 canvas node
 * @param {number} [scale] 像素/点，默认 2
 * @returns {{ ctx: any, widthPx: number, heightPx: number, scale: number, pageW: number, pageH: number }}
 */
function prepareCanvas(canvas, scale) {
  const sz = getA4PixelSize(scale);
  // 注意：canvas.width / canvas.height 是绘图缓冲区像素，必须显式赋值。
  canvas.width  = sz.widthPx;
  canvas.height = sz.heightPx;
  const ctx = canvas.getContext('2d');
  return {
    ctx,
    widthPx:  sz.widthPx,
    heightPx: sz.heightPx,
    scale:    sz.scale,
    pageW:    A4_PT.w,
    pageH:    A4_PT.h
  };
}

/**
 * 画白底——JPEG 不支持透明，没有白底的话 canvas 默认透明区会变成黑色。
 */
function drawWhiteBg(ctx, widthPx, heightPx) {
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, widthPx, heightPx);
  ctx.restore();
}

/**
 * 画 45° 斜向重复水印。
 *
 * 算法：
 *   1. 先 set font，用 ctx.measureText 测出文字真实宽度；
 *   2. 横向步进 = 文字宽 + gapX，确保两段水印之间有间隙不重叠；
 *   3. 纵向步进 = 字号 × lineMul（默认 4 倍字号，行距适中）；
 *   4. 隔行错开半步距（砖砌排布），视觉上更像真水印；
 *   5. 以页面中心为锚点旋转 -45°，铺一张足够大的网格覆盖整张 A4。
 *
 * @param {*} ctx 2d 上下文
 * @param {string} text 水印文字（空串则直接跳过，不画）
 * @param {number} widthPx 画布像素宽
 * @param {number} heightPx 画布像素高
 * @param {object} [opts]
 * @param {number} [opts.fontPx=32]   字号（像素）
 * @param {number} [opts.alpha=0.08]  透明度
 * @param {number} [opts.gapX=120]    横向单个水印之间的额外像素间隙
 * @param {number} [opts.lineMul=4]   纵向行距 = fontPx × lineMul
 * @param {number} [opts.stepX]       直接指定横向步进（覆盖 measureText 自适应）
 * @param {number} [opts.stepY]       直接指定纵向步进
 * @param {boolean} [opts.brick=true] 是否砖砌错位（true=隔行偏移半步距）
 */
function drawWatermark(ctx, text, widthPx, heightPx, opts) {
  if (!text) return;
  const o = opts || {};
  const fontPx  = o.fontPx || 48;
  const alpha   = (typeof o.alpha === 'number') ? o.alpha : 0.05;
  const gapX    = (typeof o.gapX === 'number') ? o.gapX : 160;
  const lineMul = o.lineMul || 5;
  const brick   = (o.brick !== false);

  ctx.save();
  ctx.fillStyle    = 'rgba(0,0,0,' + alpha + ')';
  ctx.font         = fontPx + 'px sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';

  // 自适应步进：文字越长，stepX 越大；用户也可手动覆盖
  const measured = ctx.measureText(text).width || fontPx * text.length;
  const stepX = o.stepX || (measured + gapX);
  const stepY = o.stepY || (fontPx * lineMul);

  const cx = widthPx  / 2;
  const cy = heightPx / 2;
  ctx.translate(cx, cy);
  ctx.rotate(-Math.PI / 4);
  ctx.translate(-cx, -cy);

  // 旋转后要覆盖原矩形所有角，最稳的范围 = ±对角线长度
  const diag = Math.sqrt(widthPx * widthPx + heightPx * heightPx);
  const startX = cx - diag;
  const endX   = cx + diag;
  const startY = cy - diag;
  const endY   = cy + diag;

  let row = 0;
  for (let y = startY; y <= endY; y += stepY) {
    const xOffset = (brick && (row % 2 === 1)) ? stepX / 2 : 0;
    for (let x = startX + xOffset; x <= endX; x += stepX) {
      ctx.fillText(text, x, y);
    }
    row++;
  }
  ctx.restore();
}

/**
 * 把 canvas 内容导出为 JPEG 字节流（Uint8Array）。
 *
 * 走 wx.canvasToTempFilePath → readFile 路径：
 *   1. canvasToTempFilePath 把绘制结果存成 jpg 临时文件；
 *   2. readFile 把临时文件读成 ArrayBuffer；
 *   3. 包成 Uint8Array 返回，给 miniPdf.buildPdf 用。
 *
 * @param {*} canvas type=2d 的 canvas node（同 prepareCanvas 传入的那个）
 * @param {object} [opts]
 * @param {number} [opts.quality=0.85]  JPEG 质量 0~1
 * @returns {Promise<Uint8Array>}
 */
function canvasToJpegBytes(canvas, opts) {
  const quality = (opts && typeof opts.quality === 'number') ? opts.quality : 0.85;
  return new Promise(function (resolve, reject) {
    wx.canvasToTempFilePath({
      canvas: canvas,
      fileType: 'jpg',
      quality: quality,
      success: function (res) {
        const fs = wx.getFileSystemManager();
        fs.readFile({
          filePath: res.tempFilePath,
          success: function (r) { resolve(new Uint8Array(r.data)); },
          fail:    function (e) { reject(new Error('readFile fail: ' + (e && e.errMsg))); }
        });
      },
      fail: function (e) { reject(new Error('canvasToTempFilePath fail: ' + (e && e.errMsg))); }
    });
  });
}

module.exports = {
  A4_PT,
  DEFAULT_SCALE,
  getA4PixelSize,
  prepareCanvas,
  drawWhiteBg,
  drawWatermark,
  canvasToJpegBytes
};

// miniprogram/utils/pdf/pdfExport.js
// -----------------------------------------------------------------------------
// 把若干 JPEG 页拼成 PDF → 写到 USER_DATA_PATH → 预览 / 转发
//
// 使用流程（业务方）：
//   1. 调用方对每一页自己画好 canvas，然后用 pdfCanvas.canvasToJpegBytes 拿到字节；
//   2. 把每页字节连同尺寸塞进数组：
//        pages.push({ jpeg, imgW, imgH, pageW, pageH });
//   3. await exportAndPreview(pages, 'xxx.pdf')
//      内部：buildPdf → writeFile → openDocument
//   4. 如需转发到文件传输助手，可单独调 sharePdfToChat(filePath)。
// -----------------------------------------------------------------------------

'use strict';

const { buildPdf } = require('./miniPdf');

/**
 * 把 Uint8Array 安全地转成可作为 writeFile data 的 ArrayBuffer。
 * 大多数情况下 u.buffer 就够，但若 u 是别人的子视图就要 slice。
 */
function toArrayBuffer(u8) {
  if (u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength) {
    return u8.buffer;
  }
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

/**
 * 校验文件名：只允许字母/数字/下划线/中文/点/横线，且以 .pdf 结尾。
 * 避免业务方传入诸如 "../" 这种路径片段。
 */
function sanitizeFileName(name) {
  if (!name || typeof name !== 'string') {
    return 'export_' + Date.now() + '.pdf';
  }
  let n = name.trim();
  if (!/\.pdf$/i.test(n)) n += '.pdf';
  // 去掉非法路径字符
  n = n.replace(/[\\/:*?"<>|]/g, '_');
  return n;
}

/**
 * 把 PDF 字节写到 USER_DATA_PATH 下，返回 filePath。
 *
 * @param {Uint8Array} pdfBytes
 * @param {string} fileName
 * @returns {Promise<string>} filePath（形如 wxfile://usr/xxx.pdf）
 */
function savePdfToFile(pdfBytes, fileName) {
  return new Promise(function (resolve, reject) {
    const safeName = sanitizeFileName(fileName);
    const filePath = wx.env.USER_DATA_PATH + '/' + safeName;
    const fs = wx.getFileSystemManager();
    fs.writeFile({
      filePath: filePath,
      data: toArrayBuffer(pdfBytes),
      success: function () { resolve(filePath); },
      fail:    function (e) { reject(new Error('writeFile fail: ' + (e && e.errMsg))); }
    });
  });
}

/**
 * 在小程序内预览 PDF（自带"…"菜单可转发 / 保存到手机）。
 */
function openPdf(filePath) {
  return new Promise(function (resolve, reject) {
    wx.openDocument({
      filePath: filePath,
      fileType: 'pdf',
      showMenu: true,
      success: resolve,
      fail: function (e) { reject(new Error('openDocument fail: ' + (e && e.errMsg))); }
    });
  });
}

/**
 * 把已落盘的 PDF 转发到聊天（文件传输助手 / 任意聊天）。
 * 需在 page 内由用户主动点击触发；从 utils 内部触发可能被微信拦截。
 */
function sharePdfToChat(filePath) {
  return new Promise(function (resolve, reject) {
    wx.shareFileMessage({
      filePath: filePath,
      success: resolve,
      fail: function (e) { reject(new Error('shareFileMessage fail: ' + (e && e.errMsg))); }
    });
  });
}

/**
 * 一次完成"拼 PDF + 写文件"，不预览。返回 filePath。
 *
 * @param {Array} pages 见 miniPdf.buildPdf 的 pages 参数
 * @param {string} fileName
 * @returns {Promise<string>} filePath
 */
function buildAndSavePdf(pages, fileName) {
  const bytes = buildPdf(pages);
  return savePdfToFile(bytes, fileName);
}

/**
 * 一次完成"拼 PDF + 写文件 + 打开预览"。
 *
 * @param {Array} pages
 * @param {string} fileName
 * @returns {Promise<string>} filePath（已被打开预览）
 */
function exportAndPreview(pages, fileName) {
  return buildAndSavePdf(pages, fileName).then(function (fp) {
    return openPdf(fp).then(function () { return fp; });
  });
}

module.exports = {
  buildAndSavePdf,
  exportAndPreview,
  savePdfToFile,
  openPdf,
  sharePdfToChat,
  sanitizeFileName
};

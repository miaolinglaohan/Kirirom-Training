// miniprogram/utils/pdf/pdfScoreSheet.js
// -----------------------------------------------------------------------------
// PDF 渲染器 · 考试总分单
//
// 输入数据结构（来自 pages/hr/assessmentScores）：
//   {
//     assessment: { name, startTime, startTimeText, duration,
//                   totalQuestions, fullScore },
//     applicants: [
//       { name, dept, employeeNo, status, statusText,
//         scoreText, submittedAtText, ... }
//     ],
//     watermark:    string,
//     unitName:     string  // 落款单位名（紧跟表格之后第一行）
//     examDateText: string  // 落款日期（紧跟表格之后第二行，'YYYY年M月D日'）
//     generatedBy:  string  // 操作人姓名，放页脚
//   }
//
// 注意：本渲染器只统计 **已交卷 (status === 'submitted')** 的人员，
//      答题中 / 缺考 / 未参加 全部过滤掉。合格分数线 = 80 分。
//
// 输出：pages[]，每项 = { jpeg, imgW, imgH, pageW, pageH }，
// 喂给 miniPdf.buildPdf / pdfExport.exportAndPreview。
//
// 版式（A4 144 DPI = 1190 × 1684）：
//   ┌───────────────────────────────────────────────┐
//   │  上 90px                                       │
//   │  [首页] 标题 / 元信息行                          │
//   │  表头 + 数据行 × N                              │
//   │  ↕ 32px gap                                    │
//   │  [末页] 右下：单位名（行 1） + 考试日期（行 2）  │
//   │  …                                            │
//   │  页脚：左生成信息 / 中页码 / 右"考试名 · 总分单" │
//   │  + 半透明水印                                   │
//   └───────────────────────────────────────────────┘
// -----------------------------------------------------------------------------

'use strict';

const pdfCanvas = require('./pdfCanvas');

// ----- 版式常量（全部基于 1190×1684 的 A4 像素坐标）-----
const PAD_X         = 100;   // 左右内边距
const PAD_TOP       = 90;    // 顶部内边距
const PAD_BOTTOM    = 80;    // 底部内边距（页脚以上的安全区）
const ROW_H         = 56;    // 表格行高
const HEADER_H      = 64;    // 表头高度
const FOOTER_H      = 50;    // 页脚高度
const TITLE_H       = 80;    // 首页大标题块高度
const META_H        = 56;    // 首页元信息行高度

// 落款（单位名 + 考试日期）：紧跟表格之后
const ISSUER_GAP    = 32;    // 表格底部到落款顶部的间距
const ISSUER_LINE_H = 44;    // 落款行高（约 30px 字号 + 余量）
const ISSUER_H      = ISSUER_LINE_H * 2 + 8;  // 总高度 ~96

// 合格分数线
const PASS_SCORE = 80;

// 表格列定义：sum(width) 必须 = 内容区宽度（1190 - 2*100 = 990）
const COLUMNS = [
  { key: 'idx',    label: '序号',     width:  80, align: 'center' },
  { key: 'name',   label: '姓名',     width: 200, align: 'left'   },
  { key: 'dept',   label: '部门',     width: 240, align: 'left'   },
  { key: 'status', label: '状态',     width: 150, align: 'center' },
  { key: 'time',   label: '提交日期', width: 220, align: 'center' },
  { key: 'score',  label: '分数',     width: 100, align: 'right'  }
];

/** 单页可容纳的行数（不含落款预留；落款另外处理）。 */
function rowsPerPage(isFirst) {
  const available = 1684 - PAD_TOP - PAD_BOTTOM - HEADER_H - FOOTER_H
                  - (isFirst ? (TITLE_H + META_H) : 0);
  return Math.floor(available / ROW_H);
}

/** 简单字符截断，超出 maxPx 显示 "…"。 */
function ellipsis(ctx, text, maxPx) {
  if (!text) return '';
  const s = String(text);
  if (ctx.measureText(s).width <= maxPx) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(s.slice(0, mid) + '…').width <= maxPx) lo = mid;
    else hi = mid - 1;
  }
  return s.slice(0, lo) + '…';
}

/** 按 align 计算 fillText 的 x 锚点。 */
function alignX(colX, colW, align) {
  if (align === 'left')   return colX + 14;
  if (align === 'right')  return colX + colW - 14;
  return colX + colW / 2;
}

/** 把 "YYYY-MM-DD HH:mm" / "YYYY-MM-DD HH:mm:ss" 截到日期部分。 */
function dateOnly(s) {
  if (!s) return '';
  const t = String(s);
  const i = t.indexOf(' ');
  return i > 0 ? t.slice(0, i) : t;
}

/** 画首页标题块。返回新的 y。 */
function drawTitle(ctx, x, y, widthPx, assessment) {
  ctx.fillStyle = '#1a1a1a';
  ctx.font = 'bold 48px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(assessment.name || '考试总分单', widthPx / 2, y + TITLE_H / 2);
  return y + TITLE_H;
}

/** 画元信息行（开考 / 时长 / 题量 / 满分）。返回新的 y。 */
function drawMeta(ctx, x, y, widthPx, metaText) {
  ctx.fillStyle = '#666';
  ctx.font = '24px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(metaText, widthPx / 2, y + META_H / 2);
  return y + META_H;
}

/** 画表头。返回新的 y。 */
function drawTableHeader(ctx, x, y, widthPx) {
  const innerW = widthPx - 2 * PAD_X;
  ctx.fillStyle = '#1bcfad';
  ctx.fillRect(x, y, innerW, HEADER_H);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 26px sans-serif';
  ctx.textBaseline = 'middle';
  let cx = x;
  for (let i = 0; i < COLUMNS.length; i++) {
    const c = COLUMNS[i];
    ctx.textAlign = c.align;
    ctx.fillText(c.label, alignX(cx, c.width, c.align), y + HEADER_H / 2);
    cx += c.width;
  }
  return y + HEADER_H;
}

/** 画单行数据。返回新的 y。 */
function drawTableRow(ctx, x, y, widthPx, row, rowIdx) {
  const innerW = widthPx - 2 * PAD_X;
  if (rowIdx % 2 === 1) {
    ctx.fillStyle = '#fafbfc';
    ctx.fillRect(x, y, innerW, ROW_H);
  }
  ctx.strokeStyle = '#e4e7ed';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y + ROW_H);
  ctx.lineTo(x + innerW, y + ROW_H);
  ctx.stroke();
  ctx.textBaseline = 'middle';
  let cx = x;
  for (let i = 0; i < COLUMNS.length; i++) {
    const c = COLUMNS[i];
    let v = row[c.key];
    if (v == null) v = '';
    if (c.key === 'status') {
      ctx.fillStyle = row._pass ? '#19be6b' : '#c0392b';
      ctx.font = 'bold 26px sans-serif';
    } else if (c.key === 'score') {
      ctx.fillStyle = '#1a1a1a';
      ctx.font = 'bold 26px sans-serif';
    } else {
      ctx.fillStyle = '#1a1a1a';
      ctx.font = '26px sans-serif';
    }
    ctx.textAlign = c.align;
    const text = ellipsis(ctx, String(v), c.width - 28);
    ctx.fillText(text, alignX(cx, c.width, c.align), y + ROW_H / 2);
    cx += c.width;
  }
  return y + ROW_H;
}

/**
 * 画落款块（紧跟在 `topY` 之下，右对齐）：
 *   行 1：单位名（粗）
 *   行 2：考试日期
 */
function drawIssuerBlock(ctx, widthPx, topY, unitName, examDateText) {
  if (!unitName && !examDateText) return;
  const rightX = widthPx - PAD_X;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  let y = topY + ISSUER_LINE_H / 2;
  if (unitName) {
    ctx.fillStyle = '#1a1a1a';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText(String(unitName), rightX, y);
    y += ISSUER_LINE_H;
  }
  if (examDateText) {
    ctx.fillStyle = '#333';
    ctx.font = '26px sans-serif';
    ctx.fillText(String(examDateText), rightX, y);
  }
}

/** 画页脚（左：生成信息 / 中：页码 / 右：考试名 · 总分单）。 */
function drawFooter(ctx, x, widthPx, heightPx, pageIdx, pageCount, generatedBy, assessmentName) {
  const y = heightPx - PAD_BOTTOM + 10;
  ctx.fillStyle = '#888';
  ctx.font = '22px sans-serif';
  ctx.textBaseline = 'middle';

  ctx.textAlign = 'left';
  ctx.fillText('生成：' + new Date().toLocaleString() + (generatedBy ? ' · ' + generatedBy : ''),
               x, y);

  ctx.textAlign = 'center';
  ctx.fillText('第 ' + pageIdx + ' / ' + pageCount + ' 页', widthPx / 2, y);

  ctx.textAlign = 'right';
  const right = (assessmentName ? String(assessmentName) : '考试') + ' · 总分单';
  ctx.fillText(right, widthPx - x, y);
}

/**
 * 主入口：把数据渲染成 PDF 页面字节数组。
 *
 * @param {*} canvas type=2d 的 canvas node
 * @param {object} data
 * @returns {Promise<Array>} pages[]
 */
async function buildScoreSheetPages(canvas, data) {
  const assessment   = data.assessment || {};
  const applicants   = data.applicants || [];
  const watermark    = data.watermark || '';
  const wmStyle      = data.wmStyle || null;   // 水印样式参数（透明度/字号/角度等）
  const unitName     = data.unitName || '';
  const examDateText = data.examDateText || '';
  const generatedBy  = data.generatedBy || '';
  const hasIssuer    = !!(unitName || examDateText);

  // 元信息行文本
  const meta = [
    assessment.startTimeText ? '开考 ' + assessment.startTimeText : null,
    assessment.duration       ? '时长 ' + assessment.duration + ' min' : null,
    assessment.totalQuestions ? '题量 ' + assessment.totalQuestions : null,
    assessment.fullScore      ? '满分 ' + assessment.fullScore : null
  ].filter(Boolean).join('  ·  ');

  // 只保留已交卷的人员，并按规则映射成表格行
  const rows = applicants
    .filter(function (p) { return p && p.status === 'submitted'; })
    .map(function (p, i) {
      let numScore;
      if (typeof p.score === 'number') numScore = p.score;
      else if (p.score != null && !isNaN(Number(p.score))) numScore = Number(p.score);
      else if (p.scoreText != null && !isNaN(Number(p.scoreText))) numScore = Number(p.scoreText);
      else numScore = 0;
      const pass = numScore >= PASS_SCORE;
      return {
        idx:    i + 1,
        name:   p.name || '-',
        dept:   p.dept || '-',
        status: pass ? '合格' : '不合格',
        _pass:  pass,
        time:   dateOnly(p.submittedAtText),     // 只保留日期部分
        score:  String(numScore)
      };
    });

  const total  = rows.length;
  const firstN = rowsPerPage(true);
  const restN  = rowsPerPage(false);

  // 先按"无落款"算页数
  let pageCount;
  if (total === 0) pageCount = 1;
  else if (total <= firstN) pageCount = 1;
  else pageCount = 1 + Math.ceil((total - firstN) / restN);

  // 末页表格底部 Y，用于决定落款放在末页还是追加新页
  const lastPageIsFirst = (pageCount === 1);
  const lastPageRows = lastPageIsFirst
    ? total
    : (total - firstN - (pageCount - 2) * restN);
  const lastPageTableTop = lastPageIsFirst
    ? (PAD_TOP + TITLE_H + META_H)
    : PAD_TOP;
  // 空数据时也保留一行高度（"暂无已交卷人员"占位）
  const effectiveRowsOnLast = (total === 0 && lastPageIsFirst) ? 1 : lastPageRows;
  const lastTableBottomY = lastPageTableTop + HEADER_H + effectiveRowsOnLast * ROW_H;

  // 末页底部安全线
  const safeBottom = 1684 - PAD_BOTTOM - FOOTER_H;
  const issuerNeed = ISSUER_GAP + ISSUER_H;
  // 末页装不下 → 追加一空白末页只放表头 + 落款（极少见）
  const issuerOnExtraPage = hasIssuer && ((safeBottom - lastTableBottomY) < issuerNeed);
  if (issuerOnExtraPage) pageCount += 1;

  const pages = [];
  for (let p = 0; p < pageCount; p++) {
    const isFirst = (p === 0);
    const isLast  = (p === pageCount - 1);
    const isExtraIssuerPage = issuerOnExtraPage && isLast;

    // 当前页要画的行区间（issuer extra 页不画行）
    let pageRows = [];
    let start = 0;
    if (!isExtraIssuerPage) {
      let end;
      if (isFirst) {
        start = 0;
        end   = Math.min(total, firstN);
      } else {
        start = firstN + (p - 1) * restN;
        end   = Math.min(total, start + restN);
      }
      pageRows = rows.slice(start, end);
    }

    const ctxInfo  = pdfCanvas.prepareCanvas(canvas);
    const ctx      = ctxInfo.ctx;
    const widthPx  = ctxInfo.widthPx;
    const heightPx = ctxInfo.heightPx;
    pdfCanvas.drawWhiteBg(ctx, widthPx, heightPx);

    let y = PAD_TOP;

    // 首页（同时也可能是末页）画标题+元信息
    // issuer extra page 是末页但不是首页，直接跳过
    if (isFirst && !isExtraIssuerPage) {
      y = drawTitle(ctx, PAD_X, y, widthPx, assessment);
      y = drawMeta(ctx, PAD_X, y, widthPx, meta);
    }

    if (!isExtraIssuerPage) {
      y = drawTableHeader(ctx, PAD_X, y, widthPx);
      for (let i = 0; i < pageRows.length; i++) {
        y = drawTableRow(ctx, PAD_X, y, widthPx, pageRows[i], start + i);
      }

      // 首页且无数据 → 空提示
      if (total === 0 && isFirst) {
        ctx.fillStyle = '#999';
        ctx.font = '28px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('（暂无已交卷人员）', widthPx / 2, y + ROW_H / 2);
        y += ROW_H;
      }
    }

    // 落款放在末页表格下方（隔 ISSUER_GAP）
    if (isLast && hasIssuer) {
      const issuerTop = isExtraIssuerPage ? PAD_TOP : (y + ISSUER_GAP);
      drawIssuerBlock(ctx, widthPx, issuerTop, unitName, examDateText);
    }

    drawFooter(ctx, PAD_X, widthPx, heightPx, p + 1, pageCount, generatedBy, assessment.name);
    pdfCanvas.drawWatermark(ctx, watermark, widthPx, heightPx, wmStyle);

    const jpeg = await pdfCanvas.canvasToJpegBytes(canvas, { quality: 0.85 });
    pages.push({
      jpeg: jpeg,
      imgW: widthPx,
      imgH: heightPx,
      pageW: ctxInfo.pageW,
      pageH: ctxInfo.pageH
    });
  }

  return pages;
}

module.exports = {
  buildScoreSheetPages
};

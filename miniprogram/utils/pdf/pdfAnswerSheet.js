// miniprogram/utils/pdf/pdfAnswerSheet.js
// -----------------------------------------------------------------------------
// PDF 渲染器 · 个人答卷复盘
//
// 输入数据结构（来自 pages/hr/applicantReview）：
//   {
//     assessment:   { name },
//     employee:     { name, dept, role },
//     enrollment:   { score, fullScore, rightNum, total, submittedAtText,
//                     switchCount, isMock },
//     questions:    [ { _id, title, typecode, typename, options:[{code,content}],
//                       comments } ],
//     userAnswers:  { qid: [codes...] },
//     officialMap:  { qid: [codes...] },
//     rightFlags:   [ bool ],
//     watermark:    string,
//     unitName:     string,
//     examDateText: string,
//     generatedBy:  string
//   }
//
// 输出：pages[]，每项 = { jpeg, imgW, imgH, pageW, pageH }
//
// 版式（A4 144 DPI = 1190 × 1684）：
//   首页头部：
//     标题（考试名，44 bold） + 副信息（姓名/部门/交卷时间/切屏）
//     成绩行（得分 X/Y · 答对 N/M，28 bold）
//     分割线
//   重复题块（动态高度）：
//     第 N 题 · 类型           ✓正确 / ✗错误
//     题干（自动换行）
//     选项卡（按 4 态染色：对/错/漏/普通）
//     答案行：他的答案 / 正确答案
//     [解析]（如果有 comments）
//   末页：题块之后追加落款（单位名 + 考试日期，右对齐）
//   每页页脚：左生成信息 · 中页码 · 右"考试名 · 姓名 答卷"
// -----------------------------------------------------------------------------

'use strict';

const pdfCanvas = require('./pdfCanvas');

// ----- 画布尺寸 -----
const WIDTH     = 1190;
const HEIGHT    = 1684;
const PAD_X     = 80;
const PAD_TOP   = 90;
const PAD_BOTTOM = 80;
const FOOTER_H  = 50;
const CONTENT_W = WIDTH - 2 * PAD_X;

// ----- 首页头部 -----
const TITLE_H    = 70;
const SUBTITLE_H = 40;
const SCORE_H    = 44;
const HEADER_DIVIDER_GAP = 26;

// ----- 字号 & 行高 -----
const FONT_STEM = 26, LINE_STEM = 40;
const FONT_OPT  = 26, LINE_OPT  = 38;
const FONT_META = 24, LINE_META = 36;
const FONT_CMT  = 22, LINE_CMT  = 32;

// ----- 题块内部 -----
const Q_HEADER_H            = 38;
const Q_GAP_AFTER_HEADER    = 6;
const Q_GAP_AFTER_STEM      = 12;
const Q_OPT_PAD_Y           = 8;       // 选项盒上下内边距
const Q_OPT_GAP             = 6;       // 选项之间间距
const Q_GAP_AFTER_OPTS      = 14;
const Q_GAP_AFTER_META      = 10;
const Q_GAP_BETWEEN         = 28;      // 两题之间空白
const Q_CMT_PAD             = 10;      // 解析盒内边距

// ----- 落款 -----
const ISSUER_GAP    = 32;
const ISSUER_LINE_H = 42;

// 选项 4 态配色（与 review 页面色相对齐）
const OPT_COLORS = {
  'answered-right': { bg: '#eaf8ef', border: '#19be6b', text: '#1a1a1a', dash: false },
  'answered-wrong': { bg: '#fceaea', border: '#c0392b', text: '#1a1a1a', dash: false },
  'official-only':  { bg: '#ffffff', border: '#19be6b', text: '#1a1a1a', dash: true  },
  'plain':          { bg: '#ffffff', border: '#e4e7ed', text: '#444',    dash: false }
};

const TYPE_LABEL = { '01': '单选题', '02': '多选题', '03': '判断题' };

// -----------------------------------------------------------------------------
// 文本换行（按字符贪心断行；同时尊重原文里的 \n）
// 注意：调用前请先 set ctx.font，否则 measureText 用的不是预期字号。
// -----------------------------------------------------------------------------
function wrapText(ctx, text, maxPx) {
  const lines = [];
  const src = String(text == null ? '' : text).replace(/\r/g, '');
  const paragraphs = src.split('\n');
  for (let pi = 0; pi < paragraphs.length; pi++) {
    const p = paragraphs[pi];
    if (p === '') { lines.push(''); continue; }
    let line = '';
    for (let i = 0; i < p.length; i++) {
      const ch = p.charAt(i);
      const test = line + ch;
      if (ctx.measureText(test).width > maxPx && line !== '') {
        lines.push(line);
        line = ch;
      } else {
        line = test;
      }
    }
    if (line !== '') lines.push(line);
  }
  return lines;
}

// -----------------------------------------------------------------------------
// 单题排版：算出所有可视元素的换行 + 总高
// -----------------------------------------------------------------------------
function layoutQuestion(ctx, q, idx, rightFlag, userCodes, officialCodes) {
  const typecode = String(q.typecode || '01');
  const typeLabel = q.typename || TYPE_LABEL[typecode] || '题目';

  const userSet = {};
  (userCodes || []).forEach(c => { userSet[String(c).toUpperCase()] = true; });
  const officialSet = {};
  (officialCodes || []).forEach(c => { officialSet[String(c).toUpperCase()] = true; });

  // 题干（带 "N. " 前缀）
  ctx.font = FONT_STEM + 'px sans-serif';
  const stemPrefix = (idx + 1) + '. ';
  const stemLines = wrapText(ctx, stemPrefix + (q.title || ''), CONTENT_W);

  // 选项
  ctx.font = FONT_OPT + 'px sans-serif';
  const opts = (q.options || []).map(opt => {
    const code = String(opt.code).toUpperCase();
    const isUser = !!userSet[code];
    const isOfficial = !!officialSet[code];
    let state;
    if (isUser && isOfficial)        state = 'answered-right';
    else if (isUser && !isOfficial)  state = 'answered-wrong';
    else if (!isUser && isOfficial)  state = 'official-only';
    else                              state = 'plain';
    // 选项盒内左右内边距：16 + tag 宽度（"他选" / "正确" 标签预留 ~80px）
    const innerW = CONTENT_W - 32 - 90;
    const lines = wrapText(ctx, code + '.  ' + (opt.content || ''), innerW);
    return {
      code, isUser, isOfficial, state, lines,
      height: lines.length * LINE_OPT + 2 * Q_OPT_PAD_Y
    };
  });
  const optsH = opts.reduce((a, o) => a + o.height, 0)
              + Math.max(0, opts.length - 1) * Q_OPT_GAP;

  // 答案行
  const userKeysArr = Object.keys(userSet).sort();
  const officialKeysArr = Object.keys(officialSet).sort();
  const userText = userKeysArr.length ? userKeysArr.join('、') : '未作答';
  const officialText = officialKeysArr.length ? officialKeysArr.join('、') : '-';

  // 解析（可选）
  let cmtLines = null;
  let cmtH = 0;
  if (q.comments && String(q.comments).trim()) {
    ctx.font = FONT_CMT + 'px sans-serif';
    cmtLines = wrapText(ctx, '解析：' + q.comments, CONTENT_W - 2 * Q_CMT_PAD);
    cmtH = cmtLines.length * LINE_CMT + 2 * Q_CMT_PAD;
  }

  const stemH = stemLines.length * LINE_STEM;
  const totalH = Q_HEADER_H + Q_GAP_AFTER_HEADER
               + stemH + Q_GAP_AFTER_STEM
               + optsH + Q_GAP_AFTER_OPTS
               + LINE_META + Q_GAP_AFTER_META
               + (cmtH ? cmtH + Q_GAP_AFTER_META : 0);

  return {
    idx, typeLabel, isRight: !!rightFlag,
    stemLines, opts, userText, officialText,
    cmtLines, cmtH,
    height: totalH
  };
}

// -----------------------------------------------------------------------------
// 分页：贪心装箱
// -----------------------------------------------------------------------------
function packPages(blocks, firstHeaderH, issuerNeedH) {
  const contentBottom = HEIGHT - PAD_BOTTOM - FOOTER_H;
  const pages = [];
  let cur = { blocks: [], startY: PAD_TOP + firstHeaderH, y: PAD_TOP + firstHeaderH, isFirst: true };

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const need = b.height + (cur.blocks.length > 0 ? Q_GAP_BETWEEN : 0);
    if (cur.y + need > contentBottom && cur.blocks.length > 0) {
      pages.push(cur);
      cur = { blocks: [], startY: PAD_TOP, y: PAD_TOP, isFirst: false };
    }
    if (cur.blocks.length > 0) cur.y += Q_GAP_BETWEEN;
    cur.blocks.push(b);
    cur.y += b.height;
  }
  pages.push(cur);

  // 空题数据兜底：保证至少 1 页
  if (pages.length === 0) {
    pages.push({ blocks: [], startY: PAD_TOP + firstHeaderH, y: PAD_TOP + firstHeaderH, isFirst: true });
  }

  // 末页落款空间检查
  pages[pages.length - 1].isLast = true;
  if (issuerNeedH > 0) {
    const last = pages[pages.length - 1];
    if (last.y + ISSUER_GAP + issuerNeedH > contentBottom) {
      // 追加一空白末页
      pages.push({ blocks: [], startY: PAD_TOP, y: PAD_TOP, isFirst: false, isLast: true });
      last.isLast = false;
    }
  }

  return pages;
}

// -----------------------------------------------------------------------------
// 绘制：首页头部
// -----------------------------------------------------------------------------
function drawHeader(ctx, data) {
  let y = PAD_TOP;
  const e = data.employee || {};
  const er = data.enrollment || {};
  const a = data.assessment || {};

  // 标题
  ctx.fillStyle = '#1a1a1a';
  ctx.font = 'bold 44px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(a.name || '考试答卷', WIDTH / 2, y + TITLE_H / 2);
  y += TITLE_H;

  // 副标题：姓名 · 部门 · 提交时间 [· 切屏 N 次]
  const subParts = [
    (e.name || '(未知)'),
    e.dept ? '部门 ' + e.dept : null,
    er.submittedAtText ? '交卷 ' + er.submittedAtText : null
  ].filter(Boolean);
  if (er.switchCount > 0) subParts.push('⚠ 切屏 ' + er.switchCount + ' 次');
  ctx.fillStyle = '#666';
  ctx.font = '24px sans-serif';
  ctx.fillText(subParts.join('   ·   '), WIDTH / 2, y + SUBTITLE_H / 2);
  y += SUBTITLE_H;

  // 成绩行
  const score    = er.score == null ? 0 : er.score;
  const fullS    = er.fullScore || 0;
  const rightN   = er.rightNum  || 0;
  const totalN   = er.total     || 0;
  const scoreTxt = '得分 ' + score + ' / ' + fullS + '    答对 ' + rightN + ' / ' + totalN;
  ctx.fillStyle = '#1a1a1a';
  ctx.font = 'bold 30px sans-serif';
  ctx.fillText(scoreTxt, WIDTH / 2, y + SCORE_H / 2);
  y += SCORE_H;

  // 分割线
  y += 8;
  ctx.strokeStyle = '#e4e7ed';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD_X, y);
  ctx.lineTo(WIDTH - PAD_X, y);
  ctx.stroke();
  y += HEADER_DIVIDER_GAP - 8;

  return y;
}

// -----------------------------------------------------------------------------
// 绘制：单个题块
// -----------------------------------------------------------------------------
function drawQuestionBlock(ctx, yStart, b) {
  let y = yStart;

  // 标题行
  ctx.font = 'bold 26px sans-serif';
  ctx.fillStyle = '#1a1a1a';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const hdr = '第 ' + (b.idx + 1) + ' 题  ·  ' + b.typeLabel;
  ctx.fillText(hdr, PAD_X, y + Q_HEADER_H / 2);

  // 对错徽章（右）
  ctx.fillStyle = b.isRight ? '#19be6b' : '#c0392b';
  ctx.font = 'bold 24px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(b.isRight ? '✓ 正确' : '✗ 错误', WIDTH - PAD_X, y + Q_HEADER_H / 2);
  y += Q_HEADER_H + Q_GAP_AFTER_HEADER;

  // 题干
  ctx.font = FONT_STEM + 'px sans-serif';
  ctx.fillStyle = '#1a1a1a';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < b.stemLines.length; i++) {
    ctx.fillText(b.stemLines[i], PAD_X, y + LINE_STEM / 2);
    y += LINE_STEM;
  }
  y += Q_GAP_AFTER_STEM;

  // 选项
  for (let i = 0; i < b.opts.length; i++) {
    y = drawOption(ctx, y, b.opts[i]);
    if (i < b.opts.length - 1) y += Q_OPT_GAP;
  }
  y += Q_GAP_AFTER_OPTS;

  // 答案行
  ctx.font = FONT_META + 'px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  // 左：他的答案（按对错染色）
  ctx.fillStyle = '#666';
  const label1 = '他的答案：';
  ctx.fillText(label1, PAD_X, y + LINE_META / 2);
  const label1W = ctx.measureText(label1).width;
  ctx.fillStyle = b.isRight ? '#19be6b' : '#c0392b';
  ctx.font = 'bold ' + FONT_META + 'px sans-serif';
  ctx.fillText(b.userText, PAD_X + label1W, y + LINE_META / 2);

  // 右：正确答案（绿）
  ctx.fillStyle = '#666';
  ctx.font = FONT_META + 'px sans-serif';
  const label2 = '正确答案：';
  ctx.textAlign = 'left';
  // 把正确答案块整体右对齐：先算总宽，再画
  ctx.font = 'bold ' + FONT_META + 'px sans-serif';
  const officialValW = ctx.measureText(b.officialText).width;
  ctx.font = FONT_META + 'px sans-serif';
  const label2W = ctx.measureText(label2).width;
  const block2W = label2W + officialValW;
  const block2X = WIDTH - PAD_X - block2W;
  ctx.fillStyle = '#666';
  ctx.fillText(label2, block2X, y + LINE_META / 2);
  ctx.fillStyle = '#19be6b';
  ctx.font = 'bold ' + FONT_META + 'px sans-serif';
  ctx.fillText(b.officialText, block2X + label2W, y + LINE_META / 2);

  y += LINE_META + Q_GAP_AFTER_META;

  // 解析（如有）
  if (b.cmtLines && b.cmtLines.length > 0) {
    const cmtY = y;
    const cmtH = b.cmtH;
    // 浅蓝灰底色 + 左侧色条
    ctx.fillStyle = '#f5f7fa';
    ctx.fillRect(PAD_X, cmtY, CONTENT_W, cmtH);
    ctx.fillStyle = '#2d8cf0';
    ctx.fillRect(PAD_X, cmtY, 4, cmtH);

    ctx.fillStyle = '#444';
    ctx.font = FONT_CMT + 'px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    let cy = cmtY + Q_CMT_PAD + LINE_CMT / 2;
    for (let i = 0; i < b.cmtLines.length; i++) {
      ctx.fillText(b.cmtLines[i], PAD_X + Q_CMT_PAD + 8, cy);
      cy += LINE_CMT;
    }
    y += cmtH + Q_GAP_AFTER_META;
  }

  return y;
}

// 绘制单个选项盒
function drawOption(ctx, yStart, opt) {
  const c = OPT_COLORS[opt.state] || OPT_COLORS.plain;
  const h = opt.height;
  const x = PAD_X;
  const w = CONTENT_W;

  // 背景
  ctx.fillStyle = c.bg;
  ctx.fillRect(x, yStart, w, h);
  // 边框
  ctx.strokeStyle = c.border;
  ctx.lineWidth = c.dash ? 2 : 1.5;
  if (c.dash && ctx.setLineDash) ctx.setLineDash([6, 4]);
  ctx.strokeRect(x + 0.5, yStart + 0.5, w - 1, h - 1);
  if (ctx.setLineDash) ctx.setLineDash([]);

  // 文字
  ctx.fillStyle = c.text;
  ctx.font = FONT_OPT + 'px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let ty = yStart + Q_OPT_PAD_Y + LINE_OPT / 2;
  for (let i = 0; i < opt.lines.length; i++) {
    ctx.fillText(opt.lines[i], x + 16, ty);
    ty += LINE_OPT;
  }

  // 右侧标签：他选 / 正确（小色块，竖排）
  const tagW = 70;
  const tagH = 26;
  const tagX = x + w - tagW - 10;
  let tagY = yStart + 8;
  ctx.font = 'bold 18px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (opt.isUser) {
    ctx.fillStyle = '#c0392b';
    ctx.fillRect(tagX, tagY, tagW, tagH);
    ctx.fillStyle = '#fff';
    ctx.fillText('他选', tagX + tagW / 2, tagY + tagH / 2);
    tagY += tagH + 4;
  }
  if (opt.isOfficial) {
    ctx.fillStyle = '#19be6b';
    ctx.fillRect(tagX, tagY, tagW, tagH);
    ctx.fillStyle = '#fff';
    ctx.fillText('正确', tagX + tagW / 2, tagY + tagH / 2);
  }

  return yStart + h;
}

// -----------------------------------------------------------------------------
// 绘制：落款（与 pdfScoreSheet 同口径）
// -----------------------------------------------------------------------------
function drawIssuerBlock(ctx, topY, unitName, examDateText) {
  if (!unitName && !examDateText) return;
  const rightX = WIDTH - PAD_X;
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

// -----------------------------------------------------------------------------
// 绘制：页脚
// -----------------------------------------------------------------------------
function drawFooter(ctx, pageIdx, pageCount, data) {
  const y = HEIGHT - PAD_BOTTOM + 10;
  ctx.fillStyle = '#888';
  ctx.font = '22px sans-serif';
  ctx.textBaseline = 'middle';

  ctx.textAlign = 'left';
  ctx.fillText('生成：' + new Date().toLocaleString()
               + (data.generatedBy ? ' · ' + data.generatedBy : ''), PAD_X, y);

  ctx.textAlign = 'center';
  ctx.fillText('第 ' + pageIdx + ' / ' + pageCount + ' 页', WIDTH / 2, y);

  ctx.textAlign = 'right';
  const aName = (data.assessment && data.assessment.name) || '考试';
  const eName = (data.employee && data.employee.name) || '';
  const right = aName + ' · ' + (eName ? eName + ' 答卷' : '答卷');
  ctx.fillText(right, WIDTH - PAD_X, y);
}

// -----------------------------------------------------------------------------
// 主入口
// -----------------------------------------------------------------------------
async function buildAnswerSheetPages(canvas, data) {
  const questions    = data.questions || [];
  const userAnswers  = data.userAnswers || {};
  const officialMap  = data.officialMap || {};
  const rightFlags   = data.rightFlags || [];
  const watermark    = data.watermark || '';
  const unitName     = data.unitName || '';
  const examDateText = data.examDateText || '';
  const hasIssuer    = !!(unitName || examDateText);

  // 拿到 canvas + ctx；后续既用于排版测量，也用于真实绘制
  const ctxInfo  = pdfCanvas.prepareCanvas(canvas);
  const ctx      = ctxInfo.ctx;
  const widthPx  = ctxInfo.widthPx;
  const heightPx = ctxInfo.heightPx;

  // 1) 排版：算出每题块的高度
  const blocks = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    blocks.push(layoutQuestion(
      ctx, q, i, rightFlags[i],
      userAnswers[q._id], officialMap[q._id]
    ));
  }

  // 2) 分页
  const firstHeaderH = TITLE_H + SUBTITLE_H + SCORE_H + HEADER_DIVIDER_GAP;
  const issuerNeedH  = (unitName ? ISSUER_LINE_H : 0) + (examDateText ? ISSUER_LINE_H : 0);
  const pages = packPages(blocks, firstHeaderH, issuerNeedH);

  // 3) 渲染
  const results = [];
  for (let p = 0; p < pages.length; p++) {
    const page = pages[p];
    pdfCanvas.drawWhiteBg(ctx, widthPx, heightPx);

    let y;
    if (page.isFirst) y = drawHeader(ctx, data);
    else              y = PAD_TOP;

    for (let i = 0; i < page.blocks.length; i++) {
      if (i > 0) y += Q_GAP_BETWEEN;
      y = drawQuestionBlock(ctx, y, page.blocks[i]);
    }

    // 首页且无题目 → 空提示
    if (page.isFirst && blocks.length === 0) {
      ctx.fillStyle = '#999';
      ctx.font = '28px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('（该答卷无题目快照）', widthPx / 2, y + 60);
      y += 120;
    }

    if (page.isLast && hasIssuer) {
      const issuerTop = (page.blocks.length === 0 && !page.isFirst)
        ? PAD_TOP
        : y + ISSUER_GAP;
      drawIssuerBlock(ctx, issuerTop, unitName, examDateText);
    }

    drawFooter(ctx, p + 1, pages.length, data);
    pdfCanvas.drawWatermark(ctx, watermark, widthPx, heightPx);

    const jpeg = await pdfCanvas.canvasToJpegBytes(canvas, { quality: 0.85 });
    results.push({
      jpeg,
      imgW: widthPx,
      imgH: heightPx,
      pageW: ctxInfo.pageW,
      pageH: ctxInfo.pageH
    });
  }

  return results;
}

module.exports = {
  buildAnswerSheetPages,
  buildBatchAnswerSheetPages
};

// -----------------------------------------------------------------------------
// 主入口（批量）· 多人答卷合并 PDF
//
// 输入：
//   {
//     assessment:   { name },        // 顶部标题用考试名（所有人共享）
//     persons:      [ {              // 每人一份答卷数据
//       employee:    { name, dept, role },
//       enrollment:  { score, fullScore, rightNum, total, submittedAtText,
//                      switchCount, isMock },
//       questions:   [...],
//       userAnswers: { qid: [...] },
//       officialMap: { qid: [...] },
//       rightFlags:  [...]
//     } ],
//     watermark:    string,
//     unitName:     string,
//     examDateText: string,
//     generatedBy:  string,
//     onProgress:   (renderedPages, totalPages) => void  // 可选，渲染进度回调
//   }
//
// 行为：
//   - 每个人各自从新页开始（换人=强制换页）
//   - 人内的题块自然换页
//   - 全局连续页码：第 X / 总N 页
//   - 单位名+考试日期 只在整本 PDF 的最末页右下角出一次
//   - 页脚右侧文案随当前页所属员工切换：<考试名> · <员工名> 答卷
// -----------------------------------------------------------------------------
async function buildBatchAnswerSheetPages(canvas, batchData) {
  const persons          = batchData.persons || [];
  const sharedAssessment = batchData.assessment || {};
  const watermark        = batchData.watermark || '';
  const unitName         = batchData.unitName || '';
  const examDateText     = batchData.examDateText || '';
  const generatedBy      = batchData.generatedBy || '';
  const onProgress       = batchData.onProgress;
  const hasIssuer        = !!(unitName || examDateText);
  const issuerNeedH      = (unitName ? ISSUER_LINE_H : 0) + (examDateText ? ISSUER_LINE_H : 0);

  const ctxInfo  = pdfCanvas.prepareCanvas(canvas);
  const ctx      = ctxInfo.ctx;
  const widthPx  = ctxInfo.widthPx;
  const heightPx = ctxInfo.heightPx;

  const firstHeaderH = TITLE_H + SUBTITLE_H + SCORE_H + HEADER_DIVIDER_GAP;

  // -- 1) 每个人各自 layout + pack，得到 page 列表，并附挂 personData 用于渲染
  const allPages = [];
  for (let pi = 0; pi < persons.length; pi++) {
    const person      = persons[pi];
    const questions   = person.questions   || [];
    const userAnswers = person.userAnswers || {};
    const officialMap = person.officialMap || {};
    const rightFlags  = person.rightFlags  || [];

    const blocks = [];
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      blocks.push(layoutQuestion(
        ctx, q, i, rightFlags[i],
        userAnswers[q._id], officialMap[q._id]
      ));
    }
    // 单人分页（issuer 留到全局处理）
    const personPages = packPages(blocks, firstHeaderH, 0);
    // 清掉 packPages 自动写上的 isLast，避免被误识别为整本末页
    personPages.forEach(p => { p.isLast = false; });

    const personData = {
      assessment:  sharedAssessment,
      employee:    person.employee   || {},
      enrollment:  person.enrollment || {},
      generatedBy: generatedBy
    };
    const hasNoQuestions = blocks.length === 0;
    for (let k = 0; k < personPages.length; k++) {
      personPages[k].personData = personData;
      personPages[k].emptyAnswer = hasNoQuestions && k === 0;
      allPages.push(personPages[k]);
    }
  }

  // 兜底：批量为空时也至少要 1 页（写在最前面，免得后面 last.y 等访问异常）
  if (allPages.length === 0) {
    allPages.push({
      blocks: [], startY: PAD_TOP, y: PAD_TOP,
      isFirst: false, isLast: false,
      personData: { assessment: sharedAssessment, employee: {}, enrollment: {}, generatedBy: generatedBy },
      emptyBatch: true
    });
  }

  // -- 2) 末页落款空间检查；不够就追加空白末页
  if (hasIssuer) {
    const last = allPages[allPages.length - 1];
    const contentBottom = HEIGHT - PAD_BOTTOM - FOOTER_H;
    if (last.y + ISSUER_GAP + issuerNeedH > contentBottom) {
      allPages.push({
        blocks: [], startY: PAD_TOP, y: PAD_TOP,
        isFirst: false, isLast: false,
        personData: last.personData
      });
    }
  }
  allPages[allPages.length - 1].isLast = true;

  // -- 3) 渲染
  const results = [];
  const pageCount = allPages.length;
  for (let p = 0; p < pageCount; p++) {
    const page = allPages[p];
    const personData = page.personData;

    pdfCanvas.drawWhiteBg(ctx, widthPx, heightPx);

    let y;
    if (page.isFirst) y = drawHeader(ctx, personData);
    else              y = PAD_TOP;

    for (let i = 0; i < page.blocks.length; i++) {
      if (i > 0) y += Q_GAP_BETWEEN;
      y = drawQuestionBlock(ctx, y, page.blocks[i]);
    }

    if (page.emptyAnswer) {
      ctx.fillStyle = '#999';
      ctx.font = '28px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('（该答卷无题目快照）', widthPx / 2, y + 60);
      y += 120;
    }
    if (page.emptyBatch) {
      ctx.fillStyle = '#999';
      ctx.font = '28px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('（暂无可导出的答卷）', widthPx / 2, heightPx / 2);
    }

    if (page.isLast && hasIssuer) {
      const issuerTop = (page.blocks.length === 0 && !page.isFirst)
        ? PAD_TOP
        : y + ISSUER_GAP;
      drawIssuerBlock(ctx, issuerTop, unitName, examDateText);
    }

    drawFooter(ctx, p + 1, pageCount, personData);
    pdfCanvas.drawWatermark(ctx, watermark, widthPx, heightPx);

    const jpeg = await pdfCanvas.canvasToJpegBytes(canvas, { quality: 0.85 });
    results.push({
      jpeg,
      imgW: widthPx,
      imgH: heightPx,
      pageW: ctxInfo.pageW,
      pageH: ctxInfo.pageH
    });

    if (typeof onProgress === 'function') {
      try { onProgress(p + 1, pageCount); } catch (_) { /* ignore */ }
    }
  }

  return results;
}

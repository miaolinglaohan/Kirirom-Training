# Phase 3 规划 — 多题型升级 + HR Web 后台 + 成绩单 PDF 导出

> 起草日期：2026-06-28
> 状态：**5 项关键决策已拍板，待开工**
> 上一阶段：[`v0.2-phase2`](../CHANGELOG.md) — 考场服务端化 + 复盘 + 错题本
> 下一里程碑：`v0.3-phase3`（含 3 个子 tag）

---

## 0. 阶段目标

**一句话**：让 HR 摆脱云开发控制台手工 CRUD 的原始操作，并把题库能力扩展到单选 / 多选 / 判断三种题型，配合可导出的 PDF 成绩单形成完整闭环。

**完工后的工作流**：
1. HR 用浏览器打开静态托管的后台 → 扫码登录
2. HR 在后台维护题库（按业务分多个 subject，含三种题型）
3. HR 新建考试时：选题库 + 配置三类题数与分值 + 选目标部门 + 设时间窗
4. 考试进行中员工照常答题（小程序端无感升级）
5. 考试结束后 HR 在后台查看成绩 → 一键导出 PDF（带可配置水印）

---

## 1. 关键决策（已拍板）

| # | 决策点 | 选项 | 理由 |
|---|---|---|---|
| 1 | 多选题判分 | **严格判分**（集合完全相等才得分） | 培训性质要的就是"敢不敢确定"，半分会让员工蒙也愿意点 |
| 2 | 判断题 UI | **两个大按钮**（✓ 正确 / ✗ 错误） | 移动端单指点击友好，比 A/B 选项更直觉 |
| 3 | 题目录入 | **一期手工，二期 Excel 批量导入** | Excel 解析+校验+错误提示是个吞工期的活，先把闭环跑通 |
| 4 | 配置校验 | **保存考试时提前校验题库存量** | HR 保存时即时报错"判断题库存仅 2 道"，避免员工进考场才发现 |
| 5 | 总分换算 | **自动识别**（看 `fullScore` 字段） | 跨年度统计保留语义清晰；老记录保持原显示 |

---

## 2. 数据模型变更

### 2.1 `questions` 集合 — 扩展题型枚举

| typecode | 名称 | options 结构 |
|---|---|---|
| `01` | 单选 | `[{code:'A',content,value}, ...]` 一个 value=1 |
| `02` | 多选 | `[{code:'A',content,value}, ...]` 多个 value=1 |
| **`03`** | **判断（新）** | `[{code:'A',content:'正确',value:'1'/'0'}, {code:'B',content:'错误',value:'1'/'0'}]` |

判断题刻意复用与单选一致的 options 结构 → 抽题/判分/复盘代码完全复用，**只在 wxml 渲染层识别 typecode=03 时切换 UI**。

### 2.2 `assessments` 集合 — 配置化

**新字段**：
```js
{
  // ...原字段保留
  questionConfig: {
    single: { count: 5, score: 4 },    // → 20 分
    multi:  { count: 3, score: 10 },   // → 30 分
    judge:  { count: 5, score: 10 }    // → 50 分
  }
  // 派生：totalQuestions = 13，fullScore = 100
}
```

**兼容性**：旧字段 `questionCount` 保留作为兜底——如只填 `questionCount` 不填 `questionConfig`，按"全部单选每题 1 分"处理。

### 2.3 `historys` 集合 — 总分字段

| 字段 | 含义 | 何时写入 |
|---|---|---|
| `rightNum` | 答对题数（保留） | 一直写 |
| `score` | 实际得分（如 82） | Phase 3 起 |
| `fullScore` | 满分（如 100） | Phase 3 起 |
| `scoreDetail` | 每题得分明细 `[{qid, typecode, earned, full}]` | Phase 3 起 |

### 2.4 `systemConfig` 集合（新建，单文档）

```js
{
  _id: 'main',
  watermarkText: 'KIRIROM 内部资料 · 仅限培训使用',
  pdfFooter: '本成绩单仅供内部存档，请勿外传',
  updatedAt: Date,
  updatedBy: 'HR 名字'
}
```

---

## 3. 云函数改动清单

### 3.1 改动现有云函数

| 函数 | 改动 |
|---|---|
| `enterExam` | 抽题改为"按 typecode 分桶分别抽"；新增错误码 `NOT_ENOUGH_QUESTIONS`，message 字段说明缺哪一类多少道 |
| `submitExam` | 判分用 `questionConfig` 分值算；写 historys 时带 `score / fullScore / scoreDetail` |
| `listMyAssessments` | 返回时派生 `totalQuestions / fullScore` 一起下发 |

### 3.2 新增云函数

| 函数 | 用途 | 入参 | 返回 |
|---|---|---|---|
| `listAssessmentScores` | HR 导出 PDF 用 | `{ assessmentId }` | `{ ok, assessment, applicants: [{name, dept, score, fullScore, status, submittedAt}] }` 状态枚举 `submitted/in_progress/absent` |
| `saveSystemConfig` | HR 改水印用 | `{ watermarkText?, pdfFooter? }` | `{ ok }`（云函数内校验 admin 身份） |
| `validateAssessmentConfig` | 建考试前校验题库存量 | `{ subjectId, questionConfig }` | `{ ok: true }` 或 `{ ok:false, code:'NOT_ENOUGH', detail:[{typecode, need, have}] }` |

### 3.3 admin 鉴权

HR 后台云函数统一通过新增中间件 / 共享代码片段查 `adminSessions` 表确认调用者角色，沿用 v1 已设计但 Phase 2 暂未启用的方案。`adminLogin`/`adminVerify` 见 Phase 4 章节，但 Phase 3 提前落地（HR 后台必依赖）。

---

## 4. 前端改动清单

### 4.1 小程序端（轻量改造）

| 页面 | 改动 |
|---|---|
| `pages/exam` | typecode=03 渲染两个大按钮 UI（✓ 正确 / ✗ 错误）；顶部进度条改为显示"已答 X / 共 Y 题 · 满分 Z" |
| `pages/examresult` | 同时兼容旧"4/5"和新"82/100"两种显示，按 fullScore 是否存在自动选择 |
| `pages/review` | 自动识别 fullScore；判断题选项也用对/错大按钮形态展示 |
| `pages/mistakes` | 聚合时显示新分制 |

### 4.2 HR Web 后台（全新）

**技术栈**：单 HTML 文件 + Element Plus CDN + Vanilla JS + jsPDF + 思源黑体子集（约 1.5MB）
**部署**：云开发静态网站托管（零月费）
**登录**：小程序扫码取 6 位码 → 浏览器输入 → 云函数 `adminVerify` 换 sessionToken（localStorage 存）

**页面结构（单 HTML，前端路由）**：

```
登录页
└── 工作台（顶栏菜单切换）
    ├── 员工管理     (3.2)
    ├── 题库管理     (3.3)
    │   ├── 题库列表（按 subject 分组）
    │   └── 题目编辑器（typecode 下拉）
    ├── 考试管理     (3.4)
    │   ├── 考试列表
    │   └── 新建/编辑考试（含三类题数+分值表单 + 保存前校验）
    ├── 成绩中心     (3.5)
    │   ├── 考试列表
    │   └── 某场考试详情（应到/实到/缺考标记 + 导出 PDF 按钮）
    └── 系统设置     (3.6)
        └── 水印文字 + PDF 页脚 编辑
```

### 4.3 PDF 导出实现要点

**核心库**：jsPDF
**字体**：思源黑体 Regular 子集（用 fontmin 提前生成，按实际用字符瘦身到 1.5MB 内）
**水印**：每页 `doc.saveGraphicsState()` + `setGState({opacity: 0.1})` + 旋转 45° 重复绘制
**模板**：

```
┌─────────────────────────────────────────┐
│  KIRIROM 培训考试成绩单                  │ ← 居中大字
│                                          │
│  考试名称：基里隆项目部业务培训考试       │
│  组织部门：综合管理部                    │
│  考试时间：2026-06-28 10:00 ~ 10:30      │
│  应到 / 实到：20 / 18（缺考 2 人）       │
│  平均分：82.5     满分：100              │
│  ─────────────────────────────────────  │
│                                          │
│  序号  姓名      部门        成绩  状态  │
│   1   张三     项目部        92    ✓    │
│   2   李四     运行检修部    88    ✓    │
│   3   王五     项目部        ——    缺考  │
│   ...                                    │
│  ─────────────────────────────────────  │
│  导出时间：2026-06-29 21:00              │
│  {{pdfFooter}}                           │
└─────────────────────────────────────────┘
   背景斜向半透明水印：{{watermarkText}}
```

---

## 5. 工作量估算

| 子任务 | 工作量 | 子里程碑 |
|---|---|---|
| 3.1 HR Web 后台脚手架（静态托管 + Element Plus + adminLogin/adminVerify） | 1 天 | |
| 3.2 员工白名单 CRUD | 0.5 天 | |
| 3.3 题库管理（含判断题手工录入） | 0.75 天 | |
| 3.4 考试管理（三类题数+分值表单 + `validateAssessmentConfig` 校验） | 0.75 天 | |
| 3.5 成绩查看页 + `listAssessmentScores` 云函数 | 0.5 天 | |
| 3.6 PDF 导出 + 系统设置 + `saveSystemConfig` | 1 天 | |
| 3.7 小程序端三题型适配 + 总分换算 | 0.5 天 | |
| 3.8 `enterExam` / `submitExam` 云函数升级（分类抽题 + 配置化判分） | 0.5 天 | |
| **总计** | **~5.5 天** | |

---

## 6. 落地顺序与子 tag

为降低单次改动风险，Phase 3 拆 4 个子 tag 逐步固化：

| 顺序 | 包含子任务 | 子 tag | 完工标志 |
|---|---|---|---|
| ① 先小程序侧 | 3.7 + 3.8 | `v0.3.0-judge-type` | 三题型在小程序里跑通，云函数能按 config 抽题判分；HR 临时手工往 questions 表插判断题用于联调 |
| ② HR 后台搭脚手架 | 3.1 + 3.2 | `v0.3.1-hr-skeleton` | HR 后台能登录、能管理员工白名单 |
| ③ HR 题库 + 考试管理 | 3.3 + 3.4 | `v0.3.2-bank-and-exam` | HR 完整闭环：建题库→录题→建考试→员工答题 |
| ④ 成绩 + PDF | 3.5 + 3.6 | `v0.3-phase3` | Phase 3 整体收尾 |

**顺序选择理由**：先做 ① 是因为它涉及最基础的数据模型，提前做完后续 HR 后台直接对接稳定 schema。其它三步是 HR 后台增量功能，可以独立打 tag。

---

## 7. 风险与缓解

| 风险 | 应对 |
|---|---|
| 中文字体子集化复杂 | 提前用 fontmin 离线生成，本地存 `miniprogram/admin/fonts/`，CDN 加载也可 |
| HR 后台扫码登录链路长 | adminLogin/adminVerify 云函数提前到 Phase 3 一起做（v1 方案本属于 Phase 4，提前不影响整体工期） |
| 旧 historys 没有 fullScore 字段 | 复盘 / 成绩页代码用 `if (h.fullScore != null) 显示分制 else 显示题数制`，无需迁移旧数据 |
| 判断题在 questions 表是新结构 | 手工录入时 typecode 下拉强制约束 options 长度==2 + code 必须为 A/B + content 必须为 "正确"/"错误"，避免脏数据 |
| Excel 批量导入推迟到二期 | Phase 3 不做，HR 一期接受逐题手工录入；后期需求强烈再加 |

---

## 8. 与原 v2 主方案的差异说明

主方案 v2 原本把 **HR 后台** 列在 Phase 4，**首页通知卡 + 候考页** 列在 Phase 3。实际推进发现：

- 首页通知卡的 4 态在 Phase 2 已经基本接入（`listMyAssessments` + currentExam 卡片），剩余仅候考页一个轻量需求。
- HR 后台是 KIRIROM 项目方的实际刚需（题库要分门别类，HR 不可能用云开发控制台日常操作）。
- 成绩单 PDF 导出是项目方新增需求，与 HR 后台强耦合。

因此 v2 进度表已调整为：**Phase 3 = 多题型 + HR 后台 + PDF，Phase 4 = 候考页（含 SOP 中需要的细节优化）**。

---

## 9. 完工验收清单（开工后逐项打勾）

- [ ] 数据库 questions 表里能录入判断题（typecode=03）
- [ ] 小程序考试页判断题渲染为大按钮 UI
- [ ] 考试页顶部显示"X / Y 题 · 满分 Z 分"
- [ ] 复盘页能识别新分制（82/100）和老分制（4/5）
- [ ] HR 后台浏览器登录跑通
- [ ] HR 能新增/编辑员工白名单
- [ ] HR 能新建题库并逐题录入（含三种题型）
- [ ] HR 新建考试时三类题数+分值表单可用，保存时校验题库存量
- [ ] 员工进考场抽到的题数 / 类型 / 总分与配置完全一致
- [ ] 交卷后服务端按 questionConfig 正确判分
- [ ] HR 后台能查某场考试的应到/实到/缺考名单
- [ ] HR 能一键导出 PDF，含考试信息 + 成绩表 + 可配置水印
- [ ] HR 能在"系统设置"页修改水印文字

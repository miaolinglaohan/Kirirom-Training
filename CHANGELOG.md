### 20260709 · workspace-cleanup-history-display（残留清理 + 我的成绩显示修复）

> 清理确认无业务引用的模板/开发期残留，并修复员工端「我的成绩」排序和记录名显示问题。

**残留清理**

+ 删除云开发 demo 云函数：`echo` / `sum` / `callback` / `openapi`
+ 删除开发期造数云函数：`hrFakeScores`
+ 删除未使用组件：`miniprogram/components/chatroom`
+ 删除空壳页面：`pages/result/result`
+ 删除过期 HR 占位页：`pages/hr/placeholder`
+ 删除 0 字节残留：`pages/home/home.wxss`
+ 删除未引用的小程序示例图片，仅保留当前页面实际引用的 `radio.png` / `radio-selected.png`
+ 同步更新 README 和部署/阶段文档中的云函数清单

**我的成绩页**

+ `history/index`：不再按 `createTime` 字符串排序，改为解析 `createTimeMs/submittedAt/createTime` 后按真实时间倒序展示最近 5 条
+ `submitExam`：正式考试写入 `historys` 时补 `createTimeMs`、`displayName`、`assessmentName`，记录名优先使用 HR 创建考试时设置的考试名
+ `history/index`：旧正式考试记录若有 `assessmentId`，会反查 `assessments` 兜底显示考试名
+ `question/index` / `simple/index`：刷题记录补 `practiceSubjectId`、`practiceSubjectName`、`displayName`，显示为「题库名刷题」
+ `review/review`：复盘标题优先显示 `displayName/assessmentName`

**验证**

- [x] `node --check` 全量 JS 通过（69 files）
- [x] `app.json` 页面四件套检查通过（34 pages）
- [x] 历史记录按真实时间倒序，正式考试显示考试名，刷题显示「题库名刷题」

**部署提示**

+ 需重新上传云函数：`submitExam`
+ 若云端曾部署已删除的 demo/dev 云函数，可在云开发控制台手动删除对应远端函数

---

### 20260706 · v1.0-release（Phase 5 · 文档交付 + 正式发布）

> Phase 0~5 全部完成，项目从"开发态"推进到"可上线态"。本 tag 交付完整文档包 + Excel 模板 + 待确认事项归档，不涉及代码功能变更。

**新增文档（3 份）**

+ `docs/HR-SOP操作手册.md`：面向 HR 的 10 章操作指南，覆盖首次准备 → 系统设置 → 员工管理 → 题库管理 → 题目录入 → 新建考试（含有效期/时区说明）→ 考试进行中（提前结束）→ 成绩中心 → PDF 导出 → 常见问题（8 个 FAQ）
+ `docs/员工端使用说明.md`：面向 30 名员工的 6 节指引，覆盖首次激活 → 查看考试 → 候考 → 答题（切屏警告/暂存/防作弊）→ 看成绩（错题本/复盘）→ 其他功能
+ `docs/部署运维清单.md`：面向开发/运维的从零部署文档，含 9 个集合创建 + 权限设置 + 28 个云函数清单（按 Phase 分组标注）+ 种子数据导入 + admin 首次设置 + 常见运维操作

**新增 Excel 模板（2 套 + 2 份说明）**

+ `data/员工白名单模板.csv` + `data/员工白名单模板说明.md`：姓名/部门/role/active/备注，6 个部门枚举
+ `data/题目录入模板.csv` + `data/题目录入模板说明.md`：题库ID/题型/题干/选项ABCD/正确答案/解析，单选/多选/判断三题型规范

**v2 文档归档**

+ `月度摸底考试改造方案-v2.md` 第 13 节"待确认事项"全部归档关闭（5 项中 3 项已解决、1 项部分实现留后续、1 项记为后续可做）
+ 进度表 Phase 5 标记 ✅ 已完成，全部 6 个 Phase 收官

**验收清单**

- [x] HR 看完 SOP 能独立完成建考试→导出 PDF 全流程
- [x] 员工看完说明能完成激活→答题→看成绩
- [x] 运维按部署清单能从零部署一套环境
- [x] Excel 模板字段清晰可填
- [x] v2 待确认事项全部归档
- [x] 进度表 Phase 5 标记完成

**里程碑**

本项目从 v0.1 到 v1.0 共经历 6 个 Phase、18 个 tag，涵盖：员工身份体系、考试服务端化、三题型 + HR 后台 + PDF 导出、候考页 + 有效期个人计时 + 提前结束、完整文档交付。可正式上线。

---

### 20260704 · v0.4.4-end-lockfix（已结束考试编辑锁修复）

> 修复 v0.4.3 的两个 bug：① 已结束的考试点卡片仍能进编辑页，改时间后"复活"；② 点"结束"后按钮不变灰，仍可再次编辑。

**Bug 1 · 已结束考试可编辑复活**

- 根因：`onEdit`（点卡片）无状态守卫，进入编辑页改时间存回去就复活
- 修复 `pages/hr/assessments/index.js` `onEdit`：
  - `endedAt` 存在 → toast「该考试已提前结束，不可编辑」
  - `status === 'expired'` → toast「该考试已结束，不可编辑」
- 服务端兜底 `hrSaveAssessment`：
  - 更新前查 `existing.endedAt` → 返回 `ALREADY_ENDED`
  - 更新前查有效窗口 `now > validUntil` → 返回 `EXPIRED`
  - 双保险：前端绕过直接调云函数也拦得住
- `assessmentEdit/index.js` `showErr` 补 `ALREADY_ENDED` / `EXPIRED` 错误码：弹模态提示后 `navigateBack`

**Bug 2 · 点"结束"后按钮不变灰**

- 根因：`onEnd` 成功后只调 `loadList()` 异步刷新，本地状态未即时更新；WXML 禁用条件只判 `status`，没判 `endedAt`
- 修复 `onEnd`：成功后立即 `setData` 把本地 `endedAt` + `status='expired'` 写上，按钮即时变灰；再异步 `loadList` 保证与服务端一致
- 修复 WXML：`disabled` 和 `.action-disabled` 条件加上 `item.endedAt`

**部署清单**

+ 重新上传 1 个云函数：`hrSaveAssessment`
+ 小程序端 2 个页面：`pages/hr/assessments`（onEdit + onEnd + WXML）、`pages/hr/assessmentEdit`（showErr）
+ 数据库无变更

---

### 20260704 · v0.4.3-end-assessment（HR 提前结束考试）

> 考试管理列表每场考试加"结束"按钮，与"成绩"按钮并列对称。HR 可把进行中/候考的考试提前结束（员工立即无法进场），已截止/隐藏的考试按钮变灰不可用。已交卷成绩不受影响。

**实现方式 · `endedAt` 字段截断**

+ 不改原 `validHours`（保留审计），新增 `endedAt` 字段 = 当前时刻
+ 所有读 validUntil 的云函数对 `endedAt` 取 min：`effectiveValidUntil = min(originalValidUntil, endedAt)`
+ endedAt 写入后，`listMyAssessments` 状态自动变 expired，`enterExam` 自动拒绝进场

**新增云函数 · `hrEndAssessment`**

+ 入参 `{ _id }`，写 `endedAt` + `endedBy`
+ HR/admin 鉴权；已结束过返回 `ALREADY_ENDED`
+ 错误码：`NO_OPENID / FORBIDDEN / MISSING_ID / NOT_FOUND / ALREADY_ENDED / DB_ERROR`

**3 个云函数同步对齐 endedAt**

+ `listMyAssessments`：validUntil 对 endedAt 取 min（员工端立即看到已截止）
+ `enterExam`：validUntilMs 对 endedAt 取 min（员工立即无法进场）
+ `hrListAssessments`：validUntil 对 endedAt 取 min + 状态判定接入 validUntil（HR 端列表状态正确）

**小程序 · `pages/hr/assessments`**

+ WXML：每行 `.row-actions` 加"结束"按钮，与"成绩"并列；`status === 'expired' || 'hidden'` 时 `disabled` + `.action-disabled` 灰色
+ WXSS：`.action-end` 红色警示色（#fff0ed / #c0392b）；`.action-disabled` 灰色
+ JS：`onEnd` 二次确认弹窗（红色确认键 + 提示"已交卷成绩不受影响"）→ 调 `hrEndAssessment` → 刷新列表

**部署清单**

+ 新增上传：`hrEndAssessment` 云函数
+ 重新上传 3 个云函数：`listMyAssessments` / `enterExam` / `hrListAssessments`
+ 小程序端 1 个页面改动（`pages/hr/assessments`）
+ 数据库：`assessments` 新增 `endedAt` / `endedBy` 字段（云函数写入时自动产生）

---

### 20260704 · v0.4.2-validity-window（考试有效期 + 个人计时模型）

> 原模型：全员统一截止（`deadline = startTime + duration`），进场晚=时间少，错过开考时刻就几乎没法考。新模型：HR 设有效期（如 48/72 小时），开考后窗口内随时可进场，进场后才开始个人倒计时，照常考完整时长。解决"因工作不能第一时间参考，但要在有效期内进入"的真实场景。

**时间模型变更**

| 维度 | 旧模型 | 新模型（有 validHours）|
|---|---|---|
| 可进场窗口 | `[startTime, startTime+duration]` | `[startTime, startTime+validHours]` |
| 个人 deadline | 固定 `startTime+duration`（统一截止） | `进场时刻 + duration`（个人计时） |
| 进场晚的人 | 时间被压缩 | 照样有完整 duration |
| 超时答完 | 不适用（统一截止） | 允许（validUntil 只管"能不能进场"，不硬截断答题） |

**兼容性**：存量考试无 `validHours` 字段 → 自动回退旧逻辑（统一截止），前向后向都可读。

**数据模型 · `assessments` 新增字段**

+ `validHours: number`（1~168）：开考后多少小时内可进场。必填，新建/编辑考试时 HR 设置。

**云函数改动**

+ `hrSaveAssessment`：入参新增 `validHours`；校验 `>0` 且 `<=168`；写入 `docBody`
+ `enterExam`（正式考分支）：
  - 进入校验：`now > validUntilMs` 返回 `EXPIRED`（旧逻辑 `now > endMs`）
  - deadline：`validHours>0` 时 = `now + duration`（个人计时）；否则 = `startMs + duration`（旧统一截止）
  - validUntilMs = `startMs + validHours×3600s`（无 validHours 回退 `startMs + duration×60s`）
+ `listMyAssessments`：
  - 状态判定 ongoing 区间改为 `[start, validUntil]`（旧 `[start, end]`）
  - 返回新字段 `validUntilMs` / `validHours`；`endMs` 同步指向 validUntil（前端倒计时终点自动跟随）

**小程序改动**

+ `pages/hr/assessmentEdit`：
  - form 新增 `validHours`（默认 48）
  - WXML 加"有效期（小时）"输入行 + "开考后可进场"提示
  - `onSubmit` 客户端校验 `>0` 且 `<=168`，加入 payload
  - 编辑回填从 `a.validHours` 取（旧考试无该字段兜底 48）
+ `pages/examSchedule`：
  - `decorate` 派生 `validText`（`有效期 48 小时` / `统一截止`）
  - WXML 加"有效期"行
  - 倒计时终点自动用 `endMs`（=validUntil），无需改 tick 逻辑
+ `pages/waiting` 候考页：
  - `applyAssessment` 派生 `validHoursText`
  - WXML 加"⏳ 有效期"信息行

**部署清单**

+ 重新上传 2 个云函数：`hrSaveAssessment` / `enterExam` / `listMyAssessments`（共 3 个）
+ 小程序端 3 个页面改动（assessmentEdit / examSchedule / waiting）+ 时区修复（assessmentEdit）
+ 数据库 schema：`assessments` 集合新增 `validHours` 字段（无需手动建，云函数写入时自动产生；旧记录无该字段自动回退）

---

### 20260704 · v0.4.1-tz-fix（考试时间时区修复）

> HR 新建考试选"20:00"，前端拼成 `'YYYY-MM-DD HH:mm:ss'` 无时区信息，云函数 Node.js 按 UTC 解析，实际存成 UTC 20:00。客户端 UTC+7 显示成次日 03:00，差 7 小时。修复：前端提交时转 ISO 字符串（带 Z 后缀），云函数零改动。

**修复 · `pages/hr/assessmentEdit/index.js`**

+ 新增 `buildIsoStart(date, time)`：用 `new Date(年, 月-1, 日, 时, 分)` 数值构造（一定按本地时区）→ `.toISOString()` → 带 `Z` 后缀的 UTC 字符串
+ `onSubmit`：`startTime` 由 `'YYYY-MM-DD HH:mm:ss'` 改为 `buildIsoStart()` 产出的 ISO 字符串
+ 新增 `tzLabel()`：从客户端取时区偏移（`getTimezoneOffset` 取反），如 `UTC+7`
+ `parseStart` 注释补充：兼容 ISO 字符串 / 旧格式 / Date 三种入库形态，`new Date(s)` 都能解析

**UI · 时区标签**

+ `index.wxml`："开始时间"行右侧加 `{{tzLabel}}` 绿底胶囊
+ `index.wxss`：`.tz-hint` 样式（绿底白字 #07c160 / #e8f8ee）

**验证**

+ HR 选 20:00（UTC+7）→ ISO `2026-07-04T13:00:00.000Z` → 云函数存正确时间戳 → 客户端 `getHours()` 自动转回 20:00 ✓
+ 旧格式 `'YYYY-MM-DD HH:mm:ss'` 仍能被 `new Date()` 解析，回填正常 ✓
+ 云函数零改动（`new Date(isoString)` 本就支持）

---

### 20260704 · v0.4.0-waiting（Phase 4 · 候考页）

> Phase 2 已把首页通知卡的 ongoing/pending 两态接通 `listMyAssessments` 真实数据，但 pending（未开考）态点击只能跳考试安排页，缺一个"原地倒计时等开考"的候考页。本 tag 补齐 v2 方案中候考这一缺口，闭环员工考前流程：首页/考试安排页点未开考的考试 → 候考页倒计时 → 归零按钮亮起 → 手动进考场。

**新增 · `pages/waiting` 候考页**

+ 取数复用 `listMyAssessments` 云函数（已返回 name/startMs/endMs/duration/totalQuestions/fullScore/targetDepts 全部字段），**不新建云函数、不动数据库 schema**
+ 入参 `?id=assessmentId`，从 `list` 中筛对应那条；找不到（被删/不可见/部门不符）显示空态 + 返回按钮
+ 大号倒计时（64px Consolas 等宽），用服务端 `now` 校准 `serverOffset`（与 examSchedule 一致），防止改本地时间作弊
+ 倒计时归零 → 按钮由灰变绿、文案"等待开考中…"→"▶ 立即进入考场"；**手动点击进考场**，不自动跳（员工可能还没准备好）
+ 考试信息卡：开考时间 / 答题时长 / 题目数量 / 满分 / 目标部门（空数组显示"全员"）
+ `onUnload` 清 `setInterval`，防 timer 泄漏
+ 跳考场走 `/pages/exam/exam?assessmentId=xxx`，`enterExam` 会再校验一次时间/状态（防绕过）

**首页 `pages/home` 调整**

+ `onTapExamCard`：pending 态由"跳 examSchedule"改为"跳 `/pages/waiting/index?id=xxx`"
+ `loadCurrentExam`：pending 态 `actionText` 由"查看详情"改为"进入候考"

**考试安排页 `pages/examSchedule` 调整**

+ `onTapExam`：pending 态由 `wx.showToast「考试尚未开始」`改为"跳 `/pages/waiting/index?id=xxx`"
+ ongoing / expired 态行为不变

**注册与部署**

+ `app.json` 新增 `pages/waiting/index`
+ 无新增云函数、无数据库 schema 变更，直接预览即可

---

### 20260629 · v0.3.7-color-fix（品牌绿调整为微信绿 + 原项目遗留 bug 修复）

> 将全局品牌绿从 `#1bcfad`（青绿）调整为 `#07c160`（微信经典绿），覆盖导航栏、员工端首页、我的页面及所有子页面的绿色元素。同时修复原开源项目中 4 个长期未被触达的遗留 bug。

**品牌绿替换 #1bcfad → #07c160**

+ `app.json`：`navigationBarBackgroundColor` → `#07c160`
+ `pages/home/index.wxss`：统计数字 / 考试卡片渐变 / 大圆按钮 / 序号圆点等 8 处
+ `pages/profile/index.wxss`：用户卡片渐变 / 头像文字 / 按钮 / 管理入口等 5 处
+ 员工端全页面序号小圆圈统一：`history` / `entry` / `study` / `subject` / `simple` / `note` / `detail` / `examresult`
+ 员工端其余绿色元素：`activate`（提交按钮）、`exam`（进度条/选项卡/按钮 15 处）、`examSchedule`（2 处）、`mistakes`（正确率 2 处）、`review`（选项态/导航/按钮 20 处）
+ 暗色调 `#14b39a` → `#06a04f`，旧阴影 `rgba(27,207,173,·)` → `rgba(7,193,96,·)`

**原项目遗留 bug 修复**

+ **集合名不一致**：`simple/index.js` / `look/index.js` / `view/index.js` 中 `db.collection('question')` → `'questions'`（与数据库实际集合名对齐）
+ **JSON.parse(options) 崩溃**：6 个页面（`simple/question/look/view/detail`）对已是原生数组的 `options` 字段调用 `JSON.parse()` 导致静默失败，全部移除
+ **随机刷题数据入口缺失**：`simple/index.js` 原 `onLoad` 仅读 storage 不查库，改为 exam ID → subjects → questions 中转查找
+ **列表模式多选题变单选**：`question/index.wxml` 原写死 `<radio>`，改为按 `typecode` 条件渲染 `<radio-group>` / `<checkbox-group>`
+ **题量硬编码 10**：`simple/index.js` + `question/index.js` 的 `score_arr` / `code_arr` 改为按实际题目数动态初始化
+ **提交后页面跳转错误**：`question/index.js` 原跳 `/pages/list/index`（不存在），统一改为 `/pages/examresult/examresult`（与单题模式一致）；`simple/index.js` 同步调整
+ **question/index.js 缺失 getApp**：补充 `const app = getApp()`

---

> 将 HR 后台原先"蓝调"（主色 `#2d8cf0` iView 蓝）全面替换为品牌绿色 `#1bcfad`，与员工端首页、图片三/图四的车辆管理系统保持视觉一致。此后 UI 风格冻结，不再大面积变色。

**全局色板**

+ `app.wxss` 顶部追加详细色板注释，约定品牌主色 / dark / light bg / light border / 成功 / 警告 / 危险 / 题型 / 角色 / 文字等全部 token，供后续开发统一引用

**HR 后台蓝→绿替换**

+ 主色 `#2d8cf0` / `#2d6cf0` → `#1bcfad`（按钮、tab active、统计数字、列表强调、role tag 等全部绿色化）
+ 浅蓝底 `#e8f3ff` / `#e6efff` → `#e0f7f1`
+ 浅蓝边 `#cce0ff` → `#a8e6d8`
+ 涉及 10 个 wxss：`hr/home` / `employees` / `subjects` / `subjectEdit` / `questions` / `questionEdit` / `assessments` / `assessmentEdit` / `assessmentScores` / `applicantReview` / `settings`

**导航栏修复**

+ `hr/home/index.json` 删除 `navigationBarBackgroundColor: #f5f6fa`（之前浅灰底配白字不可读），继承全局绿色 navbar

**双按钮区分**

+ `assessmentScores` 页面两导出按钮统一为绿：主按钮实心绿底白字（导出总分单）+ 次按钮白底绿字描边（导出全员答卷），避免同色按钮视觉混为一谈

**不变内容**

+ 员工端全部页面（`home/exam/result/review/history/mistakes/profile/...`）已是绿色，不动
+ 题型 tag（单/多/判）、角色 admin 橙、删除红色、状态徽（已交卷/答题中/缺考）等语义色不动
+ tabBar 配色已是绿色，不动

---

### 20260629 · v0.3.5-pdf-export（Phase 3 子里程碑 8 · PDF 导出业务接线）

> v0.3.5 PDF 导出三连击的收官 tag。在 `pdf-core` 底座之上接两个业务面：考试总分单（一场考试一张表）和员工答卷复盘（一个人一本试卷）。所有 PDF 共享 `sysConfig` 里的水印 + 单位名 + 自动推导的考试日期作为落款。

**sysConfig 扩容**

+ `hrSysConfig` 白名单新增 `unitName`（单位名称，长度 ≤ 60）
+ admin 端 `pages/hr/settings` 第二张卡：单位名输入 + 计数 + 恢复默认（默认值"中国安能集团第二工程局有限公司基里隆项目部"）+ 保存
+ textarea 固定高 96rpx（之前 `auto-height` 会被微信渲染成几屏高，体验糟糕）
+ 保存校验修 bug：`xxxInitial` 此前取的是"显示值"（含默认值兜底），导致 DB 空记录时输入框预填默认值也会被判为"未变化"无法落库；改为 `xxxInitial` 取真实 DB 值（可能为 `''`），UI 显示值另算

**新增 · `pdfScoreSheet.js`（按场考试总分单）**

+ A4 144 DPI · 单表多页 · 自然分页 · 末页落款
+ 列：序号 / 姓名 / 部门 / 状态 / 提交日期 / 分数；总宽 990px，居中布局
+ 仅展示 `status === 'submitted'` 的员工；过滤逻辑放在渲染器内，避免调用方各搞一套
+ 状态列 `合格 / 不合格`，按 80 分判，色彩同 review（绿 #19be6b / 红 #c0392b）
+ 分数列单值，去掉 "/100"（列宽 100px 装不下）
+ 提交日期只显示 `YYYY-MM-DD`，去掉时分秒（之前会被列宽截断成 "2026-06-29 08…"）
+ 落款：单位名（28px bold）+ 考试日期 `YYYY年M月D日`（26px）右下角；位置改为"表格末行下方 32px"，不再贴底
+ 末页空间不够时自动追加一张空白落款页
+ 页脚右侧：`<考试名> · 总分单`

**新增 · `pdfAnswerSheet.js`（单人答卷复盘）**

+ 首页头：考试名（44 bold） + 副信息（姓名·部门·交卷时间·切屏次数）+ 成绩行（得分 X/Y · 答对 N/M）+ 分割线
+ 题块（动态高度，自动测量后分页）：
  - 标题行 `第 N 题 · 类型` + 右上对错徽章（✓正确 / ✗错误）
  - 题干（按 `\n` 段落 + 字符贪心断行，尊重原文换行）
  - 选项盒按 4 态染色：`answered-right`（绿底）/ `answered-wrong`（红底）/ `official-only`（绿虚框，漏选）/ `plain`（灰）
  - 选项右上小色块标签：`他选`（红）/ `正确`（绿）可叠加
  - 答案行：左 `他的答案`（按对错染色）/ 右 `正确答案`（绿）
  - 解析（可选）：浅蓝灰底 + 左色条
+ 末页落款同总分单口径
+ 页脚右侧：`<考试名> · <员工名> 答卷`

**新增 · `pdfAnswerSheet.buildBatchAnswerSheetPages`（全员答卷合并）**

+ 输入 `persons[]`（每人一份 `{employee, enrollment, questions, userAnswers, officialMap, rightFlags}`）
+ 每人独立分页 → 换人强制换页 → 全局连续页码 → 整本 PDF 末页才出现一份落款（不够位置则追加空白末页）
+ 页脚右侧文案随当前页所属员工切换
+ `onProgress(cur, total)` 回调供调用方刷 loading 标题

**页面接线**

+ `pages/hr/assessmentScores`：顶部卡片改双按钮并排
  - 蓝色「📄 导出本场总分单」（任何 tab 可用）
  - 绿色「📚 导出全员答卷」（在 `全部 / 已交卷` tab + 有已交卷数据时启用；`答题中 / 缺考` tab 下置灰）
  - 全员答卷流程：串行调 `hrGetApplicantReview` 拉每人完整数据 →（>20 人时弹确认框）→ 调 `buildBatchAnswerSheetPages` →`生成 PDF X/Y` 进度反馈 → 预览
+ `pages/hr/applicantReview`：顶部加绿色「📄 导出答卷」按钮，调单人渲染器
  - 落款日期取 `enrollment.submittedAt`（这人交卷那天），而不是考试开考时间，更贴合"个人答卷"语义

**HR 首页清理**

+ 移除 `v0.3.5-pdf-core` 时加的临时 M2 测试入口（黄色虚框 + 🧪 按钮 + `#pdfTestCanvas` + `onTestPdf` + `_loadWatermark` + 相关样式）
+ HR home WXML / JS / WXSS 都已瘦身

**v0.3.5 整体收尾**

+ 三连击 tag 链：`sysconfig`（配置基础设施）→ `pdf-core`（Canvas→PDF 底座）→ `pdf-export`（业务接线 + 收尾）
+ 全程零第三方 PDF 库，~150 行 `miniPdf.js` + 两个渲染器，运行时只生成 JPEG + Uint8Array
+ 已通过用户验收：单人答卷 PDF、全员答卷 PDF、总分单 PDF、水印/单位名/日期全链路落地

---

### 20260629 · v0.3.5-pdf-core（Phase 3 子里程碑 7 · PDF 底座）

> 在不引入任何 PDF 第三方库（jsPDF / pdf-lib / pdfmake 全部排除）的前提下，自己用 Uint8Array 拼装一份合法 PDF 1.3，把 Canvas 渲染的内容封进去。本 tag 完成"底座 + 测试入口"，但还没接业务页（业务接线放在 `pdf-export` tag）。

**新增工具层 `miniprogram/utils/pdf/`**

+ `miniPdf.js`（~150 行）：手写 PDF 1.3 容器
  - 每页 3 个对象：Page / Contents（一句 `q W 0 0 H 0 0 cm /Im1 Do Q`）/ Image XObject（JPEG，DCTDecode）
  - 对象编号、xref 偏移、trailer、startxref 全部精确计算
  - 二进制 marker `%\xE2\xE3\xCF\xD3` 让阅读器认成二进制 PDF
  - 字符串走 latin1 8-bit 直拷，不经过 TextEncoder（否则会变 UTF-8 破坏 PDF 语法）

+ `pdfCanvas.js`：A4 Canvas 工具
  - `A4_PT = { w: 595, h: 842 }`，默认 scale=2 → 1190×1684 像素（144 DPI）
  - `prepareCanvas(node)` 给传入的 type=2d canvas 设尺寸 + 返回 ctx
  - `drawWhiteBg(ctx)` 画白底（JPEG 无 alpha，必须先垫白）
  - `drawWatermark(ctx, text, w, h, opts)` 45° 斜向重复水印
    - 横向步进自适应：`measureText(text).width + gapX`，避免长文字重叠
    - 纵向步进 = `fontPx × lineMul`
    - 砖砌错位排布（隔行偏移半步距），视觉上更像真水印
    - 默认参数：fontPx=48 / alpha=0.05 / gapX=160 / lineMul=5
  - `canvasToJpegBytes(canvas)` 走 `canvasToTempFilePath → readFile` 拿到 JPEG 字节

+ `pdfExport.js`：落盘与转发
  - `buildAndSavePdf(pages, fileName)` → 拼 PDF + writeFile，返回 filePath
  - `exportAndPreview(pages, fileName)` → 拼 + 落 + `wx.openDocument` 一条龙
  - `sharePdfToChat(filePath)` 包装 `wx.shareFileMessage`
  - 文件名 `sanitizeFileName` 兜底，禁止路径片段（`../`）
  - Uint8Array → ArrayBuffer 用 byteOffset 判断后 slice，避免子视图陷阱

**HR 首页 · 临时测试入口**

+ admin 可见黄色虚框区域 + 🧪「测试 PDF 导出」按钮 + loading 态
+ 隐藏 `<canvas type="2d" id="pdfTestCanvas">` 放在页面外（`left:-10000rpx`）
+ 流程：取水印 → 渲染 2 页 demo（标题 / 蓝框信息块 / 页脚 / 斜向水印）→ 导出 + 预览
+ 进入 `v0.3.5-pdf-export` 时会被移除

**M1 顺手修补**

+ `hrSysConfig.set` 捕获 `-502005 / DATABASE_COLLECTION_NOT_EXIST`，返回明确的中文提示「请到云开发控制台 → 数据库 → 新建集合 sysConfig」
+ `pages/hr/settings` 保存失败时根据 message 长度自动选 toast 或 modal（toast 14 字截断会让长错误信息变成"数据库集合 sys…"）

**M2 自测通过项**

+ PDF 能在小程序内预览 ✅
+ 单页 ~100KB 量级、2 页 ~250KB ✅
+ 水印 45° 斜向 / 半透明 / 自适应间距 ✅
+ 「…」菜单转发 / 保存到手机 ✅
+ 未配置水印时正常空白不报错 ✅

**水印参数调节口子**（admin 后续若想微调，改 `miniprogram/utils/pdf/pdfCanvas.js` 里 `drawWatermark` 函数开头几行的 fontPx/alpha/gapX/lineMul 默认值即可）

**下一步预告**

+ `v0.3.5-pdf-export`：在 `pages/hr/assessmentScores`（按考试导出总分单）和 `pages/hr/applicantReview`（按答卷导出个人答题册）各加一个「📄 导出 PDF」按钮，写两个渲染器 `pdfScoreSheet.js` / `pdfAnswerSheet.js`，并移除本 tag 加的测试入口

---

### 20260629 · v0.3.5-sysconfig（Phase 3 子里程碑 6 · 系统设置铺底）

> v0.3.5 PDF 导出由 3 个 tag 组成：`sysconfig` 做配置基础设施 / `pdf-core` 做 Canvas→PDF 的底层套件 / `pdf-export` 做两张表的最终接线。本 tag 只解决"水印文字哪里改"——为 admin 加一处可写的全局配置项，所有 PDF 导出共用这条字符串。

**数据库 · 新增 `sysConfig` 集合**

+ 主键 = 配置 key（如 `pdfWatermark`），文档结构 `{ value, updatedAt, updatedBy }`
+ 当前仅一个 key：`pdfWatermark`（PDF 半透明斜向水印的固定文字，长度 ≤ 60）
+ 任何 active 员工都能读（导出 PDF 时要用），只有 admin 能写

**云函数 · 新增 `hrSysConfig`**

+ `action='get'`：`{ key }` → `{ value }`；不存在时返回空串；任何 active 员工可调
+ `action='set'`：`{ key, value }` → `{ ok: true }`；仅 admin（`FORBIDDEN_SET`）；长度 > 60 报 `TOO_LONG`；不在白名单的 key 报 `INVALID_KEY`
+ 写入路径走 try-get-then-update-or-add 的 upsert 模式，避免依赖云数据库 set with upsert（小程序端 SDK 兼容性差）
+ 错误码：`NO_OPENID / FORBIDDEN / INVALID_KEY / FORBIDDEN_SET / TOO_LONG / INVALID_ACTION / DB_ERROR`

**小程序 · 新增 `pages/hr/settings`**

+ 仅 admin 可见入口（HR home 第 5 张卡，`wx:if="{{me.role === 'admin'}}"`）；非 admin 直接进 URL 会被前端 toast 拦回 HR home
+ 单输入项 textarea + 60 字符计数 + 恢复默认按钮（默认值 `基里隆项目部内部资料 · 严禁外传`）+ 保存按钮（loading 态防双击）
+ 仅在 value 实际变化时才提交，未改动时保存按钮 toast 提示「内容未变化」

**入口接线**

+ `pages/hr/home/index.js` 加 `goSettings()`；`index.wxml` 新增 admin-only 卡片「⚙️ 系统设置」
+ `miniprogram/app.json` 注册 `pages/hr/settings/index`

**部署清单**

+ 新增上传：`hrSysConfig` 云函数
+ 数据库手动新建集合：`sysConfig`（空集合即可，第一次 set 时云函数会自动 add）
+ 小程序端 1 个新页面（`pages/hr/settings` 四件套）+ `app.json` + `pages/hr/home/index.{js,wxml}`

**下一步预告**

+ `v0.3.5-pdf-core`：手写 PDF 1.3 容器 + A4 Canvas 工具 + 文件保存/预览/转发链路（无业务接入）
+ `v0.3.5-pdf-export`：两张 PDF（考试总分单 / 个人答卷）真正接到对应 HR 页面

---

### 20260629 · v0.3.4-applicant-review（Phase 3 子里程碑 5 · HR 复盘）

> 接 v0.3.3-scores 的遗留：HR 在成绩单上点已交卷的员工 → 看到他的完整答卷 + 对错 + 解析。专门新建 HR 端复盘页，而不是扩员工端 review 页——HR 视角天然多一栏「这是谁、哪个部门、切屏几次」，与员工"自查"是不同场景，分开后两边都能独立迭代。

**云函数 · 新增 `hrGetApplicantReview`**

+ 入参：`{ enrollmentId }`；返回：`{ assessment, employee, enrollment, questions, answersOfficial, userAnswers }`
+ HR / admin 鉴权：普通员工调用直接 `FORBIDDEN`
+ 只允许 `status === 'submitted'` 的 enrollment（答题中/缺考没意义 → `NOT_SUBMITTED`）
+ employee / assessment 反查容错：被删除/离职时返回占位，主流程不阻断
+ 数据全部来自 `examEnrollments` 文档已固化的快照（questions / answersOfficial / answers / scoreDetail / switchCount …）——v0.3.2 hotfix 已让 submitExam 把这些字段都写入了 enrollment，HR 视角可以一次取齐

**小程序 · 新增 `pages/hr/applicantReview`**

+ 顶栏：员工姓名 + 部门 + 角色 tag + 模考 tag + 考试名 + 交卷时间 + 得分 + 答对题数；`switchCount > 0` 时显示红色「⚠ 答题中切屏 N 次」
+ 题目导航网格：每题一个色块（绿=对 / 红=错），可点击直接跳到该题——HR 主要场景是"找出他错在哪"，导航网格比顺序翻页快得多
+ 题卡渲染逻辑与员工端 `pages/review` 完全一致：选项三态高亮 answered-right / answered-wrong / official-only；判断题用大按钮 UI；显示解析（如题目带 `comments` 字段）
+ 用语 HR 化：员工端"您的答案"→ HR 端"他的答案"、"您选"→"他选"
+ 数据在 onShow 时一次性请求并缓存到页面实例上（`this._questions / _userAnswers / _officialMap / _rightFlags`），翻题只走 setData 不再调云

**入口接线**

+ `pages/hr/assessmentScores/index.js` `onTapApplicant`：submitted 条目 → `navigateTo /pages/hr/applicantReview?id=enrollmentId`；in_progress / absent 保持原 toast
+ `miniprogram/app.json` 注册 `pages/hr/applicantReview/index`

**部署清单**

+ 新增上传：`hrGetApplicantReview` 云函数
+ 小程序端 1 个新页面（`pages/hr/applicantReview` 四件套）+ `app.json` + `pages/hr/assessmentScores/index.js`（1 处方法替换）
+ 数据库 schema / 现有 enrollment 数据无任何变更

**遗留 / 后续**

+ 普通员工端 `pages/review` 仍走 `historys.doc(id).get()` 客户端直查——本次没动它（避免改动面扩散），后续若考虑收紧 historys 安全规则再统一收口
+ 切屏次数仅展示，没有"高切屏自动驳回"逻辑，按需在后续版本加成绩复核流

---

### 20260628 · v0.3.3-scores（Phase 3 子里程碑 4 · 成绩中心）

> Phase 3 收尾的第一块：HR 现在能在小程序里查每场考试的成绩单——应到 / 已交卷 / 答题中 / 缺考一目了然，不用再去云开发控制台翻 `examEnrollments`。PDF 导出单独留到下一个决策点（按 v2 主方案走浏览器 + jsPDF 路径）。

**云函数 · 新增 `hrListAssessmentScores`**

+ 入参：`{ assessmentId }`；返回：`{ assessment, summary, applicants[] }`
+ 应到名单：`employees` 表中 `active != false` 的员工，按 `assessment.targetDepts` 过滤（空数组 = 全员，与 enterExam 的 NOT_IN_SCOPE 语义一致）；不按 role 过滤——HR / admin 同样可被指派参加考试
+ 与 `examEnrollments` left join：找不到记录 → `absent`；status='submitted' → `submitted` 并带回 score / fullScore / rightNum / total / submittedAt / switchCount；其它 → `in_progress`
+ 排除模考：`where({ isMock: _.neq(true) })`，模考不污染成绩单
+ Summary 派生：应到 / 已交卷 / 答题中 / 缺考 / 平均分（仅 submitted 参与，保留 1 位小数）
+ 服务端预排序：已交卷按分数倒序 → 答题中按 startedAt 倒序 → 缺考按姓名

**小程序 · 新增 `pages/hr/assessmentScores`**

+ 顶部考试信息卡：考试名 / 开考时间 / 时长 / 题量 / 满分 / 目标部门（targetDepts 为空显示"全员"）
+ Summary 卡：应到（黑）/ 已交卷（绿）/ 答题中（橙）/ 缺考（灰）/ 平均分
+ 4 个 tab 过滤：全部 / 已交卷 / 答题中 / 缺考
+ 每行展示：姓名 + 部门 + 角色 tag（HR / admin 高亮黄）+ 状态徽章 + 分数 `score / fullScore`
+ submitted 副行：答对题数 / 总题数 + 交卷时间；切屏次数 > 0 时红色高亮
+ in_progress 副行：开始时间；absent 副行：灰色"未进入考场"
+ 点条目暂只 toast（复盘功能：HR 复盘他人考卷需 review 页适配，单独 issue 跟进）

**入口接线 · `pages/hr/assessments`**

+ 每张考试卡片底部新增「成绩」按钮（`catchtap` 避免冒泡到 .item 的 onEdit）
+ 浅蓝胶囊样式，跟编辑入口视觉上区分

**`miniprogram/app.json`**

+ 注册 `pages/hr/assessmentScores/index`

**部署清单**

+ 新增上传：`hrListAssessmentScores` 云函数
+ 小程序端 3 个文件改动（`pages/hr/assessments` wxml/wxss/js）+ 1 个新页面（`pages/hr/assessmentScores`）+ `app.json`，直接预览即可
+ 数据库 schema 无变更

**遗留 / 后续**

+ HR 端复盘他人考卷：当前 review 页只支持自己的 history 复盘，HR 通过 enrollmentId 复盘他人需要 review 页加 HR 守卫 + 用 enrollment 数据回填，列为 v0.3.4 候选
+ PDF 导出：按 v2 方案走浏览器 + jsPDF + 思源黑体子集，单独立项

---

### 20260628 · v0.3.2-hotfix-mock-into-mistakes（错题本统一收口）

> 自测追问：模考的错题是否进了错题本？查了一圈数据流——错题本只读 `historys`，而 `submitExam` 用 `if (!r.isMock)` 把模考分支整段跳过，**模考错题确实没进错题本**。修。

**云函数 · `submitExam`**

+ 把 `historys` 写入移出 `if (!r.isMock)` 守卫——模考和正式考都写一条
+ 新增字段 `isMock: r.isMock === true` 用于区分
+ 默认科目名按 `isMock` 区分为"模拟考试" / "正式考试"（subject 反查失败时的兜底）

**小程序 · `pages/history/index.js`**

+ "我的考试记录"查询加 `isMock: _.neq(true)` 过滤——模考记录不污染考试记录列表（用 `neq(true)` 兼容旧记录无 `isMock` 字段的情况，保留下来）

**未改动但顺手记录**

+ `pages/mistakes/index.js`：无需改动——它本就 `where({_openid})` 全收，现在自然能收到模考错题
+ `pages/home/index.js`：`loadStats` 统计 `historys.count()` 现在会把模考也算进"已答题"——这是合理的（培训系统语义下都算"做过题"）

**部署清单**

+ 重新上传：`submitExam` 云函数
+ 小程序端 `pages/history/index.js` 改完直接预览

---

### 20260628 · v0.3.2-hotfix-mock-lenient（v0.3.2 后续修补）

> 自测发现两个易触发的体验问题：① 模考报"题库题量不足"——但用户其实只是不需要全 10/5/5 分桶；② 首页"顺序练习/随机刷题"始终跳到第一个一级试卷，新建的考试看不见；③ "模拟考试"按钮把 `exam._id`（一级）当成 `subjectId` 传给 enterExam，新 HR 数据（题目 `examid = subjects._id`）一律抽不到题。

**云函数 · `enterExam`：模考宽容化**

+ **模考默认配置覆盖三种题型**（关键修复）：原 `deriveConfigFromCount(10)` 会把 10 道全分配给单选 → cap 后只剩 1 道。现在前端不传 `questionConfig` 时，默认 `{single:10/1, multi:5/2, judge:5/1}`，cap 阶段再削到 pool 真实数量；这样 1单+1多+1判的题库会各抽 1 道，3 道全上
+ 取消"`totalNeed <= 0` 一律 EMPTY_CONFIG"对模考的拦截——模考的 count 在抽题前会被自动 cap 到 pool 真实数量
+ pool 取出后，按 typecode 聚合实际题量 `byCount`，把 `questionConfig.single/multi/judge.count` 各自 cap 到对应 `byCount`（HR 只放了 3 道单选时，请求 10 也能成功开考，实际抽 3）
+ `fullScore` 在 cap **之后**计算，反映真实抽题量
+ `NOT_ENOUGH_QUESTIONS` 现在只对正式考（`!isMock`）生效；模考已经在上面 cap 过，理论上不会触发
+ 新增 cap 后 `picked.length === 0` 兜底（题库类型完全错配的极端场景），统一抛 `NO_QUESTIONS`

**小程序 · `pages/home/index.js`：入口跳转 + 题库选择重构**

+ 新增 `subjectsList` 数据 + `loadSubjectsList()`：从 `subjects` 集合拉全表（带 `_id: exists(true)` 走主键索引避免全扫告警），用 `queryResult` 拼出 `pid -> exam.name` 映射，每条 subject 生成 `label = "题库名（一级名）"`
+ `goExamList` / `goRandom`：单条直接进，多条用 `wx.showActionSheet` 让用户挑——不再"无脑跳第一条"
+ `goMockExam`：改用 `subjectsList`（不再用 `queryResult`），传给 enterExam 的 `subjectId` 现在是真正的 `subjects._id`，能匹配 `hrSaveQuestion` 写入的 `questions.examid`
+ ⚠️ 历史数据兼容性：旧种子题目（`questions.examid = exam._id` 的 legacy 2 级结构）从首页模考入口将不再可达——这本来就是占位数据，可接受

**部署清单**

+ 重新上传：`enterExam` 云函数
+ 小程序端 `pages/home/index.js` 改完直接预览即可（无 wxml/wxss 变化）

---

### 20260628 · v0.3.2-subject-question-crud（Phase 3 子里程碑 3 · 题库 + 题目 CRUD）

> 把 v0.3.1 留下的"敬请期待"两张卡片落地：HR 现在可以直接在小程序里维护题库（subjects）和题目（questions），不再需要去云开发控制台手改文档。题库删除支持级联删题目，被考试引用时阻断；题目编辑页选项动态行 + 三题型自适应。

**核心改动 · 7 个新 HR 云函数**

+ `hrListExams`：返回 `exam` 集合一级列表 `[{_id, name}]`，给题库编辑页 pid picker 用
+ `hrListSubjects`：列出全部 subjects，并用 `aggregate.group({examid, typecode})` 一次性聚合出每个题库的题量分桶 `{single, multi, judge, total}`（聚合失败时自动回退逐条 count）；同时返回 exams 数组方便前端按一级试卷分组渲染
+ `hrSaveSubject`：新建 / 更新题库。`_id` 必须 `/^[A-Za-z0-9_-]+$/`、pid 必须存在于 `exam`；新建时查重；编辑时 `_id` 锁死只能改 name / pid
+ `hrDeleteSubject`：**级联删除**。先查 `assessments.subjectId === _id`，有引用则返回 `BLOCKED_BY_ASSESSMENT` + `detail: [{_id, name}]` 阻断；无引用则先批量删 `questions.examid === _id`（循环 ≤100 条/次直到清空），再删 subject 本身
+ `hrListQuestions`：按 `examid` + 可选 `typecode` 分页列题（默认 20 / 页，上限 100）。**额外支持 `_id` 单条直查模式**：编辑页拉详情用，同时校验 `examid` 防越权
+ `hrSaveQuestion`：新建 / 更新题目，校验逻辑覆盖：examid 在 subjects 存在 / title 必填 / typecode 三选一 / options ≥ 2 项 / code 单大写字母且唯一 / value 仅 '0' / '1' / 单选 + 判断恰好 1 个正确 / 多选 ≥ 2 个正确 / 判断必须恰好 2 项；typename 由 typecode 自动派生
+ `hrDeleteQuestion`：单条删除（不查 examEnrollments，因为报名快照已经把题面 + 选项快照下来，删题不影响在考人员）

所有 HR 函数沿用 v0.3.1 的 `requireHr(OPENID)` 闸：`role` 是 `hr` 或 `admin` 且 `active !== false` 才放行。

**顺手修 bug**

+ `hrSaveAssessment`：v0.3.1 的"题库存在性"预检查的是 `exam` 集合，但 `assessments.subjectId` 实际指向 `subjects._id`。本次改为查 `subjects` 集合，否则所有新建考试都会卡在 `SUBJECT_NOT_FOUND`

**小程序端 · 4 个新页面**

+ `pages/hr/subjects`：题库列表页。按一级试卷分组渲染，每张卡片显示题库 `_id` / name / 题量分桶彩色 chips（总数蓝 / 单选绿 / 多选橙 / 判断紫）+ 三操作按钮（查看题目 / 编辑 / 删除）。删除前 `wx.showModal` 二次确认并提示连带删除的题目数；遇 `BLOCKED_BY_ASSESSMENT` 弹模态列出所有引用考试名
+ `pages/hr/subjectEdit`：题库编辑页。新建模式 `_id` 可填（带正则提示），编辑模式 `_id` 只读；name 必填；pid 用 `<picker>` 从 hrListExams 拉一级试卷下拉
+ `pages/hr/questions`：题目列表页。顶部 4 个 tab（全部 / 单选 / 多选 / 判断）切换 typecode 过滤，分页 20 条 / 页 + 触底加载更多；每张卡片显示题型彩色 tag / 题干 / 选项数 / "正确答案 A,C"（由 `options.filter(o=>o.value==='1')` 派生）+ 编辑 / 删除按钮；右上角"+ 新建"按钮
+ `pages/hr/questionEdit`：题目编辑页。`<picker>` 切题型（单选 / 多选 / 判断）；**选项动态行**：每行 = code 圆徽（A/B/...自动编号） + content 输入框 + "设为正确 / ✓ 正确"切换 + "删"按钮；底部"+ 添加选项"按钮（上限 8 项、下限 2 项）。**三题型自适应**：
  - 切到判断：强制重置为 2 项，A=正确 / B=错误（content 只读，不可删 / 不可加）
  - 单选：标记任一项自动把其他项设回未选（互斥）
  - 多选：可任意切换，保存时 < 2 个正确被阻断
  - 多选 → 单选：自动只保留第一个正确项，避免回头报"单选只能 1 个正确"
+ 保存前客户端先做与云函数一致的校验，云函数失败时弹模态显示具体 message（不是只一个 toast 一闪而过）

**hr/home 入口卡片**

+ 移除"题库管理"/"题目管理"两张卡的 `disabled` 灰底 + "敬请期待"角标，描述改为正常文案，两个 `goSubjects` / `goQuestions` 方法都指向 `/pages/hr/subjects/index`（题目入口走"题库 → 查看题目"二次跳转，避免裸题目列表缺 examid 上下文）
+ 底部 footer-tip 改为"提示：题目管理需先进入对应题库，再点「查看题目」"

**部署清单**

+ 新增上传 7 个云函数：`hrListExams` / `hrListSubjects` / `hrSaveSubject` / `hrDeleteSubject` / `hrListQuestions` / `hrSaveQuestion` / `hrDeleteQuestion`
+ 重新上传 1 个云函数：`hrSaveAssessment`（subject 查询表改成 subjects 集合）
+ `miniprogram/app.json` 已注册 4 个新页路径
+ 数据库 schema 无变更，沿用现有 `exam` / `subjects` / `questions` / `assessments` 四表

---



> 在小程序内嵌一个轻量 HR 管理后台，先满足"凑合用"的运营需求（员工角色切换 + 考试 CRUD）。重 Web 后台（React + cloudbase web SDK）择机另起新项目。本 tag 不含题库 / 题目的小程序内增删改，仍需在云开发控制台或下版本（v0.3.2）处理。

**核心改动 · 4 个 HR 云函数**

+ `hrListEmployees`：列出全体员工，按 `activatedAt` 降序，返回 `{_id, name, dept, role, active, openid}`
+ `hrSetEmployee`：白名单 patch（`role` / `active` / `dept`）；带 **自锁保护** —— HR 不能把自己降级或停用，返回 `SELF_LOCK`
+ `hrListAssessments`：返回所有考试（包括 `visible=false` 与已过期），并批量聚合 `examEnrollments` 得到每场考试的 `enrolled` / `submitted` 计数
+ `hrSaveAssessment`：新建 / 更新考试。**提交前题库预检**：按 typecode 在 `questions` 集合分桶计数，与 `questionConfig.{single,multi,judge}.count` 比对，不足返回 `NOT_ENOUGH_QUESTIONS` + `detail:[{typecode,need,have}]`；同步写老字段 `questionCount = totalQuestions` 保留兼容

所有 HR 函数开头统一 `requireHr(OPENID)`：`employees.role === 'hr'` 且 `active !== false` 才放行，否则 `{ok:false, code:'FORBIDDEN'}`。

**小程序端 · 5 个新页面**

+ `pages/hr/home`：管理后台首页，4 张入口卡片（员工管理 / 考试管理 / 题库管理 / 题目管理），后两张挂"敬请期待"角标
+ `pages/hr/employees`：员工列表，每行两个操作按钮 —— 升 HR / 降员工、启用 / 停用；当前账号自身的两个按钮全部禁用
+ `pages/hr/assessments`：考试列表，每张卡片显示题量 / 总分 / 已报名 / 已交卷统计；右上角"+ 新建"按钮，点击卡片进入编辑
+ `pages/hr/assessmentEdit`：表单页，题库 picker / 日期 picker / 时间 picker / 时长 / 3 种题型 count+score / 部门白名单 / 可见性开关；触发 `NOT_ENOUGH_QUESTIONS` 时弹模态对话框列出每个题型缺多少
+ `pages/hr/placeholder`：题库 / 题目管理的占位页（`?kind=subjects|questions`），告知"v0.3.2 上线，目前请在云开发控制台维护"

**home 页入口**

+ `pages/home/index` 增加 `isHr` data；entry-grid 第 7 格 `wx:if="{{isHr}}"` 渲染"管理后台"入口（橙色背景，🛠 图标）；非 HR 用户看不到这个入口

**前后双闸**

+ 前端：每个 HR 页 `onShow` 都用 `app.guardAuth()` 取员工对象，`role !== 'hr'` 直接 `wx.reLaunch` 回首页
+ 后端：4 个云函数全部用 `requireHr` 兜底，前端绕过也无效

**首位 HR 引导**

+ 没有自动赋权逻辑：首次启用时在云开发控制台 → 数据库 → `employees` 集合，找到要做 HR 的那行，把 `role` 字段改为字符串 `"hr"`（默认值是 `"employee"` 或不存在），重新打开小程序即可看到管理后台入口
+ 后续可以由这位"种子 HR"在员工管理页给其他人升级
+ **`admin` 角色等同于 HR**：所有 HR 权限闸（前端 + 4 个云函数）都把 `role === 'admin'` 视作有完整 HR 权限。如果你之前在 cms.json / 初始化脚本里把自己设成了 `admin`，无需再改成 `hr`，登录后就能直接看到"管理后台"入口
+ **admin 保护机制**：`hrSetEmployee` 拒绝修改 `role === 'admin'` 的行（返回 `PROTECTED`），员工管理页两个操作按钮也会被禁用并显示 "超管(锁定)"。如需调整 admin，请直接在云开发控制台改 `employees` 表

**部署清单**

+ 上传 4 个新云函数：`hrListEmployees` / `hrSetEmployee` / `hrListAssessments` / `hrSaveAssessment`
+ 集合无 schema 变更（沿用 v0.3.0 的 `assessments` / `employees` / `examEnrollments`）

---

### 20260628 · v0.3.0-judge-type（Phase 3 子里程碑 1 · 三题型 + 配置化分制）

> Phase 3 拆成 4 个子 tag 逐步推进，本 tag 是第 1 个：把"每题 1 分"的固定模型换成"按题型分桶 + 配置化分值"，并为新题型铺好客户端 UI。HR 后台 + PDF 导出 + 水印放在后续子 tag 推进。

**核心改动**

+ **questionConfig 数据模型**：`assessments.questionConfig = { single:{count,score}, multi:{count,score}, judge:{count,score} }`；旧 `questionCount` 字段保留作回退（视为 N 道单选 × 1 分）
+ **enterExam 改造**：按 typecode 分桶随机抽题，单选 / 多选 / 判断三桶独立抽够数才放行；任一桶不足返回 `NOT_ENOUGH_QUESTIONS` 错误码（含 `detail: [{typecode, need, have}]` 便于前端友好提示）；enrollment 快照增加 `fullScore` / `questionConfig` 字段
+ **submitExam 改造（严格判分）**：按题型从 config 取每题分值，集合完全相等才得满分，错选 / 漏选 / 多选一律 0 分；`historys` 新增 `score` / `fullScore` / `scoreDetail`（含每题 `{qid, typecode, earned, full}`）/ `questionConfig` 字段；正式考也返回 `answersOfficial`（培训系统 = 允许员工对照学习）
+ **listMyAssessments 派生字段**：`totalQuestions = Σ count`、`fullScore = Σ count×score`，旧考卷回退到 `questionCount`，前端不再需要自行算分

**小程序端**

+ `pages/exam`：题目识别 typecode=03 时切换"是 / 否"大按钮 UI；顶部栏新增"满分 N"标签；交卷参数携带 `fullScore` / `questionConfig` 到结果页
+ `pages/examresult`：分数显示由"答对/总题"切换为"得分/满分"（旧考卷自动回退）；分制差异时多显示一行"答对 X/Y 题 · 得分率 N%"
+ `pages/review`：得分头显示 `score / fullScore`；判断题用大按钮渲染（与 exam 页同款 state-* 配色，绿实底 = 选对、红实底 = 选错、绿虚框 = 应选未选）
+ `pages/history`：列表项显示 `_scoreDisplay = "X/Y 分"` + 答对 N/M 题
+ `pages/examSchedule`：每张考试卡片新增"题目数量 N 题 / 满分 N 分"两行

**种子数据 / 联调**

+ `data/questions.json` 追加 5 题（2 道多选 / 3 道判断）共用 `examid=001001` 题库，方便挂接示例考试
+ 新建 `data/assessments.sample.json`：一场示例考试（3 单选×2 + 2 多选×4 + 3 判断×1 = 8 题 / 17 分 / 15 分钟），可直接导入 `assessments` 集合做端到端联调

**兼容性**

+ 老历史记录（无 `fullScore`）所有页面自动回退到题数维度显示
+ 老考试（无 `questionConfig`）抽题用 `questionCount` 作为单选数量，每题 1 分
+ 任何字段升级都是新增不删除，前向后向都可读

---



#### Phase 2 — 考试服务端化

**5 个云函数全部落地（cloud1-d5gievact76bc75a4 环境）**

+ `getServerTime`：返回服务端 UTC 毫秒，客户端用 `serverOffset = serverNow - Date.now()` 校准倒计时，避免本地改时间作弊
+ `enterExam`：进考场。支持正式考（`assessmentId`）+ 模拟考（`isMock` + `subjectId`）两种入口；服务端从 `assessments` 读规则、检查可见性/部门/起止时间，随机抽题剥离 `value` 字段；写 `examEnrollments` 防重入（_id = `{assessmentId}_{openid}` 单卷一人，模考用时间戳允许多次）；正式考统一 `deadline = startTime + duration`，进场晚 = 时间少
+ `saveDraft`：30s 自动暂存用户作答；同步 `clientLastSavedAt` 与 `switchCount`
+ `submitExam`：服务端判分（集合相等才算对，多选无关顺序）+ 写 `historys`（带 `_openid` / `userAnswers` / `answersOfficial` 三个关键字段供复盘和错题本使用）+ 更新 enrollment 状态；模考可返回标准答案，正式考引导到复盘页查看
+ `listMyAssessments`：列出当前员工可见的考试。**核心价值：绕开微信默认 `_openid` 过滤器** —— HR 在云开发控制台手工建的 assessments 没有 `_openid` 字段，客户端 `db.where().get()` 会被自动加这个过滤条件而查不到记录，云函数读没有这个限制；同时做部门权限服务端过滤、计算 ongoing/pending/expired 三态

**新增 2 个集合**

+ `assessments`：HR 派发的考试（`name` / `subjectId` / `startTime` / `duration` / `questionCount` / `targetDepts` / `visible`）
+ `examEnrollments`：每人每场的答卷快照（题目、用户作答、官方答案、deadline、状态、切屏计数）

**前端页面**

+ `pages/exam` 完整重写（~310 行 js + 全新 wxml/wxss）：服务端取题 + 倒计时 + 单选/多选自动识别（typecode `02` = 多选）+ 30s 静默 saveDraft + onHide 计 switchCount + 1 分钟内闪红警告 + 自动交卷 + 滑出式题号跳转面板
+ `pages/examresult` 重写：顶部分数大图 + 答对/答错/总题数三栏 + 模考可展开"查看正确答案"折叠块（每选项绿/红配色 + 用户/官方标签 + 解析）+ 正式考"查看完整复盘 ›"卡片引导到我的成绩
+ `pages/review` 完整重写：从 `historys` 快照本地渲染（不再二次查 `question` 集合）+ 选项三态配色（绿实底 = 选对、红实底 = 选错、绿虚框 = 应选未选）+ 题干 / 您选 / 正确 / 解析四行 + 旧版数据兜底页 + 支持 `?idx=N` 参数定位到指定题
+ **新增 `pages/mistakes`**：聚合最近 20 次 `historys` 记录的错题列表，每条显示来源考试 + 时间 + "您选 / 正确"简略，点击带 historyId + idx 跳到复盘页定位
+ `pages/home`：考试通知卡接 `listMyAssessments` 真实数据，4 态（ongoing 跳考试 / pending 跳考试安排 / null 显示"查看考试安排" / submitted 显示"已完成"）；"错题本"按钮跳新 mistakes 页；"模拟考试"大按钮调通真实模考流程
+ `pages/examSchedule`：改用 `listMyAssessments`，1s 倒计时刷新 + ongoing 项可直接进考场

**关键修复**

+ **云函数写 historys 必须显式带 `_openid: OPENID`** —— 否则客户端 `where({_openid: openid})` 永远查不到自己刚交卷的记录，会出现"成绩页没我的考试"和"错题本永远是空"两个怪 bug
+ 用 `app.globalData.lastExamResult` 跨页传题目快照（`wx.redirectTo` URL 太短装不下）

#### 数据库设计

+ 更新 `docs/数据库设计.md`：补 assessments / examEnrollments 两张表 schema

#### 文档

+ 新增 `docs/Phase2-Step2.1-建assessments和enrollments集合.md`
+ 新增 `docs/Phase2-Step2.2-2.5-部署4个云函数.md`
+ 新增 `docs/初始考试数据.json`（HR 用于种数据的样板）
+ `月度摸底考试改造方案-v2.md` 进度表把 Phase 2 标记为已完成，补"Phase 2 实际产出"小节

#### 验证场景

+ 正式考完整跑通：进入 → 作答 5 题 → 交卷 → 4/5 分 → 点"查看完整复盘 ›" → 我的成绩列表看到记录 → 点开复盘 → 题干 / 选项 / 标准答案高亮展示正确
+ 错题本：聚合显示历次错题，点击直达复盘对应题目
+ 防重入：同一人同一场二次进入提示"您已提交此次考试"

---

### 20260628 · v0.1-phase1（KIRIROM TRAINING 二开起点）

#### Phase 0 — 项目清理 + UI 重做

+ 删除 11 个云开发 demo 页（userConsole / storageConsole / im / databaseGuide / addFunction / deployFunctions / chooseLib / openapi / pay / info / index）
+ TabBar 从 2 项扩为 3 项：首页 / 我的成绩 / 我的
+ 全局标题改为「基里隆项目部业务培训考试」（app.json + 分享卡片 + profile 页脚同步）
+ 首页全面重做：顶部统计条 + 考试通知卡（4 态：pending/ongoing/submitted/expired） + 两枚大圆按钮（模拟考试 / 考试安排） + 6 宫格入口 + 题库分类列表
+ 新增 `pages/profile` 占位（带管理员入口，仅 admin 可见）
+ 新增 `pages/examSchedule` 占位（HR 下发考试列表，倒计时与状态徽章）
+ 清除 5 个页面残留的流量主广告位（about / history / rule / study / subject）

#### Phase 1 — 员工身份体系

+ 新增 `employees` 集合（字段：name / dept / role / openid / activatedAt / active），6 个部门枚举（项目部 / 运行检修部 / 综合管理部 / 枢纽管理部 / 安全技术部 / 财务资金部）
+ 新增云函数 `whoAmI`：查询当前 openid 对应的员工身份，4 种返回状态（active / unactivated / disabled / error）
+ 新增云函数 `activate`：按姓名 + 部门匹配白名单，绑定 openid。覆盖 7 种业务返回码（NOT_FOUND / AMBIGUOUS / ALREADY_ACTIVATED / DISABLED / INVALID_DEPT / MISSING_FIELDS / DB_ERROR）
+ 新增激活页 `pages/activate`（姓名输入 + 部门 picker + 提交按钮，失败弹窗带具体原因）
+ 重写 `app.js`：onLaunch 调 whoAmI 拿身份并缓存为 Promise；提供 `guardAuth()`（tab 页 onShow 调用）+ `refreshAuth()`（激活成功后调用）
+ 三个 tab 页（home / history / profile）改为 onShow 走 guardAuth，自动 reLaunch 未激活/已停用用户
+ 移除 `history` 页旧的 deployFunctions 死跳转 + login 函数重复调用

#### 文档

+ 新增 `docs/数据库设计.md`（employees / adminSessions 等集合结构总览）
+ 新增 `docs/初始员工数据.json`（3 条种子记录）
+ 新增 `docs/Phase1-Step1.2-建集合操作步骤.md` 和 `docs/Phase1-Step1.3-部署云函数操作步骤.md`
+ 主方案 `月度摸底考试改造方案-v2.md` 增加「2.2 Phase 落地进度」章节

---



   
### 20212129
+ 增加cms json

### 20212128
+ 增加cms json

### 20212126
+ 增加cms json

### 20212125
+ 增加cms json

### 20211115
+ 修改若干bug

### 20211103
+ 修改若干bug

### 20210222
+ 修改若干bug

### 20210220
+ 修改若干bug

### 20210218
+ 修改若干bug

### 20210215
+ 修改若干bug

### 20210122
+ 修改首页bug

### 20210121
+ 修复bug，优化体验

### 20200420
+ 将小程序涉及的集合信息放在data目录里面

### 20200228
+ 界面美观优化
+ 增加选择题对多选的支持

### 20200118
+ 新增错题记录

### 20200117
+ 新增答题历史记录
+ 新增答题结果页
+ 新增查看答案页

### 20200116
+ 新增列表模式答题

### 20200115
+ 答题逻辑初步完善


### 20200101
+ 云开发项目初始化

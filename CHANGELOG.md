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

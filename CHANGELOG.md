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

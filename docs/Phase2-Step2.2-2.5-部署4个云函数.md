# Phase 2 · Step 2.2-2.5：部署 4 个考试相关云函数

> 这一步**纯部署 + 测试**，不用写代码。预计 10 分钟。
> 部署后做几个云端测试用例，再进 Step 2.6 改造考试页。

---

## 一、4 个云函数总览

| 云函数 | 入参 | 返回核心字段 | 调用方 |
|---|---|---|---|
| `getServerTime` | 无 | `{ now }` | 考试页倒计时校时 |
| `enterExam` | `{ assessmentId }` 或 `{ isMock, subjectId, questionCount?, duration? }` | `{ enrollmentId, questions, deadline, total, durationMs }` | 考试页 onLoad |
| `saveDraft` | `{ enrollmentId, answers, switchCountIncrement? }` | `{ ok, switchCount }` | 考试页定时器 + 答题事件 |
| `submitExam` | `{ enrollmentId, answers }` | `{ score, total, rightNum, questions, [answersOfficial 仅模考] }` | 考试页提交 / 倒计时归零 |

---

## 二、部署步骤

### ① 上传 4 个函数

回到微信开发者工具，左侧目录树展开 `cloudfunctions/`，依次右键点击下面 4 个新文件夹，每个都选「**上传并部署：云端安装依赖（不上传 node_modules）**」：

```
cloudfunctions/
├── activate           （已部署，不动）
├── enterExam          ← 新，需部署
├── getServerTime      ← 新，需部署
├── saveDraft          ← 新，需部署
├── submitExam         ← 新，需部署
└── whoAmI             （已部署，不动）
```

每个函数部署需要 30-60 秒（第一次装 wx-server-sdk）。**连续 4 次右键 + 上传**即可。

### ② 在云开发控制台确认

云开发控制台 → 云函数 → 列表应该看到（按名字字母序）：

```
activate
callback         （demo 原有）
echo             （demo 原有）
enterExam        ← 新
getServerTime    ← 新
initDB           （原有）
login            （原有）
openapi          （demo 原有）
saveDraft        ← 新
submitExam       ← 新
sum              （demo 原有）
whoAmI
```

---

## 三、云端测试 5 个用例

> 提示：云端测试因为没有真实用户身份，OPENID 是空的，所以**`getServerTime` 外的 3 个函数都会返回 `NO_OPENID`**。
> 这正是预期 —— 真实测试需要在小程序里通过 `wx.cloud.callFunction` 调用（Step 2.6 之后）。

但是 `getServerTime` 不依赖 OPENID，可以正面测：

### 测试 1：`getServerTime`

- 云函数列表 → `getServerTime` → 云端测试
- 参数留空 `{}`
- 期望返回：

```json
{ "now": 1719560000000 }
```

数字会和你当前时间相符（精确到毫秒）。

### 测试 2-5：另外 3 个函数（仅做"调通"验证）

依次点 `enterExam` / `saveDraft` / `submitExam` 的「云端测试」，参数随便填，**期望都返回 `NO_OPENID` 错误**：

```json
{ "ok": false, "code": "NO_OPENID", "message": "无法获取微信身份" }
```

只要不是「函数运行错误」「语法错误」之类的红色失败，就说明部署成功、依赖装好、逻辑没崩。

---

## 完成后告诉我

满足下面 2 条再回复：

- [ ] 4 个云函数在控制台列表里全部"正常"
- [ ] `getServerTime` 测试返回了正确的当前时间戳

回复「**4 个云函数部署完毕**」，我开始 **Step 2.6**：改造 `pages/exam` 考试页，接入这 4 个云函数（这是 Phase 2 工作量最大的一步，会同时改 wxml/wxss/js）。

---

## 常见踩坑

- **部署提示"npm install 失败"**：通常是网络问题。重试 1 次基本能成。仍然失败的话切到「上传并部署：所有文件」试试。
- **云端测试 `enterExam` 报 `Cannot read property 'data' of undefined`**：说明代码 bug，把错误堆栈截图发我。
- **某个函数云端测试返回 "函数运行错误"**：很可能是依赖没装好。重新右键 → 上传并部署一次。

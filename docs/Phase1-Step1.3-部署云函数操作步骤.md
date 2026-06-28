# Phase 1 · Step 1.3：部署 whoAmI 与 activate 云函数

> 这一步**前半段写代码已完成**（我刚写好两份云函数源码），现在请你在开发者工具里点几下，把它们部署到云端。

---

## 操作步骤

### ① 切换到「云函数」目录

回到「微信开发者工具」主界面（不是云开发控制台），看左侧**项目目录树**。展开 `cloudfunctions/` 目录，你应该看到：

```
cloudfunctions/
├── activate    ← 新增（蓝色或灰色文件夹图标）
├── callback
├── echo
├── initDB
├── login
├── openapi
├── sum
└── whoAmI      ← 新增
```

> 如果新增的两个文件夹颜色发灰/有问号图标，说明它们还没和云端关联，下一步会处理。

### ② 部署 whoAmI

1. 右键点击 `whoAmI` 文件夹
2. 菜单中选「**上传并部署：云端安装依赖（不上传 node_modules）**」
3. 等待进度条跑完，底部状态栏出现「上传成功」
4. 通常耗时 30-60 秒（第一次会装 wx-server-sdk 依赖）

### ③ 部署 activate

同上操作 —— 右键 `activate` → 「上传并部署：云端安装依赖」。

### ④ 在云开发控制台验证部署

1. 顶部菜单点「**云开发**」
2. 左侧选「**云函数**」
3. 应当看到列表里多了两条：`whoAmI` 和 `activate`，状态都是「正常」

---

## 在线测试两个函数（重要，先验证后再写前端）

### 测试 whoAmI

云开发控制台 → 云函数 → 找到 `whoAmI` → 点「**云端测试**」标签：

- 请求参数留空 `{}`
- 点「运行测试」
- 预期返回：

```json
{
  "status": "unactivated"
}
```

为什么是 unactivated？因为「云端测试」用的是云开发自己的测试身份，这个 openid 还没绑任何员工。**这正是我们想要的结果**——证明数据库连通、查询逻辑正确。

### 测试 activate（**第一个关键测试**）

云函数列表 → `activate` → 云端测试：

- 请求参数填：

```json
{
  "name": "李妙言",
  "dept": "项目部"
}
```

- 点「运行测试」
- 预期返回：

```json
{
  "ok": true,
  "employee": {
    "_id": "d43898...",
    "name": "李妙言",
    "dept": "项目部",
    "role": "admin",
    "active": true,
    "activatedAt": "2026-06-28T..."
  }
}
```

⚠️ **这一步会把云端测试身份的 openid 绑定到「李妙言」记录上**！这不是真人 openid，只是云控制台默认测试身份。

### 收尾：把刚才的绑定清掉

测试完后，回到数据库 → employees → 找到「李妙言」记录：
- 把 `openid` 改回 `""`（空字符串）
- 把 `activatedAt` 改回 `null`
- 保存

> 这一步是为了让真实用户首次扫小程序时还能正常激活。如果不清掉，云控制台测试身份就「占用」了你的账号，真实手机扫码会拿到「该微信已激活」错误。

### 再补一个失败用例

`activate` 云端测试，参数：

```json
{
  "name": "不存在的人",
  "dept": "项目部"
}
```

预期返回：

```json
{
  "ok": false,
  "code": "NOT_FOUND",
  "message": "未找到匹配的员工记录，请联系 HR 核对姓名与部门"
}
```

---

## 完成后告诉我

满足全部下列条件再发「**已部署并测试通过**」给我：

- [ ] `whoAmI` 部署成功
- [ ] `activate` 部署成功
- [ ] `whoAmI` 云端测试返回 `unactivated`
- [ ] `activate` 用「李妙言/项目部」测试返回 `ok: true`
- [ ] **已把「李妙言」记录的 openid 改回 `""`、activatedAt 改回 `null`**
- [ ] `activate` 用「不存在的人」测试返回 `NOT_FOUND`

然后我开始 **Step 1.4：写 pages/activate 激活页 + 路由守卫**。

---

## 常见问题

- **「上传并部署」选项找不到**：检查 `project.config.json` 里 `cloudfunctionRoot` 是不是 `cloudfunctions/`（已确认是）。如果右键菜单仍没有，去开发者工具「详情 → 本地设置」勾选「不校验合法域名…」并重启工具。
- **部署报「云环境不存在」**：检查 `miniprogram/app.js` 里 `wx.cloud.init({ env: 'cloud1-d5gievact76bc75a4' })`，云函数会用同环境。
- **测试 activate 返回 `NO_OPENID`**：云端测试默认带测试身份，理论上不会缺。如果真碰到，换「真机调试」方式触发即可。

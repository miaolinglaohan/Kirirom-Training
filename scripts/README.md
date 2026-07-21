# 云开发数据库迁移脚本

把【旧云开发环境】的 9 个集合数据，一次性搬到【新云开发环境】。

## 适用场景

- 用新微信号新建小程序，把现有项目的题库/考试数据迁过去
- 一次性迁移，不是定期同步
- 数据量在几万条以内（题库 + 历史记录）

## 原理

用腾讯云侧身份（secretId / secretKey）通过 `@cloudbase/manager` 直接读写云开发数据库，不依赖微信登录态。读旧环境 -> 在新环境建集合 -> 批量灌数据。

---

## 使用步骤

### 第 1 步：装 NodeJS（如果已装跳过）

电脑装 NodeJS 14+，终端能跑 `node -v` 即可。下载：https://nodejs.org/

### 第 2 步：拿腾讯云访问密钥

> ⚠ 这一步是关键，密钥用错会读不到数据。

1. 浏览器打开 https://console.cloud.tencent.com/cam/capi （用**绑定了旧小程序的微信号**对应的腾讯云账号登录，云开发控制台右上角头像 -> 访问管理也能进）
2. 如果没有密钥，点「新建密钥」，得到：
   - **SecretId**（以 `AKID` 开头）
   - **SecretKey**（一长串）
3. 复制保存好，**SecretKey 只显示一次，关掉就看不到了**

> 嫌麻烦的替代方案：也可以用微信扫码临时授权（subAccount 模式），但拿固定密钥最省事。

### 第 3 步：拿到两个环境 ID

- **旧环境 ID**：当前小程序 `miniprogram/app.js` 第 23 行 `env: 'cloud1-xxx'` 那串
- **新环境 ID**：新小程序开通云开发后，云开发控制台首页顶部「环境 ID」（一长串，如 `cloud1-yyyy`）

### 第 4 步：填配置

打开 `migrate-cloudbase.js`，修改顶部 4 个值：

```js
const SRC_ENV_ID = 'cloud1-xxxxxxxxxxxxxxx'   // 旧环境 ID
const DST_ENV_ID = 'cloud1-yyyyyyyyyyyyyyy'   // 新环境 ID
const SECRET_ID  = 'AKIDxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'  // 腾讯云 SecretId
const SECRET_KEY = 'yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy'      // 腾讯云 SecretKey
```

### 第 5 步：装依赖 + 跑脚本

在 `scripts/` 目录下打开终端（PowerShell / Git Bash / cmd 都行）：

```bash
cd scripts
npm install        # 装 @cloudbase/manager（约 1 分钟）
npm run migrate    # 跑迁移
```

跑起来会看到类似输出：

```
=== 云开发数据库迁移脚本 ===
源环境： cloud1-xxxxx
目标环境： cloud1-yyyyy
集合数： 10

--- 处理集合：exam ---
  ✓ 已在新环境创建集合 exam
  · 已写入 3 条（本批 3）
  -> exam 完成，共 3 条

--- 处理集合：subjects ---
  ...
=== 迁移完成 ===
总写入：1234 条
```

10 个集合跑完通常 1-3 分钟（取决于 questions 数据量）。

---

## 第 6 步：迁移后必做（脚本管不了的事）

脚本只搬数据，下面这些要手动：

### 6.1 改小程序代码的环境 ID

打开 `miniprogram/app.js` 第 22-24 行，把 `env` 改成新环境 ID：

```js
wx.cloud.init({
  env: 'cloud1-yyyyyyyyyyyyyyy',   // 改成新环境
  ...
})
```

### 6.2 上传部署全部云函数

云函数不会随小程序代码自动部署。微信开发者工具里：
- 对 `cloudfunctions/` 下**每个云函数目录**（29 个），右键 -> 「上传并部署：云端安装依赖」

> 一定要选「**云端安装依赖**」，否则 `require('wx-server-sdk')` 会报错。

### 6.3 把自己设成 admin（关键，否则看不到后台）

新小程序首次登录会建一条 `employees` 记录（普通 role），但旧的 admin 记录 `_openid` 是旧微信号的，对不上。操作：

1. 新小程序里用**新微信号**登录一次（让系统建一条新 employees 记录）
2. 回云开发控制台 -> 数据库 -> `employees` 集合
3. 找到**你新微信号**那条记录（看 `name` 或 `openid`），把 `role` 字段值改成 `"admin"`
4. 关闭小程序重新打开，首页就出现「🛠 管理后台」入口

### 6.4 调整集合权限规则

新集合默认权限是"仅创建者可读写"，要改成和旧环境一致。参考 `docs/部署运维清单.md` 第 56-58 行：

| 集合 | 权限 |
|---|---|
| `sysConfig` | 所有用户可读，仅 admin 可写（通过云函数） |
| `questions` / `subjects` / `exam` | 所有用户可读 |
| `employees` / `assessments` / `examEnrollments` / `historys` / `notes` / `profiles` | 按业务设（通常"仅创建者可读写"或"所有用户可读"） |

云开发控制台 -> 数据库 -> 选集合 -> 「数据权限」标签 -> 改。

---

## 关于 `_openid` 字段（重要）

迁过去的数据里，`historys` / `notes` / `employees` / `examEnrollments` 这些集合带着**旧用户的 `_openid`**。新小程序里用户的 openid 会变，所以：

- **题库数据**（`exam` / `subjects` / `questions` / `sysConfig`）：随便迁，不涉及身份
- **用户相关数据**（`historys` / `notes` / `employees` / `examEnrollments` / `profiles`）：迁过去会"对不上人"

  - 如果是**全新小程序，不要旧用户数据**：迁完后到控制台把这 5 个集合清空（或直接不迁，脚本里把 `COLLECTIONS` 数组对应项删掉）
  - 如果是**要保留历史**：接受"旧记录看不到"的现实，新用户产生的新记录正常

**建议**：第一次迁移只迁 `exam` / `subjects` / `questions` / `sysConfig` 这 4 个题库和配置集合，用户相关的不迁。要这么做，编辑 `migrate-cloudbase.js` 第 30 行的 `COLLECTIONS` 数组：

```js
const COLLECTIONS = [
  'exam',
  'subjects',
  'questions',
  'sysConfig'
]
```

---

## 常见问题

**Q: 跑脚本报 `InvalidParameter` 或 `AuthFailure`？**
A: SecretId / SecretKey 填错了，或密钥对应的腾讯云账号没权限访问该云开发环境。确认密钥是绑定了旧小程序的腾讯云账号生成的。

**Q: 报 `DATABASE_COLLECTION_NOT_EXIST`？**
A: 旧环境某个集合不存在（比如你没用过 `profiles`）。脚本会自动跳过，不影响其他集合。

**Q: 写入报 `_id 已存在`？**
A: 脚本已自动去掉 `_id` 让新环境自动生成。如果还报错，可能是新环境该集合有残留数据，先到控制台清空再跑。

**Q: 能跑多次吗？**
A: 能，但会**重复写入**（数据翻倍）。要重跑，先到新环境控制台清空对应集合。

**Q: 速度很慢？**
A: 默认每批 1000 条、每批间隔 20ms。questions 几千题通常 30 秒内。如果上万题，把脚本里 `BATCH_SIZE` 保持 1000、`SLEEP_MS` 改 0 即可。

---

## 脚本做了什么

1. 用腾讯云密钥初始化两个环境的 manager 实例
2. 遍历 10 个集合：
   - 在新环境建集合（已存在则跳过）
   - 分批读旧环境数据（每批 1000 条）
   - 去掉 `_id`，批量写入新环境
3. 打印每个集合的写入数量

脚本不会修改旧环境任何数据，只读。可以放心重跑。

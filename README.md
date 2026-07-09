# Kirirom Training · 月度摸底考试小程序

> 内部使用的月度摸底 / 培训考核微信小程序。在开源项目 `exam-mini-master` 的基础上做了大幅二次开发：增加员工 / HR / 管理员三级角色、考试场次（assessment）模型、报名（enrollment）与流转、HR 后台 CRUD、批阅与统计、以及完全手写、零第三方依赖的 PDF 导出体系。

适用场景：企业 / 培训机构对内部员工进行周期性知识摸底考核，需要管理员后台维护题库、HR 后台组织考试场次、员工小程序端答题，并以 PDF 形式归档成绩与答卷。

---

## 技术栈

- 微信小程序（原生 WXML / WXSS / JS，未使用任何前端框架）
- 微信云开发：云函数（Node.js）+ 云数据库（MongoDB-like）+ 临时文件存储
- 手写 PDF 1.3 容器 + Canvas 2D 渲染（不引入任何 PDF / 字体 / 图像第三方库）
- `dayjs` 仅作为时间格式化的小工具

---

## 目录结构

```
exam-mini-master/
├── miniprogram/              # 小程序端
│   ├── pages/
│   │   ├── home / exam / examresult / history / mistakes / score ...
│   │                          # 员工端：首页、答题、成绩、错题、历史等
│   │   └── hr/                # HR / 管理员后台
│   │       ├── home/                # 后台主页（卡片入口）
│   │       ├── employees/           # 员工管理
│   │       ├── subjects/ + subjectEdit/
│   │       ├── questions/ + questionEdit/
│   │       ├── assessments/ + assessmentEdit/
│   │       ├── assessmentScores/    # 单场成绩 + PDF 导出
│   │       ├── applicantReview/     # 单人答卷批阅 + PDF 导出
│   │       └── settings/            # 系统设置（水印 / 单位名称）
│   ├── utils/
│   │   ├── pdf/
│   │   │   ├── miniPdf.js           # 手写 PDF 1.3 容器
│   │   │   ├── pdfCanvas.js         # A4 144DPI Canvas 工具 + 水印
│   │   │   ├── pdfExport.js         # 保存 / 预览 / 转发
│   │   │   ├── pdfScoreSheet.js     # 总分单渲染器
│   │   │   └── pdfAnswerSheet.js    # 答卷渲染器（单人 / 批量）
│   │   ├── dayjs.min.js
│   │   └── util.js
│   ├── app.js / app.json / app.wxss
│   └── images/
│
├── cloudfunctions/           # 云函数（每个文件夹一个）
│   ├── login / whoAmI / activate           # 登录与激活
│   ├── enterExam / saveDraft / submitExam  # 答题流程
│   ├── listMyAssessments                   # 员工端考试列表
│   ├── hrListEmployees / hrSetEmployee
│   ├── hrListSubjects / hrSaveSubject / hrDeleteSubject
│   ├── hrListQuestions / hrSaveQuestion / hrDeleteQuestion
│   ├── hrImportEmployees / hrImportQuestions
│   ├── hrListAssessments / hrSaveAssessment / hrEndAssessment
│   ├── hrListAssessmentScores              # 成绩列表（HR）
│   ├── hrDeleteEmployee                    # 员工删除
│   ├── hrGetApplicantReview                # 单人批阅详情
│   ├── hrSysConfig                         # 系统设置 KV（admin 可写）
│   └── initDB / getServerTime              # 工具
│
├── data/                     # 初始种子数据 / 示例 JSON
├── docs/                     # 阶段性落地文档（Phase1 / Phase2 / Phase3）
├── images/
├── CHANGELOG.md              # 所有 tag 与对应变更说明
├── deploy.md                 # 来自原项目的部署教程
├── 月度摸底考试改造方案.md
├── 月度摸底考试改造方案-v2.md
├── project.config.json
└── README.md                 # 本文件
```

---

## 角色模型

通过 `employees` 集合上的 `role` 字段区分：

| role | 入口 | 权限 |
|------|------|------|
| `employee` | 小程序首页 | 报名、答题、看自己的成绩与错题 |
| `hr` | HR 后台 | 员工管理、题库、考试场次、批阅、导出 |
| `admin` | HR 后台 + 系统设置 | HR 全部权限 + 写 `sysConfig`（水印 / 单位名称） |

所有云函数都做双保险：**前端隐藏入口 + 云函数侧再次校验调用方 role**。

---

## PDF 导出体系

完全自研，**不引入任何第三方 PDF 库**：

- `miniPdf.js`：直接拼装 PDF 1.3 字节流（catalog / pages / per-page JPEG XObject），输出 `Uint8Array`
- `pdfCanvas.js`：在小程序 `type=2d` 离屏 canvas 上按 A4 / 144 DPI（1190 × 1684 px）作画，含 45° 水印
- `pdfScoreSheet.js`：单场总分单（表头、统计、分段排名、签发栏）
- `pdfAnswerSheet.js`：
  - `buildAnswerSheetPages(canvas, data)` — 单人答卷
  - `buildBatchAnswerSheetPages(canvas, batchData)` — 全员答卷批量导出，**换人强制翻页 + 全局连续页码 + 末页一份落款**
- `pdfExport.js`：写临时文件 → `wx.openDocument` 预览 / 转发

入口：HR 后台 → 单场成绩页（导出总分单 / 导出全员答卷）、单人批阅页（导出本人答卷）；水印 / 单位名称在「系统设置」配置。

---

## 本地开发指南

1. **导入项目**：用 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html) 打开仓库根目录。AppID 在 `project.config.json` 中按需替换为你自己的小程序 AppID。

2. **开通云开发**：在开发者工具左上角点「云开发」，新建一个云开发环境，把环境 ID 写入 `miniprogram/app.js` 中 `wx.cloud.init({ env: 'xxx' })`。

3. **上传云函数**：右键 `cloudfunctions/` 下每个函数文件夹 → 「上传并部署：云端安装依赖」。第一次部署可以全选一次性传。

4. **创建集合**：在云控制台手动新建以下集合（详细 schema 见 `docs/数据库设计.md`）：

   `employees` / `subjects` / `questions` / `assessments` / `examEnrollments` / `historys` / `notes` / `profiles` / `sysConfig`

5. **导入种子数据**（可选）：`data/` 目录下提供了 `subjects.json`、`questions.json`、`assessments.sample.json` 等，云控制台 → 集合 → 「导入」即可。

6. **设置自己为 admin**：在 `employees` 集合手动把自己那条记录的 `role` 改成 `admin`，即可看到「系统设置」入口；先在系统设置里把水印文字 / 单位名称写好，再去测试 PDF 导出。

---

## 版本时间线

完整变更说明见 [`CHANGELOG.md`](./CHANGELOG.md)。tag 一览（按时间）：

| Tag | 主题 |
|-----|------|
| `v0.1-phase1` | Phase 1：员工端基础答题流程 |
| `v0.2-phase2` | Phase 2：考试场次 / 报名 / 提交流转 |
| `v0.3.0-judge-type` | 判断题题型 |
| `v0.3.1-hr-skeleton` | HR 后台骨架 |
| `v0.3.2-subject-question-crud` | 题库 / 科目 CRUD |
| `v0.3.2-hotfix` | 题库相关 hotfix |
| `v0.3.3-scores` | 成绩列表 / 统计 |
| `v0.3.4-applicant-review` | 单人答卷批阅 |
| `v0.3.5-sysconfig` | 系统设置 KV（水印 / 单位名） |
| `v0.3.5-pdf-core` | 手写 PDF 1.3 容器 + Canvas 工具 |
| `v0.3.5-pdf-export` | PDF 导出业务接线（总分单 / 单人 / 全员） |

---

## 二次开发约定

- 每个里程碑都打 tag，并同步在 `CHANGELOG.md` 增加段落。CHANGELOG 顺序：**最新的写在最上方**。
- **不引入第三方 PDF / 字体 / 图像处理库**，所有渲染走 Canvas 2D + 手写容器。
- 角色守卫遵循「前端隐藏 + 云函数再校验」的双保险，任何新加的 HR 云函数都要先在入口校验 `role in ('hr','admin')`。
- 文案默认中文；时间显示统一走 `dayjs`，日期格式 `YYYY年M月D日`。

---

## 致谢与许可

本项目脱胎自 Gitee 开源项目 [`exam-mini-master`](https://gitee.com/wulivictor)（原作者：wulivictor）。Phase 1 之后的功能与 PDF 导出体系为本仓库自研。

许可参见根目录 [`LICENSE`](./LICENSE)。

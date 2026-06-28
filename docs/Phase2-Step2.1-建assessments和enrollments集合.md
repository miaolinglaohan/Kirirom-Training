# Phase 2 · Step 2.1：建 assessments + examEnrollments 集合

> 这一步是**鼠标操作**，预计 5 分钟。
> 完成后，Phase 2 后续 6 步全是写代码，由我搞定。

---

## 操作步骤

### ① 新建 `assessments` 集合

1. 微信开发者工具 → 顶部「云开发」按钮
2. 左侧「数据库」→ 集合列表左上角「+」
3. 集合名输入：

```
assessments
```

4. 顶部「权限设置」→ 选「**仅创建者可读写**」→ 保存

### ② 导入一条测试用考试

为了 Phase 2 联调测试，先建一场马上要开考的「测试考试」。

1. 点开 `assessments` → 「数据」标签 → 右上角「**添加记录**」
2. 直接用「**JSON 模式**」（不是「字段模式」），粘贴下面这条记录（**注意：将 `createdBy` 改成你自己的 employees._id**，从云控制台 employees 集合的「李妙言」记录复制 `_id` 字段值）：

```json
{
  "title": "Phase 2 联调测试 · 微信测评摸底考试",
  "subjectId": "001001",
  "startTime": "2026-06-28T08:00:00.000Z",
  "duration": 10,
  "questionCount": 5,
  "passingScore": 60,
  "targetDepts": [],
  "visible": true,
  "createdBy": "粘贴李妙言的 _id 到这里",
  "createdAt": "2026-06-28T08:00:00.000Z"
}
```

3. 点保存

### ③ 校验

回到 assessments 数据标签，应能看到 1 条记录，关键字段：

| 字段 | 值 |
|---|---|
| title | Phase 2 联调测试 · 微信测评摸底考试 |
| subjectId | `"001001"` |
| startTime | 一个 Date 类型，2026-06-28 08:00 |
| duration | `10` |
| questionCount | `5` |
| targetDepts | `[]` |
| visible | `true` |

> 用 5 题 / 10 分钟做联调测试足够；正式发布时 HR 会改成 30 题 / 60 分钟等真实数值。

### ④ 新建 `examEnrollments` 集合

1. 集合列表「+」 → 集合名：

```
examEnrollments
```

2. 权限设置 → **仅创建者可读写** → 保存
3. **不要**手动塞数据，留空。云函数 `enterExam` 会自动写入。

### ⑤ 校验

集合列表应该出现：
```
assessments      (1 条记录)
employees        (3 条记录)
examEnrollments  (0 条记录)  ← 新
exam             (1 条记录)
historys         (...)
notes            (...)
profiles         (...)
questions        (5 条记录)
subjects         (1 条记录)
```

---

## 完成后告诉我

回复「**两个集合都建好了**」或截集合列表的图，
我立刻开始 **Step 2.2 + 2.3 + 2.4 + 2.5**（4 个云函数代码，一气呵成写完再让你部署）。

---

## 常见踩坑

- **`createdBy` 没改成自己的 \_id**：联调时如果 HR 后台看「创建人」字段会显示空，但不影响考试本身能跑。后续 Phase 4 做 HR 后台时再补。
- **startTime 时间格式错误**：JSON 模式下，云数据库会把 ISO 字符串自动识别为 Date 类型。如果你担心，可以用字段模式逐个录入，时间字段会有日历选择器。
- **`subjectId` 写错**：必须是 `"001001"`（带引号的字符串），对应 subjects 集合里「微信测评一」那条记录的 \_id。

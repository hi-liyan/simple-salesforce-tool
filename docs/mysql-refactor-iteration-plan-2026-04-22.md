# MySQL 可信编辑与产品能力迭代 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 MySQL 数据源的“查询结果表格编辑 -> 提交 -> 日志/反馈”形成可信闭环，保证用户在画面中看到的修改可以被前后端一致表达、可靠执行、明确回显，并将原评审文档中的产品问题拆成可渐进落地的任务包。

**Architecture:** 先围绕 `QueryPanel + DataGrid + MySQL Provider` 修复可信编辑主链路，再补齐事务结果、系统日志与失败定位，最后再把 `SQLite v2` 与数据库客户端体验增强作为独立工作流推进。前端以“稳定行身份 + 显式值语义 + 可更新能力模型”为核心，后端以“字段能力校准 + 显式 diff 执行 + 结构化执行结果”为核心。

**Tech Stack:** React 18、TypeScript、Zustand、Tauri v2、Rust、sqlx、MySQL、SQLite

---

## 1. 文档定位

这不是“一次性做完全部问题”的大任务单，而是一份给 LLM 和工程师共用的主迭代文档。执行时必须遵守下面三条：

1. 一次只推进一个任务包，不要把 `P0 可信编辑修复`、`日志可靠性`、`SQLite v2` 混在同一个提交里。
2. 任何任务开始前，先补最小回归测试，再写实现。
3. 如果任务触达用户可见语义，必须同时更新提示文案、日志文案和验收用例。

## 2. 范围拆分

原始评审文档实际覆盖了 4 条相对独立的工作流，不能由单个 LLM 在一个实现回合里混做：

- 工作流 A：MySQL 可信编辑闭环
  - 关注 `dirty`、`Set Null`、主键禁改、稳定行 ID、提交 payload、结果集是否可更新。
- 工作流 B：系统日志与事务可靠性
  - 关注执行预览、结构化失败定位、`rows_affected` 校验、日志语义修正。
- 工作流 C：SQLite v2 持久层重构
  - 关注 `src-tauri/src/db.rs` 的 schema、迁移、双写历史包袱、安全性。
- 工作流 D：数据库客户端产品增强
  - 关注查询栏、结果表格、批量操作、关系导航、AI 助手等高频体验。

推荐顺序：

1. 先完成工作流 A 的 P0/P1。
2. 再完成工作流 B。
3. 工作流 D 中只接入依赖 A/B 的增强项。
4. 工作流 C 单独立项，不与 A/B 共用同一次实现会话。

## 3. 当前代码锚点

本计划基于当前仓库真实代码，不是抽象建议。执行任务时优先围绕下面这些文件展开：

- 前端主链路
  - `src/features/main/QueryPanel/hooks/useQueryExecution.ts`
  - `src/features/main/QueryPanel/hooks/useQueryPanelActions.ts`
  - `src/features/main/QueryPanel/hooks/useQueryPanelRuntime.ts`
  - `src/features/main/QueryPanel/logic/queryUtils.ts`
  - `src/features/main/QueryPanel/components/DataQueryTabPane.tsx`
  - `src/components/DataGrid/index.tsx`
  - `src/components/DataGrid/hooks/useDataGridColumns.ts`
  - `src/components/DataGrid/hooks/useDataGridMenuActions.ts`
  - `src/components/DataGrid/logic/cellEditHandler.ts`
  - `src/components/DataGrid/utils/field.ts`
- 前端状态层
  - `src/store/useAppStore.ts`
  - `src/types/index.ts`
- 后端主链路
  - `src-tauri/src/commands.rs`
  - `src-tauri/src/providers/mysql_provider.rs`
  - `src-tauri/src/db.rs`
- 已有测试基础
  - `tests/query-panel/*.test.ts`
  - `tests/dategrid/*.test.ts`

## 4. 目标状态

迭代完成后，MySQL 编辑体验至少满足下面 8 条：

1. 主键、自增列、生成列、只读列在表格内不可编辑，且 UI 有明确只读提示。
2. 行内部身份不依赖“当前主键值”，而是依赖稳定 `rowStableId`。
3. `dirty` 比较必须区分 `null`、`undefined`、空字符串 `""`。
4. 新增与更新都能显式表达“写 NULL / 写空字符串 / 省略字段走默认值”。
5. 查询结果在用户编辑前就能判断是否可更新，并展示原因。
6. 提交前可预览本次变更的 create / update / delete / set null 内容。
7. 后端把 `0 rows affected` 视为业务失败，而不是伪成功。
8. 系统日志明确标识“执行预览 SQL”，并能定位失败子语句或失败记录。

## 5. 推荐新增类型与边界

为了避免继续在现有 `unknown` 值上堆条件分支，建议先补齐下面这些类型，再展开实现：

- 前端类型，建议新增到 `src/types/index.ts` 或 `src/features/main/QueryPanel/types.ts`
  - `MysqlCellDraftValue`
  - `MysqlRowDraftState`
  - `RowUpdateCapability`
  - `MutationPreviewItem`
  - `MutationExecutionResult`
- 前端纯逻辑文件，建议新增
  - `src/features/main/QueryPanel/logic/mysqlValueSemantics.ts`
  - `src/features/main/QueryPanel/logic/mysqlUpdateCapability.ts`
  - `src/features/main/QueryPanel/logic/mysqlMutationPlanner.ts`
- 后端结构体，建议新增到 `src-tauri/src/providers/mysql_provider.rs` 或拆分新模块
  - `MysqlMutationPreview`
  - `MysqlMutationExecutionItem`
  - `MysqlMutationExecutionSummary`

如果实现中发现这些类型太分散，可以把 MySQL 编辑语义单独抽到 `QueryPanel/logic/mysql-*` 目录，但不要在第一轮就大规模重排目录。

## 6. 主线依赖图

- Task 1 是全部后续任务的护栏。
- Task 2、Task 3、Task 4 是可信编辑主链路的核心。
- Task 6 依赖 Task 2 到 Task 4 完成，因为它需要稳定的行定位和显式值语义。
- Task 5 依赖 Task 2 到 Task 4 完成；如果 Task 6 已完成，可直接复用结构化执行结果与错误模型。
- Task 7 依赖 Task 6，且可选消费 Task 5 的预览结构。
- Task 8 是独立计划准备，不阻塞前面任务。

---

### Task 1: 建立 MySQL 可信编辑回归护栏

**Files:**
- Create: `tests/query-panel/mysqlCrudEditing.test.ts`
- Create: `tests/query-panel/mysqlMutationPlanner.test.ts`
- Create: `tests/dategrid/mysqlCellEditing.test.ts`
- Modify: `package.json`

- [ ] **Step 1: 先补 QueryPanel 级行为测试**
  - 覆盖以下场景：
  - `Set Null` 后应进入 dirty。
  - 空字符串改成 `null` 不应被视为“未变化”。
  - 主键变化不应影响待删记录定位。
  - 多数据源同名表时，状态写入必须只命中 `bindingKey` 对应 tab。
  - 进度备注（2026-04-22）：本轮已补“主键变化不影响待删记录定位”“多数据源同名表仅命中 bindingKey”两条回归测试；`Set Null` 与空字符串/`null` 语义测试留待 Task 3 一并补齐。

- [ ] **Step 2: 补值语义规划测试**
  - 为“新增/更新 payload 规划器”写纯函数测试，至少覆盖：
  - `omit`
  - `null`
  - `value: ""`
  - `value: 0`
  - `value: false`

- [ ] **Step 3: 补 DataGrid 编辑入口测试**
  - 验证主键、自增列、生成列、只读列被双击或输入时会给出只读提示。
  - 验证 `Set Null` 只允许对可空字段生效。

- [x] **Step 4: 修正测试脚本命名与入口**
  - 保持 `npm run test:query-panel`、`npm run test:datagrid-utils` 可直接跑新用例。

- [ ] **Step 5: 运行测试**
  - Run: `npm run test:query-panel`
  - Expected: 新增的 MySQL 可信编辑测试先失败，能准确暴露当前实现缺口。

### Task 2: 收敛 Tab 身份与稳定行身份

**Files:**
- Modify: `src/store/useAppStore.ts`
- Modify: `src/features/main/QueryPanel/hooks/useQueryPanelActions.ts`
- Modify: `src/features/main/QueryPanel/hooks/useQueryPanelRuntime.ts`
- Modify: `src/features/main/QueryPanel/logic/queryUtils.ts`
- Modify: `src/components/DataGrid/index.tsx`
- Modify: `src/components/DataGrid/hooks/useDataGridColumns.ts`
- Modify: `src/types/index.ts`
- Test: `tests/query-panel/mysqlCrudEditing.test.ts`

- [x] **Step 1: 收紧前端写状态入口**
  - 把 `patchTab(activeTab.objectName, ...)` 这一类写路径统一改成只接受 `bindingKey`。
  - 不再新增任何按 `objectName` 写状态的逻辑。

- [x] **Step 2: 引入稳定行身份**
  - 为旧行生成 `rowStableId`，来源优先级建议为：
  - `record.__rowStableId`
  - `record.__baselineKey`
  - 查询时生成的稳定内部键
  - 严禁继续把“当前主键值”当成前端唯一身份。

- [x] **Step 3: 分离两类概念**
  - `rowStableId` 只服务前端选择、dirty、待删除高亮、行定位。
  - `rowLocator` 才是后端更新/删除定位条件，MySQL 下默认使用 baseline 主键值。

- [x] **Step 4: 统一 DataGrid 选择键**
  - `selectedRecordIds`、`pendingDeleteRecordIds` 的值统一换成 `rowStableId`，不要再存当前主键值。

- [x] **Step 5: 运行测试**
  - Run: `npm run test:query-panel`
  - Expected: “主键修改后删除失效”“同名表串状态”的回归用例通过。

### Task 3: 建模显式值语义，替换当前 dirty 比较方式

**Files:**
- Create: `src/features/main/QueryPanel/logic/mysqlValueSemantics.ts`
- Create: `src/features/main/QueryPanel/logic/mysqlMutationPlanner.ts`
- Modify: `src/features/main/QueryPanel/hooks/useQueryPanelActions.ts`
- Modify: `src/features/main/QueryPanel/hooks/useQueryPanelRuntime.ts`
- Modify: `src/features/main/QueryPanel/logic/queryUtils.ts`
- Modify: `src/components/DataGrid/logic/cellEditHandler.ts`
- Modify: `src/components/DataGrid/hooks/useDataGridMenuActions.ts`
- Modify: `src/types/index.ts`
- Test: `tests/query-panel/mysqlMutationPlanner.test.ts`
- Test: `tests/dategrid/mysqlCellEditing.test.ts`

- [ ] **Step 1: 定义单元格草稿值模型**
  - 至少支持：
  - `kind: "omit"`
  - `kind: "null"`
  - `kind: "value"`
  - `kind: "default"` 或与 `omit` 合并，但语义必须明确写在类型和文档里。

- [ ] **Step 2: 把 dirty 判断改成“语义比较”**
  - 不再使用当前的 `stringify(null | undefined | "") -> ""` 比较。
  - 单独实现比较函数，例如：
  - `compareMysqlDraftValue(baselineValue, draftValue)`
  - `isMysqlDraftDirty(baselineValue, draftValue)`

- [ ] **Step 3: 收敛编辑入口**
  - 文本输入清空时，不能直接等价成 `undefined`。
  - 日期/时间/数字/布尔输入都要映射成显式 draft 语义。
  - 右键 `Set Null` 必须生成 `kind: "null"`，而不是裸 `null`。

- [ ] **Step 4: 重写提交 payload 规划器**
  - 不再通过“扫整行 + 跳过空值”构建 `creates` / `updates`。
  - 统一从 `baseline + draft` 生成显式 diff。

- [ ] **Step 5: 运行测试**
  - Run: `npm run test:query-panel`
  - Run: `npm run test:datagrid-utils`
  - Expected: `null`、`undefined`、空字符串、`0`、`false` 的差异都能稳定通过。

### Task 4: 补齐字段能力模型与查询结果可更新性预判

**Files:**
- Create: `src/features/main/QueryPanel/logic/mysqlUpdateCapability.ts`
- Modify: `src/components/DataGrid/utils/field.ts`
- Modify: `src/components/DataGrid/logic/cellEditHandler.ts`
- Modify: `src/features/main/QueryPanel/hooks/useQueryExecution.ts`
- Modify: `src/features/main/QueryPanel/components/DataQueryTabPane.tsx`
- Modify: `src/types/index.ts`
- Modify: `src-tauri/src/providers/mysql_provider.rs`
- Test: `tests/query-panel/mysqlCrudEditing.test.ts`

- [ ] **Step 1: 后端 describe 阶段修正字段能力**
  - 主键列、自增列、生成列、只读列不能继续统一标记为 `createable/updateable=true`。
  - 把 `columnKey`、`extra`、`columnDefault` 等元数据真正用于能力推导。

- [ ] **Step 2: 前端统一消费字段能力**
  - `isCellEditableByMeta` 只读判断必须与后端真实能力一致。
  - DataGrid 的只读提示文案要能解释“为什么不能改”。

- [ ] **Step 3: 增加结果集可更新性模型**
  - 在查询完成后生成：
  - `editable`
  - `readonly_missing_pk`
  - `readonly_complex_query`
  - `readonly_multi_table`
  - 如果当前代码短期无法精准判断复杂查询，可先保守判定，只要缺主键或无法识别单表就置只读。

- [ ] **Step 4: 接入工具栏与表格只读态**
  - 只要不是 `editable`：
  - 禁用单元格编辑
  - 禁用“执行更新”
  - 展示明确原因

- [ ] **Step 5: 运行测试**
  - Run: `npm run test:query-panel`
  - Expected: 缺主键、复杂查询、主键列编辑等场景有稳定结果。

### Task 5: 增加提交前预览，并让前后端共用同一份变更计划

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/api/index.ts`
- Modify: `src/features/main/QueryPanel/hooks/useQueryPanelRuntime.ts`
- Modify: `src/features/main/QueryPanel/components/DataQueryTabPane.tsx`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/providers/mysql_provider.rs`
- Test: `tests/query-panel/mysqlMutationPlanner.test.ts`

- [ ] **Step 1: 统一前端预览数据结构**
  - 把提交前预览抽象为结构化数组，而不是只拼一段字符串。
  - 每条预览至少包含：
  - `op`
  - `rowStableId`
  - `rowLocator`
  - `fields`
  - `previewSql`

- [ ] **Step 2: 前端在点击“执行更新”前弹轻量预览**
  - 首轮可以只做 Drawer / Modal 中的摘要，不必做复杂 diff UI。
  - 必须展示：
  - 新增几行
  - 更新几行
  - 删除几行
  - 哪些字段将写入 `NULL`

- [ ] **Step 3: 让预览与执行共享同一套 planner**
  - 防止“预览一套语义，执行另一套语义”。
  - 如果共享代码成本太高，至少共享字段排序、主键定位、空值语义归一化逻辑。

- [ ] **Step 4: 运行测试**
  - Run: `npm run test:query-panel`
  - Expected: 预览结果与最终提交 planner 一致。

### Task 6: 修复事务可靠性，显式处理 `rows_affected = 0`

**Files:**
- Modify: `src-tauri/src/providers/mysql_provider.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src/api/index.ts`
- Modify: `src/types/index.ts`
- Test: `tests/query-panel/mysqlCrudEditing.test.ts`

- [ ] **Step 1: 更新 execute_update / execute_delete 返回值**
  - 不再只返回 `Result<(), AppError>`。
  - 至少返回影响行数或结构化执行结果。

- [ ] **Step 2: 把“0 行命中”升级为业务失败**
  - 对 update/delete：
  - `rows_affected == 0` 时返回明确错误，内容需带记录定位信息。

- [ ] **Step 3: save_records_with_deletes 输出结构化执行摘要**
  - 至少能区分：
  - 哪一条 create 失败
  - 哪一条 update 失败
  - 哪一条 delete 失败
  - 哪条语句是 0 行命中

- [ ] **Step 4: 前端消费明确错误**
  - 不要只显示 `执行更新失败：Error(...)`。
  - 失败提示至少包含“操作类型 + 行定位 + 原因”。

- [ ] **Step 5: 运行测试**
  - Run: `npm run test:query-panel`
  - Expected: 伪成功场景不再被当成成功。

### Task 7: 校正系统日志语义，并补失败定位能力

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/providers/mysql_provider.rs`
- Modify: `src/features/main/SettingsPanel/SystemLogs.tsx`
- Modify: `src/features/main/SettingsPanel/systemLogContent.ts`
- Test: `tests/query-panel/systemLogContent.test.ts`

- [ ] **Step 1: 修正文案定义**
  - 系统日志里的 SQL 文案统一改成“执行预览 SQL”或等价表达。
  - 不再暗示它是驱动层原始 SQL。

- [ ] **Step 2: 结构化输出 detail**
  - 不要再只拼接长字符串。
  - 建议 detail 中包含：
  - `preview_sql`
  - `operation_index`
  - `operation_type`
  - `record_locator`
  - `rows_affected`
  - `error`

- [ ] **Step 3: 前端日志页增加可读性增强**
  - 首轮至少支持：
  - 失败优先高亮
  - 预览 SQL 标识
  - 长文本折叠优化

- [ ] **Step 4: 运行测试**
  - Run: `npm run test:query-panel`
  - Expected: 日志展示与真实语义一致，不再误导为“原始 SQL”。

### Task 8: 将 SQLite v2 作为独立计划准备，不与主线混做

**Files:**
- Modify: `docs/mysql-refactor-iteration-plan-2026-04-22.md`
- Optional reference: `src-tauri/src/db.rs`
- Optional reference: `src-tauri/src/models.rs`

- [ ] **Step 1: 明确边界**
  - `SQLite v2` 不属于“修复 MySQL 可信编辑闭环”的同一提交范围。
  - 它应该单独产出新设计文档和迁移计划。

- [ ] **Step 2: 先只记录前置条件**
  - 只有在 Task 1 到 Task 7 稳定后，才启动 `db.rs` 拆分、schema v2、迁移、token 安全等改造。

- [ ] **Step 3: 输出独立子计划入口**
  - 后续建议新建：
  - `docs/sqlite-v2-design-2026-04-22.md`
  - `docs/sqlite-v2-implementation-plan-2026-04-22.md`

---

## 7. 建议的执行顺序

如果目标是尽快修复最伤用户信任的问题，推荐按下面顺序执行：

1. Task 1
2. Task 2
3. Task 3
4. Task 4
5. Task 6
6. Task 5
7. Task 7

说明：

- `Task 6` 在优先级上高于 `Task 5` 的 UI 预览，因为“伪成功”比“无预览”风险更高。
- `Task 5` 的前端预览必须建立在 `Task 3/4/6` 的语义已稳定之上。

## 8. 每个任务包的完成定义

只有同时满足下面条件，任务包才算完成：

1. 对应测试通过。
2. 不破坏 Salesforce 现有链路。
3. 新增类型、状态、提示文案与后端语义一致。
4. 代码仍然遵守现有目录职责，不把复杂逻辑重新塞回超大组件。
5. 用户能在 UI 上感知“当前能不能改、改了什么、提交了什么、失败在哪里”。

## 9. LLM 执行约束

后续如果让 LLM 按本文件执行代码，必须额外遵守：

1. 一次只接一个 Task，不要跨 Task 并行改同一批文件。
2. 先读本文件列出的目标文件，再动代码。
3. 先补测试，再补实现，再跑验证。
4. 所有新增前后端代码注释使用中文，编码为 UTF-8（无 BOM），换行符为 LF。
5. 如果发现某项实现需要跨越工作流 A/B/C/D，先停下并拆分，再继续。

## 10. 验证命令基线

- 前端 QueryPanel 测试
  - `npm run test:query-panel`
- DataGrid 工具测试
  - `npm run test:datagrid-utils`
- 前端构建校验
  - `npm run build`

如果某个任务包触及 Rust 结构体、Tauri 命令或 `mysql_provider.rs`，还应补充对应的 Rust 侧验证命令；当前仓库里若尚未建立对应测试基线，先补最小可运行用例，再继续扩写功能。

## 11. 本计划与原评审文档的对应关系

本计划覆盖了原评审文档中的 4 组核心问题：

- “可信编辑”问题
  - 对应 Task 2、Task 3、Task 4、Task 5
- “事务可靠性 / 伪成功”问题
  - 对应 Task 6
- “系统日志语义与失败定位”问题
  - 对应 Task 7
- “SQLite v2 / 产品增强”问题
  - 对应 Task 8，后续再拆独立子计划

## 12. 产品经理视角补充：工作流 D 的产品路线

上面的 Task 1 到 Task 8 解决的是“底座可信度”和“执行链路可靠性”。但原评审文档第 19 节强调的重点不只是“修 bug”，还包括把产品从“可查、可看、可轻量编辑的数据工作台”推进到“用户愿意长期使用的数据库客户端”。因此这里补充工作流 D 的产品层路线，供后续 LLM 在技术底座稳定后继续执行。

### 12.1 当前产品定位判断

基于当前代码和原评审文档，现阶段产品更接近：

- 带查询、DDL、字段查看、轻编辑能力的数据源工作台
- 有独立 SQL/SOQL 控制台，并开始接入 AI 辅助

但还不是：

- 高频 DBA / 开发者 / 数据分析用户会长期依赖的专业 MySQL 客户端

原因不是“功能完全没有”，而是“高频闭环不够完整、风险感知不够强、效率工具不够顺手”。

### 12.2 当前已经具备的产品基础能力

当前仓库已经具备下面这些可复用的入口，不需要推倒重来：

- 左侧对象树 / 表树浏览
- DataGrid 查询结果展示
- 新建记录、删除勾选、执行更新、撤回修改
- Query Bar 条件输入
- MySQL DDL 抽屉与字段抽屉
- 当前 Tab 操作日志
- 独立 SQL/SOQL 控制台
- AI 辅助查询入口

这意味着工作流 D 的重点不是“从零做数据库客户端”，而是在现有 QueryPanel 工作区上补齐高频能力和安全感。

### 12.3 产品体验核心短板

工作流 D 需要重点弥补 3 类短板：

1. 操作闭环偏弱
   - 还缺导出结果、保存查询、查询历史、批量编辑、Explain、快速关联导航等高频闭环。
2. 安全感不足
   - 用户很难快速确认当前环境、影响范围、失败位置、成功提示是否可信。
3. 高频用户效率不足
   - 查询历史、快捷模板、收藏、快速复制导出、日志联动、批量操作能力都偏薄。

### 12.4 工作流 D 的产品任务包

工作流 D 不建议与 Task 1 到 Task 8 混做，但可以在底座稳定后继续拆成下面 4 个产品任务包：

#### Product Task D1：环境识别与风险感知

**Goal:** 让用户始终知道自己连的是谁、正在改哪里、是否需要谨慎操作。

**建议内容：**

- 工作区顶部持续展示：
  - 数据源名称
  - 数据源类型
  - host / database
  - 环境标签，例如 `生产 / 测试 / 本地`
- 对生产环境数据源增加危险操作确认策略：
  - 执行更新前二次确认
  - 更强的颜色和文案提醒
- 增加连接健康状态展示：
  - 已连接
  - 鉴权失效
  - 网络异常
  - 最近一次成功连接时间

**优先依赖：**

- Task 4 的结果集能力模型
- Task 6 / Task 7 的结构化执行结果与日志语义

#### Product Task D2：查询与 SQL 工作流增强

**Goal:** 把 SQL 编辑区从“能执行”提升到“高频可用”。

**建议内容：**

- 查询历史
- 保存查询 / 收藏 SQL
- SQL 格式化
- 常用 SQL 模板
- 查询耗时、结果摘要、返回行数展示
- Explain / Explain Analyze 入口

**优先锚点文件：**

- `src/features/main/QueryPanel/components/SoqlExecutorWorkspace.tsx`
- `src/features/main/QueryPanel/components/DataQueryTabPane.tsx`
- `src/store/useSoqlExecutorStore.ts`
- `src/api/index.ts`
- `src-tauri/src/commands.rs`

#### Product Task D3：结果表格与高频数据操作增强

**Goal:** 让 DataGrid 不只是“编辑网格”，而是兼顾浏览、导出、排查和批量处理。

**建议内容：**

- 结果导出：
  - CSV
  - JSON
  - 复制为 TSV / Excel 友好格式
- 分页 / 分批加载策略
- 列操作：
  - 固定列
  - 自动列宽
  - 按列排序
  - 按列过滤
  - 隐藏空列
  - 记住列布局
- 单元格查看模式：
  - 长文本弹窗
  - JSON 结构化查看
  - 全文复制
- 行详情面板：
  - 完整字段值
  - 原值 vs 当前值
  - 主键 / 索引 / 外键信息
- 批量编辑：
  - 多行统一设置字段
  - Fill Down
  - Excel 风格粘贴
  - 批量置空
- 复制行 / 克隆行
- 仅保存当前行 / 当前单元格

**优先依赖：**

- Task 2 的稳定行身份
- Task 3 的显式值语义
- Task 5 的变更预览能力

#### Product Task D4：关联导航、日志联动与 AI 助手增强

**Goal:** 建立区别于普通轻量工具的“专业效率感”和“差异化”。

**建议内容：**

- 主键 / 外键跳转
- 反向引用查看
- 从 DDL / 字段面板直接生成关联查询
- 当前 Tab 直接查看本次执行详情
- 失败操作一键跳转系统日志
- 性能诊断与慢查询提示
- AI 从“生成 SQL”升级为“数据库协作助手”：
  - 根据自然语言生成 SQL
  - 解释 SQL
  - 分析报错
  - 基于表结构给出优化建议
- AI 上下文透明展示：
  - 当前表结构
  - 当前数据源
  - 当前 SQL
  - 最近错误
- AI 生成内容默认“先预览不执行”

**优先依赖：**

- Task 5 的变更预览
- Task 7 的日志结构化
- SoqlExecutorWorkspace 现有 AI 工作区能力

### 12.5 产品能力清单与阶段优先级

为了方便后续 LLM 按产品价值排序执行，工作流 D 再拆成 3 级优先级：

#### D-P0：建议尽快补齐

- 查询历史
- 保存查询 / 收藏 SQL
- 导出 CSV / JSON
- SQL 格式化
- Explain / Explain Analyze
- 变更预览
- 实际影响行数反馈
- 主键 / 外键导航
- 批量编辑
- 只读结果集前置识别

#### D-P1：建议中期补齐

- 收藏表 / 最近访问
- 行详情面板
- 列过滤 / 固定 / 自动列宽
- 结果分页导航
- 慢查询与诊断标记
- 一键复制为 Excel 友好格式
- 失败操作一键查看详细日志

#### D-P2：建议后续增强

- AI SQL 解释与优化建议
- DDL Diff / Schema Compare
- 数据对比 / 结果集对比
- 数据采样 / 字段统计
- 风险操作保护策略的高级版本

### 12.6 产品路线图与技术任务映射

为了避免“产品功能想法很多，但没有依赖顺序”，下面给出工作流 D 与 Task 1 到 Task 8 的映射：

#### 阶段一：先补可信编辑闭环

**目标：**

- 让用户敢改
- 改完知道实际发生了什么

**对应技术任务：**

- Task 2
- Task 3
- Task 4
- Task 5
- Task 6
- Task 7

**对应产品收益：**

- 变更预览
- 实际影响行数反馈
- 失败定位结构化展示
- 只读结果集前置识别
- 当前操作与系统日志联动

#### 阶段二：补高频数据库客户端能力

**目标：**

- 让用户愿意长期使用

**优先产品任务：**

- Product Task D2
- Product Task D3 中的导出、列布局、分页、复制能力

**建议先做：**

- 查询历史
- 保存查询
- 导出 CSV / JSON
- SQL 格式化
- Execute / Explain 双入口
- 收藏表 / 最近访问

#### 阶段三：补专业效率工具

**目标：**

- 从可用工具走向主力客户端

**优先产品任务：**

- Product Task D3
- Product Task D4 的导航与诊断部分

**建议先做：**

- 批量编辑
- 外键导航
- 行详情
- 大结果集浏览策略
- 慢查询诊断

#### 阶段四：补差异化能力

**目标：**

- 建立产品辨识度

**优先产品任务：**

- Product Task D4 的 AI / Schema / Compare 部分

**建议先做：**

- AI 解释 SQL
- AI 分析错误
- AI 辅助 Explain 解读
- Schema Diff / DDL 比较

### 12.7 工作流 D 的执行约束

后续如果让 LLM 执行工作流 D，必须遵守：

1. 没完成阶段一底座前，不要直接做重型批量编辑和高级 AI 功能。
2. 产品增强项必须复用现有 QueryPanel / DataGrid / SoqlExecutorWorkspace，不要先做大重构再加功能。
3. 每个产品任务包都要同步定义：
   - 用户场景
   - 涉及入口
   - 依赖的技术任务
   - 验收标准
4. 涉及危险操作的功能，必须把“预览、确认、日志、失败反馈”一起设计，不接受只加入口不补闭环。

## 13. 暂不建议本轮一起做的内容

下面这些内容虽然重要，但不建议在修 P0 主线时一起做：

- 大规模重排 `QueryPanel` 目录结构
- 一次性重写 `DataGrid`
- 同时重构 `SQLite v2` 与 MySQL 编辑链路
- 在没有结构化 planner 之前先做复杂预览 UI
- 在没有 `rows_affected` 保护之前先宣传“事务可靠”

## 14. 预期交付节奏

- 第一阶段
  - 交付可信编辑闭环最小可用版
  - 解决主键禁改、Set Null 不脏、删除定位错误、多源串状态
- 第二阶段
  - 交付事务可靠性与日志语义修正
  - 解决伪成功、失败不可定位、日志误导
- 第三阶段
  - 交付数据库客户端体验增强
  - 引入提交预览、只读原因、字段/结果集能力提示
- 第四阶段
  - 单独启动 SQLite v2

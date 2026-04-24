# MySQL 数据源前端交互与 CRUD 链路审查报告

## 1. 审查目标

本次审查聚焦当前桌面数据库客户端中 MySQL 数据源的前端交互、数据增删改查链路，以及“画面修改是否等于实际更新内容”的一致性问题，重点覆盖：

- 查询结果表格的编辑、删除、`Set Null`、新增行交互
- `dirty` / “有变更”状态的判定机制
- “执行更新”按钮激活条件
- 前端到 Tauri 后端再到 MySQL Provider 的提交链路
- 设计隐患、实现缺陷与 UI/UX 问题

补充说明：

- `AGENTS.md` 要求先执行 `mcp__ace-tool__search_context`，但当前会话未提供该工具，因此本次改为基于全量本地代码检索与链路追踪完成审查。
- 本报告未修改业务代码，只输出 review 结论与建议。

## 2. 结论摘要

当前 MySQL 编辑链路存在“界面允许改，但后端不一定按界面含义提交”的一致性问题，尤其集中在以下几类场景：

1. 主键列在前端可编辑，但后端更新时会直接丢弃主键字段，导致用户看到“已改”，实际不会更新。
2. `dirty` 判定把 `null`、`undefined`、空字符串 `""` 视为同一值，导致 `Set Null` 或清空某些字段时，不会进入“有变更”状态。
3. 新增行提交时会过滤掉 `null`、`undefined`、空字符串，因此无法精确表达“写入 NULL”“写入空字符串”“留空走默认值”三种不同语义。
4. 查询结果是否“可更新”没有在 UI 前置判定。缺主键、JOIN、别名查询等场景通常要等到执行更新时才失败。
5. 多数据源同名对象场景下，部分更新入口仍按 `objectName` 而不是 `bindingKey` 写状态，存在串改其它 Tab 的隐患。

如果目标是“保证画面修改的就是实际更新的内容”，当前实现还不够。现在更接近“尽量复用 Salesforce 的编辑框架支持 MySQL”，但 MySQL 的主键、NULL、默认值、空字符串、JOIN 结果可更新性等语义还没有被完整建模。

## 3. 当前前后端链路梳理

### 3.1 查询与基线建立

1. 前端执行对象查询或自定义 SQL，调用 `api.queryRecords(...)`。
2. Tauri 后端进入 MySQL Provider 查询。
3. 查询结果回前端后，前端构建 `baselineRecords`，后续 `dirty` 比较都基于这份快照。

关键代码：

- 查询成功后重建基线：[src/features/main/QueryPanel/hooks/useQueryExecution.ts:178](/mnt/d/test-workspace/simple-salesforce-tool/src/features/main/QueryPanel/hooks/useQueryExecution.ts#L178)
- 基线键计算：[src/features/main/QueryPanel/logic/queryUtils.ts:166](/mnt/d/test-workspace/simple-salesforce-tool/src/features/main/QueryPanel/logic/queryUtils.ts#L166)
- MySQL 记录键优先用主键值：[src/features/main/QueryPanel/logic/queryUtils.ts:178](/mnt/d/test-workspace/simple-salesforce-tool/src/features/main/QueryPanel/logic/queryUtils.ts#L178)

### 3.2 单元格编辑与 dirty 标记

1. DataGrid 编辑后调用 `onEditCell(rowIndex, columnName, value)`。
2. `useQueryPanelActions` 用 `baselineRecords` 比较旧值与新值。
3. 若比较结果不同，则把 `${stableBaselineKey}:${columnName}` 放入 `dirtyCellKeys`。
4. “执行更新”按钮是否可点，取决于 `hasPendingChanges(tab)`。

关键代码：

- 单元格编辑入口：[src/features/main/QueryPanel/hooks/useQueryPanelActions.ts:309](/mnt/d/test-workspace/simple-salesforce-tool/src/features/main/QueryPanel/hooks/useQueryPanelActions.ts#L309)
- `dirty` 比较逻辑：[src/features/main/QueryPanel/hooks/useQueryPanelActions.ts:334](/mnt/d/test-workspace/simple-salesforce-tool/src/features/main/QueryPanel/hooks/useQueryPanelActions.ts#L334)
- `Set Null` 入口：[src/components/DataGrid/hooks/useDataGridMenuActions.ts:71](/mnt/d/test-workspace/simple-salesforce-tool/src/components/DataGrid/hooks/useDataGridMenuActions.ts#L71)
- 日期/时间清空时写 `null`：[src/components/DataGrid/logic/cellEditHandler.ts:127](/mnt/d/test-workspace/simple-salesforce-tool/src/components/DataGrid/logic/cellEditHandler.ts#L127)
- 数字清空时写 `undefined`：[src/components/DataGrid/logic/cellEditHandler.ts:160](/mnt/d/test-workspace/simple-salesforce-tool/src/components/DataGrid/logic/cellEditHandler.ts#L160)
- “有变更”按钮判定：[src/features/main/QueryPanel/logic/queryUtils.ts:153](/mnt/d/test-workspace/simple-salesforce-tool/src/features/main/QueryPanel/logic/queryUtils.ts#L153)

### 3.3 执行更新

1. 前端遍历当前表格记录，拆分成 `creates`、`updates`、`deletes`。
2. MySQL 走 `saveRecordsWithDeletes`，一次事务提交新增/更新/删除。
3. 成功后重新查询当前对象。

关键代码：

- 前端组装提交 payload：[src/features/main/QueryPanel/hooks/useQueryPanelRuntime.ts:615](/mnt/d/test-workspace/simple-salesforce-tool/src/features/main/QueryPanel/hooks/useQueryPanelRuntime.ts#L615)
- 新增值过滤逻辑：[src/features/main/QueryPanel/hooks/useQueryPanelRuntime.ts:677](/mnt/d/test-workspace/simple-salesforce-tool/src/features/main/QueryPanel/hooks/useQueryPanelRuntime.ts#L677)
- 更新/删除记录定位逻辑：[src/features/main/QueryPanel/hooks/useQueryPanelRuntime.ts:701](/mnt/d/test-workspace/simple-salesforce-tool/src/features/main/QueryPanel/hooks/useQueryPanelRuntime.ts#L701)
- 后端事务提交入口：[src-tauri/src/commands.rs:2222](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/commands.rs#L2222)
- MySQL 批量事务实现：[src-tauri/src/providers/mysql_provider.rs:464](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/providers/mysql_provider.rs#L464)

## 4. 主要问题与隐患

以下按严重程度排序。

### 4.1 严重问题：主键列在界面可编辑，但后端更新会静默丢弃

现状：

- MySQL `describe` 时，所有字段都被标记为 `updateable: true`、`createable: true`，没有把主键、自增列、生成列单独禁用。
- DataGrid 因此允许直接编辑主键列。
- 但后端真正执行更新时，会在 `normalize_update_values(...)` 中移除主键字段。

证据：

- 所有字段统一可编辑：[src-tauri/src/providers/mysql_provider.rs:305](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/providers/mysql_provider.rs#L305)
- 更新时移除主键字段：[src-tauri/src/providers/mysql_provider.rs:856](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/providers/mysql_provider.rs#L856)
- 更新 SQL 仅用主键做 `WHERE`：[src-tauri/src/providers/mysql_provider.rs:1014](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/providers/mysql_provider.rs#L1014)

影响：

- 用户修改主键列后，界面会显示脏数据甚至允许提交，但实际 SQL 不会更新该列。
- 这已经直接违背“画面修改的就是实际更新的内容”。
- 更糟的是，主键列又被用作 MySQL 行键，编辑后会影响选中、删除、dirty 高亮和记录定位。

### 4.2 严重问题：`Set Null`、清空值等场景可能不会进入“有变更”状态

现状：

- `Set Null` 明确会写入 `null`。
- 日期/时间清空也会写入 `null`。
- 数字清空会写入 `undefined`。
- 但 `dirty` 比较函数把 `null`、`undefined` 都转成空字符串 `""`，字符串空值本身也是 `""`。

证据：

- `Set Null` 操作写入 `null`：[src/components/DataGrid/hooks/useDataGridMenuActions.ts:71](/mnt/d/test-workspace/simple-salesforce-tool/src/components/DataGrid/hooks/useDataGridMenuActions.ts#L71)
- 日期时间清空写 `null`：[src/components/DataGrid/logic/cellEditHandler.ts:127](/mnt/d/test-workspace/simple-salesforce-tool/src/components/DataGrid/logic/cellEditHandler.ts#L127)
- 数字清空写 `undefined`：[src/components/DataGrid/logic/cellEditHandler.ts:160](/mnt/d/test-workspace/simple-salesforce-tool/src/components/DataGrid/logic/cellEditHandler.ts#L160)
- `dirty` 比较把 `null/undefined` 归一到 `""`：[src/features/main/QueryPanel/hooks/useQueryPanelActions.ts:334](/mnt/d/test-workspace/simple-salesforce-tool/src/features/main/QueryPanel/hooks/useQueryPanelActions.ts#L334)

会出现的典型问题：

- 原值是空字符串，用户执行 `Set Null`，比较后仍然等于 `""`，不会标脏。
- 原值是 `undefined` / 缺省，用户执行 `Set Null`，不会标脏。
- 某些字段清空后想表达 SQL `NULL`，但前端状态认为“没变”。

这与用户反馈“某些时候 set null 操作或者某些修改没有激活‘有变更’状态”高度一致，属于当前实现的直接根因。

### 4.3 严重问题：主键编辑后再删除，界面可能显示“待删除”，实际提交不会删除

现状：

- DataGrid 当前选中、右键、待删除行高亮，依赖的是“当前记录键”。
- MySQL 当前记录键取当前行里的主键值。
- 但提交删除时，`applyPendingChanges` 优先使用 `baselineRecord` 中的旧主键值作为 `recordId`。

证据：

- DataGrid 用当前主键值作为记录键：[src/components/DataGrid/index.tsx:143](/mnt/d/test-workspace/simple-salesforce-tool/src/components/DataGrid/index.tsx#L143)
- 编辑时用 `__baselineKey` 保持脏标记稳定：[src/features/main/QueryPanel/hooks/useQueryPanelActions.ts:316](/mnt/d/test-workspace/simple-salesforce-tool/src/features/main/QueryPanel/hooks/useQueryPanelActions.ts#L316)
- 删除提交时优先取 baseline 中的旧 `recordId`：[src/features/main/QueryPanel/hooks/useQueryPanelRuntime.ts:701](/mnt/d/test-workspace/simple-salesforce-tool/src/features/main/QueryPanel/hooks/useQueryPanelRuntime.ts#L701)
- 删除判断依赖 `pendingDeleteSet.has(recordId)`：[src/features/main/QueryPanel/hooks/useQueryPanelRuntime.ts:713](/mnt/d/test-workspace/simple-salesforce-tool/src/features/main/QueryPanel/hooks/useQueryPanelRuntime.ts#L713)

结果：

- 用户把主键从 `1` 改到 `2` 后，再勾选删除，待删除集合里记住的是 `2`。
- 真正提交删除时，系统拿去匹配的是 baseline 里的旧主键 `1`。
- 匹配失败后，这行不会进入 `deletes`。

这类问题非常危险，因为它不是“报错”，而是“界面看起来准备删除，实际没有删”。

### 4.4 高风险问题：新增行无法精确表达“NULL / 空字符串 / 默认值”

现状：

- 新增行组包时，前端会跳过 `null`、`undefined`、空字符串。
- 也就是说，新增时只能表达“提交一个非空值”，无法精确表达：
  - 我要写 SQL `NULL`
  - 我要写空字符串 `''`
  - 我要省略字段，让数据库走默认值

证据：

- 新增组包时统一过滤空值：[src/features/main/QueryPanel/hooks/useQueryPanelRuntime.ts:677](/mnt/d/test-workspace/simple-salesforce-tool/src/features/main/QueryPanel/hooks/useQueryPanelRuntime.ts#L677)

影响：

- 可空字段想显式插入 `NULL`，前端做不到。
- 文本字段想插入空字符串，前端也做不到。
- 如果整行都是默认值，用户“新建一行后直接执行更新”会变成无操作，体验上像成功，语义上却不清晰。

这也是“画面状态”和“实际 INSERT 语义”不一致的核心问题之一。

### 4.5 高风险问题：查询结果是否可更新，没有前置能力判断

现状：

- MySQL 查询允许自定义 SQL。
- 后端会尝试从 SQL 文本里推断 `FROM <table>`，再自动补 `Id`。
- 但这个推断非常弱，只支持非常简单的单表语句。
- 如果查询结果里没有主键字段，前端通常要等到执行更新时才发现不可更新。

证据：

- 后端只做简单 `FROM` 表名推断：[src-tauri/src/providers/mysql_provider.rs:787](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/providers/mysql_provider.rs#L787)
- 自动补 `Id` 的前提是已成功推断主键并且结果里存在该字段：[src-tauri/src/providers/mysql_provider.rs:363](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/providers/mysql_provider.rs#L363)
- 提交时若缺少 `recordId` 才报错：[src/features/main/QueryPanel/hooks/useQueryPanelRuntime.ts:723](/mnt/d/test-workspace/simple-salesforce-tool/src/features/main/QueryPanel/hooks/useQueryPanelRuntime.ts#L723)

典型失败场景：

- `JOIN`
- 子查询
- 带别名的复杂 SELECT
- 结果里没选主键列
- 多表同名列重名但没做唯一映射

结果是：用户已经在表格里改了很多内容，最后才在点击“执行更新”时报“缺少 Id / 请确保包含主键列”。

### 4.6 高风险问题：多数据源同名对象场景下，部分状态更新仍按 `objectName` 写入

现状：

- Store 层已经支持 `bindingKey`，且测试也验证了多 source 同名对象隔离。
- 但 QueryPanel 某些写操作仍使用 `activeTab.objectName` 调 `patchTab(...)`。
- `patchTab` 本身又兼容“按 `bindingKey` 或 `objectName` 命中 Tab”。

证据：

- Store 允许按 `objectName` 命中 Tab：[src/store/useAppStore.ts:51](/mnt/d/test-workspace/simple-salesforce-tool/src/store/useAppStore.ts#L51)
- `patchTab` 实际就是用该规则遍历所有 Tab：[src/store/useAppStore.ts:161](/mnt/d/test-workspace/simple-salesforce-tool/src/store/useAppStore.ts#L161)
- 编辑、勾选等动作仍传 `activeTab.objectName`：[src/features/main/QueryPanel/hooks/useQueryPanelActions.ts:296](/mnt/d/test-workspace/simple-salesforce-tool/src/features/main/QueryPanel/hooks/useQueryPanelActions.ts#L296)

影响：

- 当两个数据源都打开同名表，例如 `users`，某些选择、dirty、notice 状态可能串到另一个 Tab。
- 这不是 MySQL 独有问题，但 MySQL 常见同名表，多库切换时命中概率更高。

### 4.7 设计问题：MySQL 字段能力建模过粗，UI 暴露了后端不保证支持的能力

现状：

- MySQL `describe` 仅返回 `nillable / createable / updateable` 的极粗粒度值。
- 当前直接把所有字段视为可新增/可更新。
- 仅在“新增必填校验”里临时排除了 `auto_increment` / `generated`，但编辑阶段并没有禁掉这些字段。

证据：

- 字段统一 `updateable/createable = true`：[src-tauri/src/providers/mysql_provider.rs:309](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/providers/mysql_provider.rs#L309)

结果：

- 自增主键、生成列、某些系统列，在 UI 上看起来可编辑。
- 真正提交时不是被后端忽略，就是交给数据库报错。
- 用户无法从界面预判哪些字段能安全改、哪些只能看。

## 5. 为什么当前实现无法保证“画面修改 = 实际提交”

如果要保证一致性，至少要满足下面四件事：

1. 画面上的每个可编辑字段，都必须与后端真实可写字段一一对应。
2. 画面上的每种输入状态，都必须能精确映射到提交语义。
3. 行标识必须稳定，不能被“用户正在编辑的值”本身影响。
4. 提交前必须知道当前结果集是否真的可更新。

当前实现分别在这四点上都有缺口：

- 字段能力不准确：主键/自增/生成列仍可编辑。
- 值语义不准确：`null`、`undefined`、`""` 被混淆。
- 行标识不稳定：当前主键值既当展示值又当选择键。
- 可更新性不前置：缺主键、JOIN 等问题要到提交时才暴露。

所以目前无法严格保证“用户在表格里改的内容，就是最终 SQL 实际落库的内容”。

## 6. UI / UX 缺陷

### 6.1 “Set Null” 是上下文菜单动作，但没有状态可视化解释

- 用户执行 `Set Null` 后，如果没进入 dirty，看起来像“点击了但没生效”。
- 当前没有任何“本格将写入 NULL”的显式标记，只是依赖脏色高亮。

### 6.2 用户无法区分三种空值语义

当前 UI 没有把下面三种状态区别开：

- `NULL`
- 空字符串 `""`
- 未填写，交给默认值

对 MySQL 来说，这三种语义通常完全不同，但当前表格交互把它们混在一起了。

### 6.3 缺少“结果集可更新性”提示

建议在查询结果顶部直接给出：

- 可更新：单表 + 包含主键
- 只读：复杂查询 / JOIN / 缺主键

当前是“先让你改，再在提交时失败”，交互成本太高。

### 6.4 缺少“实际提交内容预览”

虽然系统日志里会记 MySQL 预览 SQL，但普通用户在点击“执行更新”前看不到：

- 哪些列会被更新
- 哪些字段会被写成 `NULL`
- 哪些改动只是界面态，后端其实会忽略

这让“执行更新”像盲点提交。

### 6.5 缺少对主键/系统字段的明确只读标识

- 主键列应该被锁定或展示只读徽标。
- 自增/生成列应该在表头或元数据中明确标记“只读”。

否则用户会自然认为“能点开编辑器就能保存”。

## 7. 建议的整改方向

以下按优先级排序。

### P0：先修一致性，避免“看起来改了，实际没改”

1. 禁止编辑 MySQL 主键、自增列、生成列。
2. `dirty` 比较必须区分 `null`、`undefined`、`""`。
3. DataGrid 的行内部标识改为不可变内部键，不再直接依赖当前主键值。
4. 删除、勾选、dirty、高亮、提交都统一基于同一个稳定行 ID。

### P1：把“值语义”建模清楚

建议把单元格待提交值改成显式三态，而不是直接塞 `unknown`：

- `kind: "omit"`：不提交该字段
- `kind: "null"`：显式写 `NULL`
- `kind: "value", value: ...`：写具体值

这样新增、更新都能正确表达：

- 留空走默认值
- 显式清空为 `NULL`
- 写空字符串 `''`

### P1：查询结果增加“是否可更新”的前置判定

在查询结果生成后就给出 `rowUpdateCapability`：

- `editable`
- `readonly_missing_pk`
- `readonly_complex_query`
- `readonly_multi_table`

只要不是 `editable`，就应：

- 禁用单元格编辑
- 禁用“执行更新”
- 明确展示原因

### P1：严格收口到 `bindingKey`

所有写状态入口都应该只传 `bindingKey`，不要再兼容写路径里的 `objectName`。

否则多数据源同名对象的隔离只做了一半。

### P2：补充“提交前预览”

建议在“执行更新”前给出轻量预览：

- 新增几行
- 更新几行、哪些列
- 删除几行
- 哪些字段会写入 `NULL`

这样可以让用户在真正提交前发现“主键修改不会落库”这类问题。

## 8. 建议的目标设计

如果项目后续希望把 MySQL 数据编辑体验做成“真正可依赖的数据库客户端”，推荐采用下面的设计原则：

### 8.1 结果行模型

- `rowStableId`：前端内部稳定 ID，不因用户编辑而变化
- `rowLocator`：后端定位条件，通常是主键原值
- `baseline`：查询快照
- `draft`：当前编辑态

### 8.2 字段修改模型

每个字段不要只存“当前值”，而要存：

- 原值
- 当前值
- 是否显式改为 `NULL`
- 是否显式清空为空字符串
- 是否保持默认/不提交

### 8.3 可更新能力模型

对每个结果集都明确产出：

- 是否可新增
- 是否可更新
- 是否可删除
- 不可更新原因

### 8.4 提交模型

提交给后端的应该是显式 diff，而不是把当前整行重新扫描后临时猜：

- `rowLocator`
- `changes: [{ field, op: "set" | "set_null" | "omit", value? }]`

这样更容易保证前后端语义一致。

## 9. 测试覆盖建议

当前仓库已有 QueryPanel 与 DataGrid 的一些测试，但我没有发现覆盖以下关键路径的自动化测试：

- `Set Null` 是否会触发 dirty
- 空字符串、`null`、`undefined` 的差异比较
- 主键编辑后删除/更新的行为
- MySQL 新增时的 `NULL / 空字符串 / 默认值` 语义
- 多数据源同名表下的编辑隔离
- JOIN / 缺主键结果集是否应被判为只读

这些都应补成回归测试，否则后续继续迭代 UI 时非常容易反复出现“看起来能改、实际不能提交”的问题。

## 10. 最终判断

当前 MySQL 数据源的查询展示已经具备基本能力，但“可编辑数据库客户端”这一层还没有完全闭环。

更准确地说：

- 查询、展示、事务提交这三部分都已经存在
- 但“编辑语义建模”还不完整
- 因此当前实现更适合轻量表格编辑，不适合向用户承诺“所见即所得”的数据库更新体验

如果只修一个问题，我建议优先修：

1. 主键列禁改
2. `dirty` 比较区分 `null/undefined/""`
3. 行稳定 ID 与提交定位分离

这三项修完后，至少能先把“界面改了但实际没改 / 明明点了 Set Null 却不能提交”这类最伤信任的问题压下去。

## 11. “设置 -> 系统日志”专项复审

本轮补充审查聚焦两个问题：

1. 系统日志里看到的 MySQL SQL，是否就是系统实际执行的 SQL
2. 一次“执行更新”同时包含新增、修改、删除时，是否真的满足“要么全部成功，要么全部失败”，以及失败时用户能否感知

### 11.1 系统日志前后端链路

当前系统日志链路是：

1. 前端“设置 -> 系统日志”页面通过 `useSystemLogsQuery(page, pageSize)` 调后端分页接口。
2. Tauri `list_system_logs` 从本地 SQLite `system_logs` 表倒序读取。
3. 各 MySQL CRUD 命令在执行后，调用统一的 `write_system_log(...)` 写入日志。

关键代码：

- 前端日志页轮询展示：[src/features/main/SettingsPanel/SystemLogs.tsx:19](/mnt/d/test-workspace/simple-salesforce-tool/src/features/main/SettingsPanel/SystemLogs.tsx#L19)
- 日志正文仅按 `message + detail` 展示：[src/features/main/SettingsPanel/systemLogContent.ts:7](/mnt/d/test-workspace/simple-salesforce-tool/src/features/main/SettingsPanel/systemLogContent.ts#L7)
- Tauri 统一日志入口：[src-tauri/src/commands.rs:33](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/commands.rs#L33)
- SQLite 写日志：[src-tauri/src/db.rs:1319](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/db.rs#L1319)
- SQLite 分页读日志：[src-tauri/src/db.rs:1350](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/db.rs#L1350)

### 11.2 结论：系统日志记录的是“可读 SQL 预览”，不是驱动层真实发出的原始 SQL

这是本轮最核心的结论。

MySQL 日志 detail 的生成方式不是从数据库驱动层抓“真实发送给 MySQL 的最终 SQL 字符串”，而是后端在执行前，用一套 preview 函数重新拼出“可读 SQL 文本”。

证据：

- 新增 preview：[src-tauri/src/providers/mysql_provider.rs:60](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/providers/mysql_provider.rs#L60)
- 批量新增/更新 preview：[src-tauri/src/providers/mysql_provider.rs:71](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/providers/mysql_provider.rs#L71)
- 批量新增/更新/删除 preview：[src-tauri/src/providers/mysql_provider.rs:106](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/providers/mysql_provider.rs#L106)
- 单条更新 preview：[src-tauri/src/providers/mysql_provider.rs:148](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/providers/mysql_provider.rs#L148)
- 单条删除 preview：[src-tauri/src/providers/mysql_provider.rs:166](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/providers/mysql_provider.rs#L166)

而真实执行是另一套 `QueryBuilder + push_bind(...)` 参数绑定流程：

- INSERT 执行：[src-tauri/src/providers/mysql_provider.rs:960](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/providers/mysql_provider.rs#L960)
- UPDATE 执行：[src-tauri/src/providers/mysql_provider.rs:998](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/providers/mysql_provider.rs#L998)
- DELETE 执行：[src-tauri/src/providers/mysql_provider.rs:1033](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/providers/mysql_provider.rs#L1033)
- 参数绑定：[src-tauri/src/providers/mysql_provider.rs:1055](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/providers/mysql_provider.rs#L1055)

因此更准确的表述应该是：

- 系统日志里的 SQL 不是 wire-level 原始 SQL
- 它是“与真实执行共用同一套表名/主键/字段归一化规则后，重建出的可读 SQL 预览”

### 11.3 这份 SQL 预览与真实执行的相似度很高，但不能当作严格审计证据

相似度高的原因：

- preview 和 execute 共用同一个表名/主键解析逻辑：[src-tauri/src/providers/mysql_provider.rs:745](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/providers/mysql_provider.rs#L745)
- preview 和 execute 共用新增/更新归一化逻辑，比如都会移除主键更新：[src-tauri/src/providers/mysql_provider.rs:856](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/providers/mysql_provider.rs#L856)
- preview 和 execute 共用字段排序逻辑，日志顺序和执行顺序一致：[src-tauri/src/providers/mysql_provider.rs:866](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/providers/mysql_provider.rs#L866)
- 批量操作 preview 会按 create -> update -> delete 顺序逐条展开，与事务中的执行顺序一致：[src-tauri/src/providers/mysql_provider.rs:117](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/providers/mysql_provider.rs#L117), [src-tauri/src/providers/mysql_provider.rs:481](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/providers/mysql_provider.rs#L481)

但它仍然不是严格等价的“实际执行 SQL”，原因包括：

1. 真实执行使用的是 prepared statement / bind 参数，而日志是插值后的可读字符串。
2. 布尔值、`NULL`、JSON、数字等值类型，日志展示与驱动最终绑定的底层表达并不完全相同。
3. 日志是在执行前生成的“计划 SQL”，不是执行后从数据库返回的“已执行 SQL 回执”。

例如：

- 日志里布尔值会显示成 `TRUE/FALSE`：[src-tauri/src/providers/mysql_provider.rs:885](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/providers/mysql_provider.rs#L885)
- 真实执行时布尔值是通过 bind 传递：[src-tauri/src/providers/mysql_provider.rs:1061](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/providers/mysql_provider.rs#L1061)

所以当前系统日志更适合作为“研发排障日志 / 用户白盒辅助日志”，不应被定义为“数据库审计级真实 SQL 留痕”。

### 11.4 严重问题：系统日志是 best effort，不是可靠审计链

`write_system_log(...)` 明确写了“日志写入失败不应影响主流程”，内部直接吞掉写日志错误。

证据：

- 日志写失败直接吞掉：[src-tauri/src/commands.rs:33](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/commands.rs#L33)

这意味着：

- MySQL 实际执行成功，但 SQLite 系统日志可能没写进去
- 系统日志页显示“缺日志”，不代表操作没发生
- 对生产级产品来说，这不满足严格审计或合规留痕要求

结论：

- 当前“系统日志”更接近 troubleshooting log
- 不是 audit log

## 12. “执行更新”混合新增/修改/删除的事务语义复审

### 12.1 结论：当前 MySQL 前端确实统一走单次批量提交入口

前端 `applyPendingChanges` 对 MySQL 会统一调用 `api.saveRecordsWithDeletes(...)`，不再拆成多个独立请求。

证据：

- MySQL 执行更新统一走单事务命令：[src/features/main/QueryPanel/hooks/useQueryPanelRuntime.ts:729](/mnt/d/test-workspace/simple-salesforce-tool/src/features/main/QueryPanel/hooks/useQueryPanelRuntime.ts#L729)

这点符合“不要影响 Salesforce，只针对 MySQL”的目标，因为 Salesforce 依旧保留原有拆分逻辑，没有被本次 MySQL 路径影响。

### 12.2 结论：当前代码设计目标是“要么全部提交，要么整体失败”

后端 `save_records_with_deletes` 的控制流是：

1. 开启事务
2. 逐条执行新增
3. 逐条执行更新
4. 逐条执行删除
5. 全部成功后才 `commit`

证据：

- Tauri 命令入口：[src-tauri/src/commands.rs:2222](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/commands.rs#L2222)
- Provider 事务实现：[src-tauri/src/providers/mysql_provider.rs:463](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/providers/mysql_provider.rs#L463)
- `commit` 只在最后执行：[src-tauri/src/providers/mysql_provider.rs:509](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/providers/mysql_provider.rs#L509)

因此从控制流上看，只要新增/更新/删除中任何一步返回错误，就不会进入 `commit`。

换句话说，当前实现的事务意图是：

- 成功时：一次提交全部落库
- 中途任一语句失败时：本次批量提交不完成

### 12.3 但存在一个很大的产品风险：有些“没生效”不会报错

虽然当前代码在 SQL 执行报错时会整体失败，但它没有检查 `UPDATE` / `DELETE` 的 `rows_affected`。

证据：

- UPDATE 执行后直接 `Ok(())`，未判断影响行数：[src-tauri/src/providers/mysql_provider.rs:1025](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/providers/mysql_provider.rs#L1025)
- DELETE 执行后直接 `Ok(())`，未判断影响行数：[src-tauri/src/providers/mysql_provider.rs:1047](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/providers/mysql_provider.rs#L1047)

这会导致一种很危险的“伪成功”：

- SQL 语句执行成功
- 但实际 0 行受影响
- 前端仍然会提示“执行更新成功，变更已提交”
- 系统日志也会记成功

典型场景：

- 记录已经被别人删掉
- 主键定位值已过期
- 前端 stale 数据导致 `WHERE primary_key = ?` 命不中

对生产产品来说，这类“没有报错，但也没有真正改到数据”的情况，比显式失败更危险。

### 12.4 结论：当前事务是“SQL 执行级原子”，不是“业务效果级原子”

可以把当前状态分成两层理解：

1. SQL 执行级：
   当前实现基本满足“报错则不 commit”的事务目标。
2. 业务效果级：
   还不满足“用户想改的东西一定实际改到了”的可靠保障。

原因就在于：

- 没检查 `rows_affected`
- 没把“0 行命中”视作失败
- 没把具体失败子语句与具体记录准确暴露给用户

## 13. 失败提示与用户可感知性复审

### 13.1 当前有失败提示，但颗粒度不够

当前前端在 MySQL 执行更新失败时，会直接显示错误 notice，并记录当前 Tab 日志。

证据：

- 前端失败提示：[src/features/main/QueryPanel/hooks/useQueryPanelRuntime.ts:766](/mnt/d/test-workspace/simple-salesforce-tool/src/features/main/QueryPanel/hooks/useQueryPanelRuntime.ts#L766)

后端系统日志也会把：

- 计划 SQL 预览
- 最终错误信息

拼接在 `detail` 中写入 SQLite。

证据：

- 批量提交失败时 detail = `operation_detail + error=...`：[src-tauri/src/commands.rs:2312](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/commands.rs#L2312)

所以回答“失败时会有提示吗”：

- 会
- 前端会弹出错误提示
- 系统日志也会留下失败记录

### 13.2 但当前用户仍然很难感知“到底哪里错了”

主要问题：

1. 前端弹窗通常只有一条合成错误字符串，没有结构化到“第几条新增/哪一条更新/哪个字段”。
2. 系统日志默认折叠长文本：[src/features/main/SettingsPanel/systemLogContent.ts:18](/mnt/d/test-workspace/simple-salesforce-tool/src/features/main/SettingsPanel/systemLogContent.ts#L18)
3. 系统日志页没有筛选 `MYSQL_DB`、没有按对象/动作过滤、没有搜索。
4. 一次批量提交失败时，日志能看到整批 preview SQL，但通常不能直接知道到底是 `[create#0]`、`[update#2]` 还是 `[delete#1]` 失败，除非 MySQL 原始错误文本碰巧足够清晰。

因此用户虽然“知道失败了”，但还做不到“快速定位失败点”。

### 13.3 更严重的一点：当前系统日志没有明确标记“这是预览 SQL，不是驱动原始 SQL”

从 UI 来看，系统日志把 `message` 和 `detail` 直接拼成正文展示，没有任何标签区分：

- 计划 SQL
- 实际返回错误
- 真实执行结果

证据：

- 日志页仅做文本拼接展示：[src/features/main/SettingsPanel/SystemLogs.tsx:89](/mnt/d/test-workspace/simple-salesforce-tool/src/features/main/SettingsPanel/SystemLogs.tsx#L89)

这会给用户一个误导印象：

- 以为这里看到的 SQL 就是数据库实际执行的最终原文

但实际不是。

## 14. 对“生产级产品”的额外判断

如果按生产级数据库客户端标准看，当前 MySQL 系统日志与失败感知机制还存在以下不足：

### 14.1 不足一：日志语义不够严谨

建议把 MySQL 日志 detail 明确分成结构化区块：

- `preview_sql`
- `execution_mode=transaction`
- `result=success|failed`
- `error_message`
- `rows_affected_summary`

否则现在的纯文本拼接方式，既不适合机器分析，也容易误导人工阅读。

### 14.2 不足二：缺少逐语句执行结果

当前批量事务日志只记录“整批计划执行什么 SQL”，但没有记录：

- 每条子语句是否真正命中
- 哪一条失败
- 已影响多少行

这对于生产问题排查不够。

### 14.3 不足三：缺少 0 行命中的失败保护

对于 UPDATE / DELETE，生产级产品通常至少需要以下策略之一：

- `rows_affected === 0` 直接视为失败
- 或在 UI 明确标记“执行成功但 0 行受影响”

当前两者都没有。

### 14.4 不足四：失败感知没有闭环到用户操作上下文

当前用户失败后只能：

- 看一条顶层错误提示
- 自己再去“设置 -> 系统日志”翻日志

但系统没有把本次失败与对应日志直接关联起来，也没有自动展开失败详情，更没有定位到具体行/字段。

## 15. 建议追加到整改优先级中的事项

在前面 P0 / P1 建议基础上，我建议再补三项与系统日志和事务可靠性直接相关的整改：

### P0：把日志定义从“原始 SQL”改成“执行预览 SQL”

界面和文案都要明确：

- 当前展示的是执行前生成的 SQL 预览
- 不是驱动层原始 SQL 抓包

避免误导用户和研发同事。

### P0：对 UPDATE / DELETE 增加 `rows_affected` 校验

建议：

- 单条更新/删除：`rows_affected !== 1` 直接报错
- 批量事务：任一子语句 `rows_affected !== 1`，整批失败

否则系统会持续存在“显示成功但没改到数据”的生产风险。

### P1：给失败批次输出结构化失败定位

建议在日志和前端提示里同时输出：

- 失败阶段：`create / update / delete`
- 失败序号：例如 `update#2`
- 失败记录主键
- 数据库原始错误

这样用户才能真正感知“哪里错了”。

### P1：系统日志页增加 MySQL 维度过滤和失败优先视图

建议增加：

- 分类过滤：`MYSQL_DB`
- 动作过滤：`query_records / save_records_with_deletes / update_record / delete_record`
- 仅看失败
- 按数据源/对象过滤

对生产排障帮助会非常大。

## 16. 本轮补充审查的最终结论

针对 MySQL 数据源，可以给出更准确的结论：

1. 当前“执行更新”混合新增、修改、删除，设计上确实走单次事务提交，目标是 all-or-nothing。
2. 但系统日志记录的是“重建后的 SQL 预览”，不是驱动层真实原始 SQL，因此不能直接当作审计级执行 SQL 证据。
3. 当前失败时前端和系统日志都会提示，但提示颗粒度还不够，用户通常知道“失败了”，却不容易知道“哪一步、哪条记录、哪个字段失败了”。
4. 更关键的是，`UPDATE / DELETE` 没检查 `rows_affected`，所以当前系统仍存在“提示成功、日志也记成功，但实际上 0 行被修改/删除”的风险。

如果把这个产品定位为生产级数据库客户端，那么 MySQL 路径至少还需要补齐：

- 日志语义澄清
- `rows_affected` 可靠性校验
- 批量失败定位
- 系统日志可过滤与可诊断性

否则“系统日志”和“执行更新成功提示”都还不足以向用户承诺：系统显示成功，就一定真实改到了数据库中的目标数据。

## 17. SQLite v2 重构方案

这一节回答的是更底层的问题：

- 当前本地 SQLite 设计是否还适合继续演进
- 如果接受破坏性变更，应该怎么重构
- 重构后的目标是什么

结论先说：

- **SQLite 这个技术选型本身没有问题**
- **当前 SQLite schema / 访问层设计已经明显积累了兼容债和边界混乱**
- **建议保留 SQLite，但接受一次 SQLite v2 级别的破坏性重构**

也就是说：

- 不建议“换数据库”
- 建议“重做本地数据模型和迁移体系”

### 17.1 为什么不是继续小修小补

当前 SQLite 设计已经出现了几个典型的“需要重构而不是继续缝补”的信号。

#### 17.1.1 主模型已经迁到 `data_sources`，但旧 `salesforce_sources` 仍然被长期保留

当前 schema 中同时存在：

- `data_sources`
- `salesforce_sources`

而且缓存表外键还挂在旧表上。

证据：

- 新主表 `data_sources`：[src-tauri/src/db.rs:17](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/db.rs#L17)
- 旧表 `salesforce_sources`：[src-tauri/src/db.rs:30](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/db.rs#L30)
- 缓存表仍引用旧表外键：[src-tauri/src/db.rs:40](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/db.rs#L40)
- 启动时迁移旧表到新表：[src-tauri/src/db.rs:114](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/db.rs#L114)
- 启动时又把新表回填到旧表：[src-tauri/src/db.rs:184](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/db.rs#L184)

这说明当前不是“兼容过渡期”，而是“兼容层已经变成正式结构的一部分”。

#### 17.1.2 多步写操作没有统一事务边界

例如：

- 新建数据源先写 `data_sources`，再写 legacy 镜像
- 删除数据源是多条独立 `DELETE`
- CLI 数据源清理也是多条独立删除

证据：

- 新建数据源双写：[src-tauri/src/db.rs:823](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/db.rs#L823)
- 删除数据源多次删除：[src-tauri/src/db.rs:1077](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/db.rs#L1077)
- CLI 清理多次删除：[src-tauri/src/db.rs:1016](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/db.rs#L1016)

这意味着 SQLite 本地状态可能出现“部分写成功、部分没写成功”的中间态。

#### 17.1.3 读操作带修复副作用，说明不变量没有在写路径收住

最典型的例子是 `list_sources()` 每次读取前都会调用 `normalize_source_sort_orders()`。

证据：

- 读取时修序号：[src-tauri/src/db.rs:746](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/db.rs#L746)

这类模式在早期原型里很常见，但对于生产产品，它意味着：

- 数据已经允许带病存在
- 只能靠读取时被动修复
- 问题来源难以追踪

#### 17.1.4 一个 SQLite 文件承载了太多不同行为语义

当前同一个库同时承载：

- 数据源配置
- 元数据缓存
- 列显示配置
- 系统日志
- 应用设置
- UI 状态
- 终端命令管理

证据：

- 全部 schema 定义集中在同一文件：[src-tauri/src/db.rs:13](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/db.rs#L13)
- `app_settings` 同时被产品配置与 UI state 复用：[src-tauri/src/db.rs:81](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/db.rs#L81), [src-tauri/src/commands.rs:2877](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/commands.rs#L2877)

这不是不能用，但说明边界还停留在“工程方便”阶段，而不是“产品数据架构”阶段。

#### 17.1.5 SQLite 连接初始化过于简化

当前启动时基本只有：

- `Connection::open`
- `init_schema`

我没有看到 SQLite 初始化 PRAGMA，包括：

- `foreign_keys = ON`
- `journal_mode = WAL`
- `busy_timeout`

证据：

- 连接初始化位置：[src-tauri/src/main.rs:36](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/main.rs#L36)

而应用状态里目前是一个全局 `Mutex<Connection>`。

证据：

- 单连接全局锁：[src-tauri/src/app_state.rs:15](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/app_state.rs#L15)

这对低并发原型能跑，但不符合生产级桌面客户端的长期演进预期。

### 17.2 SQLite v2 的重构目标

SQLite v2 不是“把原来表名改一改”，而是要明确以下目标：

1. 只保留一套真实主模型，不再保留长期双写兼容层
2. 明确 schema migration 机制，不再靠启动时 ad-hoc 修补
3. 所有多步写操作必须事务化
4. 配置 / 缓存 / 日志 / UI 状态分层清晰
5. 敏感信息与普通业务配置分离
6. 对未来 MySQL / Salesforce / 其它数据源扩展保持稳定

### 17.3 SQLite v2 推荐架构

#### 17.3.1 数据分层

建议把本地 SQLite 逻辑上拆成四层：

**1. 配置层**

- 数据源定义
- LLM/CLI/终端等产品配置

**2. 缓存层**

- 对象列表缓存
- describe / DDL / 其它元数据缓存

**3. 运行状态层**

- 列可见性
- UI 持久化状态

**4. 诊断层**

- 系统日志
- 后续可能增加的操作审计

可以仍放在同一个 SQLite 文件里，但 schema 和访问层必须分层，不要继续混成一个 `db.rs` 大杂烩。

#### 17.3.2 主模型统一为 `sources`

建议直接用一张主表替代当前的：

- `data_sources`
- `salesforce_sources`

推荐目标：

```text
sources
  id                TEXT PRIMARY KEY
  name              TEXT NOT NULL
  source_type       TEXT NOT NULL
  sort_order        INTEGER NOT NULL
  config_json       TEXT NOT NULL
  secret_ref        TEXT NULL
  created_at        TEXT NOT NULL
  updated_at        TEXT NOT NULL
  deleted_at        TEXT NULL
```

设计要点：

- `instance_url` / `access_token` / `api_version` 不再继续作为顶层重复列长期存在
- 真正类型差异放到 `config_json`
- 面向 UI 排序和列表展示只依赖 `sources`

这样做的价值是：

- 去掉当前新旧双模型并存的结构债
- 让所有缓存和状态真正引用统一主表

#### 17.3.3 缓存表统一引用 `sources`

当前缓存表和设置表都不该继续引用 `salesforce_sources`。

建议重构为：

```text
object_list_cache
source_object_metadata_cache
column_visibility_settings
```

全部统一：

- `FOREIGN KEY(source_id) REFERENCES sources(id) ON DELETE CASCADE`

这样删除 source 时，不需要再手写一串 delete 兜底。

#### 17.3.4 `app_settings` 与 `ui_state` 分表

当前 `app_settings` 被同时拿来存：

- 产品设置
- 通用 UI 状态

这会导致：

- 语义不清
- 排障时很难区分“配置”与“视图状态”

建议拆成：

```text
app_settings
ui_state
```

推荐：

- `app_settings`：只存产品级配置
- `ui_state`：只存界面持久化状态

#### 17.3.5 系统日志与审计日志分层

当前 `system_logs` 更像 troubleshooting log，不是 audit log。

SQLite v2 推荐明确分两类：

```text
system_logs
audit_events   （可选，后续再上）
```

其中：

- `system_logs`：给研发和支持排障
- `audit_events`：给产品可信留痕

如果暂时不做 `audit_events`，也至少要先把 `system_logs` 结构化。

### 17.4 SQLite v2 推荐表结构方向

下面是推荐方向，不要求与最终 SQL 一字不差，但建议保持这个边界。

#### 17.4.1 `sources`

用途：

- 统一保存所有数据源定义

建议字段：

- `id`
- `name`
- `source_type`
- `sort_order`
- `config_json`
- `created_at`
- `updated_at`
- `deleted_at`

可选增强：

- `display_color`
- `last_health_status`
- `last_health_checked_at`

#### 17.4.2 `source_object_metadata_cache`

用途：

- 替代现在分散的 `object_metadata_cache` + `source_metadata_cache`

建议字段：

- `source_id`
- `cache_type`：如 `object_list` / `object_describe` / `object_ddl`
- `object_name`
- `payload`
- `etag` / `content_hash`
- `updated_at`
- `expires_at`

这样能统一失效策略和缓存策略。

#### 17.4.3 `column_visibility_settings`

这个表可以保留，但建议加上：

- `version`
- `updated_by_client_version`

方便未来列模型演进时做兼容判断。

#### 17.4.4 `system_logs`

当前建议升级为：

```text
system_logs
  id
  created_at
  level
  category
  action
  source_id
  target
  success
  message
  detail
  detail_json
  correlation_id
  request_id
```

重点是：

- 保留 `message/detail` 兼容旧 UI
- 新增 `detail_json` 用于结构化诊断
- 新增 `correlation_id` 把同一次前端操作串起来

#### 17.4.5 `ui_state`

建议：

```text
ui_state
  key TEXT PRIMARY KEY
  value TEXT NOT NULL
  updated_at TEXT NOT NULL
```

把 `save_ui_state/get_ui_state` 从 `app_settings` 中彻底分离出来。

### 17.5 SQLite v2 必须接受的破坏性改变

如果决定做 v2，我建议直接接受以下 breaking changes，不要再保守兼容旧结构。

#### 17.5.1 删除 legacy `salesforce_sources`

这是最关键的一条。

如果继续保留：

- 新旧模型双写会一直存在
- 缓存表外键会一直绕不过去
- 一切迁移都只能半重构

#### 17.5.2 废弃顶层重复字段

从长期看，`instance_url`、`access_token`、`api_version` 不应继续在 source 主表顶层重复保存为“兼容字段”。

否则主模型永远在为历史包袱服务。

#### 17.5.3 `app_settings` 不再承载 UI state

命令层要切换到新的 `ui_state` 表。

#### 17.5.4 缓存 schema 全量迁移

不要再保留：

- 旧对象列表缓存格式
- 旧 metadata cache 的表结构
- 旧外键引用关系

缓存是最适合接受破坏性迁移的一层，因为它本来就应该允许重建。

### 17.6 SQLite v2 迁移策略

这里推荐一条相对稳妥的迁移路线。

#### Phase 0：引入正式 schema version

当前没有看到明确的 schema version 管理。

SQLite v2 第一步就应该增加：

- `schema_meta`

例如：

```text
schema_meta
  key TEXT PRIMARY KEY
  value TEXT NOT NULL
```

至少存：

- `schema_version`
- `schema_updated_at`

#### Phase 1：建立新表，不删旧表

先创建：

- `sources`
- `source_object_metadata_cache`
- `ui_state`
- `system_logs_v2` 或给 `system_logs` 增列

这个阶段只做建表，不切流量。

#### Phase 2：一次性数据搬迁

把：

- `data_sources`
- `salesforce_sources`
- `object_metadata_cache`
- `source_metadata_cache`
- `app_settings` 中属于 UI 的 key

全部迁入新结构。

关键原则：

- 配置类数据要保留
- 缓存类数据允许失败后清空重建
- 系统日志允许做结构升级但不要求字段完全兼容

#### Phase 3：读流量切到新表

所有命令改读：

- `sources`
- `source_object_metadata_cache`
- `ui_state`

此阶段禁止再读 legacy 表。

#### Phase 4：写流量切到新表

所有写逻辑只写新结构，不再双写旧表。

#### Phase 5：移除 legacy 表与兼容代码

删除：

- `salesforce_sources`
- 与其相关的 backfill / mirror / dual-write 逻辑

这是 v2 是否真的完成的标志。

### 17.7 SQLite v2 的访问层重构建议

不只是表要重做，访问层也要一起拆。

当前 `db.rs` 已经承载太多职责。

建议拆为：

- `db/schema.rs`
- `db/migrations.rs`
- `db/sources.rs`
- `db/cache.rs`
- `db/settings.rs`
- `db/ui_state.rs`
- `db/system_logs.rs`
- `db/terminal_commands.rs`

这样做的好处：

- 领域清晰
- 更容易做单元测试
- 后续替换某一层实现时不至于整文件爆炸

### 17.8 SQLite v2 的连接与运行时建议

#### 17.8.1 启动时统一配置 PRAGMA

建议至少初始化：

- `PRAGMA foreign_keys = ON`
- `PRAGMA journal_mode = WAL`
- `PRAGMA synchronous = NORMAL`
- `PRAGMA busy_timeout = 5000`

这是桌面客户端 SQLite 的基本生产配置。

#### 17.8.2 从单连接全局锁升级到更明确的 DB 访问边界

当前是：

- 一个 `Mutex<Connection>`

这在当前规模还能工作，但未来会带来：

- UI 操作和后台任务互相阻塞
- 长事务放大锁等待
- 调试时很难看出哪个命令持锁太久

SQLite v2 至少应做到：

- 统一 DB 执行入口
- 显式区分读操作和写操作
- 显式事务 helper

是否引入连接池可以后置，但访问边界必须先规范。

### 17.9 安全层面的必须整改

如果这是生产产品，SQLite v2 不能只做 schema 优化，还必须碰安全问题。

#### 17.9.1 不要再明文重复存储 token

当前 source 模型直接带 `access_token`，而且旧新结构双存。

证据：

- 源模型含 token：[src-tauri/src/models.rs:20](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/models.rs#L20)
- 主表持久化 token：[src-tauri/src/db.rs:24](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/db.rs#L24)
- legacy 表也持久化 token：[src-tauri/src/db.rs:34](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/db.rs#L34)

建议优先方案：

- token 存系统密钥链/凭据管理器
- SQLite 只存 `secret_ref`

如果短期做不到，至少也要：

- 停止重复存储
- 预留后续 secret provider 接口

#### 17.9.2 缓存与日志增加清理策略

例如：

- `system_logs` 按条数或按天自动归档/清理
- metadata cache 可按 TTL 失效

否则长期运行桌面客户端，SQLite 文件会持续膨胀。

### 17.10 我建议的实施优先级

如果要落地 SQLite v2，我建议按下面优先级实施。

#### P0：基础重构框架

1. 引入 schema version
2. 启动配置 SQLite PRAGMA
3. 建立事务 helper
4. 拆分 `ui_state` 与 `app_settings`

#### P1：去掉 legacy 数据源双模型

1. 建立统一 `sources`
2. 缓存表外键改引用 `sources`
3. 所有读写命令切新表
4. 移除 `salesforce_sources`

#### P1：重构缓存层

1. 合并对象缓存与元数据缓存模型
2. 增加 TTL / 版本控制
3. 允许缓存迁移失败时自动失效重建

#### P2：系统日志结构化

1. `system_logs` 增加 `detail_json`
2. 增加 `correlation_id`
3. 建立保留与清理策略

#### P2：安全整改

1. 停止重复持久化 token
2. 规划密钥链托管
3. 数据源配置与敏感字段解耦

### 17.11 是否值得接受破坏性改变

我的判断是：**值得，而且应该接受**。

原因不是“当前系统已经不可用”，而是：

1. 现在改，迁移成本还可控
2. 再拖一两个版本，兼容层会继续侵入更多功能
3. SQLite 本地库是所有设置、缓存、日志的底座，底座不稳，后续 MySQL / Salesforce / 终端 / AI 配置都会继续叠债

所以建议策略不是：

- “尽量兼容，不要动老结构”

而应该是：

- “保留用户关键数据，允许缓存失效，接受 schema breaking change，一次做对”

## 18. SQLite v2 最终建议

一句话版：

- **保留 SQLite**
- **重构 schema**
- **移除 legacy 双写**
- **补齐 migration / transaction / pragma / security**

如果按产品成熟度来判断，当前 SQLite 不是“必须推倒重来”的程度，但已经到了“如果不做 v2 重构，后面每个功能都会被底层结构拖慢”的阶段。

因此我的最终建议是：

> 将 SQLite 升级为 SQLite v2 架构，接受破坏性 schema 重构；保留 SQLite 作为本地数据库，不建议替换成其它引擎。

## 19. 产品经理视角：功能与操作体验建议

这一节不再聚焦代码正确性，而是从数据库客户端产品的角度，评估当前功能能力、操作体验和常见工作流覆盖度。

结论先说：

- 当前产品已经有“可用的基础骨架”
- 但离用户心中的“专业数据库客户端”还有明显距离
- 当前更像“带查询与轻编辑能力的数据源工作台”
- 还不是“高频 DBA / 开发者 / 数据分析人员可长期依赖的 MySQL 客户端”

### 19.1 当前已经具备的基础能力

从现有界面可以确认，当前已经具备：

- 左侧对象树 / 表树浏览
- 表格查询结果展示
- 新建记录、删除勾选、执行更新、撤回修改
- Query Bar 条件输入
- MySQL DDL 抽屉与字段抽屉
- 当前 Tab 操作日志
- 独立 SQL/SOQL 控制台
- AI 辅助查询入口

证据：

- 数据页主工具栏目前只有新建、删除勾选、执行更新、撤回修改、查询栏、DDL/字段、日志：[src/features/main/QueryPanel/components/DataQueryTabPane.tsx:911](/mnt/d/test-workspace/simple-salesforce-tool/src/features/main/QueryPanel/components/DataQueryTabPane.tsx#L911)
- 表格右键能力目前主要是复制、Set Null、打开记录页：[src/components/DataGrid/components/DataGridSurface.tsx:287](/mnt/d/test-workspace/simple-salesforce-tool/src/components/DataGrid/components/DataGridSurface.tsx#L287)
- 控制台具备 SQL/SOQL 编辑器与 AI 交互工作区：[src/features/main/QueryPanel/components/SoqlExecutorWorkspace.tsx:1](/mnt/d/test-workspace/simple-salesforce-tool/src/features/main/QueryPanel/components/SoqlExecutorWorkspace.tsx#L1)

这说明方向是对的，但“专业数据库客户端常用操作”还缺很多。

## 19.2 当前产品体验的核心短板

### 19.2.1 操作闭环还偏弱

用户可以：

- 查
- 改
- 看 DDL

但很多高频闭环还没打通，例如：

- 导出结果
- 保存查询
- 查看历史查询
- 批量编辑
- 执行计划 / 诊断
- 行级失败定位
- 快速跳转关联数据

这会导致用户把它当成“偶尔用一下的小工具”，而不是主力客户端。

### 19.2.2 安全感不够

作为数据库客户端，用户最关心的不是“能不能编辑”，而是：

- 我现在操作的是哪个库 / 哪张表 / 哪个环境
- 我这次更新会影响几行
- 执行失败时到底失败在哪
- 成功提示是不是可信

目前这几项还都不够强。

### 19.2.3 对高频用户不够友好

高频数据库客户端用户通常依赖：

- 快捷键
- 查询历史
- 保存脚本
- 常用模板
- 复制导出
- 快速导航

当前这些能力都比较薄。

## 19.3 按用户工作流拆解的产品建议

下面按典型使用路径给出建议。

### 19.3.1 连接与环境识别

当前建议：

1. 强化环境标识
   当前虽然有数据源颜色，但还不够。建议在工作区顶部持续展示：
   - 数据源名称
   - 数据源类型
   - host / database
   - 环境标签，例如 `生产 / 测试 / 本地`

2. 增加危险环境确认策略
   对于标记为生产的数据源：
   - 执行更新前增加二次确认
   - 明显区分按钮颜色与提示文案

3. 增加连接健康状态
   建议在右上或状态栏展示：
   - 已连接
   - 鉴权失效
   - 网络异常
   - 最近一次成功连接时间

### 19.3.2 表浏览与对象树

当前建议：

1. 对象树增加常用操作菜单
   建议支持：
   - 打开前 100 行
   - 复制表名
   - 复制完整限定名
   - 打开 DDL
   - 刷新元数据
   - 生成基础 SQL 模板

2. 增加对象收藏 / 最近访问
   对大库来说，左树搜索远远不够。建议增加：
   - 收藏表
   - 最近访问表
   - 最近编辑表

3. 增加表信息摘要
   在对象树 hover 或侧边详情中展示：
   - 行数估计
   - 主键
   - 索引数量
   - 最近更新时间（如果能取到）

### 19.3.3 查询与 SQL 编辑

这是数据库客户端的核心竞争力之一，建议优先增强。

1. 增加查询历史
   建议按数据源维度保存：
   - 最近执行 SQL
   - 执行时间
   - 成功/失败
   - 影响行数 / 返回行数

2. 增加保存查询 / 收藏 SQL
   支持：
   - 保存为命名查询
   - 收藏常用脚本
   - 按数据源归档

3. 增加 SQL 格式化
   当前工具区有 JSON 相关工具，但没有明显的 SQL 格式化工作流。建议：
   - 一键格式化 SQL
   - 大写关键字 / 换行规范
   - 格式化后可直接执行

4. 增加 SQL 模板
   常见模板建议内置：
   - `SELECT * FROM table LIMIT 100`
   - `SELECT ... WHERE pk = ?`
   - `INSERT INTO ...`
   - `UPDATE ... WHERE pk = ?`
   - `DELETE FROM ... WHERE pk = ?`

5. 增加查询耗时与结果摘要
   每次执行后展示：
   - 耗时
   - 返回行数
   - 是否命中缓存
   - 是否可编辑

6. 增加执行计划 / Explain
   这是 MySQL 客户端非常重要的能力。建议支持：
   - `EXPLAIN`
   - `EXPLAIN ANALYZE`（按版本能力）
   - 可视化展示扫描类型、索引命中、rows、extra

### 19.3.4 结果表格与数据查看

当前 DataGrid 更偏“编辑网格”，但数据库客户端还需要更强的数据分析/浏览体验。

1. 增加结果导出
   这是高频刚需。建议支持：
   - 导出当前结果为 CSV
   - 导出为 JSON
   - 复制为 TSV，方便粘贴到 Excel

2. 增加结果分页 / 分批加载策略
   当前更多是 `LIMIT` 驱动，不是完整的结果集浏览体验。建议增加：
   - 下一页 / 上一页
   - 保持当前排序和筛选
   - 明确当前是“前 N 条”还是“完整结果”

3. 增加列操作
   建议支持：
   - 固定列
   - 自动列宽
   - 按列排序（本地/服务端）
   - 按列过滤
   - 隐藏空列
   - 记住列布局

4. 增加单元格查看模式
   对长文本 / JSON / BLOB 占位，建议支持：
   - 单元格弹窗查看完整值
   - JSON 结构化展开
   - 文本全文复制

5. 增加行详情面板
   选中一行后，在右侧或底部展示：
   - 完整字段值
   - 原值 vs 当前值
   - 主键 / 索引 / 外键信息

### 19.3.5 数据编辑与批量操作

这部分是当前 MySQL 路径最值得加强的区域。

1. 增加“变更预览”
   在点击“执行更新”前展示：
   - 新增多少行
   - 更新多少行
   - 删除多少行
   - 哪些字段将写入 `NULL`
   - 哪些行实际不可提交

2. 增加批量编辑
   数据库客户端常见高频能力包括：
   - 选中多行后批量设置某字段
   - Fill Down
   - Excel 风格批量粘贴
   - 批量置空

3. 增加“复制行 / 克隆行”
   这对新增近似记录非常高频。

4. 增加“仅保存当前行 / 当前单元格”
   当前只有“整批执行更新”，对于小改动不够轻量。

5. 增加受影响行确认
   执行成功后展示：
   - 计划更新行数
   - 实际更新行数
   - 实际删除行数

### 19.3.6 关联关系与导航

专业数据库客户端很重要的一类体验，是能快速沿关系走。

当前建议：

1. 主键 / 外键跳转
   例如：
   - 从订单表 `customer_id` 直接跳到客户表对应记录
   - 从外键列右键“打开关联记录”

2. 反向引用查看
   例如：
   - 查看某条客户记录被哪些订单引用

3. 从 DDL / 字段面板直接生成关联查询

当前已有 DDL/字段抽屉，这是一个很好的入口，但还没有转化成“可操作导航”能力。

### 19.3.7 日志、诊断与可观测性

从产品角度，这一块直接决定用户是否敢在生产环境用。

1. 增加“本次操作详情”入口
   不要让用户执行失败后再去设置页翻系统日志。建议：
   - 在当前 Tab 直接查看本次 SQL 预览
   - 一键跳到对应系统日志

2. 增加失败定位结构化展示
   当前失败提示更像字符串。建议直接展示：
   - 失败阶段
   - 失败记录
   - 失败字段
   - 数据库错误

3. 增加性能诊断
   建议在查询结果 / 系统日志中增加：
   - 请求耗时
   - 返回行数
   - 是否执行成功
   - 是否有告警，例如慢查询

### 19.3.8 SQL 控制台与 AI 助手

当前控制台已经是一个比较有潜力的差异化点。

建议：

1. 把 AI 从“生成 SQL”升级成“数据库协作助手”
   例如支持：
   - 根据自然语言生成 SQL
   - 解释一段 SQL 在做什么
   - 分析报错原因
   - 根据表结构建议索引/查询改写

2. 增加 AI 的上下文控制
   让用户明确知道 AI 读到了哪些上下文：
   - 当前表结构
   - 当前数据源
   - 当前 SQL
   - 最近报错

3. 增加“AI 生成后先预览不执行”
   避免用户误以为 AI 会直接对数据库执行危险操作。

## 19.4 数据库客户端常用操作清单：当前缺失项建议补齐

下面列的是数据库客户端用户普遍会期待的能力，适合作为产品能力清单：

### P0 常用能力，建议尽快补齐

1. 查询历史
2. 保存查询 / 收藏 SQL
3. 导出 CSV / JSON
4. SQL 格式化
5. 执行计划 / Explain
6. 变更预览
7. 实际影响行数反馈
8. 主键 / 外键导航
9. 批量编辑
10. 只读结果集前置识别

### P1 体验增强，建议中期补齐

1. 收藏表 / 最近访问
2. 行详情面板
3. 列过滤 / 固定 / 自动列宽
4. 结果分页导航
5. 慢查询与诊断标记
6. 一键复制为 Excel 友好格式
7. 失败操作一键查看详细日志

### P2 差异化能力，建议后续增强

1. AI SQL 解释与优化建议
2. DDL Diff / Schema Compare
3. 数据对比 / 结果集对比
4. 数据采样 / 字段统计
5. 风险操作保护策略（生产环境）

## 19.5 推荐的产品优先级路线图

如果从产品收益 / 复杂度比来排，我建议这样做：

### 阶段一：先补“可信编辑闭环”

目标：

- 让用户敢改
- 改完知道实际发生了什么

建议内容：

1. 变更预览
2. 实际影响行数反馈
3. 失败定位结构化展示
4. 只读结果集前置识别
5. 系统日志与当前操作联动

### 阶段二：补“高频数据库客户端能力”

目标：

- 让用户愿意长期使用

建议内容：

1. 查询历史
2. 保存查询
3. 导出 CSV / JSON
4. SQL 格式化
5. Execute / Explain 双入口
6. 收藏表 / 最近访问

### 阶段三：补“专业效率工具”

目标：

- 从工具走向主力客户端

建议内容：

1. 批量编辑
2. 外键导航
3. 行详情
4. 结果分页 / 大结果集策略
5. 慢查询诊断

### 阶段四：补“差异化”

目标：

- 建立产品辨识度

建议内容：

1. AI 解释 SQL
2. AI 分析错误
3. AI 辅助生成 Explain 结论
4. Schema Diff / DDL 比较

## 19.6 最终产品判断

作为一个数据库客户端产品，我的判断是：

- 现在的产品方向是成立的
- 但目前核心价值更多停留在“可查、可看、可轻量编辑”
- 离“用户愿意每天打开、替代 Navicat / DBeaver 一部分工作流”的程度，还有一段距离

最应该优先补的不是“更多花哨功能”，而是三件事：

1. **可信**
   让用户确认自己改的就是实际提交的内容

2. **高频**
   让查询历史、导出、格式化、Explain、保存查询这些基础动作顺手可用

3. **高效**
   让导航、批量修改、失败定位、日志联动形成完整闭环

如果把这三层补齐，这个产品才会从“可用工具”真正进化成“专业数据库客户端产品”。

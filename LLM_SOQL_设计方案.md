# LLM 接入与自然语言生成 SOQL 设计方案（第一阶段）

## 1. 目标与范围

本阶段只做设计，不改业务功能代码；用于指导下一步增量实现：

- 在“设置”页新增 `LLM 设置` Tab。
- 第一版协议明确为 **OpenAI**（按 OpenAI Chat Completions 风格接入）。
- 支持配置 `baseUrl`、`apiKey`、`model`。
- 在 `SOQL 执行器` 页面新增“自然语言生成 SOQL”能力。
- 支持复杂 SOQL（含子查询、聚合、分组、排序、函数等）。
- 允许调用 Salesforce **元数据查询接口**（对象/字段 describe），**禁止**调用任何数据读写接口（query/create/update/delete/composite）。
- AI 支持多轮对话；遇到模糊需求时，必须输出引导性问题列表，直至需求边界清晰。

## 2. 现状评估（基于现有代码）

### 2.1 前端

- 设置页当前只有 `CLI设置` 与 `关于`，位于 `src/features/main/SettingsPanel.tsx`。
- SOQL 执行器页面位于 `src/features/main/SoqlExecutorWorkspace.tsx`，已具备：
  - SOQL 编辑器（`SoqlMonacoEditor`）
  - 执行按钮（调用 `api.queryRecords`）
  - 自动按 `FROM` 对象拉取 `describeObject` 做补全

### 2.2 后端

- Tauri 命令位于 `src-tauri/src/commands.rs`。
- Salesforce 客户端位于 `src-tauri/src/salesforce.rs`，同时具备：
  - 元数据接口：`list_objects`、`describe_object`
  - 数据接口：`query_records`、`create_record`、`update_record`、`delete_record`、`save_records`
- 应用配置持久化已存在：`app_settings` 表（`src-tauri/src/db.rs`），当前已用于 CLI 路径配置。

结论：已有“设置持久化 + metadata 拉取 + SOQL 编辑器”基础，可最小改动实现。

## 3. 协议定义（已确认）

本方案协议修正并固定为：

- **OpenAI**（OpenAI Chat Completions 接口形态）

说明：

- 你原先提到“OpenAPI”，在本项目中按“OpenAI 模型调用协议”执行。
- 为兼容私有网关，保留 `baseUrl` 配置能力。

## 4. 架构设计

### 4.1 模块分层

- 前端：
  - `SettingsPanel` 新增 `llm` Tab 与表单。
  - `SoqlExecutorWorkspace` 新增自然语言输入区、多轮消息区与“生成/继续确认”按钮。
- API 层：`src/api/index.ts` 新增 LLM 配置和 SOQL 生成会话调用的 invoke 封装。
- 后端命令层：`commands.rs` 新增 3 组命令：
  - LLM 配置读写
  - 创建/推进 AI 对话会话
  - 基于元数据生成 SOQL
- 后端服务层：新增 `llm.rs`（建议）负责调用 OpenAI 接口与对话状态编排。
- 数据层：复用 `app_settings`，新增 LLM 配置 key；会话状态建议用内存 + 可选持久化。

### 4.2 配置模型（已确认）

`LlmSettings`：

- `provider: "openai"`（第一阶段固定）
- `baseUrl: string`（示例：`https://api.openai.com/v1`）
- `apiKey: string`（敏感信息）
- `model: string`（第一版必须可配置）
- `timeoutMs: number`（默认 30000）

`apiKey` 展示与保存规则（已确认）：

- 设置页默认只显示掩码（如 `sk-****abcd` 或 `已配置`）。
- 用户输入新值后执行“覆盖保存”。
- 后端读取配置时不向前端返回明文 key（除非专门的“编辑模式”设计，第一版不做）。

存储建议：

- `app_settings` 中按 key 存 JSON：
  - `llm.settings.openai`

## 5. “仅元数据接口”安全约束（核心）

### 5.1 允许调用

仅允许以下 Salesforce API：

- `list_objects`
- `describe_object`

### 5.2 严禁调用

在“自然语言生成 SOQL”链路里，禁止触达：

- `query_records`
- `create_record`
- `update_record`
- `delete_record`
- `save_records`
- 以及任何等价数据接口

### 5.3 技术落地

- 生成 SOQL 后端命令内部只读取：
  - 对象列表（可 queryable）
  - 指定对象字段 describe
- 该命令不接受“执行 SOQL”能力，不触发任何 query。
- 在系统日志里新增分类（如 `LLM_SOQL`），记录本次只使用了哪些 metadata 接口。
- 对 LLM 输出做本地校验（见第 6 节），不合法直接拒绝。

## 6. 多轮对话 + 生成 SOQL 方案

### 6.1 输入

- `sourceId`
- `conversationId`（新建会话时为空）
- `userMessage`（本轮自然语言输入）
- 可选：`contextObjectHint`（用户当前关注对象）

### 6.2 后端处理流程

1. 读取 LLM 配置（baseUrl/apiKey/model）。
2. 拉取对象列表（仅 queryable=true）。
3. 基于上下文筛选候选对象，并按需 describe 字段元数据。
4. 组装受控 Prompt，要求模型返回结构化 JSON：
   - `status`（`clarify` | `ready`）
   - `questions`（当 `clarify` 时必须给出引导问题列表）
   - `soql`（当 `ready` 时返回）
   - `object`
   - `fields`
   - `reason`
5. 当 `status=clarify`：
   - 前端展示问题列表，等待用户补充信息，继续同一 `conversationId`。
6. 当 `status=ready`：
   - 对返回 `soql` 做本地硬校验。
7. 校验通过后返回前端，只“回填编辑器”，不自动执行。

### 6.3 模糊澄清强制规则（已确认）

- AI 发现需求模糊时，必须输出“引导性问题列表”。
- 在问题未被充分回答前，不得输出最终 SOQL。
- 引导问题需具体可执行，避免泛问。
- 直到需求边界清晰才进入 `ready` 并产出 SOQL。

### 6.4 SOQL 复杂能力范围（已确认）

第一版允许生成以下复杂查询：

- 子查询（`SELECT ... (SELECT ... FROM ChildRelation) FROM Parent`）
- 聚合函数（`COUNT/SUM/AVG/MIN/MAX`）
- `GROUP BY` / `HAVING`
- `ORDER BY` / `LIMIT` / `OFFSET`
- 关系字段路径（如 `Owner.Name`）

## 7. 校验与约束（复杂 SOQL 适配）

本地校验规则：

- 必须为 `SELECT` 语句。
- 禁止 `INSERT/UPDATE/DELETE/UPSERT/MERGE`。
- 对象与字段必须来自已拉取元数据（关系字段按路径拆分校验）。
- 子查询对象关系名需在元数据允许范围内。
- 校验失败时返回“可修复提示”，并要求 AI 继续澄清/修正。

## 8. 前端交互设计

在 `SoqlExecutorWorkspace` 新增 AI 面板：

- 对话消息列表（用户/AI）
- 输入框 + 发送按钮
- AI 返回 `clarify` 时展示问题列表
- AI 返回 `ready` 时展示“应用到编辑器”按钮（点击后写入 `soqlDraft`）
- 明确标识：AI 仅生成，不自动执行

在 `SettingsPanel` 的 `LLM 设置` Tab：

- `baseUrl` 输入框
- `model` 输入框
- `apiKey` 掩码显示 + 覆盖保存输入框
- 连通性测试按钮（可选）

## 9. 数据与安全

- `apiKey` 不写入前端日志。
- 返回设置给前端时，`apiKey` 仅返回掩码信息或“已配置状态”。
- 生成 SOQL 的后端命令要加超时、重试（最多 1 次）与错误分类。
- 所有 LLM 调用写系统日志，但不落明文 key。
- 会话日志需区分：用户输入、AI 澄清问题、最终 SOQL。

## 10. 增量实施计划

### 第 1 步（设置页）

- 扩展 `SettingsPanel` Tab：`cli | llm | about`
- 新增 LLM 表单：`baseUrl`、`model`、`apiKey（掩码+覆盖保存）`
- 新增后端命令：`get_llm_settings`、`save_llm_settings`

### 第 2 步（后端 LLM 服务）

- 新增 `llm.rs`
- 新增命令：`start_or_continue_soql_conversation`、`generate_soql_from_conversation`
- 严格只走 metadata 获取链路

### 第 3 步（SOQL 执行器接入）

- `SoqlExecutorWorkspace` 新增多轮对话 UI
- 支持澄清回合与最终回填
- 支持复杂 SOQL 回填（含子查询）

### 第 4 步（验收与回归）

- 验证 metadata-only 约束
- 验证多轮澄清流程（模糊输入必须产出问题列表）
- 验证复杂 SOQL 生成与校验
- 验证无配置、配置错误、对象歧义等异常路径

## 11. 验收标准（更新）

- 设置页可保存并读取 OpenAI 配置。
- `model` 可配置并参与实际请求。
- `apiKey` 默认掩码显示，支持覆盖保存。
- 已配置时可通过多轮对话生成 SOQL 并回填编辑器。
- 模糊需求场景下，AI 必须先输出引导问题列表，不能直接给最终 SOQL。
- 支持生成复杂 SOQL（含子查询）。
- 生成链路中未调用任何数据接口（通过日志可审计）。
- 生成语句通过本地校验，不含 DML/非法对象字段。

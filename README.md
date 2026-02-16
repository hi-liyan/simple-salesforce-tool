# Simple Salesforce Tool

基于 `Tauri 2 + React + Rust + SQLite` 的 Salesforce 桌面工具，面向多数据源日常运维与开发场景，提供对象浏览、SOQL 查询、记录维护、CLI 同步登录与 AI 辅助能力。

## 项目介绍

- 目标场景：在桌面端统一管理多个 Salesforce Org，减少频繁切换浏览器与命令行的成本。
- 核心价值：把数据源管理、对象元数据、SOQL 查询、记录 CRUD、系统日志、AI 问答整合到一个工作台。
- 当前形态：本地桌面应用（Tauri），数据存储在本地 SQLite。

## 功能概览

- 多数据源管理：新增、编辑、删除、切换 Salesforce Source。
- 对象浏览：支持对象列表读取、搜索、强制刷新。
- SOQL 工作台：Monaco 编辑器、多标签执行、结果表格展示。
- 数据操作：查询、创建、批量保存、更新、删除记录。
- 元数据能力：对象 describe、字段关系解析、字段可见性设置。
- CLI 集成：支持 CLI 路径探测、状态检测、登录同步。
- AI 辅助：基于工具调用做对象/字段检索与 SOQL 生成引导。
- 日志审计：系统日志分页查询。

## 技术落地方案

### 1) 总体架构

- 前端：React + TypeScript + Zustand + React Query + Monaco + Glide Data Grid。
- 桌面容器：Tauri 2（前后端通过 `invoke` 命令通信）。
- 后端：Rust + Reqwest + Rusqlite。
- 存储：本地 SQLite（数据源、对象缓存、设置、日志等）。

### 2) 前端分层

- 命令调用层：`src/api/index.ts`
  - 统一封装 `invokeApi`，把 Tauri 命令转成类型安全的 TS API。
- 状态管理层：`src/store/useAppStore.ts`
  - 统一管理当前数据源、对象 Tab、激活态与加载态。
- 页面与工作区：
  - `src/pages/MainPage.tsx`：主页面。
  - `src/features/main/SoqlExecutorWorkspace.tsx`：SOQL/AI 执行工作区。
  - `src/components/*`：对象列表、记录编辑、表格、编辑器等组件。

### 3) Rust 后端能力

- 命令入口：`src-tauri/src/main.rs`
  - 通过 `tauri::generate_handler![]` 注册全部命令。
- 业务命令：`src-tauri/src/commands.rs`
  - 覆盖 source 管理、对象读取、describe、SOQL 查询、CRUD、CLI、日志、AI。
- Salesforce 客户端：`src-tauri/src/salesforce.rs`
  - 封装 REST 调用：`list_objects`、`describe_object`、`query_records`、`create/update/delete/save_records`。
- 数据持久化：`src-tauri/src/db.rs`
  - 表结构初始化、source 持久化、对象缓存、设置与日志。
  - 对象缓存 TTL：`OBJECT_CACHE_TTL_SECONDS = 3600`（1 小时）。

### 4) AI 落地

- LLM 协议模型：`src-tauri/src/llm.rs`
- AI 编排：`src-tauri/src/ai/orchestrator.rs`
  - 使用 `rig-core` + OpenAI Provider。
  - 通过工具调用检索对象与字段信息，输出结构化结果并支持流式反馈。

## 项目结构

```text
.
├─ src/                            # React 前端
│  ├─ api/                         # Tauri invoke API 封装
│  ├─ components/                  # 通用组件
│  ├─ features/main/               # 主工作台特性模块
│  ├─ pages/                       # 页面级组件
│  ├─ store/                       # Zustand 状态管理
│  ├─ types/                       # 前端类型
│  └─ utils/                       # 工具函数
└─ src-tauri/                      # Rust 后端
   ├─ src/
   │  ├─ main.rs                   # Tauri 启动与命令注册
   │  ├─ commands.rs               # 命令实现
   │  ├─ salesforce.rs             # Salesforce API 客户端
   │  ├─ db.rs                     # SQLite 持久化
   │  ├─ ai/                       # AI 编排与工具
   │  ├─ llm.rs                    # LLM 消息模型
   │  └─ models.rs                 # 数据模型
   └─ tauri.conf.json              # Tauri 配置
```

## 环境要求

- Node.js 18+
- Rust stable（建议通过 rustup 安装）
- 系统依赖满足 Tauri 2 要求
- 已安装 Salesforce CLI（`sf` 或 `sfdx`，可选但推荐）

## 开发与使用方式

### 1) 安装依赖

```bash
npm install
```

### 2) 启动开发模式

```bash
npm run tauri dev
```

### 3) 构建前端

```bash
npm run build
```

### 4) 打包桌面应用

```bash
npm run tauri build
```

## Salesforce CLI 说明

应用默认通过 Salesforce CLI 同步认证信息。

- 优先读取环境变量 `SF_CLI_PATH`（可配置 `sf.cmd`/`sfdx.cmd` 绝对路径）
- 未配置时按顺序尝试：`sf`、`sf.cmd`、`sfdx`、`sfdx.cmd`
- Windows 下额外尝试：`%APPDATA%\\npm\\sf.cmd`、`%APPDATA%\\npm\\sfdx.cmd`

示例（Windows PowerShell）：

```powershell
$env:SF_CLI_PATH = "C:\\Users\\<用户名>\\AppData\\Roaming\\npm\\sf.cmd"
npm run tauri dev
```

## 安全说明

当前版本将 `accessToken` 保存在本地 SQLite 中，适用于内网桌面工具场景。若需要更高安全等级，建议改为系统密钥链（Windows Credential Manager / macOS Keychain）并对数据库仅保留引用。

## 二次开发说明

欢迎二次开发，包括但不限于：

- 新增 Tauri 命令与后端能力（`src-tauri/src/commands.rs`）
- 扩展 Salesforce API 能力（`src-tauri/src/salesforce.rs`）
- 扩展 AI 工具链（`src-tauri/src/ai/tools.rs`）
- 扩展前端页面/组件与工作台交互（`src/features/main/`、`src/components/`）

## 开源协议与署名要求

- 当前仓库代码声明：`MIT`（见 `src-tauri/Cargo.toml` 中 `license = "MIT"`）。
- 二次开发、再发布、商用时，必须保留原作者署名与项目来源链接。
- 建议在以下位置保留署名：
  - README 的致谢/来源章节
  - 应用“关于”页面
  - 发行说明（Release Notes）

推荐署名格式：

```text
Based on simple-salesforce-tool by liyan
Original repository: https://github.com/hi-liyan/simple-salesforce-tool
```

> 建议后续在仓库根目录补充标准 `LICENSE` 文件，便于自动化合规扫描。

## PR 规范

### 提交前自检

- 确保本地可以正常启动：`npm run tauri dev`
- 确保前端构建通过：`npm run build`
- 变更涉及后端命令时，需说明影响的命令名与调用链
- 文档同步更新（README/设计文档/注释）

### 分支命名

- `feature/<功能名>`
- `fix/<问题名>`
- `refactor/<重构名>`
- `docs/<文档名>`

### Commit 建议（Conventional Commits）

- `feat:` 新功能
- `fix:` 缺陷修复
- `refactor:` 重构
- `docs:` 文档
- `chore:` 工程维护

示例：

```text
feat(ai): 支持对象关系图工具查询
fix(query): 修复 SOQL 执行时空 sourceId 校验
docs(readme): 补充二次开发与贡献规范
```

### PR 描述模板（建议）

- 变更背景
- 变更内容
- 影响范围（前端/后端/数据库/命令）
- 验证方式（命令、截图、录屏）
- 回滚方案（如适用）

## Issue 规范

### Bug Issue

请至少包含：

- 问题现象
- 复现步骤
- 期望结果
- 实际结果
- 日志/报错截图（建议附 `list_system_logs` 相关信息）
- 环境信息（OS、Node、Rust、Tauri、是否配置 CLI）

### Feature Issue

请至少包含：

- 业务场景
- 目标能力
- 建议方案（可选）
- 可接受的替代方案
- 验收标准

### 标题建议

- `bug: [模块] 简要描述`
- `feature: [模块] 简要描述`
- `docs: [模块] 简要描述`

## 致谢

感谢所有贡献者对该项目的持续改进。

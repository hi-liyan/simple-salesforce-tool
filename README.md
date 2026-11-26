<div align="center">

<img src="app-icon.png" alt="Simple Salesforce Tool" width="88" height="88" />

# Simple Salesforce Tool

**面向多数据源的现代桌面端数据工作台**

基于 `Tauri 2 + React + Rust + SQLite` 构建，将 Salesforce（SOQL / 元数据 / CLI 认证）与 MySQL 数据源统一整合于轻量、安全、可扩展的本地桌面工作台中。

[![Version](https://img.shields.io/badge/version-0.3.0-blue.svg)](https://github.com/hi-liyan/simple-salesforce-tool/releases)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-24C8D8.svg?logo=tauri&logoColor=white)](https://tauri.app/)
[![React](https://img.shields.io/badge/React-18-61DAFB.svg?logo=react&logoColor=black)](https://react.dev/)
[![Rust](https://img.shields.io/badge/Rust-2021-000000.svg?logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

</div>

---

## 为什么选择 Simple Salesforce Tool？

日常在多个 Salesforce Org 与关系型数据库之间切换时，开发者与运维人员常常需要在浏览器控制台、CLI 命令行、独立数据库客户端和各种在线小工具之间来回跳转。

**Simple Salesforce Tool** 旨在提供一个**本地优先（Local-First）、架构解耦、安全可控**的一体化桌面工作台：

- **开箱即用**：应用壳首帧秒开，非激活标签页与重型结果集按需懒加载，告别笨重客户端的启动卡顿。
- **多数据源统一抽象**：通过驱动注册表（`DataSourceDriver`）与能力矩阵（`ProviderCapabilities`）屏蔽底层差异，原生支持 **Salesforce** 与 **MySQL**，并可持续扩展更多数据源。
- **所见即所执的数据安全**：所有表格编辑采用**两阶段提交（变更计划预览 -> 哈希校验提交）**，控制台查询经过 Rust **AST 安全网关（`SqlGuard`）** 拦截高危操作，并强制写入审计日志。
- **可扩展的插件与终端生态**：内置 PTY 终端与独立 `.sstplugin` 插件包机制，常用开发辅助工具一站配齐。

---

## 核心功能

### 1. 多数据源与凭证安全
- **Salesforce 集成**：支持通过本地 Salesforce CLI（`sf` / `sfdx`）一键同步认证，也支持独立认证窗口与 Token 管理。
- **MySQL 集成**：基于 `sqlx` 连接池直连 MySQL，支持连接测试、Schema 浏览与表 DDL 查看。
- **敏感凭证加密**：Access Token、数据库密码等敏感信息通过 `AES-GCM` 加密存储于本地，避免明文落盘。

### 2. 对象元数据与高性能查询工作台
- **元数据浏览与缓存**：本地 SQLite 缓存对象/表列表，支持快速检索、强制刷新、字段关系解析（`FieldMetaPage`）及字段可见性配置。
- **专业查询编辑器**：集成 CodeMirror 6 / Monaco Editor、SOQL/SQL 语法解析与后端 SQL LSP 补全。
- **Glide Data Grid 高性能表格**：支持大规模结果集流畅滚动、列排序筛选、行内编辑、批量增删改与多 Tab 增量持久化。
- **AST 安全网关与审计**：
  - 只读数据源硬拦截写操作；
  - `DROP` / `TRUNCATE` / `ALTER` / 无 `WHERE` 条件删改等高危 SQL 自动触发二次确认；
  - 每次查询返回实际下发的 `executedSql`，并记录完整执行审计日志。

### 3. AI 辅助查询（Schema-Aware）
- 基于 `rig-core`（支持 OpenAI 兼容协议）构建 AI 编排器。
- 支持通过 Tool Calling 自动检索当前数据源的对象与字段元数据，结合上下文辅助生成准确的 SOQL / SQL 语句，支持流式输出反馈。

### 4. 内置终端与 `.sstplugin` 插件体系
- **集成终端**：基于 `portable-pty` + `xterm.js` 的跨平台内置终端，直接在工作台内运行 CLI 命令。
- **独立插件工作区（`plugins/`）**：支持安装与开发独立 `.sstplugin` 扩展包，目前已内置/提供：
  - `json-formatter`（JSON 格式化）
  - `json-diff` / `text-diff`（结构化与文本对比）
  - `qr-code`（二维码生成）
  - `unicode-converter`（Unicode 编解码）
  - `command-library`（常用命令库）
- **局域网文件接收**：内置基于 `axum` 的轻量级局域网文件快传能力。

---

## 技术栈

| 层次 | 核心技术选型 | 说明 |
| :--- | :--- | :--- |
| **桌面容器** | Tauri 2 (`tauri 2.2.5`) | 无边框 Islands 风格窗口、原生菜单与自动更新（`tauri-plugin-updater`） |
| **前端框架** | React 18 + TypeScript 5 + Vite 5 | 严格分层：`layouts/`、`drivers/`、`plugins/`、`features/`、`components/` |
| **状态与数据** | Zustand + TanStack React Query | 分级持久化状态管理，区分外壳偏好、Tab 草稿与懒加载结果集 |
| **UI 与编辑器** | Tailwind CSS + DaisyUI + Glide Data Grid + CodeMirror 6 / Monaco + xterm.js | 高帧率表格渲染、代码补全与嵌入式终端 |
| **Rust 后端** | Rust 2021 + Tokio + Reqwest + `sqlx` + `portable-pty` + `axum` | 异步并发、连接池托管、REST/MySQL 驱动与本地服务 |
| **本地存储** | SQLite (`rusqlite` bundled) | WAL 模式、读写分离、版本化增量迁移引擎（`PRAGMA user_version`） |
| **AI 与解析** | `rig-core` + `sqlparser` + `soql-parser-js` | Agent 工具编排与前后端 SQL/SOQL AST 安全校验 |

---

## 正确打开方式

### 方式一：普通用户（直接安装使用）

1. **下载安装**  
   前往 [GitHub Releases](https://github.com/hi-liyan/simple-salesforce-tool/releases) 下载对应平台的安装包（Windows 提供 `.msi` / `.nsis` 安装包，内置在线更新支持）。

2. **配置 Salesforce CLI（可选，推荐）**  
   如果你习惯通过 Salesforce CLI 管理 Org 登录态，请确保本机已安装 `sf` 或 `sfdx`：
   - 默认按顺序自动探测：`sf`、`sf.cmd`、`sfdx`、`sfdx.cmd`（Windows 下额外检查 `%APPDATA%\npm\`）。
   - 如需指定自定义路径，可设置环境变量 `SF_CLI_PATH`：
     ```powershell
     $env:SF_CLI_PATH = "C:\Users\<用户名>\AppData\Roaming\npm\sf.cmd"
     ```

3. **开始工作流**
   - 在 **数据源管理** 中同步 CLI Org 或新增 Salesforce / MySQL 连接；
   - 在 **对象浏览器** 中检索对象与字段结构；
   - 在 **查询工作台** 编写 SOQL/SQL 或唤起 **AI 助手** 生成查询；
   - 修改表格数据时，先核对 **变更计划预览（Mutation Preview）** 再提交，确保数据安全；
   - 点击右上角 **插件中心**，安装或启用 `plugins/out/*.sstplugin` 工具插件提升日常效率。

---

### 方式二：开发者（本地运行与二次开发）

#### 环境要求
- **Node.js**：18+（推荐使用 `pnpm`，也可使用 `npm`）
- **Rust**：`stable` 工具链（建议通过 `rustup` 安装）
- **系统依赖**：满足 [Tauri 2 官方前置条件](https://v2.tauri.app/start/prerequisites/)（Windows 需 WebView2 与 MSVC 构建工具）
- **Salesforce CLI**：`sf` 或 `sfdx`（可选）

#### 常用开发命令

```bash
# 1. 安装依赖（推荐 pnpm）
pnpm install

# 2. 启动 Tauri 桌面开发模式（热重载前端 + 编译启动 Rust 后端）
pnpm tauri dev

# 3. 仅构建前端类型检查与静态资源
pnpm build

# 4. 打包生产环境桌面安装包
pnpm tauri build

# 5. 运行前端单元测试
pnpm test:datagrid-utils
pnpm test:query-panel
pnpm test:tools-panel

# 6. 打包全部独立插件为 .sstplugin（产物输出至 plugins/out/）
node plugins/pack-all.mjs
```

> Rust 后端独立检查可在 `src-tauri/` 目录下执行 `cargo check` 或 `cargo test`。

---

## 项目架构概览

```text
simple-salesforce-tool/
├─ src/                         # React + TypeScript 前端
│  ├─ api/                      # 类型安全的 Tauri invoke 封装
│  ├─ components/               # 纯 UI 组件（无数据源耦合）
│  ├─ drivers/                  # 前端数据源驱动适配（salesforce / mysql / registry）
│  ├─ features/                 # 业务工作区（main/QueryPanel, source-manager, terminal, settings, logs）
│  ├─ layouts/                  # 统一窗口与布局壳（AppShellLayout, SubWindowLayout, SplitPaneLayout）
│  ├─ pages/                    # 路由/独立窗口页面（MainPage, AuthPage, FieldMetaPage）
│  ├─ plugins/                  # 插件运行时核心与内置插件
│  └─ store/                    # Zustand 状态管理
├─ src-tauri/                   # Rust 后端
│  └─ src/
│     ├─ ai/                    # rig-core AI 编排与元数据工具
│     ├─ commands/              # Tauri IPC 命令入口（薄适配层）
│     ├─ drivers/               # DataSourceDriver Trait、DriverRegistry 与 ConnectionManager
│     ├─ modules/               # sql_lsp 等独立能力模块
│     ├─ services/              # 核心业务服务（query, mutation_plan, sql_guard, audit, secret, plugin）
│     └─ storage/               # SQLite 仓储层、WAL 事务封装与版本化迁移引擎
├─ plugins/                     # 独立 .sstplugin 插件源码与打包脚本
├─ tests/                       # 前端单元测试
└─ doc/                         # 架构设计与演进文档
```

---

## 参与贡献

欢迎通过 Issue 与 Pull Request 参与项目共建！

### 开发与架构约定
1. **保持分层边界**：
   - 后端遵循 `commands -> services -> drivers / storage` 分层，新增数据源请实现 `DataSourceDriver` Trait 并注册至 `DriverRegistry`，避免硬编码数据源分支。
   - 前端通用组件禁止反向耦合特定数据源逻辑，数据源差异统一收口至 `src/drivers/<kind>/`。
   - 新增工具优先以 `.sstplugin` 插件形式开发，通过 `PluginContext` 与主应用交互。
2. **提交前自检**：
   - 确保 `pnpm build` 与 `cargo check` 通过；
   - 涉及前端工作台或工具改动时，运行相关 `pnpm test:*` 用例；
   - 确认 `pnpm tauri dev` 可正常启动。
3. **Commit 规范**：采用 Conventional Commits，例如：
   - `feat(driver): 支持 xxx 数据源元数据读取`
   - `fix(query): 修复两阶段提交哈希校验异常`
   - `docs(readme): 更新开发与使用指南`

---

## 开源协议与署名

本项目基于 **[MIT License](./LICENSE)** 开源。

欢迎自由使用、修改与二次分发。在二次开发或再发布时，请保留原作者署名与项目来源：

```text
Based on simple-salesforce-tool by liyan
Original repository: https://github.com/hi-liyan/simple-salesforce-tool
```

<div align="center">
  <sub>如果这个工具帮你省下了切换窗口的时间，欢迎点亮一颗 ⭐ Star！</sub>
</div>

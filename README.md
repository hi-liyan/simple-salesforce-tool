# Simple-Salesforce-Tool

基于 Tauri 2 + React + Rust + SQLite 的 Salesforce 桌面工具，支持多数据源管理、Object 元数据浏览、SOQL 查询与记录 CRUD。

## 功能特性

- 连接多个 Salesforce 数据源（`instanceUrl` + `accessToken` + `apiVersion`）
- 三栏工作台布局
1. 左栏：数据源管理（新增、编辑、删除、切换）
2. 中栏：Object 列表（支持搜索与刷新）
3. 右栏：SOQL 查询、结果表格、记录创建/更新/删除
- Object 元数据缓存（本地 SQLite，默认 1 小时 TTL）
- 统一错误处理与前后端类型约束

## 技术栈

- 桌面框架：Tauri 2
- 前端：React + TypeScript + Tailwind CSS + Vite
- 后端：Rust + reqwest + rusqlite
- 本地存储：SQLite

## 项目结构

```text
.
├─ src/                    # React 前端
│  ├─ api/                 # Tauri invoke API 封装
│  ├─ components/          # UI 组件
│  ├─ styles/              # 全局样式
│  └─ types/               # 前端类型定义
└─ src-tauri/              # Rust 后端
   ├─ src/
   │  ├─ app_state.rs      # 全局状态
   │  ├─ commands.rs       # Tauri 命令
   │  ├─ db.rs             # SQLite 持久化
   │  ├─ error.rs          # 错误模型
   │  ├─ models.rs         # 数据模型
   │  └─ salesforce.rs     # Salesforce HTTP 客户端
   └─ tauri.conf.json
```

## 开发运行

```bash
npm install
npm run tauri dev
```

## 生产构建

```bash
npm run tauri build
```

## 安全说明

当前版本将 `accessToken` 保存在本地 SQLite 中，适用于内网桌面工具场景。若需要更高安全等级，建议改为系统密钥链（Windows Credential Manager / macOS Keychain）并对数据库仅保留引用。

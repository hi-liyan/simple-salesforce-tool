# 前端 UI 重塑、状态与插件化架构及后端 SQLite 优化报告

> **分析范围**：前端入口与启动流（`src/main.tsx`、`src/App.tsx`、`src/pages/`、`src/layouts/`、`src/store/`、`src/features/`）、Tauri 窗口配置（`src-tauri/tauri.conf.json`、`src-tauri/capabilities/main-window.json`）及后端存储层（`src-tauri/src/storage/`、`src-tauri/src/services/workspace_service.rs`、`src-tauri/src/main.rs`）。  
> **重构目标**：
> 1. 全面转向**现代数据库 IDE 大圆角浮岛（Islands）视觉风格**，移除原生窗口标题栏，改为**自绘一体式标题栏**；
> 2. 将原侧边栏中的**命令库（Terminal/Command Library）**与**工具面板（ToolsPanel）**中的工具全部重构为**标准化插件**，建立规范的插件 API 与独立插件开发目录；
> 3. 解决**启动强阻塞 UI、前端状态混乱、Layout 缺失、后端 SQLite 设计与迁移不规范**问题。

---

## 一、执行摘要（Executive Summary）

经过全量代码审查与新 UI 规划对齐，当前系统存在以下核心问题与演进方向：

1. **UI 风格与窗口形态陈旧**：`tauri.conf.json` 仍使用原生 OS 标题栏（未配置 `decorations: false`），页面采用传统直角/小圆角紧贴边框拼接，缺少现代数据库 IDE 的空间呼吸感与多面板协同体验；`AuthPage`、`FieldMetaPage` 无统一窗口布局。
2. **工具与命令库耦合在主导航中**：原 `MainPage` 左侧导航条硬编码切换 `Query` / `Terminal` / `Tools` / `Settings` 四个互斥全屏视图，且 `ToolsPanel` 内 6 个工具与 `TerminalPanel` 中的命令库直接耦合在 `useAppStore` 与 `workspaceSnapshot.ts` 中，无法独立开发、按需加载或作为停靠/标签页自由组合。
3. **启动流程强阻塞 UI**：`MainPage.tsx` 挂载全屏模态遮罩（`z-[120]`），串联等待全量快照反序列化、快照压缩写回、终端存储清理与本地数据源拉取全部完成后才解除遮罩；`main.rs` `.setup()` 同步阻塞建库。
4. **前端状态碎片化与写入放大**：9+ 个 Store 捆绑进 781 行的 `workspaceSnapshot.ts`，任意微小的 UI 变化都会触发整包 JSON 克隆与 SQLite 全量覆盖；`MainPage` 越权持有 `useMainPageQueryPanel`。
5. **后端 SQLite 设计与迁移不规范**：`bootstrap.rs` 用“版本不一致即整库归档重建”代替增量迁移；`Storage` 用单把 `Mutex<Connection>` 锁死全部读写废除 WAL 并发；部分表缺外键级联与索引；密钥仍以 `'plain-text/v1'` 明文存储。

---

## 二、全新 UI 视觉风格与工作区布局设计（参考图风格）

结合参考图一（JetBrains Islands 呼吸感）与参考图二（现代数据库 IDE 布局），制定全新的 **Islands（大圆角浮岛卡片）** 视觉规范与窗口布局。

### 2.1 视觉设计语言（Design Tokens）

| 设计要素 | 规范定义 | 说明 |
| :--- | :--- | :--- |
| **外层画布底色** | `#F2F4F7`（Light） / `#181A1F`（Dark） | 浅灰底壳作为浮岛之间的“间隙背景”，突出白色内容卡片层次感。 |
| **浮岛卡片容器** | `#FFFFFF`（Light） / `#21242B`（Dark） | 取代厚重分割线，采用 `1px solid #E5E7EB` 极细边框 + 极轻投影。 |
| **大圆角体系** | 主工作区浮岛：`12px`（`rounded-xl`）<br>标签/内嵌卡片：`8px`（`rounded-lg`）<br>按钮/输入框/徽章：`6px`（`rounded-md`） | 全局统一大圆角，消除生硬直角感。 |
| **浮岛间距（Gap）** | `6px` – `8px`（`gap-1.5` / `gap-2`） | 标题栏、左侧连接树、中央工作区、右侧停靠面板之间保留统一呼吸间隙。 |
| **边框与分割线** | 极细弱边框（`border-base-300/70`） | 内部工具栏与结果区之间使用极浅分隔线，避免视觉噪点。 |

### 2.2 整体工作区布局结构（三栏浮岛 + 自绘标题栏）

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ [● ● ●]  + 新建连接   >_ 新建查询   ⇄ 数据传输   ⊞ 驱动管理   ⋯ 更多    [插件] [AI] [日志] [⚙] [─ □ ×] │  <- 42px 自绘标题栏 (可拖拽)
├─────────────────┬──────────────────────────────────────────┬─────────────────┤
│ 连接 / 数据源   │ [PG] order_log@db  [SF] Account  [SQL] × │ AI 助手 / 插件  │
│ [搜索框...] [⟳] ├──────────────────────────────────────────┤ [会话][历史][×] │
│ ▸ SF-Prod       │ ▶ 运行  ⚡ 计划  💾 保存  ✨ 格式化   [源▾]│ ┌─────────────┐ │
│ ▾ MySQL-Dev     │──────────────────────────────────────────│ │ 思考过程... │ │
│   ▾ app_db      │  1 | SELECT * FROM users                 │ │ 调用工具... │ │
│     ▾ tables    │  2 | WHERE status = 'active'             │ │ [SQL 预览]  │ │
│       • users   │  3 | LIMIT 100;                          │ └─────────────┘ │
│       • orders  ├──────────────────────────────────────────┤                 │
│     ▸ views     │ 数据表 | 执行摘要 | 日志      [导出] [收起]│ ┌─────────────┐ │
│     ▸ users     │ ┌────┬──────────┬────────┐               │ │ @表 输入指令│ │
│                 │ │ id │ name     │ status │               │ │ [Ask▾] [↑]  │ │
│                 │ └────┴──────────┴────────┘               │ └─────────────┘ │
│  (12px 圆角卡片) │              (12px 圆角卡片)              │  (12px 圆角卡片) │
├─────────────────┴──────────────────────────────────────────┴─────────────────┤
│ ● MySQL-Dev · app_db   |   UTF-8   |   24ms · 100 rows        [终端] [插件]  │  <- 26px 底部状态栏 (可选)
└──────────────────────────────────────────────────────────────────────────────┘
```

#### 核心区域职责重构：
1. **无原生边框 + 自绘标题栏（`CustomTitleBar`，高 `42px`）**：
   - **Tauri 2 配置改造**：在 `src-tauri/tauri.conf.json` 中为所有窗口配置 `"decorations": false`；在 `src-tauri/capabilities/main-window.json` 中授予 `core:window:allow-start-dragging`、`core:window:allow-minimize`、`core:window:allow-toggle-maximize`、`core:window:allow-close`、`core:window:allow-is-maximized` 权限。
   - **拖拽与跨平台控制**：标题栏空白处绑定 `data-tauri-drag-region`，双击支持最大化/还原；Windows 右侧渲染自绘最小化/最大化/关闭按钮，macOS 左侧预留红黄绿交通灯位置。
   - **全局动作区（左侧）**：直接透出高频入口——`新建连接`、`新建查询`、`数据传输`（预留）、`驱动管理`（展示与配置数据源 Driver）、`更多`。
   - **全局工具与插件区（右侧）**：`插件中心`（打开插件启动器/面板）、`AI 助手`（一键展开/收起右侧 AI 停靠浮岛）、`系统日志`、`设置`（弹窗或工作区 Tab 打开）。
2. **左侧连接与对象树浮岛（`12px` 圆角）**：
   - 顶部紧凑工具栏：数据源搜索框 + 快捷刷新/折叠/新建连接按钮。
   - 统一的多数据源树：通过前端 `DataSourceDriver` 渲染各自图标、徽章、分组节点（如 MySQL 的 `tables / views / users`，Salesforce 的 `SObjects`）。
3. **中央主工作区浮岛（`12px` 圆角，兼容多类型 Tab）**：
   - 顶部标签栏同时承载：**数据表浏览 Tab**、**SQL/SOQL 控制台 Tab**、以及**工作区型插件 Tab**（如 JSON Diff、Text Diff、JSON 格式化、终端 Tab、设置页 Tab）。
   - 内部上下结构：上区为 Monaco 编辑器或工具视图，下区为可折叠的结果抽屉（`数据表` / `执行摘要` / `字段与 DDL` / `变更预览`）。
4. **右侧可停靠辅助浮岛（`12px` 圆角，可折叠）**：
   - 默认用于承载 **AI 对话助手**，同时可作为 **Dock 型插件**（如“命令库”、"局域网文件接收"、“字段元数据”）的停靠容器，用户可通过顶部/侧边极简图标切换或关闭，关闭后不占空间。
5. **极简侧边/底部停靠条（Tool Rail）**：
   - 保留极窄图标条或底部快捷入口，用于一键唤起已安装的插件（如终端、命令库、工具插件）或切换停靠面板显隐，不再用全屏互斥页面割裂用户工作流。

---

## 三、标准化插件系统与插件开发目录设计

将原侧边导航条中的**“命令库”**（含终端快捷命令组管理）以及原 `ToolsPanel` 中的 **6 个独立工具**（`JSON 格式化`、`Text Diff`、`JSON Diff`、`二维码生成`、`Unicode 编码转换`、`局域网文件接收`）全部改造为标准插件。

### 3.1 专属插件开发目录（`src/plugins/`）

在项目中专门建立 `src/plugins/` 目录，实现**“插件内核与插件业务彻底隔离，新增插件零侵入主工程”**：

```text
src/plugins/
├── core/                           # 插件系统内核（外部插件无需关心其内部实现）
│   ├── types.ts                    # PluginManifest、PluginContext、Contribution 等标准契约
│   ├── registry.ts                 # 插件注册表（registerPlugin / getPlugin / listPlugins）
│   ├── host.tsx                    # 插件渲染宿主（WorkspaceTabHost / DockPanelHost / LauncherModal）
│   ├── createPluginContext.ts      # 为每个插件实例注入隔离的 storage / ui / ipc / workspace API
│   └── index.ts                    # 对外暴露插件 SDK（definePlugin 等辅助函数）
│
└── builtin/                        # 内置插件开发目录（每个插件独立目录、独立状态、可懒加载）
    ├── index.ts                    # 内置插件统一注册入口
    ├── command-library/            # 【插件】命令库（原 Terminal 命令组与一键执行）
    │   ├── manifest.ts             # 插件元数据与挂载点声明
    │   ├── store.ts                # 插件私有状态
    │   └── CommandLibraryPanel.tsx # 插件 UI（支持停靠在右侧/底部或独立 Tab）
    ├── terminal-workspace/         # 【插件】系统终端（PTY 会话多 Tab）
    ├── json-formatter/             # 【插件】JSON 格式化
    ├── json-diff/                  # 【插件】JSON 语义对比
    ├── text-diff/                  # 【插件】文本对比
    ├── qr-code/                    # 【插件】二维码生成
    ├── unicode-converter/          # 【插件】Unicode 编码转换
    └── lan-file-receiver/          # 【插件】局域网文件接收
```

### 3.2 规范化插件 API 契约（Plugin SDK）

#### 1. 插件清单（`PluginManifest`）
每个插件通过 `definePlugin(...)` 导出标准 Manifest，声明自己的能力边界与 UI 挂载点：
```typescript
export type PluginMountTarget =
  | "workspace-tab"   // 在中央主工作区以 Tab 形式打开（如 JSON Diff、Terminal）
  | "dock-right"      // 在右侧辅助浮岛中停靠打开（如 命令库、AI 助手）
  | "modal";          // 以居中大圆角弹窗打开（如 二维码工具）

export interface PluginManifest {
  /** 全局唯一插件 ID，如 "builtin.json-formatter" */
  id: string;
  /** 显示名称 */
  name: string;
  /** 版本号 */
  version: string;
  /** 简短描述 */
  description: string;
  /** 图标（Lucide 图标名或自定义组件） */
  icon: LucideIcon;
  /** 插件分类："dev-tool" | "terminal" | "network" | "database" */
  category: PluginCategory;
  /** 允许的挂载位置 */
  mountTargets: PluginMountTarget[];
  /** 是否允许在中央工作区同时打开多个实例 Tab */
  allowMultipleTabs?: boolean;
  /** 所需权限声明（用于未来第三方插件沙箱控制） */
  permissions?: ("storage" | "ipc:terminal" | "ipc:lan-receiver" | "workspace:read" | "clipboard")[];
  /** 懒加载入口组件 */
  component: () => Promise<{ default: React.ComponentType<PluginComponentProps> }>;
  /** 生命周期钩子（可选） */
  onActivate?: (ctx: PluginContext) => void | Promise<void>;
  onDeactivate?: (ctx: PluginContext) => void | Promise<void>;
}
```

#### 2. 插件运行时上下文（`PluginContext`）
主应用通过 `PluginComponentProps` 与 `onActivate(ctx)` 向插件注入受控、隔离的标准 API，**严禁插件直接 import 主应用的内部 Store（如 `useAppStore`）**：

| API 命名空间 | 核心方法 | 设计规范与隔离机制 |
| :--- | :--- | :--- |
| `ctx.storage` | `get<T>(key)` / `set<T>(key, val)` / `remove(key)` | 按 `plugin.<pluginId>.<key>` 自动加前缀持久化到 SQLite `plugin_kv_store`（或 `app_settings`），彻底从 `workspaceSnapshot.ts` 解耦。 |
| `ctx.ui` | `notify(msg, tone)` / `confirm(opts)` / `openTab(pluginId, params?)` / `closeSelf()` | 统一调用主应用的全局 Toast 与模态框系统，风格自动跟随大圆角主题。 |
| `ctx.workspace` | `getActiveSource()` / `getActiveEditorSelection()` / `insertTextToEditor(sql)` | 只读获取当前工作区上下文或受控回填 SQL/命令，实现“命令库一键发送到终端”、“选中 JSON 一键打开 JSON 格式化”。 |
| `ctx.ipc` | `invoke<T>(command, args)` | 受权限清单校验的 Tauri IPC 通道（如终端 PTY、局域网文件服务）。 |
| `ctx.events` | `on(event, handler)` / `emit(event, payload)` | 跨插件轻量事件通信（如 `command-library` 发送 `terminal:run-command` 给 `terminal-workspace`）。 |

---

## 四、当前前端阻塞、状态与 Layout 诊断

### 4.1 前端启动阻塞 UI 问题（现状根因）
审查 `src/pages/MainPage.tsx`、`src/pages/mainPageStartup.ts`、`src/store/tauriStorage.ts` 与 `src-tauri/src/main.rs` 发现 **5 层叠加阻塞**：
1. **全屏模态遮罩强拦截（`MainPage.tsx` L424-L471）**：`startupState.loading === true` 时渲染 `fixed inset-0 z-[120]` 全屏遮罩，串联等待全部持久化恢复、快照压缩、终端清理、`refreshSources` 完成后才放行，导致用户无法操作任何功能。
2. **串行瀑布流初始化**：`rehydrate` 一次性读取整包 `WorkspaceSnapshotDto`（含全量 `queryResults`、`queryRowDrafts`、`consoleTabs`），紧接着又调用 `compactPersistedTabsSnapshot()` 与 `useTerminalStore.persist.clearStorage()` 触发两次写回。
3. **组件挂载被启动态锁死**：`shouldMountQueryPanel` 要求 `startupComplete === true` 才允许挂载 `QueryPanel`，`useSourcesQuery(startupComplete)` 同步被禁用。
4. **首屏反序列化大 JSON**：历史结果集在首屏一次性解析进内存。
5. **后端 `.setup()` 同步阻塞建窗**：`main.rs` L35-L54 在显示窗口前同步执行数据库检查、归档与建表。

### 4.2 状态管理与 Layout 缺陷
- **Layout 极度单薄**：`src/layouts/` 仅有 19 行的 `MainLayout.tsx`；`AuthPage`、`FieldMetaPage` 无统一窗口壳；各面板重复实现分栏拖拽、头部栏与 Tab 导航。
- **状态越界与巨型快照**：`MainPage` 越权调用 `useMainPageQueryPanel`（714 行）；`useAppStore` 混入 Query Tab 与 ToolsPanel 状态；`workspaceSnapshot.ts`（781 行）将 9 个 Store 强行捆绑全量覆盖写回；`useTerminalStore` 边持久化边启动清空。

---

## 五、无阻塞启动与前端状态/Layout 重构方案

### 5.1 渐进式无阻塞启动（< 50ms 首屏可交互）
1. **移除全屏启动遮罩**：启动即刻渲染自绘标题栏 + 左侧连接树壳 + 中央工作区壳，用户可随时点击任意菜单、打开插件或切换视图。
2. **三级懒水合策略**：
   - **P0（首帧同步/极速）**：仅恢复窗口壳态（主题、侧栏宽度、激活数据源 ID、Tab 元数据列表）。
   - **P1（局部 Skeleton 异步）**：连接树与**仅当前激活 Tab** 异步水合，局部展示微轻量骨架屏。
   - **P2（后台空闲静默）**：非激活 Tab 切换到时再懒加载结果集；CLI 数据源同步、版本检查延后到后台静默执行。

### 5.2 标准化 Layout 体系（`src/layouts/`）
1. **`AppShellLayout`**：自绘标题栏（`CustomTitleBar`）+ 外层浅灰底壳 + 三栏大圆角浮岛容器（`SplitPaneLayout`）+ 底部状态栏 + 全局 Toast/Modal Portal。
2. **`SubWindowLayout`**：专用于 `AuthPage`、`FieldMetaPage`，内置统一无边框自绘小窗标题栏（标题 + 关闭按钮 + `data-tauri-drag-region`）与大圆角内容卡片。
3. **`SplitPaneLayout`**：统一的可拖拽分栏原语（支持水平/垂直、尺寸持久化、防文本选中），供左栏/主区/右栏（AI & Dock 插件）/上下结果区共用。
4. **`WorkspaceTabBar`**：Chrome/Chat2DB 风格大圆角标签栏，统一支持 Data Tab、Console Tab 与 Plugin Tab 混排、拖拽排序与右键菜单。

### 5.3 四层清晰状态边界
- **TanStack Query**：统一托管 `sources`、`objects`、`describe`、`ddl`、`systemLogs` 等后端查询缓存。
- **`useAppShellStore`**：仅管自绘标题栏状态、左右/底部面板折叠与宽度、激活工作区 Tab ID、全局 Toast 队列。
- **工作区 Store**：`queryWorkspaceStore` 按 Tab ID 增量读写，不再全量覆盖；`MainPage` 不再持有 `useMainPageQueryPanel`。
- **插件隔离状态**：每个插件通过 `ctx.storage` 与自身内部 Store 管理状态，彻底移除 `workspaceSnapshot.ts` 中的工具切片与 `useTerminalStore` 无效持久化。

### 5.4 前端 UI 状态持久化分级规范

桌面端数据库 IDE 必须持久化核心 UI 状态（如布局尺寸、已打开 Tab、未保存 SQL 草稿、列显隐与插件偏好），但严禁将轻量 UI 偏好与重型业务结果集混包全量覆盖。所有前端 UI 状态按**体量、读写频率与作用域**划分为以下四类独立通道 + 一类纯内存瞬态：

| 状态分级 | 具体包含的 UI 状态 | 存储载体与读写策略 | 写入时机约束 |
| :--- | :--- | :--- | :--- |
| **1. 应用外壳与布局偏好**<br>（极轻量，首帧即需） | • 主题模式（Light / Dark）<br>• 左右浮岛折叠态与宽度（`leftSidebarWidth`、`rightDockWidth`、`rightDockOpen`）<br>• 底部结果抽屉默认高度<br>• 上次选中的数据源 ID、默认分页大小 | 独立 KV 表 `app_settings`，按 `setting_key` 单独读写（< 2KB，首屏毫秒级恢复）。 | 拖拽分栏期间仅更新本地内存态，**仅在 `onPointerUp` 结束时写入一次**；开关切换防抖写入单 key。 |
| **2. 工作区 Tab 与草稿**<br>（中等体量，防丢失核心） | • 已打开 Tab 列表、顺序（`tabOrder`）、当前激活 Tab ID<br>• Console Tab 的 **SQL/SOQL 草稿**与绑定数据源<br>• Data Tab 的 `where` / `sort` / 列显隐 / 列宽 / 抽屉视图 | 结构化表 `workspace_tabs` / `query_tab_state` / `console_tab_state`。<br>**按单个 `tab_id` 增量 Upsert**，不牵连其他 Tab。 | 编辑草稿防抖（300ms-500ms）仅更新当前 `tab_id` 对应行。 |
| **3. 重型结果与编辑草稿**<br>（大体积，按需懒加载） | • 历史查询结果集缓存（`query_result_sets`）<br>• 未提交的行编辑草稿（`query_row_drafts`） | **启动时不加载**，用户点击切换到对应非激活 Tab 时再按 `tab_id` 异步懒加载。 | 仅该 Tab 执行查询或产生脏行编辑时按 `tab_id` 单独写盘。 |
| **4. 插件自身 UI 状态**<br>（高内聚、命名空间隔离） | • 命令库用户预设命令/分组（`terminal_command_groups`）<br>• 工具参数偏好（如二维码尺寸/纠错、Unicode 输出格式）<br>• 工具历史记录、Diff/格式化草稿（需限制条数与大小上限） | 通过插件 SDK `ctx.storage` 读写后端 `plugin_kv_store`（按 `plugin_id` 隔离）。 | 由插件内部按需触发，与主工作区零耦合。 |
| **5. 瞬态 UI 状态（不持久化）** | • 终端 PTY 运行态与历史输出流（重启即新建干净会话）<br>• 弹窗/右键菜单开关、搜索框临时输入、Loading 标志、Toast 通知、表单校验错误信息、拖拽中临时坐标 | **纯内存**（组件 `useState` / 非持久化 Store）。 | 禁止落盘；彻底移除 `useTerminalStore` 的无效 `persist` 配置。 |

---

## 六、后端 SQLite 设计与迁移规范化方案

针对 `src-tauri/src/storage/`（`mod.rs`、`pragma.rs`、`schema.rs`、`bootstrap.rs`、`tx.rs`、`secret_repo.rs`）存在的缺陷，制定以下改造标准：

### 6.1 核心问题诊断
1. **破坏性归档代替版本迁移**：`bootstrap.rs` 一旦检测到 `bootstrap_version` 不匹配或 `data_sources` 缺列就整库重命名归档（`.backup.db`）并重建空库，升级即丢数据；且仅检查 `data_sources` 一张表，忽略其余 19 张表。
2. **单锁废除 WAL 并发**：`Storage` 用单把 `Mutex<Connection>` 串行化全部读写，使 `pragma.rs` 开启的 `WAL` 模式形同虚设；`Storage::connection()` 直接暴露底层锁破坏封装；`tx.rs` 为空壳文件。
3. **Schema 与安全缺陷**：`source_object_indexes`、`source_object_constraints` 缺外键级联删除；外键列与高频查询列缺索引；`records_json` 等大字段与配置同事务全量覆盖写入造成写入放大；`secret_repo.rs` 仍以 `'plain-text/v1'` 明文落盘。

### 6.2 规范化改造方案
1. **引入版本化增量迁移引擎（`MigrationRunner`）**：
   - 基于 `PRAGMA user_version` + `migration_logs` 实现 `V1 -> V2 -> V3 ...` 幂等增量 SQL/Rust 迁移脚本，严格在单事务内执行 `ALTER TABLE` 与数据回填，**严禁再使用归档删库逻辑**。
2. **读写分离并发模型**：
   - 保持 `WAL` 模式：写入端保留单写连接 + `tx.rs` `SQLITE_BUSY` 退避重试；读取端引入只读连接池（`OpenFlags::SQLITE_OPEN_READ_ONLY`），实现前端多面板并发读零阻塞。
   - 移除 `Storage::connection()` 裸锁暴露，所有访问收口至 `Repository` 与 `Service`。
3. **Schema 规范化与插件存储支持**：
   - 补全 `source_object_indexes`、`source_object_constraints` 外键级联与所有外键/查询索引。
   - 将 `query_result_sets` 与 `query_row_drafts` 改为按 `tab_id` 增量 CRUD 接口，废除整包 `save_workspace_snapshot` 覆写。
   - 新增通用 `plugin_kv_store (plugin_id, storage_key, value_json, updated_at)` 表，支撑前端插件系统 `ctx.storage` 隔离持久化；清理死表 `terminal_tab_state`。
   - 接入系统 Keyring 托管主密钥，将 `secret_items` 从 `'plain-text/v1'` 升级为 AEAD 加密存储。

---

## 七、分阶段落地路线图

| 阶段 | 优先级 | 核心工作内容 | 验收标准 |
| :--- | :--- | :--- | :--- |
| **Phase 1：无边框窗口与自绘标题栏 + 解除阻塞** | **P0** | 1. `tauri.conf.json` 启用 `decorations: false` 并配置窗口控制权限。<br>2. 实现 `AppShellLayout`、`CustomTitleBar`、`SubWindowLayout` 与大圆角浮岛主题 Token。<br>3. 移除 `MainPage` 全屏阻塞遮罩，实现壳秒开与渐进水合。 | 应用启动无遮罩阻塞，窗口自绘标题栏可拖拽、缩放、关闭，整体呈现大圆角浮岛视觉。 |
| **Phase 2：SQLite 增量迁移与读写分离** | **P0** | 1. 实现 `MigrationRunner` 替换 `bootstrap.rs` 归档重建。<br>2. 改造 `Storage` 为单写 + 只读连接池，补全外键与索引，新增 `plugin_kv_store`。<br>3. 拆分 `save_workspace_snapshot` 为按 Tab/Key 增量接口。 | 升级表结构零数据丢失，并发读不阻塞写，工作区保存不再全量覆写大 JSON。 |
| **Phase 3：插件系统内核与内置插件迁移** | **P1** | 1. 建立 `src/plugins/core/` 与 `PluginContext` SDK。<br>2. 将命令库、终端、6 个工具箱工具逐一迁移至 `src/plugins/builtin/`，支持工作区 Tab 与右侧 Dock 停靠。<br>3. 清理 `workspaceSnapshot.ts`、`useAppStore` 与 `ToolsPanel` 旧壳。 | 主工作区支持混合 Tab（Data / Console / Plugin），右侧 Dock 支持 AI 与插件切换，新增插件只需在 `builtin/` 建目录注册。 |
| **Phase 4：主工作区交互与细节打磨** | **P2** | 1. 完成 `AuthPage`、`FieldMetaPage` 适配 `SubWindowLayout`。<br>2. 完善插件间事件联动（命令库 -> 终端、选中文本 -> 工具插件、AI -> 编辑器）。<br>3. 补齐前后端单测与打包验证。 | 多窗口样式完全统一，全量 `tsc && vite build`、`cargo test` 与前端单测通过。 |

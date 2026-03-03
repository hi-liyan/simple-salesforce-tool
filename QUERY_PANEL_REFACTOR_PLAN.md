# QueryPanel 重构计划与进度（2026-03-03）

## 1. 目标与范围

- 将原 `Query` 与 `SOQL 执行器` 两套分裂页面整合为同一工作区。
- 左侧 `DATA SOURCE` 标题上方统一三个动作按钮：`新建连接`、`刷新`、`查询控制台`。
- 右侧统一一套 Tab 工作区，同时承载：
  - `data`：对象数据查询 Tab
  - `console`：查询控制台 Tab
- 左侧对象列表统一树形交互：
  - Salesforce：单击展开字段，双击打开数据 Tab
  - MySQL：单击展开 `列/键/外键/索引/检查`，双击打开数据 Tab
- `MainPage` 只保留页面级生命周期与编排，Query 子系统逐步收敛到 `src/features/main/QueryPanel`。

## 2. 已落地架构（代码现状）

### 2.1 目录与组件

- 已新增目录：`src/features/main/QueryPanel/`
- 当前已落地文件：
  - `QueryPanel.tsx`
  - `types.ts`
  - `components/QueryWorkspaceTabs.tsx`
  - `components/QuerySidebarActions.tsx`

### 2.2 工作区统一模型

- 在 `MainPage` 中引入统一工作区 ID 协议：
  - `data:{objectName}`
  - `console:{soqlTabId}`
- 已实现 `workspaceTabs` 混合输出（data 在前，console 在后）。
- 已实现统一激活与关闭逻辑：
  - `onActivateWorkspaceTab`
  - `onCloseWorkspaceTab`

### 2.3 视图收敛

- `MainViewMode` 已收敛为 `"query" | "settings"`。
- 旧值兼容已处理：
  - `soqlExecutor -> query`
  - `systemLogs -> settings`
- 页面渲染已通过 `QueryPanel` 统一承载 Query/Console/Settings 视图。

## 3. 分阶段进度总览

## 状态定义

- `已完成`：代码已落地并通过当前构建/测试。
- `部分完成`：主流程已落地，但仍有人工验证或兼容性待补。
- `未开始`：尚未进入实施。

## Phase A：搭建 QueryPanel 壳层

- 状态：`已完成`
- 结果：
  - `MainPage` 已挂载 `QueryPanel`。
  - 左右工作区编排已迁入 `QueryPanel.tsx`。

## Phase B：统一右侧 Tab 条（data + console）

- 状态：`已完成`
- 结果：
  - 已新增 `QueryWorkspaceTabs`。
  - 已支持 data/console 混合显示、激活、关闭。
  - “查询控制台”每次点击新增一个 console Tab 并激活。

## Phase C：Salesforce 树交互规范

- 状态：`已完成`
- 结果：
  - `ObjectList` 树模式已实现单击展开、双击打开对象 Tab。
  - 不可查询对象双击会阻断并提示。

## Phase D：MySQL 结构树

- 状态：`部分完成`
- 结果：
  - 前端已展示 `列/键/外键/索引/检查` 五类节点。
  - 已接入 `describe + getObjectDdl` 组合数据源。
  - `检查` 优先读约束 DDL，兜底从 `CREATE TABLE` 中抽取 `CHECK(...)`。
- 待确认：
  - MySQL 5.7/8.x 下 `CHECK` 展示一致性需真机验证。

## Phase E：移除旧分裂视图

- 状态：`已完成`
- 结果：
  - `MainViewMode` 不再包含 `soqlExecutor`。
  - 旧持久化模式值有兼容回退逻辑。

## Phase F：回归与稳定性验证

- 状态：`部分完成`
- 结果：
  - `npm run build`：通过。
  - `npm run test:datagrid-utils`：通过（8/8）。
  - `npm run test:query-panel`：通过（6/6）。
  - 已形成回归清单与结果文档。
- 待完成：
  - 多数据源真机交互回归（控制台多 Tab 焦点、切源+恢复组合场景等）。

## 4. 当前风险与处理

- 风险：`MainPage` 仍较大，虽已下沉统一工作区 Tab 逻辑，但查询执行/数据源切换等逻辑仍集中在页面层。
  - 处理：后续继续按“状态适配层 + 行为 hook”拆分剩余业务逻辑。
- 风险：MySQL `CHECK` 跨版本兼容差异。
  - 处理：补 5.7/8.x 实库验证记录，必要时后端补充信息架构查询。
- 风险：自动化测试覆盖不足（当前主要覆盖 DataGrid 工具函数）。
  - 处理：补 QueryPanel 交互级测试（统一 Tab、树交互、切源恢复）。

## 5. 验收项对照（当前判断）

- [x] 左侧动作区三个按钮到位（新建/刷新/查询控制台）。
- [x] 右侧支持 data + console 混合 Tab。
- [x] Salesforce 树：单击展开、双击开 Tab。
- [x] MySQL 树：单击展开五类节点、双击开 Tab。
- [x] 旧分裂视图入口下线，工作区统一。
- [ ] 全量真机回归闭环（仍需补齐）。

## 6. 下一步执行建议（按优先级）

1. 执行真机回归（真实 Salesforce/MySQL 源），补齐 Phase F 待确认项。
2. 为树交互（单击展开/双击打开）补充自动化测试路径。
3. 继续拆分 `MainPage` 里的查询执行与数据源切换流程到独立 hooks。

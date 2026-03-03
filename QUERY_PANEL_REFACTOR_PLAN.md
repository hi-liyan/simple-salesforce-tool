# Query 与 SOQL 执行器整合重构计划

## 1. 重构目标

- 将 `Query` 布局与 `SOQL 执行器` 页面整合为同一工作区。
- 在左侧 `DATA SOURCE` 标题上方动作区统一提供三个 Icon 按钮：
  - 新建连接
  - 刷新
  - 查询控制台
- 点击“查询控制台”后，在右侧新增一个控制台 Tab，并激活该 Tab；保留当前数据 Tab 状态不变。
- 左侧对象列表改为树结构：
  - Salesforce：单击对象展开字段信息，双击对象打开右侧数据查询 Tab。
  - MySQL：单击表展开“列/键/外键/索引/检查”，双击表打开右侧数据查询 Tab。
- 在 `src/features/main` 下新增 `QueryPanel` 目录，按 DataGrid 的可维护风格拆分组件、状态、逻辑，避免 `MainPage.tsx` 继续膨胀。

## 2. 当前架构与问题

- `src/pages/MainPage.tsx` 当前存在两套分离视图：
  - `viewMode === "query"`（对象查询工作区）
  - `viewMode === "soqlExecutor"`（SOQL 执行器工作区）
- 右侧 Tab 体系分裂：
  - 查询 Tab：`TabState`（`src/types/index.ts`）
  - 执行器 Tab：`SoqlExecutorTab`（`src/store/useSoqlExecutorStore.ts`）
- 左侧对象列表虽已有 `treeMode`，但当前行为与目标仍有差距：
  - Salesforce 目前树模式可展开字段，但未明确“双击开数据 Tab”的交互层规范。
  - MySQL 仅具备对象描述/DDL能力，尚无“列/键/外键/索引/检查”树节点完整模型。
- `MainPage.tsx` 混杂了初始化、数据源同步、查询执行、Tab 管理、抽屉管理、SQL/SOQL分支、UI 编排等多职责。

## 3. 目录重构方案（新增）

- 新增目录：`src/features/main/QueryPanel/`
- 建议结构：
  - `src/features/main/QueryPanel/index.tsx`
  - `src/features/main/QueryPanel/types.ts`
  - `src/features/main/QueryPanel/hooks/useQueryPanelState.ts`
  - `src/features/main/QueryPanel/hooks/useObjectTreeData.ts`
  - `src/features/main/QueryPanel/components/QuerySidebar.tsx`
  - `src/features/main/QueryPanel/components/QuerySidebarActions.tsx`
  - `src/features/main/QueryPanel/components/QueryObjectTree.tsx`
  - `src/features/main/QueryPanel/components/QueryWorkspaceTabs.tsx`
  - `src/features/main/QueryPanel/components/DataQueryTabPane.tsx`
  - `src/features/main/QueryPanel/components/ConsoleTabPane.tsx`

## 4. 核心设计

### 4.1 右侧统一 Tab 工作区

- 引入统一 Tab 视图模型（UI 层 union）：
  - `data` 类型：承载现有 `TabState` 数据查询 Tab。
  - `console` 类型：承载现有 `SoqlExecutorTab` 查询控制台 Tab。
- “查询控制台”按钮行为：
  - 支持多个控制台 Tab。
  - 每次点击均新建一个控制台 Tab（如 `Console 1/2/...`）并激活。
  - 仅切换激活焦点，不改动当前数据查询 Tab 的状态。
- 优先采用“适配层”方式桥接 `useAppStore` 与 `useSoqlExecutorStore`，降低一次性重写风险。

### 4.2 左侧树结构统一

- Salesforce 节点：
  - 单击对象：展开/折叠字段（复用 describe 懒加载）。
  - 双击对象：若 Tab 已存在则激活既有 Tab，否则新建 Tab。
- MySQL 节点：
  - 单击表：展开“列/键/外键/索引/检查”分类节点。
  - 其中“键”包含所有键类型，不仅限主键。
  - “检查”要求展示 `CHECK CONSTRAINT` 明细。
  - 双击表：若 Tab 已存在则激活既有 Tab，否则新建 Tab。
- 将树渲染与节点行为抽离到 `QueryObjectTree`，按 `sourceType` 分支渲染。

### 4.3 MainPage 职责收敛

- `MainPage` 保留：
  - 启动初始化（rehydrate、启动遮罩、版本检查）
  - 全局级别页面容器逻辑
- `MainPage` 迁出至 `QueryPanel`：
  - Query/SOQL 页面编排
  - 左右区联动
  - query + console 的统一 tab 管理 UI

## 5. 分阶段实施计划

### Phase A：搭建 QueryPanel 壳层（不改业务行为）

- 新建 `QueryPanel` 目录与基础组件骨架。
- 先将原 `LeftSidebar + RightWorkspace + SoqlExecutorWorkspace` 接入新壳层。
- `MainPage` 改为挂载 `QueryPanel`，确保功能不回归。

### Phase B：统一右侧 Tab 条（查询 + 控制台并存）

- 引入 `QueryWorkspaceTabs` 组件。
- 增加 `console` Tab 类型展示与切换逻辑。
- 接入“查询控制台”按钮打开/激活行为。

### Phase C：落地 Salesforce 树交互规范

- 在 `QueryObjectTree` 中实现单击展开、双击开 Tab。
- 复用 describe 懒加载与缓存逻辑。

### Phase D：落地 MySQL 结构树

- 后端补充/扩展元数据接口，支持“列/键/外键/索引/检查”。
- 前端构建 MySQL 树节点模型并渲染。

### Phase E：清理旧分裂视图

- 移除 `viewMode` 中 `query/soqlExecutor` 的分离渲染路径。
- 统一进入 `QueryPanel` 工作区（设置页保留独立入口）。

### Phase F：回归与稳定性验证

- 验证持久化恢复、Tab 状态恢复、数据源切换一致性。
- 验证 Salesforce/MySQL 双数据源行为。
- 验证错误提示、加载态、抽屉/日志与快捷操作无回归。

## 6. 数据与状态迁移策略

- 继续沿用现有 store：
  - 查询页：`useAppStore`
  - 控制台：`useSoqlExecutorStore`
- 在 `QueryPanel` 通过“视图适配层”组合两套状态供 UI 渲染。
- 中期可评估合并 store；首版以稳定交付为优先，不强行合并底层状态。

## 7. 风险与应对

- 风险：双 store 并存导致状态同步复杂。
  - 应对：仅在 UI 层统一，不交叉写入底层结构。
- 风险：MySQL 元数据粒度不足。
  - 应对：先补后端元数据接口，再接树节点，避免前端假数据。
- 风险：`MainPage` 抽离期间出现生命周期回归。
  - 应对：Phase A 保持行为等价，先迁容器再迁逻辑。

## 8. 验收标准

- 左侧 DATA SOURCE 区存在三个 Icon 按钮：新建连接、刷新、查询控制台。
- 右侧可同时存在数据查询 Tab 与查询控制台 Tab，并可自由切换/关闭。
- Salesforce 树：单击展开字段、双击打开数据 Tab。
- MySQL 树：单击展开列/键/外键/索引/检查、双击打开数据 Tab。
- `MainPage.tsx` 复杂度明显下降，Query 相关代码迁入 `src/features/main/QueryPanel`。

## 9. 已确认约束（已定稿）

- 查询控制台支持多个 Tab，并且每次点击“查询控制台”都新增一个 Tab。
- MySQL “键”范围为所有键，不仅仅是主键。
- MySQL “检查”需要读取并展示 `CHECK CONSTRAINT` 明细。
- 双击对象/表打开数据 Tab 时，若已存在则切换到已有 Tab，不新开副本。
- 点击“查询控制台”后，保留当前数据 Tab 状态，仅新增并激活控制台 Tab。

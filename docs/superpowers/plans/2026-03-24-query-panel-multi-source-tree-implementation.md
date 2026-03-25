# QueryPanel Multi-Source Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 QueryPanel 改造为多数据源并行工作区：左侧使用统一树展示全部数据源与类型化子节点，右侧对象 Tab / 控制台 Tab 永久绑定创建时数据源，并在设置页支持手动配置数据源颜色。

**Architecture:** 以“统一树组件 + 按数据源类型的节点提供器 + Tab 自带 source 上下文”为主线推进。先补纯逻辑与数据结构测试，再扩展数据源颜色配置与树节点模型，之后逐步替换左侧单数据源侧栏，并把对象查询、控制台执行、工作区顺序与持久化从页面级 `selectedSourceId` 迁移到 Tab 自身 `sourceId`。

**Tech Stack:** React 18、TypeScript、Zustand persist、TanStack Query、Node test runner、第三方树组件（建议 `react-arborist`）

---

### Task 1: 为数据源颜色配置补齐类型与设置页测试入口

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/features/main/SettingsPanel/index.tsx`
- Create: `src/features/main/QueryPanel/logic/sourceColor.ts`
- Create: `tests/query-panel/sourceColor.test.ts`

- [x] **Step 1: 写失败测试，覆盖颜色读取与写回规则**

```ts
test("getSourceColor: 应仅从 configJson.color 读取合法颜色值", () => {
  assert.equal(getSourceColor({ configJson: { color: "#4F46E5" } } as SalesforceSource), "#4F46E5");
  assert.equal(getSourceColor({ configJson: {} } as SalesforceSource), "");
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `node --test --experimental-strip-types tests/query-panel/sourceColor.test.ts`
Expected: FAIL with module/function not found

- [x] **Step 3: 实现最小颜色辅助函数与类型扩展**

```ts
export function getSourceColor(source: SalesforceSource): string {
  // 仅返回用户手动配置的颜色，不做默认分配。
}
```

- [x] **Step 4: 在设置页编辑表单中规划颜色字段接入点**

```ts
const [salesforceEditForm, setSalesforceEditForm] = useState({
  name: "",
  color: ""
});
```

- [x] **Step 5: 运行测试确认通过**

Run: `node --test --experimental-strip-types tests/query-panel/sourceColor.test.ts`
Expected: PASS

### Task 2: 为多数据源树节点模型与提供器补齐纯逻辑测试

**Files:**
- Create: `src/features/main/QueryPanel/types/tree.ts`
- Create: `src/features/main/QueryPanel/logic/sourceTreeProviders.ts`
- Create: `tests/query-panel/sourceTreeProviders.test.ts`

- [x] **Step 1: 写失败测试，覆盖 Salesforce / MySQL 节点生成**

```ts
test("buildMySqlRootChildren: 应生成 tables、collations、users、virtual views 分组", async () => {
  const nodes = await buildMySqlRootChildren(mockSource, mockContext);
  assert.deepEqual(nodes.map((item) => item.label), ["tables", "collations", "users", "virtual views"]);
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `node --test --experimental-strip-types tests/query-panel/sourceTreeProviders.test.ts`
Expected: FAIL with provider not found

- [x] **Step 3: 实现最小树节点类型与 provider 抽象**

```ts
export type QueryTreeNode = { id: string; kind: "source" | "group" | "object"; ... };
export const sourceTreeProviders = {
  salesforce: { ... },
  mysql: { ... }
};
```

- [x] **Step 4: 运行测试确认通过**

Run: `node --test --experimental-strip-types tests/query-panel/sourceTreeProviders.test.ts`
Expected: PASS

### Task 3: 为多数据源树状态与刷新行为补齐纯逻辑测试

**Files:**
- Create: `src/features/main/QueryPanel/logic/sourceTreeState.ts`
- Create: `tests/query-panel/sourceTreeState.test.ts`

- [x] **Step 1: 写失败测试，覆盖聚焦、展开与单源刷新**

```ts
test("refreshFocusedSourceState: 应仅将聚焦数据源标记为刷新中", () => {
  const next = refreshFocusedSourceState(initialState, "sf-1");
  assert.equal(next.sourceRefreshingById["sf-1"], true);
  assert.equal(next.sourceRefreshingById["mysql-1"], undefined);
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `node --test --experimental-strip-types tests/query-panel/sourceTreeState.test.ts`
Expected: FAIL with function not found

- [x] **Step 3: 实现最小状态纯函数**

```ts
export function toggleExpandedNode(ids: string[], nodeId: string): string[] {
  // 统一处理树展开状态。
}
```

- [x] **Step 4: 运行测试确认通过**

Run: `node --test --experimental-strip-types tests/query-panel/sourceTreeState.test.ts`
Expected: PASS

### Task 4: 为对象 Tab 与控制台 Tab 的 source 绑定补齐持久化测试

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/store/useAppStore.ts`
- Modify: `src/store/useSoqlExecutorStore.ts`
- Create: `tests/query-panel/multiSourceTabBinding.test.ts`

- [x] **Step 1: 写失败测试，覆盖 Tab 恢复时保留 source 元信息**

```ts
test("hydrateTab: 应保留对象 Tab 的 sourceId/sourceType/sourceName/sourceColor", () => {
  const tab = hydrateTab({ objectName: "Account", sourceId: "sf-1", sourceType: "salesforce", sourceName: "Prod", sourceColor: "#2563EB" });
  assert.equal(tab.sourceId, "sf-1");
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `node --test --experimental-strip-types tests/query-panel/multiSourceTabBinding.test.ts`
Expected: FAIL with expected mismatch or property missing

- [x] **Step 3: 扩展 TabState / Console Tab 持久化结构**

```ts
export type TabState = {
  sourceId: string;
  sourceType: string;
  sourceName: string;
  sourceColor: string;
  ...
};
```

- [x] **Step 4: 运行测试确认通过**

Run: `node --test --experimental-strip-types tests/query-panel/multiSourceTabBinding.test.ts`
Expected: PASS

### Task 5: 接入设置页数据源颜色编辑与展示

**Files:**
- Modify: `src/features/main/SettingsPanel/index.tsx`
- Modify: `src/types/index.ts`
- Test: `tests/query-panel/sourceColor.test.ts`

- [x] **Step 1: 为设置页颜色表单补失败测试或纯函数断言**

```ts
test("buildSalesforceUpdatePayload: 应将 color 写入 configJson", () => {
  assert.deepEqual(payload.configJson, { color: "#DC2626" });
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `node --test --experimental-strip-types tests/query-panel/sourceColor.test.ts`
Expected: FAIL with payload mismatch

- [x] **Step 3: 在 Salesforce / MySQL 编辑表单中增加颜色字段，并在卡片列表展示颜色预览**

```tsx
<input type="color" value={salesforceEditForm.color} ... />
```

- [x] **Step 4: 运行测试确认通过**

Run: `node --test --experimental-strip-types tests/query-panel/sourceColor.test.ts`
Expected: PASS

### Task 6: 引入树组件并创建统一 Query 树侧栏骨架

**Files:**
- Modify: `package.json`
- Create: `src/features/main/QueryPanel/components/QuerySourceTree.tsx`
- Create: `src/features/main/QueryPanel/components/QuerySourceTreeNode.tsx`
- Modify: `src/features/main/QueryPanel/components/QuerySidebar.tsx`
- Modify: `src/features/main/QueryPanel/types.ts`

- [x] **Step 1: 先为树节点映射纯函数补失败测试**

```ts
test("buildSourceRootNodes: 应按 sortOrder 输出全部 source 节点并携带颜色", () => {
  const nodes = buildSourceRootNodes([mysqlSource, sfSource]);
  assert.equal(nodes[0].kind, "source");
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `node --test --experimental-strip-types tests/query-panel/sourceTreeProviders.test.ts`
Expected: FAIL with function not found or mismatch

- [x] **Step 3: 安装树组件并实现统一树侧栏骨架**

```tsx
return <Tree data={rootNodes} childrenAccessor="children">...</Tree>;
```

- [x] **Step 4: 将 QuerySidebar 从“下拉 + 当前对象树”改为“动作区 + 统一树”**

```tsx
<QuerySourceTree sources={sources} focusedSourceId={focusedSourceId} ... />
```

- [x] **Step 5: 运行现有 Query 测试，确认基础回归**

Run: `npm run test:query-panel`
Expected: PASS or only tree 相关新断言失败

### Task 7: 实现多数据源树 hook 与单源刷新/展开加载链路

**Files:**
- Create: `src/features/main/QueryPanel/hooks/useSourceTreeState.ts`
- Modify: `src/features/main/QueryPanel/hooks/useMainPageQueryPanel.ts`
- Modify: `src/features/main/QueryPanel/hooks/useSourceActions.ts`
- Modify: `src/features/main/QueryPanel/types.ts`
- Test: `tests/query-panel/sourceTreeState.test.ts`

- [x] **Step 1: 写失败测试，覆盖展开加载与刷新只影响单源**

```ts
test("expandSourceNode: 应按 sourceId 分桶缓存对象与子节点", async () => {
  // 展开 sf-1 后，mysql-1 的缓存仍为空。
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `node --test --experimental-strip-types tests/query-panel/sourceTreeState.test.ts`
Expected: FAIL with branch not implemented

- [x] **Step 3: 实现 useSourceTreeState，并将焦点/展开/刷新动作接入 MainPage 聚合层**

```ts
const { sourceTreeState, focusSource, toggleSourceNode, refreshFocusedSource } = useSourceTreeState(...);
```

- [x] **Step 4: 让顶部刷新按钮只刷新聚焦数据源，并在节点前显示 loading**

```ts
onRefreshSources: () => void refreshFocusedSource()
```

- [x] **Step 5: 运行测试确认通过**

Run: `npm run test:query-panel`
Expected: PASS

### Task 8: 为 Salesforce 树节点加载链路接入重新认证重试

**Files:**
- Modify: `src/features/main/QueryPanel/logic/sourceTreeProviders.ts`
- Modify: `src/features/main/QueryPanel/hooks/useSourceTreeState.ts`
- Modify: `src/pages/MainPage.tsx`
- Create: `tests/query-panel/sourceTreeAuthRetry.test.ts`

- [x] **Step 1: 写失败测试，覆盖 Salesforce 展开失败后触发认证重试**

```ts
test("salesforce provider: 展开加载遇到认证失效时应触发 retry wrapper 并重试", async () => {
  // 首次抛认证错误，第二次成功返回对象。
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `node --test --experimental-strip-types tests/query-panel/sourceTreeAuthRetry.test.ts`
Expected: FAIL with retry wrapper not invoked

- [x] **Step 3: 为 provider 注入认证重试包装器，并接入现有 Salesforce 认证逻辑**

```ts
await withSalesforceSourceReauth(source, () => api.listObjects(source.id));
```

- [x] **Step 4: 运行测试确认通过**

Run: `node --test --experimental-strip-types tests/query-panel/sourceTreeAuthRetry.test.ts`
Expected: PASS

Note:
当前实现采用“前端 provider 包装器 + 后端 401 自动刷新”的组合链路：`buildSalesforceRootChildren` 支持注入 `withSalesforceSourceReauth`，左树状态通过 `sf:token-refresh-start/end` 事件回填 `sourceAuthPendingById`，后端 `list_objects` / `refresh_objects` 继续负责 CLI Salesforce 数据源的实际 `401 -> CLI 刷新 token -> 重试`。

### Task 9: 将对象 Tab 打开链路迁移为永久绑定 source 上下文

**Files:**
- Modify: `src/features/main/QueryPanel/hooks/useQueryPanelRuntime.ts`
- Modify: `src/features/main/QueryPanel/hooks/useMainPageQueryPanel.ts`
- Modify: `src/features/main/QueryPanel/components/QuerySourceTree.tsx`
- Modify: `src/features/main/QueryPanel/components/DataQueryTabPane.tsx`
- Test: `tests/query-panel/multiSourceTabBinding.test.ts`

- [x] **Step 1: 写失败测试，覆盖从树节点打开对象 Tab 时写入 source 元信息**

```ts
test("openObjectFromSource: 应创建带 sourceId/sourceType/sourceName/sourceColor 的 tab", async () => {
  // 断言新 tab 绑定到发起数据源。
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `node --test --experimental-strip-types tests/query-panel/multiSourceTabBinding.test.ts`
Expected: FAIL with source metadata missing

- [x] **Step 3: 修改对象打开链路，所有 describe/query/DDL 默认从 activeTab.sourceId 取值**

```ts
const sourceId = activeTab?.sourceId || "";
```

- [x] **Step 4: 运行 Query 相关测试**

Run: `npm run test:query-panel`
Expected: PASS

### Task 10: 将控制台 Tab 迁移为永久绑定 source 上下文

**Files:**
- Modify: `src/store/useSoqlExecutorStore.ts`
- Modify: `src/features/main/QueryPanel/components/ConsoleTabPane.tsx`
- Modify: `src/features/main/QueryPanel/components/SoqlExecutorWorkspace.tsx`
- Modify: `src/features/main/QueryPanel/hooks/useQueryPanelActions.ts`
- Test: `tests/query-panel/multiSourceTabBinding.test.ts`

- [x] **Step 1: 写失败测试，覆盖不同 source 打开的 console tab 不串源**

```ts
test("console tabs: 应永久绑定创建时 sourceId", () => {
  // source A / source B 各自恢复独立的 console 执行上下文。
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `node --test --experimental-strip-types tests/query-panel/multiSourceTabBinding.test.ts`
Expected: FAIL with console source state shared

- [x] **Step 3: 重构 console store 与 workspace，使执行、补全和恢复都以 tab 自身 sourceId 为准**

```ts
type SoqlConsoleTabState = {
  id: string;
  sourceId: string;
  sourceType: string;
  sourceName: string;
  sourceColor: string;
};
```

- [x] **Step 4: 运行 Query 测试确认通过**

Run: `npm run test:query-panel`
Expected: PASS

### Task 11: 调整工作区 tabs 顺序与恢复逻辑，脱离全局 selectedSourceId

**Files:**
- Modify: `src/features/main/QueryPanel/hooks/useWorkspaceTabs.ts`
- Modify: `src/store/useQueryWorkspaceTabsStore.ts`
- Modify: `src/features/main/QueryPanel/logic/workspaceTabs.ts`
- Modify: `src/features/main/QueryPanel/index.tsx`
- Test: `tests/query-panel/workspaceTabs.test.ts`

- [x] **Step 1: 写失败测试，覆盖多 source workspace tabs 的顺序与激活回退**

```ts
test("workspace tabs: 多 source tab 混合显示时应按全局工作区顺序恢复", () => {
  // 不再只按 selectedSourceId 分桶恢复展示顺序。
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `node --test --experimental-strip-types tests/query-panel/workspaceTabs.test.ts`
Expected: FAIL with legacy source-bucket assumption

- [x] **Step 3: 实现新的工作区顺序模型，并让 QueryPanel 以全局 workspace 维度渲染**

```ts
type QueryWorkspaceOrderState = {
  tabOrder: string[];
};
```

- [x] **Step 4: 运行 Query 测试确认通过**

Run: `npm run test:query-panel`
Expected: PASS

### Task 12: 清理旧单数据源依赖并完成整体验证

**Files:**
- Modify: `src/features/main/QueryPanel/types.ts`
- Modify: `src/features/main/QueryPanel/hooks/useQueryPanelBindings.ts`
- Modify: `src/features/main/QueryPanel/hooks/useObjectTreeData.ts`
- Modify: `docs/superpowers/plans/2026-03-24-query-panel-multi-source-tree-implementation.md`

- [x] **Step 1: 清理不再作为核心业务语义的 selectedSourceId / selectedSourceType 依赖**

Checklist:
- QuerySidebar 不再依赖数据源下拉
- DataQuery / Console 关键操作以 tab.sourceId 为准
- 刷新以 focusedSourceId 为准

- [x] **Step 2: 运行完整验证**

Run: `npm run test:query-panel && npm run test:datagrid-utils && npm run build`
Expected: all PASS / build exit 0

- [x] **Step 3: 回填计划执行状态并整理交付说明**

Include:
- 左侧树交互与刷新行为
- Salesforce 重新认证行为
- 数据源颜色设置入口
- 剩余风险：MySQL `collations / users / virtual views` 的数据深度仍受后端接口约束

Current Delivery Notes:
- 左侧树交互与刷新行为：统一树侧栏已替换原数据源下拉；顶部刷新按钮仅刷新当前聚焦数据源，并按 sourceId 分桶维护展开、缓存与 loading 状态。
- Salesforce 重新认证行为：CLI Salesforce 数据源的 `list_objects` / `refresh_objects` 已在后端自动处理 401 后 token 刷新与请求重试；前端专用 retry wrapper 测试仍未单独补齐，因此 Task 8 保持未勾选。
- Salesforce 重新认证行为：`buildSalesforceRootChildren` 已支持通过 `withSalesforceSourceReauth` 包装器进入认证重试链路；左树会根据 `sf:token-refresh-start/end` 事件显示 `认证中` 状态，后端继续负责 CLI Salesforce 数据源的实际 token 刷新与重试。
- 数据源颜色设置入口：设置页的 Salesforce / MySQL 编辑表单已支持颜色编辑，颜色写入 `configJson.color`，左侧树节点与 tab 来源元信息可复用该值。
- 工作区与 Tab 绑定：对象 Tab 与控制台 Tab 均已改为永久绑定创建时数据源；工作区顺序改为全局 `tabOrder`，不再按 `selectedSourceId` 分桶恢复。
- 剩余风险：MySQL `collations / users / virtual views` 仍只有分组骨架，数据深度继续受后端接口能力约束。

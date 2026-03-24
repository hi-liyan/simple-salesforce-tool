# Reusable Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 抽离可复用多标签栏能力，并接入 QueryPanel、JsonFormatterTool、TerminalPanel，统一支持拖拽排序、右键菜单、双击重命名与状态持久化。

**Architecture:** 新增一个通用 tabs 模块，集中承载标签栏 UI、拖拽排序、右键菜单、重命名交互和 tab 顺序纯函数；各 panel 通过 adapter 把自己的业务 tab 映射为通用 tab 模型，同时各自 store 继续维护业务数据与持久化边界。QueryPanel 额外补一个轻量顺序持久化 store，Json/Terminal store 增加 `tabOrder` 与恢复逻辑。

**Tech Stack:** React 18、TypeScript、Zustand persist、dnd-kit、Node test runner

---

### Task 1: 补齐通用 tab 顺序逻辑测试

**Files:**
- Create: `tests/query-panel/tabOrder.test.ts`
- Create: `src/components/tabs/tabOrder.ts`

- [ ] **Step 1: 写失败测试，覆盖顺序恢复与重排**

```ts
test("normalizeTabOrder: 应保留有效顺序并追加缺失 tab", () => {
  const tabs = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(normalizeTabOrder(["c", "x", "a"], tabs), ["c", "a", "b"]);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test --experimental-strip-types tests/query-panel/tabOrder.test.ts`
Expected: FAIL with module/function not found

- [ ] **Step 3: 实现最小纯函数**

```ts
export function normalizeTabOrder<T extends { id: string }>(order: string[], tabs: T[]): string[] {
  // 过滤非法 id，并将缺失 tab 追加到末尾。
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test --experimental-strip-types tests/query-panel/tabOrder.test.ts`
Expected: PASS

### Task 2: 提取通用 tabs 组件与交互 hook

**Files:**
- Create: `src/components/tabs/types.ts`
- Create: `src/components/tabs/useTabBarState.ts`
- Create: `src/components/tabs/ReusableTabs.tsx`
- Modify: `src/features/main/QueryPanel/components/QueryWorkspaceTabs.tsx`

- [ ] **Step 1: 为 hook 纯逻辑补最小测试入口（如适合则继续在 tabOrder.test.ts 中补）**

```ts
test("getClosableTabIdsForSide: 应正确返回左侧/右侧/其他 tab id", () => {
  // 覆盖右键菜单批量关闭逻辑的纯函数。
});
```

- [ ] **Step 2: 运行测试确认新增断言先失败**

Run: `node --test --experimental-strip-types tests/query-panel/tabOrder.test.ts`
Expected: FAIL with expected mismatch

- [ ] **Step 3: 实现通用类型、纯函数与 hook，再实现通用组件**

```tsx
export function ReusableTabs(props: ReusableTabsProps) {
  // 统一渲染 tab、拖拽、右键菜单、双击重命名。
}
```

- [ ] **Step 4: 让 QueryWorkspaceTabs 退化为轻量 adapter 或直接改为转发通用组件**

```tsx
return <ReusableTabs tabs={mappedTabs} ... />;
```

- [ ] **Step 5: 运行相关测试**

Run: `node --test --experimental-strip-types tests/query-panel/tabOrder.test.ts tests/query-panel/workspaceTabs.test.ts`
Expected: PASS

### Task 3: 为 QueryPanel 增加工作区顺序持久化

**Files:**
- Create: `src/store/useQueryWorkspaceTabsStore.ts`
- Modify: `src/features/main/QueryPanel/hooks/useWorkspaceTabs.ts`
- Modify: `src/features/main/QueryPanel/hooks/useMainPageQueryPanel.ts`

- [ ] **Step 1: 为 Query 工作区顺序恢复写失败测试**

```ts
test("workspace tab order: 应按 sourceId 分桶恢复顺序", () => {
  // 使用纯函数或 store 恢复逻辑验证 source 隔离。
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test --experimental-strip-types tests/query-panel/tabOrder.test.ts`
Expected: FAIL with source 分桶恢复未实现

- [ ] **Step 3: 实现 Query 专用顺序持久化 store，并在 hook 中接入**

```ts
type QueryWorkspaceTabsState = {
  tabOrderBySourceId: Record<string, string[]>;
};
```

- [ ] **Step 4: 运行 Query 相关测试**

Run: `npm run test:query-panel`
Expected: PASS

### Task 4: 为 JsonFormatterTool 接入通用 tabs 并补齐顺序持久化

**Files:**
- Modify: `src/store/useJsonFormatterStore.ts`
- Modify: `src/features/main/ToolsPanel/components/JsonFormatterTool.tsx`

- [ ] **Step 1: 为 Json store 顺序恢复写失败测试**

```ts
test("json formatter store: 应按 tabOrder 输出 tabs，并在 active 无效时回退到首个 tab", () => {
  // 通过提取纯函数或 store merge 逻辑验证。
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test --experimental-strip-types tests/query-panel/tabOrder.test.ts`
Expected: FAIL with json 顺序恢复未实现

- [ ] **Step 3: 实现 Json store 的 `tabOrder`、恢复逻辑与通用 tabs 接入**

```ts
partialize: (state) => ({ tabs: state.tabs, activeTabId: state.activeTabId, tabOrder: state.tabOrder })
```

- [ ] **Step 4: 运行测试**

Run: `node --test --experimental-strip-types tests/query-panel/tabOrder.test.ts`
Expected: PASS

### Task 5: 为 TerminalPanel 接入通用 tabs 并增加 UI 持久化

**Files:**
- Modify: `src/store/useTerminalStore.ts`
- Modify: `src/features/main/TerminalPanel/index.tsx`
- Modify: `tests/query-panel/terminalStoreIsolation.test.ts`

- [ ] **Step 1: 先为 Terminal store 增加失败测试，覆盖持久化字段与 tab 操作**

```ts
test("Terminal store 应支持重命名、排序，并保持不暴露 source 维度状态", () => {
  // 验证新增 action 与全局独立性。
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test --experimental-strip-types tests/query-panel/terminalStoreIsolation.test.ts`
Expected: FAIL with action not found

- [ ] **Step 3: 为 Terminal store 增加 persist、tabOrder、rename/reorder action，并改造 TerminalPanel 接入通用 tabs**

```ts
export const useTerminalStore = create<TerminalState>()(
  persist(...)
);
```

- [ ] **Step 4: 运行终端与 Query 测试**

Run: `npm run test:query-panel`
Expected: PASS

### Task 6: 完整验证与收尾

**Files:**
- Modify: `docs/superpowers/plans/2026-03-24-reusable-tabs-implementation.md`

- [ ] **Step 1: 运行完整验证**

Run: `npm run test:query-panel && npm run test:datagrid-utils && npm run build`
Expected: all PASS / build exit 0

- [ ] **Step 2: 回填计划执行状态并检查关键需求**

Checklist:
- QueryPanel/TerminalPanel/JsonTool 都接入通用 tabs
- 支持多 tab
- 支持拖拽排序
- 支持 QueryPanel 风格右键菜单
- 支持双击重命名
- 支持状态持久化

- [ ] **Step 3: 准备交付说明**

Include:
- 关键改动概述
- 测试命令与结果
- 剩余风险或注意事项

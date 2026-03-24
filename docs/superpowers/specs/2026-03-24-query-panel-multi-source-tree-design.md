# QueryPanel 多数据源树形侧栏设计

## 背景

当前 QueryPanel 左侧侧栏基于单一 `selectedSourceId` 工作：

- 顶部通过数据源下拉切换当前数据源。
- 下方对象区仅展示当前数据源的对象列表。
- 右侧对象 Tab 与控制台 Tab 默认共享页面级当前数据源上下文。

这套模型不适合“同时浏览多个数据源并在右侧同时打开多个不同数据源 Tab”的目标，也无法满足数据库客户端风格的统一树形导航体验。

本次改造目标是将左侧改为“展示全部数据源”的树形结构，并将右侧 Tab 改为永久绑定创建时数据源的多上下文工作区。

## 已知约束

- 当前会话未提供 `mcp__ace-tool__search_context`，本设计基于仓库内等价全量代码检索完成。
- 当前会话不允许在未明确授权的情况下启用子代理，因此本次规格未执行自动 spec reviewer 子流程。
- 前后端代码和注释必须使用 UTF-8（无 BOM），EOL 为 LF。
- 前后端新增或修改代码必须补充中文注释。

## 目标

1. 左侧统一展示全部数据源，不再依赖顶部下拉切换数据源。
2. 左侧树按数据源类型渲染不同子节点结构。
3. 右侧对象 Tab 与控制台 Tab 永久绑定所属数据源。
4. 顶部刷新仅刷新一个数据源节点，不影响其他数据源。
5. Salesforce 数据源在展开加载时，按需触发当前数据源的重新认证逻辑。
6. 数据源支持在“设置 -> 数据源”中手动配置颜色，供左侧树与右侧未来多数据源 Tab 复用。

## 非目标

- 本期不将字段树、字段元数据树、MySQL 深层 DDL 分类节点完整迁入新树。
- 本期不自动为未设置颜色的数据源分配默认颜色。
- 本期不一次性替换全部旧对象树右键能力，只优先保留关键打开与刷新能力。
- 本期不取消数据源列表本身的排序能力。

## 现状摘要

### 左侧结构

- `src/features/main/QueryPanel/components/QuerySidebar.tsx`
  - 顶部动作按钮。
  - 数据源下拉 `DataSourceSelector`。
  - 下方 `QueryObjectTree` 仅展示当前数据源对象列表。

### 数据源上下文

- `src/features/main/QueryPanel/hooks/useSourceActions.ts`
  - `refreshSources()` 在显式刷新时会强刷当前 `selectedSourceId` 的对象缓存。
  - `handleSourceChange()` 通过修改全局 `selectedSourceId` 驱动整个 QueryPanel。

- `src/features/main/QueryPanel/types.ts`
  - `QueryPanelViewState` 中存在 `selectedSourceId`、`selectedSourceType`。
  - 右侧对象 Tab 与控制台逻辑普遍假设页面只有一个当前数据源。

### 右侧工作区

- `src/features/main/QueryPanel/index.tsx`
  - 左侧与右侧通过页面级 `selectedSourceId` 串联。
- `src/features/main/QueryPanel/components/DataQueryTabPane.tsx`
- `src/features/main/QueryPanel/components/SoqlExecutorWorkspace.tsx`
  - 查询、补全、describe、DDL 等逻辑均依赖当前页面数据源。

## 方案总览

本次改造采用“统一树框架 + 数据源类型节点提供器 + Tab 永久绑定数据源”的方案。

### 核心原则

- 左侧树只负责浏览、展开、加载和打开，不负责维护全局唯一当前数据源。
- 右侧每个 Tab 自带自己的数据源上下文，后续所有读写都走该上下文。
- 数据源的对象缓存、加载态、刷新态、认证态都按 `sourceId` 分桶管理。
- 视觉层允许数据源配置颜色，但仅在用户手动设置时生效。

## 交互设计

### 左侧树

- 始终显示全部数据源节点。
- 单击数据源名称：
  - 仅设置树内“聚焦数据源”或选中高亮。
  - 不触发页面级数据源切换。
- 点击箭头或双击数据源：
  - 展开或折叠该数据源节点。
  - 首次展开时按数据源类型加载其子节点。
- 单击对象节点：
  - 以当前对象所属 `sourceId` 新建或激活右侧对象 Tab。
- 单击控制台入口节点（若设计为树节点）：
  - 以当前数据源创建或激活控制台 Tab。

### 刷新

- 顶部刷新按钮仅刷新“当前聚焦的数据源节点”。
- 若当前无聚焦数据源，则刷新按钮禁用。
- 刷新时：
  - 仅该数据源节点前显示 loading。
  - 仅重建该数据源的树数据缓存。
  - 不关闭其他数据源展开态，不清空其他数据源缓存。

### Salesforce 重新认证

- 触发时机：
  - 展开 Salesforce 数据源并加载子节点时。
  - 某个已打开 Tab 后续执行查询或保存时，若接口返回认证失效，也走该 Tab 自身链路。
- 行为：
  - 在当前数据源加载链路中触发现有重新认证逻辑。
  - 认证成功后自动重试当前请求。
  - 认证失败时只影响当前数据源节点或当前 Tab，不影响其他数据源。

## 左侧树节点模型

建议新增统一树节点类型，例如：

```ts
type QueryTreeNode =
  | {
      id: string;
      kind: "source";
      sourceId: string;
      sourceType: string;
      sourceName: string;
      sourceColor?: string;
      label: string;
      expandable: true;
    }
  | {
      id: string;
      kind: "group";
      sourceId: string;
      groupType: string;
      label: string;
      count?: number;
      expandable: boolean;
    }
  | {
      id: string;
      kind: "object";
      sourceId: string;
      objectName: string;
      label: string;
      queryable?: boolean;
      expandable?: boolean;
    };
```

说明：

- `source` 节点用于表现数据源本体、颜色、loading 与刷新态。
- `group` 节点用于数据库客户端风格的中间分组层。
- `object` 节点用于右侧打开对象 Tab。
- 第一版不将字段节点纳入统一树模型。

## 数据源类型节点提供器

建议引入“节点提供器”或“树适配器”层，按数据源类型分别生成子节点。

### 抽象接口

建议新增类似接口：

```ts
type SourceTreeProvider = {
  buildRootChildren: (source: SalesforceSource, context: SourceTreeContext) => Promise<QueryTreeNode[]>;
  refreshSourceTree: (source: SalesforceSource, context: SourceTreeContext) => Promise<QueryTreeNode[]>;
};
```

其中 `context` 可提供：

- 当前 `queryClient`
- API 调用方法
- 认证重试包装器
- 已缓存对象列表与统计信息

### Salesforce 提供器

第一版行为：

- 展开后直接展示对象节点列表，必要时可保留单层逻辑分组。
- 加载对象列表时走当前 `sourceId` 的对象查询接口。
- 若加载过程提示需要认证：
  - 触发现有 Salesforce 重新认证能力。
  - 成功后自动重试对象加载。
- 对象节点支持：
  - 打开对象 Tab
  - 继承不可查询对象的提示逻辑

### MySQL 提供器

第一版行为：

- 展开 MySQL 数据源时生成以下分组节点：
  - `tables`
  - `collations`
  - `users`
  - `virtual views`
- `tables` 分组展开后展示表节点，支持打开对象 Tab。
- `collations / users / virtual views`：
  - 若已有可用 API，直接展示真实列表。
  - 若当前仅有统计或基础元数据，则先展示分组与数量，不伪造详情数据。

说明：

- 该结构刻意贴近数据库客户端的浏览习惯。
- 后续若支持更多数据库，可继续新增各自提供器。

## 状态模型改造

### 左侧树状态

建议新增按数据源分桶状态，例如：

```ts
type SourceTreeState = {
  focusedSourceId: string;
  expandedNodeIds: string[];
  sourceObjectsById: Record<string, SalesforceObject[]>;
  sourceTreeChildrenById: Record<string, QueryTreeNode[]>;
  sourceLoadingById: Record<string, boolean>;
  sourceRefreshingById: Record<string, boolean>;
  sourceErrorById: Record<string, string>;
  sourceAuthPendingById: Record<string, boolean>;
};
```

其中：

- `focusedSourceId` 仅用于刷新按钮和高亮，不代表全局查询上下文。
- `expandedNodeIds` 由树组件统一控制。
- `sourceTreeChildrenById` 缓存每个数据源展开后的树结构。

### 右侧 Tab 状态

需要将对象 Tab 与控制台 Tab 的持久化状态扩展为显式绑定数据源：

- 对象 Tab 至少补充：
  - `sourceId`
  - `sourceType`
  - `sourceName`
  - `sourceColor`
- 控制台 Tab 至少补充：
  - `sourceId`
  - `sourceType`
  - `sourceName`
  - `sourceColor`

影响：

- `DataQueryTabPane`
- `ConsoleTabPane`
- `SoqlExecutorWorkspace`
- Query 执行、DDL、describe、列可见性持久化、日志记录等逻辑都要改为优先使用 Tab 自身的 `sourceId`。

## QueryPanel 绑定层改造

### 视图状态

`QueryPanelViewState` 需要逐步从“单数据源上下文”转为“树 + 多 Tab 上下文”，建议：

- 弱化或移除 `selectedSourceId` / `selectedSourceType` 作为核心业务含义。
- 新增：
  - `focusedSourceId`
  - `sourceTreeState`
  - `sourceColorMap` 或直接从 `sources` 读取颜色

### 动作集合

`QueryPanelActions` 建议新增或调整：

- `onFocusSource(sourceId: string)`
- `onToggleSourceNode(sourceId: string)`
- `onRefreshFocusedSource()`
- `onOpenObjectFromSource(sourceId: string, objectItem: SalesforceObject)`
- `onOpenConsoleFromSource(sourceId: string)`

并逐步替换旧的：

- `onChangeSource`
- 基于全局当前数据源的刷新与控制台打开逻辑

## 设置页颜色配置

### 数据模型

建议在数据源配置中增加颜色字段，优先放入 `configJson`，避免立即扩大顶层字段变更面：

```ts
configJson: {
  ...existing,
  color?: string
}
```

同时新增前端读取辅助方法，例如：

- `getSourceColor(source: SalesforceSource): string`
- `setSourceColorToPayload(...)`

### UI 改造

在 `src/features/main/SettingsPanel/index.tsx` 的数据源编辑流程中增加颜色输入：

- Salesforce 编辑弹窗新增颜色项。
- MySQL 编辑弹窗新增颜色项。
- 数据源卡片列表可展示颜色预览。

约束：

- 不自动分配默认颜色。
- 用户未设置颜色时保持中性样式。

## 右侧 Tab 颜色预留

本期即使不完整重做右侧 Tab 样式，也要在数据结构中传递 `sourceColor`，确保后续实现时不必再次迁移数据模型。

应用位置：

- 左侧数据源节点色标。
- 右侧工作区 Tab 标题高亮或侧边色条。
- 未来控制台/对象 Tab 的来源识别。

## 第三方树组件

建议引入适合数据库客户端/文件树场景的树组件，例如 `react-arborist`。

选择原因：

- 支持自定义节点渲染。
- 支持受控展开状态。
- 支持树形缩进、箭头图标、键盘导航。
- 便于渲染 loading、颜色标识、数量徽标等数据库客户端风格元素。

## 兼容与迁移策略

### 第一阶段

- 保留现有右侧数据查询核心能力。
- 左侧先切换为统一树。
- Tab 创建时开始记录所属数据源。

### 第二阶段

- 逐步将对象查询、控制台执行、describe、DDL、日志等逻辑从页面级 `selectedSourceId` 迁移到 Tab 自身 `sourceId`。

### 第三阶段

- 清理旧的数据源下拉及相关单上下文依赖。
- 评估是否继续迁移字段树与更深层数据库对象节点。

## 测试策略

建议补充以下测试：

1. 左侧树状态测试
- 展开某个数据源只加载该数据源数据。
- 刷新某个聚焦数据源只影响该源缓存。
- 多个数据源展开互不干扰。

2. Tab 绑定测试
- 从数据源 A 打开的对象 Tab 永久绑定 A。
- 从数据源 B 打开的控制台 Tab 永久绑定 B。
- 打开多个不同数据源 Tab 后，执行查询不会串源。

3. 认证测试
- Salesforce 节点展开失败且提示重新认证时，会触发认证重试。
- 认证失败仅影响当前数据源节点。

4. 设置页颜色测试
- 编辑数据源颜色后重新加载能正确回显。
- 未设置颜色时保持无色状态。

## 风险

### 高风险

- 当前 QueryPanel 多处深度依赖 `selectedSourceId`，迁移为多 Tab 自带 `sourceId` 可能牵涉较大范围。
- 旧持久化快照若未兼容 `sourceId` 字段，恢复历史 Tab 时可能出现上下文缺失。

### 中风险

- MySQL 的 `collations / users / virtual views` 数据来源若当前后端未提供，需要先明确是否仅展示统计还是新增接口。
- Salesforce 重新认证链路若目前只服务于全局页面级上下文，需要额外封装为可供单数据源树节点复用的能力。

### 低风险

- 数据源颜色若暂存于 `configJson`，前端改造成本较低。

## 实施建议

建议按以下顺序实施：

1. 扩展数据源颜色配置与读取能力。
2. 引入统一树组件与树节点模型。
3. 实现 Salesforce / MySQL 树节点提供器。
4. 将左侧从下拉 + 单对象树切换为统一树。
5. 扩展对象 Tab / 控制台 Tab 的 `sourceId` 绑定字段。
6. 将查询与控制台执行链路改为以 Tab 自身 `sourceId` 为准。
7. 补测试并清理旧单数据源依赖。

## 待确认事项

1. MySQL 的 `collations / users / virtual views` 是否已有可用后端接口或元数据来源；若没有，本期是否允许先只展示分组与数量。
2. 顶部“控制台”按钮最终是：
   - 基于当前聚焦数据源打开控制台；
   - 还是移动到数据源节点级操作中。
3. 右侧历史快照迁移策略：
   - 是否允许旧快照首次恢复时按“缺少 sourceId 即不恢复”处理；
   - 还是需要做兼容迁移。

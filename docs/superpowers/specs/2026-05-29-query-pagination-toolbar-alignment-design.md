# QueryPaginationToolbar 与 QueryPanel 工具栏样式对齐设计

## 背景

当前 `QueryPaginationToolbar` 的翻页按钮仍使用独立的紧凑 `btn-ghost btn-xs` 样式，与 `QueryPanel` 右侧工作区工具栏中的统一按钮视觉和禁用提示行为不一致。

## 目标

1. 让分页工具栏中的首页、上一页、下一页、末页按钮与 `QueryPanel` 工具栏其余按钮保持一致的尺寸、圆角、hover 背景和禁用态视觉。
2. 保持现有分页可用/禁用判定逻辑不变，仍由 `buildQueryPaginationState` 的导航能力决定。
3. 让分页按钮在禁用时也能像 `QueryPanel` 其他工具栏按钮一样通过外层容器展示 `title`。

## 方案

1. 在 `QueryPaginationToolbar.tsx` 内新增仅供分页按钮复用的按钮包装器，结构与 `ToolbarActionButton` 一致。
2. 将四个翻页按钮的 className 调整为与 `DataQueryTabPane.tsx` 中 `toolbarIconButtonClassName` 对齐。
3. 保留 `select` 与范围文案的现有交互语义，仅做必要的结构收口，避免本次改动扩散到分页业务逻辑。
4. 为现有查询面板测试补充断言，先验证失败，再完成实现。

## 风险与边界

1. 本次不抽取公共工具栏按钮组件，避免扩大改动面。
2. 本次不调整 `page size` 下拉框样式策略，只对翻页按钮和禁用提示包装做一致化。

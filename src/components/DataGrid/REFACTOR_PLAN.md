# DataGrid 目录结构与职责说明

## 模块目标
1. `index.tsx` 只做装配与状态编排，不承载具体渲染细节。
2. `components/*` 负责 UI 结构与视图组合。
3. `hooks/*` 负责状态管理与副作用封装。
4. `logic/*` 负责业务规则与策略分发。
5. `renderers/*` 负责表格单元格/表头绘制逻辑。
6. `editors/*` 负责不同字段类型的编辑器 UI 与提交交互。
7. `utils/*` 负责纯函数工具，不依赖 React。
8. `types.ts` 统一定义 DataGrid 相关状态类型。

## 当前目录结构
```text
src/components/DataGrid/
├── index.tsx
├── types.ts
├── REFACTOR_PLAN.md
├── components/
│   ├── DataGridSurface.tsx
│   ├── HeaderMetaPopover.tsx
│   └── RowContextMenu.tsx
├── hooks/
│   ├── useDataGridColumns.ts
│   ├── useDataGridContextMenu.ts
│   ├── useDataGridMenuActions.ts
│   └── useHeaderMetaPopover.ts
├── logic/
│   ├── cellEditHandler.ts
│   ├── fieldTypeStrategy.ts
│   └── rowTheme.ts
├── renderers/
│   ├── drawHeader.ts
│   └── getCellContent.ts
├── editors/
│   ├── provideEditor.tsx
│   ├── dateTimeEditor.tsx
│   └── selectEditor.tsx
└── utils/
    ├── datetime.ts
    ├── field.ts
    ├── picklist.ts
    └── value.ts
```

## 目录职责
- `src/components/DataGrid/`
  - DataGrid 主模块根目录，统一承载入口、类型、计划文档与子模块分层。
- `src/components/DataGrid/components/`
  - 纯视图组件层，承载菜单、浮层、DataEditor 渲染容器等 UI 组合。
- `src/components/DataGrid/hooks/`
  - 状态与副作用层，管理列状态、菜单状态、浮层状态、菜单动作。
- `src/components/DataGrid/logic/`
  - 业务规则层，处理字段类型策略、编辑提交流程、行样式规则。
- `src/components/DataGrid/renderers/`
  - 渲染层，负责表格内容与表头绘制，不直接处理业务提交。
- `src/components/DataGrid/editors/`
  - 编辑器层，负责字段编辑 UI 与编辑结束交互。
- `src/components/DataGrid/utils/`
  - 工具层，纯函数集合，供逻辑层和渲染层复用。

## 文件职责
- `src/components/DataGrid/index.tsx`
  - DataGrid 入口装配文件。
  - 编排 hooks、renderers、logic、editors，向渲染层传递完整 props。

- `src/components/DataGrid/types.ts`
  - 定义 DataGrid 局部状态类型（如右键菜单状态、表头浮层状态）。

- `src/components/DataGrid/REFACTOR_PLAN.md`
  - DataGrid 重构规划与当前结构说明文档。

- `src/components/DataGrid/components/DataGridSurface.tsx`
  - DataEditor 视图容器。
  - 负责表格主体渲染、表头交互入口、右键菜单与元数据浮层挂载。

- `src/components/DataGrid/components/HeaderMetaPopover.tsx`
  - 表头字段元数据悬浮层组件。
  - 展示字段元信息明细并处理浮层 hover 区域。

- `src/components/DataGrid/components/RowContextMenu.tsx`
  - 行右键菜单组件。
  - 提供复制、设置 None、打开 Salesforce 记录页等动作入口。

- `src/components/DataGrid/hooks/useDataGridColumns.ts`
  - 管理列顺序、列宽、选择列状态与全选/半选状态。

- `src/components/DataGrid/hooks/useDataGridContextMenu.ts`
  - 管理右键菜单状态与全局关闭副作用（click/scroll/ESC）。

- `src/components/DataGrid/hooks/useDataGridMenuActions.ts`
  - 封装右键菜单动作副作用。
  - 包含复制单元格、置空单元格、打开 Salesforce 记录页。

- `src/components/DataGrid/hooks/useHeaderMetaPopover.ts`
  - 管理表头元数据浮层状态。
  - 处理浮层延迟关闭、hover 保持与计时器清理。

- `src/components/DataGrid/logic/cellEditHandler.ts`
  - 处理单元格编辑提交规则。
  - 包含字段可编辑校验、类型校验、错误提示与值归一化提交。

- `src/components/DataGrid/logic/fieldTypeStrategy.ts`
  - 统一字段类型策略分发。
  - 将 metadata 映射为 `picklist/date/datetime/number/boolean/text` 策略。

- `src/components/DataGrid/logic/rowTheme.ts`
  - 管理行级与单元格级主题样式策略。
  - 处理新增行、待删除行、脏数据、必填缺失高亮。

- `src/components/DataGrid/renderers/drawHeader.ts`
  - 处理表头绘制逻辑。
  - 包含选择列复选框绘制、字段双行标题绘制、info icon 命中判断。

- `src/components/DataGrid/renderers/getCellContent.ts`
  - 处理单元格读取渲染逻辑。
  - 根据字段策略返回对应 `GridCell`，并应用样式与显示值转换。

- `src/components/DataGrid/editors/provideEditor.tsx`
  - 编辑器分发器。
  - 根据字段策略选择 `select` 或 `date/datetime` 编辑器。

- `src/components/DataGrid/editors/dateTimeEditor.tsx`
  - 日期/日期时间编辑器实现。
  - 提供 Salesforce 风格日历面板、时间输入和确认/取消流程。

- `src/components/DataGrid/editors/selectEditor.tsx`
  - 下拉编辑器实现。
  - 用于 picklist 与 boolean 类型值选择和提交。

- `src/components/DataGrid/utils/datetime.ts`
  - 日期时间纯函数工具。
  - 涵盖时区解析、格式转换、日历构建、输入归一化。

- `src/components/DataGrid/utils/field.ts`
  - 字段元数据判断工具。
  - 提供字段类型判断、可编辑判断、创建必填判断。

- `src/components/DataGrid/utils/picklist.ts`
  - picklist 纯函数工具。
  - 处理选项提取、None 注入、显示值映射。

- `src/components/DataGrid/utils/value.ts`
  - 通用值处理纯函数工具。
  - 处理字符串/数字/布尔提取、空值判断与显示值转换。

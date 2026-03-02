# DateGrid 重构优化方案

## 重构目标
1. 组件职责单一：渲染、状态、业务逻辑、工具函数分离。
2. 类型驱动：不同字段类型（picklist/date/datetime/number/boolean/text）独立策略。
3. 可测试：纯函数（格式化、解析、元数据推断）可单测。
4. 渐进迁移：每一步可运行、可回滚，不一次性大爆炸。

## 建议目录结构
1. `src/components/DataGrid/index.tsx`
2. `src/components/DataGrid/types.ts`
3. `src/components/DataGrid/constants.ts`
4. `src/components/DataGrid/hooks/useDataGridColumns.ts`
5. `src/components/DataGrid/hooks/useDataGridContextMenu.ts`
6. `src/components/DataGrid/hooks/useHeaderMetaPopover.ts`
7. `src/components/DataGrid/renderers/getCellContent.ts`
8. `src/components/DataGrid/renderers/drawHeader.ts`
9. `src/components/DataGrid/editors/provideEditor.tsx`
10. `src/components/DataGrid/editors/dateTimeEditor.tsx`
11. `src/components/DataGrid/editors/selectEditor.tsx`
12. `src/components/DataGrid/logic/cellEditHandler.ts`
13. `src/components/DataGrid/logic/fieldTypeStrategy.ts`
14. `src/components/DataGrid/logic/rowTheme.ts`
15. `src/components/DataGrid/utils/datetime.ts`
16. `src/components/DataGrid/utils/picklist.ts`
17. `src/components/DataGrid/utils/value.ts`
18. `src/components/DataGrid/components/RowContextMenu.tsx`
19. `src/components/DataGrid/components/HeaderMetaPopover.tsx`

## 拆分原则（核心）
1. `index.tsx` 只做“装配”：拼 DataEditor、组装 props、挂菜单和浮层。
2. `renderers/*` 只负责画什么，不处理业务写入。
3. `logic/*` 只负责规则判断，例如是否可编辑、如何提交值。
4. `editors/*` 只负责编辑 UI 与草稿态。
5. `utils/*` 必须纯函数，不依赖 React 状态。
6. `fieldTypeStrategy.ts` 做统一分发：`date/datetime/picklist/...` 各走独立处理器。

## 建议迁移步骤（分 6 次提交）
1. 第1步：先抽 `types/constants/utils`，不改行为。
2. 第2步：抽 `datetime/picklist/value` 纯函数，替换原函数调用。
3. 第3步：抽 `getCellContent` 与 `cellEditHandler`。
4. 第4步：抽 `provideEditor` 和 `date/select` 编辑器组件。
5. 第5步：抽 `drawHeader`、`HeaderMetaPopover`、`RowContextMenu`。
6. 第6步：抽 hooks（columns/contextMenu/metaPopover），清理 `index.tsx`。

## 验收标准
1. `DataGrid/index.tsx` 控制在 250~350 行内。
2. 无功能回归：picklist/date/datetime/右键菜单/header info 全部一致。
3. `npm run build`、关键交互手测通过。
4. 纯函数覆盖测试至少：datetime 时区转换、picklist None、header label 组装。

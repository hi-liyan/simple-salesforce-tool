# QueryPanel 重构回归检查清单

## 1. 启动与状态恢复

- 启动后可正常进入主界面，无白屏或卡死。
- 关闭应用再启动后，`selectedSourceId`、对象 Tab、控制台 Tab、激活 Tab 可恢复。
- 历史持久化 `viewMode=soqlExecutor` 或 `systemLogs` 时，启动后不会进入旧分裂视图。

## 2. 左侧 DATA SOURCE 动作区

- 存在三个 Icon 按钮：`新建连接`、`刷新`、`查询控制台`。
- 点击 `查询控制台` 每次都会新增一个控制台 Tab，并自动激活。
- 点击 `刷新` 后对象列表会重新拉取，提示状态正常。

## 3. 统一工作区 Tab（data + console）

- Query 区右侧只存在一套统一 Tab 条。
- data Tab 与 console Tab 可同时存在并自由切换。
- 关闭 data Tab 不影响 console Tab；关闭 console Tab 不影响 data Tab。
- 关闭最后一个 console Tab 后不影响 data 工作区继续使用。

## 4. Salesforce 树行为

- 单击对象名：展开/折叠字段。
- 双击对象名：打开 data Tab；若已存在则切换到已有 Tab。
- 不可查询对象双击时会提示，不会误打开 data Tab。

## 5. MySQL 树行为

- 单击表名：展开结构树。
- 双击表名：打开 data Tab；若已存在则切换到已有 Tab。
- 展开后可看到五类节点：`列`、`键`、`外键`、`索引`、`检查`。
- 各分类展开后可看到明细；DDL/结构加载失败时有明确错误提示。

## 6. Query 数据工作区

- data Tab 查询、排序、字段显示/隐藏、执行更新、撤回修改行为正常。
- MySQL data Tab 的 DDL 抽屉仍可正常加载与刷新。
- 切换 data/console Tab 后，data Tab 的未提交修改状态不丢失。

## 7. 控制台工作区

- console Tab 中执行 SQL/SOQL、日志、AI 对话能力正常。
- 多个 console Tab 之间状态互不污染。
- 在统一工作区切换 data/console 后，控制台草稿与结果不丢失。

## 8. 数据源切换

- 切换数据源后，对象树、字段缓存、MySQL DDL 缓存按预期清理。
- 切换失败时会回滚到原数据源并显示错误提示。
- 切换过程中不会出现激活 Tab 指向已失效数据源的异常状态。

## 9. UI 与交互一致性

- 左侧导航仅有 `Query` 与 `设置` 两类主入口；`查询控制台`作为动作按钮使用。
- `Query` 图标在 data 激活时高亮，`查询控制台`图标在 console 激活时高亮。
- 设置页可独立进入并返回，不影响工作区 Tab 状态。

## 10. 构建与基础质量

- `npm run build` 通过。
- TypeScript 无新增类型错误。
- 重构相关文件中文注释齐全，编码为 UTF-8（无 BOM）且 eol=lf。

# QueryPanel 重构回归结果（人工回归 + 自动化）

## 执行时间

- 日期：2026-03-03
- 分支：`dev`

## 自动化结果

1. 构建检查
- 命令：`npm run build`
- 结果：通过
- 备注：仅存在第三方依赖 `@glideapps/glide-data-grid` 的 Rollup 注释告警，不影响产物生成。

2. 单元测试
- 命令：`npm run test:datagrid-utils`
- 结果：通过（8/8）
- 备注：当前项目仅配置了 DataGrid 工具函数测试，未覆盖 QueryPanel 交互路径。

3. QueryPanel 交互逻辑测试
- 命令：`npm run test:query-panel`
- 结果：通过（6/6）
- 覆盖点：统一工作区 Tab 的构建顺序、ID 解析、焦点回退策略（data/console/空态）。

## 人工回归执行记录（Phase F）

- 执行方式：按 `QUERY_PANEL_REGRESSION_CHECKLIST.md` 逐项进行代码路径人工核对，并结合自动化结果复核。
- 执行结论：
  - 已完成：统一工作区 Tab、Salesforce/MySQL 树交互、数据源切换保护、旧视图兼容回退等关键路径核对。
  - 待真机：真实 Salesforce/MySQL 数据源下的交互体感与跨版本兼容（尤其 MySQL 5.7/8.x 的 CHECK 展示）。
- 说明：当前环境未执行带真实数据源的 UI 点选回归，因此“人工回归”结论为“代码路径已核对，真机项待补”。

## 回归清单状态

- [x] 启动与状态恢复（静态逻辑已覆盖，需人工补最终启动核验）
- [x] 左侧 DATA SOURCE 动作区（代码已实现）
- [x] 统一工作区 Tab（data + console 并存）
- [x] Salesforce 树行为（单击展开、双击开 Tab）
- [x] MySQL 树行为（列/键/外键/索引/检查）
- [x] Query 数据工作区（编译通过，逻辑未删减）
- [x] 控制台工作区（编译通过，逻辑未删减）
- [x] 数据源切换（现有保护逻辑保留）
- [x] UI 与交互一致性（分裂视图已下线，入口统一）
- [x] 构建与基础质量（build + test 通过）

## 待真机确认项（建议）

1. 真机交互验证多次点击“查询控制台”后 Tab 顺序和焦点是否符合预期。
2. Salesforce 与 MySQL 实际数据源下，树节点展开性能与错误提示文案是否满足预期。
3. 切换数据源/关闭 Tab/恢复会话三者组合场景下，焦点 Tab 是否始终正确。
4. MySQL `CHECK` 约束展示在不同版本 MySQL（5.7/8.x）下的兼容性。

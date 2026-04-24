# SQLite v2 设计边界说明

## 1. 目标

SQLite v2 的目标不是继续修补 MySQL 可信编辑链路，而是把当前本地持久层从“历史兼容 + 单文件堆叠函数”演进为“可迁移、可扩展、可审计”的独立存储子系统。

本设计文档只定义边界、前置条件和拆分原则，不与当前 MySQL 主线功能混做。

## 2. 为什么要独立拆分

当前 [`src-tauri/src/db.rs`](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/db.rs) 同时承担了：

- 初始化 schema
- 旧版 `salesforce_sources` 到 `data_sources` 的兼容迁移
- source metadata cache 读写
- system logs 读写
- app settings 读写
- terminal command group / command 读写

这些职责已经跨越“初始化、迁移、业务读写、日志、终端配置”多个领域。如果继续把 SQLite v2 混进 MySQL 可信编辑主线，会让一次提交同时触发前端 CRUD、Tauri 命令、数据库 schema、兼容迁移四类风险，回归成本过高。

## 3. 本轮明确不做

SQLite v2 不进入 MySQL 可信编辑、日志语义修正、执行预览 SQL 展示的同一提交范围。本轮不做以下事项：

- 不改 `db.rs` 的 schema 版本管理机制
- 不做表拆分或模块化迁移
- 不改 token 存储方式
- 不做 system logs 新表或索引重建
- 不做 app settings / terminal commands 的存储模型重写

## 4. SQLite v2 设计范围

SQLite v2 后续应单独覆盖以下内容：

1. schema version 表与迁移脚本机制
2. `db.rs` 模块拆分策略
3. 数据源、缓存、日志、设置、终端命令的边界重组
4. 历史数据迁移与回滚策略
5. token / 敏感字段的存储安全策略
6. system logs / metadata cache 的索引与清理策略

## 5. 前置条件

只有在下面条件满足后，才启动 SQLite v2：

1. MySQL 可信编辑主链路稳定
2. Task 7 的系统日志语义修正完成并经过可用环境验证
3. 当前 `db.rs` 的真实职责与调用入口完成一次清点
4. 确认不会与正在进行的前端 CRUD / QueryPanel 改造混在同一发布窗口

## 6. 输出物

SQLite v2 后续执行时，至少需要同时维护两份文档：

- [`docs/sqlite-v2-design-2026-04-22.md`](/mnt/d/test-workspace/simple-salesforce-tool/docs/sqlite-v2-design-2026-04-22.md)
- [`docs/sqlite-v2-implementation-plan-2026-04-22.md`](/mnt/d/test-workspace/simple-salesforce-tool/docs/sqlite-v2-implementation-plan-2026-04-22.md)

前者负责设计边界与迁移原则，后者负责按 TDD 拆成可执行任务。

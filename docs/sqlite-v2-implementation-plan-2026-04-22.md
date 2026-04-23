# SQLite v2 Implementation Plan

**Goal:** 将当前本地 SQLite 持久层从混合职责的兼容实现，拆成具备 schema version、迁移能力和清晰模块边界的 v2 存储方案。

**Architecture:** 先冻结 MySQL 主线需求，完成 `db.rs` 现状梳理与数据分类，再引入版本化迁移入口，最后按“数据源 / 缓存 / 日志 / 设置 / 终端命令”拆分存储模块与迁移脚本。

**Tech Stack:** Rust、rusqlite、Tauri、SQLite

---

## 前置约束

1. 不与 MySQL QueryPanel / DataGrid / mysql_provider 改造混做。
2. 任何 schema 变更都必须先有迁移测试或最小迁移验证脚本。
3. 所有敏感字段策略都要在设计文档确认后再落库。

## 候选任务包

### Task A: 盘点当前 SQLite 职责与表结构

- 文件：
  - [`src-tauri/src/db.rs`](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/db.rs)
  - [`src-tauri/src/models.rs`](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/models.rs)
- 输出：
  - 表结构清单
  - 调用入口清单
  - 兼容迁移清单

### Task B: 设计 schema version 与迁移入口

- 文件：
  - `src-tauri/src/db.rs`
  - 可选新增 `src-tauri/src/db_migrations.rs`
- 输出：
  - 版本表
  - 幂等迁移执行入口
  - 失败回滚策略

### Task C: 按领域拆分存储模块

- 候选模块：
  - source repository
  - metadata cache repository
  - system log repository
  - app settings repository
  - terminal commands repository

### Task D: 敏感字段与清理策略

- 范围：
  - access token
  - LLM settings
  - system logs 保留策略
  - metadata cache 清理策略

## 验收标准

1. 新库初始化与旧库迁移都可重复执行
2. 历史数据不会因 v2 迁移静默丢失
3. 模块职责比当前 `db.rs` 更清晰
4. 对前端调用层接口保持兼容或给出明确迁移路径

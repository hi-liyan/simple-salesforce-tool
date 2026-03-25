# Terminal Panel UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 优化 TerminalPanel 的空间利用、运行态可见性与断连恢复体验，同时保持现有架构基本不变。

**Architecture:** 继续以 `src/features/main/TerminalPanel/index.tsx` 作为主要实现文件，只补一个轻量 UI 派生 helper 和少量通用 Tabs 菜单增强。命令库折叠、状态栏、重连提示与覆盖式编辑面板都在现有状态模型上增量实现，不改动终端后端会话模型。

**Tech Stack:** React 18、TypeScript、Zustand、node:test、Tailwind/DaisyUI、xterm、dnd-kit

---

### Task 1: 锁定 TerminalPanel UI 派生规则

**Files:**
- Create: `tests/terminal-panel/terminalPanelUiState.test.ts`
- Create: `src/features/main/TerminalPanel/uiState.ts`

- [ ] **Step 1: 写失败测试**
- [ ] **Step 2: 运行测试确认失败**
- [ ] **Step 3: 实现最小 helper 逻辑**
- [ ] **Step 4: 运行测试确认通过**

### Task 2: 改造 TerminalPanel 主界面

**Files:**
- Modify: `src/features/main/TerminalPanel/index.tsx`

- [ ] **Step 1: 接入命令库折叠状态与活动终端状态栏**
- [ ] **Step 2: 增加终端区 inline 断连/失败提示与重连动作**
- [ ] **Step 3: 把命令编辑改成覆盖式面板**
- [ ] **Step 4: 自检类型与交互收敛**

### Task 3: 补齐 Tabs 菜单重命名入口

**Files:**
- Modify: `src/components/tabs/ReusableTabs.tsx`

- [ ] **Step 1: 在右键菜单中补充重命名入口**
- [ ] **Step 2: 确认禁用态与现有重命名流程一致**

### Task 4: 验证

**Files:**
- Verify: `tests/terminal-panel/terminalPanelUiState.test.ts`
- Verify: `tests/query-panel/*.test.ts`

- [ ] **Step 1: 运行 `node --test --experimental-strip-types tests/terminal-panel/terminalPanelUiState.test.ts`**
- [ ] **Step 2: 运行 `npm run test:query-panel`**
- [ ] **Step 3: 运行 `npm run build`**

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildTerminalInlineNotice,
  buildTerminalStatusSummary,
  buildTerminalTabTooltip,
  type TerminalProcessMeta
} from "../../src/features/main/TerminalPanel/uiState.ts";

function createMeta(overrides?: Partial<TerminalProcessMeta>): TerminalProcessMeta {
  return {
    pid: 9527,
    commandLine: "powershell.exe -NoLogo",
    shellName: "PowerShell",
    shellVersion: "7.5.1",
    connected: true,
    opening: false,
    ...overrides
  };
}

test("buildTerminalStatusSummary: 应返回已连接终端的状态栏摘要", () => {
  const summary = buildTerminalStatusSummary(createMeta());

  assert.equal(summary.statusLabel, "运行中");
  assert.equal(summary.statusTone, "success");
  assert.equal(summary.pidText, "9527");
  assert.equal(summary.shellText, "PowerShell 7.5.1");
  assert.equal(summary.canReconnect, false);
  assert.equal("commandSummary" in summary, false);
});

test("buildTerminalStatusSummary: 应将创建失败终端标记为可重连错误态", () => {
  const summary = buildTerminalStatusSummary(
    createMeta({
      pid: null,
      commandLine: "会话创建失败: shell not found",
      shellName: "",
      shellVersion: "",
      connected: false,
      opening: false
    })
  );

  assert.equal(summary.statusLabel, "连接失败");
  assert.equal(summary.statusTone, "error");
  assert.equal(summary.canReconnect, true);
  assert.equal("commandSummary" in summary, false);
});

test("buildTerminalInlineNotice: 应为退出中的终端返回就地恢复提示", () => {
  const notice = buildTerminalInlineNotice(
    createMeta({
      connected: false,
      opening: false,
      commandLine: "进程已退出"
    })
  );

  assert.deepEqual(notice, {
    tone: "warning",
    title: "当前终端已断开",
    detail: "进程已退出",
    actionLabel: "重新连接"
  });
});

test("buildTerminalTabTooltip: 应按 tooltip 约定输出 PID、命令行与终端版本", () => {
  const tooltip = buildTerminalTabTooltip(createMeta());

  assert.equal(tooltip, "进程 ID (PID): 9527\n命令行: powershell.exe -NoLogo\n终端版本: PowerShell 7.5.1");
});

test("TerminalPanel: 不应再渲染顶部状态栏", () => {
  const source = readFileSync(new URL("../../src/features/main/TerminalPanel/index.tsx", import.meta.url), "utf8");

  assert.equal(source.includes("活动终端状态栏"), false);
  assert.equal(source.includes("activeTerminalStatus"), false);
});

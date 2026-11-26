// 终端状态点类型：与通用标签状态点保持一致。
export type TerminalStatusTone = "success" | "warning" | "error" | "idle";

// 单个终端 Tab 的进程元信息。
export type TerminalProcessMeta = {
  // 进程 PID。
  pid: number | null;
  // 启动命令行文本。
  commandLine: string;
  // 终端程序名称（如 PowerShell/bash）。
  shellName: string;
  // 终端程序版本文本。
  shellVersion: string;
  // 是否已连接到后端会话。
  connected: boolean;
  // 是否正在初始化。
  opening: boolean;
};

// 活动终端状态栏摘要。
export type TerminalStatusSummary = {
  // 连接状态文案。
  statusLabel: string;
  // 状态色。
  statusTone: TerminalStatusTone;
  // PID 文案。
  pidText: string;
  // Shell 文案。
  shellText: string;
  // 当前是否可重连。
  canReconnect: boolean;
};

// 终端区就地提示。
export type TerminalInlineNotice = {
  // 提示色调。
  tone: "warning" | "error";
  // 标题。
  title: string;
  // 详情。
  detail: string;
  // 动作文案。
  actionLabel: string;
};

// 构建活动终端状态栏摘要。
export function buildTerminalStatusSummary(processMeta?: TerminalProcessMeta | null): TerminalStatusSummary {
  const pidText = processMeta?.pid !== null && processMeta?.pid !== undefined ? String(processMeta.pid) : "-";
  const shellText = processMeta?.shellVersion ? `${processMeta.shellName || "Terminal"} ${processMeta.shellVersion}` : "-";
  const commandSummary = processMeta?.commandLine?.trim() || "-";

  if (processMeta?.opening) {
    return {
      statusLabel: "连接中",
      statusTone: "warning",
      pidText,
      shellText,
      canReconnect: false
    };
  }

  if (processMeta?.connected) {
    return {
      statusLabel: "运行中",
      statusTone: "success",
      pidText,
      shellText,
      canReconnect: false
    };
  }

  return {
    statusLabel: commandSummary.startsWith("会话创建失败") ? "连接失败" : "未连接",
    statusTone: commandSummary.startsWith("会话创建失败") ? "error" : "idle",
    pidText,
    shellText,
    canReconnect: Boolean(processMeta)
  };
}

// 构建终端标签 tooltip。
export function buildTerminalTabTooltip(processMeta?: TerminalProcessMeta | null): string {
  const pidText = processMeta?.pid !== null && processMeta?.pid !== undefined ? String(processMeta.pid) : "-";
  const shellText = processMeta?.shellVersion ? `${processMeta.shellName || "Terminal"} ${processMeta.shellVersion}` : "-";
  const commandSummary = processMeta?.commandLine?.trim() || "-";
  return `进程 ID (PID): ${pidText}\n命令行: ${commandSummary}\n终端版本: ${shellText}`;
}

// 构建终端区就地恢复提示。
export function buildTerminalInlineNotice(processMeta?: TerminalProcessMeta | null): TerminalInlineNotice | null {
  if (!processMeta || processMeta.connected || processMeta.opening) return null;

  if ((processMeta.commandLine || "").startsWith("会话创建失败")) {
    return {
      tone: "error",
      title: "终端创建失败",
      detail: processMeta.commandLine,
      actionLabel: "重新连接"
    };
  }

  return {
    tone: "warning",
    title: "当前终端已断开",
    detail: processMeta.commandLine || "终端进程已退出或尚未建立连接。",
    actionLabel: "重新连接"
  };
}

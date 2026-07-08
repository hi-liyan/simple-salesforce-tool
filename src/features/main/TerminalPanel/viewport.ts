// 终端容器最小矩形信息：仅依赖 fit 所需的宽高字段，便于测试替身复用。
type TerminalViewportRect = {
  width: number;
  height: number;
};

// 终端容器最小接口：供 xterm fit 前读取当前可见尺寸。
type TerminalViewportContainerLike = {
  getBoundingClientRect: () => TerminalViewportRect;
};

// fit 运行时最小接口：仅保留本模块真正使用的 cols/rows 与 fit 能力。
type TerminalViewportRuntimeLike = {
  terminal: {
    cols: number;
    rows: number;
  };
  fitAddon: {
    fit: () => void;
  };
};

// fit 结果：返回是否真的执行了 fit，以及 fit 后可用于 PTY 的最新 cols/rows。
export type TerminalViewportFitResult = {
  fitted: boolean;
  cols: number;
  rows: number;
};

// 终端视口尺寸：用于比较前后两次 cols/rows 是否变化。
export type TerminalViewportSize = {
  cols: number;
  rows: number;
};

// 终端建连前置条件：避免隐藏标签、监听未就绪时过早启动 PTY。
export type TerminalSessionOpenPolicyInput = {
  visible: boolean;
  active: boolean;
  hasContainer: boolean;
  listenersReady: boolean;
  opened: boolean;
  opening: boolean;
};

// 终端 resize 去重条件：只有真实尺寸变化时才同步到后端 PTY。
export type TerminalSessionResizePolicyInput = {
  fitted: boolean;
  opened: boolean;
  previous: TerminalViewportSize | null;
  next: TerminalViewportSize;
};

// 将 xterm 视口按当前容器尺寸执行一次 fit；隐藏态时跳过，避免得到错误列宽。
export function fitTerminalViewportToContainer(
  container: TerminalViewportContainerLike | null | undefined,
  runtime: TerminalViewportRuntimeLike
): TerminalViewportFitResult {
  if (!container) {
    return {
      fitted: false,
      cols: runtime.terminal.cols,
      rows: runtime.terminal.rows
    };
  }

  const rect = container.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return {
      fitted: false,
      cols: runtime.terminal.cols,
      rows: runtime.terminal.rows
    };
  }

  runtime.fitAddon.fit();
  return {
    fitted: true,
    cols: runtime.terminal.cols,
    rows: runtime.terminal.rows
  };
}

// 判断当前视口是否允许建立终端会话：仅激活、可见、容器存在且事件桥就绪时才建连。
export function shouldOpenTerminalSessionForViewport(input: TerminalSessionOpenPolicyInput): boolean {
  return Boolean(
    input.visible &&
      input.active &&
      input.hasContainer &&
      input.listenersReady &&
      !input.opened &&
      !input.opening
  );
}

// 判断本次 fit 结果是否需要同步 resize：避免同尺寸重复通知后端导致交互 CLI 重绘。
export function shouldResizeTerminalSessionForViewport(input: TerminalSessionResizePolicyInput): boolean {
  if (!input.fitted || !input.opened) {
    return false;
  }

  if (!input.previous) {
    return true;
  }

  return input.previous.cols !== input.next.cols || input.previous.rows !== input.next.rows;
}

import test from "node:test";
import assert from "node:assert/strict";
import * as terminalViewportModule from "../../src/features/main/TerminalPanel/viewport.ts";

const { fitTerminalViewportToContainer } = terminalViewportModule;

test("fitTerminalViewportToContainer: 容器可见时应先执行 fit 并返回最新 cols/rows", () => {
  const terminal = {
    cols: 80,
    rows: 24
  };
  let fitCalled = 0;
  const runtime = {
    terminal,
    fitAddon: {
      fit: () => {
        fitCalled += 1;
        terminal.cols = 118;
        terminal.rows = 32;
      }
    }
  };
  const container = {
    getBoundingClientRect: () => ({ width: 960, height: 640 })
  };

  const result = fitTerminalViewportToContainer(container, runtime);

  assert.equal(fitCalled, 1);
  assert.deepEqual(result, {
    fitted: true,
    cols: 118,
    rows: 32
  });
});

test("fitTerminalViewportToContainer: 容器不可见时不应执行 fit，且保留当前 cols/rows", () => {
  const runtime = {
    terminal: {
      cols: 80,
      rows: 24
    },
    fitAddon: {
      fit: () => {
        throw new Error("hidden container should not fit");
      }
    }
  };
  const container = {
    getBoundingClientRect: () => ({ width: 0, height: 640 })
  };

  const result = fitTerminalViewportToContainer(container, runtime);

  assert.deepEqual(result, {
    fitted: false,
    cols: 80,
    rows: 24
  });
});

test("Terminal viewport policy: 仅在可见激活且事件桥已就绪时才允许建立终端会话", () => {
  // 先验证新策略函数已暴露，避免隐藏标签过早建连问题再次回归。
  assert.equal(typeof terminalViewportModule.shouldOpenTerminalSessionForViewport, "function");
  if (typeof terminalViewportModule.shouldOpenTerminalSessionForViewport !== "function") {
    return;
  }

  assert.equal(
    terminalViewportModule.shouldOpenTerminalSessionForViewport({
      visible: true,
      active: true,
      hasContainer: true,
      listenersReady: true,
      opened: false,
      opening: false
    }),
    true
  );
  assert.equal(
    terminalViewportModule.shouldOpenTerminalSessionForViewport({
      visible: false,
      active: true,
      hasContainer: true,
      listenersReady: true,
      opened: false,
      opening: false
    }),
    false
  );
  assert.equal(
    terminalViewportModule.shouldOpenTerminalSessionForViewport({
      visible: true,
      active: false,
      hasContainer: true,
      listenersReady: true,
      opened: false,
      opening: false
    }),
    false
  );
  assert.equal(
    terminalViewportModule.shouldOpenTerminalSessionForViewport({
      visible: true,
      active: true,
      hasContainer: true,
      listenersReady: false,
      opened: false,
      opening: false
    }),
    false
  );
});

test("Terminal viewport policy: 仅在 cols 或 rows 变化时才向后端同步 resize", () => {
  // 先验证去重策略函数存在，避免重复 resize 触发交互 CLI 重绘窜行。
  assert.equal(typeof terminalViewportModule.shouldResizeTerminalSessionForViewport, "function");
  if (typeof terminalViewportModule.shouldResizeTerminalSessionForViewport !== "function") {
    return;
  }

  assert.equal(
    terminalViewportModule.shouldResizeTerminalSessionForViewport({
      fitted: true,
      opened: true,
      previous: {
        cols: 120,
        rows: 36
      },
      next: {
        cols: 120,
        rows: 36
      }
    }),
    false
  );
  assert.equal(
    terminalViewportModule.shouldResizeTerminalSessionForViewport({
      fitted: true,
      opened: false,
      previous: {
        cols: 120,
        rows: 36
      },
      next: {
        cols: 121,
        rows: 36
      }
    }),
    false
  );
  assert.equal(
    terminalViewportModule.shouldResizeTerminalSessionForViewport({
      fitted: true,
      opened: true,
      previous: {
        cols: 120,
        rows: 36
      },
      next: {
        cols: 121,
        rows: 36
      }
    }),
    true
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { fitTerminalViewportToContainer } from "../../src/features/main/TerminalPanel/viewport.ts";

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

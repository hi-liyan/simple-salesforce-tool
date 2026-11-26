import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { buildStoreSettingKey } from "../../src/store/tauriStorage.ts";

test("tauriStorage: 应按 store key 生成独立增量持久化键名", () => {
  assert.equal(buildStoreSettingKey("ui.app-store"), "zustand:ui.app-store");
  assert.equal(
    buildStoreSettingKey("ui.query-workspace-tabs-store"),
    "zustand:ui.query-workspace-tabs-store"
  );
});

test("workspaceSnapshot.ts 整包快照文件应已彻底下线删除", () => {
  const snapshotPath = new URL("../../src/store/workspaceSnapshot.ts", import.meta.url);
  assert.equal(existsSync(snapshotPath), false);
});

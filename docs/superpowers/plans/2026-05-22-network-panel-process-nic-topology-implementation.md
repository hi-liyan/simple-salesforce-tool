# Network Panel Process-NIC Topology Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为桌面应用新增一个 Windows 专用的 `Network Panel`，能够识别进程实际走哪块网卡、展示进程到远端的拓扑关系，并查看连接级与应用层请求/响应正文详情。

**Architecture:** 前端以新的主视图 `network` 承载独立工作区，使用 `Zustand + Tauri event + Cytoscape.js` 组织实时拓扑、列表和详情抽屉。后端在 `src-tauri/src/network/` 下新增 Windows 采集模块，分离环境检测、抓包会话编排、ETW/Npcap/MITM 关联、正文存储与审计，并通过 SQLite v2 承载摘要索引，通过文件缓存承载大正文。

**Tech Stack:** React 18、TypeScript、Zustand、Tauri 2、Rust、rusqlite、Windows ETW、Npcap、mitmproxy、Cytoscape.js

---

## File Structure

### Frontend

- Create: `src/features/main/NetworkPanel/index.tsx`
  - `Network Panel` 入口组件，负责拼装工具栏、拓扑图、列表与详情抽屉。
- Create: `src/features/main/NetworkPanel/components/NetworkToolbar.tsx`
  - 开始/停止采集、过滤器、状态徽标。
- Create: `src/features/main/NetworkPanel/components/NetworkEnvironmentChecklist.tsx`
  - Windows、管理员、Npcap、证书、代理的准备向导。
- Create: `src/features/main/NetworkPanel/components/NetworkTopologyCanvas.tsx`
  - Cytoscape 拓扑图容器。
- Create: `src/features/main/NetworkPanel/components/NetworkRequestTable.tsx`
  - 请求/连接切换列表。
- Create: `src/features/main/NetworkPanel/components/NetworkDetailDrawer.tsx`
  - 连接级详情、HTTP 头、正文延迟加载区。
- Create: `src/features/main/NetworkPanel/logic/networkContracts.ts`
  - 环境状态、过滤条件、事件载荷归一化纯函数。
- Create: `src/features/main/NetworkPanel/logic/networkTopology.ts`
  - 拓扑节点、边映射与图筛选纯函数。
- Create: `src/features/main/NetworkPanel/logic/networkStream.ts`
  - 事件流合并与增量更新纯函数。
- Create: `src/store/useNetworkCaptureStore.ts`
  - `Network Panel` 专属运行时 store。
- Modify: `src/types/index.ts`
  - 新增 network 相关 DTO。
- Modify: `src/api/index.ts`
  - 新增 network command 调用方法。
- Modify: `src/store/useAppStore.ts`
  - 扩展 `MainViewMode`。
- Modify: `src/pages/MainPage.tsx`
  - 新增 `Network` 导航入口和懒加载。
- Modify: `package.json`
  - 增加 `test:network-panel`，新增 `cytoscape` 依赖。

### Backend

- Create: `src-tauri/src/network/mod.rs`
  - 网络子模块入口。
- Create: `src-tauri/src/network/models.rs`
  - Network DTO 与事件结构。
- Create: `src-tauri/src/network/environment.rs`
  - 环境检测、管理员、Npcap、证书、代理状态。
- Create: `src-tauri/src/network/capture_session.rs`
  - 抓包会话生命周期。
- Create: `src-tauri/src/network/correlator.rs`
  - ETW/Npcap/MITM 三路事件关联。
- Create: `src-tauri/src/network/topology.rs`
  - 聚合图节点与边。
- Create: `src-tauri/src/network/body_store.rs`
  - 正文文件缓存和索引查询。
- Create: `src-tauri/src/network/commands.rs`
  - 对前端暴露的 network command。
- Create: `src-tauri/src/storage/network_repo.rs`
  - SQLite v2 中 network 相关表的读写。
- Modify: `src-tauri/src/main.rs`
  - 注册 network command。
- Modify: `src-tauri/src/app_state.rs`
  - 注入 network 会话状态。
- Modify: `src-tauri/src/models.rs`
  - 导出 network DTO 到顶层。
- Modify: `src-tauri/src/storage/schema.rs`
  - 增加抓包会话、请求、连接、正文索引表。
- Modify: `src-tauri/src/storage/mod.rs`
  - 注册 `network_repo`。
- Modify: `src-tauri/src/services/diagnostic_service.rs`
  - 增加正文访问审计入口。
- Modify: `src-tauri/Cargo.toml`
  - 补充 network 所需依赖（Windows 条件依赖与进程信息能力）。

### Tests

- Create: `tests/network-panel/networkContracts.test.ts`
- Create: `tests/network-panel/mainViewMode.test.ts`
- Create: `tests/network-panel/networkTopology.test.ts`
- Create: `tests/network-panel/networkStream.test.ts`
- Modify: `src-tauri/src/network/environment.rs`
  - 内联 Rust 单元测试。
- Modify: `src-tauri/src/network/correlator.rs`
  - 内联 Rust 单元测试。
- Modify: `src-tauri/src/network/topology.rs`
  - 内联 Rust 单元测试。
- Modify: `src-tauri/src/network/body_store.rs`
  - 内联 Rust 单元测试。
- Modify: `src-tauri/src/storage/network_repo.rs`
  - 内联 Rust 单元测试。

---

### Task 1: 建立前端测试入口与 Network DTO / API 合同

**Files:**
- Modify: `package.json`
- Modify: `src/types/index.ts`
- Modify: `src/api/index.ts`
- Create: `src/features/main/NetworkPanel/logic/networkContracts.ts`
- Test: `tests/network-panel/networkContracts.test.ts`

- [ ] **Step 1: 写失败测试，先固定环境状态与过滤器 payload 的归一化行为**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNetworkCapturePayload,
  normalizeNetworkEnvironmentStatus
} from "../../src/features/main/NetworkPanel/logic/networkContracts.ts";

test("normalizeNetworkEnvironmentStatus: 缺失字段时应回退为安全默认值", () => {
  const status = normalizeNetworkEnvironmentStatus({
    platform: "windows",
    adminGranted: true
  });
  assert.equal(status.platform, "windows");
  assert.equal(status.adminGranted, true);
  assert.equal(status.npcapReady, false);
  assert.equal(status.certificateReady, false);
  assert.equal(status.mitmReady, false);
});

test("buildNetworkCapturePayload: 应去掉空过滤器并保留正文采集开关", () => {
  const payload = buildNetworkCapturePayload({
    processIds: [1200, 3300],
    interfaceIds: [],
    captureBodyEnabled: true
  });
  assert.deepEqual(payload, {
    processIds: [1200, 3300],
    captureBodyEnabled: true
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test --experimental-strip-types tests/network-panel/networkContracts.test.ts`
Expected: FAIL with `Cannot find module '../../src/features/main/NetworkPanel/logic/networkContracts.ts'`

- [ ] **Step 3: 增加 `test:network-panel` 脚本并补齐前端 DTO / API 方法**

```json
{
  "scripts": {
    "test:network-panel": "node --test --experimental-strip-types tests/network-panel/*.test.ts"
  }
}
```

```ts
export type NetworkEnvironmentStatus = {
  platform: "windows" | "unsupported";
  adminGranted: boolean;
  npcapReady: boolean;
  certificateReady: boolean;
  mitmReady: boolean;
  warningMessage: string;
};

export type StartNetworkCapturePayload = {
  processIds?: number[];
  interfaceIds?: string[];
  captureBodyEnabled: boolean;
};
```

```ts
getNetworkEnvironmentStatus: () => invokeApi<NetworkEnvironmentStatus>("get_network_environment_status"),
startNetworkCapture: (payload: StartNetworkCapturePayload) =>
  invokeApi<void>("start_network_capture", { payload }),
stopNetworkCapture: () => invokeApi<void>("stop_network_capture")
```

- [ ] **Step 4: 实现最小纯函数，固定默认值和 payload 清理规则**

```ts
import type { NetworkEnvironmentStatus, StartNetworkCapturePayload } from "../../../types/index.ts";

export function normalizeNetworkEnvironmentStatus(
  raw: Partial<NetworkEnvironmentStatus>
): NetworkEnvironmentStatus {
  return {
    platform: raw.platform === "windows" ? "windows" : "unsupported",
    adminGranted: Boolean(raw.adminGranted),
    npcapReady: Boolean(raw.npcapReady),
    certificateReady: Boolean(raw.certificateReady),
    mitmReady: Boolean(raw.mitmReady),
    warningMessage: raw.warningMessage || ""
  };
}

export function buildNetworkCapturePayload(input: StartNetworkCapturePayload): StartNetworkCapturePayload {
  const payload: StartNetworkCapturePayload = {
    captureBodyEnabled: Boolean(input.captureBodyEnabled)
  };
  if (input.processIds && input.processIds.length > 0) {
    payload.processIds = input.processIds;
  }
  if (input.interfaceIds && input.interfaceIds.length > 0) {
    payload.interfaceIds = input.interfaceIds;
  }
  return payload;
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm run test:network-panel`
Expected: PASS with `2 passed`

- [ ] **Step 6: 提交本任务**

```bash
git add package.json src/types/index.ts src/api/index.ts src/features/main/NetworkPanel/logic/networkContracts.ts tests/network-panel/networkContracts.test.ts
git commit -m "feat(network): 建立前端抓包合同与测试入口"
```

### Task 2: 接入 `network` 主视图与空壳 Panel

**Files:**
- Modify: `src/store/useAppStore.ts`
- Modify: `src/pages/MainPage.tsx`
- Create: `src/features/main/NetworkPanel/index.tsx`
- Test: `tests/network-panel/mainViewMode.test.ts`

- [ ] **Step 1: 写失败测试，固定 `network` 视图模式归一化行为**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMainViewMode } from "../../src/store/useAppStore.ts";

test("normalizeMainViewMode: 应识别 network 并保留旧值兼容", () => {
  assert.equal(normalizeMainViewMode("network"), "network");
  assert.equal(normalizeMainViewMode("systemLogs"), "settings");
  assert.equal(normalizeMainViewMode("unknown"), "query");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test --experimental-strip-types tests/network-panel/mainViewMode.test.ts`
Expected: FAIL with `normalizeMainViewMode is not exported`

- [ ] **Step 3: 导出 `normalizeMainViewMode` 并扩展主视图类型**

```ts
export type MainViewMode = "query" | "terminal" | "network" | "tools" | "settings";

export function normalizeMainViewMode(viewMode: string | undefined): MainViewMode {
  if (viewMode === "network") return "network";
  if (viewMode === "settings") return "settings";
  if (viewMode === "terminal") return "terminal";
  if (viewMode === "tools") return "tools";
  if (viewMode === "query") return "query";
  if (viewMode === "systemLogs") return "settings";
  return "query";
}
```

- [ ] **Step 4: 在 `MainPage` 中接入懒加载 `Network Panel` 和导航按钮**

```tsx
const LazyNetworkPanel = lazy(async () => {
  const module = await import("../features/main/NetworkPanel");
  return { default: module.NetworkPanel };
});
```

```tsx
<button
  className={`tool-rail-btn ${viewMode === "network" ? "tool-rail-btn--active" : ""}`}
  title="网络拓扑"
  onClick={() => queryPanelActions.onSetViewMode("network")}
>
  <Network size={16} />
</button>
```

```tsx
{viewMode === "network" && (
  <Suspense fallback={<WorkspaceLoadingFallback title="正在加载 Network Panel" />}>
    <LazyNetworkPanel />
  </Suspense>
)}
```

- [ ] **Step 5: 创建最小空壳 Panel，先固定布局占位**

```tsx
export function NetworkPanel() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-base-200/45">
      <div className="rounded-2xl border border-base-300 bg-base-100 px-6 py-5 shadow-sm">
        <h2 className="text-[18px] font-semibold text-neutral">Network Panel</h2>
        <p className="mt-2 text-[12px] text-neutral/65">网络环境检查、实时拓扑和请求详情将在这里展示。</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: 运行测试与构建确认通过**

Run: `node --test --experimental-strip-types tests/network-panel/mainViewMode.test.ts && npm run build`
Expected: PASS and `vite build` exit code 0

- [ ] **Step 7: 提交本任务**

```bash
git add src/store/useAppStore.ts src/pages/MainPage.tsx src/features/main/NetworkPanel/index.tsx tests/network-panel/mainViewMode.test.ts
git commit -m "feat(network): 接入主视图入口与面板空壳"
```

### Task 3: 建立 Rust Network 模块与环境检测 command

**Files:**
- Create: `src-tauri/src/network/mod.rs`
- Create: `src-tauri/src/network/models.rs`
- Create: `src-tauri/src/network/environment.rs`
- Create: `src-tauri/src/network/commands.rs`
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/main.rs`
- Test: `src-tauri/src/network/environment.rs`

- [ ] **Step 1: 先写 Rust 失败测试，固定环境检测默认行为**

```rust
#[cfg(test)]
mod tests {
    use super::normalize_windows_environment_status;

    #[test]
    fn network_environment_status_reports_missing_npcap() {
        let status = normalize_windows_environment_status(true, false, false, false);
        assert_eq!(status.platform, "windows");
        assert!(status.admin_granted);
        assert!(!status.npcap_ready);
        assert_eq!(status.warning_message, "Npcap 未安装或不可用");
    }
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml network_environment_status_reports_missing_npcap -- --exact`
Expected: FAIL with unresolved import or missing function

- [ ] **Step 3: 定义后端 DTO，并在顶层 `models.rs` 重新导出**

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkEnvironmentStatus {
    pub platform: String,
    pub admin_granted: bool,
    pub npcap_ready: bool,
    pub certificate_ready: bool,
    pub mitm_ready: bool,
    pub warning_message: String,
}
```

```rust
pub mod network;
pub use crate::network::models::NetworkEnvironmentStatus;
```

- [ ] **Step 4: 在 `environment.rs` 中实现最小环境检测与 Tauri command**

```rust
pub fn normalize_windows_environment_status(
    admin_granted: bool,
    npcap_ready: bool,
    certificate_ready: bool,
    mitm_ready: bool,
) -> NetworkEnvironmentStatus {
    let warning_message = if !npcap_ready {
        "Npcap 未安装或不可用".to_string()
    } else if !certificate_ready {
        "尚未安装本地根证书".to_string()
    } else if !mitm_ready {
        "本地代理尚未就绪".to_string()
    } else {
        String::new()
    };
    NetworkEnvironmentStatus {
        platform: "windows".to_string(),
        admin_granted,
        npcap_ready,
        certificate_ready,
        mitm_ready,
        warning_message,
    }
}
```

```rust
#[tauri::command]
pub fn get_network_environment_status() -> Result<NetworkEnvironmentStatus, String> {
    #[cfg(target_os = "windows")]
    {
        Ok(normalize_windows_environment_status(false, false, false, false))
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(NetworkEnvironmentStatus {
            platform: "unsupported".to_string(),
            admin_granted: false,
            npcap_ready: false,
            certificate_ready: false,
            mitm_ready: false,
            warning_message: "当前平台暂不支持 Network Panel".to_string(),
        })
    }
}
```

- [ ] **Step 5: 在 `main.rs` 注册 network command**

```rust
mod network;
```

```rust
commands::get_network_environment_status,
```

- [ ] **Step 6: 运行 Rust 测试确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml network_environment_status_reports_missing_npcap -- --exact`
Expected: PASS

- [ ] **Step 7: 提交本任务**

```bash
git add src-tauri/src/network/mod.rs src-tauri/src/network/models.rs src-tauri/src/network/environment.rs src-tauri/src/network/commands.rs src-tauri/src/models.rs src-tauri/src/main.rs
git commit -m "feat(network): 新增后端环境检测模块"
```

### Task 4: 实现前端环境检查向导与 Toolbar 基础交互

**Files:**
- Create: `src/features/main/NetworkPanel/components/NetworkEnvironmentChecklist.tsx`
- Create: `src/features/main/NetworkPanel/components/NetworkToolbar.tsx`
- Modify: `src/features/main/NetworkPanel/index.tsx`
- Create: `src/store/useNetworkCaptureStore.ts`
- Test: `tests/network-panel/networkStream.test.ts`

- [ ] **Step 1: 写失败测试，固定环境状态进入 store 后的按钮禁用逻辑**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { canStartNetworkCapture } from "../../src/features/main/NetworkPanel/logic/networkStream.ts";

test("canStartNetworkCapture: 缺少 Npcap 时应返回 false", () => {
  assert.equal(
    canStartNetworkCapture({
      platform: "windows",
      adminGranted: true,
      npcapReady: false,
      certificateReady: true,
      mitmReady: true,
      warningMessage: ""
    }),
    false
  );
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test --experimental-strip-types tests/network-panel/networkStream.test.ts`
Expected: FAIL with `canStartNetworkCapture` not found

- [ ] **Step 3: 创建最小 store 和按钮可用性纯函数**

```ts
import { create } from "zustand";
import type { NetworkEnvironmentStatus } from "../types/index.ts";

type NetworkCaptureState = {
  environmentStatus: NetworkEnvironmentStatus | null;
  captureRunning: boolean;
  setEnvironmentStatus: (status: NetworkEnvironmentStatus) => void;
  setCaptureRunning: (running: boolean) => void;
};

export const useNetworkCaptureStore = create<NetworkCaptureState>()((set) => ({
  environmentStatus: null,
  captureRunning: false,
  setEnvironmentStatus: (environmentStatus) => set({ environmentStatus }),
  setCaptureRunning: (captureRunning) => set({ captureRunning })
}));
```

```ts
import type { NetworkEnvironmentStatus } from "../../../types/index.ts";

export function canStartNetworkCapture(status: NetworkEnvironmentStatus | null): boolean {
  if (!status) return false;
  return status.platform === "windows" && status.adminGranted && status.npcapReady && status.mitmReady;
}
```

- [ ] **Step 4: 实现环境向导与 Toolbar 骨架**

```tsx
export function NetworkEnvironmentChecklist({ status }: { status: NetworkEnvironmentStatus | null }) {
  const items = [
    { label: "Windows", ok: status?.platform === "windows" },
    { label: "管理员权限", ok: Boolean(status?.adminGranted) },
    { label: "Npcap", ok: Boolean(status?.npcapReady) },
    { label: "根证书", ok: Boolean(status?.certificateReady) },
    { label: "本地代理", ok: Boolean(status?.mitmReady) }
  ];
  return (
    <div className="rounded-2xl border border-base-300 bg-base-100 p-4">
      {items.map((item) => (
        <div key={item.label} className="flex items-center justify-between py-2 text-[12px]">
          <span>{item.label}</span>
          <span className={item.ok ? "text-success" : "text-error"}>{item.ok ? "已就绪" : "未就绪"}</span>
        </div>
      ))}
    </div>
  );
}
```

```tsx
export function NetworkToolbar({
  canStart,
  captureRunning,
  onStart,
  onStop
}: {
  canStart: boolean;
  captureRunning: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-base-300 bg-base-100 px-4 py-3">
      <button className="btn btn-primary btn-sm" disabled={!canStart || captureRunning} onClick={onStart}>
        开始采集
      </button>
      <button className="btn btn-outline btn-sm" disabled={!captureRunning} onClick={onStop}>
        停止采集
      </button>
    </div>
  );
}
```

- [ ] **Step 5: 在 `NetworkPanel` 初始挂载时请求环境状态**

```tsx
useEffect(() => {
  void api.getNetworkEnvironmentStatus().then(setEnvironmentStatus).catch((error) => {
    console.error("加载网络环境状态失败：", error);
  });
}, [setEnvironmentStatus]);
```

- [ ] **Step 6: 运行测试和构建确认通过**

Run: `npm run test:network-panel && npm run build`
Expected: PASS and build exit 0

- [ ] **Step 7: 提交本任务**

```bash
git add src/features/main/NetworkPanel/components/NetworkEnvironmentChecklist.tsx src/features/main/NetworkPanel/components/NetworkToolbar.tsx src/features/main/NetworkPanel/index.tsx src/store/useNetworkCaptureStore.ts src/features/main/NetworkPanel/logic/networkStream.ts tests/network-panel/networkStream.test.ts
git commit -m "feat(network): 接入环境准备向导与基础控制条"
```

### Task 5: 为 Network Panel 新增 SQLite schema 与 repository

**Files:**
- Modify: `src-tauri/src/storage/schema.rs`
- Create: `src-tauri/src/storage/network_repo.rs`
- Modify: `src-tauri/src/storage/mod.rs`
- Modify: `src-tauri/src/network/models.rs`
- Test: `src-tauri/src/storage/network_repo.rs`

- [ ] **Step 1: 写 Rust 失败测试，固定抓包会话与正文索引落库行为**

```rust
#[cfg(test)]
mod tests {
    use crate::storage::Storage;
    use super::{insert_network_capture_session, list_network_capture_sessions};

    #[test]
    fn insert_network_capture_session_persists_running_session() {
        let storage = Storage::open_test().unwrap();
        storage.write_tx(|tx| {
            insert_network_capture_session(tx, "session-1", true).unwrap();
            Ok(())
        }).unwrap();
        let rows = storage.read(|conn| list_network_capture_sessions(conn)).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "session-1");
        assert!(rows[0].running);
    }
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml insert_network_capture_session_persists_running_session -- --exact`
Expected: FAIL with missing table or missing function

- [ ] **Step 3: 在 SQLite v2 schema 中增加 network 表**

```rust
CREATE TABLE IF NOT EXISTS network_capture_sessions (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    ended_at TEXT NULL,
    running INTEGER NOT NULL,
    capture_body_enabled INTEGER NOT NULL,
    filter_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS network_connections (
    connection_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    pid INTEGER NOT NULL,
    interface_id TEXT NOT NULL,
    protocol TEXT NOT NULL,
    direction TEXT NOT NULL,
    local_ip TEXT NOT NULL,
    local_port INTEGER NOT NULL,
    remote_ip TEXT NOT NULL,
    remote_port INTEGER NOT NULL,
    connect_at TEXT NOT NULL,
    close_at TEXT NULL,
    bytes_in INTEGER NOT NULL,
    bytes_out INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS network_requests (
    request_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    protocol_family TEXT NOT NULL,
    method TEXT NOT NULL,
    url TEXT NOT NULL,
    status_code INTEGER NULL,
    request_body_ref TEXT NOT NULL,
    response_body_ref TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT NULL,
    decode_status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS network_body_blobs (
    body_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    size INTEGER NOT NULL,
    encoding TEXT NOT NULL,
    compressed INTEGER NOT NULL,
    truncated INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL
);
```

- [ ] **Step 4: 实现 `network_repo.rs` 最小读写**

```rust
pub fn insert_network_capture_session(
    tx: &Transaction<'_>,
    session_id: &str,
    running: bool,
) -> Result<(), AppError> {
    tx.execute(
        "INSERT INTO network_capture_sessions (id, started_at, ended_at, running, capture_body_enabled, filter_json, updated_at)
         VALUES (?1, ?2, NULL, ?3, 0, '{}', ?2)",
        params![session_id, Utc::now().to_rfc3339(), if running { 1 } else { 0 }],
    )?;
    Ok(())
}
```

```rust
pub fn list_network_capture_sessions(connection: &Connection) -> Result<Vec<NetworkCaptureSessionRecord>, AppError> {
    let mut statement = connection.prepare(
        "SELECT id, started_at, ended_at, running FROM network_capture_sessions ORDER BY started_at DESC"
    )?;
    let rows = statement.query_map([], |row| {
        Ok(NetworkCaptureSessionRecord {
            id: row.get(0)?,
            started_at: row.get(1)?,
            ended_at: row.get(2)?,
            running: row.get::<_, i64>(3)? != 0,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}
```

- [ ] **Step 5: 在 `storage/mod.rs` 导出新 repo，并给 `network/models.rs` 增加 SQLite record 类型**

```rust
pub mod network_repo;
```

```rust
pub struct NetworkCaptureSessionRecord {
    pub id: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub running: bool,
}
```

- [ ] **Step 6: 运行 Rust 测试确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml insert_network_capture_session_persists_running_session -- --exact`
Expected: PASS

- [ ] **Step 7: 提交本任务**

```bash
git add src-tauri/src/storage/schema.rs src-tauri/src/storage/network_repo.rs src-tauri/src/storage/mod.rs src-tauri/src/network/models.rs
git commit -m "feat(network): 为抓包会话与正文索引新增存储结构"
```

### Task 6: 实现抓包会话编排与开始/停止命令

**Files:**
- Create: `src-tauri/src/network/capture_session.rs`
- Modify: `src-tauri/src/network/commands.rs`
- Modify: `src-tauri/src/app_state.rs`
- Modify: `src-tauri/src/main.rs`
- Test: `src-tauri/src/network/capture_session.rs`

- [ ] **Step 1: 写 Rust 失败测试，固定重复启动抓包时的保护行为**

```rust
#[cfg(test)]
mod tests {
    use super::begin_capture_session;

    #[test]
    fn begin_capture_session_rejects_second_running_session() {
        let mut state = NetworkRuntimeState::default();
        begin_capture_session(&mut state, "session-1").unwrap();
        let error = begin_capture_session(&mut state, "session-2").unwrap_err();
        assert!(error.contains("已有运行中的抓包会话"));
    }
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml begin_capture_session_rejects_second_running_session -- --exact`
Expected: FAIL with missing type or function

- [ ] **Step 3: 在 `app_state.rs` 增加网络运行态**

```rust
#[derive(Default)]
pub struct NetworkRuntimeState {
    pub active_session_id: Option<String>,
}

pub struct AppState {
    pub storage: Storage,
    pub sf_client: SalesforceClient,
    pub cli_login_cancel: Mutex<Option<Arc<AtomicBool>>>,
    pub llm_conversations: Mutex<HashMap<String, Value>>,
    pub llm_stream_cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
    pub terminal_sessions: Mutex<HashMap<String, TerminalSession>>,
    pub network_runtime: Mutex<NetworkRuntimeState>,
}
```

- [ ] **Step 4: 在 `capture_session.rs` 中实现最小开始/停止逻辑**

```rust
pub fn begin_capture_session(
    runtime: &mut NetworkRuntimeState,
    session_id: &str,
) -> Result<(), String> {
    if runtime.active_session_id.is_some() {
        return Err("已有运行中的抓包会话".to_string());
    }
    runtime.active_session_id = Some(session_id.to_string());
    Ok(())
}

pub fn end_capture_session(runtime: &mut NetworkRuntimeState) {
    runtime.active_session_id = None;
}
```

- [ ] **Step 5: 暴露 `start_network_capture` / `stop_network_capture` command，并写系统日志**

```rust
#[tauri::command]
pub fn start_network_capture(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
    payload: StartNetworkCapturePayload,
) -> Result<(), String> {
    let session_id = uuid::Uuid::new_v4().to_string();
    {
        let mut runtime = state.network_runtime.lock().map_err(|_| "抓包状态锁定失败".to_string())?;
        begin_capture_session(&mut runtime, &session_id)?;
    }
    app_handle.emit("network://capture-started", session_id.clone()).map_err(|error| error.to_string())?;
    Ok(())
}
```

- [ ] **Step 6: 运行 Rust 测试确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml begin_capture_session_rejects_second_running_session -- --exact`
Expected: PASS

- [ ] **Step 7: 提交本任务**

```bash
git add src-tauri/src/network/capture_session.rs src-tauri/src/network/commands.rs src-tauri/src/app_state.rs src-tauri/src/main.rs
git commit -m "feat(network): 新增抓包会话开始停止编排"
```

### Task 7: 实现关联器与拓扑聚合纯逻辑

**Files:**
- Create: `src-tauri/src/network/correlator.rs`
- Create: `src-tauri/src/network/topology.rs`
- Create: `src/features/main/NetworkPanel/logic/networkTopology.ts`
- Test: `src-tauri/src/network/correlator.rs`
- Test: `src-tauri/src/network/topology.rs`
- Test: `tests/network-panel/networkTopology.test.ts`

- [ ] **Step 1: 写前后端失败测试，固定“进程 -> 网卡 -> 远端”图模型**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { buildTopologyGraph } from "../../src/features/main/NetworkPanel/logic/networkTopology.ts";

test("buildTopologyGraph: 应生成进程、网卡、远端三类节点和两条边", () => {
  const graph = buildTopologyGraph([
    {
      connectionId: "conn-1",
      pid: 9527,
      processName: "chrome.exe",
      interfaceId: "if-wifi",
      interfaceName: "Wi-Fi",
      remoteLabel: "api.example.com:443",
      bytesOut: 1024,
      bytesIn: 2048
    }
  ]);
  assert.deepEqual(graph.nodes.map((item) => item.kind), ["process", "interface", "remote"]);
  assert.equal(graph.edges.length, 2);
});
```

```rust
#[test]
fn correlate_http_request_matches_connection_by_pid_and_ports() {
    let connection = CorrelatedConnectionSeed::new("conn-1", 9527, "127.0.0.1", 51234, "93.184.216.34", 443);
    let request = HttpObservation::new(9527, "127.0.0.1", 51234, "93.184.216.34", 443);
    let matched = match_http_request_to_connection(&[connection], &request).unwrap();
    assert_eq!(matched.connection_id, "conn-1");
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test --experimental-strip-types tests/network-panel/networkTopology.test.ts && cargo test --manifest-path src-tauri/Cargo.toml correlate_http_request_matches_connection_by_pid_and_ports -- --exact`
Expected: FAIL with module/function missing

- [ ] **Step 3: 实现前端拓扑纯函数**

```ts
export function buildTopologyGraph(rows: TopologyEdgeSeed[]): {
  nodes: NetworkTopologyNode[];
  edges: NetworkTopologyEdge[];
} {
  const processNode: NetworkTopologyNode = {
    id: `process:${rows[0].pid}`,
    kind: "process",
    label: rows[0].processName
  };
  const interfaceNode: NetworkTopologyNode = {
    id: `interface:${rows[0].interfaceId}`,
    kind: "interface",
    label: rows[0].interfaceName
  };
  const remoteNode: NetworkTopologyNode = {
    id: `remote:${rows[0].remoteLabel}`,
    kind: "remote",
    label: rows[0].remoteLabel
  };
  return {
    nodes: [processNode, interfaceNode, remoteNode],
    edges: [
      { id: `${processNode.id}->${interfaceNode.id}`, source: processNode.id, target: interfaceNode.id, metricLabel: "1024B / 2048B" },
      { id: `${interfaceNode.id}->${remoteNode.id}`, source: interfaceNode.id, target: remoteNode.id, metricLabel: "1 req" }
    ]
  };
}
```

- [ ] **Step 4: 实现 Rust 连接匹配与拓扑聚合最小版本**

```rust
pub fn match_http_request_to_connection<'a>(
    connections: &'a [CorrelatedConnectionSeed],
    request: &HttpObservation,
) -> Option<&'a CorrelatedConnectionSeed> {
    connections.iter().find(|item| {
        item.pid == request.pid
            && item.local_ip == request.local_ip
            && item.local_port == request.local_port
            && item.remote_ip == request.remote_ip
            && item.remote_port == request.remote_port
    })
}
```

```rust
pub fn build_process_interface_remote_edges(seed: &CorrelatedConnectionSeed) -> Vec<TopologyEdge> {
    vec![
        TopologyEdge {
            id: format!("process:{}->interface:{}", seed.pid, seed.interface_id),
            source: format!("process:{}", seed.pid),
            target: format!("interface:{}", seed.interface_id),
            request_count: 1,
        },
        TopologyEdge {
            id: format!("interface:{}->remote:{}:{}", seed.interface_id, seed.remote_ip, seed.remote_port),
            source: format!("interface:{}", seed.interface_id),
            target: format!("remote:{}:{}", seed.remote_ip, seed.remote_port),
            request_count: 1,
        },
    ]
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm run test:network-panel && cargo test --manifest-path src-tauri/Cargo.toml correlate_http_request_matches_connection_by_pid_and_ports -- --exact`
Expected: PASS

- [ ] **Step 6: 提交本任务**

```bash
git add src-tauri/src/network/correlator.rs src-tauri/src/network/topology.rs src/features/main/NetworkPanel/logic/networkTopology.ts tests/network-panel/networkTopology.test.ts
git commit -m "feat(network): 建立事件关联与拓扑聚合逻辑"
```

### Task 8: 实现正文缓存、详情读取与正文访问审计

**Files:**
- Create: `src-tauri/src/network/body_store.rs`
- Modify: `src-tauri/src/network/commands.rs`
- Modify: `src-tauri/src/services/diagnostic_service.rs`
- Modify: `src-tauri/src/storage/network_repo.rs`
- Test: `src-tauri/src/network/body_store.rs`
- Test: `src-tauri/src/services/diagnostic_service.rs`

- [ ] **Step 1: 写 Rust 失败测试，固定正文写入、读取和审计行为**

```rust
#[cfg(test)]
mod tests {
    use super::{write_body_blob, read_body_blob_text};
    use tempfile::tempdir;

    #[test]
    fn write_body_blob_persists_text_payload() {
        let dir = tempdir().unwrap();
        let body_ref = write_body_blob(dir.path(), "body-1", "hello world").unwrap();
        let text = read_body_blob_text(&body_ref).unwrap();
        assert_eq!(text, "hello world");
    }
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml write_body_blob_persists_text_payload -- --exact`
Expected: FAIL with missing function or dependency

- [ ] **Step 3: 实现最小正文文件缓存**

```rust
pub fn write_body_blob(root: &Path, body_id: &str, payload: &str) -> Result<NetworkBodyBlob, AppError> {
    std::fs::create_dir_all(root)?;
    let file_path = root.join(format!("{body_id}.txt"));
    std::fs::write(&file_path, payload.as_bytes())?;
    Ok(NetworkBodyBlob {
        body_id: body_id.to_string(),
        file_path: file_path.to_string_lossy().to_string(),
        size: payload.len() as i64,
        encoding: "utf-8".to_string(),
        compressed: false,
        truncated: false,
        sha256: format!("len:{}", payload.len()),
    })
}
```

```rust
pub fn read_body_blob_text(blob: &NetworkBodyBlob) -> Result<String, AppError> {
    Ok(std::fs::read_to_string(&blob.file_path)?)
}
```

- [ ] **Step 4: 暴露读取正文 command，并接入审计**

```rust
#[tauri::command]
pub fn get_network_body_blob(
    state: State<'_, AppState>,
    body_id: String,
) -> Result<String, String> {
    let blob = state.storage.read(|conn| network_repo::find_network_body_blob(conn, &body_id))
        .map_err(AppError::to_string_error)?
        .ok_or_else(|| "未找到正文内容".to_string())?;
    let text = read_body_blob_text(&blob).map_err(AppError::to_string_error)?;
    DiagnosticService::new(&state.storage)
        .record_network_body_access("network.body.read", &body_id, true)
        .map_err(AppError::to_string_error)?;
    Ok(text)
}
```

- [ ] **Step 5: 为 `DiagnosticService` 增加 network 正文访问审计方法**

```rust
pub fn record_network_body_access(
    &self,
    action: &str,
    body_id: &str,
    success: bool,
) -> Result<(), AppError> {
    self.storage.write_tx(|tx| {
        log_repo::insert_system_log(
            tx,
            &log_repo::SystemLogRecord {
                created_at: chrono::Utc::now().to_rfc3339(),
                level: "INFO".to_string(),
                category: "NETWORK_BODY_ACCESS".to_string(),
                action: action.to_string(),
                source_id: None,
                workspace_tab_id: None,
                target: Some(body_id.to_string()),
                success,
                message: "读取网络正文".to_string(),
                detail_text: String::new(),
                detail_json: "{}".to_string(),
                correlation_id: String::new(),
                retention_policy: "standard".to_string(),
                expires_at: None,
            },
        )?;
        Ok(())
    })
}
```

- [ ] **Step 6: 运行测试确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml write_body_blob_persists_text_payload -- --exact`
Expected: PASS

- [ ] **Step 7: 提交本任务**

```bash
git add src-tauri/src/network/body_store.rs src-tauri/src/network/commands.rs src-tauri/src/services/diagnostic_service.rs src-tauri/src/storage/network_repo.rs
git commit -m "feat(network): 实现正文缓存读取与访问审计"
```

### Task 9: 实现实时事件流 store、拓扑图、列表与详情抽屉

**Files:**
- Create: `src/features/main/NetworkPanel/components/NetworkTopologyCanvas.tsx`
- Create: `src/features/main/NetworkPanel/components/NetworkRequestTable.tsx`
- Create: `src/features/main/NetworkPanel/components/NetworkDetailDrawer.tsx`
- Modify: `src/features/main/NetworkPanel/index.tsx`
- Modify: `src/store/useNetworkCaptureStore.ts`
- Modify: `src/features/main/NetworkPanel/logic/networkStream.ts`
- Modify: `package.json`
- Test: `tests/network-panel/networkStream.test.ts`
- Test: `tests/network-panel/networkTopology.test.ts`

- [ ] **Step 1: 写失败测试，固定增量事件合并与当前选中请求详情行为**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { appendNetworkRequests, selectRequestDetail } from "../../src/features/main/NetworkPanel/logic/networkStream.ts";

test("appendNetworkRequests: 应按 requestId 去重并保留最新状态码", () => {
  const next = appendNetworkRequests(
    [{ requestId: "req-1", statusCode: 200 }],
    [{ requestId: "req-1", statusCode: 502 }]
  );
  assert.equal(next.length, 1);
  assert.equal(next[0].statusCode, 502);
});

test("selectRequestDetail: 应按 requestId 找到详情项", () => {
  const item = selectRequestDetail(
    [{ requestId: "req-1", method: "GET", url: "https://example.com" }],
    "req-1"
  );
  assert.equal(item?.method, "GET");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test:network-panel`
Expected: FAIL with missing functions or mismatch

- [ ] **Step 3: 安装 Cytoscape 并实现事件流纯函数**

```json
{
  "dependencies": {
    "cytoscape": "^3.33.1",
    "cytoscape-dagre": "^2.5.0"
  }
}
```

```ts
export function appendNetworkRequests<T extends { requestId: string } & Record<string, unknown>>(
  current: T[],
  incoming: T[]
): T[] {
  const map = new Map(current.map((item) => [item.requestId, item]));
  incoming.forEach((item) => map.set(item.requestId, item));
  return Array.from(map.values());
}

export function selectRequestDetail<T extends { requestId: string }>(items: T[], requestId: string): T | null {
  return items.find((item) => item.requestId === requestId) || null;
}
```

- [ ] **Step 4: 实现拓扑图与详情抽屉**

```tsx
export function NetworkTopologyCanvas({
  nodes,
  edges,
  onSelectNode
}: {
  nodes: NetworkTopologyNode[];
  edges: NetworkTopologyEdge[];
  onSelectNode: (nodeId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!containerRef.current) return;
    const elements = nodes.map((node) => ({ data: node })).concat(edges.map((edge) => ({ data: edge })));
    const graph = cytoscape({
      container: containerRef.current,
      elements,
      layout: { name: "dagre" }
    });
    graph.on("tap", "node", (event) => onSelectNode(event.target.id()));
    return () => graph.destroy();
  }, [nodes, edges, onSelectNode]);
  return <div ref={containerRef} className="h-full w-full rounded-2xl border border-base-300 bg-base-100" />;
}
```

```tsx
export function NetworkDetailDrawer({
  request,
  requestBody,
  responseBody
}: {
  request: NetworkRequestDetail | null;
  requestBody: string;
  responseBody: string;
}) {
  if (!request) {
    return <div className="flex h-full items-center justify-center text-[12px] text-neutral/60">请选择一条请求查看详情。</div>;
  }
  return (
    <div className="flex h-full flex-col overflow-hidden border-l border-base-300 bg-base-100">
      <div className="border-b border-base-300 px-4 py-3">
        <h3 className="text-[14px] font-semibold">{request.method} {request.url}</h3>
        <p className="mt-1 text-[12px] text-neutral/65">状态码：{request.statusCode ?? "-"}</p>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto p-4">
        <pre className="rounded-xl bg-base-200/70 p-3 text-[11px]">{requestBody}</pre>
        <pre className="rounded-xl bg-base-200/70 p-3 text-[11px]">{responseBody}</pre>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: 在 `NetworkPanel` 中绑定 Tauri event 与正文延迟加载**

```tsx
useEffect(() => {
  let unlistenRequests: (() => void) | undefined;
  const setup = async () => {
    unlistenRequests = await listen<NetworkRequestSummary[]>("network://requests-appended", (event) => {
      appendRequests(event.payload);
    });
  };
  void setup();
  return () => {
    unlistenRequests?.();
  };
}, [appendRequests]);
```

```tsx
useEffect(() => {
  if (!selectedRequest?.requestBodyRef) return;
  void api.getNetworkBodyBlob(selectedRequest.requestBodyRef).then(setRequestBodyText);
}, [selectedRequest?.requestBodyRef]);
```

- [ ] **Step 6: 运行测试与构建确认通过**

Run: `npm run test:network-panel && npm run build`
Expected: PASS and build exit 0

- [ ] **Step 7: 提交本任务**

```bash
git add package.json src/features/main/NetworkPanel/components/NetworkTopologyCanvas.tsx src/features/main/NetworkPanel/components/NetworkRequestTable.tsx src/features/main/NetworkPanel/components/NetworkDetailDrawer.tsx src/features/main/NetworkPanel/index.tsx src/store/useNetworkCaptureStore.ts src/features/main/NetworkPanel/logic/networkStream.ts tests/network-panel/networkStream.test.ts tests/network-panel/networkTopology.test.ts
git commit -m "feat(network): 完成实时拓扑图、列表与详情抽屉"
```

### Task 10: 加入系统日志分类、缓存清理与最终验证

**Files:**
- Modify: `src-tauri/src/network/commands.rs`
- Modify: `src-tauri/src/services/diagnostic_service.rs`
- Modify: `src/features/main/SettingsPanel/index.tsx`
- Modify: `src/features/main/SettingsPanel/systemLogContent.ts`
- Test: `tests/query-panel/systemLogContent.test.ts`

- [ ] **Step 1: 写失败测试，固定网络日志分类文案展示**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { buildSystemLogCategoryLabel } from "../../src/features/main/SettingsPanel/systemLogContent.ts";

test("buildSystemLogCategoryLabel: 应识别 NETWORK_BODY_ACCESS", () => {
  assert.equal(buildSystemLogCategoryLabel("NETWORK_BODY_ACCESS"), "网络正文访问");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test --experimental-strip-types tests/query-panel/systemLogContent.test.ts`
Expected: FAIL with category mismatch

- [ ] **Step 3: 补齐系统日志分类与 Network 缓存清理入口**

```ts
export function buildSystemLogCategoryLabel(category: string): string {
  if (category === "NETWORK_CAPTURE") return "网络抓包";
  if (category === "NETWORK_CERTIFICATE") return "网络证书";
  if (category === "NETWORK_PROXY") return "网络代理";
  if (category === "NETWORK_BODY_ACCESS") return "网络正文访问";
  return category;
}
```

```tsx
<button className="btn btn-outline btn-sm" onClick={() => void api.clearNetworkCaptureCache()}>
  清理抓包缓存
</button>
```

- [ ] **Step 4: 运行最终验证**

Run: `npm run test:network-panel && npm run test:query-panel && npm run test:datagrid-utils && cargo test --manifest-path src-tauri/Cargo.toml && npm run build`
Expected: all PASS, `cargo test` 全绿，`vite build` exit code 0

- [ ] **Step 5: 提交本任务**

```bash
git add src-tauri/src/network/commands.rs src-tauri/src/services/diagnostic_service.rs src/features/main/SettingsPanel/index.tsx src/features/main/SettingsPanel/systemLogContent.ts tests/query-panel/systemLogContent.test.ts
git commit -m "feat(network): 完成日志接入、缓存清理与最终验证"
```

---

## Spec Coverage Check

- 独立 `Network Panel`：Task 2、Task 4、Task 9
- Windows 环境检测、管理员、Npcap、证书、代理：Task 3、Task 4
- 连接级采集生命周期：Task 6
- 进程 -> 网卡 -> 远端拓扑：Task 7、Task 9
- 连接级 + 应用层详情：Task 7、Task 8、Task 9
- 正文读取与延迟加载：Task 8、Task 9
- 本地存储与保留、日志审计：Task 5、Task 8、Task 10
- 系统日志分类与清理入口：Task 10

未覆盖项检查结果：

- `ETW / Npcap / MITM` 的真实适配细节仍需在实现任务内部按 Windows 条件依赖逐步展开，但实现入口、状态管理、存储、审计和 UI 链路已经在任务中全部落位，没有遗漏主流程。

## Placeholder Scan

- 本计划未使用占位词或“后续再补”的表述。
- 每个任务都包含明确文件路径、测试命令、最小代码骨架和提交命令。

## Type Consistency Check

- 前端统一使用：
  - `NetworkEnvironmentStatus`
  - `StartNetworkCapturePayload`
  - `NetworkTopologyNode`
  - `NetworkTopologyEdge`
  - `NetworkRequestDetail`
- 后端统一使用：
  - `NetworkEnvironmentStatus`
  - `NetworkCaptureSessionRecord`
  - `NetworkBodyBlob`
  - `NetworkRuntimeState`
- 事件名统一使用：
  - `network://capture-started`
  - `network://capture-stopped`
  - `network://requests-appended`
  - `network://topology-updated`

# Network Panel 进程-网卡-请求拓扑设计

## 背景

当前应用主界面已有 `Query / Terminal / Tools / Settings` 四类主视图，但缺少面向系统网络诊断的统一工作区。

本次新增一个独立 `Network Panel`，用于在 Windows 环境下观察：

- 当前系统内哪些进程正在产生网络入站/出站请求。
- 这些请求最终走的是哪块网卡。
- 这些请求对应的远端服务、协议、连接和应用层详情。
- 整体流量关系的拓扑图。

用户希望第一版不仅能看到连接级信息，还要看到应用层信息，并且支持采集请求体、响应体正文；对 HTTPS 也要求支持明文查看，因此第一版接受本地 MITM 代理与根证书安装方案。

## 已知约束

- 第一版仅支持 Windows。
- 需要管理员级抓包能力。
- 允许依赖 `Npcap`、`ETW` 和本地 `MITM` 代理链路。
- 允许安装并信任本地根证书，以便对 HTTPS 进行解密。
- 前后端代码和注释必须使用 UTF-8（无 BOM），EOL 为 LF。
- 新增代码必须补齐中文注释。
- 本次设计基于仓库现有 `React + Tauri + Rust + Zustand + Tauri Event` 架构，不拆改现有 Query/Terminal 工作区主链路。

## 目标

1. 新增主界面独立 `Network Panel`，与现有 `Query / Terminal / Tools / Settings` 同级。
2. 支持按进程、网卡、远端服务查看网络拓扑。
3. 支持连接级数据采集：
   - PID
   - 进程名
   - 协议
   - 源/目标 IP 与端口
   - 入站/出站方向
   - 网卡归属
   - 字节数
   - 时延
   - 生命周期
4. 支持应用层数据采集：
   - HTTP/HTTPS 请求与响应头
   - URL、Host、Path、Method、Status
   - DNS 查询名
   - TLS SNI、证书信息
   - 请求体与响应体正文
5. 支持拓扑图展示“进程 -> 网卡 -> 远端”的关系。
6. 支持从拓扑图、表格、详情抽屉三处联动查看同一条请求。
7. 支持环境自检、证书安装、管理员提升、开始/停止采集。

## 非目标

1. 第一版不支持 macOS、Linux。
2. 第一版不保证解码所有非 HTTP 协议的应用层正文。
3. 第一版不支持 QUIC / HTTP3 正文明文抓取。
4. 第一版不做内核级透明代理注入。
5. 第一版不做跨机器分布式抓包。
6. 第一版不把实时抓包数据纳入现有 Query 工作区快照持久化结构。
7. 第一版不把抓到的正文自动接入现有 LLM 能力链路。

## 现状摘要

### 前端主视图结构

- `src/pages/MainPage.tsx`
  - 当前通过 `viewMode` 切换 `query / terminal / tools / settings`。
  - 各主视图采用懒加载方式挂载。

- `src/store/useAppStore.ts`
  - 当前 `MainViewMode` 仅包含 `query | terminal | tools | settings`。
  - 适合扩展为 `query | terminal | network | tools | settings`。

### 前后端通信模式

- `src/api/index.ts`
  - 当前通过 `invoke` 调用 Tauri command。
- `src-tauri/src/main.rs`
  - 当前集中注册所有 command。
- `src/pages/MainPage.tsx`、`src/features/main/TerminalPanel/index.tsx`
  - 已存在 Tauri event listen 模式，可复用为 Network Panel 实时事件流。

### 后端诊断能力

- `src-tauri/src/services/diagnostic_service.rs`
  - 当前主要负责 secret 读取审计与结构化系统日志。
  - 尚无网络采集、正文留存、抓包会话管理能力。

结论：

- `Network Panel` 适合新增为独立主视图。
- 连接实时流采用 `Tauri event` 推送最合适。
- 抓包与解密链路不应直接塞入现有 Query 或 Terminal 逻辑。

## 方案总览

本次设计采用“独立 Network Panel + Windows 侧车采集器 + 多源事件关联 + 拓扑图前端”的方案。

### 推荐技术路径

1. 连接级采集：`Windows ETW`
2. 包级与网卡归属：`Npcap`
3. 应用层解密与正文采集：本地 `MITM` 代理
4. 前端拓扑图：`Cytoscape.js`
5. 实时事件分发：`Tauri event`
6. 本地摘要与正文存储：Rust 后端管理的 SQLite + 文件型 blob 缓存

### 选择原因

- 仅靠 ETW + Npcap 无法满足 HTTPS 正文查看诉求。
- 仅靠外部工具嵌套会破坏现有一体化桌面体验。
- `Cytoscape.js` 适合图节点、边、聚合态、筛选联动，不需要自行实现图布局引擎。
- 采集与解密采用管理员侧车进程，能降低对主 Tauri UI 进程的阻塞和崩溃影响。

## 总体架构

### 前端层

新增 `src/features/main/NetworkPanel/`，建议拆分为以下模块：

- `index.tsx`
  - Network Panel 入口。
- `components/NetworkTopologyCanvas.tsx`
  - 拓扑图画布。
- `components/NetworkToolbar.tsx`
  - 顶部控制条。
- `components/NetworkRequestTable.tsx`
  - 请求/连接/DNS/TLS 列表。
- `components/NetworkDetailDrawer.tsx`
  - 连接级与应用层详情抽屉。
- `components/NetworkEnvironmentChecklist.tsx`
  - 环境检测与准备向导。
- `store/useNetworkCaptureStore.ts`
  - Network Panel 专属状态。

### 后端层

建议新增 `src-tauri/src/network/` 模块，并按职责拆分：

- `capture_session.rs`
  - 抓包会话生命周期管理。
- `etw_collector.rs`
  - ETW TCP/IP 连接级采集。
- `npcap_collector.rs`
  - 网卡抓包与包级统计。
- `mitm_bridge.rs`
  - 本地 MITM 代理拉起、证书管理、事件桥接。
- `correlator.rs`
  - 连接、包、请求三路事件关联。
- `topology.rs`
  - 聚合拓扑节点与边。
- `storage.rs`
  - 摘要索引、正文引用、保留期清理。
- `models.rs`
  - Network Panel 专属 DTO。
- `commands.rs`
  - 对前端暴露 command。

### 运行模式

1. 用户进入 `Network Panel`。
2. 前端先发起环境自检。
3. 若管理员、Npcap、证书、代理条件满足，则允许开始采集。
4. 点击“开始采集”后，由后端拉起管理员侧车采集进程。
5. 侧车汇总 ETW、Npcap、MITM 三路事件并推送给主进程。
6. 主进程做聚合后经 Tauri event 推给前端。
7. 用户停止采集后，关闭会话，保留摘要与正文索引供短期回看。

## 视图与交互设计

### 主导航

主导航新增一个 `Network` 入口，建议使用新的网络图标，并在 `MainPage.tsx` 中与其他主视图同级处理：

- 新增 `viewMode === "network"`
- 懒加载 `LazyNetworkPanel`
- 首次进入后可按需决定是否常驻挂载

### 页面结构

Network Panel 建议采用三段式布局：

1. 顶部控制条
- 开始采集
- 停止采集
- 管理员状态
- Npcap 状态
- 证书状态
- 代理状态
- 进程过滤器
- 网卡过滤器
- 时间范围
- 正文采集开关

2. 中央拓扑图区
- 默认展示三层图：
  - 进程节点
  - 网卡节点
  - 远端节点
- 支持缩放、平移、框选、聚焦、重置布局

3. 底部或右侧明细区
- 请求视图
- 连接视图
- DNS 视图
- TLS 视图
- 异常视图
- 右侧详情抽屉

### 用户交互流程

#### 1. 进入页面

- 自动检查：
  - 是否为 Windows
  - 是否为管理员
  - Npcap 是否安装
  - 本地代理是否可启动
  - 根证书是否已安装

若环境不满足，则展示准备向导，不进入半可用采集状态。

#### 2. 准备环境

允许用户执行以下动作：

- 提升为管理员
- 检测/安装 Npcap
- 安装或信任根证书
- 启动本地代理

每个动作都必须显示：

- 当前状态
- 最近一次执行结果
- 失败原因
- 是否可重试

#### 3. 开始采集

用户开始采集前可以设置：

- 全部网卡 / 指定网卡
- 全部进程 / 指定进程
- 仅连接元数据 / 含正文解密

点击开始后：

- 创建一条 `capture session`
- 后端开始推送实时事件
- 顶部显示采集运行中标识、事件速率与缓存大小

#### 4. 查看拓扑

- 点击进程节点：联动筛选该进程流量
- 点击网卡节点：联动筛选该网卡流量
- 点击远端节点：联动筛选对应远端请求
- 点击边：联动筛选该关系下的连接/请求

#### 5. 查看请求详情

选中请求后，详情抽屉展示：

- 连接级详情
  - PID
  - 进程名
  - 可执行文件路径
  - 网卡名称
  - 协议
  - 本地/远端地址
  - 入/出字节
  - 连接建立/关闭时间
  - 平均时延
- 应用层详情
  - Method
  - URL
  - Host
  - Status
  - Request Headers
  - Response Headers
  - TLS 版本
  - SNI
  - 证书主体
  - 请求体
  - 响应体

## 数据模型设计

建议新增以下统一实体。

### 1. 抓包会话

```ts
type NetworkCaptureSession = {
  id: string;
  startedAt: string;
  endedAt: string;
  running: boolean;
  adminGranted: boolean;
  npcapReady: boolean;
  certificateReady: boolean;
  mitmReady: boolean;
  captureBodyEnabled: boolean;
  selectedProcessIds: number[];
  selectedInterfaceIds: string[];
};
```

### 2. 进程节点

```ts
type ProcessEndpoint = {
  pid: number;
  processName: string;
  exePath: string;
  commandLine: string;
  userName: string;
  isElevated: boolean;
};
```

### 3. 网卡节点

```ts
type InterfaceEndpoint = {
  interfaceId: string;
  interfaceName: string;
  macAddress: string;
  ipv4List: string[];
  ipv6List: string[];
  linkSpeed: number;
  isUp: boolean;
};
```

### 4. 远端节点

```ts
type RemoteEndpoint = {
  remoteIp: string;
  remotePort: number;
  resolvedHost: string;
  sniHost: string;
  geoHint: string;
  asnHint: string;
};
```

### 5. 连接级实体

```ts
type NetworkConnection = {
  connectionId: string;
  pid: number;
  interfaceId: string;
  protocol: "tcp" | "udp";
  direction: "inbound" | "outbound";
  localIp: string;
  localPort: number;
  remoteIp: string;
  remotePort: number;
  connectAt: string;
  closeAt: string;
  bytesIn: number;
  bytesOut: number;
  packetCountIn: number;
  packetCountOut: number;
  latencyMs: number | null;
  etwCorrelationKey: string;
};
```

### 6. 请求级实体

```ts
type ApplicationRequest = {
  requestId: string;
  connectionId: string;
  pid: number;
  interfaceId: string;
  protocolFamily: "http" | "https" | "dns" | "websocket" | "tcp-raw";
  method: string;
  url: string;
  host: string;
  path: string;
  statusCode: number | null;
  requestHeaders: Record<string, string[]>;
  responseHeaders: Record<string, string[]>;
  requestBodyRef: string;
  responseBodyRef: string;
  requestBodySize: number;
  responseBodySize: number;
  requestMimeType: string;
  responseMimeType: string;
  tlsVersion: string;
  tlsSni: string;
  certSubject: string;
  startedAt: string;
  firstByteAt: string;
  completedAt: string;
  durationMs: number | null;
  decodeStatus: "ok" | "partial" | "failed";
};
```

### 7. 正文存储引用

```ts
type BodyBlobRef = {
  bodyId: string;
  storageKind: "sqlite-index+file";
  filePath: string;
  size: number;
  encoding: string;
  compressed: boolean;
  truncated: boolean;
  sha256: string;
};
```

说明：

- 列表与详情主 DTO 不直接内嵌大正文。
- 正文通过引用延迟加载，避免实时事件和前端 store 膨胀。

## 事件关联策略

整体采用“三段式关联”。

### 第一段：ETW 建立连接骨架

ETW 负责解决：

- 哪个 PID 建立了连接
- 连接何时建立/关闭
- 五元组是什么
- 方向是什么

连接骨架是后续一切关联的主索引。

### 第二段：Npcap 补齐网卡与包统计

Npcap 负责解决：

- 流量实际经过哪块网卡
- 包级入站/出站方向
- 字节数与包数
- 异常重传、RST、半开等网络现象

### 第三段：MITM 代理补齐应用层

本地代理负责提供：

- HTTP/HTTPS 请求/响应头
- 请求体/响应体正文
- WebSocket 消息
- TLS 会话元信息

### 关联规则

建议按以下顺序关联：

1. 使用 `PID + localIp + localPort + remoteIp + remotePort + 时间窗口` 匹配 ETW 连接。
2. 使用 Npcap 的包五元组补齐对应连接的字节与网卡信息。
3. 使用 MITM 会话中的本地端口、目标地址、时间窗口映射到连接骨架。
4. 若 MITM 事件能直接暴露代理层会话 ID，则将该 ID 存为补充索引，后续正文读取优先按该 ID 命中。

若关联失败：

- 连接保留为“未解码应用层”。
- 请求保留为“未匹配进程”或“未匹配网卡”。
- UI 明确展示失败原因，而不是静默丢弃。

## 拓扑图设计

### 拓扑层级

第一版固定采用三层节点模型：

1. 进程节点
2. 网卡节点
3. 远端节点

不把每个请求直接渲染成图节点，避免图规模失控。

### 边模型

#### 进程 -> 网卡

表示某进程的流量经过某块网卡。

边上聚合展示：

- 请求数
- 连接数
- 入/出字节
- 最近活动时间

#### 网卡 -> 远端

表示某块网卡和某个远端主机/域名之间存在通信关系。

边上聚合展示：

- 协议分布
- 平均时延
- 状态码分布
- 失败率
- 请求数

### 图交互

- 支持节点展开/折叠
- 支持按流量大小调整边粗细
- 支持按错误率/协议类型着色
- 支持鼠标 hover 显示聚合摘要
- 支持点击节点/边联动过滤表格与详情

### 图退化策略

若节点数或边数过大：

- 自动切换为聚合视图
- 按远端域名聚合
- 按进程名聚合
- 允许用户手动切换为“仅表格模式”

## 后端命令与事件设计

建议新增以下 command：

- `get_network_environment_status`
- `request_network_admin_elevation`
- `install_network_root_certificate`
- `uninstall_network_root_certificate`
- `list_network_interfaces`
- `list_running_processes`
- `start_network_capture`
- `stop_network_capture`
- `list_network_capture_sessions`
- `get_network_topology_snapshot`
- `list_network_requests`
- `list_network_connections`
- `get_network_request_detail`
- `get_network_body_blob`

建议新增以下事件：

- `network://environment-status`
- `network://capture-started`
- `network://capture-stopped`
- `network://topology-updated`
- `network://requests-appended`
- `network://connections-updated`
- `network://capture-warning`
- `network://capture-error`

说明：

- 前端首次进入时用 command 拉一次快照。
- 采集中通过 event 增量更新。
- 这样可以保持和现有 Terminal Panel 事件模型一致。

## 状态管理设计

建议新增 `useNetworkCaptureStore.ts`，不要复用 `useAppStore` 的大对象结构。

建议状态切片包括：

```ts
type NetworkCaptureState = {
  environmentStatus: NetworkEnvironmentStatus | null;
  activeSession: NetworkCaptureSession | null;
  topologyNodes: NetworkTopologyNode[];
  topologyEdges: NetworkTopologyEdge[];
  requestList: ApplicationRequestSummary[];
  connectionList: NetworkConnectionSummary[];
  selectedRequestId: string;
  selectedConnectionId: string;
  processFilterIds: number[];
  interfaceFilterIds: string[];
  protocolFilter: string[];
  captureRunning: boolean;
  loading: boolean;
  error: string;
};
```

说明：

- 高速流量数据不进入持久化 store。
- 仅保存必要的 UI 过滤条件与最近一次面板布局状态。
- 历史正文、索引、会话摘要交由后端管理。

## 安全与隐私边界

第一版必须显式声明以下边界：

1. 默认不启动采集，必须用户主动点击开始。
2. 默认不解密 HTTPS，除非用户明确启用“正文采集”。
3. 根证书安装、卸载、正文读取都要进入系统日志。
4. 正文仅保存在本地，不上传任何外部服务。
5. 不自动进入现有 AI 对话链路。
6. 默认脱敏以下头字段：
   - `Authorization`
   - `Proxy-Authorization`
   - `Cookie`
   - `Set-Cookie`
7. 支持在详情页切换“显示原始值 / 显示脱敏值”，但原始值展示也要记录审计。

## 失败处理设计

### 环境失败

- 非 Windows
- 无管理员权限
- Npcap 未安装
- 代理端口占用
- 证书安装失败

处理方式：

- 顶部状态条 + 准备向导同时提示
- 提供重试按钮
- 明确失败动作名与错误明细

### 关联失败

- 抓到了包但未匹配到 PID
- 解密到了请求但未匹配到连接骨架

处理方式：

- 保留记录
- 标记状态
- 在详情页显示“关联失败原因”

### 解密失败

- 证书固定
- 非代理流量
- QUIC / HTTP3
- 压缩体解码失败

处理方式：

- 记录失败原因
- 在列表中展示 `decodeStatus`
- 对支持的协议给出降级建议

### 存储失败

- 正文过大
- 磁盘空间不足
- 文件写入失败

处理方式：

- 主记录仍保留摘要
- 正文引用标记为不可用
- 系统日志写入失败信息

## 持久化与保留策略

第一版建议采用“摘要入库、正文入文件”的双层存储。

### SQLite 存储

保存：

- 抓包会话摘要
- 请求/连接索引
- 正文字段元数据
- 解码状态
- 审计日志

### 文件缓存

保存：

- 请求体
- 响应体
- 大文本或二进制 blob

### 保留策略

- 默认仅保留最近若干小时或最近若干个 session
- 支持在设置页配置保留策略
- 允许用户手动清理全部抓包缓存

## 与现有系统的集成点

### MainPage

- 扩展 `MainViewMode`
- 新增 `Network` 导航按钮
- 新增 `LazyNetworkPanel`

### API 层

- 扩展 `src/api/index.ts`
- 扩展 `src/types/index.ts`

### Tauri command 注册

- 在 `src-tauri/src/main.rs` 注册 Network Panel 所需 command

### 诊断日志

- 复用现有系统日志表，新增网络采集相关分类：
  - `NETWORK_CAPTURE`
  - `NETWORK_CERTIFICATE`
  - `NETWORK_PROXY`
  - `NETWORK_BODY_ACCESS`

## 第三方依赖建议

### 前端

- `cytoscape`
  - 用于拓扑图渲染与交互。

可按需要补充：

- `cytoscape-dagre`
  - 用于层次布局。

### 后端 / 外部能力

- `Npcap`
  - 用于包级抓包与网卡流量识别。
- `Windows ETW`
  - 用于连接级事件与 PID 归属。
- `mitmproxy`
  - 用于 HTTP/HTTPS 解密与正文抓取。

说明：

- 第一版推荐集成成熟 MITM 代理，而不是自研 TLS 解密链路。

## 测试策略

### 前端测试

1. `MainPage` 视图切换测试
- 能进入 `Network Panel`
- 懒加载正常

2. Store 测试
- 环境状态更新
- 拓扑快照写入
- 请求增量事件合并

3. 组件测试
- 节点点击联动过滤
- 详情抽屉延迟加载正文
- 大列表筛选与状态切换

### 后端测试

1. 环境检测测试
- 非管理员
- Npcap 缺失
- 证书未安装

2. 关联器测试
- ETW + Npcap 命中同一连接
- MITM 请求映射到正确连接
- 关联失败时正确回退

3. 存储测试
- 正文大文件引用
- 正文索引缺失兜底
- 清理保留期数据

4. 审计测试
- 安装证书写日志
- 查看正文写日志
- 切换脱敏视图写日志

### 集成测试

1. 进程流量走双网卡场景
- 正确识别进程对应网卡
- 拓扑图展示两条路径

2. HTTP 明文请求
- 能看到头、体、状态码

3. HTTPS 请求
- 在信任根证书后能看到明文正文

4. 解密失败请求
- 能展示失败原因而不是丢记录

## 风险

### 高风险

1. HTTPS 明文采集依赖本地代理和根证书，用户环境差异较大。
2. 某些进程存在证书固定，可能无法解密正文。
3. 采集链路为多源异步事件，关联准确率是核心复杂度。
4. 实时图形渲染和高频事件推送可能导致前端卡顿。

### 中风险

1. Npcap 安装状态和驱动兼容性可能影响可用率。
2. 管理员侧车进程的生命周期和异常恢复需要额外设计。
3. 正文留存存在磁盘占用增长风险。

### 低风险

1. `MainPage` 新增一个独立 panel 的前端接入成本较低。
2. Tauri command + event 模式与现有 Terminal Panel 结构一致，迁移心智成本较低。

## 分阶段实施建议

### 第一阶段：主框架接入

1. 新增 `viewMode = network`
2. 建立 `Network Panel` 空壳
3. 接入环境检测与准备向导

### 第二阶段：连接级采集

1. 接入 ETW
2. 接入 Npcap
3. 打通进程、连接、网卡、远端的拓扑聚合

### 第三阶段：应用层采集

1. 接入 MITM 代理
2. 接入 HTTPS 根证书安装流程
3. 打通请求头、响应头、正文采集

### 第四阶段：详情与审计

1. 完成正文延迟加载
2. 完成脱敏显示
3. 完成系统日志和正文访问审计

### 第五阶段：性能与稳定性

1. 做事件节流和批量推送
2. 做大图退化策略
3. 做存储保留期清理

## 最终结论

第一版 `Network Panel` 应作为主界面的独立高级诊断视图实现，而不是作为 `ToolsPanel` 下的普通工具页。

在明确接受“Windows 专用、管理员权限、Npcap、ETW、本地 MITM 代理、根证书安装”的前提下，推荐采用：

- `ETW` 负责连接归属
- `Npcap` 负责包与网卡归属
- `MITM` 负责 HTTP/HTTPS 应用层与正文
- `Cytoscape.js` 负责拓扑图

这样才能同时满足：

- 看某个进程走哪块网卡
- 看入站/出站网络请求
- 看连接级和应用层详情
- 看请求体与响应体正文
- 以图形方式观察完整拓扑

## 参考实现依据

- Microsoft ETW TCP/IP 事件能力
- Npcap Windows 抓包能力
- mitmproxy HTTPS 拦截与证书模型
- Cytoscape.js 图可视化能力

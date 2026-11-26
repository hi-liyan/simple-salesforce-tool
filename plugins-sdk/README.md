# `.sstplugin` 外部插件开发与打包规范

## 1. 插件包目录结构

```text
<plugin-id>-<version>.sstplugin   # 本质为 ZIP 归档
├── manifest.json                 # 插件清单（必需）
├── icon.svg                      # 可选图标
└── dist/
    └── index.html                # 沙箱入口（必需）
```

## 2. `manifest.json` 字段规范

- `id`: 全局唯一小写标识（如 `com.example.hello-sql`，不可使用 `builtin.` 前缀）
- `name`: 插件名称
- `version`: SemVer 版本号（如 `1.0.0`）
- `apiVersion`: 兼容宿主 SDK 版本（如 `^1.0.0`）
- `mountTargets`: `["workspace-tab", "dock-right", "modal"]`
- `permissions`: 按最小权限声明，可选值：
  - `storage`（插件隔离 KV 持久化）
  - `workspace:read`（读取当前数据源摘要、编辑器选区）
  - `workspace:write`（向当前编辑器插入文本）
  - `clipboard` / `ipc:terminal` / `ipc:lan-receiver`
- `entry`: 入口 HTML 相对路径（默认 `dist/index.html`）

## 3. 打包示例插件

```bash
node plugins-sdk/pack-plugin.mjs plugins-sdk/example-hello-sql
```

执行后将生成 `plugins-sdk/example-hello-sql/com.example.hello-sql-1.0.0.sstplugin`，可在程序右上角 **插件中心 -> 安装 .sstplugin** 直接审批权限并安装。

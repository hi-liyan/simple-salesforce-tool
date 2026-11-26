import { createElement } from "react";
import { ArrowLeftRight, BookMarked, Braces, Languages, QrCode, TerminalSquare, Wifi } from "lucide-react";
import { definePlugin, registerPlugins, type PluginManifest } from "../core/index.ts";

// 内置插件清单列表：将命令库、终端工作区与 6 大辅助工具全部纳入标准插件体系。
export const BUILTIN_PLUGINS: PluginManifest[] = [
  definePlugin({
    id: "builtin.command-library",
    name: "命令库",
    version: "1.0.0",
    description: "管理常用终端命令分组，支持一键填充或发送至终端执行。",
    icon: BookMarked,
    category: "terminal",
    mountTargets: ["dock-right", "workspace-tab"],
    permissions: ["storage", "ipc:terminal", "workspace:read"],
    component: async () => {
      const mod = await import("./command-library/CommandLibraryPlugin.tsx");
      return { default: mod.CommandLibraryPlugin };
    }
  }),
  definePlugin({
    id: "builtin.terminal-workspace",
    name: "系统终端",
    version: "1.0.0",
    description: "内置多标签 PTY 终端，支持 PowerShell / Bash / Zsh 等系统 Shell。",
    icon: TerminalSquare,
    category: "terminal",
    mountTargets: ["workspace-tab"],
    permissions: ["ipc:terminal"],
    component: async () => {
      const mod = await import("../../features/terminal/TerminalViewport.tsx");
      return {
        default: () => createElement(mod.TerminalViewport, { visible: true })
      };
    }
  }),
  definePlugin({
    id: "builtin.json-formatter",
    name: "JSON 格式化",
    version: "1.0.0",
    description: "提供多 Tab JSON 格式化、树形查看、节点折叠与复制结果能力。",
    icon: Braces,
    category: "dev-tool",
    mountTargets: ["workspace-tab"],
    permissions: ["storage", "clipboard"],
    component: async () => {
      const mod = await import("../../features/main/ToolsPanel/components/JsonFormatterTool.tsx");
      return {
        default: ({ ctx }) => createElement(mod.JsonFormatterTool, { onBack: () => ctx.ui.closeSelf() })
      };
    }
  }),
  definePlugin({
    id: "builtin.json-diff",
    name: "JSON Diff",
    version: "1.0.0",
    description: "提供 JSON 语义对比与双栏差异高亮，支持多 Tab 编辑与对比。",
    icon: Braces,
    category: "dev-tool",
    mountTargets: ["workspace-tab"],
    permissions: ["storage"],
    component: async () => {
      const mod = await import("../../features/main/ToolsPanel/components/JsonDiffTool.tsx");
      return {
        default: ({ ctx }) => createElement(mod.JsonDiffTool, { onBack: () => ctx.ui.closeSelf() })
      };
    }
  }),
  definePlugin({
    id: "builtin.text-diff",
    name: "Text Diff",
    version: "1.0.0",
    description: "提供左右双栏文本差异对比，支持多 Tab 编辑与高亮。",
    icon: ArrowLeftRight,
    category: "dev-tool",
    mountTargets: ["workspace-tab"],
    permissions: ["storage"],
    component: async () => {
      const mod = await import("../../features/main/ToolsPanel/components/TextDiffTool.tsx");
      return {
        default: ({ ctx }) => createElement(mod.TextDiffTool, { onBack: () => ctx.ui.closeSelf() })
      };
    }
  }),
  definePlugin({
    id: "builtin.qr-code",
    name: "二维码生成",
    version: "1.0.0",
    description: "提供文本转二维码、参数配置、预览下载与历史记录管理。",
    icon: QrCode,
    category: "dev-tool",
    mountTargets: ["workspace-tab", "modal"],
    permissions: ["storage", "clipboard"],
    component: async () => {
      const mod = await import("../../features/main/ToolsPanel/components/QrCodeTool.tsx");
      return {
        default: ({ ctx }) => createElement(mod.QrCodeTool, { onBack: () => ctx.ui.closeSelf() })
      };
    }
  }),
  definePlugin({
    id: "builtin.unicode-converter",
    name: "Unicode 编码转换",
    version: "1.0.0",
    description: "支持 Unicode / 中文 / ASCII 双向转换与历史记录。",
    icon: Languages,
    category: "dev-tool",
    mountTargets: ["workspace-tab", "modal"],
    permissions: ["storage", "clipboard"],
    component: async () => {
      const mod = await import("../../features/main/ToolsPanel/components/UnicodeConverterTool.tsx");
      return {
        default: ({ ctx }) => createElement(mod.UnicodeConverterTool, { onBack: () => ctx.ui.closeSelf() })
      };
    }
  }),
  definePlugin({
    id: "builtin.lan-file-receiver",
    name: "局域网接收文件",
    version: "1.0.0",
    description: "启动局域网上传服务，支持移动端扫码传文件与桌面端预览。",
    icon: Wifi,
    category: "network",
    mountTargets: ["workspace-tab", "dock-right"],
    permissions: ["ipc:lan-receiver"],
    component: async () => {
      const mod = await import("../../features/main/ToolsPanel/components/LanFileReceiverTool.tsx");
      return {
        default: ({ ctx }) => createElement(mod.LanFileReceiverTool, { onBack: () => ctx.ui.closeSelf() })
      };
    }
  })
];

let builtinsRegistered = false;

// 注册全部内置插件（幂等）。
export function registerBuiltinPlugins(): void {
  if (builtinsRegistered) return;
  registerPlugins(BUILTIN_PLUGINS);
  builtinsRegistered = true;
}

import { useEffect, useMemo, useRef } from "react";
import type { PluginContext, PluginPermission } from "./types.ts";

type PluginIframeHostProps = {
  // 目标插件 ID。
  pluginId: string;
  // 插件入口相对路径（如 dist/index.html）。
  entryPath: string;
  // 已批准的插件权限列表。
  grantedPermissions: PluginPermission[];
  // 宿主注入的插件上下文。
  ctx: PluginContext;
  // 可选启动参数。
  launchParams?: Record<string, unknown>;
};

type RpcRequestMessage = {
  channel: "sst:plugin-rpc";
  requestId: string;
  method: string;
  args?: Record<string, unknown>;
};

// 生成跨平台 Tauri 自定义协议 URL（Windows WebView2 使用 http://plugin.localhost/<id>/<path>）。
export function resolvePluginAssetUrl(pluginId: string, entryPath: string): string {
  const cleanEntry = entryPath.replace(/^\/+/, "");
  const isWindows = typeof navigator !== "undefined" && /Win/i.test(navigator.platform || navigator.userAgent);
  if (isWindows) {
    return `http://plugin.localhost/${encodeURIComponent(pluginId)}/${cleanEntry}`;
  }
  return `plugin://${encodeURIComponent(pluginId)}/${cleanEntry}`;
}

// 外部插件 iframe 沙箱宿主：隔离 DOM/样式/JS 运行时，仅通过 postMessage RPC 受控暴露 PluginContext。
export function PluginIframeHost({
  pluginId,
  entryPath,
  grantedPermissions,
  ctx,
  launchParams
}: PluginIframeHostProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const srcUrl = useMemo(() => resolvePluginAssetUrl(pluginId, entryPath), [pluginId, entryPath]);
  const permissionSet = useMemo(() => new Set(grantedPermissions), [grantedPermissions]);

  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      const targetWindow = iframeRef.current?.contentWindow;
      if (!targetWindow || event.source !== targetWindow) return;

      const data = event.data as RpcRequestMessage | undefined;
      if (!data || data.channel !== "sst:plugin-rpc" || !data.requestId) return;

      const reply = (ok: boolean, result?: unknown, error?: string) => {
        targetWindow.postMessage(
          {
            channel: "sst:plugin-rpc-response",
            requestId: data.requestId,
            ok,
            result,
            error
          },
          "*"
        );
      };

      try {
        const args = data.args || {};
        switch (data.method) {
          case "init":
            reply(true, {
              pluginId,
              grantedPermissions: Array.from(permissionSet),
              launchParams: launchParams || {}
            });
            return;
          case "storage.get":
            if (!permissionSet.has("storage")) throw new Error("缺少 storage 权限");
            reply(true, await ctx.storage.get(String(args.key || "")));
            return;
          case "storage.set":
            if (!permissionSet.has("storage")) throw new Error("缺少 storage 权限");
            await ctx.storage.set(String(args.key || ""), args.value);
            reply(true, true);
            return;
          case "storage.remove":
            if (!permissionSet.has("storage")) throw new Error("缺少 storage 权限");
            await ctx.storage.remove(String(args.key || ""));
            reply(true, true);
            return;
          case "ui.notify":
            ctx.ui.notify(String(args.message || ""), (args.tone as "info" | "success" | "warning" | "error") || "info");
            reply(true, true);
            return;
          case "ui.closeSelf":
            ctx.ui.closeSelf();
            reply(true, true);
            return;
          case "workspace.getActiveSourceSummary":
            if (!permissionSet.has("workspace:read")) throw new Error("缺少 workspace:read 权限");
            reply(true, ctx.workspace.getActiveSourceSummary());
            return;
          case "workspace.getActiveEditorSelection":
            if (!permissionSet.has("workspace:read")) throw new Error("缺少 workspace:read 权限");
            reply(true, ctx.workspace.getActiveEditorSelection());
            return;
          case "workspace.insertTextToActiveEditor":
            if (!permissionSet.has("workspace:write")) throw new Error("缺少 workspace:write 权限");
            ctx.workspace.insertTextToActiveEditor(String(args.text || ""));
            reply(true, true);
            return;
          case "events.emit":
            ctx.events.emit(String(args.eventName || ""), args.payload);
            reply(true, true);
            return;
          default:
            throw new Error(`未授权或未知的插件 RPC 方法: ${data.method}`);
        }
      } catch (error) {
        reply(false, undefined, String(error));
      }
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [ctx, launchParams, permissionSet, pluginId]);

  return (
    <iframe
      ref={iframeRef}
      title={`plugin-${pluginId}`}
      src={srcUrl}
      sandbox="allow-scripts allow-forms"
      className="h-full w-full border-0 bg-base-100"
    />
  );
}

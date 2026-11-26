// 第三方 `.sstplugin` 插件标准前端 SDK（运行于 iframe 沙箱内，通过 postMessage RPC 与宿主通信）。
export type SstPluginContext = {
  pluginId: string;
  grantedPermissions: string[];
  launchParams: Record<string, unknown>;
  storage: {
    get: <T = unknown>(key: string) => Promise<T | null>;
    set: <T = unknown>(key: string, value: T) => Promise<void>;
    remove: (key: string) => Promise<void>;
  };
  ui: {
    notify: (message: string, tone?: "info" | "success" | "warning" | "error") => Promise<void>;
    closeSelf: () => Promise<void>;
  };
  workspace: {
    getActiveSourceSummary: () => Promise<{ id: string; name: string; sourceType: string } | null>;
    getActiveEditorSelection: () => Promise<string>;
    insertTextToActiveEditor: (text: string) => Promise<void>;
  };
  events: {
    emit: (eventName: string, payload?: unknown) => Promise<void>;
  };
};

let seq = 0;

function invokeHostRpc<T = unknown>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const requestId = `rpc-${Date.now()}-${++seq}`;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as {
        channel?: string;
        requestId?: string;
        ok?: boolean;
        result?: T;
        error?: string;
      };
      if (!data || data.channel !== "sst:plugin-rpc-response" || data.requestId !== requestId) {
        return;
      }
      window.removeEventListener("message", onMessage);
      if (data.ok) {
        resolve(data.result as T);
      } else {
        reject(new Error(data.error || "Host RPC failed"));
      }
    };
    window.addEventListener("message", onMessage);
    window.parent.postMessage(
      {
        channel: "sst:plugin-rpc",
        requestId,
        method,
        args
      },
      "*"
    );
  });
}

// 连接宿主并获取经过权限审批的运行时上下文。
export async function connectHost(): Promise<SstPluginContext> {
  const init = await invokeHostRpc<{
    pluginId: string;
    grantedPermissions: string[];
    launchParams: Record<string, unknown>;
  }>("init");

  return {
    pluginId: init.pluginId,
    grantedPermissions: init.grantedPermissions,
    launchParams: init.launchParams || {},
    storage: {
      get: (key) => invokeHostRpc("storage.get", { key }),
      set: (key, value) => invokeHostRpc("storage.set", { key, value }),
      remove: (key) => invokeHostRpc("storage.remove", { key })
    },
    ui: {
      notify: (message, tone = "info") => invokeHostRpc("ui.notify", { message, tone }),
      closeSelf: () => invokeHostRpc("ui.closeSelf")
    },
    workspace: {
      getActiveSourceSummary: () => invokeHostRpc("workspace.getActiveSourceSummary"),
      getActiveEditorSelection: () => invokeHostRpc("workspace.getActiveEditorSelection"),
      insertTextToActiveEditor: (text) => invokeHostRpc("workspace.insertTextToActiveEditor", { text })
    },
    events: {
      emit: (eventName, payload) => invokeHostRpc("events.emit", { eventName, payload })
    }
  };
}

import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";

let configured = false;

// 绑定本地 monaco-editor 实例，避免桌面端离线/受限网络下回退请求外部 CDN 导致加载失败或时序错位。
export function ensureMonacoConfigured(): typeof monaco {
  if (!configured) {
    loader.config({ monaco });
    configured = true;
  }
  return monaco;
}

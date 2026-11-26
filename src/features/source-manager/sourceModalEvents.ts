import type { SalesforceSource } from "../../types";
import type { SourceConnectionModalMode } from "./SourceConnectionModal";

// 全局数据源操作事件载荷（用于标题栏、左侧树与统一连接弹窗解耦通信）。
export type SourceActionEventDetail =
  | { action: "modal"; mode: SourceConnectionModalMode; source?: SalesforceSource | null }
  | { action: "delete"; source: SalesforceSource };

const SOURCE_ACTION_EVENT_NAME = "app:source-action";

// 触发打开新建/编辑/复制数据源弹窗。
export function emitOpenSourceModal(mode: SourceConnectionModalMode, source?: SalesforceSource | null): void {
  window.dispatchEvent(
    new CustomEvent<SourceActionEventDetail>(SOURCE_ACTION_EVENT_NAME, {
      detail: { action: "modal", mode, source }
    })
  );
}

// 触发删除数据源确认流程。
export function emitDeleteSourceRequest(source: SalesforceSource): void {
  window.dispatchEvent(
    new CustomEvent<SourceActionEventDetail>(SOURCE_ACTION_EVENT_NAME, {
      detail: { action: "delete", source }
    })
  );
}

// 订阅数据源操作事件。
export function subscribeSourceActionEvent(handler: (detail: SourceActionEventDetail) => void): () => void {
  const listener = (event: Event) => {
    const customEvent = event as CustomEvent<SourceActionEventDetail>;
    if (!customEvent.detail) return;
    handler(customEvent.detail);
  };
  window.addEventListener(SOURCE_ACTION_EVENT_NAME, listener);
  return () => {
    window.removeEventListener(SOURCE_ACTION_EVENT_NAME, listener);
  };
}

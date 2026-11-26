import { useState } from "react";
import { FileText, ShieldCheck, X } from "lucide-react";
import type { SalesforceSource } from "../../types";
import { SqlAuditTab } from "./SqlAuditTab";
import { SystemLogsTab } from "./SystemLogsTab";

type LogAuditModalProps = {
  // 是否打开日志与审计中心弹窗。
  open: boolean;
  // 关闭回调。
  onClose: () => void;
  // 数据源列表（用于 SQL 审计筛选）。
  sources: SalesforceSource[];
};

// 统一日志与 SQL 执行审计中心弹窗：融合 sql_execution_audit 与 system_logs 双视图。
export function LogAuditModal({ open, onClose, sources }: LogAuditModalProps) {
  const [activeTab, setActiveTab] = useState<"audit" | "system">("audit");

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[105] flex items-center justify-center bg-black/30 backdrop-blur-[2px]" onClick={onClose}>
      <div
        className="flex h-[680px] max-h-[92vh] w-[1040px] max-w-[95vw] flex-col overflow-hidden rounded-2xl border border-base-300 bg-base-100 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        {/* 顶栏：标题 + 双模式分段切换。 */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-base-300/80 px-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <FileText size={16} className="text-primary" />
              <h2 className="text-[14px] font-semibold text-neutral">日志与 SQL 审计中心</h2>
            </div>

            <div className="flex items-center rounded-lg bg-base-200/80 p-0.5 text-[12px]">
              <button
                type="button"
                onClick={() => setActiveTab("audit")}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 transition-colors ${
                  activeTab === "audit" ? "bg-base-100 font-semibold text-primary shadow-2xs" : "text-neutral/70 hover:text-neutral"
                }`}
              >
                <ShieldCheck size={13} />
                <span>SQL 执行审计</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("system")}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 transition-colors ${
                  activeTab === "system" ? "bg-base-100 font-semibold text-primary shadow-2xs" : "text-neutral/70 hover:text-neutral"
                }`}
              >
                <FileText size={13} />
                <span>系统运行日志</span>
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral/70 hover:bg-base-200"
          >
            <X size={15} />
          </button>
        </div>

        {/* 内容区。 */}
        <div className="min-h-0 flex-1 overflow-hidden">
          {activeTab === "audit" ? <SqlAuditTab sources={sources} /> : <SystemLogsTab />}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { Download, FileSpreadsheet, FolderOpen, Loader2, X } from "lucide-react";
import { api } from "../../api";
import type { ExportFormat, ExportProgressPayload, ExportResult } from "../../types";

type DataExportModalProps = {
  // 是否打开导出弹窗。
  open: boolean;
  // 数据源 ID。
  sourceId: string;
  // 默认对象/表名（用于文件名与 SQL INSERT 目标表名）。
  objectName?: string;
  // 待导出的完整查询 SQL（为空时后端按全表查询）。
  sql?: string;
  // 关闭弹窗回调。
  onClose: () => void;
  // 全局消息通知回调。
  onShowMessage: (message: string) => void;
};

// 支持的文件导出格式定义。
const EXPORT_FORMAT_OPTIONS: { value: ExportFormat; label: string; ext: string; desc: string }[] = [
  { value: "csv", label: "CSV (.csv)", ext: "csv", desc: "UTF-8 带 BOM，Excel 直接打开不乱码" },
  { value: "xlsx", label: "Excel (.xlsx)", ext: "xlsx", desc: "保留数值类型与表头样式" },
  { value: "json", label: "JSON (.json)", ext: "json", desc: "标准格式化 JSON 对象数组" },
  { value: "sqlInsert", label: "SQL INSERT (.sql)", ext: "sql", desc: "批量多值 INSERT 语句" },
  { value: "tsv", label: "TSV (.tsv)", ext: "tsv", desc: "制表符分隔文本" },
  { value: "markdown", label: "Markdown (.md)", ext: "md", desc: "GitHub 风格 Markdown 表格" }
];

// 多格式异步流式数据导出浮岛弹窗。
export function DataExportModal({
  open,
  sourceId,
  objectName,
  sql = "",
  onClose,
  onShowMessage
}: DataExportModalProps) {
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [includeHeader, setIncludeHeader] = useState(true);
  const [batchSize, setBatchSize] = useState(100);
  const [outputPath, setOutputPath] = useState("");
  const [exporting, setExporting] = useState(false);
  const [taskId, setTaskId] = useState("");
  const [progress, setProgress] = useState<ExportProgressPayload | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!open) return;
    setOutputPath("");
    setExporting(false);
    setTaskId("");
    setProgress(null);
    setResult(null);
    setErrorMsg("");
  }, [open, sourceId, objectName, sql]);

  // 订阅后端导出进度事件。
  useEffect(() => {
    if (!open || !taskId) return;
    let unlisten: (() => void) | undefined;
    void listen<ExportProgressPayload>("data-export-progress", (event) => {
      if (event.payload.taskId === taskId) {
        setProgress(event.payload);
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [open, taskId]);

  // 打开系统原生保存文件对话框。
  const handleChoosePath = async () => {
    const meta = EXPORT_FORMAT_OPTIONS.find((item) => item.value === format) || EXPORT_FORMAT_OPTIONS[0];
    const baseName = (objectName || "query_export").replace(/[^a-zA-Z0-9_-]/g, "_");
    const chosen = await save({
      title: "选择导出文件保存位置",
      defaultPath: `${baseName}.${meta.ext}`,
      filters: [{ name: meta.label, extensions: [meta.ext] }]
    });
    if (chosen) {
      setOutputPath(chosen);
    }
  };

  // 启动流式导出。
  const handleStartExport = async () => {
    let targetPath = outputPath.trim();
    if (!targetPath) {
      const meta = EXPORT_FORMAT_OPTIONS.find((item) => item.value === format) || EXPORT_FORMAT_OPTIONS[0];
      const baseName = (objectName || "query_export").replace(/[^a-zA-Z0-9_-]/g, "_");
      const chosen = await save({
        title: "选择导出文件保存位置",
        defaultPath: `${baseName}.${meta.ext}`,
        filters: [{ name: meta.label, extensions: [meta.ext] }]
      });
      if (!chosen) return;
      targetPath = chosen;
      setOutputPath(chosen);
    }

    const nextTaskId = `export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setTaskId(nextTaskId);
    setExporting(true);
    setErrorMsg("");
    setResult(null);
    setProgress({
      taskId: nextTaskId,
      exportedRows: 0,
      phase: "querying",
      message: "正在初始化流式导出..."
    });

    try {
      const res = await api.exportDataToFile({
        taskId: nextTaskId,
        sourceId,
        objectName,
        sql,
        format,
        outputPath: targetPath,
        includeHeader,
        batchSize
      });
      setResult(res);
      onShowMessage(`导出完成：共 ${res.exportedRows} 行，保存至 ${res.outputPath}`);
    } catch (err) {
      const msg = String(err);
      setErrorMsg(msg.includes("EXPORT_CANCELLED") ? "已取消导出任务" : msg);
    } finally {
      setExporting(false);
    }
  };

  const handleCancel = async () => {
    if (!taskId || !exporting) return;
    await api.cancelDataExport(taskId);
  };

  if (!open) return null;

  return (
    /* 浮岛模态遮罩 */
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/35 p-4 backdrop-blur-[1px]">
      <div className="flex w-[min(560px,94vw)] flex-col overflow-hidden rounded-xl border border-base-300 bg-base-200 shadow-2xl">
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b border-base-300 bg-base-100 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <FileSpreadsheet size={16} className="text-primary" />
            <span className="text-[13px] font-semibold text-neutral">
              导出数据{objectName ? `：${objectName}` : ""}
            </span>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-xs btn-square"
            disabled={exporting}
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </div>

        {/* 配置主体 */}
        <div className="flex flex-col gap-3 p-4">
          {/* 导出格式选择网格 */}
          <div className="rounded-xl border border-base-300 bg-base-100 p-3">
            <div className="mb-2 text-[12px] font-medium text-neutral">选择导出格式</div>
            <div className="grid grid-cols-2 gap-2">
              {EXPORT_FORMAT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={exporting}
                  onClick={() => {
                    setFormat(opt.value);
                    setOutputPath("");
                  }}
                  className={`flex flex-col items-start rounded-lg border p-2 text-left transition-colors ${
                    format === opt.value
                      ? "border-primary bg-primary/10"
                      : "border-base-300 bg-base-100 hover:bg-base-200/70"
                  }`}
                >
                  <span className="text-[12px] font-semibold text-neutral">{opt.label}</span>
                  <span className="text-[11px] text-neutral/60">{opt.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 格式选项与保存路径 */}
          <div className="flex flex-col gap-2.5 rounded-xl border border-base-300 bg-base-100 p-3">
            {(format === "csv" || format === "tsv" || format === "xlsx") && (
              <label className="flex cursor-pointer items-center gap-2 text-[12px] text-neutral">
                <input
                  type="checkbox"
                  className="checkbox checkbox-xs checkbox-primary"
                  checked={includeHeader}
                  disabled={exporting}
                  onChange={(e) => setIncludeHeader(e.target.checked)}
                />
                包含列名表头
              </label>
            )}

            {format === "sqlInsert" && (
              <label className="flex items-center justify-between text-[12px] text-neutral">
                <span>每条 INSERT 合并行数</span>
                <input
                  type="number"
                  min={1}
                  max={2000}
                  className="input input-bordered input-xs w-24 text-right font-mono"
                  value={batchSize}
                  disabled={exporting}
                  onChange={(e) => setBatchSize(Math.max(1, Number(e.target.value) || 100))}
                />
              </label>
            )}

            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-neutral/70">保存路径</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  className="input input-bordered input-xs flex-1 font-mono"
                  value={outputPath}
                  readOnly
                  placeholder="点击右侧按钮选择保存位置（未选择时点击导出自动弹出）"
                />
                <button
                  type="button"
                  className="btn btn-outline btn-xs gap-1"
                  disabled={exporting}
                  onClick={() => void handleChoosePath()}
                >
                  <FolderOpen size={12} />
                  浏览
                </button>
              </div>
            </div>
          </div>

          {/* 进度或结果提示 */}
          {progress && (
            <div className="rounded-xl border border-base-300 bg-base-100 p-3 text-[12px]">
              <div className="flex items-center justify-between font-medium text-neutral">
                <span>{progress.message}</span>
                <span className="font-mono text-primary">{progress.exportedRows} 行</span>
              </div>
            </div>
          )}

          {result && (
            <div className="rounded-xl border border-success/40 bg-success/10 p-3 text-[12px] text-success">
              导出成功：共 {result.exportedRows} 行，文件大小 {(result.fileSizeBytes / 1024).toFixed(1)} KB，耗时{" "}
              {result.durationMs} ms。
            </div>
          )}

          {errorMsg && (
            <div className="rounded-xl border border-error/40 bg-error/10 p-3 text-[12px] text-error">
              {errorMsg}
            </div>
          )}
        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center justify-end gap-2 border-t border-base-300 bg-base-100 px-4 py-2.5">
          {exporting ? (
            <button type="button" className="btn btn-error btn-xs" onClick={() => void handleCancel()}>
              停止导出
            </button>
          ) : (
            <button type="button" className="btn btn-ghost btn-xs" onClick={onClose}>
              关闭
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary btn-xs gap-1.5"
            disabled={exporting}
            onClick={() => void handleStartExport()}
          >
            {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            {exporting ? "导出中..." : "开始导出"}
          </button>
        </div>
      </div>
    </div>
  );
}

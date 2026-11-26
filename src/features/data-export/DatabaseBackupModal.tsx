import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { DatabaseBackup, FolderOpen, Loader2, X } from "lucide-react";
import { api } from "../../api";
import type { BackupProgressPayload, BackupResult, BackupScope } from "../../types";

type DatabaseBackupModalProps = {
  // 是否打开备份弹窗。
  open: boolean;
  // 目标数据源 ID。
  sourceId: string;
  // 数据源显示名称（用于默认文件名）。
  sourceName: string;
  // 备份范围（整库或单表）。
  scope: BackupScope;
  // 单表备份时的目标表名。
  tableName?: string;
  // 关闭弹窗回调。
  onClose: () => void;
  // 全局通知回调。
  onShowMessage: (message: string) => void;
};

// 纯 Rust 逻辑 SQL 数据库备份浮岛弹窗（无需外部 mysqldump）。
export function DatabaseBackupModal({
  open,
  sourceId,
  sourceName,
  scope,
  tableName,
  onClose,
  onShowMessage
}: DatabaseBackupModalProps) {
  const [includeDropTable, setIncludeDropTable] = useState(true);
  const [includeCreateDatabase, setIncludeCreateDatabase] = useState(false);
  const [stripAutoIncrement, setStripAutoIncrement] = useState(false);
  const [includeData, setIncludeData] = useState(true);
  const [batchSize, setBatchSize] = useState(200);
  const [outputPath, setOutputPath] = useState("");
  const [backingUp, setBackingUp] = useState(false);
  const [taskId, setTaskId] = useState("");
  const [progress, setProgress] = useState<BackupProgressPayload | null>(null);
  const [result, setResult] = useState<BackupResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!open) return;
    setOutputPath("");
    setBackingUp(false);
    setTaskId("");
    setProgress(null);
    setResult(null);
    setErrorMsg("");
  }, [open, sourceId, scope, tableName]);

  // 订阅后端备份进度事件。
  useEffect(() => {
    if (!open || !taskId) return;
    let unlisten: (() => void) | undefined;
    void listen<BackupProgressPayload>("database-backup-progress", (event) => {
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

  const buildDefaultFileName = () => {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const target = scope === "table" && tableName ? tableName : sourceName;
    return `${target.replace(/[^a-zA-Z0-9_-]/g, "_")}_backup_${stamp}.sql`;
  };

  const handleChoosePath = async () => {
    const chosen = await save({
      title: "选择 SQL 备份文件保存位置",
      defaultPath: buildDefaultFileName(),
      filters: [{ name: "SQL Backup (.sql)", extensions: ["sql"] }]
    });
    if (chosen) {
      setOutputPath(chosen);
    }
  };

  const handleStartBackup = async () => {
    let targetPath = outputPath.trim();
    if (!targetPath) {
      const chosen = await save({
        title: "选择 SQL 备份文件保存位置",
        defaultPath: buildDefaultFileName(),
        filters: [{ name: "SQL Backup (.sql)", extensions: ["sql"] }]
      });
      if (!chosen) return;
      targetPath = chosen;
      setOutputPath(chosen);
    }

    const nextTaskId = `backup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setTaskId(nextTaskId);
    setBackingUp(true);
    setErrorMsg("");
    setResult(null);
    setProgress({
      taskId: nextTaskId,
      currentTable: "",
      completedTables: 0,
      totalTables: 0,
      exportedRows: 0,
      phase: "preparing",
      message: "正在开启一致性快照事务..."
    });

    try {
      const res = await api.backupDatabaseToFile({
        taskId: nextTaskId,
        sourceId,
        scope,
        tableName,
        outputPath: targetPath,
        includeDropTable,
        includeCreateDatabase,
        stripAutoIncrement,
        includeData,
        batchSize
      });
      setResult(res);
      onShowMessage(`备份完成：${res.tableCount} 张表，共 ${res.exportedRows} 行`);
    } catch (err) {
      const msg = String(err);
      setErrorMsg(msg.includes("BACKUP_CANCELLED") ? "已取消备份任务" : msg);
    } finally {
      setBackingUp(false);
    }
  };

  const handleCancel = async () => {
    if (!taskId || !backingUp) return;
    await api.cancelDatabaseBackup(taskId);
  };

  if (!open) return null;

  return (
    /* 浮岛模态遮罩 */
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/35 p-4 backdrop-blur-[1px]">
      <div className="flex w-[min(560px,94vw)] flex-col overflow-hidden rounded-xl border border-base-300 bg-base-200 shadow-2xl">
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b border-base-300 bg-base-100 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <DatabaseBackup size={16} className="text-primary" />
            <span className="text-[13px] font-semibold text-neutral">
              {scope === "table" ? `备份数据表：${tableName}` : `备份数据库：${sourceName}`}
            </span>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-xs btn-square"
            disabled={backingUp}
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </div>

        {/* 选项配置区 */}
        <div className="flex flex-col gap-3 p-4">
          <div className="flex flex-col gap-2 rounded-xl border border-base-300 bg-base-100 p-3">
            <div className="text-[12px] font-medium text-neutral">逻辑 SQL 转储选项（纯内置一致性快照）</div>
            <label className="flex cursor-pointer items-center gap-2 text-[12px] text-neutral">
              <input
                type="checkbox"
                className="checkbox checkbox-xs checkbox-primary"
                checked={includeDropTable}
                disabled={backingUp}
                onChange={(e) => setIncludeDropTable(e.target.checked)}
              />
              包含 DROP TABLE IF EXISTS（覆盖重建）
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-[12px] text-neutral">
              <input
                type="checkbox"
                className="checkbox checkbox-xs checkbox-primary"
                checked={includeCreateDatabase}
                disabled={backingUp}
                onChange={(e) => setIncludeCreateDatabase(e.target.checked)}
              />
              包含 CREATE DATABASE 与 USE 语句
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-[12px] text-neutral">
              <input
                type="checkbox"
                className="checkbox checkbox-xs checkbox-primary"
                checked={stripAutoIncrement}
                disabled={backingUp}
                onChange={(e) => setStripAutoIncrement(e.target.checked)}
              />
              移除表 DDL 中的 AUTO_INCREMENT 计数
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-[12px] text-neutral">
              <input
                type="checkbox"
                className="checkbox checkbox-xs checkbox-primary"
                checked={includeData}
                disabled={backingUp}
                onChange={(e) => setIncludeData(e.target.checked)}
              />
              导出表数据（取消勾选则仅备份表结构 DDL）
            </label>
            {includeData && (
              <label className="flex items-center justify-between pt-1 text-[12px] text-neutral">
                <span>每条 INSERT 合并行数</span>
                <input
                  type="number"
                  min={1}
                  max={2000}
                  className="input input-bordered input-xs w-24 text-right font-mono"
                  value={batchSize}
                  disabled={backingUp}
                  onChange={(e) => setBatchSize(Math.max(1, Number(e.target.value) || 200))}
                />
              </label>
            )}
          </div>

          <div className="flex flex-col gap-1 rounded-xl border border-base-300 bg-base-100 p-3">
            <span className="text-[11px] font-medium text-neutral/70">保存路径 (.sql)</span>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                className="input input-bordered input-xs flex-1 font-mono"
                value={outputPath}
                readOnly
                placeholder="点击右侧按钮选择 .sql 文件保存路径"
              />
              <button
                type="button"
                className="btn btn-outline btn-xs gap-1"
                disabled={backingUp}
                onClick={() => void handleChoosePath()}
              >
                <FolderOpen size={12} />
                浏览
              </button>
            </div>
          </div>

          {progress && (
            <div className="flex flex-col gap-1.5 rounded-xl border border-base-300 bg-base-100 p-3 text-[12px]">
              <div className="flex items-center justify-between font-medium text-neutral">
                <span>{progress.message}</span>
                <span className="font-mono text-primary">
                  {progress.totalTables > 0
                    ? `${progress.completedTables}/${progress.totalTables} 表 · ${progress.exportedRows} 行`
                    : `${progress.exportedRows} 行`}
                </span>
              </div>
              {progress.totalTables > 0 && (
                <progress
                  className="progress progress-primary h-1.5 w-full"
                  value={progress.completedTables}
                  max={progress.totalTables}
                />
              )}
            </div>
          )}

          {result && (
            <div className="rounded-xl border border-success/40 bg-success/10 p-3 text-[12px] text-success">
              备份成功：共 {result.tableCount} 张表、{result.exportedRows} 行，文件大小{" "}
              {(result.fileSizeBytes / 1024).toFixed(1)} KB，耗时 {result.durationMs} ms。
            </div>
          )}

          {errorMsg && (
            <div className="rounded-xl border border-error/40 bg-error/10 p-3 text-[12px] text-error">
              {errorMsg}
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-end gap-2 border-t border-base-300 bg-base-100 px-4 py-2.5">
          {backingUp ? (
            <button type="button" className="btn btn-error btn-xs" onClick={() => void handleCancel()}>
              停止备份
            </button>
          ) : (
            <button type="button" className="btn btn-ghost btn-xs" onClick={onClose}>
              关闭
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary btn-xs gap-1.5"
            disabled={backingUp}
            onClick={() => void handleStartBackup()}
          >
            {backingUp ? <Loader2 size={13} className="animate-spin" /> : <DatabaseBackup size={13} />}
            {backingUp ? "备份中..." : "开始备份"}
          </button>
        </div>
      </div>
    </div>
  );
}

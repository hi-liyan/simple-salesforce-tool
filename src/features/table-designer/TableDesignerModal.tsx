import { useEffect, useMemo, useState } from "react";
import { Loader2, Play, Table2, X } from "lucide-react";
import { api } from "../../api";
import type { TableStructureSpec } from "../../types";
import { ColumnsEditorTab } from "./ColumnsEditorTab";
import { IndexesEditorTab } from "./IndexesEditorTab";
import { ForeignKeysEditorTab } from "./ForeignKeysEditorTab";
import { SqlPreviewPanel } from "./SqlPreviewPanel";

type DesignerTab = "columns" | "indexes" | "foreignKeys" | "sql";

type TableDesignerModalProps = {
  // 是否打开弹窗。
  open: boolean;
  // 目标数据源 ID。
  sourceId: string;
  // 已有表名（为空表示新建表模式，非空表示编辑表结构模式）。
  tableName?: string | null;
  // 关闭弹窗回调。
  onClose: () => void;
  // 保存执行成功回调（用于刷新左侧对象树）。
  onSuccess: (affectedTableName: string) => void;
  // 全局提示回调。
  onShowMessage: (message: string) => void;
};

// 创建空白新建表结构模板（默认附带自增主键 id 列）。
function createInitialTableSpec(): TableStructureSpec {
  return {
    tableName: "new_table",
    comment: "",
    engine: "InnoDB",
    charset: "utf8mb4",
    columns: [
      {
        name: "id",
        dataType: "bigint unsigned",
        nullable: false,
        isPrimaryKey: true,
        autoIncrement: true,
        defaultValue: null,
        comment: "主键 ID",
        markedForDrop: false
      }
    ],
    indexes: [],
    foreignKeys: []
  };
}

// 表结构设计器浮岛弹窗：支持新建表、编辑表结构、300ms 防抖 SQL 预览及 SqlGuard 受控执行。
export function TableDesignerModal({
  open,
  sourceId,
  tableName,
  onClose,
  onSuccess,
  onShowMessage
}: TableDesignerModalProps) {
  const isEditMode = Boolean(tableName && tableName.trim());
  const [activeTab, setActiveTab] = useState<DesignerTab>("columns");
  const [loadingSpec, setLoadingSpec] = useState(false);
  const [originalSpec, setOriginalSpec] = useState<TableStructureSpec | null>(null);
  const [draftSpec, setDraftSpec] = useState<TableStructureSpec>(createInitialTableSpec);
  const [previewSqls, setPreviewSqls] = useState<string[]>([]);
  const [previewError, setPreviewError] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [executeError, setExecuteError] = useState("");

  // 打开时按新建/编辑模式初始化表结构。
  useEffect(() => {
    if (!open) return;
    setActiveTab("columns");
    setExecuteError("");
    setPreviewError("");

    if (!isEditMode || !tableName) {
      const initial = createInitialTableSpec();
      setOriginalSpec(null);
      setDraftSpec(initial);
      return;
    }

    let cancelled = false;
    setLoadingSpec(true);
    void api
      .getTableStructureSpec(sourceId, tableName)
      .then((spec) => {
        if (cancelled) return;
        setOriginalSpec(structuredClone(spec));
        setDraftSpec(structuredClone(spec));
      })
      .catch((err) => {
        if (cancelled) return;
        setExecuteError(`加载表结构失败：${String(err)}`);
      })
      .finally(() => {
        if (!cancelled) setLoadingSpec(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, sourceId, tableName, isEditMode]);

  // 300ms 防抖生成实时 SQL 预览。
  useEffect(() => {
    if (!open || loadingSpec) return;
    if (isEditMode && !originalSpec) return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setPreviewLoading(true);
      const task = isEditMode && originalSpec
        ? api.previewAlterTableSql(originalSpec, draftSpec)
        : api.previewCreateTableSql(draftSpec);

      void task
        .then((sqls) => {
          if (cancelled) return;
          setPreviewSqls(sqls);
          setPreviewError("");
        })
        .catch((err) => {
          if (cancelled) return;
          setPreviewSqls([]);
          setPreviewError(String(err));
        })
        .finally(() => {
          if (!cancelled) setPreviewLoading(false);
        });
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, loadingSpec, isEditMode, originalSpec, draftSpec]);

  const canSubmit = useMemo(
    () => !loadingSpec && !executing && !previewError && previewSqls.length > 0,
    [loadingSpec, executing, previewError, previewSqls.length]
  );

  // 通过 SqlGuard 受控网关顺序执行 DDL 语句，高危语句触发二次确认。
  const handleSaveAndExecute = async () => {
    if (!canSubmit) return;
    setExecuting(true);
    setExecuteError("");
    try {
      for (const rawSql of previewSqls) {
        const res = await api.executeGuardedQuery(sourceId, rawSql, draftSpec.tableName, false);
        if (res.status === "confirmation_required") {
          const reason =
            typeof res.guardDecision?.reason === "string"
              ? res.guardDecision.reason
              : "当前包含高危 DDL 变更";
          const ok = window.confirm(
            `${reason}\n\n即将执行：\n${rawSql}\n\n是否确认执行？`
          );
          if (!ok) {
            setExecuting(false);
            return;
          }
          await api.executeGuardedQuery(sourceId, rawSql, draftSpec.tableName, true);
        }
      }
      onShowMessage(
        isEditMode
          ? `表 \`${draftSpec.tableName}\` 结构更新成功（共执行 ${previewSqls.length} 条 DDL）`
          : `表 \`${draftSpec.tableName}\` 创建成功`
      );
      onSuccess(draftSpec.tableName);
      onClose();
    } catch (err) {
      setExecuteError(String(err));
    } finally {
      setExecuting(false);
    }
  };

  if (!open) return null;

  return (
    /* 浮岛模态遮罩 */
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/35 p-4 backdrop-blur-[1px]">
      {/* 表结构设计器主卡片 */}
      <div className="flex h-[82vh] w-[min(1120px,95vw)] flex-col overflow-hidden rounded-xl border border-base-300 bg-base-200 shadow-2xl">
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between border-b border-base-300 bg-base-100 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Table2 size={16} className="text-primary" />
            <span className="text-[13px] font-semibold text-neutral">
              {isEditMode ? `编辑表结构：${tableName}` : "新建数据表"}
            </span>
          </div>
          <button type="button" className="btn btn-ghost btn-xs btn-square" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        {/* 表基础属性栏 */}
        <div className="grid grid-cols-4 gap-2 border-b border-base-300 bg-base-100/80 px-4 py-2.5">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-neutral/70">表名</span>
            <input
              type="text"
              className="input input-bordered input-xs font-mono"
              value={draftSpec.tableName}
              onChange={(e) => setDraftSpec((prev) => ({ ...prev, tableName: e.target.value }))}
              placeholder="table_name"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-neutral/70">存储引擎</span>
            <select
              className="select select-bordered select-xs font-mono"
              value={draftSpec.engine}
              onChange={(e) => setDraftSpec((prev) => ({ ...prev, engine: e.target.value }))}
            >
              <option value="InnoDB">InnoDB</option>
              <option value="MyISAM">MyISAM</option>
              <option value="MEMORY">MEMORY</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-neutral/70">字符集</span>
            <select
              className="select select-bordered select-xs font-mono"
              value={draftSpec.charset}
              onChange={(e) => setDraftSpec((prev) => ({ ...prev, charset: e.target.value }))}
            >
              <option value="utf8mb4">utf8mb4</option>
              <option value="utf8">utf8</option>
              <option value="latin1">latin1</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-neutral/70">表注释</span>
            <input
              type="text"
              className="input input-bordered input-xs"
              value={draftSpec.comment}
              onChange={(e) => setDraftSpec((prev) => ({ ...prev, comment: e.target.value }))}
              placeholder="表业务说明"
            />
          </label>
        </div>

        {/* 标签页导航栏 */}
        <div className="flex items-center gap-1 border-b border-base-300 bg-base-100 px-4 pt-1.5">
          {[
            { id: "columns", label: `列 (${draftSpec.columns.length})` },
            { id: "indexes", label: `索引 (${draftSpec.indexes.length})` },
            { id: "foreignKeys", label: `外键 (${draftSpec.foreignKeys.length})` },
            { id: "sql", label: `SQL 预览 (${previewSqls.length})` }
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`rounded-t-lg border-b-2 px-3 py-1.5 text-[12px] font-medium transition-colors ${
                activeTab === tab.id
                  ? "border-primary text-primary"
                  : "border-transparent text-neutral/70 hover:text-neutral"
              }`}
              onClick={() => setActiveTab(tab.id as DesignerTab)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 主体编辑区（左侧编辑 + 底部/右侧可切换 SQL 预览） */}
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
          {loadingSpec ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-[12px] text-neutral/70">
              <Loader2 size={16} className="animate-spin text-primary" />
              正在读取表结构定义...
            </div>
          ) : (
            <>
              <div className="min-h-0 flex-1">
                {activeTab === "columns" && (
                  <ColumnsEditorTab
                    columns={draftSpec.columns}
                    isEditMode={isEditMode}
                    onChange={(columns) => setDraftSpec((prev) => ({ ...prev, columns }))}
                  />
                )}
                {activeTab === "indexes" && (
                  <IndexesEditorTab
                    indexes={draftSpec.indexes}
                    availableColumns={draftSpec.columns}
                    isEditMode={isEditMode}
                    onChange={(indexes) => setDraftSpec((prev) => ({ ...prev, indexes }))}
                  />
                )}
                {activeTab === "foreignKeys" && (
                  <ForeignKeysEditorTab
                    foreignKeys={draftSpec.foreignKeys}
                    availableColumns={draftSpec.columns}
                    isEditMode={isEditMode}
                    onChange={(foreignKeys) => setDraftSpec((prev) => ({ ...prev, foreignKeys }))}
                  />
                )}
                {activeTab === "sql" && (
                  <SqlPreviewPanel
                    statements={previewSqls}
                    previewError={previewError}
                    loading={previewLoading}
                  />
                )}
              </div>

              {/* 底部常驻精简 SQL 预览条（非 SQL tab 时便于实时观察 DDL 变化） */}
              {activeTab !== "sql" && (
                <div className="h-32 shrink-0">
                  <SqlPreviewPanel
                    statements={previewSqls}
                    previewError={previewError}
                    loading={previewLoading}
                  />
                </div>
              )}
            </>
          )}

          {executeError && (
            <div className="rounded-lg border border-error/40 bg-error/10 px-3 py-1.5 text-[12px] text-error">
              {executeError}
            </div>
          )}
        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center justify-end gap-2 border-t border-base-300 bg-base-100 px-4 py-2.5">
          <button type="button" className="btn btn-ghost btn-xs" onClick={onClose} disabled={executing}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary btn-xs gap-1.5"
            disabled={!canSubmit}
            onClick={() => void handleSaveAndExecute()}
          >
            {executing ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            {isEditMode ? "保存并执行 ALTER" : "创建表"}
          </button>
        </div>
      </div>
    </div>
  );
}

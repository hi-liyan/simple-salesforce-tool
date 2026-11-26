import { useCallback } from "react";
import { api } from "../../../api";
import { RowContextMenuState } from "../types";
import type { GridAdapter } from "../../../drivers/types.ts";
import type { ExportFormat } from "../../../types";
import { copyTextToClipboard, formatRecordsToText } from "../../../features/data-export/formatters";

type UseDataGridMenuActionsParams = {
  // 当前右键菜单状态。
  rowContextMenu: RowContextMenuState | null;
  // 关闭菜单状态写入函数。
  setRowContextMenu: (next: RowContextMenuState | null) => void;
  // 当前选中的数据源 ID。
  sourceId?: string;
  // 当前对象 API 名称。
  objectName?: string;
  // 数据源表格适配器：用于区分 Set None / Set Null 编解码语义。
  gridAdapter: GridAdapter;
  // 单元格编辑回调。
  onEditCell: (rowIndex: number, columnName: string, value: unknown) => void;
  // 用户提示回调。
  onShowMessage: (message: string) => void;
  // 当前展示的记录集与可见列（用于多格式复制）。
  records?: Record<string, unknown>[];
  columnNames?: string[];
  selectedRecordIds?: string[];
  primaryKeyField?: string;
};

// 右键菜单动作 Hook：封装复制、置空、打开记录页的副作用逻辑。
export function useDataGridMenuActions({
  rowContextMenu,
  setRowContextMenu,
  sourceId,
  objectName,
  gridAdapter,
  onEditCell,
  onShowMessage,
  records = [],
  columnNames = [],
  selectedRecordIds = [],
  primaryKeyField = ""
}: UseDataGridMenuActionsParams) {
  const { codec } = gridAdapter;
  // 打开 Salesforce 记录页：后端校验 token 后直接打开系统浏览器。
  const openRecordPageFromMenu = useCallback(async () => {
    if (!rowContextMenu) return;
    const { recordId } = rowContextMenu;
    setRowContextMenu(null); // 立即关闭菜单，避免等待后端响应期间 UI 无反馈。
    if (!sourceId || !objectName) {
      onShowMessage("当前上下文缺少 sourceId/objectName，无法打开 Salesforce 记录页。");
      return;
    }
    if (!recordId) {
      onShowMessage("当前行没有可用的记录 Id。");
      return;
    }
    try {
      await api.openRecordPage(sourceId, objectName, recordId);
    } catch (error) {
      onShowMessage(`打开 Salesforce 记录页失败：${String(error)}`);
    }
  }, [rowContextMenu, setRowContextMenu, sourceId, objectName, onShowMessage]);

  // 复制当前右键单元格数据：优先使用现代剪贴板 API，失败时回退 execCommand。
  const copyCellValueFromMenu = useCallback(async () => {
    if (!rowContextMenu) return;
    const text = rowContextMenu.cellText;
    try {
      await navigator.clipboard.writeText(text); // 优先使用现代剪贴板 API。
    } catch {
      // 回退方案：兼容剪贴板权限受限场景。
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    } finally {
      setRowContextMenu(null); // 执行后关闭菜单。
    }
  }, [rowContextMenu, setRowContextMenu]);

  // 右键菜单动作：将可空字段设置为 null（UI 文案按数据源显示 Set None/Set Null）。
  const setCellNullishFromMenu = useCallback(() => {
    if (!rowContextMenu) return;
    if (!rowContextMenu.canSetNullish) return;
    onEditCell(rowContextMenu.rowIndex, rowContextMenu.columnId, codec.encodeNull());
    setRowContextMenu(null); // 执行后关闭菜单，避免重复点击。
  }, [rowContextMenu, onEditCell, setRowContextMenu, codec]);

  // 右键菜单动作：恢复字段默认值；统一写入 default 草稿，提交阶段再按 create/update 分流。
  const setCellDefaultValueFromMenu = useCallback(() => {
    if (!rowContextMenu) return;
    if (!rowContextMenu.canSetDefaultValue) return;
    onEditCell(rowContextMenu.rowIndex, rowContextMenu.columnId, codec.encodeDefault());
    setRowContextMenu(null);
  }, [rowContextMenu, onEditCell, setRowContextMenu, codec]);

  // 右键菜单动作：将当前勾选行（若无勾选则取当前右键所在行）复制为指定格式。
  const copyRowsAsFormatFromMenu = useCallback(
    async (format: Exclude<ExportFormat, "xlsx">) => {
      if (!rowContextMenu) return;
      setRowContextMenu(null);
      const selectedSet = new Set(selectedRecordIds);
      const matched =
        selectedSet.size > 0
          ? records.filter((row) => {
              const id = gridAdapter.resolveRecordKey(row, primaryKeyField);
              return Boolean(id) && selectedSet.has(id);
            })
          : [];
      const targetRows =
        matched.length > 0
          ? matched
          : records[rowContextMenu.rowIndex]
            ? [records[rowContextMenu.rowIndex]]
            : [];
      if (targetRows.length === 0 || columnNames.length === 0) {
        onShowMessage("当前没有可复制的数据行。");
        return;
      }
      const text = formatRecordsToText({
        format,
        columns: columnNames,
        records: targetRows,
        tableName: objectName || "exported_table"
      });
      await copyTextToClipboard(text);
      onShowMessage(`已复制 ${targetRows.length} 行（${format.toUpperCase()}）到剪贴板。`);
    },
    [
      rowContextMenu,
      setRowContextMenu,
      selectedRecordIds,
      records,
      columnNames,
      gridAdapter,
      primaryKeyField,
      objectName,
      onShowMessage
    ]
  );

  return {
    openRecordPageFromMenu,
    copyCellValueFromMenu,
    setCellNullishFromMenu,
    setCellDefaultValueFromMenu,
    copyRowsAsFormatFromMenu
  };
}

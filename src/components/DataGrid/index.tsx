import { useCallback, useMemo, useRef, useState } from "react";
import { EditableGridCell, EditListItem, Item } from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import { resolveSalesforceTimezone } from "./utils/datetime";
import { QueryResult } from "../../types";
import { createGetCellContent } from "./renderers/getCellContent";
import {
  createCellClickedHandler,
  createCellEditedHandler
} from "./logic/cellEditHandler";
import { createProvideEditor } from "./editors/provideEditor";
import { createDrawHeader } from "./renderers/drawHeader";
import { useDataGridColumns } from "./hooks/useDataGridColumns";
import { useDataGridContextMenu } from "./hooks/useDataGridContextMenu";
import { useHeaderMetaPopover } from "./hooks/useHeaderMetaPopover";
import { useDataGridMenuActions } from "./hooks/useDataGridMenuActions";
import { DataGridSurface } from "./components/DataGridSurface";

export type DataGridProps = {
  result: QueryResult;
  visibleColumns: string[];
  fieldMetadataMap: Record<string, Record<string, unknown>>;
  dirtyCellKeys: string[];
  selectedRecordIds: string[];
  // Salesforce 当前用户时区（IANA），用于 datetime 与 Salesforce Web 行为对齐。
  salesforceTimezone?: string | null;
  // 当前选中的数据源 ID：用于打开 Salesforce 记录页（可选）。
  sourceId?: string;
  // 当前数据源类型：用于控制 Salesforce 专属菜单项显隐。
  selectedSourceType?: string;
  // 当前对象 API 名称：用于打开 Salesforce 记录页（可选）。
  objectName?: string;
  // 待删除记录 Id 列表：用于将整行标记为灰色背景。
  pendingDeleteRecordIds: string[];
  onToggleRecord: (recordId: string, checked: boolean) => void;
  onToggleAll: (checked: boolean, recordIds: string[]) => void;
  onEditCell: (rowIndex: number, columnName: string, value: unknown) => void;
  onShowMessage: (message: string) => void;
  // 是否展示表头 info icon 与字段元数据悬浮层。
  showHeaderMetadata?: boolean;
  // 是否启用双击只读单元格时的提示逻辑。
  enableReadonlyCellHint?: boolean;
  // 是否显示勾选列（首列 checkbox）。
  showSelectionColumn?: boolean;
};

// 查询结果表：主入口只负责装配 hooks 与各模块能力。
export function DataGrid({
  result,
  visibleColumns,
  fieldMetadataMap,
  dirtyCellKeys,
  selectedRecordIds,
  salesforceTimezone,
  sourceId,
  selectedSourceType,
  objectName,
  pendingDeleteRecordIds,
  onToggleRecord,
  onToggleAll,
  onEditCell,
  onShowMessage,
  showHeaderMetadata = true,
  enableReadonlyCellHint = true,
  showSelectionColumn = true
}: DataGridProps) {
  const records = result.records;
  // 仅在时区字符串合法时启用 Salesforce 用户时区；非法值自动回退浏览器本地时区。
  const effectiveSalesforceTimezone = useMemo(
    () => resolveSalesforceTimezone(salesforceTimezone),
    [salesforceTimezone]
  );
  // MySQL 主键列名：当查询结果无 Id 时，用主键值作为记录键与勾选键。
  const mysqlPrimaryKeyField = useMemo(() => {
    if ((selectedSourceType || "salesforce").toLowerCase() !== "mysql") return "";
    const field = Object.entries(fieldMetadataMap).find(
      ([, metadata]) => String(metadata?.columnKey || "").toUpperCase() === "PRI"
    )?.[0];
    return field || "";
  }, [fieldMetadataMap, selectedSourceType]);

  const {
    columns,
    setColumnWidths,
    allChecked,
    hasAnyChecked,
    selectableIds
  } = useDataGridColumns({
    visibleColumns,
    showSelectionColumn,
    records,
    selectedRecordIds,
    fieldMetadataMap,
    selectedSourceType
  });

  const dirtyCellSet = useMemo(() => new Set(dirtyCellKeys), [dirtyCellKeys]);
  const pendingDeleteRecordSet = useMemo(() => new Set(pendingDeleteRecordIds), [pendingDeleteRecordIds]);
  const gridBodyRef = useRef<HTMLDivElement | null>(null);
  const { rowContextMenu, setRowContextMenu } = useDataGridContextMenu();
  const {
    hoveredHeaderMeta,
    setHoveredHeaderMeta,
    metaPanelHovering,
    setMetaPanelHovering,
    cancelMetaClose,
    scheduleMetaClose
  } = useHeaderMetaPopover();
  // 当前激活单元格：用于 provideEditor 判断是否为 picklist 编辑。
  const [activeEditorCell, setActiveEditorCell] = useState<Item | null>(null);
  const activeEditorCellRef = useRef<Item | null>(null);

  const { openRecordPageFromMenu, copyCellValueFromMenu, setCellNoneFromMenu } = useDataGridMenuActions({
    rowContextMenu,
    setRowContextMenu,
    sourceId,
    objectName,
    onEditCell,
    onShowMessage
  });

  const getRecordKey = useCallback((rowIndex: number): string => {
    const record = records[rowIndex] || {};
    if (record.__localId) return String(record.__localId);
    if (record.Id) return String(record.Id);
    if (mysqlPrimaryKeyField) {
      const value = record[mysqlPrimaryKeyField];
      if (value !== null && value !== undefined && String(value).trim() !== "") {
        return String(value);
      }
    }
    return `row-${rowIndex}`;
  }, [records, mysqlPrimaryKeyField]);

  const getCellContent = useMemo(
    () =>
      createGetCellContent({
        columns,
        records,
        fieldMetadataMap,
        selectedRecordIds,
        dirtyCellSet,
        pendingDeleteRecordSet,
        effectiveSalesforceTimezone,
        getRecordKey
      }),
    [
      columns,
      records,
      fieldMetadataMap,
      selectedRecordIds,
      dirtyCellSet,
      pendingDeleteRecordSet,
      effectiveSalesforceTimezone,
      getRecordKey
    ]
  );

  const handleCellEdited = useMemo(
    () =>
      createCellEditedHandler({
        columns,
        records,
        fieldMetadataMap,
        effectiveSalesforceTimezone,
        getRecordKey,
        onToggleRecord,
        onEditCell,
        onShowMessage
      }),
    [
      columns,
      records,
      fieldMetadataMap,
      effectiveSalesforceTimezone,
      getRecordKey,
      onToggleRecord,
      onEditCell,
      onShowMessage
    ]
  );

  const handleCellClicked = useMemo(
    () =>
      createCellClickedHandler({
        columns,
        records,
        fieldMetadataMap,
        enableReadonlyCellHint,
        onShowMessage
      }),
    [columns, records, fieldMetadataMap, enableReadonlyCellHint, onShowMessage]
  );

  const handleCellsEdited = useCallback((newValues: readonly EditListItem[]) => {
    newValues.forEach((item) => handleCellEdited(item.location, item.value as EditableGridCell));
  }, [handleCellEdited]);

  const provideEditor = useMemo(
    () =>
      createProvideEditor({
        activeEditorCell,
        activeEditorCellRef,
        columns,
        fieldMetadataMap,
        effectiveSalesforceTimezone,
        onShowMessage
      }),
    [
      activeEditorCell,
      columns,
      fieldMetadataMap,
      effectiveSalesforceTimezone,
      onShowMessage
    ]
  );

  const drawHeader = useMemo(
    () =>
      createDrawHeader({
        fieldMetadataMap,
        showHeaderMetadata,
        allChecked,
        hasAnyChecked
      }),
    [fieldMetadataMap, showHeaderMetadata, allChecked, hasAnyChecked]
  );

  if (records.length === 0) {
    return (
      // 空状态容器。
      <div className="p-2">
        {/* 空状态提示。 */}
        <span className="text-[12px] text-neutral/70">
          暂无查询结果。
        </span>
      </div>
    );
  }

  return (
    <DataGridSurface
      totalSize={result.totalSize}
      records={records}
      columns={columns}
      fieldMetadataMap={fieldMetadataMap}
      selectedSourceType={selectedSourceType}
      selectedRecordIds={selectedRecordIds}
      showHeaderMetadata={showHeaderMetadata}
      allChecked={allChecked}
      hasAnyChecked={hasAnyChecked}
      selectableIds={selectableIds}
      gridBodyRef={gridBodyRef}
      rowContextMenu={rowContextMenu}
      hoveredHeaderMeta={hoveredHeaderMeta}
      metaPanelHovering={metaPanelHovering}
      cancelMetaClose={cancelMetaClose}
      scheduleMetaClose={scheduleMetaClose}
      setMetaPanelHovering={setMetaPanelHovering}
      setRowContextMenu={setRowContextMenu}
      setHoveredHeaderMeta={setHoveredHeaderMeta}
      setColumnWidths={setColumnWidths}
      activeEditorCellRef={activeEditorCellRef}
      setActiveEditorCell={setActiveEditorCell}
      canOpenRecordPage={Boolean(sourceId && objectName && rowContextMenu?.recordId)}
      showOpenRecordPage={(selectedSourceType || "salesforce").toLowerCase() === "salesforce"}
      onToggleAll={onToggleAll}
      onCopyCell={() => {
        void copyCellValueFromMenu();
      }}
      onSetNone={setCellNoneFromMenu}
      onOpenRecordPage={() => {
        void openRecordPageFromMenu();
      }}
      getCellContent={getCellContent}
      onCellEdited={handleCellEdited}
      onCellClicked={handleCellClicked}
      onCellsEdited={handleCellsEdited}
      provideEditor={provideEditor}
      drawHeader={drawHeader}
    />
  );
}

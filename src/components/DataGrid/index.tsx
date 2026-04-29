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
  // 只读模式：开启后强制禁用单元格编辑（用于 SOQL 工作空间结果表）。
  readOnlyMode?: boolean;
  // 结果集只读原因：开启只读模式时透传到单元格提示文案。
  readOnlyReasonText?: string;
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
  // 是否允许只读单元格双击打开 overlay（仅查看，不可编辑）。
  allowReadonlyOverlay?: boolean;
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
  readOnlyMode = false,
  readOnlyReasonText = "",
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
  allowReadonlyOverlay = false,
  showSelectionColumn = true
}: DataGridProps) {
  const records = result.records;
  // 生效元数据：只读模式下统一覆写 createable/updateable，避免误触发编辑链路。
  const effectiveFieldMetadataMap = useMemo(() => {
    if (!readOnlyMode) return fieldMetadataMap;
    return Object.entries(fieldMetadataMap).reduce((acc, [fieldName, metadata]) => {
      acc[fieldName] = {
        ...(metadata || {}),
        createable: false,
        updateable: false,
        // 结果集级只读原因优先于字段自身原因，双击提示时直接解释为什么整张表不可编辑。
        resultReadonlyReason: readOnlyReasonText
      };
      return acc;
    }, {} as Record<string, Record<string, unknown>>);
  }, [fieldMetadataMap, readOnlyMode, readOnlyReasonText]);

  // 仅在时区字符串合法时启用 Salesforce 用户时区；非法值自动回退浏览器本地时区。
  const effectiveSalesforceTimezone = useMemo(
    () => resolveSalesforceTimezone(salesforceTimezone),
    [salesforceTimezone]
  );
  // MySQL 主键列名：当查询结果无 Id 时，用主键值作为记录键与勾选键。
  const mysqlPrimaryKeyField = useMemo(() => {
    if ((selectedSourceType || "salesforce").toLowerCase() !== "mysql") return "";
    const field = Object.entries(effectiveFieldMetadataMap).find(
      ([, metadata]) => String(metadata?.columnKey || "").toUpperCase() === "PRI"
    )?.[0];
    return field || "";
  }, [effectiveFieldMetadataMap, selectedSourceType]);

  const {
    columns,
    setColumnWidths,
    headerMinWidths,
    allChecked,
    hasAnyChecked,
    selectableIds
  } = useDataGridColumns({
    visibleColumns,
    showSelectionColumn,
    showHeaderMetadata,
    records,
    selectedRecordIds,
    fieldMetadataMap: effectiveFieldMetadataMap,
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

  const { openRecordPageFromMenu, copyCellValueFromMenu, setCellNullishFromMenu, setCellDefaultValueFromMenu } = useDataGridMenuActions({
    rowContextMenu,
    setRowContextMenu,
    sourceId,
    objectName,
    selectedSourceType,
    onEditCell,
    onShowMessage
  });

  const getRecordKey = useCallback((rowIndex: number): string => {
    const record = records[rowIndex] || {};
    if (record.__rowStableId) return String(record.__rowStableId);
    if (record.__localId) return String(record.__localId);
    if (record.Id) return String(record.Id);
    if (mysqlPrimaryKeyField) {
      const value = record[mysqlPrimaryKeyField];
      if (value !== null && value !== undefined && String(value).trim() !== "") {
        return String(value);
      }
    }
    return `row:${rowIndex}`;
  }, [records, mysqlPrimaryKeyField]);

  const getCellContent = useMemo(
    () =>
      createGetCellContent({
        columns,
        records,
        fieldMetadataMap: effectiveFieldMetadataMap,
        selectedRecordIds,
        dirtyCellSet,
        pendingDeleteRecordSet,
        effectiveSalesforceTimezone,
        selectedSourceType,
        getRecordKey,
        allowReadonlyOverlay
      }),
    [
      columns,
      records,
      effectiveFieldMetadataMap,
      selectedRecordIds,
      dirtyCellSet,
      pendingDeleteRecordSet,
      effectiveSalesforceTimezone,
      selectedSourceType,
      getRecordKey,
      allowReadonlyOverlay
    ]
  );

  const handleCellEdited = useMemo(
    () =>
      createCellEditedHandler({
        columns,
        records,
        fieldMetadataMap: effectiveFieldMetadataMap,
        effectiveSalesforceTimezone,
        selectedSourceType,
        getRecordKey,
        onToggleRecord,
        onEditCell,
        onShowMessage
      }),
    [
      columns,
      records,
      effectiveFieldMetadataMap,
      effectiveSalesforceTimezone,
      selectedSourceType,
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
        fieldMetadataMap: effectiveFieldMetadataMap,
        enableReadonlyCellHint,
        onShowMessage
      }),
    [columns, records, effectiveFieldMetadataMap, enableReadonlyCellHint, onShowMessage]
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
        fieldMetadataMap: effectiveFieldMetadataMap,
        effectiveSalesforceTimezone,
        onShowMessage
      }),
    [
      activeEditorCell,
      columns,
      effectiveFieldMetadataMap,
      effectiveSalesforceTimezone,
      onShowMessage
    ]
  );

  const drawHeader = useMemo(
    () =>
      createDrawHeader({
        fieldMetadataMap: effectiveFieldMetadataMap,
        showHeaderMetadata,
        allChecked,
        hasAnyChecked
      }),
    [effectiveFieldMetadataMap, showHeaderMetadata, allChecked, hasAnyChecked]
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
      fieldMetadataMap={effectiveFieldMetadataMap}
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
      headerMinWidths={headerMinWidths}
      activeEditorCellRef={activeEditorCellRef}
      setActiveEditorCell={setActiveEditorCell}
      canOpenRecordPage={Boolean(sourceId && objectName && rowContextMenu?.recordId)}
      showOpenRecordPage={(selectedSourceType || "salesforce").toLowerCase() === "salesforce"}
      onToggleAll={onToggleAll}
      onCopyCell={() => {
        void copyCellValueFromMenu();
      }}
      onSetNullish={setCellNullishFromMenu}
      onSetDefaultValue={setCellDefaultValueFromMenu}
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

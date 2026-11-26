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
import { resolveBroadcastPasteEdits } from "./logic/paste";
import { createProvideEditor } from "./editors/provideEditor";
import { createDrawHeader } from "./renderers/drawHeader";
import { useDataGridColumns } from "./hooks/useDataGridColumns";
import { useDataGridContextMenu } from "./hooks/useDataGridContextMenu";
import { useHeaderMetaPopover } from "./hooks/useHeaderMetaPopover";
import { useDataGridMenuActions } from "./hooks/useDataGridMenuActions";
import { DataGridSurface } from "./components/DataGridSurface";
import { LargeCellViewerModal } from "./components/LargeCellViewerModal";
import { useDataGridRuntimeScroll } from "../../store/useDataGridScrollStore";
import { salesforceDriver } from "../../drivers/salesforce";
import type { GridAdapter } from "../../drivers/types";
import { api } from "../../api";

export type DataGridProps = {
  result: QueryResult;
  // 当前每页条数：用于结果头部分页器展示。
  pageSize?: number;
  // 当前偏移量：用于分页器范围文案与翻页状态。
  currentOffset?: number;
  visibleColumns: string[];
  fieldMetadataMap: Record<string, Record<string, unknown>>;
  dirtyCellKeys: string[];
  selectedRecordIds: string[];
  // 只读模式：开启后强制禁用单元格编辑（用于 SOQL 工作空间结果表）。
  readOnlyMode?: boolean;
  // 结果集只读原因：开启只读模式时透传到单元格提示文案。
  readOnlyReasonText?: string;
  // 展示与编辑时区（IANA）。
  displayTimezone?: string | null;
  // 当前选中的数据源 ID（用于按需加载大字段或打开外部记录页）。
  sourceId?: string;
  // 数据源表格适配器（由调用方通过驱动注册表注入，默认回退 Salesforce 适配器）。
  gridAdapter?: GridAdapter;
  // 是否严格保留 visibleColumns 的输入顺序。
  preserveColumnOrder?: boolean;
  // 当前对象 API 名称：用于打开 Salesforce 记录页（可选）。
  objectName?: string;
  // 待删除记录 Id 列表：用于将整行标记为灰色背景。
  pendingDeleteRecordIds: string[];
  onToggleAll: (checked: boolean, recordIds: string[]) => void;
  onEditCell: (rowIndex: number, columnName: string, value: unknown) => void;
  onShowMessage: (message: string) => void;
  // 是否展示表头 info icon 与字段元数据悬浮层。
  showHeaderMetadata?: boolean;
  // 是否启用双击只读单元格时的提示逻辑。
  enableReadonlyCellHint?: boolean;
  // 是否允许只读单元格双击打开 overlay（仅查看，不可编辑）。
  allowReadonlyOverlay?: boolean;
  // 修改每页条数：用于分页器下拉回写 QueryPanel 当前 limit。
  onPageSizeChange?: (pageSize: number) => void;
  // 分页导航：用于首页/上一页/下一页/末页触发重查。
  onPageNavigate?: (action: "first" | "previous" | "next" | "last") => void;
  // 运行态滚动状态 key：用于在当前会话内按 tab 记住横纵滚动位置。
  scrollStateKey?: string;
};

// 查询结果表：主入口只负责装配 hooks 与各模块能力。
export function DataGrid({
  result,
  pageSize = 200,
  currentOffset = 0,
  visibleColumns,
  fieldMetadataMap,
  dirtyCellKeys,
  selectedRecordIds,
  readOnlyMode = false,
  readOnlyReasonText = "",
  displayTimezone,
  sourceId,
  gridAdapter = salesforceDriver.gridAdapter,
  preserveColumnOrder = false,
  objectName,
  pendingDeleteRecordIds,
  onToggleAll,
  onEditCell,
  onShowMessage,
  showHeaderMetadata = true,
  enableReadonlyCellHint = true,
  allowReadonlyOverlay = false,
  onPageSizeChange,
  onPageNavigate,
  scrollStateKey
}: DataGridProps) {
  const records = result.records;
  // 当前表格运行态滚动位置：按 key 绑定，仅在本次运行内保留。
  const { scrollOffsetX, scrollOffsetY, onScrollOffsetChange } = useDataGridRuntimeScroll(scrollStateKey);
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

  // 仅在时区字符串合法时启用；非法值自动回退浏览器本地时区。
  const effectiveTimezone = useMemo(
    () => resolveSalesforceTimezone(displayTimezone),
    [displayTimezone]
  );
  // 通过 GridAdapter 解析当前数据源的主键字段，消除表格组件硬编码分支。
  const primaryKeyField = useMemo(
    () => gridAdapter.resolvePrimaryKeyField(effectiveFieldMetadataMap),
    [effectiveFieldMetadataMap, gridAdapter]
  );

  const { columns, setColumnWidths, headerMinWidths, selectableIds } = useDataGridColumns({
    visibleColumns,
    preserveColumnOrder,
    showHeaderMetadata,
    records,
    fieldMetadataMap: effectiveFieldMetadataMap,
    gridAdapter,
    currentOffset
  });

  const dirtyCellSet = useMemo(() => new Set(dirtyCellKeys), [dirtyCellKeys]);
  const selectedRecordSet = useMemo(() => new Set(selectedRecordIds), [selectedRecordIds]);
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
  // 截断大字段按需检视弹窗状态。
  const [largeCellTarget, setLargeCellTarget] = useState<{
    columnName: string;
    totalChars: number;
    previewText: string;
    loading: boolean;
    fullText: string | null;
    error: string;
  } | null>(null);

  const { openRecordPageFromMenu, copyCellValueFromMenu, setCellNullishFromMenu, setCellDefaultValueFromMenu } = useDataGridMenuActions({
    rowContextMenu,
    setRowContextMenu,
    sourceId,
    objectName,
    gridAdapter,
    onEditCell,
    onShowMessage
  });

  const getRecordKey = useCallback((rowIndex: number): string => {
    const record = records[rowIndex] || {};
    if (record.__rowStableId) return String(record.__rowStableId);
    if (record.__localId) return String(record.__localId);
    const resolvedKey = gridAdapter.resolveRecordKey(record, primaryKeyField);
    if (resolvedKey) return resolvedKey;
    return `row:${rowIndex}`;
  }, [records, gridAdapter, primaryKeyField]);

  const getCellContent = useMemo(
    () =>
      createGetCellContent({
        columns,
        records,
        fieldMetadataMap: effectiveFieldMetadataMap,
        selectedRecordSet,
        dirtyCellSet,
        pendingDeleteRecordSet,
        effectiveTimezone,
        gridAdapter,
        getRecordKey,
        currentOffset,
        allowReadonlyOverlay
      }),
    [
      columns,
      records,
      effectiveFieldMetadataMap,
      selectedRecordSet,
      dirtyCellSet,
      pendingDeleteRecordSet,
      effectiveTimezone,
      gridAdapter,
      getRecordKey,
      currentOffset,
      allowReadonlyOverlay
    ]
  );

  const handleCellEdited = useMemo(
    () =>
      createCellEditedHandler({
        columns,
        records,
        fieldMetadataMap: effectiveFieldMetadataMap,
        effectiveTimezone,
        gridAdapter,
        onEditCell,
        onShowMessage
      }),
    [
      columns,
      records,
      effectiveFieldMetadataMap,
      effectiveTimezone,
      gridAdapter,
      onEditCell,
      onShowMessage
    ]
  );

  // 双击截断大字段时弹出检视窗并按主键按需拉取完整内容。
  const handleInspectTruncatedCell = useCallback(
    (params: { record: Record<string, unknown>; columnName: string; totalChars: number; previewText: string }) => {
      const pkField = primaryKeyField || (params.record.Id !== undefined ? "Id" : "");
      const pkValue = pkField ? params.record[pkField] : undefined;
      const canFetchFull = Boolean(sourceId && objectName && pkField && pkValue !== null && pkValue !== undefined);

      setLargeCellTarget({
        columnName: params.columnName,
        totalChars: params.totalChars,
        previewText: params.previewText,
        loading: canFetchFull,
        fullText: null,
        error: ""
      });

      if (!canFetchFull || !sourceId || !objectName) return;

      void api
        .readCellFullValue({
          sourceId,
          objectName,
          primaryKeyField: pkField,
          primaryKeyValue: String(pkValue),
          columnName: params.columnName
        })
        .then((full) => {
          setLargeCellTarget((prev) =>
            prev && prev.columnName === params.columnName
              ? { ...prev, loading: false, fullText: full ?? "" }
              : prev
          );
        })
        .catch((err) => {
          setLargeCellTarget((prev) =>
            prev && prev.columnName === params.columnName
              ? { ...prev, loading: false, error: String(err) }
              : prev
          );
        });
    },
    [primaryKeyField, sourceId, objectName]
  );

  const handleCellClicked = useMemo(
    () =>
      createCellClickedHandler({
        columns,
        records,
        fieldMetadataMap: effectiveFieldMetadataMap,
        gridAdapter,
        enableReadonlyCellHint,
        onInspectTruncatedCell: handleInspectTruncatedCell,
        onShowMessage
      }),
    [columns, records, effectiveFieldMetadataMap, gridAdapter, enableReadonlyCellHint, handleInspectTruncatedCell, onShowMessage]
  );

  const handleCellsEdited = useCallback((newValues: readonly EditListItem[]) => {
    newValues.forEach((item) => handleCellEdited(item.location, item.value as EditableGridCell));
  }, [handleCellEdited]);

  const handlePaste = useCallback((
    _target: Item,
    values: readonly (readonly string[])[],
    selectedLocations: readonly Item[]
  ) => {
    const broadcastEdits = resolveBroadcastPasteEdits({
      selectedLocations,
      pastedValues: values
    });
    if (!broadcastEdits) {
      return true; // 行内注释：未命中特殊场景时继续走 Glide 默认矩形粘贴。
    }
    handleCellsEdited(broadcastEdits);
    return false; // 行内注释：已手动分发批量编辑，阻止 Glide 再重复写入。
  }, [handleCellsEdited]);

  const provideEditor = useMemo(
    () =>
      createProvideEditor({
        activeEditorCell,
        activeEditorCellRef,
        columns,
        fieldMetadataMap: effectiveFieldMetadataMap,
        gridAdapter,
        effectiveTimezone,
        onShowMessage
      }),
    [
      activeEditorCell,
      columns,
      effectiveFieldMetadataMap,
      gridAdapter,
      effectiveTimezone,
      onShowMessage
    ]
  );

  const drawHeader = useMemo(
    () =>
      createDrawHeader({
        fieldMetadataMap: effectiveFieldMetadataMap,
        showHeaderMetadata
      }),
    [effectiveFieldMetadataMap, showHeaderMetadata]
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
    <>
      <DataGridSurface
        records={records}
        columns={columns}
        fieldMetadataMap={effectiveFieldMetadataMap}
        gridAdapter={gridAdapter}
        selectedRecordIds={selectedRecordIds}
        showHeaderMetadata={showHeaderMetadata}
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
        showOpenRecordPage={gridAdapter.supportsOpenRecordPage}
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
        onPaste={handlePaste}
        provideEditor={provideEditor}
        drawHeader={drawHeader}
        scrollOffsetX={scrollOffsetX}
        scrollOffsetY={scrollOffsetY}
        onScrollOffsetChange={onScrollOffsetChange}
      />

      {/* 超大字段按需加载检视弹窗。 */}
      <LargeCellViewerModal target={largeCellTarget} onClose={() => setLargeCellTarget(null)} />
    </>
  );
}

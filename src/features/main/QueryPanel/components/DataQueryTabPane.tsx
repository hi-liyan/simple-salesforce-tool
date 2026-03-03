import { useEffect, useMemo, useRef, useState } from "react";
import { PanelRightOpen, Play, Plus, RotateCcw, ScrollText, Search, Trash2, X } from "lucide-react";
import { DataGrid } from "../../../../components/DataGrid";
import { NoticeAlert } from "../../../../components/NoticeAlert";
import { SoqlMonacoEditor } from "../../../../components/SoqlMonacoEditor";
import { api } from "../../../../api";
import { Notice, ObjectDdl, TabState } from "../../../../types";
import { MysqlSmartInput } from "./MysqlSmartInput";

// MySQL 函数候选：覆盖常见字符串、日期、聚合、空值处理函数。
const MYSQL_FUNCTION_SUGGESTIONS = [
  "COUNT()",
  "SUM()",
  "AVG()",
  "MIN()",
  "MAX()",
  "NOW()",
  "CURDATE()",
  "DATE_FORMAT()",
  "DATE_ADD()",
  "DATE_SUB()",
  "TIMESTAMPDIFF()",
  "IFNULL()",
  "COALESCE()",
  "NULLIF()",
  "CONCAT()",
  "SUBSTRING()",
  "LENGTH()",
  "LOWER()",
  "UPPER()",
  "TRIM()",
  "ROUND()",
  "FLOOR()",
  "CEIL()"
];

// MySQL 关键字候选：用于 WHERE/ORDER BY 快速补全。
const MYSQL_KEYWORD_SUGGESTIONS = [
  "AND",
  "OR",
  "NOT",
  "IN",
  "LIKE",
  "BETWEEN",
  "IS NULL",
  "IS NOT NULL",
  "EXISTS",
  "ASC",
  "DESC"
];

type DataQueryTabPaneProps = {
  // 当前选中的数据源 ID：用于打开外部 Salesforce 页面。
  selectedSourceId: string;
  // 当前选中的数据源类型：用于切换 SQL/SOQL 查询栏形态。
  selectedSourceType: string;
  // Salesforce 当前用户时区（IANA），用于 datetime 与 Salesforce Web 一致显示。
  salesforceTimezone?: string | null;
  // MySQL DDL 数据：用于 DDL 抽屉展示建表/索引/约束语句。
  mysqlDdl: ObjectDdl | null;
  // MySQL DDL 加载中状态。
  mysqlDdlLoading: boolean;
  // MySQL DDL 加载错误。
  mysqlDdlError: string;
  tabs: TabState[];
  activeTabObjectName: string;
  activeTab: TabState | null;
  workspaceNotice: Notice | null;
  visibleColumns: string[];
  fieldMetadataMap: Record<string, Record<string, unknown>>;
  hasPendingChanges: boolean;
  // 待删除记录 Id 列表：用于在表格中高亮“将要删除”的行。
  pendingDeleteRecordIds: string[];
  onActivateTab: (objectName: string) => void;
  onCloseTab: (objectName: string) => void;
  // 关闭当前（右键菜单：关闭当前）。
  onCloseCurrentTab: (objectName: string) => void;
  // 关闭左侧（右键菜单：关闭左侧）。
  onCloseLeftTabs: (objectName: string) => void;
  // 关闭右侧（右键菜单：关闭右侧）。
  onCloseRightTabs: (objectName: string) => void;
  // 关闭其他（右键菜单：关闭其他）。
  onCloseOtherTabs: (objectName: string) => void;
  // 全部关闭（右键菜单：全部关闭）。
  onCloseAllTabs: () => void;
  onCreateRecord: () => void;
  onDeleteCheckedRecords: () => void;
  onApplyPendingChanges: () => void;
  onDiscardPendingChanges: () => void;
  onToggleDrawer: () => void;
  // 刷新当前对象 DDL：仅 MySQL 抽屉使用。
  onRefreshMysqlDdl: () => void;
  onToggleQueryBar: () => void;
  onToggleLogs: () => void;
  onWhereChange: (value: string) => void;
  onLimitChange: (value: number) => void;
  onSortFieldChange: (value: string) => void;
  onSortDirectionChange: (value: "ASC" | "DESC") => void;
  onSortClauseChange: (value: string) => void;
  onQuery: () => void;
  onToggleRecord: (recordId: string, checked: boolean) => void;
  onToggleAllRecords: (checked: boolean, recordIds: string[]) => void;
  onEditCell: (rowIndex: number, columnName: string, value: unknown) => void;
  onShowMessage: (message: string) => void;
  onToggleAllFields: () => void;
  onToggleFieldVisibility: (fieldName: string, checked: boolean) => void;
  onSoqlChange: (value: string) => void;
  onExecuteCustomSoql: () => void;
  onCloseWorkspaceNotice: () => void;
  onCloseActiveTabNotice: () => void;
  loadingText: string;
  // 可补全的对象名集合：来自当前数据源 Objects 列表。
  objectNames: string[];
  // 是否隐藏内置 Tab 栏：用于统一工作区模式下由外层渲染混合 Tab。
  hideTabBar?: boolean;
};

// 右侧工作区：包含 Tab、查询工具栏、数据表格、日志面板和字段抽屉。
export function DataQueryTabPane({
  selectedSourceId,
  selectedSourceType,
  salesforceTimezone,
  mysqlDdl,
  mysqlDdlLoading,
  mysqlDdlError,
  tabs,
  activeTabObjectName,
  activeTab,
  workspaceNotice,
  visibleColumns,
  fieldMetadataMap,
  hasPendingChanges,
  pendingDeleteRecordIds,
  onActivateTab,
  onCloseTab,
  onCloseCurrentTab,
  onCloseLeftTabs,
  onCloseRightTabs,
  onCloseOtherTabs,
  onCloseAllTabs,
  onCreateRecord,
  onDeleteCheckedRecords,
  onApplyPendingChanges,
  onDiscardPendingChanges,
  onToggleDrawer,
  onRefreshMysqlDdl,
  onToggleQueryBar,
  onToggleLogs,
  onWhereChange,
  onLimitChange,
  onSortFieldChange,
  onSortDirectionChange,
  onSortClauseChange,
  onQuery,
  onToggleRecord,
  onToggleAllRecords,
  onEditCell,
  onShowMessage,
  onToggleAllFields,
  onToggleFieldVisibility,
  onSoqlChange,
  onExecuteCustomSoql,
  onCloseWorkspaceNotice,
  onCloseActiveTabNotice,
  loadingText,
  objectNames,
  hideTabBar = false
}: DataQueryTabPaneProps) {
  // 根据数据源类型切换查询栏布局（MySQL 使用 SQL 手工排序表达式）。
  const isMysqlSource = (selectedSourceType || "salesforce").toLowerCase() === "mysql";
  // 日志面板高度状态。
  const [logPanelHeight, setLogPanelHeight] = useState(220);
  // 是否正在拖拽日志面板分隔条。
  const [draggingLogResize, setDraggingLogResize] = useState(false);
  const dragStartYRef = useRef(0);
  const dragStartHeightRef = useRef(220);
  // 字段与 SOQL 抽屉宽度状态：支持鼠标拖拽调整。
  const [drawerWidth, setDrawerWidth] = useState(360);
  // 是否正在拖拽抽屉宽度分隔条。
  const [draggingDrawerResize, setDraggingDrawerResize] = useState(false);
  // 抽屉拖拽起始点 X 坐标。
  const drawerResizeStartXRef = useRef(0);
  // 抽屉拖拽起始宽度。
  const drawerResizeStartWidthRef = useRef(360);
  // 拖拽前 body 的 user-select 样式，结束拖拽后恢复。
  const prevBodyUserSelectRef = useRef("");
  // 拖拽前 body 的 cursor 样式，结束拖拽后恢复。
  const prevBodyCursorRef = useRef("");
  // Tab 右键菜单状态：记录显示位置和目标 Tab。
  const [tabContextMenu, setTabContextMenu] = useState<{ x: number; y: number; objectName: string } | null>(null);
  // 编辑器对象字段缓存：支持 FROM 任意对象后做字段补全。
  const [soqlObjectFieldsMap, setSoqlObjectFieldsMap] = useState<Record<string, string[]>>({});

  // 日志面板拖拽调整高度。
  useEffect(() => {
    if (!draggingLogResize) return;

    const onMouseMove = (event: MouseEvent) => {
      const delta = dragStartYRef.current - event.clientY;
      const next = dragStartHeightRef.current + delta;
      const max = Math.max(260, Math.floor(window.innerHeight * 0.72));
      setLogPanelHeight(Math.max(140, Math.min(max, next)));
    };

    const onMouseUp = () => {
      setDraggingLogResize(false);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [draggingLogResize]);

  // 字段与 SOQL 抽屉拖拽调整宽度：鼠标移动时更新宽度，抬起时结束拖拽。
  useEffect(() => {
    if (!draggingDrawerResize) return;

    // 进入拖拽：禁用文本选中并统一鼠标样式，避免误选中与拖拽卡顿。
    prevBodyUserSelectRef.current = document.body.style.userSelect;
    prevBodyCursorRef.current = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const onMouseMove = (event: MouseEvent) => {
      const deltaX = drawerResizeStartXRef.current - event.clientX; // 抽屉从左边缘拖拽，向左移动时宽度增大。
      const rawWidth = drawerResizeStartWidthRef.current + deltaX;
      const maxWidth = Math.min(560, Math.max(420, Math.floor(window.innerWidth * 0.5))); // 双重上限：按窗口比例限制，并设置固定封顶，避免大屏下抽屉过宽。
      const nextWidth = Math.max(280, Math.min(maxWidth, rawWidth)); // 最小宽度限制：避免抽屉内容不可读。
      setDrawerWidth(nextWidth);
    };

    const onMouseUp = () => {
      setDraggingDrawerResize(false); // 结束拖拽状态，解除全局监听。
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      // 退出拖拽：恢复页面原有光标与文本选中样式。
      document.body.style.userSelect = prevBodyUserSelectRef.current;
      document.body.style.cursor = prevBodyCursorRef.current;
    };
  }, [draggingDrawerResize]);

  // 全局关闭右键菜单：点击空白、滚动、按下 ESC 时关闭菜单。
  useEffect(() => {
    if (!tabContextMenu) return;

    const closeMenu = () => {
      setTabContextMenu(null); // 关闭菜单，避免残留浮层。
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeMenu(); // ESC 快捷关闭菜单。
    };

    window.addEventListener("click", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [tabContextMenu]);

  // 当前对象可排序字段：仅展示字段元数据中 sortable=true 的字段。
  const sortableFields = (activeTab?.describe?.fields || []).filter((field) => field.metadata?.sortable === true);
  // 当前对象字段名候选：MySQL 查询栏自动补全使用。
  const mysqlFieldSuggestions = useMemo(() => (activeTab?.describe?.fields || []).map((field) => field.name), [activeTab?.describe?.fields]);
  // WHERE 输入框候选：字段 + 函数 + 关键字。
  const mysqlWhereSuggestions = useMemo(
    () => [...mysqlFieldSuggestions, ...MYSQL_FUNCTION_SUGGESTIONS, ...MYSQL_KEYWORD_SUGGESTIONS],
    [mysqlFieldSuggestions]
  );
  // 排序输入框候选：字段 + 排序方向 + 常见函数。
  const mysqlSortSuggestions = useMemo(
    () => [...mysqlFieldSuggestions, "ASC", "DESC", ...MYSQL_FUNCTION_SUGGESTIONS],
    [mysqlFieldSuggestions]
  );

  useEffect(() => {
    setSoqlObjectFieldsMap({}); // 切换数据源后清空缓存，避免跨源字段污染。
  }, [selectedSourceId]);

  // 抽屉 SOQL 自动格式化：把“单行长 SQL”转换为多行，提升可读性。
  useEffect(() => {
    if (!activeTab) return;
    const formattedSoql = formatSingleLineSoqlForDrawer(activeTab.soqlDraft);
    if (formattedSoql === activeTab.soqlDraft) return;
    onSoqlChange(formattedSoql); // 仅在格式化结果变化时写回，避免循环更新。
  }, [activeTab, onSoqlChange]);

  useEffect(() => {
    if (!selectedSourceId || !activeTab) return;
    const fromObjectNames = extractFromObjectNames(activeTab.soqlDraft);
    if (fromObjectNames.length === 0) return;
    const queryableObjectNameSet = new Set(objectNames.map((name) => name.toLowerCase()));
    const loadedObjectNameSet = new Set(Object.keys(soqlObjectFieldsMap).map((name) => name.toLowerCase()));
    const unloadedObjectNames = fromObjectNames.filter((objectName) => {
      if (!queryableObjectNameSet.has(objectName.toLowerCase())) return false; // 仅加载当前数据源可查询对象。
      return !loadedObjectNameSet.has(objectName.toLowerCase());
    });
    if (unloadedObjectNames.length === 0) return;

    let cancelled = false;
    void Promise.all(
      unloadedObjectNames.map(async (objectName) => {
        try {
          const describe = await api.describeObject(selectedSourceId, objectName);
          return {
            objectName,
            fields: describe.fields.map((field) => field.name)
          };
        } catch {
          return null; // describe 失败时忽略，不阻塞其它对象字段加载。
        }
      })
    ).then((describes) => {
      if (cancelled) return;
      const loadedEntries = describes.filter((item): item is { objectName: string; fields: string[] } => Boolean(item));
      if (loadedEntries.length === 0) return;
      setSoqlObjectFieldsMap((current) => {
        const next = { ...current };
        loadedEntries.forEach((item) => {
          next[item.objectName] = item.fields; // 写入缓存，供编辑器上下文补全读取。
        });
        return next;
      });
    });

    return () => {
      cancelled = true; // 避免异步返回后写入已失效状态。
    };
  }, [selectedSourceId, activeTab, objectNames, soqlObjectFieldsMap]);

  return (
    <>
      {/* 工作区全局提示。 */}
      {workspaceNotice && (
        <NoticeAlert
          tone={workspaceNotice.type === "error" ? "error" : "success"}
          message={workspaceNotice.message}
          onClose={onCloseWorkspaceNotice}
          className="fixed right-4 top-4 z-[60] max-w-[380px] shadow-lg"
        />
      )}

      {!hideTabBar && (
        <>
          {/* Tab 栏。 */}
          <div className="flex overflow-x-auto border-b border-base-300">
            {tabs.length === 0 && <span className="px-2 py-1.5 text-[12px] text-neutral/70">请选择左侧 Object 打开标签页</span>}
            {tabs.map((tab) => {
              const active = tab.objectName === activeTabObjectName;
              const tabIndex = tabs.findIndex((item) => item.objectName === tab.objectName);
              const hasLeftTabs = tabIndex > 0;
              const hasRightTabs = tabIndex >= 0 && tabIndex < tabs.length - 1;
              const hasOtherTabs = tabs.length > 1;
              return (
                <div
                  key={tab.objectName}
                  className={`flex items-center border-r border-base-300 ${active ? "bg-base-100" : ""}`}
                  onContextMenu={(event) => {
                    event.preventDefault(); // 阻止浏览器默认右键菜单。
                    onActivateTab(tab.objectName); // 右键时先切换到目标 Tab，避免操作目标不一致。
                    setTabContextMenu({ x: event.clientX, y: event.clientY, objectName: tab.objectName }); // 打开自定义菜单。
                  }}
                >
                  <button
                    className={`min-w-0 px-3 py-2 text-[12px] ${active ? "text-primary" : "text-neutral/70"}`}
                    onClick={() => onActivateTab(tab.objectName)}
                  >
                    {tab.objectName}
                  </button>
                  <button className="btn btn-circle btn-ghost btn-xs mr-1" onClick={() => onCloseTab(tab.objectName)}>
                    <X size={13} />
                  </button>
                  {/* Tab 右键菜单：提供常见批量关闭操作。 */}
                  {tabContextMenu?.objectName === tab.objectName && (
                    <div
                      className="fixed z-[80] min-w-[132px] rounded border border-base-300 bg-base-100 p-1 shadow-xl"
                      style={{ left: tabContextMenu.x, top: tabContextMenu.y }}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <button
                        className="btn btn-ghost btn-xs w-full justify-start"
                        onClick={() => {
                          onCloseCurrentTab(tab.objectName); // 关闭当前 Tab。
                          setTabContextMenu(null); // 执行后关闭菜单。
                        }}
                      >
                        关闭当前
                      </button>
                      <button
                        className="btn btn-ghost btn-xs w-full justify-start"
                        disabled={!hasLeftTabs}
                        onClick={() => {
                          onCloseLeftTabs(tab.objectName); // 关闭目标 Tab 左侧所有 Tab。
                          setTabContextMenu(null); // 执行后关闭菜单。
                        }}
                      >
                        关闭左侧
                      </button>
                      <button
                        className="btn btn-ghost btn-xs w-full justify-start"
                        disabled={!hasRightTabs}
                        onClick={() => {
                          onCloseRightTabs(tab.objectName); // 关闭目标 Tab 右侧所有 Tab。
                          setTabContextMenu(null); // 执行后关闭菜单。
                        }}
                      >
                        关闭右侧
                      </button>
                      <button
                        className="btn btn-ghost btn-xs w-full justify-start"
                        disabled={!hasOtherTabs}
                        onClick={() => {
                          onCloseOtherTabs(tab.objectName); // 仅保留目标 Tab，关闭其它 Tab。
                          setTabContextMenu(null); // 执行后关闭菜单。
                        }}
                      >
                        关闭其他
                      </button>
                      <button
                        className="btn btn-ghost btn-xs w-full justify-start"
                        disabled={tabs.length === 0}
                        onClick={() => {
                          onCloseAllTabs(); // 关闭全部 Tab。
                          setTabContextMenu(null); // 执行后关闭菜单。
                        }}
                      >
                        全部关闭
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {activeTab && (
        // 主工作区。
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          {/* 当前 Tab 提示。 */}
          {activeTab.notice && (
            <NoticeAlert
              tone={activeTab.notice.type === "error" ? "error" : "success"}
              message={activeTab.notice.message}
              onClose={onCloseActiveTabNotice}
              className="absolute right-3 top-2.5 z-40 max-w-[380px] shadow"
            />
          )}

          {/* 左侧主内容区：工具栏 + 查询栏 + 表格 + 日志。 */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="border-b border-base-300 px-3 py-1.5 overflow-x-auto">
              <div className="flex flex-row items-center gap-1 min-w-max">
                <button className="btn btn-outline btn-sm h-10" disabled={activeTab.loading} onClick={onCreateRecord}>
                  <Plus size={14} />
                  新建记录
                </button>
                <button
                  className="btn btn-outline btn-error btn-sm h-10"
                  disabled={activeTab.loading || activeTab.selectedRecordIds.length === 0}
                  onClick={onDeleteCheckedRecords}
                >
                  <Trash2 size={14} />
                  删除勾选({activeTab.selectedRecordIds.length})
                </button>
                <button className="btn btn-outline btn-sm h-10" disabled={activeTab.loading || !hasPendingChanges} onClick={onApplyPendingChanges}>
                  <Play size={14} />
                  执行更新
                </button>
                <button className="btn btn-outline btn-sm h-10" disabled={activeTab.loading || !hasPendingChanges} onClick={onDiscardPendingChanges}>
                  <RotateCcw size={14} />
                  撤回修改
                </button>
                <button className="btn btn-outline btn-sm h-10" disabled={activeTab.loading} onClick={onToggleQueryBar}>
                  <Search size={14} />
                  {activeTab.showQueryBar ? "隐藏查询栏" : "显示查询栏"}
                </button>
                <button className="btn btn-outline btn-sm h-10" disabled={activeTab.loading} onClick={onToggleDrawer}>
                  <PanelRightOpen size={14} />
                  {isMysqlSource ? "DDL" : "字段与SOQL"}
                </button>
                <button className="btn btn-outline btn-sm h-10" disabled={activeTab.loading} onClick={onToggleLogs}>
                  <ScrollText size={14} />
                  日志
                </button>
              </div>
            </div>

            {/* 查询栏。 */}
            {activeTab.showQueryBar && (
              <div className="border-b border-base-300 px-3 py-2">
                <div className="flex min-w-max flex-row items-end gap-2">
                  {isMysqlSource ? (
                    <MysqlSmartInput
                      label="WHERE"
                      value={activeTab.whereClause}
                      placeholder="例如：status = 'ACTIVE' AND created_at >= '2025-01-01'"
                      // MySQL WHERE：联动更新 Tab 查询条件。
                      onChange={onWhereChange}
                      // 候选包含字段、函数与关键字。
                      suggestions={mysqlWhereSuggestions}
                      // 本地缓存键：保持 WHERE 输入宽度。
                      widthStorageKey="query-panel.mysql.where.width"
                      // 默认宽度：与旧版视觉接近。
                      defaultWidth={360}
                      // 允许快速清空 WHERE。
                      allowClear
                    />
                  ) : (
                    <div className="w-[320px]">
                      <label className="mb-1 block text-[12px]">WHERE</label>
                      <div className="relative">
                        <input
                          className="input input-bordered input-sm w-full pr-8"
                          value={activeTab.whereClause}
                          // 关闭系统文本替换，避免 macOS 下英文单引号被自动转换为弯引号/中文引号。
                          autoCorrect="off"
                          autoCapitalize="off"
                          spellCheck={false}
                          onChange={(event) => onWhereChange(event.target.value)}
                        />
                        {activeTab.whereClause ? (
                          <button
                            className="btn btn-circle btn-ghost btn-xs absolute right-1 top-1/2 -translate-y-1/2"
                            aria-label="清空 WHERE 条件"
                            onClick={() => onWhereChange("")}
                          >
                            <X size={13} />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  )}

                  {isMysqlSource ? (
                    <>
                      <MysqlSmartInput
                        label="排序"
                        value={activeTab.sortClause || ""}
                        placeholder="例如：created_at DESC, id ASC"
                        // MySQL 排序表达式：直接写入 sortClause。
                        onChange={onSortClauseChange}
                        // 排序候选：字段 + 方向 + 常用函数。
                        suggestions={mysqlSortSuggestions}
                        // 本地缓存键：保持排序输入宽度。
                        widthStorageKey="query-panel.mysql.sort.width"
                        // 默认宽度：略窄于 WHERE。
                        defaultWidth={300}
                        // 排序有值时显示清空按钮，与 WHERE 行为一致。
                        allowClear
                      />

                      <div className="w-[90px]">
                        <label className="mb-1 block text-[12px]">LIMIT</label>
                        <input
                          className="input input-bordered input-sm h-[38px] min-h-[38px] w-full leading-[20px]"
                          type="number"
                          value={activeTab.limit}
                          onChange={(event) => onLimitChange(Number(event.target.value || 200))}
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="w-[200px]">
                        <label className="mb-1 block text-[12px]">排序字段</label>
                        <select
                          className="select select-bordered select-sm w-full"
                          value={activeTab.sortField}
                          disabled={sortableFields.length === 0}
                          onChange={(event) => onSortFieldChange(event.target.value)}
                        >
                          {sortableFields.length === 0 && <option value="">无可排序字段</option>}
                          {sortableFields.map((field) => (
                            <option key={field.name} value={field.name}>
                              {field.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="w-[92px]">
                        <label className="mb-1 block text-[12px]">排序</label>
                        <select
                          className="select select-bordered select-sm w-full"
                          value={activeTab.sortDirection}
                          disabled={!activeTab.sortField}
                          onChange={(event) => onSortDirectionChange(event.target.value as "ASC" | "DESC")}
                        >
                          <option value="ASC">ASC</option>
                          <option value="DESC">DESC</option>
                        </select>
                      </div>

                      <div className="w-[90px]">
                        <label className="mb-1 block text-[12px]">LIMIT</label>
                        <input
                          className="input input-bordered input-sm w-full"
                          type="number"
                          value={activeTab.limit}
                          onChange={(event) => onLimitChange(Number(event.target.value || 200))}
                        />
                      </div>
                    </>
                  )}

                  <button className="btn btn-primary btn-sm mt-5 h-[35px]" disabled={activeTab.loading} onClick={onQuery}>
                    <Search size={14} />
                    查询
                  </button>
                </div>
              </div>
            )}

            {/* 数据网格区。 */}
            <div className="min-h-0 flex-1">
              <DataGrid
                result={activeTab.result}
                visibleColumns={visibleColumns}
                fieldMetadataMap={fieldMetadataMap}
                dirtyCellKeys={activeTab.dirtyCellKeys}
                selectedRecordIds={activeTab.selectedRecordIds}
                salesforceTimezone={salesforceTimezone}
                pendingDeleteRecordIds={pendingDeleteRecordIds}
                sourceId={selectedSourceId}
                selectedSourceType={selectedSourceType}
                objectName={activeTab.objectName}
                onToggleRecord={onToggleRecord}
                onToggleAll={onToggleAllRecords}
                onEditCell={onEditCell}
                onShowMessage={onShowMessage}
              />
            </div>

            {/* 日志面板。 */}
            {activeTab.showLogs && (
              <div className="relative flex min-h-0 flex-col border-t border-base-300" style={{ height: logPanelHeight }}>
                <div
                  className="absolute left-0 right-0 top-0 z-[1] h-[6px] cursor-row-resize"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    dragStartYRef.current = event.clientY;
                    dragStartHeightRef.current = logPanelHeight;
                    setDraggingLogResize(true);
                  }}
                />
                <div className="border-b border-base-300 px-3 py-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-neutral/70">操作日志（当前 Tab）</span>
                    <button className="btn btn-circle btn-ghost btn-xs" onClick={onToggleLogs} aria-label="关闭日志">
                      <X size={14} />
                    </button>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
                  {activeTab.logs.length === 0 && <span className="text-[12px] text-neutral/70">暂无日志。</span>}
                  {activeTab.logs.map((log) => (
                    <div key={log.id} className="mb-2 border border-base-300 bg-base-100 p-2">
                      <p className={`mb-1 block text-[12px] ${log.success ? "text-success" : "text-error"}`}>
                        {formatLogTime(log.timestamp)} [{log.action}] {log.success ? "成功" : "失败"}
                      </p>
                      <p className="block text-[12px]">请求: {log.request}</p>
                      <p className="block text-[12px]">响应: {log.summary}</p>
                      {log.errorMessage && <p className="block text-[12px] text-error">错误: {log.errorMessage}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 右侧抽屉：Salesforce 显示字段与SOQL；MySQL 显示 DDL 信息。 */}
          {activeTab.showDrawer && (
            <div
              className="relative z-30 flex min-h-0 shrink-0 flex-col border-l border-base-300 bg-base-100"
              style={{ width: drawerWidth, minWidth: drawerWidth }}
            >
              {/* 抽屉左侧拖拽热区：用于调整抽屉宽度。 */}
              <div
                className="absolute -left-[3px] top-0 z-20 h-full w-[6px] cursor-col-resize"
                role="separator"
                aria-orientation="vertical"
                aria-label={isMysqlSource ? "拖拽调整DDL抽屉宽度" : "拖拽调整字段与SOQL抽屉宽度"}
                onMouseDown={(event) => {
                  event.preventDefault(); // 阻止拖拽起点触发文本选中。
                  drawerResizeStartXRef.current = event.clientX; // 记录本次拖拽起点 X。
                  drawerResizeStartWidthRef.current = drawerWidth; // 记录本次拖拽起始宽度。
                  setDraggingDrawerResize(true); // 进入拖拽状态。
                }}
              />
              {isMysqlSource ? (
                <div className="flex min-h-0 flex-1 flex-col bg-base-100">
                  <div className="flex items-center justify-between border-b border-base-300 px-3 py-2">
                    <span className="text-[12px] text-neutral/70">DDL</span>
                    <div className="flex flex-row items-center gap-1">
                      <button className="btn btn-ghost btn-xs" disabled={mysqlDdlLoading || activeTab.loading} onClick={onRefreshMysqlDdl}>
                        刷新
                      </button>
                      <button className="btn btn-circle btn-ghost btn-xs" onClick={onToggleDrawer} aria-label="关闭DDL抽屉">
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto p-3 text-[12px]">
                    {mysqlDdlLoading ? (
                      <div className="text-neutral/70">正在加载 DDL...</div>
                    ) : mysqlDdlError ? (
                      <div className="rounded border border-error/40 bg-error/10 p-2 text-error">
                        {mysqlDdlError}
                      </div>
                    ) : mysqlDdl ? (
                      <div className="space-y-3">
                        <section>
                          <h4 className="mb-1 font-semibold">建表 DDL</h4>
                          <pre className="overflow-x-auto rounded border border-base-300 bg-base-200/40 p-2 whitespace-pre-wrap break-words">
                            {mysqlDdl.createTableDdl || "-"}
                          </pre>
                        </section>
                        <section>
                          <h4 className="mb-1 font-semibold">索引 DDL</h4>
                          {mysqlDdl.indexDdls.length > 0 ? (
                            <pre className="overflow-x-auto rounded border border-base-300 bg-base-200/40 p-2 whitespace-pre-wrap break-words">
                              {mysqlDdl.indexDdls.join("\n")}
                            </pre>
                          ) : (
                            <div className="text-neutral/70">暂无索引 DDL。</div>
                          )}
                        </section>
                        <section>
                          <h4 className="mb-1 font-semibold">约束 DDL</h4>
                          {mysqlDdl.constraintDdls.length > 0 ? (
                            <pre className="overflow-x-auto rounded border border-base-300 bg-base-200/40 p-2 whitespace-pre-wrap break-words">
                              {mysqlDdl.constraintDdls.join("\n")}
                            </pre>
                          ) : (
                            <div className="text-neutral/70">暂无约束 DDL。</div>
                          )}
                        </section>
                      </div>
                    ) : (
                      <div className="text-neutral/70">暂无 DDL 信息。</div>
                    )}
                  </div>
                </div>
              ) : (
              <>
              <div className="flex min-h-0 flex-[1_1_50%] flex-col border-b border-base-300 bg-base-100">
                <div className="flex items-center justify-between border-b border-base-300 px-3 py-2">
                  <span className="text-[12px] text-neutral/70">Field 元数据</span>
                  <div className="flex flex-row items-center gap-1">
                    <button className="btn btn-ghost btn-xs" disabled={activeTab.loading || !activeTab.describe} onClick={onToggleAllFields}>
                      {activeTab.describe?.fields.every((field) => (activeTab.columnVisibility[field.name] ?? true) === true) ? "取消全选" : "全选"}
                    </button>
                    <button className="btn btn-circle btn-ghost btn-xs" onClick={onToggleDrawer} aria-label="关闭字段与SOQL">
                      <X size={14} />
                    </button>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-auto">
                  {!activeTab.describe && (
                    <div className="px-3 py-2">
                      <span className="text-[12px] text-neutral/70">正在加载字段元数据...</span>
                    </div>
                  )}
                  {activeTab.describe && activeTab.describe.fields.length === 0 && (
                    <div className="px-3 py-2">
                      <span className="text-[12px] text-neutral/70">未获取到字段元数据。</span>
                    </div>
                  )}

                  {activeTab.describe?.fields.map((field) => {
                    const checked = activeTab.columnVisibility[field.name] ?? true;
                    return (
                      <div key={field.name} className="px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              className="checkbox checkbox-sm"
                              checked={checked}
                              disabled={activeTab.loading}
                              onChange={(event) => onToggleFieldVisibility(field.name, event.target.checked)}
                            />
                            <span className="text-[12px]">{field.name}</span>
                          </div>
                          <span className="truncate text-[12px] text-neutral/70">{field.label} / {field.dataType}</span>
                        </div>
                        <div className="mt-2 border-b border-base-300" />
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex min-h-0 flex-[1_1_50%] flex-col bg-base-100">
                <div className="flex items-center justify-between border-b border-base-300 px-3 py-2">
                  <span className="text-[12px] text-neutral/70">SOQL 执行器</span>
                </div>
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
                  {/* 编辑器容器：占满剩余空间，避免挤压底部执行按钮。 */}
                  <div className="min-h-0 flex-1">
                    {/* SOQL 编辑器：使用 Monaco 提供语法高亮与自动补全。 */}
                    <SoqlMonacoEditor
                      value={activeTab.soqlDraft}
                      onChange={(value) => onSoqlChange(value)}
                      height="100%"
                      className="h-full"
                      // 抽屉编辑区较窄：按列宽自动换行，避免长 SOQL 一直横向单行滚动。
                      wordWrapMode="bounded"
                      // bounded 模式下的列宽：在当前抽屉宽度下可稳定触发可读换行。
                      wordWrapColumn={56}
                      // 当前对象字段名补全（作为回退候选）。
                      fieldNames={activeTab.describe?.fields.map((field) => field.name) || []}
                      // 当前数据源对象名补全，便于 FROM 子句输入。
                      objectNames={objectNames}
                      // 传入对象字段映射，使 FROM <对象> 后可按对象上下文补全字段。
                      objectFieldsMap={{
                        ...soqlObjectFieldsMap,
                        ...(activeTab.describe
                          ? { [activeTab.objectName]: activeTab.describe.fields.map((field) => field.name) }
                          : {})
                      }}
                    />
                  </div>
                  <button className="btn btn-primary btn-sm mt-2 self-start" disabled={activeTab.loading || !activeTab.soqlDraft} onClick={onExecuteCustomSoql}>
                    <Play size={14} />
                    执行 SOQL
                  </button>
                </div>
              </div>
              </>
              )}
            </div>
          )}

          {/* 加载遮罩。 */}
          {activeTab.loading && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-white/70">
              <span className="loading loading-spinner" style={{ width: 42, height: 42 }} />
              <span className="text-[12px] text-neutral/70">{loadingText}</span>
            </div>
          )}
        </div>
      )}
    </>
  );
}

// 日志时间格式化。
function formatLogTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toLocaleString();
}

// 从 SOQL 中提取所有 FROM 后对象名（包含子查询），用于按需加载字段元数据。
function extractFromObjectNames(soql: string): string[] {
  const fromObjectNames: string[] = [];
  const regex = /\bfrom\s+([A-Za-z_][\w]*)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(soql)) !== null) {
    fromObjectNames.push(match[1]); // 逐个记录 FROM 对象，供后续去重与懒加载。
  }
  return Array.from(new Set(fromObjectNames));
}

// 将抽屉中的单行 SOQL 规整为多行：仅处理常见 SELECT/FROM/WHERE/ORDER BY/LIMIT 模式。
function formatSingleLineSoqlForDrawer(soql: string): string {
  if (!soql.trim()) return soql;
  if (soql.includes("\n")) return soql; // 已是多行时不重复格式化。

  const normalized = soql.replace(/\s+/g, " ").trim();
  // 复杂语句（聚合/分组/偏移等）不自动改写，避免误改用户手写结构。
  if (/\b(group\s+by|having|offset|for\s+view|for\s+reference|all\s+rows)\b/i.test(normalized)) {
    return soql;
  }

  const fromMatch = normalized.match(/\bfrom\s+([A-Za-z_][\w.]*)\b/i);
  if (!fromMatch) return soql;
  const selectMatch = normalized.match(/^select\s+(.+?)\s+from\s+[A-Za-z_][\w.]*\b/i);
  if (!selectMatch) return soql;

  const fields = selectMatch[1]
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (fields.length === 0) return soql;

  const whereMatch = normalized.match(/\bwhere\s+(.+?)(?=\border\s+by\b|\blimit\b|$)/i);
  const orderMatch = normalized.match(/\border\s+by\s+(.+?)(?=\blimit\b|$)/i);
  const limitMatch = normalized.match(/\blimit\s+(\d+)\b/i);

  const selectSegment = fields.map((field, index) => `  ${field}${index < fields.length - 1 ? "," : ""}`).join("\n");
  const whereSegment = whereMatch?.[1]?.trim() ? `\nWHERE ${whereMatch[1].trim()}` : "";
  const orderBySegment = orderMatch?.[1]?.trim() ? `\nORDER BY ${orderMatch[1].trim()}` : "";
  const limitSegment = limitMatch?.[1] ? `\nLIMIT ${limitMatch[1]}` : "";

  return `SELECT\n${selectSegment}\nFROM ${fromMatch[1]}${whereSegment}${orderBySegment}${limitSegment}`;
}

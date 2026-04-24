import { useMemo } from "react";
import type { QueryPanelActions } from "../types";
import { buildObjectTabBindingKey } from "../../../../types";
import type { ObjectDescribe, SalesforceObject, SalesforceSource, SourceBindingMeta, TabState } from "../../../../types";
import { MainViewMode } from "../../../../store/useAppStore";
import { getSourceColor } from "../logic/sourceColor.ts";
import { getMysqlPrimaryKeyField, getRecordKey } from "../logic/queryUtils";
import {
  isMysqlDraftDirty,
  isMysqlDraftOmitValue,
  normalizeMysqlEditedCellValue
} from "../logic/mysqlValueSemantics.ts";

type EditableGridRecord = Record<string, unknown> & {
  // 是否为前端本地新增行。
  __isNew?: boolean;
  // 前端稳定行身份：用于 dirty / 选中 / 删除定位。
  __rowStableId?: string;
  // 基线记录键：用于主键编辑后仍能命中 baseline。
  __baselineKey?: string;
};

type UseQueryPanelActionsInput = {
  // 当前激活 Query Tab。
  activeTab: TabState | null;
  // 当前选中数据源 ID。
  selectedSourceId: string;
  // 当前选中数据源类型：用于 MySQL 主键键值计算。
  selectedSourceType: string;
  // 当前选中数据源名称：用于新建控制台 Tab 时绑定来源元信息。
  selectedSourceName: string;
  // 当前选中数据源颜色：用于新建控制台 Tab 时绑定来源元信息。
  selectedSourceColor: string;
  // 切换页面模式。
  setViewMode: (viewMode: MainViewMode) => void;
  // 打开认证窗口。
  openAuthWindow: () => void;
  // 创建控制台 Tab。
  createSoqlConsoleTab: (sourceMeta?: Partial<SourceBindingMeta>) => string;
  // 激活工作区 Tab。
  setActiveWorkspaceTabId: (workspaceTabId: string) => void;
  // 拖拽排序工作区 Tabs。
  reorderWorkspaceTabs: (activeWorkspaceTabId: string, overWorkspaceTabId: string) => void;
  // 构建控制台工作区 Tab ID。
  buildConsoleWorkspaceTabId: (tabId: string) => string;
  // 解析工作区 Tab ID。
  parseWorkspaceTabId: (workspaceTabId: string) => { kind: "data" | "console"; targetId: string } | null;
  // 激活对象 Tab。
  setActiveTabObjectName: (objectName: string) => void;
  // 激活控制台 Tab。
  setActiveSoqlTabId: (tabId: string) => void;
  // 关闭控制台 Tab。
  closeSoqlTab: (tabId: string) => void;
  // 批量关闭控制台 Tabs。
  closeSoqlTabsByIds: (tabIds: string[]) => void;
  // 刷新数据源。
  refreshSources: (sourceId?: string, options?: { skipObjectFetch?: boolean }) => Promise<void>;
  // 刷新指定 MySQL 对象的字段元数据与 DDL。
  refreshMysqlObjectMetadata: (objectName: string) => Promise<{ describe: ObjectDescribe; ddl: import("../../../../types").ObjectDdl }>;
  // 切换数据源。
  handleSourceChange: (sourceId: string) => Promise<void>;
  // 构建 data 工作区 Tab ID。
  buildDataWorkspaceTabId: (objectName: string) => string;
  // 打开对象 Tab。
  openObjectTab: (item: SalesforceObject, source?: SalesforceSource) => Promise<void>;
  // 不可查询对象点击提示。
  handleNotQueryableObjectClick: (item: SalesforceObject) => void;
  // 关闭对象 Tab。
  closeTab: (objectName: string) => void;
  // 批量关闭对象 Tabs。
  closeTabsByObjectNames: (objectNames: string[]) => void;
  // 关闭左侧对象 Tabs。
  closeLeftTabs: (objectName: string) => void;
  // 关闭右侧对象 Tabs。
  closeRightTabs: (objectName: string) => void;
  // 关闭其他对象 Tabs。
  closeOtherTabs: (objectName: string) => void;
  // 关闭全部对象 Tabs。
  closeAllTabs: () => void;
  // 快速创建记录。
  createRecordQuickly: () => void;
  // 标记删除勾选记录。
  deleteCheckedRecords: () => Promise<void>;
  // 提交未提交修改。
  applyPendingChanges: () => Promise<void>;
  // 撤销未提交修改。
  discardPendingChanges: () => void;
  // 切换字段/DDL 抽屉。
  toggleDrawerForActiveTab: (drawerView?: "salesforce" | "mysql-ddl" | "mysql-fields") => Promise<void>;
  // 加载 MySQL DDL。
  loadMysqlDdl: (objectName: string) => Promise<void>;
  // 更新 Tab。
  patchTab: (tabBindingKey: string, updater: (tab: TabState) => TabState) => void;
  // 执行对象查询。
  queryTabData: (
    objectName: string,
    describeOverride?: ObjectDescribe,
    whereOverride?: string,
    sortFieldOverride?: string,
    limitOverride?: number,
    directionOverride?: "ASC" | "DESC",
    sortClauseOverride?: string,
    fallbackTab?: TabState
  ) => Promise<void>;
  // 执行自定义 SQL/SOQL。
  executeCustomSoql: () => Promise<void>;
  // 持久化字段可见性。
  persistColumnVisibility: (sourceId: string, objectName: string, visibility: Record<string, boolean>) => Promise<void>;
  // 关闭工作区提示。
  clearWorkspaceNotice: () => void;
  // 设置 SOQL 侧栏宽度。
  setSoqlSidebarWidth: (width: number) => void;
};

// QueryPanel 交互行为集合：集中构建 actions，减少 MainPage 的模板噪音。
export function useQueryPanelActions({
  activeTab,
  selectedSourceId,
  selectedSourceType,
  selectedSourceName,
  selectedSourceColor,
  setViewMode,
  openAuthWindow,
  createSoqlConsoleTab,
  setActiveWorkspaceTabId,
  reorderWorkspaceTabs,
  buildConsoleWorkspaceTabId,
  parseWorkspaceTabId,
  setActiveTabObjectName,
  setActiveSoqlTabId,
  closeSoqlTab,
  closeSoqlTabsByIds,
  refreshSources,
  refreshMysqlObjectMetadata,
  handleSourceChange,
  buildDataWorkspaceTabId,
  openObjectTab,
  handleNotQueryableObjectClick,
  closeTab,
  closeTabsByObjectNames,
  closeLeftTabs,
  closeRightTabs,
  closeOtherTabs,
  closeAllTabs,
  createRecordQuickly,
  deleteCheckedRecords,
  applyPendingChanges,
  discardPendingChanges,
  toggleDrawerForActiveTab,
  loadMysqlDdl,
  patchTab,
  queryTabData,
  executeCustomSoql,
  persistColumnVisibility,
  clearWorkspaceNotice,
  setSoqlSidebarWidth
}: UseQueryPanelActionsInput): QueryPanelActions {
  return useMemo(
    () => ({
      onSetViewMode: setViewMode,
      onOpenAuthWindow: openAuthWindow,
      onOpenConsole: (source) => {
        const targetSourceId = source?.id || selectedSourceId;
        const targetSourceType = String(source?.sourceType || selectedSourceType || "");
        const targetSourceName = source?.name || selectedSourceName;
        const targetSourceColor = source ? getSourceColor(source) : selectedSourceColor;
        const nextConsoleTabId = createSoqlConsoleTab({
          sourceId: targetSourceId,
          sourceType: targetSourceType,
          sourceName: targetSourceName,
          sourceColor: targetSourceColor
        }); // 每次点击都新建并激活一个控制台 Tab。
        setActiveWorkspaceTabId(buildConsoleWorkspaceTabId(nextConsoleTabId)); // 激活新建的 console 工作区 Tab。
        setViewMode("query"); // 保持在统一 Query 工作区内切换，不跳离当前布局。
      },
      onActivateWorkspaceTab: (workspaceTabId) => {
        const parsed = parseWorkspaceTabId(workspaceTabId);
        if (!parsed) return;
        setActiveWorkspaceTabId(workspaceTabId); // 先更新统一工作区焦点。
        if (parsed.kind === "data") {
          setActiveTabObjectName(parsed.targetId); // 同步对象 Tab 激活状态。
          return;
        }
        setActiveSoqlTabId(parsed.targetId); // 同步控制台 Tab 激活状态。
      },
      onReorderWorkspaceTabs: (activeWorkspaceTabId, overWorkspaceTabId) => {
        reorderWorkspaceTabs(activeWorkspaceTabId, overWorkspaceTabId); // 仅调整展示顺序，保持业务状态不变。
      },
      onCloseWorkspaceTab: (workspaceTabId) => {
        const parsed = parseWorkspaceTabId(workspaceTabId);
        if (!parsed) return;
        if (parsed.kind === "data") {
          closeTab(parsed.targetId); // 关闭对象 Tab。
          return;
        }
        closeSoqlTab(parsed.targetId); // 关闭控制台 Tab。
      },
      onCloseWorkspaceTabs: (workspaceTabIds) => {
        if (workspaceTabIds.length === 0) return;
        const dataObjectNames: string[] = [];
        const consoleTabIds: string[] = [];
        workspaceTabIds.forEach((workspaceTabId) => {
          const parsed = parseWorkspaceTabId(workspaceTabId);
          if (!parsed) return;
          if (parsed.kind === "data") {
            dataObjectNames.push(parsed.targetId); // 汇总 data tabs，走对象批量关闭。
            return;
          }
          consoleTabIds.push(parsed.targetId); // 汇总 console tabs，走控制台批量关闭。
        });
        if (dataObjectNames.length > 0) {
          closeTabsByObjectNames(dataObjectNames);
        }
        if (consoleTabIds.length > 0) {
          closeSoqlTabsByIds(consoleTabIds);
        }
      },
      onChangeSource: (sourceId) => void handleSourceChange(sourceId),
      onRefreshSources: (sourceId, options) => void refreshSources(sourceId, options),
      onRefreshMysqlObjectMetadata: (objectName) => refreshMysqlObjectMetadata(objectName),
      onOpenObject: (item, source) => {
        const targetSourceId = source?.id || selectedSourceId;
        setActiveWorkspaceTabId(buildDataWorkspaceTabId(buildObjectTabBindingKey(targetSourceId, item.name))); // 双击对象后切回 data 工作区 Tab。
        void openObjectTab(item, source);
      },
      onNotQueryableObjectClick: handleNotQueryableObjectClick,
      onActivateTab: setActiveTabObjectName,
      onCloseTab: closeTab,
      onCloseCurrentTab: closeTab,
      onCloseLeftTabs: closeLeftTabs,
      onCloseRightTabs: closeRightTabs,
      onCloseOtherTabs: closeOtherTabs,
      onCloseAllTabs: closeAllTabs,
      onCreateRecord: createRecordQuickly,
      onDeleteCheckedRecords: () => void deleteCheckedRecords(),
      onApplyPendingChanges: () => void applyPendingChanges(),
      onDiscardPendingChanges: discardPendingChanges,
      onToggleDrawer: (drawerView) => void toggleDrawerForActiveTab(drawerView),
      onRefreshMysqlDdl: () => {
        if (!activeTab) return;
        void loadMysqlDdl(activeTab.objectName);
      },
      onToggleQueryBar: () => {
        if (!activeTab) return;
        patchTab(activeTab.bindingKey, (item) => ({ ...item, showQueryBar: !item.showQueryBar }));
      },
      onToggleLogs: () => {
        if (!activeTab) return;
        patchTab(activeTab.bindingKey, (item) => ({ ...item, showLogs: !item.showLogs }));
      },
      onWhereChange: (value) => {
        if (!activeTab) return;
        patchTab(activeTab.bindingKey, (item) => ({ ...item, whereClause: value }));
      },
      onLimitChange: (value) => {
        if (!activeTab) return;
        patchTab(activeTab.bindingKey, (item) => ({ ...item, limit: value }));
      },
      onSortFieldChange: (value) => {
        if (!activeTab) return;
        patchTab(activeTab.bindingKey, (item) => ({ ...item, sortField: value }));
      },
      onSortDirectionChange: (value) => {
        if (!activeTab) return;
        patchTab(activeTab.bindingKey, (item) => ({ ...item, sortDirection: value }));
      },
      onSortClauseChange: (value) => {
        if (!activeTab) return;
        patchTab(activeTab.bindingKey, (item) => {
          const normalized = value.trim();
          if (!normalized) {
            // 手动清空排序条件时同步清空旧版排序字段，避免 UI 回退显示旧值。
            return { ...item, sortClause: "", sortField: "" };
          }
          // 解析首个排序片段（字段 + 可选方向），用于兼容旧逻辑字段。
          const firstPart = normalized
            .replace(/^order\s+by\s+/i, "")
            .split(",")[0]
            ?.trim();
          const match = firstPart?.match(/^([A-Za-z_][\w.]*)\s*(ASC|DESC)?/i);
          const parsedField = match?.[1] || item.sortField;
          const parsedDirection = (match?.[2]?.toUpperCase() as "ASC" | "DESC" | undefined) || item.sortDirection;
          return {
            ...item,
            sortClause: value,
            sortField: parsedField,
            sortDirection: parsedDirection
          };
        });
      },
      onQuery: (overrides) => {
        if (!activeTab) return;
        // 查询触发支持覆盖草稿参数：用于 UI 在防抖回写之前直接执行最新输入。
        const whereClauseOverride = overrides?.whereClause;
        const limitOverride = overrides?.limit;
        const sortClauseOverride = overrides?.sortClause;
        const sortFieldOverride = overrides?.sortField;
        const sortDirectionOverride = overrides?.sortDirection;
        void queryTabData(
          activeTab.bindingKey || activeTab.objectName,
          activeTab.describe || undefined,
          whereClauseOverride ?? activeTab.whereClause,
          sortFieldOverride ?? activeTab.sortField,
          limitOverride ?? activeTab.limit,
          sortDirectionOverride ?? activeTab.sortDirection,
          sortClauseOverride ?? activeTab.sortClause,
          activeTab
        );
      },
      onToggleRecord: (recordId, checked) => {
        if (!activeTab) return;
        patchTab(activeTab.bindingKey, (item) => ({
          ...item,
          selectedRecordIds: checked
            ? Array.from(new Set([...item.selectedRecordIds, recordId]))
            : item.selectedRecordIds.filter((id) => id !== recordId)
        }));
      },
      onToggleAllRecords: (checked, recordIds) => {
        if (!activeTab) return;
        patchTab(activeTab.bindingKey, (item) => ({ ...item, selectedRecordIds: checked ? recordIds : [] }));
      },
      onEditCell: (rowIndex, columnName, value) => {
        if (!activeTab) return;
        patchTab(activeTab.bindingKey, (item) => {
          const nextRecords = [...item.result.records] as EditableGridRecord[];
          const target = nextRecords[rowIndex];
          if (!target) return item;
          const resolvedSourceType = item.sourceType || selectedSourceType || "salesforce";
          const isMysqlSource = resolvedSourceType.toLowerCase() === "mysql";
          // MySQL 编辑统一先归一化成显式 draft 语义，避免 null/undefined/空字符串混淆。
          const normalizedValue = isMysqlSource ? normalizeMysqlEditedCellValue(value) : value;

          // 旧行编辑统一绑定基线键：避免主键字段被修改后，无法再定位 baseline。
          const stableRowId = getRecordKey(target, rowIndex, {
            sourceType: resolvedSourceType,
            mysqlPrimaryKeyField: getMysqlPrimaryKeyField(item.describe)
          });
          const baselineKeyFromRecord = typeof target.__baselineKey === "string" ? target.__baselineKey : "";
          const stableBaselineKey = baselineKeyFromRecord || stableRowId;
          const isEditingNewRow = Boolean(target.__isNew);
          const nextRecordBase: EditableGridRecord = isEditingNewRow
            ? { ...target }
            : { ...target, __rowStableId: stableBaselineKey, __baselineKey: stableBaselineKey };
          const nextRecord: EditableGridRecord = (() => {
            if (isMysqlDraftOmitValue(normalizedValue)) {
              const rest: EditableGridRecord = { ...nextRecordBase };
              delete rest[columnName]; // 行内注释：MySQL omit 语义需要从草稿记录里移除该字段。
              return rest;
            }
            return { ...nextRecordBase, [columnName]: normalizedValue };
          })();
          // 统一记录键：前端一律使用稳定 rowStableId，避免主键编辑后失去行定位。
          const cellKey = `${stableBaselineKey}:${columnName}`;
          const dirtySet = new Set(item.dirtyCellKeys);
          const isNewRow = Boolean(nextRecord.__isNew);
          if (isNewRow) {
            if (isMysqlSource && isMysqlDraftOmitValue(normalizedValue)) {
              dirtySet.delete(cellKey); // 新增行回退为 omit 后，视为回到“未填写”状态。
            } else {
              dirtySet.add(cellKey); // 新增行显式编辑过的字段统一视为脏数据。
            }
          } else {
            const stringify = (input: unknown): string => {
              if (input === null || input === undefined) return "";
              if (typeof input === "string") return input;
              if (typeof input === "number" || typeof input === "boolean") return String(input);
              try {
                return JSON.stringify(input);
              } catch {
                return String(input);
              }
            };
            const baselineValue = item.baselineRecords[stableBaselineKey]?.[columnName];
            const nextValue = nextRecord[columnName];
            const isDirty = isMysqlSource
              ? isMysqlDraftDirty(baselineValue, nextValue)
              : stringify(baselineValue) !== stringify(nextValue);
            if (!isDirty) {
              dirtySet.delete(cellKey); // 改回原值则移除脏标记。
            } else {
              dirtySet.add(cellKey); // 与基线不一致则保留脏标记。
            }
          }

          nextRecords[rowIndex] = nextRecord;
          return {
            ...item,
            result: { ...item.result, records: nextRecords },
            dirtyCellKeys: Array.from(dirtySet)
          };
        });
      },
      onShowMessage: (message) => {
        if (!activeTab) return;
        patchTab(activeTab.bindingKey, (item) => ({
          ...item,
          notice: { type: "error", message }
        }));
      },
      onToggleAllFields: () => {
        if (!activeTab?.describe) return;
        const allSelected = activeTab.describe.fields.every((field) => (activeTab.columnVisibility[field.name] ?? true) === true);
        const nextChecked = !allSelected;
        const nextVisibility = activeTab.describe.fields.reduce((acc, field) => {
          acc[field.name] = nextChecked;
          return acc;
        }, {} as Record<string, boolean>);
        patchTab(activeTab.bindingKey, (item) => ({ ...item, columnVisibility: nextVisibility }));
        const resolvedSourceId = activeTab.sourceId || selectedSourceId;
        if (resolvedSourceId) {
          void persistColumnVisibility(resolvedSourceId, activeTab.objectName, nextVisibility);
        }
      },
      onToggleFieldVisibility: (fieldName, checked) => {
        if (!activeTab) return;
        const nextVisibility = { ...activeTab.columnVisibility, [fieldName]: checked };
        patchTab(activeTab.bindingKey, (item) => ({
          ...item,
          columnVisibility: nextVisibility
        }));
        const resolvedSourceId = activeTab.sourceId || selectedSourceId;
        if (resolvedSourceId) {
          void persistColumnVisibility(resolvedSourceId, activeTab.objectName, nextVisibility);
        }
      },
      onSoqlChange: (value) => {
        if (!activeTab) return;
        patchTab(activeTab.bindingKey, (item) => ({ ...item, soqlDraft: value }));
      },
      onExecuteCustomSoql: () => void executeCustomSoql(),
      onCloseWorkspaceNotice: clearWorkspaceNotice,
      onCloseActiveTabNotice: () => {
        if (!activeTab) return;
        patchTab(activeTab.bindingKey, (item) => ({ ...item, notice: null }));
      },
      onSetSoqlSidebarWidth: setSoqlSidebarWidth
    }),
    [
      setViewMode,
      openAuthWindow,
      createSoqlConsoleTab,
      setActiveWorkspaceTabId,
      reorderWorkspaceTabs,
      buildConsoleWorkspaceTabId,
      parseWorkspaceTabId,
      setActiveTabObjectName,
      selectedSourceType,
      selectedSourceName,
      selectedSourceColor,
      setActiveSoqlTabId,
      closeTab,
      closeTabsByObjectNames,
      closeSoqlTab,
      closeSoqlTabsByIds,
      handleSourceChange,
      refreshSources,
      buildDataWorkspaceTabId,
      openObjectTab,
      handleNotQueryableObjectClick,
      closeLeftTabs,
      closeRightTabs,
      closeOtherTabs,
      closeAllTabs,
      createRecordQuickly,
      deleteCheckedRecords,
      applyPendingChanges,
      discardPendingChanges,
      toggleDrawerForActiveTab,
      activeTab,
      loadMysqlDdl,
      patchTab,
      queryTabData,
      executeCustomSoql,
      persistColumnVisibility,
      clearWorkspaceNotice,
      setSoqlSidebarWidth,
      selectedSourceId
    ]
  );
}

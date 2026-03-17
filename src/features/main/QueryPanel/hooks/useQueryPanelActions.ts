import { useMemo } from "react";
import { QueryPanelActions } from "../types";
import { ObjectDescribe, SalesforceObject, TabState } from "../../../../types";
import { MainViewMode } from "../../../../store/useAppStore";
import { getMysqlPrimaryKeyField, getRecordKey } from "../logic/queryUtils";

type UseQueryPanelActionsInput = {
  // 当前激活 Query Tab。
  activeTab: TabState | null;
  // 当前选中数据源 ID。
  selectedSourceId: string;
  // 当前选中数据源类型：用于 MySQL 主键键值计算。
  selectedSourceType: string;
  // 切换页面模式。
  setViewMode: (viewMode: MainViewMode) => void;
  // 打开认证窗口。
  openAuthWindow: () => void;
  // 创建控制台 Tab。
  createSoqlConsoleTab: () => string;
  // 激活工作区 Tab。
  setActiveWorkspaceTabId: (workspaceTabId: string) => void;
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
  refreshSources: (
    syncCli: boolean,
    preferredOrgId?: string,
    preferredSourceId?: string,
    options?: {
      forceObjectRefresh?: boolean;
      showLoading?: boolean;
    }
  ) => Promise<void>;
  // 切换数据源。
  handleSourceChange: (sourceId: string) => Promise<void>;
  // 构建 data 工作区 Tab ID。
  buildDataWorkspaceTabId: (objectName: string) => string;
  // 打开对象 Tab。
  openObjectTab: (item: SalesforceObject) => Promise<void>;
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
  patchTab: (objectName: string, updater: (tab: TabState) => TabState) => void;
  // 执行对象查询。
  queryTabData: (
    objectName: string,
    describeOverride?: ObjectDescribe,
    whereOverride?: string,
    sortFieldOverride?: string,
    limitOverride?: number,
    directionOverride?: "ASC" | "DESC",
    sortClauseOverride?: string
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
  setViewMode,
  openAuthWindow,
  createSoqlConsoleTab,
  setActiveWorkspaceTabId,
  buildConsoleWorkspaceTabId,
  parseWorkspaceTabId,
  setActiveTabObjectName,
  setActiveSoqlTabId,
  closeSoqlTab,
  closeSoqlTabsByIds,
  refreshSources,
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
      onOpenConsole: () => {
        const nextConsoleTabId = createSoqlConsoleTab(); // 每次点击都新建并激活一个控制台 Tab。
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
      onRefreshSources: () => void refreshSources(true),
      onOpenObject: (item) => {
        setActiveWorkspaceTabId(buildDataWorkspaceTabId(item.name)); // 双击对象后切回 data 工作区 Tab。
        void openObjectTab(item);
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
        patchTab(activeTab.objectName, (item) => ({ ...item, showQueryBar: !item.showQueryBar }));
      },
      onToggleLogs: () => {
        if (!activeTab) return;
        patchTab(activeTab.objectName, (item) => ({ ...item, showLogs: !item.showLogs }));
      },
      onWhereChange: (value) => {
        if (!activeTab) return;
        patchTab(activeTab.objectName, (item) => ({ ...item, whereClause: value }));
      },
      onLimitChange: (value) => {
        if (!activeTab) return;
        patchTab(activeTab.objectName, (item) => ({ ...item, limit: value }));
      },
      onSortFieldChange: (value) => {
        if (!activeTab) return;
        patchTab(activeTab.objectName, (item) => ({ ...item, sortField: value }));
      },
      onSortDirectionChange: (value) => {
        if (!activeTab) return;
        patchTab(activeTab.objectName, (item) => ({ ...item, sortDirection: value }));
      },
      onSortClauseChange: (value) => {
        if (!activeTab) return;
        patchTab(activeTab.objectName, (item) => {
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
          activeTab.objectName,
          activeTab.describe || undefined,
          whereClauseOverride ?? activeTab.whereClause,
          sortFieldOverride ?? activeTab.sortField,
          limitOverride ?? activeTab.limit,
          sortDirectionOverride ?? activeTab.sortDirection,
          sortClauseOverride ?? activeTab.sortClause
        );
      },
      onToggleRecord: (recordId, checked) => {
        if (!activeTab) return;
        patchTab(activeTab.objectName, (item) => ({
          ...item,
          selectedRecordIds: checked
            ? Array.from(new Set([...item.selectedRecordIds, recordId]))
            : item.selectedRecordIds.filter((id) => id !== recordId)
        }));
      },
      onToggleAllRecords: (checked, recordIds) => {
        if (!activeTab) return;
        patchTab(activeTab.objectName, (item) => ({ ...item, selectedRecordIds: checked ? recordIds : [] }));
      },
      onEditCell: (rowIndex, columnName, value) => {
        if (!activeTab) return;
        patchTab(activeTab.objectName, (item) => {
          const nextRecords = [...item.result.records];
          const target = nextRecords[rowIndex];
          if (!target) return item;

          // 旧行编辑统一绑定基线键：避免主键字段被修改后，无法再定位 baseline。
          const currentRecordKey = getRecordKey(target, rowIndex, {
            sourceType: selectedSourceType,
            mysqlPrimaryKeyField: getMysqlPrimaryKeyField(item.describe)
          });
          const baselineKeyFromRecord = typeof target.__baselineKey === "string" ? target.__baselineKey : "";
          const stableBaselineKey = baselineKeyFromRecord || currentRecordKey;
          const isEditingNewRow = Boolean(target.__isNew);
          const nextRecord = isEditingNewRow
            ? { ...target, [columnName]: value }
            : { ...target, __baselineKey: stableBaselineKey, [columnName]: value };
          // 统一记录键：MySQL 使用主键值，Salesforce 使用 Id，确保脏标记与渲染高亮一致。
          const cellKey = `${stableBaselineKey}:${columnName}`;
          const dirtySet = new Set(item.dirtyCellKeys);
          const isNewRow = Boolean(nextRecord.__isNew);
          if (isNewRow) {
            dirtySet.add(cellKey); // 新增行任意修改都视为脏数据。
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
            const baselineValue = stringify(item.baselineRecords[stableBaselineKey]?.[columnName]);
            const nextValue = stringify(value);
            if (baselineValue === nextValue) {
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
        patchTab(activeTab.objectName, (item) => ({
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
        patchTab(activeTab.objectName, (item) => ({ ...item, columnVisibility: nextVisibility }));
        if (selectedSourceId) {
          void persistColumnVisibility(selectedSourceId, activeTab.objectName, nextVisibility);
        }
      },
      onToggleFieldVisibility: (fieldName, checked) => {
        if (!activeTab) return;
        const nextVisibility = { ...activeTab.columnVisibility, [fieldName]: checked };
        patchTab(activeTab.objectName, (item) => ({
          ...item,
          columnVisibility: nextVisibility
        }));
        if (selectedSourceId) {
          void persistColumnVisibility(selectedSourceId, activeTab.objectName, nextVisibility);
        }
      },
      onSoqlChange: (value) => {
        if (!activeTab) return;
        patchTab(activeTab.objectName, (item) => ({ ...item, soqlDraft: value }));
      },
      onExecuteCustomSoql: () => void executeCustomSoql(),
      onCloseWorkspaceNotice: clearWorkspaceNotice,
      onCloseActiveTabNotice: () => {
        if (!activeTab) return;
        patchTab(activeTab.objectName, (item) => ({ ...item, notice: null }));
      },
      onSetSoqlSidebarWidth: setSoqlSidebarWidth
    }),
    [
      setViewMode,
      openAuthWindow,
      createSoqlConsoleTab,
      setActiveWorkspaceTabId,
      buildConsoleWorkspaceTabId,
      parseWorkspaceTabId,
      setActiveTabObjectName,
      selectedSourceType,
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

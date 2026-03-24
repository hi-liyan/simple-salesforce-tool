import { QueryPanelActions, QueryPanelViewState } from "../types";
import { Notice, ObjectDdl, SalesforceObject, SalesforceSource, TabState } from "../../../../types";
import { MainViewMode } from "../../../../store/useAppStore";

type UseQueryPanelBindingsInput = {
  // 视图模式（query/terminal/settings）。
  viewMode: MainViewMode;
  // 控制台侧栏宽度。
  soqlSidebarWidth: number;
  // 当前选中数据源 ID。
  selectedSourceId: string;
  // 当前选中数据源类型。
  selectedSourceType: string;
  // Salesforce 当前用户时区。
  salesforceTimezone: string | null;
  // 页面级加载态。
  pageLoading: boolean;
  // 对象加载态。
  objectsLoading: boolean;
  // Query Tab 列表。
  tabs: TabState[];
  // 当前激活 Query Tab 对象名。
  activeTabObjectName: string;
  // 当前激活 Query Tab。
  activeTab: TabState | null;
  // 工作区提示。
  workspaceNotice: Notice | null;
  // 当前可见列。
  visibleColumns: string[];
  // 字段元数据映射。
  fieldMetadataMap: Record<string, Record<string, unknown>>;
  // 当前激活 Tab 是否存在未提交修改。
  hasPendingChanges: boolean;
  // 待删除记录 ID 列表。
  pendingDeleteRecordIds: string[];
  // 右侧 loading 文案。
  loadingText: string;
  // 当前对象列表。
  objects: SalesforceObject[];
  // 数据源列表。
  sources: SalesforceSource[];
  // MySQL DDL 数据。
  mysqlDdl: ObjectDdl | null;
  // MySQL DDL 加载态。
  mysqlDdlLoading: boolean;
  // MySQL DDL 错误。
  mysqlDdlError: string;
  // MySQL DDL 映射：按对象名缓存抽屉数据，供 Tab 常驻挂载按需读取。
  mysqlDdlMap: Record<string, { loading: boolean; data: ObjectDdl | null; error: string }>;
  // 统一工作区 tab 列表。
  workspaceTabs: { id: string; kind: "data" | "console"; title: string; sourceColor?: string }[];
  // 当前激活工作区 tab ID。
  activeWorkspaceTabId: string;
  // 当前激活工作区 tab 类型。
  activeWorkspaceTabKind: "data" | "console";
  // 可查询对象名集合（用于补全）。
  queryableObjectNames: string[];
  // 交互行为集合。
  actions: QueryPanelActions;
};

// QueryPanel 绑定数据：统一产出 QueryPanel 所需 viewState + actions。
export function useQueryPanelBindings({
  viewMode,
  soqlSidebarWidth,
  selectedSourceId,
  selectedSourceType,
  salesforceTimezone,
  pageLoading,
  objectsLoading,
  tabs,
  activeTabObjectName,
  activeTab,
  workspaceNotice,
  visibleColumns,
  fieldMetadataMap,
  hasPendingChanges,
  pendingDeleteRecordIds,
  loadingText,
  objects,
  sources,
  mysqlDdl,
  mysqlDdlLoading,
  mysqlDdlError,
  mysqlDdlMap,
  workspaceTabs,
  activeWorkspaceTabId,
  activeWorkspaceTabKind,
  actions
}: UseQueryPanelBindingsInput): { queryPanelViewState: QueryPanelViewState; queryPanelActions: QueryPanelActions } {
  const queryPanelViewState: QueryPanelViewState = {
    viewMode,
    soqlSidebarWidth,
    selectedSourceId,
    selectedSourceType,
    salesforceTimezone,
    pageLoading,
    objectsLoading,
    tabs,
    activeTabObjectName,
    activeTab,
    workspaceNotice,
    visibleColumns,
    fieldMetadataMap,
    hasPendingChanges,
    pendingDeleteRecordIds,
    loadingText,
    objects,
    sources,
    mysqlDdl,
    mysqlDdlLoading,
    mysqlDdlError,
    mysqlDdlMap,
    workspaceTabs,
    activeWorkspaceTabId,
    activeWorkspaceTabKind
  };

  return {
    queryPanelViewState,
    queryPanelActions: actions
  };
}

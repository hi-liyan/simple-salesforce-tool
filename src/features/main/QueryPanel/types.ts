import { Notice, ObjectDdl, ObjectDescribe, SalesforceObject, SalesforceSource, TabState } from "../../../types";
import { MainViewMode } from "../../../store/useAppStore";

// 单个对象的 MySQL DDL 加载状态：用于在抽屉内展示建表/索引/约束信息。
export type MysqlDdlStateItem = {
  // 是否正在加载。
  loading: boolean;
  // DDL 数据。
  data: ObjectDdl | null;
  // 错误信息。
  error: string;
};

// 查询参数覆盖：用于在 UI 草稿态下直接触发查询，避免依赖“已回写到 store 的值”。
export type QueryOverrides = {
  // WHERE 子句（不含 WHERE 关键字）。
  whereClause?: string;
  // LIMIT 条数。
  limit?: number;
  // 排序字段（仅 Salesforce 且未提供 sortClause 时生效）。
  sortField?: string;
  // 排序方向（仅 Salesforce 且未提供 sortClause 时生效）。
  sortDirection?: "ASC" | "DESC";
  // 排序表达式（不含 ORDER BY 关键字），支持多字段/函数。
  sortClause?: string;
};

// 统一工作区 Tab 项：用于在 Query 视图中同时承载 data 与 console。
export type QueryWorkspaceTabItem = {
  // 唯一 ID（例如 data:Account / console:soql-tab-xxx）。
  id: string;
  // Tab 类型：data=对象查询，console=查询控制台。
  kind: "data" | "console";
  // Tab 标题。
  title: string;
  // Tab 绑定的数据源 ID：供左侧树定位当前激活来源。
  sourceId?: string;
  // data Tab 对应对象名：供左侧树定位对象节点。
  objectName?: string;
  // Tab 绑定的数据源颜色：用于标签背景着色。
  sourceColor?: string;
};

// QueryPanel 渲染所需状态：集中约束 UI 输入，降低 MainPage 与子组件耦合。
export type QueryPanelViewState = {
  // 页面模式：Query/SOQL/设置。
  viewMode: MainViewMode;
  // Query 工作区左侧侧边栏宽度。
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
  // Query 数据 Tab 列表。
  tabs: TabState[];
  // 当前激活 Query Tab 对象名。
  activeTabObjectName: string;
  // 当前激活 Query Tab。
  activeTab: TabState | null;
  // 工作区全局提示。
  workspaceNotice: Notice | null;
  // 当前可见字段。
  visibleColumns: string[];
  // 字段元数据映射。
  fieldMetadataMap: Record<string, Record<string, unknown>>;
  // 是否有未提交修改。
  hasPendingChanges: boolean;
  // 待删除记录 ID。
  pendingDeleteRecordIds: string[];
  // 右侧加载文案。
  loadingText: string;
  // 当前对象列表。
  objects: SalesforceObject[];
  // 数据源列表。
  sources: SalesforceSource[];
  // MySQL DDL 数据。
  mysqlDdl: ObjectDdl | null;
  // MySQL DDL 加载态。
  mysqlDdlLoading: boolean;
  // MySQL DDL 错误信息。
  mysqlDdlError: string;
  // MySQL DDL 全量映射：按对象名缓存抽屉数据，支持每个 data Tab 独立常驻挂载。
  mysqlDdlMap: Record<string, MysqlDdlStateItem>;
  // 统一工作区 Tab 列表（data + console）。
  workspaceTabs: QueryWorkspaceTabItem[];
  // 当前激活的统一工作区 Tab ID。
  activeWorkspaceTabId: string;
  // 当前激活的统一工作区 Tab 类型。
  activeWorkspaceTabKind: "data" | "console";
};

// QueryPanel 交互回调：将行为从渲染层抽离，便于未来替换实现。
export type QueryPanelActions = {
  // 视图切换。
  onSetViewMode: (viewMode: MainViewMode) => void;
  // 打开认证窗口。
  onOpenAuthWindow: () => void;
  // 新建并打开查询控制台。
  onOpenConsole: (source?: SalesforceSource) => void;
  // 激活统一工作区 Tab。
  onActivateWorkspaceTab: (workspaceTabId: string) => void;
  // 拖拽排序统一工作区 Tabs：基于拖拽前后 ID 调整展示顺序。
  onReorderWorkspaceTabs: (activeWorkspaceTabId: string, overWorkspaceTabId: string) => void;
  // 关闭统一工作区 Tab。
  onCloseWorkspaceTab: (workspaceTabId: string) => void;
  // 批量关闭统一工作区 Tabs。
  onCloseWorkspaceTabs: (workspaceTabIds: string[]) => void;
  // 切换数据源。
  onChangeSource: (sourceId: string) => void;
  // 刷新数据源。
  onRefreshSources: (sourceId?: string) => void;
  // 刷新指定 MySQL 对象的字段元数据与 DDL。
  onRefreshMysqlObjectMetadata: (objectName: string) => Promise<{ describe: ObjectDescribe; ddl: ObjectDdl }>;
  // 打开对象 Tab：支持显式携带来源数据源。
  onOpenObject: (item: SalesforceObject, source?: SalesforceSource) => void;
  // 点击不可查询对象提示。
  onNotQueryableObjectClick: (item: SalesforceObject) => void;
  // 激活 Query Tab。
  onActivateTab: (objectName: string) => void;
  // 关闭 Query Tab。
  onCloseTab: (objectName: string) => void;
  // 关闭当前 Query Tab。
  onCloseCurrentTab: (objectName: string) => void;
  // 关闭左侧 Query Tabs。
  onCloseLeftTabs: (objectName: string) => void;
  // 关闭右侧 Query Tabs。
  onCloseRightTabs: (objectName: string) => void;
  // 关闭其他 Query Tabs。
  onCloseOtherTabs: (objectName: string) => void;
  // 关闭全部 Query Tabs。
  onCloseAllTabs: () => void;
  // 快速新建记录。
  onCreateRecord: () => void;
  // 标记删除勾选记录。
  onDeleteCheckedRecords: () => void;
  // 执行更新。
  onApplyPendingChanges: () => void;
  // 撤销未提交修改。
  onDiscardPendingChanges: () => void;
  // 打开/关闭抽屉（可指定目标视图：MySQL DDL / MySQL 字段 / Salesforce）。
  onToggleDrawer: (drawerView?: "salesforce" | "mysql-ddl" | "mysql-fields") => void;
  // 刷新 MySQL DDL。
  onRefreshMysqlDdl: () => void;
  // 打开/关闭查询栏。
  onToggleQueryBar: () => void;
  // 打开/关闭日志。
  onToggleLogs: () => void;
  // 修改 Where。
  onWhereChange: (value: string) => void;
  // 修改 Limit。
  onLimitChange: (value: number) => void;
  // 修改排序字段。
  onSortFieldChange: (value: string) => void;
  // 修改排序方向。
  onSortDirectionChange: (value: "ASC" | "DESC") => void;
  // 修改 MySQL 排序表达式。
  onSortClauseChange: (value: string) => void;
  // 执行查询。
  onQuery: (overrides?: QueryOverrides) => void;
  // 勾选单条记录。
  onToggleRecord: (recordId: string, checked: boolean) => void;
  // 勾选全部记录。
  onToggleAllRecords: (checked: boolean, recordIds: string[]) => void;
  // 编辑单元格。
  onEditCell: (rowIndex: number, columnName: string, value: unknown) => void;
  // 显示错误消息。
  onShowMessage: (message: string) => void;
  // 全选/取消全部字段。
  onToggleAllFields: () => void;
  // 切换字段可见性。
  onToggleFieldVisibility: (fieldName: string, checked: boolean) => void;
  // 修改 SOQL/SQL 文本。
  onSoqlChange: (value: string) => void;
  // 执行自定义 SOQL/SQL。
  onExecuteCustomSoql: () => void;
  // 关闭工作区提示。
  onCloseWorkspaceNotice: () => void;
  // 关闭激活 Tab 提示。
  onCloseActiveTabNotice: () => void;
  // 设置 Query 工作区左侧侧边栏宽度。
  onSetSoqlSidebarWidth: (width: number) => void;
};

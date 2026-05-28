import { useEffect, useMemo, useRef, useState } from "react";
import { PanelRightOpen, Play, Plus, RotateCcw, ScrollText, Search, Trash2, X } from "lucide-react";
import { ContextMenu, type ContextMenuEntry } from "../../../../components/ContextMenu";
import { DataGrid } from "../../../../components/DataGrid";
import { NoticeAlert } from "../../../../components/NoticeAlert";
import { SoqlMonacoEditor } from "../../../../components/SoqlMonacoEditor";
import { api } from "../../../../api";
import { useAppStore } from "../../../../store/useAppStore";
import { buildObjectTabBindingKey, MutationPreviewItem, Notice, ObjectDdl, TabState } from "../../../../types";
import { buildMysqlMutationPlan, mergeMysqlPreviewSqlItems } from "../logic/mysqlMutationPlanner.ts";
import { hasMysqlMissingRequiredFields } from "../logic/mysqlCreateValidation.ts";
import { resolveMysqlResultUpdateCapability } from "../logic/mysqlUpdateCapability.ts";
import { buildSourceSurfacePalette } from "../logic/sourceColor.ts";
import type { QueryOverrides } from "../types";
import { MysqlSmartInput } from "./MysqlSmartInput";
import { SalesforceSmartInput } from "./SalesforceSmartInput";

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

// SOQL 函数候选：覆盖常用日期、转换、聚合与分组函数。
const SOQL_FUNCTION_SUGGESTIONS = [
  "COUNT()",
  "COUNT_DISTINCT()",
  "SUM()",
  "AVG()",
  "MIN()",
  "MAX()",
  "CALENDAR_MONTH()",
  "CALENDAR_QUARTER()",
  "CALENDAR_YEAR()",
  "DAY_IN_MONTH()",
  "DAY_IN_WEEK()",
  "DAY_IN_YEAR()",
  "DAY_ONLY()",
  "FISCAL_MONTH()",
  "FISCAL_QUARTER()",
  "FISCAL_YEAR()",
  "HOUR_IN_DAY()",
  "WEEK_IN_MONTH()",
  "WEEK_IN_YEAR()",
  "CONVERTTIMEZONE()",
  "FORMAT()",
  "TOLABEL()"
];

// SOQL WHERE 常用关键字与日期字面量候选。
const SOQL_WHERE_SUGGESTIONS = [
  "AND",
  "OR",
  "NOT",
  "IN",
  "NOT IN",
  "INCLUDES",
  "EXCLUDES",
  "LIKE",
  "NULL",
  "TRUE",
  "FALSE",
  "TODAY",
  "YESTERDAY",
  "TOMORROW",
  "THIS_WEEK",
  "LAST_WEEK",
  "NEXT_WEEK",
  "THIS_MONTH",
  "LAST_MONTH",
  "NEXT_MONTH",
  "THIS_QUARTER",
  "LAST_QUARTER",
  "NEXT_QUARTER",
  "THIS_YEAR",
  "LAST_YEAR",
  "NEXT_YEAR",
  "LAST_N_DAYS:7",
  "NEXT_N_DAYS:7",
  "LAST_N_MONTHS:3",
  "NEXT_N_MONTHS:3",
  "LAST_N_YEARS:1",
  "NEXT_N_YEARS:1"
];

// SOQL 排序关键字候选：配合字段名输入完整 ORDER BY 条件。
const SOQL_ORDER_BY_SUGGESTIONS = ["ASC", "DESC", "NULLS FIRST", "NULLS LAST"];

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
  onToggleDrawer: (drawerView?: "salesforce" | "mysql-ddl" | "mysql-fields") => void;
  // 刷新当前对象 DDL：仅 MySQL 抽屉使用。
  onRefreshMysqlDdl: () => void;
  onToggleQueryBar: () => void;
  onToggleLogs: () => void;
  onWhereChange: (value: string) => void;
  onLimitChange: (value: number) => void;
  onSortFieldChange: (value: string) => void;
  onSortDirectionChange: (value: "ASC" | "DESC") => void;
  onSortClauseChange: (value: string) => void;
  onQuery: (overrides?: QueryOverrides) => void;
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

type QueryBarProps = {
  // 当前激活 Tab：用于初始化草稿值，并在切换 Tab 时重置草稿。
  activeTab: TabState;
  // 是否 MySQL 数据源：用于切换输入组件与候选词集合。
  isMysqlSource: boolean;
  // MySQL WHERE 候选词。
  mysqlWhereSuggestions: string[];
  // MySQL 排序候选词。
  mysqlSortSuggestions: string[];
  // Salesforce WHERE 候选词。
  salesforceWhereSuggestions: string[];
  // Salesforce 排序候选词。
  salesforceSortSuggestions: string[];
  // 写入 WHERE：用于防抖回写到 store。
  onWhereChange: (value: string) => void;
  // 写入 LIMIT：用于防抖回写到 store。
  onLimitChange: (value: number) => void;
  // 写入排序表达式：用于防抖回写到 store。
  onSortClauseChange: (value: string) => void;
  // 执行查询：支持用草稿覆盖值执行，避免依赖 store 回写完成。
  onQuery: (overrides?: QueryOverrides) => void;
};

type MysqlMutationPreviewState = {
  // 弹窗是否打开。
  open: boolean;
  // 当前是否正在生成预览或执行提交。
  loading: boolean;
  // 预览阶段错误信息。
  error: string;
  // 新增操作数量。
  createCount: number;
  // 更新操作数量。
  updateCount: number;
  // 删除操作数量。
  deleteCount: number;
  // 结构化预览项列表。
  items: MutationPreviewItem[];
};

// 查询栏：将输入草稿隔离在子组件内，避免输入时触发 DataGrid 等重组件重渲染导致卡顿。
function QueryBar({
  activeTab,
  isMysqlSource,
  mysqlWhereSuggestions,
  mysqlSortSuggestions,
  salesforceWhereSuggestions,
  salesforceSortSuggestions,
  onWhereChange,
  onLimitChange,
  onSortClauseChange,
  onQuery
}: QueryBarProps) {
  // Store：直接更新目标 Tab，避免“常驻挂载 + 防抖回写”在切换 Tab 后误写到其它 Tab。
  const patchTabInStore = useAppStore((state) => state.patchTab);
  const activeTabIdentity = activeTab.bindingKey || buildObjectTabBindingKey(activeTab.sourceId || "", activeTab.objectName);

  // 回写 WHERE：按当前 QueryBar 绑定的对象 Tab 精准写入。
  function commitWhereClause(value: string) {
    patchTabInStore(activeTabIdentity, (item) => ({ ...item, whereClause: value })); // 行内注释：仅更新目标 Tab 的 WHERE，避免跨 Tab 串写。
  }

  // 回写 LIMIT：按当前 QueryBar 绑定的对象 Tab 精准写入。
  function commitLimit(value: number) {
    patchTabInStore(activeTabIdentity, (item) => ({ ...item, limit: value })); // 行内注释：仅更新目标 Tab 的 LIMIT，避免跨 Tab 串写。
  }

  // 回写排序表达式：同步兼容旧版 sortField/sortDirection 显示逻辑。
  function commitSortClause(value: string) {
    patchTabInStore(activeTabIdentity, (item) => {
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
      const match = firstPart?.match(/^([A-Za-z_][\\w.]*)\\s*(ASC|DESC)?/i);
      const parsedField = match?.[1] || item.sortField;
      const parsedDirection = (match?.[2]?.toUpperCase() as "ASC" | "DESC" | undefined) || item.sortDirection;
      return {
        ...item,
        sortClause: value,
        sortField: parsedField,
        sortDirection: parsedDirection
      };
    });
  }

  // WHERE 草稿：输入时只更新本地状态，防抖回写 store。
  const [whereDraft, setWhereDraft] = useState(activeTab.whereClause);
  // 排序草稿：Salesforce 兼容旧版字段排序显示（sortField + sortDirection）。
  const [sortDraft, setSortDraft] = useState(
    activeTab.sortClause || (activeTab.sortField ? `${activeTab.sortField} ${activeTab.sortDirection}` : "")
  );
  // LIMIT 草稿：输入时保持数字态，避免直接写入 store 触发全局重渲染。
  const [limitDraft, setLimitDraft] = useState(activeTab.limit);

  // 草稿引用：用于在 effect 清理阶段读取最新草稿值。
  const whereDraftRef = useRef(whereDraft);
  const sortDraftRef = useRef(sortDraft);
  const limitDraftRef = useRef(limitDraft);
  useEffect(() => {
    whereDraftRef.current = whereDraft;
  }, [whereDraft]);
  useEffect(() => {
    sortDraftRef.current = sortDraft;
  }, [sortDraft]);
  useEffect(() => {
    limitDraftRef.current = limitDraft;
  }, [limitDraft]);

  // 防抖计时器：避免每次按键都回写 store。
  const whereTimerRef = useRef<number | null>(null);
  const sortTimerRef = useRef<number | null>(null);
  const limitTimerRef = useRef<number | null>(null);

  // 清理计时器：统一在切换 Tab 或卸载时执行，避免跨 Tab 写错目标。
  function clearTimers() {
    if (whereTimerRef.current) {
      window.clearTimeout(whereTimerRef.current);
      whereTimerRef.current = null;
    }
    if (sortTimerRef.current) {
      window.clearTimeout(sortTimerRef.current);
      sortTimerRef.current = null;
    }
    if (limitTimerRef.current) {
      window.clearTimeout(limitTimerRef.current);
      limitTimerRef.current = null;
    }
  }

  // 刷新草稿：切换对象 Tab 时从 store 值重置草稿，并同步清理计时器。
  useEffect(() => {
    clearTimers(); // 先取消旧 Tab 的防抖回写，避免写入新 Tab。
    setWhereDraft(activeTab.whereClause);
    setSortDraft(activeTab.sortClause || (activeTab.sortField ? `${activeTab.sortField} ${activeTab.sortDirection}` : ""));
    setLimitDraft(activeTab.limit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab.objectName]);

  // 卸载或切换 Tab 前尽量回写草稿：保证用户快速切换 Tab 时不会丢失输入。
  useEffect(() => {
    return () => {
      // 先清理计时器，避免清理后仍触发旧定时器回写。
      clearTimers();
      // 仅在草稿与 store 不一致时回写，避免无意义的状态更新。
      if (whereDraftRef.current !== activeTab.whereClause) {
        commitWhereClause(whereDraftRef.current); // 行内注释：切换 Tab 前强制回写到“当前绑定 Tab”。
      }
      const nextLimit = limitDraftRef.current;
      if (nextLimit !== activeTab.limit) {
        commitLimit(nextLimit); // 行内注释：切换 Tab 前强制回写到“当前绑定 Tab”。
      }
      // 排序草稿与 store 的 sortClause/旧版 sortField 显示可能存在差异，这里统一回写 sortClause。
      const nextSortDraft = sortDraftRef.current;
      if (nextSortDraft !== (activeTab.sortClause || (activeTab.sortField ? `${activeTab.sortField} ${activeTab.sortDirection}` : ""))) {
        commitSortClause(nextSortDraft); // 行内注释：切换 Tab 前强制回写到“当前绑定 Tab”。
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab.objectName]);

  // 防抖回写 WHERE：250ms 内连续输入只写一次 store。
  function scheduleWhereCommit(nextValue: string) {
    if (whereTimerRef.current) window.clearTimeout(whereTimerRef.current);
    whereTimerRef.current = window.setTimeout(() => {
      whereTimerRef.current = null;
      commitWhereClause(nextValue); // 行内注释：防抖回写到“当前绑定 Tab”，避免切换后写错目标。
    }, 250);
  }

  // 防抖回写排序：250ms 内连续输入只写一次 store。
  function scheduleSortCommit(nextValue: string) {
    if (sortTimerRef.current) window.clearTimeout(sortTimerRef.current);
    sortTimerRef.current = window.setTimeout(() => {
      sortTimerRef.current = null;
      commitSortClause(nextValue); // 行内注释：防抖回写到“当前绑定 Tab”，避免切换后写错目标。
    }, 250);
  }

  // 防抖回写 LIMIT：输入过程保持流畅，停顿后再同步 store。
  function scheduleLimitCommit(nextValue: number) {
    if (limitTimerRef.current) window.clearTimeout(limitTimerRef.current);
    limitTimerRef.current = window.setTimeout(() => {
      limitTimerRef.current = null;
      commitLimit(nextValue); // 行内注释：防抖回写到“当前绑定 Tab”，避免切换后写错目标。
    }, 250);
  }

  // 执行查询：优先使用草稿覆盖值，保证点击查询时使用最新输入。
  function handleQueryClick() {
    if (activeTab.loading) return;
    // 查询前先取消防抖回写，避免“点击查询后又被旧定时器回写”产生错觉。
    clearTimers();
    // 主动回写一次，保证 UI 切换 Tab 或其它地方读取 store 时拿到一致值。
    commitWhereClause(whereDraftRef.current); // 行内注释：执行前强制写入 store，保证后续依赖值一致。
    commitLimit(limitDraftRef.current); // 行内注释：执行前强制写入 store，保证后续依赖值一致。
    commitSortClause(sortDraftRef.current); // 行内注释：执行前强制写入 store，保证后续依赖值一致。
    onQuery({
      whereClause: whereDraftRef.current,
      limit: limitDraftRef.current,
      sortClause: sortDraftRef.current
    });
  }

  return (
    // 查询栏容器：保持最小高度，避免内容区抖动。
    <div className="border-b border-base-300 px-3 py-2">
      {/* 输入区：按数据源类型切换 SQL/SOQL 提示与候选。 */}
      <div className="flex min-w-max flex-row items-end gap-2">
        {isMysqlSource ? (
          <MysqlSmartInput
            key={`mysql-where-${activeTab.objectName}`}
            label="WHERE"
            value={whereDraft}
            placeholder="例如：status = 'ACTIVE' AND created_at >= '2025-01-01'"
            // MySQL WHERE：仅更新草稿，防抖回写 store。
            onChange={(value) => {
              setWhereDraft(value); // 输入实时更新草稿，保证光标与输入联动不卡顿。
              scheduleWhereCommit(value); // 防抖写入 store，避免触发全局重渲染。
            }}
            suggestions={mysqlWhereSuggestions}
            defaultWidth={360}
            allowClear
            onSubmit={handleQueryClick}
          />
        ) : (
          <SalesforceSmartInput
            key={`soql-where-${activeTab.objectName}`}
            label="WHERE"
            value={whereDraft}
            placeholder="例如：CreatedDate >= LAST_N_DAYS:7 AND Name LIKE 'Acme%'"
            // Salesforce WHERE：仅更新草稿，防抖回写 store。
            onChange={(value) => {
              setWhereDraft(value); // 输入实时更新草稿。
              scheduleWhereCommit(value); // 防抖写入 store。
            }}
            suggestions={salesforceWhereSuggestions}
            defaultWidth={360}
            allowClear
            onSubmit={handleQueryClick}
          />
        )}

        {isMysqlSource ? (
          <>
            <MysqlSmartInput
              key={`mysql-sort-${activeTab.objectName}`}
              label="排序"
              value={sortDraft || ""}
              placeholder="例如：created_at DESC, id ASC"
              // MySQL 排序：仅更新草稿，防抖回写 store。
              onChange={(value) => {
                setSortDraft(value); // 输入实时更新草稿。
                scheduleSortCommit(value); // 防抖写入 store。
              }}
              suggestions={mysqlSortSuggestions}
              defaultWidth={300}
              allowClear
              onSubmit={handleQueryClick}
            />

            <div className="w-[90px]">
              {/* LIMIT 标题。 */}
              <label className="mb-1 block text-[12px]">LIMIT</label>
              {/* LIMIT 输入框：输入时不立即回写 store，避免全局重渲染导致卡顿。 */}
              <input
                className="input input-bordered input-sm h-[38px] min-h-[38px] w-full leading-[20px]"
                type="number"
                value={limitDraft}
                onChange={(event) => {
                  const next = Number(event.target.value || 200);
                  setLimitDraft(next); // 输入实时更新草稿。
                  scheduleLimitCommit(next); // 防抖写入 store。
                }}
              />
            </div>
          </>
        ) : (
          <>
            <SalesforceSmartInput
              key={`soql-sort-${activeTab.objectName}`}
              label="排序"
              value={sortDraft || ""}
              placeholder="例如：LastModifiedDate DESC, Name ASC"
              // Salesforce 排序：支持手动输入完整 ORDER BY 片段，输入过程使用草稿态。
              onChange={(value) => {
                setSortDraft(value); // 输入实时更新草稿。
                scheduleSortCommit(value); // 防抖写入 store。
              }}
              suggestions={salesforceSortSuggestions}
              defaultWidth={300}
              allowClear
              onSubmit={handleQueryClick}
            />

            <div className="w-[90px]">
              {/* LIMIT 标题。 */}
              <label className="mb-1 block text-[12px]">LIMIT</label>
              {/* LIMIT 输入框：输入时不立即回写 store。 */}
              <input
                className="input input-bordered input-sm h-[38px] min-h-[38px] w-full leading-[20px]"
                type="number"
                value={limitDraft}
                onChange={(event) => {
                  const next = Number(event.target.value || 200);
                  setLimitDraft(next); // 输入实时更新草稿。
                  scheduleLimitCommit(next); // 防抖写入 store。
                }}
              />
            </div>
          </>
        )}

        {/* 查询按钮：点击时用草稿覆盖参数执行，保证查询使用最新输入。 */}
        <button className="btn btn-primary btn-sm mt-5 h-[35px]" disabled={activeTab.loading} onClick={handleQueryClick}>
          <Search size={14} />
          查询
        </button>
      </div>
    </div>
  );
}

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
  // MySQL 结果集可更新性：从当前执行 SQL 与 describe 中保守推导编辑能力。
  const mysqlResultUpdateCapability = useMemo(
    () =>
      resolveMysqlResultUpdateCapability({
        sourceType: activeTab?.sourceType || selectedSourceType,
        objectName: activeTab?.objectName || "",
        describe: activeTab?.describe || null,
        queryText: activeTab?.currentSoql || ""
      }),
    [activeTab?.currentSoql, activeTab?.describe, activeTab?.objectName, activeTab?.sourceType, selectedSourceType]
  );
  // MySQL 结果集只读原因：为空表示当前结果集允许编辑。
  const mysqlResultReadonlyReason = isMysqlSource && !mysqlResultUpdateCapability.editable
    ? mysqlResultUpdateCapability.reason
    : "";
  // MySQL 新建行必填缺失：用于前置禁用“执行更新”，避免用户点了才收到错误。
  const mysqlHasMissingRequiredCreateFields = useMemo(
    () => isMysqlSource && Boolean(activeTab?.describe) && hasMysqlMissingRequiredFields(activeTab?.result.records || [], activeTab?.describe || null),
    [isMysqlSource, activeTab?.describe, activeTab?.result.records]
  );
  const mysqlApplyDisabledReason = mysqlResultReadonlyReason
    || (mysqlHasMissingRequiredCreateFields ? "存在 NOT NULL 且无默认值的新增字段未填写，请先补全红色高亮字段。" : "");
  // “执行更新”按钮是否可用：可用时使用绿色强调，强化“可提交”感知。
  const canApplyPendingChanges = Boolean(activeTab && !activeTab.loading && hasPendingChanges && !mysqlApplyDisabledReason);
  // 工具栏背景色：将数据源颜色转换为浅色表面背景，避免顶部工具栏过重抢视觉焦点。
  const toolbarBackgroundColor = buildSourceSurfacePalette(String(activeTab?.sourceColor || "").trim())?.backgroundColor || "#FFFFFF";
  // 工具栏按钮统一尺寸：使用 34px 中间档高度（介于 h-8 与 h-9 之间）。
  const toolbarButtonClassName = "btn btn-outline btn-sm h-[34px] min-h-[34px]";
  // “执行更新”按钮样式：可用态使用蓝青渐变强调，贴合项目品牌色并提升可见性。
  const applyButtonClassName = canApplyPendingChanges
    ? "btn btn-sm h-[34px] min-h-[34px] border border-brand-600 bg-gradient-to-r from-brand-600 to-brand-500 text-white shadow-[0_6px_16px_rgba(18,158,242,0.25)] hover:from-brand-700 hover:to-brand-600"
    : toolbarButtonClassName;
  // 字段搜索模式：支持“名称/标签”与“数据类型”两种过滤维度。
  const [fieldSearchMode, setFieldSearchMode] = useState<"nameOrLabel" | "dataType">("nameOrLabel");
  // 字段搜索关键词：用于过滤当前对象字段列表。
  const [fieldSearchKeyword, setFieldSearchKeyword] = useState("");
  // MySQL 字段抽屉搜索关键词：仅按字段名过滤。
  const [mysqlFieldSearchKeyword, setMysqlFieldSearchKeyword] = useState("");
  // 当前抽屉视图：MySQL 支持 DDL / 字段两种视图；Salesforce 固定复合抽屉。
  const activeDrawerView = isMysqlSource
    ? activeTab?.drawerView === "mysql-fields"
      ? "mysql-fields"
      : "mysql-ddl"
    : "salesforce";
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
  // MySQL 提交前预览弹窗状态：统一承载摘要、预览项与加载/错误信息。
  const [mysqlMutationPreviewState, setMysqlMutationPreviewState] = useState<MysqlMutationPreviewState>({
    open: false,
    loading: false,
    error: "",
    createCount: 0,
    updateCount: 0,
    deleteCount: 0,
    items: []
  });

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
  // 当前对象字段名候选：Salesforce WHERE 自动补全使用。
  const salesforceFieldSuggestions = useMemo(
    () => (activeTab?.describe?.fields || []).map((field) => field.name),
    [activeTab?.describe?.fields]
  );
  // Salesforce WHERE 输入框候选：字段 + SOQL 函数 + 关键字/日期字面量。
  const salesforceWhereSuggestions = useMemo(
    () => [...salesforceFieldSuggestions, ...SOQL_FUNCTION_SUGGESTIONS, ...SOQL_WHERE_SUGGESTIONS],
    [salesforceFieldSuggestions]
  );
  // Salesforce 排序字段候选：仅允许字段元数据中 sortable=true 的字段参与自动补全。
  const salesforceSortableFieldSuggestions = useMemo(() => sortableFields.map((field) => field.name), [sortableFields]);
  // Salesforce 排序候选：可排序字段 + 排序关键字。
  const salesforceSortSuggestions = useMemo(
    () => [...salesforceSortableFieldSuggestions, ...SOQL_ORDER_BY_SUGGESTIONS],
    [salesforceSortableFieldSuggestions]
  );
  // 当前对象字段搜索结果：按搜索模式过滤名称/标签或数据类型。
  const filteredDrawerFields = useMemo(() => {
    const allFields = activeTab?.describe?.fields || [];
    const trimmedKeyword = fieldSearchKeyword.trim().toLowerCase();
    if (!trimmedKeyword) return allFields;
    return allFields.filter((field) => {
      if (fieldSearchMode === "dataType") {
        return String(field.dataType || "").toLowerCase().includes(trimmedKeyword);
      }
      const normalizedName = String(field.name || "").toLowerCase();
      const normalizedLabel = String(field.label || "").toLowerCase();
      return normalizedName.includes(trimmedKeyword) || normalizedLabel.includes(trimmedKeyword);
    });
  }, [activeTab?.describe?.fields, fieldSearchKeyword, fieldSearchMode]);
  // MySQL 字段搜索结果：只按字段名过滤，行为对齐“字段与SOQL”中的字段搜索体验。
  const filteredMysqlDrawerFields = useMemo(() => {
    const allFields = activeTab?.describe?.fields || [];
    const trimmedKeyword = mysqlFieldSearchKeyword.trim().toLowerCase();
    if (!trimmedKeyword) return allFields;
    return allFields.filter((field) => String(field.name || "").toLowerCase().includes(trimmedKeyword));
  }, [activeTab?.describe?.fields, mysqlFieldSearchKeyword]);

  useEffect(() => {
    setSoqlObjectFieldsMap({}); // 切换数据源后清空缓存，避免跨源字段污染。
  }, [selectedSourceId]);

  // 切换对象 Tab 时重置字段搜索，避免跨对象保留旧关键词导致“空结果”误解。
  useEffect(() => {
    setFieldSearchKeyword("");
    setFieldSearchMode("nameOrLabel");
    setMysqlFieldSearchKeyword("");
  }, [activeTab?.objectName]);

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

  // 打开 MySQL 提交前预览：先用本地 planner 生成结构化摘要，再向后端换取预览 SQL。
  async function openMysqlMutationPreview() {
    if (!activeTab?.describe) return;
    const resolvedSourceId = activeTab.sourceId || selectedSourceId;
    const editableFields = new Set(activeTab.describe.fields.map((field) => field.name));
    const mysqlPrimaryKeyField =
      activeTab.describe.fields.find((field) => String(field.metadata?.columnKey || "").toUpperCase() === "PRI")?.name || "";
    const mutationPlan = buildMysqlMutationPlan({
      records: activeTab.result.records,
      baselineRecords: activeTab.baselineRecords,
      dirtyCellKeys: activeTab.dirtyCellKeys,
      pendingDeleteRecordIds: activeTab.pendingDeleteRecordIds,
      editableFields,
      sourceType: activeTab.sourceType || selectedSourceType,
      mysqlPrimaryKeyField
    });

    if (mutationPlan.missingRecordIdRows.length > 0) {
      onShowMessage(
        `MySQL 更新失败：存在已编辑或待删除但缺少 Id 的行（第 ${mutationPlan.missingRecordIdRows.join("、")} 行）。请确保查询结果包含主键列。`
      );
      return;
    }

    setMysqlMutationPreviewState({
      open: true,
      loading: true,
      error: "",
      createCount: mutationPlan.creates.length,
      updateCount: mutationPlan.updates.length,
      deleteCount: mutationPlan.deletes.length,
      items: mutationPlan.previewItems
    });

    try {
      const previewSqlItems = await api.previewSaveRecordsWithDeletes({
        sourceId: resolvedSourceId,
        objectName: activeTab.objectName,
        creates: mutationPlan.creates,
        updates: mutationPlan.updates,
        deletes: mutationPlan.deletes
      });
      setMysqlMutationPreviewState((state) => ({
        ...state,
        loading: false,
        items: mergeMysqlPreviewSqlItems(mutationPlan.previewItems, previewSqlItems)
      }));
    } catch (error) {
      setMysqlMutationPreviewState((state) => ({
        ...state,
        loading: false,
        error: `生成预览 SQL 失败：${String(error)}`
      }));
    }
  }

  // 点击“执行更新”时：MySQL 先走预览弹窗，Salesforce 保持原有直提交流程。
  async function handleApplyPendingChangesClick() {
    if (!isMysqlSource) {
      void onApplyPendingChanges(); // 行内注释：Salesforce 维持现有直提交流程，不引入额外预览步骤。
      return;
    }
    await openMysqlMutationPreview(); // 行内注释：MySQL 先展示结构化预览，确认后再真正执行。
  }

  // 确认执行当前预览：真正调用运行时提交逻辑，成功/失败提示仍由运行时统一写回 Tab notice。
  async function handleConfirmMysqlMutationPreview() {
    setMysqlMutationPreviewState((state) => ({
      ...state,
      loading: true,
      error: ""
    }));
    await onApplyPendingChanges();
    setMysqlMutationPreviewState({
      open: false,
      loading: false,
      error: "",
      createCount: 0,
      updateCount: 0,
      deleteCount: 0,
      items: []
    });
  }

  // 关闭预览弹窗：执行中不允许关闭，避免用户误判当前提交状态。
  function closeMysqlMutationPreview() {
    if (mysqlMutationPreviewState.loading) return;
    setMysqlMutationPreviewState({
      open: false,
      loading: false,
      error: "",
      createCount: 0,
      updateCount: 0,
      deleteCount: 0,
      items: []
    });
  }

  // 统计本次预览里会显式写入 NULL 的字段数量，供摘要区直接展示。
  const mysqlPreviewNullWriteCount = useMemo(
    () =>
      mysqlMutationPreviewState.items.reduce(
        (count, item) => count + item.fields.filter((field) => field.kind === "null").length,
        0
      ),
    [mysqlMutationPreviewState.items]
  );

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
              const tabIdentity = tab.bindingKey || buildObjectTabBindingKey(tab.sourceId || "", tab.objectName);
              const active = tabIdentity === activeTabObjectName || tab.objectName === activeTabObjectName;
              const tabIndex = tabs.findIndex((item) => {
                const itemIdentity = item.bindingKey || buildObjectTabBindingKey(item.sourceId || "", item.objectName);
                return itemIdentity === tabIdentity;
              });
              const hasLeftTabs = tabIndex > 0;
              const hasRightTabs = tabIndex >= 0 && tabIndex < tabs.length - 1;
              const hasOtherTabs = tabs.length > 1;
              return (
                <div
                  key={tabIdentity}
                  className={`flex items-center border-r border-base-300 ${active ? "bg-base-100" : ""}`}
                  onContextMenu={(event) => {
                    event.preventDefault(); // 阻止浏览器默认右键菜单。
                    onActivateTab(tabIdentity); // 右键时先切换到目标 Tab，避免操作目标不一致。
                    setTabContextMenu({ x: event.clientX, y: event.clientY, objectName: tabIdentity }); // 打开自定义菜单。
                  }}
                >
                  <button
                    className={`min-w-0 px-3 py-2 text-[12px] ${active ? "text-primary" : "text-neutral/70"}`}
                    onClick={() => onActivateTab(tabIdentity)}
                  >
                    {tab.objectName}
                  </button>
                  <button className="btn btn-circle btn-ghost btn-xs mr-1" onClick={() => onCloseTab(tabIdentity)}>
                    <X size={13} />
                  </button>
                  {/* Tab 右键菜单：提供常见批量关闭操作。 */}
                  {tabContextMenu?.objectName === tabIdentity && (
                    <ContextMenu
                      x={tabContextMenu.x}
                      y={tabContextMenu.y}
                      minWidthClassName="min-w-[132px]"
                      entries={[
                        {
                          id: "close-current",
                          label: "关闭当前",
                          onClick: () => {
                            onCloseCurrentTab(tabIdentity); // 关闭当前 Tab。
                            setTabContextMenu(null); // 执行后关闭菜单。
                          }
                        },
                        {
                          id: "close-left",
                          label: "关闭左侧",
                          disabled: !hasLeftTabs,
                          onClick: () => {
                            onCloseLeftTabs(tabIdentity); // 关闭目标 Tab 左侧所有 Tab。
                            setTabContextMenu(null); // 执行后关闭菜单。
                          }
                        },
                        {
                          id: "close-right",
                          label: "关闭右侧",
                          disabled: !hasRightTabs,
                          onClick: () => {
                            onCloseRightTabs(tabIdentity); // 关闭目标 Tab 右侧所有 Tab。
                            setTabContextMenu(null); // 执行后关闭菜单。
                          }
                        },
                        {
                          id: "close-other",
                          label: "关闭其他",
                          disabled: !hasOtherTabs,
                          onClick: () => {
                            onCloseOtherTabs(tabIdentity); // 仅保留目标 Tab，关闭其它 Tab。
                            setTabContextMenu(null); // 执行后关闭菜单。
                          }
                        },
                        {
                          id: "close-all",
                          label: "全部关闭",
                          disabled: tabs.length === 0,
                          onClick: () => {
                            onCloseAllTabs(); // 关闭全部 Tab。
                            setTabContextMenu(null); // 执行后关闭菜单。
                          }
                        }
                      ] satisfies ContextMenuEntry[]}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {activeTab && (
        // 主工作区。
        <div className="relative flex h-full min-h-0 w-full overflow-hidden">
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
            {/* 顶部工具栏背景：默认白色；如果数据源设置颜色，则整条按钮区域显示该颜色。 */}
            <div className="border-b border-base-300 px-3 py-1.5 overflow-x-auto" style={{ backgroundColor: toolbarBackgroundColor }}>
              <div className="flex flex-row items-center gap-1 min-w-max">
                <button
                  className={toolbarButtonClassName}
                  disabled={activeTab.loading || Boolean(mysqlResultReadonlyReason)}
                  title={mysqlResultReadonlyReason || undefined}
                  onClick={onCreateRecord}
                >
                  <Plus size={13} />
                  新建记录
                </button>
                <button
                  className={`${toolbarButtonClassName} btn-error`}
                  disabled={activeTab.loading || activeTab.selectedRecordIds.length === 0 || Boolean(mysqlResultReadonlyReason)}
                  title={mysqlResultReadonlyReason || undefined}
                  onClick={onDeleteCheckedRecords}
                >
                  <Trash2 size={13} />
                  删除勾选({activeTab.selectedRecordIds.length})
                </button>
                <button
                  className={applyButtonClassName}
                  disabled={activeTab.loading || !hasPendingChanges || Boolean(mysqlApplyDisabledReason)}
                  title={mysqlApplyDisabledReason || undefined}
                  onClick={() => void handleApplyPendingChangesClick()}
                >
                  <Play size={13} />
                  执行更新
                </button>
                <button className={toolbarButtonClassName} disabled={activeTab.loading || !hasPendingChanges} onClick={onDiscardPendingChanges}>
                  <RotateCcw size={13} />
                  撤回修改
                </button>
                <button className={toolbarButtonClassName} disabled={activeTab.loading} onClick={onToggleQueryBar}>
                  <Search size={13} />
                  {activeTab.showQueryBar ? "隐藏查询栏" : "显示查询栏"}
                </button>
                {isMysqlSource ? (
                  <>
                    {/* MySQL DDL 抽屉按钮：点击同按钮可关闭，再次点击可打开。 */}
                    <button
                      className={`${toolbarButtonClassName} ${activeTab.showDrawer && activeDrawerView === "mysql-ddl" ? "btn-active" : ""}`}
                      disabled={activeTab.loading}
                      onClick={() => onToggleDrawer("mysql-ddl")}
                    >
                      <PanelRightOpen size={13} />
                      DDL
                    </button>
                    {/* MySQL 字段抽屉按钮：参考 Salesforce“字段与SOQL”中的字段勾选能力。 */}
                    <button
                      className={`${toolbarButtonClassName} ${activeTab.showDrawer && activeDrawerView === "mysql-fields" ? "btn-active" : ""}`}
                      disabled={activeTab.loading}
                      onClick={() => onToggleDrawer("mysql-fields")}
                    >
                      <PanelRightOpen size={13} />
                      字段
                    </button>
                  </>
                ) : (
                  <button className={toolbarButtonClassName} disabled={activeTab.loading} onClick={() => onToggleDrawer("salesforce")}>
                    <PanelRightOpen size={13} />
                    字段与SOQL
                  </button>
                )}
                <button className={toolbarButtonClassName} disabled={activeTab.loading} onClick={onToggleLogs}>
                  <ScrollText size={13} />
                  日志
                </button>
              </div>
            </div>

            {/* MySQL 只读原因条：在用户进入编辑前就明确解释为什么当前结果集不能改。 */}
            {mysqlResultReadonlyReason && (
              <div className="border-b border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning-content">
                当前结果集已切换为只读：{mysqlResultReadonlyReason}
              </div>
            )}

            {/* 查询栏。 */}
            {activeTab.showQueryBar && (
              <QueryBar
                activeTab={activeTab}
                isMysqlSource={isMysqlSource}
                mysqlWhereSuggestions={mysqlWhereSuggestions}
                mysqlSortSuggestions={mysqlSortSuggestions}
                salesforceWhereSuggestions={salesforceWhereSuggestions}
                salesforceSortSuggestions={salesforceSortSuggestions}
                onWhereChange={onWhereChange}
                onLimitChange={onLimitChange}
                onSortClauseChange={onSortClauseChange}
                onQuery={onQuery}
              />
            )}

            {/* 数据网格区。 */}
            <div className="min-h-0 flex-1">
              <DataGrid
                result={activeTab.result}
                visibleColumns={visibleColumns}
                fieldMetadataMap={fieldMetadataMap}
                dirtyCellKeys={activeTab.dirtyCellKeys}
                selectedRecordIds={activeTab.selectedRecordIds}
                readOnlyMode={Boolean(mysqlResultReadonlyReason)}
                readOnlyReasonText={mysqlResultReadonlyReason}
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
                aria-label={
                  isMysqlSource
                    ? activeDrawerView === "mysql-fields"
                      ? "拖拽调整字段抽屉宽度"
                      : "拖拽调整DDL抽屉宽度"
                    : "拖拽调整字段与SOQL抽屉宽度"
                }
                onMouseDown={(event) => {
                  event.preventDefault(); // 阻止拖拽起点触发文本选中。
                  drawerResizeStartXRef.current = event.clientX; // 记录本次拖拽起点 X。
                  drawerResizeStartWidthRef.current = drawerWidth; // 记录本次拖拽起始宽度。
                  setDraggingDrawerResize(true); // 进入拖拽状态。
                }}
              />
              {isMysqlSource && activeDrawerView === "mysql-ddl" ? (
                <div className="flex min-h-0 flex-1 flex-col bg-base-100">
                  <div className="flex items-center justify-between border-b border-base-300 px-3 py-2">
                    <span className="text-[12px] text-neutral/70">DDL</span>
                    <div className="flex flex-row items-center gap-1">
                      <button className="btn btn-ghost btn-xs" disabled={mysqlDdlLoading || activeTab.loading} onClick={onRefreshMysqlDdl}>
                        刷新
                      </button>
                      <button className="btn btn-circle btn-ghost btn-xs" onClick={() => onToggleDrawer("mysql-ddl")} aria-label="关闭DDL抽屉">
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
              ) : isMysqlSource && activeDrawerView === "mysql-fields" ? (
                <div className="flex min-h-0 flex-1 flex-col bg-base-100">
                  <div className="flex items-center justify-between border-b border-base-300 px-3 py-2">
                    <span className="text-[12px] text-neutral/70">字段</span>
                    <div className="flex flex-row items-center gap-1">
                      <button className="btn btn-ghost btn-xs" disabled={activeTab.loading || !activeTab.describe} onClick={onToggleAllFields}>
                        {activeTab.describe?.fields.every((field) => (activeTab.columnVisibility[field.name] ?? true) === true) ? "取消全选" : "全选"}
                      </button>
                      <button className="btn btn-circle btn-ghost btn-xs" onClick={() => onToggleDrawer("mysql-fields")} aria-label="关闭字段抽屉">
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                  {/* MySQL 字段搜索栏：仅按字段名搜索。 */}
                  <div className="flex items-center gap-2 border-b border-base-300 px-3 py-2">
                    <label className="input input-bordered input-xs flex h-7 flex-1 items-center gap-1">
                      <Search size={12} className="text-neutral/60" />
                      <input
                        value={mysqlFieldSearchKeyword}
                        onChange={(event) => setMysqlFieldSearchKeyword(event.target.value)}
                        placeholder="搜索字段名，例如 created_at"
                        className="w-full bg-transparent text-[12px]"
                        disabled={!activeTab.describe || activeTab.describe.fields.length === 0}
                      />
                      {mysqlFieldSearchKeyword.trim().length > 0 && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs btn-circle"
                          onClick={() => setMysqlFieldSearchKeyword("")}
                          aria-label="清空字段搜索关键词"
                          disabled={!activeTab.describe || activeTab.describe.fields.length === 0}
                        >
                          <X size={12} />
                        </button>
                      )}
                    </label>
                  </div>
                  {/* MySQL 字段列表：通过勾选控制数据表列显示。 */}
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
                    {activeTab.describe && activeTab.describe.fields.length > 0 && filteredMysqlDrawerFields.length === 0 && (
                      <div className="px-3 py-2">
                        <span className="text-[12px] text-neutral/70">未匹配到字段，请调整搜索条件。</span>
                      </div>
                    )}
                    {filteredMysqlDrawerFields.map((field) => {
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
                            <span className="truncate text-[12px] text-neutral/70">{field.dataType}</span>
                          </div>
                          <div className="mt-2 border-b border-base-300" />
                        </div>
                      );
                    })}
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
                    <button className="btn btn-circle btn-ghost btn-xs" onClick={() => onToggleDrawer("salesforce")} aria-label="关闭字段与SOQL">
                      <X size={14} />
                    </button>
                  </div>
                </div>
                {/* 字段搜索栏：可按名称/标签或数据类型过滤当前对象字段。 */}
                <div className="flex items-center gap-2 border-b border-base-300 px-3 py-2">
                  {/* 搜索模式选择器。 */}
                  <select
                    className="select select-bordered select-xs w-[120px]"
                    value={fieldSearchMode}
                    onChange={(event) => setFieldSearchMode(event.target.value as "nameOrLabel" | "dataType")}
                    disabled={!activeTab.describe || activeTab.describe.fields.length === 0}
                  >
                    <option value="nameOrLabel">名称/Label</option>
                    <option value="dataType">数据类型</option>
                  </select>
                  {/* 搜索关键词输入框。 */}
                  <label className="input input-bordered input-xs flex h-7 flex-1 items-center gap-1">
                    <Search size={12} className="text-neutral/60" />
                    <input
                      value={fieldSearchKeyword}
                      onChange={(event) => setFieldSearchKeyword(event.target.value)}
                      placeholder={fieldSearchMode === "dataType" ? "搜索数据类型，例如 string" : "搜索字段名称或 Label"}
                      className="w-full bg-transparent text-[12px]"
                      disabled={!activeTab.describe || activeTab.describe.fields.length === 0}
                    />
                    {/* 清空按钮：仅在输入关键词时显示，支持一键清空。 */}
                    {fieldSearchKeyword.trim().length > 0 && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs btn-circle"
                        onClick={() => setFieldSearchKeyword("")}
                        aria-label="清空字段搜索关键词"
                        disabled={!activeTab.describe || activeTab.describe.fields.length === 0}
                      >
                        <X size={12} />
                      </button>
                    )}
                  </label>
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
                  {activeTab.describe && activeTab.describe.fields.length > 0 && filteredDrawerFields.length === 0 && (
                    <div className="px-3 py-2">
                      <span className="text-[12px] text-neutral/70">未匹配到字段，请调整搜索条件。</span>
                    </div>
                  )}

                  {filteredDrawerFields.map((field) => {
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

      {/* MySQL 提交前预览弹窗：让用户在真正提交前确认 create/update/delete 与 NULL 写入摘要。 */}
      {mysqlMutationPreviewState.open && (
        <div className="modal modal-open">
          {/* 弹窗主体：保持中等宽度，兼顾 SQL 预览与移动端可读性。 */}
          <div className="modal-box max-w-4xl p-0">
            {/* 头部：展示本次提交动作概览。 */}
            <div className="border-b border-base-300 px-6 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold">MySQL 提交前预览</h3>
                  <p className="mt-1 text-[12px] text-neutral/70">
                    新增 {mysqlMutationPreviewState.createCount} 行，更新 {mysqlMutationPreviewState.updateCount} 行，删除{" "}
                    {mysqlMutationPreviewState.deleteCount} 行，写入 NULL {mysqlPreviewNullWriteCount} 个字段。
                  </p>
                </div>
                {/* 关闭按钮：执行中禁用，避免用户误以为提交已取消。 */}
                <button
                  className="btn btn-circle btn-ghost btn-sm"
                  onClick={closeMysqlMutationPreview}
                  disabled={mysqlMutationPreviewState.loading}
                  aria-label="关闭提交前预览"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* 主体内容：逐条展示结构化摘要与预览 SQL。 */}
            <div className="max-h-[70vh] overflow-auto px-6 py-4">
              {mysqlMutationPreviewState.error && (
                <div className="mb-4 rounded border border-error/30 bg-error/10 px-3 py-2 text-[12px] text-error">
                  {mysqlMutationPreviewState.error}
                </div>
              )}
              {mysqlMutationPreviewState.items.length === 0 ? (
                <div className="rounded border border-base-300 bg-base-200/40 px-3 py-6 text-center text-[12px] text-neutral/70">
                  当前没有可提交的 MySQL 变更。
                </div>
              ) : (
                <div className="space-y-3">
                  {mysqlMutationPreviewState.items.map((item) => (
                    <section key={`${item.op}:${item.operationIndex}:${item.rowStableId}`} className="rounded border border-base-300 bg-base-100">
                      {/* 预览项头部：展示操作类型与定位信息。 */}
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-base-300 px-3 py-2 text-[12px]">
                        <div className="flex items-center gap-2">
                          <span
                            className={`badge badge-sm ${
                              item.op === "create" ? "badge-success" : item.op === "update" ? "badge-info" : "badge-error"
                            }`}
                          >
                            {item.op === "create" ? "新增" : item.op === "update" ? "更新" : "删除"}
                          </span>
                          <span className="text-neutral/80">
                            {item.rowLocator ? `定位值：${item.rowLocator}` : `行标识：${item.rowStableId}`}
                          </span>
                        </div>
                        <span className="text-neutral/60">序号 #{item.operationIndex + 1}</span>
                      </div>

                      {/* 字段摘要：优先让用户看清本条操作会写哪些值。 */}
                      <div className="px-3 py-2 text-[12px]">
                        {item.fields.length === 0 ? (
                          <div className="text-neutral/70">该操作不包含字段写入。</div>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {item.fields.map((field) => (
                              <span key={`${item.op}:${item.operationIndex}:${field.name}`} className="rounded border border-base-300 bg-base-200/60 px-2 py-1">
                                {field.name} = {field.kind === "null" ? "NULL" : field.kind === "default" ? "DEFAULT" : JSON.stringify(field.value)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* SQL 预览：使用后端真实归一化逻辑生成，避免前端拼串与实际执行不一致。 */}
                      <div className="border-t border-base-300 px-3 py-2">
                        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-base-200/40 p-2 text-[12px]">
                          {item.previewSql || (mysqlMutationPreviewState.loading ? "正在生成预览 SQL..." : "暂无预览 SQL。")}
                        </pre>
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div>

            {/* 底部动作区：确认后才真正执行数据库写入。 */}
            <div className="modal-action mt-0 border-t border-base-300 px-6 py-4">
              <button className="btn btn-ghost" onClick={closeMysqlMutationPreview} disabled={mysqlMutationPreviewState.loading}>
                取消
              </button>
              <button
                className="btn btn-primary"
                onClick={() => void handleConfirmMysqlMutationPreview()}
                disabled={mysqlMutationPreviewState.loading || mysqlMutationPreviewState.items.length === 0}
              >
                {mysqlMutationPreviewState.loading ? "执行中..." : "确认执行"}
              </button>
            </div>
          </div>
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

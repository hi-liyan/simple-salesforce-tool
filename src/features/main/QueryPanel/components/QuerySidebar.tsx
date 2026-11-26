import { useEffect, useMemo, useRef, useState } from "react";
import { Braces, Crosshair, Plus, RefreshCw } from "lucide-react";
import type { ObjectDdl, ObjectDescribe, SalesforceObject, SalesforceSource } from "../../../../types";
import type { QuerySourceObjectSearchResult } from "../logic/sourceObjectSearch.ts";
import { resolveConsoleTargetSource } from "../logic/querySidebarConsoleSource.ts";
import { emitOpenSourceModal } from "../../../source-manager/sourceModalEvents.ts";
import { QuerySidebarActions, type QuerySidebarActionItem } from "./QuerySidebarActions";
import { QuerySidebarSearch } from "./QuerySidebarSearch";
import { QuerySourceTree } from "./QuerySourceTree";

type QuerySidebarProps = {
  // 数据源列表。
  sources: SalesforceSource[];
  // 当前选中的数据源 ID。
  selectedSourceId: string;
  // 页面级加载状态。
  pageLoading: boolean;
  // 当前页面已持有的对象列表加载状态：作为聚焦数据源缓存复用。
  objectsLoading: boolean;
  // 打开认证窗口回调。
  onOpenAuthWindow: () => void;
  // 兼容层：新增数据源后仍可复用外层数据源更新逻辑。
  onChangeSource: (sourceId: string) => void;
  // 兼容层：新增数据源后刷新 source 列表。
  onRefreshSources: (sourceId?: string, options?: { skipObjectFetch?: boolean }) => void;
  // 打开查询控制台回调（支持携带初始 SQL）。
  onOpenConsole?: (source?: SalesforceSource, initialSql?: string) => void;
  // 侧边栏提示消息回调。
  onShowMessage?: (message: string) => void;
  // 当前页面已持有的对象列表：用于给树组件复用已缓存数据。
  objects: SalesforceObject[];
  // 当前激活对象名。
  activeTabObjectName: string;
  // 打开对象回调：支持显式携带发起 source。
  onOpenObject: (item: SalesforceObject, source?: SalesforceSource) => void;
  // 点击不可查询徽标回调。
  onNotQueryableObjectClick?: (item: SalesforceObject) => void;
  // 刷新指定 MySQL 对象的字段元数据与 DDL。
  onRefreshMysqlObjectMetadata: (objectName: string) => Promise<{ describe: ObjectDescribe; ddl: ObjectDdl }>;
  // 对象列表展示模式：`list` 为原列表，`tree` 为树形展开字段。
  objectListMode?: "list" | "tree";
  // 当前激活工作区对应的树定位目标。
  activeWorkspaceTreeTarget?: { kind: "data" | "console"; sourceId: string; objectName?: string } | null;
};

// 左侧栏：数据源选择与对象列表。
export function QuerySidebar({
  sources,
  selectedSourceId,
  pageLoading,
  objectsLoading,
  onOpenAuthWindow,
  onChangeSource,
  onRefreshSources,
  onOpenConsole,
  onShowMessage,
  objects,
  activeTabObjectName,
  onOpenObject,
  onNotQueryableObjectClick,
  onRefreshMysqlObjectMetadata,
  objectListMode = "list",
  activeWorkspaceTreeTarget = null
}: QuerySidebarProps) {
  type QuerySourceTreeActions = {
    refreshFocusedSource: () => Promise<void>;
    getFocusedSourceId: () => string;
    locateNodeByTarget: (target: { sourceId: string; objectName?: string }) => Promise<void>;
    searchFocusedSourceObjects: (keyword: string) => Promise<QuerySourceObjectSearchResult[]>;
    openObjectByTarget: (target: { sourceId: string; objectName: string }) => Promise<void>;
  };

  // 左侧树动作句柄：由树组件回传“刷新聚焦数据源/读取聚焦源”能力。
  const treeActionsRef = useRef<QuerySourceTreeActions | null>(null);
  // 左侧搜索关键字：仅作用于当前聚焦数据源。
  const [searchKeyword, setSearchKeyword] = useState("");
  // 左侧搜索结果：展示当前聚焦数据源下的命中对象/表。
  const [searchResults, setSearchResults] = useState<QuerySourceObjectSearchResult[]>([]);
  // 左侧搜索加载态：首次搜索未缓存 source 时展示。
  const [searchLoading, setSearchLoading] = useState(false);
  // 左树当前聚焦数据源：由树组件实时回传，避免搜索范围依赖滞后 getter。
  const [treeFocusedSourceId, setTreeFocusedSourceId] = useState("");
  // 搜索请求序号：仅允许最后一轮搜索写回结果，避免旧请求覆盖新关键字或新数据源。
  const searchRequestSeqRef = useRef(0);
  // 当前激活工作区是否具备可定位的左树目标。
  const canLocateActiveWorkspaceNode = Boolean(activeWorkspaceTreeTarget?.sourceId);
  // 当前聚焦数据源 ID：左树已就绪时优先使用树内焦点，否则回退到页面选中源。
  const focusedSourceId = treeFocusedSourceId || selectedSourceId;
  // 当前聚焦数据源信息：用于搜索范围提示和结果打开时兜底。
  const focusedSource = useMemo(
    () => sources.find((source) => source.id === focusedSourceId) || null,
    [focusedSourceId, sources]
  );

  // 接收左树动作句柄：使用 ref 承接，避免内部回调身份变化触发整块侧边栏反复重渲染。
  function handleTreeReady(actions: QuerySourceTreeActions) {
    treeActionsRef.current = actions;
  }

  // 打开统一新建数据源弹窗。
  function openCreateSourceModal() {
    emitOpenSourceModal("create");
  }

  // 根据关键字搜索当前聚焦数据源：复用左树缓存并带轻量延迟，避免输入时抖动。
  useEffect(() => {
    const normalizedKeyword = searchKeyword.trim();
    if (!normalizedKeyword) {
      searchRequestSeqRef.current += 1; // 行内注释：清空关键字时主动使历史请求失效，避免延迟结果回写。
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    const normalizedFocusedSourceId = String(focusedSourceId || "").trim();
    if (!normalizedFocusedSourceId) {
      searchRequestSeqRef.current += 1; // 行内注释：当前没有可搜索的数据源时，终止本轮搜索并使旧请求失效。
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    const currentTreeActions = treeActionsRef.current;
    if (!currentTreeActions) {
      setSearchLoading(false); // 行内注释：树动作句柄未就绪时不能视为“正在搜索”，否则 loading 会卡住。
      return;
    }

    const currentSearchRequestSeq = searchRequestSeqRef.current + 1;
    searchRequestSeqRef.current = currentSearchRequestSeq;
    setSearchResults([]);
    setSearchLoading(true);

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const results = await currentTreeActions.searchFocusedSourceObjects(normalizedKeyword);
          if (cancelled || searchRequestSeqRef.current !== currentSearchRequestSeq) return;
          setSearchResults(results);
        } catch (_error) {
          if (cancelled || searchRequestSeqRef.current !== currentSearchRequestSeq) return;
          setSearchResults([]);
        } finally {
          if (cancelled || searchRequestSeqRef.current !== currentSearchRequestSeq) return;
          setSearchLoading(false);
        }
      })();
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [focusedSourceId, searchKeyword]);

  // 点击搜索结果：优先复用左树能力完成定位和打开，保持左右区域状态一致。
  function handleSelectSearchResult(item: QuerySourceObjectSearchResult) {
    void (async () => {
      setSearchKeyword("");
      setSearchResults([]);
      if (treeActionsRef.current) {
        await treeActionsRef.current.openObjectByTarget({
          sourceId: item.sourceId,
          objectName: item.objectName
        });
        return;
      }

      const fallbackSource = sources.find((source) => source.id === item.sourceId) || focusedSource;
      if (!fallbackSource) return;
      onOpenObject({
        name: item.objectName,
        label: item.label,
        comment: item.secondaryText,
        queryable: item.queryable,
        createable: false,
        updateable: false,
        deletable: false
      }, fallbackSource);
    })();
  }

  // 左侧动作区：统一用配置项渲染，便于未来按数据库类型扩展更多动作。
  const actionItems: QuerySidebarActionItem[] = [
    {
      id: "create-source",
      icon: Plus,
      ariaLabel: "新增数据源",
      onClick: openCreateSourceModal
    },
    {
      id: "refresh-source",
      icon: RefreshCw,
      ariaLabel: "刷新数据源",
      onClick: () => {
        const focusedSourceId = treeFocusedSourceId || selectedSourceId;
        if (!focusedSourceId) {
          onRefreshSources();
          return;
        }
        void (async () => {
          if (treeActionsRef.current) {
            await treeActionsRef.current.refreshFocusedSource(); // 行内注释：顶部按钮统一复用树内单次强刷链路，避免按钮层串两段刷新。
            return;
          }
          await onRefreshSources(focusedSourceId);
        })();
      }
    },
    {
      id: "open-console",
      icon: Braces,
      ariaLabel: "查询控制台",
      onClick: () => {
        if (!onOpenConsole) return;
        const targetSource = resolveConsoleTargetSource({
          sources,
          activeWorkspaceSourceId: activeWorkspaceTreeTarget?.sourceId,
          focusedSourceId: treeFocusedSourceId,
          selectedSourceId
        });
        onOpenConsole(targetSource || undefined); // 点击后按当前工作数据源优先创建对应来源的控制台 Tab。
      }
    },
    {
      id: "locate-active-workspace-node",
      icon: Crosshair,
      ariaLabel: "定位当前标签节点",
      disabled: !canLocateActiveWorkspaceNode,
      onClick: () => {
        if (!activeWorkspaceTreeTarget) return;
        void treeActionsRef.current?.locateNodeByTarget({
          sourceId: activeWorkspaceTreeTarget.sourceId,
          objectName: activeWorkspaceTreeTarget.kind === "data" ? activeWorkspaceTreeTarget.objectName : undefined
        }); // 点击后将左树滚动到当前激活工作区对应的 source/object 节点。
      }
    }
  ];

  return (
    <>
      {/* 数据源动作区：统一放置“新增/刷新/查询控制台”按钮。 */}
      <div className="border-b border-base-300 px-3 py-2">
        {/* 动作按钮行。 */}
        <QuerySidebarActions actions={actionItems} disabled={pageLoading} />
      </div>

      {/* 左侧快速搜索：针对当前聚焦数据源检索 Object/表。 */}
      <QuerySidebarSearch
        keyword={searchKeyword}
        loading={searchLoading}
        focusedSourceName={focusedSource?.name || ""}
        focusedSourceType={String(focusedSource?.sourceType || "salesforce")}
        results={searchResults}
        onKeywordChange={setSearchKeyword}
        onSelectResult={handleSelectSearchResult}
      />

      {/* 统一树区域：直接展示全部数据源与类型化子节点。 */}
      <div className="min-h-0 flex-1 pb-2 pt-1">
        <QuerySourceTree
          sources={sources}
          selectedSourceId={selectedSourceId}
          objectsLoading={objectsLoading}
          objects={objects}
          activeTabObjectName={activeTabObjectName}
          onOpenObject={onOpenObject}
          onOpenConsole={onOpenConsole}
          onOpenAuthWindow={onOpenAuthWindow}
          onNotify={(message) => onShowMessage?.(message)}
          onRefreshMysqlObjectMetadata={onRefreshMysqlObjectMetadata}
          onRefreshSourceWorkspace={async (sourceId) => {
            await onRefreshSources(sourceId, { skipObjectFetch: true }); // 行内注释：工作区同步阶段只复用已刷新的对象缓存，不重复拉取列表。
          }}
          onNotQueryableObjectClick={onNotQueryableObjectClick}
          onFocusedSourceChange={setTreeFocusedSourceId}
          onReady={handleTreeReady}
        />
      </div>
    </>
  );
}

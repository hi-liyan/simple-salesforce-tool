import { useEffect, useMemo, useState } from "react";
import { Braces, Crosshair, Plus, RefreshCw } from "lucide-react";
import { api } from "../../../../api";
import { DataSourceType, ObjectDdl, ObjectDescribe, SalesforceObject, SalesforceSource, SourceUpsertPayload } from "../../../../types";
import type { QuerySourceObjectSearchResult } from "../logic/sourceObjectSearch.ts";
import { resolveConsoleTargetSource } from "../logic/querySidebarConsoleSource.ts";
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
  // 打开查询控制台回调。
  onOpenConsole?: (source?: SalesforceSource) => void;
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
  objects,
  activeTabObjectName,
  onOpenObject,
  onNotQueryableObjectClick,
  onRefreshMysqlObjectMetadata,
  objectListMode = "list",
  activeWorkspaceTreeTarget = null
}: QuerySidebarProps) {
  // 数据源类型选择弹窗开关。
  const [showSourceTypeModal, setShowSourceTypeModal] = useState(false);
  // Salesforce 配置弹窗开关。
  const [showSalesforceModal, setShowSalesforceModal] = useState(false);
  // MySQL 配置弹窗开关。
  const [showMySqlModal, setShowMySqlModal] = useState(false);
  // 弹窗提交中的加载状态。
  const [sourceSubmitting, setSourceSubmitting] = useState(false);
  // 弹窗测试连接中的加载状态。
  const [sourceTesting, setSourceTesting] = useState(false);
  // 弹窗提示信息。
  const [sourceModalMessage, setSourceModalMessage] = useState("");
  // Salesforce 手动配置表单。
  const [salesforceForm, setSalesforceForm] = useState({
    name: "",
    instanceUrl: "",
    accessToken: "",
    apiVersion: "v61.0"
  });
  // MySQL 配置表单。
  const [mySqlForm, setMySqlForm] = useState({
    name: "",
    host: "",
    port: 3306,
    database: "",
    username: "",
    password: "",
    primaryKey: ""
  });
  // 左侧树动作句柄：由树组件回传“刷新聚焦数据源/读取聚焦源”能力。
  const [treeActions, setTreeActions] = useState<{
    refreshFocusedSource: () => Promise<void>;
    getFocusedSourceId: () => string;
    locateNodeByTarget: (target: { sourceId: string; objectName?: string }) => Promise<void>;
    searchFocusedSourceObjects: (keyword: string) => Promise<QuerySourceObjectSearchResult[]>;
    openObjectByTarget: (target: { sourceId: string; objectName: string }) => Promise<void>;
  } | null>(null);
  // 左侧搜索关键字：仅作用于当前聚焦数据源。
  const [searchKeyword, setSearchKeyword] = useState("");
  // 左侧搜索结果：展示当前聚焦数据源下的命中对象/表。
  const [searchResults, setSearchResults] = useState<QuerySourceObjectSearchResult[]>([]);
  // 左侧搜索加载态：首次搜索未缓存 source 时展示。
  const [searchLoading, setSearchLoading] = useState(false);
  // 当前激活工作区是否具备可定位的左树目标。
  const canLocateActiveWorkspaceNode = Boolean(activeWorkspaceTreeTarget?.sourceId);
  // 当前聚焦数据源 ID：左树已就绪时优先使用树内焦点，否则回退到页面选中源。
  const focusedSourceId = treeActions?.getFocusedSourceId() || selectedSourceId;
  // 当前聚焦数据源信息：用于搜索范围提示和结果打开时兜底。
  const focusedSource = useMemo(
    () => sources.find((source) => source.id === focusedSourceId) || null,
    [focusedSourceId, sources]
  );

  // 打开“选择数据源类型”弹窗。
  function openSourceTypeModal() {
    setSourceModalMessage("");
    setShowSourceTypeModal(true);
  }

  // 关闭所有新增数据源相关弹窗。
  function closeAllSourceModals() {
    setShowSourceTypeModal(false);
    setShowSalesforceModal(false);
    setShowMySqlModal(false);
    setSourceModalMessage("");
  }

  // 构建 Salesforce 手动创建 payload。
  function buildSalesforcePayload(): SourceUpsertPayload {
    return {
      name: salesforceForm.name.trim(),
      sourceType: "salesforce",
      configJson: {},
      instanceUrl: salesforceForm.instanceUrl.trim(),
      accessToken: salesforceForm.accessToken.trim(),
      apiVersion: salesforceForm.apiVersion.trim()
    };
  }

  // 构建 MySQL 创建 payload。
  function buildMySqlPayload(): SourceUpsertPayload {
    const primaryKey = mySqlForm.primaryKey.trim();
    return {
      name: mySqlForm.name.trim(),
      sourceType: "mysql",
      configJson: {
        host: mySqlForm.host.trim(),
        port: Number(mySqlForm.port) || 3306,
        database: mySqlForm.database.trim(),
        username: mySqlForm.username.trim(),
        password: mySqlForm.password,
        ...(primaryKey ? { primaryKey } : {})
      },
      // 通用字段兼容：当前后端模型仍保留这些字段。
      instanceUrl: `mysql://${mySqlForm.host.trim()}:${Number(mySqlForm.port) || 3306}/${mySqlForm.database.trim()}`,
      accessToken: "",
      apiVersion: "mysql"
    };
  }

  // 测试 Salesforce 手动配置连接。
  async function testSalesforceConnection() {
    setSourceModalMessage("");
    setSourceTesting(true);
    try {
      await api.testSourceConnection(buildSalesforcePayload());
      setSourceModalMessage("Salesforce 连接测试成功。");
    } catch (error) {
      setSourceModalMessage(`Salesforce 连接测试失败：${String(error)}`);
    } finally {
      setSourceTesting(false);
    }
  }

  // 测试 MySQL 连接。
  async function testMySqlConnection() {
    setSourceModalMessage("");
    setSourceTesting(true);
    try {
      await api.testSourceConnection(buildMySqlPayload());
      setSourceModalMessage("MySQL 连接测试成功。");
    } catch (error) {
      setSourceModalMessage(`MySQL 连接测试失败：${String(error)}`);
    } finally {
      setSourceTesting(false);
    }
  }

  // 保存 Salesforce 手动配置数据源。
  async function createSalesforceSource() {
    setSourceModalMessage("");
    setSourceSubmitting(true);
    try {
      const created = await api.createSource(buildSalesforcePayload());
      onChangeSource(created.id);
      onRefreshSources();
      closeAllSourceModals();
    } catch (error) {
      setSourceModalMessage(`创建 Salesforce 数据源失败：${String(error)}`);
    } finally {
      setSourceSubmitting(false);
    }
  }

  // 保存 MySQL 数据源。
  async function createMySqlSource() {
    setSourceModalMessage("");
    setSourceSubmitting(true);
    try {
      const created = await api.createSource(buildMySqlPayload());
      onChangeSource(created.id);
      onRefreshSources();
      closeAllSourceModals();
    } catch (error) {
      setSourceModalMessage(`创建 MySQL 数据源失败：${String(error)}`);
    } finally {
      setSourceSubmitting(false);
    }
  }

  // 选择数据源类型并打开对应配置窗口。
  function openSourceFormModal(sourceType: DataSourceType) {
    setShowSourceTypeModal(false);
    setSourceModalMessage("");
    if (sourceType === "mysql") {
      setShowMySqlModal(true);
      return;
    }
    setShowSalesforceModal(true);
  }

  // 打开 Salesforce OAuth 登录窗口（CLI）。
  function openSalesforceOauthWindow() {
    closeAllSourceModals();
    onOpenAuthWindow();
  }

  // 根据关键字搜索当前聚焦数据源：复用左树缓存并带轻量延迟，避免输入时抖动。
  useEffect(() => {
    const normalizedKeyword = searchKeyword.trim();
    if (!normalizedKeyword) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        setSearchLoading(true);
        const results = await treeActions?.searchFocusedSourceObjects(normalizedKeyword) || [];
        if (cancelled) return;
        setSearchResults(results);
        setSearchLoading(false);
      })();
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchKeyword, treeActions]);

  // 点击搜索结果：优先复用左树能力完成定位和打开，保持左右区域状态一致。
  function handleSelectSearchResult(item: QuerySourceObjectSearchResult) {
    void (async () => {
      setSearchKeyword("");
      setSearchResults([]);
      if (treeActions) {
        await treeActions.openObjectByTarget({
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
      onClick: openSourceTypeModal
    },
    {
      id: "refresh-source",
      icon: RefreshCw,
      ariaLabel: "刷新数据源",
      onClick: () => {
        const focusedSourceId = treeActions?.getFocusedSourceId() || selectedSourceId;
        if (!focusedSourceId) {
          onRefreshSources();
          return;
        }
        void (async () => {
          if (treeActions) {
            await treeActions.refreshFocusedSource(); // 行内注释：顶部按钮统一复用树内单次强刷链路，避免按钮层串两段刷新。
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
          focusedSourceId: treeActions?.getFocusedSourceId() || "",
          selectedSourceId
        });
        onOpenConsole(targetSource || undefined); // 点击后按聚焦源优先创建对应来源的控制台 Tab。
      }
    },
    {
      id: "locate-active-workspace-node",
      icon: Crosshair,
      ariaLabel: "定位当前标签节点",
      disabled: !canLocateActiveWorkspaceNode,
      onClick: () => {
        if (!activeWorkspaceTreeTarget) return;
        void treeActions?.locateNodeByTarget({
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
          onRefreshMysqlObjectMetadata={onRefreshMysqlObjectMetadata}
          onRefreshSourceWorkspace={async (sourceId) => {
            await onRefreshSources(sourceId, { skipObjectFetch: true }); // 行内注释：工作区同步阶段只复用已刷新的对象缓存，不重复拉取列表。
          }}
          onNotQueryableObjectClick={onNotQueryableObjectClick}
          onReady={setTreeActions}
        />
      </div>

      {/* 类型选择弹窗：先选择数据源类型，再进入对应配置窗口。 */}
      {showSourceTypeModal && (
        <div className="modal modal-open">
          <div className="modal-box">
            {/* 弹窗标题。 */}
            <h3 className="text-base font-semibold">新增数据源</h3>
            {/* 弹窗说明。 */}
            <p className="mt-2 text-sm text-neutral/70">请选择数据源类型：</p>
            {/* 类型选择按钮组。 */}
            <div className="mt-4 grid grid-cols-1 gap-2">
              <button className="btn btn-outline justify-start" onClick={() => openSourceFormModal("salesforce")}>
                Salesforce
              </button>
              <button className="btn btn-outline justify-start" onClick={() => openSourceFormModal("mysql")}>
                MySQL
              </button>
            </div>
            {/* 底部取消按钮。 */}
            <div className="modal-action">
              <button className="btn" onClick={closeAllSourceModals}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Salesforce 配置弹窗：支持 OAuth 登录与手动配置两种入口。 */}
      {showSalesforceModal && (
        <div className="modal modal-open">
          <div className="modal-box">
            {/* 弹窗标题。 */}
            <h3 className="text-base font-semibold">新增 Salesforce 数据源</h3>
            {/* OAuth 快速入口按钮。 */}
            <button className="btn btn-sm btn-outline mt-3" onClick={openSalesforceOauthWindow} disabled={sourceSubmitting || sourceTesting}>
              使用 Salesforce CLI OAuth 登录
            </button>
            {/* 分割提示。 */}
            <p className="mt-3 text-xs text-neutral/60">或手动填写连接信息：</p>
            {/* 手动配置表单。 */}
            <div className="mt-2 space-y-2">
              <input
                className="input input-bordered input-sm w-full"
                placeholder="数据源名称"
                value={salesforceForm.name}
                onChange={(event) => setSalesforceForm((state) => ({ ...state, name: event.target.value }))}
              />
              <input
                className="input input-bordered input-sm w-full"
                placeholder="Instance URL"
                value={salesforceForm.instanceUrl}
                onChange={(event) => setSalesforceForm((state) => ({ ...state, instanceUrl: event.target.value }))}
              />
              <input
                className="input input-bordered input-sm w-full"
                placeholder="Access Token"
                value={salesforceForm.accessToken}
                onChange={(event) => setSalesforceForm((state) => ({ ...state, accessToken: event.target.value }))}
              />
              <input
                className="input input-bordered input-sm w-full"
                placeholder="API Version（例如 v61.0）"
                value={salesforceForm.apiVersion}
                onChange={(event) => setSalesforceForm((state) => ({ ...state, apiVersion: event.target.value }))}
              />
            </div>
            {/* 结果提示。 */}
            {sourceModalMessage && <p className="mt-3 text-xs text-neutral/70">{sourceModalMessage}</p>}
            {/* 底部操作按钮。 */}
            <div className="modal-action">
              <button className="btn btn-outline" onClick={closeAllSourceModals} disabled={sourceSubmitting || sourceTesting}>
                取消
              </button>
              <button className="btn btn-secondary" onClick={() => void testSalesforceConnection()} disabled={sourceSubmitting || sourceTesting}>
                {sourceTesting ? "测试中..." : "测试连接"}
              </button>
              <button className="btn btn-primary" onClick={() => void createSalesforceSource()} disabled={sourceSubmitting || sourceTesting}>
                {sourceSubmitting ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MySQL 配置弹窗：填写连接参数并支持测试连接。 */}
      {showMySqlModal && (
        <div className="modal modal-open">
          <div className="modal-box">
            {/* 弹窗标题。 */}
            <h3 className="text-base font-semibold">新增 MySQL 数据源</h3>
            {/* MySQL 配置表单。 */}
            <div className="mt-3 space-y-2">
              <input
                className="input input-bordered input-sm w-full"
                placeholder="数据源名称"
                value={mySqlForm.name}
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                onChange={(event) => setMySqlForm((state) => ({ ...state, name: event.target.value }))}
              />
              <input
                className="input input-bordered input-sm w-full"
                placeholder="Host"
                value={mySqlForm.host}
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                onChange={(event) => setMySqlForm((state) => ({ ...state, host: event.target.value }))}
              />
              <input
                className="input input-bordered input-sm w-full"
                placeholder="Port"
                type="number"
                value={String(mySqlForm.port)}
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                onChange={(event) => setMySqlForm((state) => ({ ...state, port: Number(event.target.value || 3306) }))}
              />
              <input
                className="input input-bordered input-sm w-full"
                placeholder="Database"
                value={mySqlForm.database}
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                onChange={(event) => setMySqlForm((state) => ({ ...state, database: event.target.value }))}
              />
              <input
                className="input input-bordered input-sm w-full"
                placeholder="Username"
                value={mySqlForm.username}
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                onChange={(event) => setMySqlForm((state) => ({ ...state, username: event.target.value }))}
              />
              <input
                className="input input-bordered input-sm w-full"
                placeholder="Password"
                type="password"
                value={mySqlForm.password}
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                onChange={(event) => setMySqlForm((state) => ({ ...state, password: event.target.value }))}
              />
              <input
                className="input input-bordered input-sm w-full"
                placeholder="Primary Key（可选，默认自动检测）"
                value={mySqlForm.primaryKey}
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                onChange={(event) => setMySqlForm((state) => ({ ...state, primaryKey: event.target.value }))}
              />
            </div>
            {/* 结果提示。 */}
            {sourceModalMessage && <p className="mt-3 text-xs text-neutral/70">{sourceModalMessage}</p>}
            {/* 底部操作按钮。 */}
            <div className="modal-action">
              <button className="btn btn-outline" onClick={closeAllSourceModals} disabled={sourceSubmitting || sourceTesting}>
                取消
              </button>
              <button className="btn btn-secondary" onClick={() => void testMySqlConnection()} disabled={sourceSubmitting || sourceTesting}>
                {sourceTesting ? "测试中..." : "测试连接"}
              </button>
              <button className="btn btn-primary" onClick={() => void createMySqlSource()} disabled={sourceSubmitting || sourceTesting}>
                {sourceSubmitting ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

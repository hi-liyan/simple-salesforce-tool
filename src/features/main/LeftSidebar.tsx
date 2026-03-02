import { useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { ObjectList } from "../../components/ObjectList";
import { DataSourceSelector } from "../../components/DataSourceSelector";
import { api } from "../../api";
import { DataSourceType, SalesforceObject, SalesforceSource, SourceUpsertPayload } from "../../types";

type LeftSidebarProps = {
  // 数据源列表。
  sources: SalesforceSource[];
  // 当前选中的数据源 ID。
  selectedSourceId: string;
  // 页面级加载状态。
  pageLoading: boolean;
  // 对象列表加载状态。
  objectsLoading: boolean;
  // 打开认证窗口回调。
  onOpenAuthWindow: () => void;
  // 切换数据源回调。
  onChangeSource: (sourceId: string) => void;
  // 刷新数据源回调。
  onRefreshSources: () => void;
  // 当前对象列表。
  objects: SalesforceObject[];
  // 当前激活对象名。
  activeTabObjectName: string;
  // 打开对象回调。
  onOpenObject: (item: SalesforceObject) => void;
  // 点击不可查询徽标回调。
  onNotQueryableObjectClick?: (item: SalesforceObject) => void;
  // 对象列表展示模式：`list` 为原列表，`tree` 为树形展开字段。
  objectListMode?: "list" | "tree";
};

// 左侧栏：数据源选择与对象列表。
export function LeftSidebar({
  sources,
  selectedSourceId,
  pageLoading,
  objectsLoading,
  onOpenAuthWindow,
  onChangeSource,
  onRefreshSources,
  objects,
  activeTabObjectName,
  onOpenObject,
  onNotQueryableObjectClick,
  objectListMode = "list"
}: LeftSidebarProps) {
  // 当前选中数据源类型：用于对象右键菜单按类型展示能力项。
  const selectedSourceType =
    sources.find((source) => source.id === selectedSourceId)?.sourceType || "salesforce";
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

  return (
    <>
      {/* 数据源标题与新增按钮区域。 */}
      <div className="border-b border-base-300 px-3 py-2">
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-neutral/70">DATA SOURCE</span>
          <button className="btn btn-ghost btn-square btn-sm" aria-label="新增数据源" onClick={openSourceTypeModal} disabled={pageLoading}>
            <Plus size={14} />
          </button>
        </div>

        {/* 数据源下拉与刷新按钮。 */}
        <div className="mt-[6px] flex flex-row gap-2">
          {/* 自定义数据源选择器：支持前置类型徽标与更灵活展示。 */}
          <div className="min-w-0 flex-1">
            <DataSourceSelector sources={sources} selectedSourceId={selectedSourceId} onChange={onChangeSource} disabled={pageLoading} />
          </div>
          <button className="btn btn-primary btn-sm shrink-0" onClick={onRefreshSources} disabled={pageLoading}>
            <RefreshCw size={14} />
            刷新
          </button>
        </div>
      </div>

      {/* Objects 区块标题。 */}
      <div className="border-b border-base-300 px-3 py-2">
        <span className="text-[12px] text-neutral/70">OBJECTS</span>
      </div>

      {/* 对象列表内容区。 */}
      <div className="min-h-0 flex-1 px-3 pb-3 pt-2">
        {objectsLoading ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-neutral/70">
            <span className="loading loading-spinner" style={{ width: 18, height: 18 }} />
            <span className="text-[12px]">拉取 Object 列表中...</span>
          </div>
        ) : (
          <ObjectList
            objects={objects}
            sourceId={selectedSourceId}
            sourceType={selectedSourceType}
            activeObjectName={activeTabObjectName}
            onOpenObject={onOpenObject}
            onNotQueryableClick={onNotQueryableObjectClick}
            treeMode={objectListMode === "tree"}
          />
        )}
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
                onChange={(event) => setMySqlForm((state) => ({ ...state, name: event.target.value }))}
              />
              <input
                className="input input-bordered input-sm w-full"
                placeholder="Host"
                value={mySqlForm.host}
                onChange={(event) => setMySqlForm((state) => ({ ...state, host: event.target.value }))}
              />
              <input
                className="input input-bordered input-sm w-full"
                placeholder="Port"
                type="number"
                value={String(mySqlForm.port)}
                onChange={(event) => setMySqlForm((state) => ({ ...state, port: Number(event.target.value || 3306) }))}
              />
              <input
                className="input input-bordered input-sm w-full"
                placeholder="Database"
                value={mySqlForm.database}
                onChange={(event) => setMySqlForm((state) => ({ ...state, database: event.target.value }))}
              />
              <input
                className="input input-bordered input-sm w-full"
                placeholder="Username"
                value={mySqlForm.username}
                onChange={(event) => setMySqlForm((state) => ({ ...state, username: event.target.value }))}
              />
              <input
                className="input input-bordered input-sm w-full"
                placeholder="Password"
                type="password"
                value={mySqlForm.password}
                onChange={(event) => setMySqlForm((state) => ({ ...state, password: event.target.value }))}
              />
              <input
                className="input input-bordered input-sm w-full"
                placeholder="Primary Key（可选，默认自动检测）"
                value={mySqlForm.primaryKey}
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

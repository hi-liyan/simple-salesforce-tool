import Editor from "@monaco-editor/react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import JsonView from "react18-json-view";
import "react18-json-view/src/style.css";
import { Braces, ChevronLeft, Clipboard, Maximize2, Minimize2, RotateCcw, Sparkles } from "lucide-react";
import { MonacoEditorLoadingFallback } from "../../../../components/MonacoEditorLoadingFallback";
import { NoticeAlert, NoticeTone } from "../../../../components/NoticeAlert";
import { ReusableTabs } from "../../../../components/tabs/ReusableTabs";
import { sortTabsByOrder } from "../../../../components/tabs/tabOrder";
import { JsonFormatterTab, useJsonFormatterStore } from "../../../../store/useJsonFormatterStore";

type JsonFormatterToolProps = {
  // 返回工具入口页：用于离开 JSON 工具详情页。
  onBack: () => void;
};

// JSON 对象类型：用于递归描述 key-value 结构。
interface JsonObject {
  [key: string]: JsonValue;
}

// JSON 节点类型：覆盖对象、数组与基础字面量。
type JsonValue = JsonObject | JsonValue[] | string | number | boolean | null;

// 示例 JSON：用于快速体验格式化与折叠能力。
const DEFAULT_SAMPLE_JSON = `{"name":"simple-salesforce-tool","features":["json-format","tree-fold","copy"],"meta":{"author":"Codex","enabled":true,"version":1},"items":[{"id":1,"label":"Account","fields":["Id","Name"]},{"id":2,"label":"Contact","fields":["Id","Email"]}]}`;

// 复制文本到剪贴板：优先现代 API，失败时回退到隐藏 textarea。
async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text); // 优先使用现代剪贴板 API。
    return;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand("copy"); // 兼容剪贴板权限受限场景。
    document.body.removeChild(textarea);
  }
}

// JSON 工具页签内容：负责单个页签的输入、格式化与树形结果。
function JsonFormatterTabPane({
  tab,
  active,
  onPatchTab,
  onShowNotice
}: {
  // 当前页签状态。
  tab: JsonFormatterTab;
  // 当前页签是否激活。
  active: boolean;
  // 更新当前页签。
  onPatchTab: (tabId: string, updater: (current: JsonFormatterTab) => JsonFormatterTab) => void;
  // 展示顶部提示条。
  onShowNotice: (notice: { tone: NoticeTone; message: string } | null) => void;
}) {
  // 延迟输入文本：降低大 JSON 编辑时的同步解析抖动。
  const deferredInputText = useDeferredValue(tab.inputText);

  // 解析状态：统一管理格式化输出与错误信息。
  const parseState = useMemo(() => {
    const trimmedText = deferredInputText.trim();
    if (!trimmedText) {
      return {
        parsedValue: null as JsonValue | null,
        formattedText: "",
        errorMessage: ""
      };
    }

    try {
      const parsedValue = JSON.parse(trimmedText) as JsonValue;
      return {
        parsedValue,
        formattedText: JSON.stringify(parsedValue, null, 2),
        errorMessage: ""
      };
    } catch (error) {
      return {
        parsedValue: null as JsonValue | null,
        formattedText: "",
        errorMessage: `JSON 解析失败：${error instanceof Error ? error.message : String(error)}`
      };
    }
  }, [deferredInputText]);

  // 右侧视图重挂载键：切换“全部展开 / 全部收起”后重新应用库的 collapsed 配置。
  const jsonViewKey = `${tab.id}-${tab.viewerCollapsed ? "collapsed" : "expanded"}-${tab.viewerRevision}`;

  // 格式化并回写左侧输入区。
  function formatInputText() {
    if (!parseState.formattedText) {
      onShowNotice({
        tone: "warning",
        message: parseState.errorMessage || "请先输入有效的 JSON。"
      });
      return;
    }

    onPatchTab(tab.id, (current) => ({
      ...current,
      inputText: parseState.formattedText
    }));
    onShowNotice({
      tone: "success",
      message: `“${tab.name}” 已格式化。`
    });
  }

  // 载入示例 JSON。
  function loadSampleJson() {
    onPatchTab(tab.id, (current) => ({
      ...current,
      inputText: DEFAULT_SAMPLE_JSON,
      viewerCollapsed: false,
      viewerRevision: current.viewerRevision + 1
    }));
    onShowNotice(null);
  }

  // 清空当前页签。
  function clearJson() {
    onPatchTab(tab.id, (current) => ({
      ...current,
      inputText: "",
      viewerCollapsed: false,
      viewerRevision: current.viewerRevision + 1
    }));
    onShowNotice(null);
  }

  // 复制格式化后的 JSON 文本。
  async function copyFormattedJson() {
    if (!parseState.formattedText) {
      onShowNotice({
        tone: "warning",
        message: parseState.errorMessage || "当前没有可复制的格式化结果。"
      });
      return;
    }

    try {
      await copyText(parseState.formattedText);
      onShowNotice({
        tone: "success",
        message: `“${tab.name}” 的格式化结果已复制到剪贴板。`
      });
    } catch (error) {
      onShowNotice({
        tone: "error",
        message: `复制失败：${error instanceof Error ? error.message : String(error)}`
      });
    }
  }

  // 触发全部展开：通过切换默认折叠状态并重挂载 viewer 实现。
  function expandAllNodes() {
    onPatchTab(tab.id, (current) => ({
      ...current,
      viewerCollapsed: false,
      viewerRevision: current.viewerRevision + 1
    }));
  }

  // 触发全部收起：通过切换默认折叠状态并重挂载 viewer 实现。
  function collapseAllNodes() {
    onPatchTab(tab.id, (current) => ({
      ...current,
      viewerCollapsed: true,
      viewerRevision: current.viewerRevision + 1
    }));
  }

  // 切换全部节点展开状态：将“全部展开 / 全部收起”合并为单一入口。
  function toggleAllNodes() {
    if (tab.viewerCollapsed) {
      expandAllNodes(); // 当前为折叠态时，一键切换为全部展开。
      return;
    }
    collapseAllNodes(); // 当前为展开态时，一键切换为全部收起。
  }

  return (
    // 单个 JSON 工具页签：激活时展示，不激活时仅隐藏保留组件状态。
    <div className={active ? "absolute inset-0 z-10 flex h-full w-full flex-col" : "absolute inset-0 z-0 hidden h-full w-full"} aria-hidden={!active}>
      {/* 双栏工作区：左侧输入，右侧格式化结果。 */}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(360px,1fr)_minmax(420px,1fr)] gap-4 overflow-hidden p-4">
        {/* 左侧输入卡片。 */}
        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-base-300 bg-base-100 shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-base-300 px-4 py-3">
            <div>
              {/* 卡片标题。 */}
              <h3 className="text-[14px] font-semibold text-neutral">原始 JSON</h3>
              <p className="mt-1 text-[12px] text-neutral/60">支持粘贴单行或多行 JSON 文本，解析结果会同步显示在右侧。</p>
            </div>
            {/* 清空按钮。 */}
            <button type="button" className="btn btn-ghost btn-sm h-8 min-h-8 px-3 text-[12px]" onClick={clearJson}>
              清空
            </button>
          </div>
          {/* Monaco 输入编辑器。 */}
          <div className="min-h-0 flex-1">
            <Editor
              // 编辑器高度：撑满左侧卡片主体。
              height="100%"
              defaultLanguage="json"
              value={tab.inputText}
              loading={<MonacoEditorLoadingFallback height="100%" />}
              onChange={(value) => {
                onPatchTab(tab.id, (current) => ({
                  ...current,
                  inputText: value ?? ""
                }));
              }}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                lineNumbersMinChars: 3,
                wordWrap: "on",
                automaticLayout: true,
                scrollBeyondLastLine: false,
                padding: { top: 12, bottom: 12 }
              }}
            />
          </div>
        </section>
        {/* 右侧结果卡片。 */}
        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-base-300 bg-base-100 shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-base-300 px-4 py-3">
            <div>
              {/* 卡片标题。 */}
              <h3 className="text-[14px] font-semibold text-neutral">格式化结果</h3>
              <p className="mt-1 text-[12px] text-neutral/60">支持节点手动折叠，同时也支持全部展开和全部收起。</p>
            </div>
            {/* 结果区功能按钮：将展开切换与常用操作统一收口到标题栏。 */}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                className="btn btn-ghost btn-sm h-8 min-h-8 gap-2 px-3 text-[12px]"
                onClick={toggleAllNodes}
                disabled={!parseState.parsedValue}
              >
                {tab.viewerCollapsed ? <Maximize2 size={12} /> : <Minimize2 size={12} />}
                {tab.viewerCollapsed ? "全部展开" : "全部收起"}
              </button>
              <button type="button" className="btn btn-ghost btn-sm h-8 min-h-8 gap-2 px-3 text-[12px]" onClick={loadSampleJson}>
                <Sparkles size={14} />
                示例
              </button>
              <button type="button" className="btn btn-ghost btn-sm h-8 min-h-8 gap-2 px-3 text-[12px]" onClick={formatInputText}>
                <RotateCcw size={14} />
                格式化输入
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm h-8 min-h-8 gap-2 px-3 text-[12px]"
                onClick={() => void copyFormattedJson()}
                disabled={!parseState.formattedText}
              >
                <Clipboard size={14} />
                复制结果
              </button>
            </div>
          </div>
          {/* 结果展示区：根据当前输入状态显示空态、错误或 JSON tree。 */}
          <div className="min-h-0 flex-1 overflow-auto bg-[linear-gradient(180deg,#fbfdff_0%,#f3f8ff_100%)] p-4">
            {!tab.inputText.trim() ? (
              // 空态内容：引导用户先输入 JSON。
              <div className="flex h-full min-h-[240px] items-center justify-center px-6 text-center">
                <div className="max-w-sm">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <Braces size={20} />
                  </div>
                  <p className="mt-4 text-[14px] font-medium text-neutral">等待输入 JSON</p>
                  <p className="mt-2 text-[12px] leading-6 text-neutral/60">在左侧粘贴或输入 JSON 后，这里会自动显示格式化后的树形结构。</p>
                </div>
              </div>
            ) : parseState.errorMessage ? (
              // 解析失败态：输出错误信息方便修正。
              <NoticeAlert tone="error" message={parseState.errorMessage} />
            ) : parseState.parsedValue ? (
              // JSON 树结果：交由成熟第三方库负责节点交互与折叠。
              <div className="json-formatter-tree rounded-2xl border border-base-300 bg-base-100/85 p-4 shadow-inner">
                <JsonView
                  key={jsonViewKey}
                  src={parseState.parsedValue}
                  theme="github"
                  collapsed={tab.viewerCollapsed}
                  displaySize="collapsed"
                  collapseStringsAfterLength={120}
                  enableClipboard={false}
                  matchesURL
                  style={{
                    backgroundColor: "transparent",
                    fontSize: 12,
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace"
                  }}
                />
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}

// JSON 格式化工具页：支持多 Tab、持久化与进入页面后懒恢复。
export function JsonFormatterTool({ onBack }: JsonFormatterToolProps) {
  // Store 状态：维护全部页签与当前激活项。
  const tabs = useJsonFormatterStore((state) => state.tabs);
  const activeTabId = useJsonFormatterStore((state) => state.activeTabId);
  const setActiveTabId = useJsonFormatterStore((state) => state.setActiveTabId);
  const createTab = useJsonFormatterStore((state) => state.createTab);
  const patchTab = useJsonFormatterStore((state) => state.patchTab);
  const reorderTabs = useJsonFormatterStore((state) => state.reorderTabs);
  const closeTab = useJsonFormatterStore((state) => state.closeTab);
  const tabOrder = useJsonFormatterStore((state) => state.tabOrder);

  // 工具级提示：承载复制、格式化失败等反馈。
  const [notice, setNotice] = useState<{ tone: NoticeTone; message: string } | null>(null);
  // 懒恢复完成标记：进入 JSON 工具页后才触发持久化恢复。
  const [hydrated, setHydrated] = useState(useJsonFormatterStore.persist.hasHydrated());
  // 已常驻挂载的页签集合：切换时不销毁内部编辑器与树组件状态。
  const [mountedTabIds, setMountedTabIds] = useState<string[]>([]);
  // 只执行一次的恢复标记：避免 StrictMode 下重复触发恢复流程。
  const hydrationStartedRef = useRef(false);

  // 激活页签实体：为空时回退到第一个页签。
  const orderedTabs = useMemo(() => sortTabsByOrder(tabOrder, tabs), [tabOrder, tabs]);
  const activeTab = useMemo(() => orderedTabs.find((tab) => tab.id === activeTabId) || orderedTabs[0] || null, [orderedTabs, activeTabId]);

  // 工具级通知自动关闭：对齐 QueryPanel 的轻提示体验，避免提示常驻遮挡内容。
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => {
      setNotice(null); // 定时关闭提示，保持与 QueryPanel 一致的轻量反馈。
    }, 2600);
    return () => {
      window.clearTimeout(timer);
    };
  }, [notice]);

  // 进入工具页后手动恢复持久化状态；若没有历史数据，则补一个默认页签。
  useEffect(() => {
    if (hydrationStartedRef.current) return;
    hydrationStartedRef.current = true;

    void Promise.resolve(useJsonFormatterStore.persist.rehydrate()).then(() => {
      const storeState = useJsonFormatterStore.getState();
      if (storeState.tabs.length === 0) {
        storeState.createTab(); // 首次使用时自动创建默认页签。
      }
      setHydrated(true);
    });
  }, []);

  // 激活页签变化时：确保对应 pane 常驻挂载。
  useEffect(() => {
    if (!activeTab?.id) return;
    setMountedTabIds((current) => {
      if (current.includes(activeTab.id)) return current;
      return [...current, activeTab.id];
    });
  }, [activeTab]);

  // 页签集合变化时：移除已关闭页签的挂载记录。
  useEffect(() => {
    const aliveTabIdSet = new Set(tabs.map((tab) => tab.id));
    setMountedTabIds((current) => current.filter((tabId) => aliveTabIdSet.has(tabId)));
  }, [tabs]);

  // 当前挂载中的页签：保持与 tabs 顺序一致。
  const mountedTabs = useMemo(() => orderedTabs.filter((tab) => mountedTabIds.includes(tab.id)), [orderedTabs, mountedTabIds]);

  // 新建 JSON 页签。
  function handleCreateTab() {
    createTab();
    setNotice(null);
  }

  // 关闭单个 JSON 页签。
  function handleCloseTab(tabId: string) {
    closeTab(tabId);
    setNotice(null);
  }

  if (!hydrated) {
    return (
      // 懒恢复加载态：仅在进入 JSON 工具页后展示。
      <div className="flex h-full w-full items-center justify-center bg-base-200/40">
        <div className="rounded-2xl border border-base-300 bg-base-100 px-5 py-4 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="loading loading-spinner text-primary" style={{ width: 22, height: 22 }} />
            <div>
              {/* 加载标题。 */}
              <p className="text-[13px] font-medium text-neutral">正在恢复 JSON 工具页签</p>
              <p className="mt-1 text-[12px] text-neutral/65">这里只会在进入格式化工具后按需恢复，不影响应用启动速度。</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    // JSON 工具页：顶部返回 + Tab 栏 + 多页签工作区。
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-base-200/45">
      {/* 工具级全局提示：固定在右上角，展示方式与 QueryPanel workspaceNotice 对齐。 */}
      {notice ? (
        <NoticeAlert
          tone={notice.tone}
          message={notice.message}
          onClose={() => setNotice(null)}
          className="fixed right-4 top-4 z-[60] max-w-[380px] shadow-lg"
        />
      ) : null}
      {/* 顶部返回区：保留回到工具入口页的路径。 */}
      <div className="flex items-center justify-between gap-4 border-b border-base-300 bg-base-100 px-5 py-3">
        <button type="button" className="btn btn-ghost btn-sm h-8 min-h-8 gap-1 px-2 text-[12px]" onClick={onBack}>
          {/* 返回图标：与文字一起强化回退语义。 */}
          <ChevronLeft size={14} />
          返回工具面板
        </button>
        {/* 工具说明：强调多页签与懒恢复行为。 */}
        <p className="text-[12px] text-neutral/60">支持多 Tab 持续工作，关闭程序后会在下次进入该工具时恢复。</p>
      </div>
      <ReusableTabs
        tabs={orderedTabs.map((tab) => ({
          id: tab.id,
          title: tab.name,
          closable: true,
          renameable: true
        }))}
        activeTabId={activeTab?.id || ""}
        createButtonTitle="新建 JSON 格式化页签"
        onActivateTab={setActiveTabId}
        onCreateTab={handleCreateTab}
        onReorderTabs={reorderTabs}
        onRenameTab={(tabId, title) => {
          patchTab(tabId, (current) => ({
            ...current,
            name: title
          }));
        }}
        onCloseTab={handleCloseTab}
        onCloseTabs={(tabIds) => {
          useJsonFormatterStore.getState().closeTabsByIds(tabIds);
          setNotice(null);
        }}
      />
      {/* 工作区：所有已访问页签常驻挂载，切换时仅隐藏。 */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {mountedTabs.map((tab) => (
          <JsonFormatterTabPane key={tab.id} tab={tab} active={tab.id === activeTab?.id} onPatchTab={patchTab} onShowNotice={setNotice} />
        ))}
      </div>
    </div>
  );
}

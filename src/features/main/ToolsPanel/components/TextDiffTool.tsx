import { DiffEditor } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, ChevronLeft, Clipboard, FileDiff, RotateCcw, Sparkles } from "lucide-react";
import { MonacoEditorLoadingFallback } from "../../../../components/MonacoEditorLoadingFallback";
import { NoticeAlert, NoticeTone } from "../../../../components/NoticeAlert";
import { ReusableTabs } from "../../../../components/tabs/ReusableTabs";
import { sortTabsByOrder } from "../../../../components/tabs/tabOrder";
import { isTextDiffInputEmpty } from "../logic/textDiff";
import { TextDiffTab, useTextDiffStore } from "../../../../store/useTextDiffStore";

type TextDiffToolProps = {
  // 返回工具入口页：用于离开文本对比工具详情页。
  onBack: () => void;
};

// 对比编辑器实例类型：方便挂载后读取左右编辑器模型。
type DiffEditorInstance = Monaco.editor.IStandaloneDiffEditor;

// 示例左侧文本：用于快速体验文本差异效果。
const DEFAULT_LEFT_SAMPLE_TEXT = `{
  "name": "simple-salesforce-tool",
  "env": "staging",
  "features": ["query", "terminal", "json"],
  "timeout": 3000
}`;

// 示例右侧文本：预置几处差异，方便验证对比高亮。
const DEFAULT_RIGHT_SAMPLE_TEXT = `{
  "name": "simple-salesforce-tool",
  "env": "production",
  "features": ["query", "terminal", "json", "text-diff"],
  "timeout": 5000
}`;

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

// 单个文本对比页签内容：负责左右文本编辑、差异展示与快捷操作。
function TextDiffTabPane({
  tab,
  active,
  onPatchTab,
  onShowNotice
}: {
  // 当前页签状态。
  tab: TextDiffTab;
  // 当前页签是否激活。
  active: boolean;
  // 更新当前页签。
  onPatchTab: (tabId: string, updater: (current: TextDiffTab) => TextDiffTab) => void;
  // 展示顶部提示条。
  onShowNotice: (notice: { tone: NoticeTone; message: string } | null) => void;
}) {
  // 编辑器实例引用：用于挂载后订阅左右模型变更。
  const diffEditorRef = useRef<DiffEditorInstance | null>(null);
  // 编辑器初始值快照：避免每次输入都把 store 值重新灌回 DiffEditor 导致光标跳动。
  const [editorSeed, setEditorSeed] = useState(() => ({
    leftText: tab.leftText,
    rightText: tab.rightText
  }));
  // 左侧模型监听释放器：切换模型或卸载时清理。
  const originalListenerRef = useRef<Monaco.IDisposable | null>(null);
  // 右侧模型监听释放器：切换模型或卸载时清理。
  const modifiedListenerRef = useRef<Monaco.IDisposable | null>(null);
  // 外部同步标记：防止程序性写入模型时再次触发 store 回写。
  const syncingModelRef = useRef(false);
  // 左侧最新文本缓存：避免监听闭包拿到过期值。
  const leftTextRef = useRef(tab.leftText);
  // 右侧最新文本缓存：避免监听闭包拿到过期值。
  const rightTextRef = useRef(tab.rightText);
  // 行数统计：用延迟值减少频繁输入时的同步计算抖动。
  const deferredLeftText = useDeferredValue(tab.leftText);
  // 行数统计：用延迟值减少频繁输入时的同步计算抖动。
  const deferredRightText = useDeferredValue(tab.rightText);

  // 同步最新左侧文本到 ref，供编辑器事件读取。
  useEffect(() => {
    leftTextRef.current = tab.leftText;
  }, [tab.leftText]);

  // 同步最新右侧文本到 ref，供编辑器事件读取。
  useEffect(() => {
    rightTextRef.current = tab.rightText;
  }, [tab.rightText]);

  // 组件卸载时清理编辑器事件订阅，避免残留监听。
  useEffect(() => {
    return () => {
      originalListenerRef.current?.dispose();
      modifiedListenerRef.current?.dispose();
    };
  }, []);

  // 统计摘要：用于在标题栏快速展示左右文本规模与是否一致。
  const summary = useMemo(() => {
    const leftLineCount = deferredLeftText ? deferredLeftText.split(/\r?\n/).length : 0;
    const rightLineCount = deferredRightText ? deferredRightText.split(/\r?\n/).length : 0;
    const empty = isTextDiffInputEmpty(deferredLeftText, deferredRightText);
    const identical = !empty && deferredLeftText === deferredRightText;
    return {
      leftLineCount,
      rightLineCount,
      empty,
      identical
    };
  }, [deferredLeftText, deferredRightText]);

  // 当前是否为空白对比：用于展示输入引导，但不再隐藏编辑器。
  const emptyInput = useMemo(() => isTextDiffInputEmpty(tab.leftText, tab.rightText), [tab.leftText, tab.rightText]);

  // 将左右文本同步到 Monaco 模型：仅在外部操作改变内容时触发，避免击键时重置光标。
  function syncEditorModels(nextLeftText: string, nextRightText: string) {
    const editor = diffEditorRef.current;
    if (!editor) return;

    const originalEditor = editor.getOriginalEditor();
    const modifiedEditor = editor.getModifiedEditor();
    const originalModel = originalEditor.getModel();
    const modifiedModel = modifiedEditor.getModel();
    if (!originalModel || !modifiedModel) return;

    syncingModelRef.current = true;
    try {
      if (originalModel.getValue() !== nextLeftText) {
        originalModel.setValue(nextLeftText);
      }
      if (modifiedModel.getValue() !== nextRightText) {
        modifiedEditor.executeEdits("text-diff-sync", [
          {
            range: modifiedModel.getFullModelRange(),
            text: nextRightText,
            forceMoveMarkers: true
          }
        ]);
        modifiedEditor.pushUndoStop();
      }
    } finally {
      syncingModelRef.current = false;
    }
  }

  // 统一应用文本变化：同步更新 ref、store 与必要的编辑器模型。
  function applyTabTexts(nextLeftText: string, nextRightText: string) {
    leftTextRef.current = nextLeftText;
    rightTextRef.current = nextRightText;
    setEditorSeed({
      leftText: nextLeftText,
      rightText: nextRightText
    });
    onPatchTab(tab.id, (current) => ({
      ...current,
      leftText: nextLeftText,
      rightText: nextRightText
    }));
    syncEditorModels(nextLeftText, nextRightText);
  }

  // 若文本从外部动作更新，则补一次模型同步；来自编辑器本身的更新直接跳过。
  useEffect(() => {
    if (tab.leftText === leftTextRef.current && tab.rightText === rightTextRef.current) return;
    leftTextRef.current = tab.leftText;
    rightTextRef.current = tab.rightText;
    setEditorSeed({
      leftText: tab.leftText,
      rightText: tab.rightText
    });
    syncEditorModels(tab.leftText, tab.rightText);
  }, [tab.leftText, tab.rightText]);

  // 绑定左右模型的内容变化事件：把 Monaco diff editor 变更同步回 store。
  function bindModelListeners(editor: DiffEditorInstance) {
    originalListenerRef.current?.dispose();
    modifiedListenerRef.current?.dispose();

    const originalModel = editor.getOriginalEditor().getModel();
    const modifiedModel = editor.getModifiedEditor().getModel();

    if (originalModel) {
      originalListenerRef.current = originalModel.onDidChangeContent(() => {
        if (syncingModelRef.current) return;
        const nextValue = originalModel.getValue();
        if (nextValue === leftTextRef.current) return;
        leftTextRef.current = nextValue; // 先更新本地 ref，避免 store 回流再次触发外部同步。
        onPatchTab(tab.id, (current) => ({
          ...current,
          leftText: nextValue
        }));
      });
    }

    if (modifiedModel) {
      modifiedListenerRef.current = modifiedModel.onDidChangeContent(() => {
        if (syncingModelRef.current) return;
        const nextValue = modifiedModel.getValue();
        if (nextValue === rightTextRef.current) return;
        rightTextRef.current = nextValue; // 先更新本地 ref，避免 store 回流再次触发外部同步。
        onPatchTab(tab.id, (current) => ({
          ...current,
          rightText: nextValue
        }));
      });
    }
  }

  // DiffEditor 挂载完成：记录实例并注册左右模型监听。
  function handleEditorMount(editor: DiffEditorInstance) {
    diffEditorRef.current = editor;
    bindModelListeners(editor);
  }

  // 清空当前页签左右文本。
  function clearTexts() {
    applyTabTexts("", "");
    onShowNotice(null);
  }

  // 载入示例文本：便于快速体验差异高亮与滚动同步。
  function loadSampleTexts() {
    applyTabTexts(DEFAULT_LEFT_SAMPLE_TEXT, DEFAULT_RIGHT_SAMPLE_TEXT);
    onShowNotice(null);
  }

  // 交换当前页签左右文本。
  function swapTexts() {
    applyTabTexts(tab.rightText, tab.leftText);
    onShowNotice({
      tone: "success",
      message: `“${tab.name}” 已交换左右文本。`
    });
  }

  // 复制指定侧文本。
  async function handleCopyText(side: "left" | "right") {
    const targetText = side === "left" ? tab.leftText : tab.rightText;
    if (!targetText.trim()) {
      onShowNotice({
        tone: "warning",
        message: side === "left" ? "左侧当前没有可复制的文本。" : "右侧当前没有可复制的文本。"
      });
      return;
    }

    try {
      await copyText(targetText);
      onShowNotice({
        tone: "success",
        message: side === "left" ? `“${tab.name}” 左侧文本已复制。` : `“${tab.name}” 右侧文本已复制。`
      });
    } catch (error) {
      onShowNotice({
        tone: "error",
        message: `复制失败：${error instanceof Error ? error.message : String(error)}`
      });
    }
  }

  return (
    // 单个文本对比页签：激活时展示，不激活时仅隐藏保留编辑器状态。
    <div className={active ? "absolute inset-0 z-10 flex h-full w-full flex-col" : "absolute inset-0 z-0 hidden h-full w-full"} aria-hidden={!active}>
      {/* 工作区外层：延续工具页卡片化布局。 */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4">
        {/* 摘要卡片：快速显示当前对比规模与一致性。 */}
        <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-base-300 bg-base-100 px-4 py-3 shadow-sm">
            {/* 摘要标题：标记左侧输入规模。 */}
            <p className="text-[12px] text-neutral/60">左侧行数</p>
            {/* 摘要数值。 */}
            <p className="mt-2 text-[18px] font-semibold text-neutral">{summary.leftLineCount}</p>
          </div>
          <div className="rounded-2xl border border-base-300 bg-base-100 px-4 py-3 shadow-sm">
            {/* 摘要标题：标记右侧输入规模。 */}
            <p className="text-[12px] text-neutral/60">右侧行数</p>
            {/* 摘要数值。 */}
            <p className="mt-2 text-[18px] font-semibold text-neutral">{summary.rightLineCount}</p>
          </div>
          <div className="rounded-2xl border border-base-300 bg-base-100 px-4 py-3 shadow-sm">
            {/* 摘要标题：描述当前对比结果。 */}
            <p className="text-[12px] text-neutral/60">当前状态</p>
            {/* 摘要状态：提示是否已完全一致。 */}
            <p
              className={`mt-2 text-[16px] font-semibold ${
                summary.empty ? "text-neutral/55" : summary.identical ? "text-success" : "text-primary"
              }`}
            >
              {summary.empty ? "等待输入" : summary.identical ? "左右内容一致" : "存在差异"}
            </p>
          </div>
        </section>
        {/* 主体卡片：顶部工具栏 + 下方双栏 diff 编辑器。 */}
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-base-300 bg-base-100 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-base-300 px-4 py-3">
            <div>
              {/* 卡片标题。 */}
              <h3 className="text-[14px] font-semibold text-neutral">双栏文本对比</h3>
            </div>
            {/* 功能按钮区：统一收纳常用操作。 */}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button type="button" className="btn btn-ghost btn-sm h-8 min-h-8 gap-2 px-3 text-[12px]" onClick={clearTexts}>
                <RotateCcw size={14} />
                清空
              </button>
              <button type="button" className="btn btn-ghost btn-sm h-8 min-h-8 gap-2 px-3 text-[12px]" onClick={swapTexts}>
                <ArrowLeftRight size={14} />
                交换左右
              </button>
              <button type="button" className="btn btn-ghost btn-sm h-8 min-h-8 gap-2 px-3 text-[12px]" onClick={loadSampleTexts}>
                <Sparkles size={14} />
                示例
              </button>
              <button type="button" className="btn btn-ghost btn-sm h-8 min-h-8 gap-2 px-3 text-[12px]" onClick={() => void handleCopyText("left")}>
                <Clipboard size={14} />
                复制左侧
              </button>
              <button type="button" className="btn btn-ghost btn-sm h-8 min-h-8 gap-2 px-3 text-[12px]" onClick={() => void handleCopyText("right")}>
                <Clipboard size={14} />
                复制右侧
              </button>
            </div>
          </div>
          {/* Diff 编辑器区域：始终展示双栏编辑器，空白时仅额外给出输入引导。 */}
          <div className="min-h-0 flex-1 bg-[linear-gradient(180deg,#fbfdff_0%,#f3f8ff_100%)] p-4">
            <div className="flex h-full min-h-0 flex-col gap-3">
              {emptyInput ? (
                // 空白提示：提醒用户可直接在左右栏开始输入。
                <div className="flex items-start gap-3 rounded-2xl border border-dashed border-primary/25 bg-base-100/70 px-4 py-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <FileDiff size={18} />
                  </div>
                  <div className="min-w-0">
                    {/* 空白提示标题。 */}
                    <p className="text-[13px] font-medium text-neutral">左右编辑器已就绪</p>
                    {/* 空白提示说明。 */}
                    <p className="mt-1 text-[12px] leading-6 text-neutral/60">
                      现在就可以在左侧和右侧直接输入或粘贴文本；也可以点击“示例”快速查看差异效果。
                    </p>
                  </div>
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-3 text-[12px] text-neutral/60">
                {/* 左侧标签：明确当前左栏输入区域。 */}
                <div className="rounded-xl border border-base-300/80 bg-base-100/70 px-3 py-2">左侧输入</div>
                {/* 右侧标签：明确当前右栏输入区域。 */}
                <div className="rounded-xl border border-base-300/80 bg-base-100/70 px-3 py-2">右侧输入</div>
              </div>
              <div className="h-full overflow-hidden rounded-2xl border border-base-300 bg-base-100 shadow-inner">
                <DiffEditor
                  // 编辑器高度：撑满主体区域。
                  height="100%"
                  original={editorSeed.leftText}
                  modified={editorSeed.rightText}
                  language="plaintext"
                  originalModelPath={`text-diff://${tab.id}/left`}
                  modifiedModelPath={`text-diff://${tab.id}/right`}
                  keepCurrentOriginalModel
                  keepCurrentModifiedModel
                  loading={<MonacoEditorLoadingFallback height="100%" />}
                  onMount={handleEditorMount}
                  options={{
                    renderSideBySide: true,
                    readOnly: false,
                    originalEditable: true,
                    automaticLayout: true,
                    scrollBeyondLastLine: false,
                    minimap: { enabled: false },
                    lineNumbersMinChars: 3,
                    wordWrap: "on",
                    padding: { top: 12, bottom: 12 },
                    renderOverviewRuler: false
                  }}
                />
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

// 文本对比工具页：支持多 Tab、持久化与进入页面后懒恢复。
export function TextDiffTool({ onBack }: TextDiffToolProps) {
  // Store 状态：维护全部页签与当前激活项。
  const tabs = useTextDiffStore((state) => state.tabs);
  const activeTabId = useTextDiffStore((state) => state.activeTabId);
  const setActiveTabId = useTextDiffStore((state) => state.setActiveTabId);
  const createTab = useTextDiffStore((state) => state.createTab);
  const patchTab = useTextDiffStore((state) => state.patchTab);
  const reorderTabs = useTextDiffStore((state) => state.reorderTabs);
  const closeTab = useTextDiffStore((state) => state.closeTab);
  const tabOrder = useTextDiffStore((state) => state.tabOrder);

  // 工具级提示：承载复制、交换等反馈。
  const [notice, setNotice] = useState<{ tone: NoticeTone; message: string } | null>(null);
  // 懒恢复完成标记：进入文本对比工具页后才触发持久化恢复。
  const [hydrated, setHydrated] = useState(useTextDiffStore.persist.hasHydrated());
  // 已常驻挂载的页签集合：切换时不销毁内部编辑器状态。
  const [mountedTabIds, setMountedTabIds] = useState<string[]>([]);
  // 只执行一次的恢复标记：避免 StrictMode 下重复触发恢复流程。
  const hydrationStartedRef = useRef(false);

  // 激活页签实体：为空时回退到第一个页签。
  const orderedTabs = useMemo(() => sortTabsByOrder(tabOrder, tabs), [tabOrder, tabs]);
  const activeTab = useMemo(() => orderedTabs.find((tab) => tab.id === activeTabId) || orderedTabs[0] || null, [orderedTabs, activeTabId]);

  // 工具级通知自动关闭：保持与其它面板一致的轻提示体验。
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => {
      setNotice(null); // 定时关闭提示，避免长时间遮挡工具内容。
    }, 2600);
    return () => {
      window.clearTimeout(timer);
    };
  }, [notice]);

  // 进入工具页后手动恢复持久化状态；若没有历史数据，则补一个默认页签。
  useEffect(() => {
    if (hydrationStartedRef.current) return;
    hydrationStartedRef.current = true;

    void Promise.resolve(useTextDiffStore.persist.rehydrate()).then(() => {
      const storeState = useTextDiffStore.getState();
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

  // 新建文本对比页签。
  function handleCreateTab() {
    createTab();
    setNotice(null);
  }

  // 关闭单个文本对比页签。
  function handleCloseTab(tabId: string) {
    closeTab(tabId);
    setNotice(null);
  }

  if (!hydrated) {
    return (
      // 懒恢复加载态：仅在进入文本对比工具页后展示。
      <div className="flex h-full w-full items-center justify-center bg-base-200/40">
        <div className="rounded-2xl border border-base-300 bg-base-100 px-5 py-4 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="loading loading-spinner text-primary" style={{ width: 22, height: 22 }} />
            <div>
              {/* 加载标题。 */}
              <p className="text-[13px] font-medium text-neutral">正在恢复 TextDiff 工具页签</p>
              <p className="mt-1 text-[12px] text-neutral/65">这里只会在进入文本对比工具后按需恢复，不影响应用启动速度。</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    // TextDiff 工具页：顶部返回 + Tab 栏 + 多页签工作区。
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-base-200/45">
      {/* 工具级全局提示：固定在右上角，展示轻量反馈。 */}
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
        <p className="text-[12px] text-neutral/60">支持多 Tab 文本对比，左右双栏实时高亮差异并在下次进入时恢复。</p>
      </div>
      <ReusableTabs
        tabs={orderedTabs.map((tab) => ({
          id: tab.id,
          title: tab.name,
          closable: true,
          renameable: true
        }))}
        activeTabId={activeTab?.id || ""}
        createButtonTitle="新建 TextDiff 页签"
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
          useTextDiffStore.getState().closeTabsByIds(tabIds);
          setNotice(null);
        }}
      />
      {/* 工作区：所有已访问页签常驻挂载，切换时仅隐藏。 */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {mountedTabs.map((tab) => (
          <TextDiffTabPane
            key={tab.id}
            tab={tab}
            active={tab.id === activeTab?.id}
            onPatchTab={patchTab}
            onShowNotice={setNotice}
          />
        ))}
      </div>
    </div>
  );
}

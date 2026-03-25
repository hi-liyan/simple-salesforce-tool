import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { SalesforceSource } from "../types";

type DataSourceSelectorProps = {
  // 数据源列表：用于渲染下拉选项。
  sources: SalesforceSource[];
  // 当前选中的数据源 ID。
  selectedSourceId: string;
  // 是否禁用选择器。
  disabled?: boolean;
  // 切换数据源回调。
  onChange: (sourceId: string) => void;
};

// 数据源选择器：支持徽标化展示（SF / MySQL）。
export function DataSourceSelector({
  sources,
  selectedSourceId,
  disabled = false,
  onChange
}: DataSourceSelectorProps) {
  // 控制下拉面板开关。
  const [open, setOpen] = useState(false);
  // 根节点引用：用于点击外部区域时关闭下拉。
  const rootRef = useRef<HTMLDivElement | null>(null);

  // 计算当前选中的数据源对象。
  const selectedSource = useMemo(
    () => sources.find((item) => item.id === selectedSourceId) || null,
    [sources, selectedSourceId]
  );
  // 按序号稳定排序：序号相同时按名称兜底，避免渲染抖动。
  const sortedSources = useMemo(
    () =>
      [...sources].sort((a, b) => {
        const sortDiff = (a.sortOrder || 0) - (b.sortOrder || 0);
        if (sortDiff !== 0) return sortDiff;
        return a.name.localeCompare(b.name, "zh-CN");
      }),
    [sources]
  );

  // 将类型归一化为展示徽标文案。
  function getSourceTypeBadge(sourceType: string | undefined): string {
    // 未知类型统一按 Salesforce 风格兜底，避免空白标签。
    const normalizedType = (sourceType || "salesforce").toLowerCase();
    if (normalizedType === "mysql") {
      return "MySQL";
    }
    return "SF";
  }

  // 生成徽标样式：不同类型使用不同色彩，便于快速识别。
  function getBadgeClassName(sourceType: string | undefined): string {
    const normalizedType = (sourceType || "salesforce").toLowerCase();
    if (normalizedType === "mysql") {
      return "border border-amber-300 bg-amber-100 text-amber-700";
    }
    return "border border-sky-300 bg-sky-100 text-sky-700";
  }

  // 打开/关闭下拉面板。
  function toggleDropdown() {
    // 禁用态下忽略点击，避免触发无效交互。
    if (disabled) return;
    setOpen((state) => !state);
  }

  // 选中一个数据源后回调父组件并关闭面板。
  function selectSource(sourceId: string) {
    onChange(sourceId); // 将选择结果回传给页面级状态管理。
    setOpen(false); // 选择后立刻关闭面板，保持交互一致。
  }

  useEffect(() => {
    // 处理点击外部区域关闭逻辑。
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current) return;
      if (rootRef.current.contains(event.target as Node)) return;
      setOpen(false); // 点击组件外部时关闭面板。
    }

    // 处理 Esc 关闭逻辑，提升键盘可用性。
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false); // 按下 Esc 时关闭面板。
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  return (
    // 选择器根容器：提供绝对定位上下文。
    <div className="relative w-full" ref={rootRef}>
      {/* 触发按钮：展示当前选中项与下拉箭头。 */}
      <button
        type="button"
        className="flex h-8 w-full items-center justify-between rounded-md border border-base-300 bg-base-100 px-2 text-sm normal-case hover:bg-primary/10 focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggleDropdown}
        disabled={disabled}
      >
        {/* 按钮左侧内容：显示占位文本或当前选中项。 */}
        <span className="flex min-w-0 items-center gap-2">
          {selectedSource ? (
            <>
              {/* 类型徽标：显示 SF/MySQL。 */}
              <span
                className={`inline-flex min-w-[52px] items-center justify-center rounded px-1.5 py-[1px] text-[10px] font-semibold ${getBadgeClassName(selectedSource.sourceType)}`}
              >
                {getSourceTypeBadge(selectedSource.sourceType)}
              </span>
              {/* 数据源名称：超长时截断。 */}
              <span className="truncate">[{selectedSource.sortOrder || 0}] {selectedSource.name}</span>
            </>
          ) : (
            <span className="truncate text-neutral/70">请选择数据源</span>
          )}
        </span>
        {/* 下拉箭头：面板展开时旋转。 */}
        <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {/* 下拉面板：显示可选数据源列表。 */}
      {open && (
        <div className="absolute left-0 top-[calc(100%+4px)] z-40 min-w-full w-max max-w-[560px] rounded border border-base-300 bg-base-100 p-1 shadow-lg">
          {/* “未选择”选项：支持用户清空当前数据源。 */}
          <button
            type="button"
            className={`flex w-full items-center rounded px-2 py-1.5 text-left text-xs whitespace-nowrap hover:bg-primary/10 ${
              selectedSourceId ? "" : "bg-primary/10"
            }`}
            onClick={() => selectSource("")}
          >
            请选择数据源
          </button>

          {/* 数据源选项列表：每项显示类型徽标与名称。 */}
          {sortedSources.map((source) => {
            const active = source.id === selectedSourceId;
            return (
              <button
                key={source.id}
                type="button"
                className={`mt-1 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-primary/10 ${
                  active ? "bg-primary/10" : ""
                }`}
                onClick={() => selectSource(source.id)}
              >
                {/* 选项类型徽标。 */}
                <span
                  className={`inline-flex min-w-[52px] items-center justify-center rounded px-1.5 py-[1px] text-[10px] font-semibold ${getBadgeClassName(source.sourceType)}`}
                >
                  {getSourceTypeBadge(source.sourceType)}
                </span>
                {/* 选项名称。 */}
                <span className="whitespace-nowrap">[{source.sortOrder || 0}] {source.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

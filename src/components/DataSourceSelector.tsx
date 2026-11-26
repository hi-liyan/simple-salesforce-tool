import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { getDataSourceDriver } from "../drivers/registry";
import { SalesforceSource } from "../types";

type DataSourceSelectorProps = {
  // 数据源列表：用于渲染下拉选项。
  sources: SalesforceSource[];
  // 当前选中的数据源 ID。
  selectedSourceId: string;
  // 是否禁用选择器。
  disabled?: boolean;
  // 是否使用紧凑样式（适用于控制台工具栏右侧）。
  compact?: boolean;
  // 是否允许清空选择（显示“请选择数据源”空项）。
  allowClear?: boolean;
  // 未选中时的占位提示。
  placeholder?: string;
  // 切换数据源回调。
  onChange: (sourceId: string) => void;
};

// 数据源选择器：通过驱动注册表渲染类型徽标与名称，禁止硬编码数据源分支。
export function DataSourceSelector({
  sources,
  selectedSourceId,
  disabled = false,
  compact = false,
  allowClear = true,
  placeholder = "请选择数据源",
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

  // 打开/关闭下拉面板。
  function toggleDropdown() {
    if (disabled) return;
    setOpen((state) => !state);
  }

  // 选中一个数据源后回调父组件并关闭面板。
  function selectSource(sourceId: string) {
    onChange(sourceId);
    setOpen(false);
  }

  useEffect(() => {
    // 处理点击外部区域关闭逻辑。
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current) return;
      if (rootRef.current.contains(event.target as Node)) return;
      setOpen(false);
    }

    // 处理 Esc 关闭逻辑，提升键盘可用性。
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const selectedDriver = selectedSource ? getDataSourceDriver(selectedSource.sourceType) : null;

  return (
    // 选择器根容器：提供绝对定位上下文。
    <div className={compact ? "relative w-auto min-w-[180px] max-w-[260px]" : "relative w-full"} ref={rootRef}>
      {/* 触发按钮：展示当前选中项与下拉箭头。 */}
      <button
        type="button"
        className={`flex w-full items-center justify-between rounded-md border border-base-300 bg-base-100 px-2 normal-case hover:bg-primary/10 focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60 ${
          compact ? "h-7 gap-1.5 text-xs" : "h-8 text-sm"
        }`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggleDropdown}
        disabled={disabled}
      >
        {/* 按钮左侧内容：显示占位文本或当前选中项。 */}
        <span className="flex min-w-0 items-center gap-1.5">
          {selectedSource && selectedDriver ? (
            <>
              {/* 类型徽标：由驱动声明提供。 */}
              <span
                className={`inline-flex shrink-0 items-center justify-center rounded px-1.5 py-[1px] text-[10px] font-semibold ${
                  compact ? "min-w-[40px]" : "min-w-[52px]"
                } ${selectedDriver.badgeClassName}`}
              >
                {selectedDriver.badgeLabel}
              </span>
              {/* 数据源名称：超长时截断。 */}
              <span className="truncate">{compact ? selectedSource.name : `[${selectedSource.sortOrder || 0}] ${selectedSource.name}`}</span>
            </>
          ) : (
            <span className="truncate text-neutral/70">{placeholder}</span>
          )}
        </span>
        {/* 下拉箭头：面板展开时旋转。 */}
        <ChevronDown size={13} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {/* 下拉面板：显示可选数据源列表。 */}
      {open && (
        <div
          className={`absolute top-[calc(100%+4px)] z-40 min-w-full w-max max-w-[420px] max-h-[280px] overflow-auto rounded-lg border border-base-300 bg-base-100 p-1 shadow-lg ${
            compact ? "right-0" : "left-0"
          }`}
        >
          {/* “未选择”选项：仅在 allowClear 为 true 时展示。 */}
          {allowClear && (
            <button
              type="button"
              className={`flex w-full items-center rounded px-2 py-1.5 text-left text-xs whitespace-nowrap hover:bg-primary/10 ${
                selectedSourceId ? "" : "bg-primary/10"
              }`}
              onClick={() => selectSource("")}
            >
              {placeholder}
            </button>
          )}

          {/* 数据源选项列表：每项显示类型徽标与名称。 */}
          {sortedSources.map((source) => {
            const active = source.id === selectedSourceId;
            const driver = getDataSourceDriver(source.sourceType);
            return (
              <button
                key={source.id}
                type="button"
                className={`mt-0.5 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-primary/10 ${
                  active ? "bg-primary/10 font-medium text-primary" : ""
                }`}
                onClick={() => selectSource(source.id)}
              >
                {/* 选项类型徽标。 */}
                <span
                  className={`inline-flex min-w-[44px] shrink-0 items-center justify-center rounded px-1.5 py-[1px] text-[10px] font-semibold ${driver.badgeClassName}`}
                >
                  {driver.badgeLabel}
                </span>
                {/* 选项名称。 */}
                <span className="truncate">
                  {compact ? source.name : `[${source.sortOrder || 0}] ${source.name}`}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

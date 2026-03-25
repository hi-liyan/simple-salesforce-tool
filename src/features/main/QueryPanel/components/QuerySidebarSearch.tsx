import { Search, X } from "lucide-react";
import type { QuerySourceObjectSearchResult } from "../logic/sourceObjectSearch.ts";

type QuerySidebarSearchProps = {
  // 搜索关键字。
  keyword: string;
  // 当前是否正在搜索。
  loading: boolean;
  // 当前聚焦数据源名称。
  focusedSourceName: string;
  // 当前聚焦数据源类型。
  focusedSourceType: string;
  // 搜索结果列表。
  results: QuerySourceObjectSearchResult[];
  // 修改搜索关键字。
  onKeywordChange: (value: string) => void;
  // 点击单个搜索结果。
  onSelectResult: (item: QuerySourceObjectSearchResult) => void;
};

// 左侧搜索面板：只搜索当前聚焦数据源，避免全量预拉全部 source 的对象列表。
export function QuerySidebarSearch({
  keyword,
  loading,
  focusedSourceName,
  focusedSourceType,
  results,
  onKeywordChange,
  onSelectResult
}: QuerySidebarSearchProps) {
  const normalizedKeyword = keyword.trim();
  const showResultPanel = Boolean(normalizedKeyword);
  const showSearchMeta = showResultPanel;
  const normalizedSourceType = String(focusedSourceType || "salesforce").toLowerCase();
  const objectAlias = normalizedSourceType === "mysql" ? "表" : "Object";
  const searchPlaceholder = normalizedSourceType === "mysql" ? "搜索表名 / 注释 / table" : "搜索 Object 名称 / 标签 / object";
  const searchHint = normalizedSourceType === "mysql" ? "支持名称、注释和 table 关键字搜索" : "支持名称、标签和 object 关键字搜索";

  return (
    <div className="relative z-20 border-b border-base-300 px-3 py-2">
      {/* 搜索输入框容器：固定放在左树上方，便于始终快速触达。 */}
      <label className="peer input input-bordered input-sm flex items-center gap-2">
        {/* 搜索图标：弱化视觉存在感，只提示输入用途。 */}
        <Search size={14} className="shrink-0 text-base-content/45" />
        {/* 搜索输入框：实时搜索当前聚焦数据源下的 Object/表。 */}
        <input
          className="min-w-0 flex-1 bg-transparent text-[12px]"
          type="text"
          value={keyword}
          placeholder={searchPlaceholder}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(event) => {
            onKeywordChange(event.target.value); // 行内注释：同步侧边栏搜索关键字，驱动延迟搜索。
          }}
        />
        {/* 清空按钮：有输入时快速恢复默认左树浏览态。 */}
        {normalizedKeyword && (
          <button
            type="button"
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-base-content/45 transition-colors hover:bg-base-200 hover:text-base-content/70"
            aria-label="清空搜索"
            onClick={() => {
              onKeywordChange(""); // 行内注释：清空关键字并隐藏结果面板。
            }}
          >
            <X size={12} />
          </button>
        )}
      </label>

      {/* 搜索范围说明：明确当前是按聚焦数据源搜索，而不是跨全部数据源。 */}
      <p className={`mt-2 text-[11px] text-neutral/60 ${showSearchMeta ? "block" : "hidden peer-focus-within:block"}`}>搜索范围：{focusedSourceName || "当前数据源"}</p>
      {/* 搜索提示：说明支持的匹配维度，帮助用户理解 Object/Table 组合搜索能力。 */}
      <p className={`mt-1 text-[11px] text-neutral/50 ${showSearchMeta ? "block" : "hidden peer-focus-within:block"}`}>{searchHint}</p>

      {/* 搜索结果面板：仅在有关键字时出现，避免左侧结构常驻过于拥挤。 */}
      {showResultPanel && (
        <div className="absolute left-3 right-3 top-full mt-2 overflow-hidden rounded border border-base-300 bg-base-100 shadow-lg">
          {/* 加载态提示：首次补拉当前 source 对象列表时给出明确反馈。 */}
          {loading && <div className="px-3 py-2 text-[12px] text-neutral/60">正在搜索...</div>}

          {/* 空结果提示：帮助用户快速判断当前 source 下没有匹配项。 */}
          {!loading && results.length === 0 && (
            <div className="px-3 py-2 text-[12px] text-neutral/60">当前数据源下未找到匹配的{objectAlias}</div>
          )}

          {/* 结果列表：点击后直接定位左树并打开右侧工作区。 */}
          {!loading && results.length > 0 && (
            <div className="max-h-48 overflow-y-auto py-1">
              {results.map((item) => (
                <button
                  key={`${item.sourceId}:${item.objectName}`}
                  type="button"
                  className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-base-200/70"
                  onClick={() => {
                    onSelectResult(item); // 行内注释：点击结果后打开对象并保持左树与工作区同步。
                  }}
                >
                  {/* 结果主信息：优先显示对象名，保证技术名搜索可快速扫到。 */}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] text-base-content">{item.objectName}</div>
                    {/* 结果次级说明：展示标签或注释，兼顾业务名称搜索。 */}
                    <div className="mt-0.5 truncate text-[11px] text-neutral/60">{item.secondaryText}</div>
                  </div>
                  {/* 不可查询提示：沿用左树语义，让用户在点开前就知道状态。 */}
                  {!item.queryable && (
                    <span className="shrink-0 rounded bg-base-300 px-1.5 py-[2px] text-[10px] leading-[1] text-base-content/80">
                      不可查询
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

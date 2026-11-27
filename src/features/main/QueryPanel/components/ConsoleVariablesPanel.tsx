import { AlertTriangle, Braces, RotateCcw, Trash2, X } from "lucide-react";
import type { ConsoleVariableLogicalType, DataSourceDriver } from "../../../../drivers/types.ts";
import type { ConsoleManualVariableEntry } from "../../../../store/useSoqlExecutorStore.ts";
import type { ObjectDescribe } from "../../../../types/index.ts";
import {
  inferExpectedVariableType,
  type ConsoleContextVariableEntry,
  type ConsolePlaceholderOccurrence
} from "../logic/consoleVariables.ts";

type ConsoleVariablesPanelProps = {
  // 当前编辑器中的 SQL/SOQL 文本（用于推导期望类型）。
  sqlText: string;
  // 当前 SQL 中扫描到的全部占位符出现位置。
  occurrences: ConsolePlaceholderOccurrence[];
  // 当前 Tab 内存态查询上下文变量映射。
  contextVariables: Record<string, ConsoleContextVariableEntry>;
  // 当前 Tab 持久化手工变量映射。
  manualVariables: Record<string, ConsoleManualVariableEntry>;
  // 已加载对象元数据（用于推导期望类型）。
  objectDescribeMap: Record<string, ObjectDescribe>;
  // 当前数据源前端驱动。
  driver: DataSourceDriver;
  // 当前高亮聚焦的变量名（例如执行校验失败时自动定位）。
  highlightedVarName?: string | null;
  // 更新单个手工变量配置。
  onChangeManualVariable: (varName: string, next: ConsoleManualVariableEntry) => void;
  // 移除单个手工变量覆写或输入。
  onRemoveManualVariable: (varName: string) => void;
  // 清空当前 Tab 全部查询上下文变量。
  onClearContextVariables: () => void;
  // 收起右侧变量面板。
  onClose: () => void;
};

// 逻辑类型徽章展示文本映射。
const TYPE_BADGE_LABELS: Record<ConsoleVariableLogicalType, string> = {
  string: "String",
  number: "Number",
  boolean: "Boolean",
  date: "Date",
  datetime: "DateTime",
  null: "Null",
  unknown: "Auto"
};

// 格式化上下文样本值预览文本。
function formatPreviewValue(val: unknown): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

// 控制台右侧变量侧边栏：自动识别占位符输入 + 可视化查询上下文变量。
export function ConsoleVariablesPanel({
  sqlText,
  occurrences,
  contextVariables,
  manualVariables,
  objectDescribeMap,
  driver,
  highlightedVarName,
  onChangeManualVariable,
  onRemoveManualVariable,
  onClearContextVariables,
  onClose
}: ConsoleVariablesPanelProps) {
  // 按变量名去重，保留首次出现的操作符上下文用于提示。
  const uniqueOccurrences = Array.from(
    occurrences.reduce((map, item) => {
      if (!map.has(item.name)) {
        map.set(item.name, item);
      }
      return map;
    }, new Map<string, ConsolePlaceholderOccurrence>()).values()
  );

  // 需要手工填写的变量：不在上下文中，或用户已开启覆写。
  const manualInputItems = uniqueOccurrences.filter((occ) => {
    const ctx = contextVariables[occ.name];
    const manual = manualVariables[occ.name];
    return !ctx || Boolean(manual?.overrideContext);
  });

  const contextEntries = Object.values(contextVariables);

  return (
    <aside className="flex h-full w-[300px] shrink-0 flex-col border-l border-base-300 bg-base-100">
      {/* 右侧面板头部：标题与关闭按钮。 */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-base-300/80 px-3">
        <div className="flex items-center gap-1.5 text-[12px] font-medium text-neutral">
          <Braces size={13} className="text-primary" />
          <span>变量与上下文</span>
        </div>
        <button
          type="button"
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral/60 transition-colors hover:bg-base-200 hover:text-neutral"
          onClick={onClose}
          title="收起变量面板"
          aria-label="收起变量面板"
        >
          <X size={13} />
        </button>
      </div>

      {/* 面板滚动体：上半区为手工输入参数，下半区为查询上下文变量。 */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2.5">
        {/* 区域 1：待输入占位符变量。 */}
        <section className="space-y-2">
          <div className="flex items-center justify-between px-0.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral/60">
              输入参数 ({manualInputItems.length})
            </span>
          </div>

          {manualInputItems.length === 0 ? (
            <div className="rounded-lg border border-dashed border-base-300 bg-base-200/30 px-2.5 py-2 text-[11px] text-neutral/55">
              {uniqueOccurrences.length > 0
                ? "当前 SQL 中的变量均已从查询上下文自动匹配。"
                : "在 SQL 中输入 #{varName} 即可在此自动识别参数。"}
            </div>
          ) : (
            <div className="space-y-2">
              {manualInputItems.map((occ) => {
                const entry = manualVariables[occ.name] || { value: "", typeOverride: "auto" };
                const expectedType = inferExpectedVariableType(occ, sqlText, objectDescribeMap, driver);
                const isOverriding = Boolean(contextVariables[occ.name] && entry.overrideContext);
                const isHighlighted = highlightedVarName === occ.name;
                const typeValue = entry.typeOverride || "auto";

                return (
                  <div
                    key={occ.name}
                    className={`rounded-lg border p-2 transition-colors ${
                      isHighlighted
                        ? "border-rose-400 bg-rose-500/5"
                        : "border-base-300/80 bg-base-200/30"
                    }`}
                  >
                    {/* 变量卡片头部：变量名、条件类型徽章与类型覆盖下拉。 */}
                    <div className="mb-1.5 flex items-center justify-between gap-1.5">
                      <div className="flex min-w-0 items-center gap-1">
                        <code className="truncate rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] font-medium text-primary">
                          #{`{${occ.name}}`}
                        </code>
                        {occ.isCollectionOperator && (
                          <span className="shrink-0 rounded bg-amber-500/12 px-1 py-0.5 text-[10px] text-amber-700">
                            {occ.operator} 列表
                          </span>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <select
                          className="h-5 rounded border border-base-300 bg-base-100 px-1 text-[10.5px] text-neutral/80 outline-none focus:border-primary"
                          value={typeValue}
                          onChange={(event) =>
                            onChangeManualVariable(occ.name, {
                              ...entry,
                              typeOverride: event.target.value as ConsoleManualVariableEntry["typeOverride"]
                            })
                          }
                          title="指定变量数据类型"
                        >
                          <option value="auto">
                            Auto{expectedType !== "unknown" ? ` (${TYPE_BADGE_LABELS[expectedType]})` : ""}
                          </option>
                          <option value="string">String</option>
                          <option value="number">Number</option>
                          <option value="boolean">Boolean</option>
                          <option value="date">Date</option>
                          <option value="datetime">DateTime</option>
                        </select>
                        {isOverriding && (
                          <button
                            type="button"
                            className="inline-flex h-5 items-center gap-0.5 rounded px-1 text-[10px] text-sky-700 hover:bg-sky-500/12"
                            onClick={() =>
                              onChangeManualVariable(occ.name, {
                                ...entry,
                                overrideContext: false
                              })
                            }
                            title="取消手工覆写，恢复使用上下文结果"
                          >
                            <RotateCcw size={10} />
                            <span>恢复</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* 变量值输入区：集合条件支持多行输入，标量条件使用单行输入框。 */}
                    {occ.isCollectionOperator ? (
                      <textarea
                        rows={2}
                        className="w-full resize-y rounded-md border border-base-300 bg-base-100 px-2 py-1 font-mono text-[11.5px] text-neutral outline-none focus:border-primary"
                        placeholder="输入多个值，用英文逗号或换行分隔..."
                        value={entry.value}
                        onChange={(event) =>
                          onChangeManualVariable(occ.name, {
                            ...entry,
                            value: event.target.value
                          })
                        }
                      />
                    ) : (
                      <input
                        type="text"
                        className="h-7 w-full rounded-md border border-base-300 bg-base-100 px-2 font-mono text-[11.5px] text-neutral outline-none focus:border-primary"
                        placeholder={
                          expectedType !== "unknown"
                            ? `输入 ${TYPE_BADGE_LABELS[expectedType]} 值...`
                            : "输入变量值..."
                        }
                        value={entry.value}
                        onChange={(event) =>
                          onChangeManualVariable(occ.name, {
                            ...entry,
                            value: event.target.value
                          })
                        }
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* 区域 2：前置查询结果自动注入的上下文变量。 */}
        <section className="space-y-2 border-t border-base-300/70 pt-2.5">
          <div className="flex items-center justify-between px-0.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral/60">
              查询上下文 ({contextEntries.length})
            </span>
            {contextEntries.length > 0 && (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-neutral/65 transition-colors hover:bg-base-200 hover:text-rose-600"
                onClick={onClearContextVariables}
                title="清空当前 Tab 查询上下文变量"
              >
                <Trash2 size={10.5} />
                <span>清空</span>
              </button>
            )}
          </div>

          {contextEntries.length === 0 ? (
            <div className="rounded-lg border border-dashed border-base-300 bg-base-200/30 px-2.5 py-2 text-[11px] text-neutral/55">
              执行 SELECT 查询后，结果集字段与别名将自动加入此上下文供后续语句引用。
            </div>
          ) : (
            <div className="space-y-1.5">
              {contextEntries.map((ctx) => {
                const isOverridden = Boolean(manualVariables[ctx.name]?.overrideContext);
                const isHighlighted = highlightedVarName === ctx.name;
                const previewText =
                  ctx.rowCount === 0
                    ? "(0 条记录)"
                    : ctx.values
                        .slice(0, 3)
                        .map((item) => formatPreviewValue(item))
                        .join(", ") + (ctx.rowCount > 3 ? ` ... (共 ${ctx.rowCount} 条)` : "");

                return (
                  <div
                    key={ctx.name}
                    className={`rounded-lg border px-2 py-1.5 text-[11px] ${
                      ctx.ambiguous || isHighlighted
                        ? "border-amber-400/80 bg-amber-500/5"
                        : "border-base-300/75 bg-base-200/25"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <div className="flex min-w-0 items-center gap-1">
                        <code className="truncate font-mono font-medium text-emerald-700">
                          #{`{${ctx.name}}`}
                        </code>
                        <span className="shrink-0 rounded bg-base-300/60 px-1 py-0.5 text-[9.5px] text-neutral/75">
                          {TYPE_BADGE_LABELS[ctx.logicalType]}
                        </span>
                        <span className="shrink-0 rounded bg-emerald-500/12 px-1 py-0.5 text-[9.5px] text-emerald-700">
                          {ctx.rowCount} 行
                        </span>
                      </div>

                      {!isOverridden ? (
                        <button
                          type="button"
                          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-neutral/70 hover:bg-base-300/60 hover:text-primary"
                          onClick={() =>
                            onChangeManualVariable(ctx.name, {
                              value:
                                manualVariables[ctx.name]?.value ||
                                (ctx.nonNullValues[0] !== undefined ? String(ctx.nonNullValues[0]) : ""),
                              typeOverride: manualVariables[ctx.name]?.typeOverride || "auto",
                              overrideContext: true
                            })
                          }
                          title="手工覆写此上下文变量"
                        >
                          覆写
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-sky-700 hover:bg-sky-500/12"
                          onClick={() => onRemoveManualVariable(ctx.name)}
                          title="已手工覆写，点击恢复使用上下文"
                        >
                          已覆写
                        </button>
                      )}
                    </div>

                    {ctx.ambiguous ? (
                      <div className="mt-1 flex items-start gap-1 text-[10.5px] text-amber-700">
                        <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                        <span>不唯一（{ctx.conflictSources.join(" / ")}），建议改用别名</span>
                      </div>
                    ) : (
                      <div className="mt-0.5 truncate font-mono text-[10.5px] text-neutral/65" title={previewText}>
                        {previewText}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}

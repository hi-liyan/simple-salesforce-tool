import { useEffect, useRef } from "react";
import { acceptCompletion, autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { MySQL, StandardSQL, sql } from "@codemirror/lang-sql";
import { bracketMatching, defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { linter, lintGutter, type Diagnostic } from "@codemirror/lint";
import { Compartment, EditorState, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  GutterMarker,
  ViewPlugin,
  type ViewUpdate,
  drawSelection,
  gutter,
  highlightActiveLine,
  highlightActiveLineGutter,
  hoverTooltip,
  keymap,
  lineNumbers,
  placeholder as cmPlaceholder
} from "@codemirror/view";
import { scanSqlPlaceholders } from "../../features/main/QueryPanel/logic/consoleVariables";
import { api } from "../../api";
import {
  createSqlCompletionSource,
  extractLocalCreateTables,
  extractStatementAliases,
  extractStatementAtCursor,
  splitSqlStatementsWithRanges,
  type QueryLanguage,
  type SqlCompletionMetadata,
  type SqlStatementRange
} from "./sqlCompletion";

// 语句执行状态类型：用于左侧 Gutter 展示每条语句的当前执行进度与结果。
export type StatementExecutionStatus = "idle" | "running" | "success" | "error";

// 语句悬停高亮范围 StateEffect：鼠标悬停 Gutter ▶ 按钮时高亮对应语句范围。
const setHoverStatementRangeEffect = StateEffect.define<{ from: number; to: number } | null>();

// 语句执行状态映射 StateEffect：由外部受控同步每条语句的执行状态。
const setStatementStatusesEffect = StateEffect.define<Record<number, StatementExecutionStatus>>();

// 语句执行状态 StateField：供 GutterMarker 读取当前每条语句的状态。
const statementStatusesField = StateField.define<Record<number, StatementExecutionStatus>>({
  create() {
    return {};
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setStatementStatusesEffect)) {
        return effect.value;
      }
    }
    return value;
  }
});

// 语句悬停高亮 StateField：管理编辑器内当前悬停语句的 DecorationSet。
const hoverStatementHighlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setHoverStatementRangeEffect)) {
        if (!effect.value) return Decoration.none;
        const { from, to } = effect.value;
        const safeFrom = Math.max(0, Math.min(from, tr.state.doc.length));
        const safeTo = Math.max(safeFrom, Math.min(to, tr.state.doc.length));
        if (safeFrom >= safeTo) return Decoration.none;
        return Decoration.set([
          Decoration.mark({ class: "cm-statement-hover-highlight" }).range(safeFrom, safeTo)
        ]);
      }
    }
    if (tr.docChanged) {
      return decorations.map(tr.changes);
    }
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field)
});

// 左侧按条执行按钮 Marker：在每条 SQL 语句起始行渲染状态图标（▶ / loading / ✔ / ✘）。
class StatementRunGutterMarker extends GutterMarker {
  private readonly statement: SqlStatementRange;
  private readonly status: StatementExecutionStatus;
  private readonly onExecute: (sql: string, statement: SqlStatementRange) => void;

  constructor(
    statement: SqlStatementRange,
    status: StatementExecutionStatus,
    onExecute: (sql: string, statement: SqlStatementRange) => void
  ) {
    super();
    this.statement = statement;
    this.status = status;
    this.onExecute = onExecute;
  }

  eq(other: StatementRunGutterMarker): boolean {
    return (
      other instanceof StatementRunGutterMarker &&
      other.statement.from === this.statement.from &&
      other.statement.to === this.statement.to &&
      other.statement.sql === this.statement.sql &&
      other.status === this.status
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `cm-statement-run-btn cm-statement-status-${this.status}`;

    if (this.status === "running") {
      // 行内注释：当前语句正在执行，渲染旋转加载图标。
      btn.title = `正在执行第 ${this.statement.index + 1} 条语句...`;
      btn.setAttribute("aria-label", `正在执行第 ${this.statement.index + 1} 条语句`);
      btn.disabled = true;
      btn.innerHTML =
        '<svg class="cm-statement-spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="display:block" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>';
    } else if (this.status === "success") {
      // 行内注释：当前语句执行成功，渲染绿色对勾。
      btn.title = `第 ${this.statement.index + 1} 条语句执行成功，点击重新执行`;
      btn.setAttribute("aria-label", `第 ${this.statement.index + 1} 条语句执行成功`);
      btn.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" style="display:block" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    } else if (this.status === "error") {
      // 行内注释：当前语句执行失败，渲染红叉。
      btn.title = `第 ${this.statement.index + 1} 条语句执行失败，点击重新执行`;
      btn.setAttribute("aria-label", `第 ${this.statement.index + 1} 条语句执行失败`);
      btn.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" style="display:block" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    } else {
      // 行内注释：默认待执行状态，渲染绿色播放三角。
      btn.title = `执行第 ${this.statement.index + 1} 条语句`;
      btn.setAttribute("aria-label", `执行第 ${this.statement.index + 1} 条语句`);
      btn.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="display:block" aria-hidden="true"><polygon points="6,3 20,12 6,21"></polygon></svg>';
    }

    btn.addEventListener("mouseenter", () => {
      view.dispatch({
        effects: setHoverStatementRangeEffect.of({
          from: this.statement.from,
          to: this.statement.to
        })
      });
    });

    btn.addEventListener("mouseleave", () => {
      view.dispatch({
        effects: setHoverStatementRangeEffect.of(null)
      });
    });

    btn.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });

    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.status === "running") return;
      view.dispatch({
        effects: setHoverStatementRangeEffect.of(null)
      });
      this.onExecute(this.statement.sql, this.statement);
    });

    return btn;
  }
}

export type CodeMirrorQueryEditorProps = {
  // 编辑器语言类型（soql / mysql）。
  language: QueryLanguage;
  // 编辑器当前文本值。
  value: string;
  // 文本变更回调。
  onChange: (value: string) => void;
  // 选区变更回调（无选区时返回空字符串）。
  onSelectionTextChange?: (selectionText: string) => void;
  // 点击左侧 Gutter 单条语句执行按钮回调。
  onExecuteStatement?: (sql: string, statement: SqlStatementRange) => void;
  // 快捷键触发执行当前语句（Ctrl/Cmd + Enter）。
  onExecuteCurrent?: () => void;
  // 快捷键触发执行全部语句（Ctrl/Cmd + Shift + Enter）。
  onExecuteAll?: () => void;
  // 每条语句的执行状态映射（按语句索引）。
  statementStatuses?: Record<number, StatementExecutionStatus>;
  // 占位提示文本。
  placeholder?: string;
  // 容器高度。
  height?: string;
  // 可参与补全的字段名。
  fieldNames?: string[];
  // 可参与补全的对象/表名。
  objectNames?: string[];
  // 对象/表到字段列表映射。
  objectFieldsMap?: Record<string, string[]>;
  // 自动换行模式。
  wordWrapMode?: "off" | "on" | "wordWrapColumn" | "bounded";
  // 外部触发在光标/选区处插入文本的请求信号。
  insertTextRequest?: { text: string; nonce: number } | null;
  // 额外样式类名。
  className?: string;
};

// CodeMirror 6 浅色主题：对齐 Islands 大圆角工作台风格与原有浅蓝当前行高亮。
const dbxLightTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "14px",
    backgroundColor: "#ffffff",
    color: "#1e293b"
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace",
    lineHeight: "1.6"
  },
  ".cm-content": {
    padding: "8px 0",
    userSelect: "text",
    WebkitUserSelect: "text"
  },
  ".cm-gutters": {
    backgroundColor: "#f8fafc",
    color: "#94a3b8",
    borderRight: "1px solid #e2e8f0",
    userSelect: "none"
  },
  ".cm-activeLine": {
    backgroundColor: "rgba(219, 234, 254, 0.5)"
  },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "rgba(59, 130, 246, 0.28) !important"
  },
  ".cm-activeLineGutter": {
    backgroundColor: "#e0efff",
    color: "#334155"
  },
  ".cm-statement-run-gutter": {
    width: "24px",
    backgroundColor: "#f8fafc"
  },
  ".cm-statement-run-gutter .cm-gutterElement": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0"
  },
  ".cm-statement-run-btn": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "20px",
    height: "20px",
    padding: "0",
    margin: "0",
    lineHeight: "0",
    borderRadius: "4px",
    border: "none",
    backgroundColor: "transparent",
    color: "#16a34a",
    cursor: "pointer",
    transition: "background-color 120ms ease, transform 120ms ease"
  },
  ".cm-statement-run-btn:hover": {
    backgroundColor: "rgba(22, 163, 74, 0.14)",
    transform: "scale(1.06)"
  },
  ".cm-statement-status-running": {
    color: "#0284c7",
    cursor: "wait"
  },
  ".cm-statement-status-running:hover": {
    backgroundColor: "rgba(2, 132, 199, 0.12)",
    transform: "none"
  },
  ".cm-statement-status-success": {
    color: "#16a34a"
  },
  ".cm-statement-status-error": {
    color: "#dc2626"
  },
  ".cm-statement-status-error:hover": {
    backgroundColor: "rgba(220, 38, 38, 0.12)"
  },
  "@keyframes cm-statement-spin": {
    from: { transform: "rotate(0deg)" },
    to: { transform: "rotate(360deg)" }
  },
  ".cm-statement-spinner": {
    animation: "cm-statement-spin 0.9s linear infinite"
  },
  ".cm-statement-hover-highlight": {
    backgroundColor: "rgba(22, 163, 74, 0.10)",
    borderRadius: "2px"
  },
  ".cm-console-var-placeholder": {
    color: "#b45309",
    backgroundColor: "rgba(245, 158, 11, 0.14)",
    borderRadius: "3px",
    fontWeight: "500"
  },
  ".cm-tooltip-autocomplete": {
    border: "1px solid #cbd5e1",
    borderRadius: "8px",
    boxShadow: "0 10px 25px rgba(15, 23, 42, 0.12)",
    overflow: "hidden"
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "#0176d3",
    color: "#ffffff"
  }
});

// 基于 CodeMirror 6 + 自研 statement-scoped 补全引擎的查询编辑器（对齐 dbx 实现）。
export function CodeMirrorQueryEditor({
  language,
  value,
  onChange,
  onSelectionTextChange,
  onExecuteStatement,
  onExecuteCurrent,
  onExecuteAll,
  statementStatuses = {},
  placeholder = "",
  height = "220px",
  fieldNames = [],
  objectNames = [],
  objectFieldsMap = {},
  wordWrapMode = "on",
  insertTextRequest = null,
  className = ""
}: CodeMirrorQueryEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSelectionChangeRef = useRef(onSelectionTextChange);
  onSelectionChangeRef.current = onSelectionTextChange;
  const onExecuteStatementRef = useRef(onExecuteStatement);
  onExecuteStatementRef.current = onExecuteStatement;
  const onExecuteCurrentRef = useRef(onExecuteCurrent);
  onExecuteCurrentRef.current = onExecuteCurrent;
  const onExecuteAllRef = useRef(onExecuteAll);
  onExecuteAllRef.current = onExecuteAll;

  const metadataRef = useRef<SqlCompletionMetadata>({
    language,
    fields: fieldNames,
    objects: objectNames,
    objectFields: objectFieldsMap
  });
  metadataRef.current = {
    language,
    fields: fieldNames,
    objects: objectNames,
    objectFields: objectFieldsMap
  };

  const languageCompartmentRef = useRef(new Compartment());
  const wrapCompartmentRef = useRef(new Compartment());
  const placeholderCompartmentRef = useRef(new Compartment());

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const completionSource = createSqlCompletionSource(() => metadataRef.current);

    // AST 实时语法诊断扩展：在 MySQL 模式下通过后端 sqlparser 异步标红语法错误。
    const astLinter = linter(
      async (view): Promise<Diagnostic[]> => {
        if (metadataRef.current.language !== "mysql") return [];
        const text = view.state.doc.toString();
        if (!text.trim()) return [];
        try {
          // 行内注释：送入 AST 语法诊断前将 #{varName} 替换为等长占位数字，避免误报语法红线。
          const sanitizedText = text.replace(/#\{\s*[A-Za-z_][A-Za-z0-9_]*\s*\}/g, (match) =>
            "1".padEnd(match.length, " ")
          );
          const diagnostics = await api.diagnoseSql(sanitizedText, "mysql");
          const doc = view.state.doc;
          return diagnostics.map((item) => {
            const lineNum = Math.min(Math.max(1, item.line), doc.lines);
            const lineInfo = doc.line(lineNum);
            const from = Math.min(lineInfo.from + Math.max(0, item.column - 1), lineInfo.to);
            const to = Math.min(Math.max(from + 1, from + 6), lineInfo.to);
            return {
              from,
              to: to > from ? to : lineInfo.to,
              severity: item.severity === "warning" ? "warning" : "error",
              message: item.message
            };
          });
        } catch {
          return [];
        }
      },
      { delay: 320 }
    );

    // 表结构 Hover 提示扩展：悬停表名或别名时展示字段概览。
    const schemaHover = hoverTooltip((view, pos) => {
      const { doc } = view.state;
      const line = doc.lineAt(pos);
      const lineOffset = pos - line.from;
      const before = line.text.slice(0, lineOffset).match(/[A-Za-z_][\w$]*$/)?.[0] || "";
      const after = line.text.slice(lineOffset).match(/^[\w$]*/)?.[0] || "";
      const word = `${before}${after}`;
      if (!word) return null;

      const fullDoc = doc.toString();
      const { statement } = extractStatementAtCursor(fullDoc, pos);
      const aliasMap = extractStatementAliases(statement);
      const lowerWord = word.toLowerCase();
      const resolvedTable = aliasMap[lowerWord] || lowerWord;

      const localTables = extractLocalCreateTables(fullDoc);
      const remoteCols =
        metadataRef.current.objectFields[resolvedTable] ||
        Object.entries(metadataRef.current.objectFields).find(
          ([k]) => k.toLowerCase() === resolvedTable
        )?.[1];
      const cols = remoteCols || localTables[resolvedTable];
      if (!cols || cols.length === 0) return null;

      const preview = cols.slice(0, 16).join(", ");
      const suffix = cols.length > 16 ? ` ... (+${cols.length - 16})` : "";

      return {
        pos: pos - before.length,
        end: pos + after.length,
        above: true,
        create: () => {
          const dom = document.createElement("div");
          dom.className = "rounded-lg border border-base-300 bg-base-100 px-3 py-2 text-[12px] shadow-lg max-w-[360px]";
          const title = document.createElement("div");
          title.className = "font-semibold text-base-content mb-1";
          title.textContent = `表 ${resolvedTable} (${cols.length} 个字段)`;
          const body = document.createElement("div");
          body.className = "font-mono text-[11px] text-neutral/80 break-words";
          body.textContent = `${preview}${suffix}`;
          dom.appendChild(title);
          dom.appendChild(body);
          return { dom };
        }
      };
    });

    // 左侧按条执行 Gutter：扫描每条有效 SQL/SOQL 语句并在起始行渲染状态图标按钮。
    const statementRunGutter = gutter({
      class: "cm-statement-run-gutter",
      lineMarkerChange(update) {
        return (
          update.docChanged ||
          update.transactions.some((tr) => tr.effects.some((effect) => effect.is(setStatementStatusesEffect)))
        );
      },
      markers(view) {
        if (!onExecuteStatementRef.current) return new RangeSetBuilder<GutterMarker>().finish();
        const builder = new RangeSetBuilder<GutterMarker>();
        const doc = view.state.doc;
        const statuses = view.state.field(statementStatusesField);
        const statements = splitSqlStatementsWithRanges(doc.toString());
        let lastLineFrom = -1;
        for (const stmt of statements) {
          const line = doc.lineAt(Math.min(stmt.from, doc.length));
          if (line.from === lastLineFrom) continue; // 同一行多条语句仅在首条渲染一次执行按钮。
          lastLineFrom = line.from;
          const status = statuses[stmt.index] ?? "idle";
          builder.add(
            line.from,
            line.from,
            new StatementRunGutterMarker(stmt, status, (sql, statement) => {
              onExecuteStatementRef.current?.(sql, statement);
            })
          );
        }
        return builder.finish();
      }
    });

    // 占位符高亮插件：实时标注 #{varName}，跳过注释与字符串字面量。
    const placeholderHighlightPlugin = ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = buildPlaceholderDecorations(view.state.doc.toString());
        }
        update(update: ViewUpdate) {
          if (update.docChanged) {
            this.decorations = buildPlaceholderDecorations(update.state.doc.toString());
          }
        }
      },
      {
        decorations: (plugin) => plugin.decorations
      }
    );

    function buildPlaceholderDecorations(docText: string): DecorationSet {
      const builder = new RangeSetBuilder<Decoration>();
      const occurrences = scanSqlPlaceholders(docText);
      for (const occ of occurrences) {
        builder.add(
          occ.from,
          occ.to,
          Decoration.mark({ class: "cm-console-var-placeholder" })
        );
      }
      return builder.finish();
    }

    const state = EditorState.create({
      doc: value,
      extensions: [
        statementStatusesField,
        statementRunGutter,
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        history(),
        bracketMatching(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        dbxLightTheme,
        hoverStatementHighlightField,
        placeholderHighlightPlugin,
        lintGutter(),
        astLinter,
        schemaHover,
        languageCompartmentRef.current.of(
          sql({ dialect: language === "mysql" ? MySQL : StandardSQL })
        ),
        wrapCompartmentRef.current.of(wordWrapMode === "off" ? [] : EditorView.lineWrapping),
        placeholderCompartmentRef.current.of(placeholder ? cmPlaceholder(placeholder) : []),
        autocompletion({
          override: [completionSource],
          activateOnTyping: true,
          maxRenderedOptions: 60
        }),
        keymap.of([
          {
            key: "Mod-Enter",
            run: () => {
              onExecuteCurrentRef.current?.();
              return Boolean(onExecuteCurrentRef.current);
            }
          },
          {
            key: "Mod-Shift-Enter",
            run: () => {
              onExecuteAllRef.current?.();
              return Boolean(onExecuteAllRef.current);
            }
          },
          {
            key: "Tab",
            run: acceptCompletion
          },
          ...completionKeymap.filter((binding) => binding.key !== "Enter"),
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
          if (update.selectionSet || update.docChanged) {
            const sel = update.state.selection.main;
            const selectedText = sel.empty ? "" : update.state.sliceDoc(sel.from, sel.to);
            onSelectionChangeRef.current?.(selectedText);
          }
        })
      ]
    });

    const view = new EditorView({
      state,
      parent: container
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // 外部受控 value 同步（如点击格式化 SQL、切换 Tab 或 AI 插入 SQL）。
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentText = view.state.doc.toString();
    if (currentText === value) return;
    view.dispatch({
      changes: { from: 0, to: currentText.length, insert: value }
    });
  }, [value]);

  // 动态切换语言方言（MySQL / SOQL）。
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: languageCompartmentRef.current.reconfigure(
        sql({ dialect: language === "mysql" ? MySQL : StandardSQL })
      )
    });
  }, [language]);

  // 动态切换自动换行。
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: wrapCompartmentRef.current.reconfigure(
        wordWrapMode === "off" ? [] : EditorView.lineWrapping
      )
    });
  }, [wordWrapMode]);

  // 动态更新占位文本。
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: placeholderCompartmentRef.current.reconfigure(
        placeholder ? cmPlaceholder(placeholder) : []
      )
    });
  }, [placeholder]);

  // 同步外部传入的每条语句执行状态，触发 Gutter 图标刷新。
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: setStatementStatusesEffect.of(statementStatuses)
    });
  }, [statementStatuses]);

  // 响应外部光标插入请求：在当前光标/选区位置插入片段并将光标移至末尾。
  useEffect(() => {
    if (!insertTextRequest || !insertTextRequest.text) return;
    const view = viewRef.current;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: insertTextRequest.text },
      selection: { anchor: from + insertTextRequest.text.length }
    });
    view.focus();
  }, [insertTextRequest]);

  return (
    <div
      ref={containerRef}
      style={{ height }}
      className={`codemirror-query-editor relative overflow-hidden rounded-lg border border-base-300 bg-base-100 ${className}`}
    />
  );
}

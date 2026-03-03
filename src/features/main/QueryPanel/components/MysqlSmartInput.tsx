import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";

type MysqlSmartInputProps = {
  // 输入框标题（例如 WHERE、排序）。
  label: string;
  // 当前输入值。
  value: string;
  // 占位文案。
  placeholder?: string;
  // 输入值变化回调。
  onChange: (value: string) => void;
  // 自动补全候选词。
  suggestions: string[];
  // 宽度本地存储键：用于记住用户拖拽后的宽度。
  widthStorageKey: string;
  // 输入框默认宽度。
  defaultWidth: number;
  // 输入框最小宽度。
  minWidth?: number;
  // 输入框最大宽度。
  maxWidth?: number;
  // 是否显示清空按钮。
  allowClear?: boolean;
};

type TokenRange = {
  // 当前词起始位置。
  start: number;
  // 当前词结束位置。
  end: number;
  // 当前词文本。
  token: string;
};

const TOKEN_PATTERN = /[A-Za-z0-9_$.]/;
const SUGGESTION_LIMIT = 12;

// MySQL 智能输入：支持宽度拖拽 + 自动补全。
export function MysqlSmartInput({
  label,
  value,
  placeholder,
  onChange,
  suggestions,
  widthStorageKey,
  defaultWidth,
  minWidth = 220,
  maxWidth = 640,
  allowClear = false
}: MysqlSmartInputProps) {
  // 文本域引用：用于读取/设置光标位置。
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // 根容器引用：用于点击外部关闭补全。
  const rootRef = useRef<HTMLDivElement | null>(null);
  // 是否显示候选弹层。
  const [open, setOpen] = useState(false);
  // 当前激活候选索引。
  const [activeIndex, setActiveIndex] = useState(0);
  // 当前光标位置。
  const [caret, setCaret] = useState(0);
  // 拖拽状态。
  const [dragging, setDragging] = useState(false);
  // 宽度状态：优先读取本地缓存。
  const [width, setWidth] = useState(() => {
    const raw = window.localStorage.getItem(widthStorageKey);
    const parsed = raw ? Number(raw) : Number.NaN;
    if (!Number.isFinite(parsed)) return defaultWidth;
    return Math.max(minWidth, Math.min(maxWidth, parsed));
  });
  // 拖拽起始点 X。
  const resizeStartXRef = useRef(0);
  // 拖拽起始宽度。
  const resizeStartWidthRef = useRef(defaultWidth);

  // 补全候选去重：忽略大小写。
  const normalizedSuggestions = useMemo(() => {
    const next: string[] = [];
    const seen = new Set<string>();
    suggestions.forEach((item) => {
      const text = item.trim();
      if (!text) return;
      const key = text.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      next.push(text);
    });
    return next;
  }, [suggestions]);

  // 计算当前光标所在 token。
  const tokenRange = useMemo(() => getTokenRange(value, caret), [value, caret]);

  // 根据 token 计算候选列表。
  const filteredSuggestions = useMemo(() => {
    const token = tokenRange.token.trim().toLowerCase();
    if (!token) return normalizedSuggestions.slice(0, SUGGESTION_LIMIT);
    const startsWith = normalizedSuggestions.filter((item) => item.toLowerCase().startsWith(token));
    const includes = normalizedSuggestions.filter((item) => !item.toLowerCase().startsWith(token) && item.toLowerCase().includes(token));
    return [...startsWith, ...includes].slice(0, SUGGESTION_LIMIT);
  }, [normalizedSuggestions, tokenRange.token]);

  // 候选变化时重置激活项，避免越界。
  useEffect(() => {
    setActiveIndex(0);
  }, [filteredSuggestions.length]);

  // 同步持久化宽度。
  useEffect(() => {
    window.localStorage.setItem(widthStorageKey, String(width));
  }, [width, widthStorageKey]);

  // 点击外部关闭补全弹层。
  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (rootRef.current.contains(event.target as Node)) return;
      setOpen(false);
    };

    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, []);

  // 拖拽宽度逻辑。
  useEffect(() => {
    if (!dragging) return;

    const onMouseMove = (event: MouseEvent) => {
      const deltaX = event.clientX - resizeStartXRef.current;
      const next = resizeStartWidthRef.current + deltaX;
      setWidth(Math.max(minWidth, Math.min(maxWidth, next)));
    };

    const onMouseUp = () => {
      setDragging(false);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };

    document.body.style.userSelect = "none";
    document.body.style.cursor = "ew-resize";
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [dragging, minWidth, maxWidth]);

  // 插入候选词：替换当前 token，并恢复光标位置。
  function applySuggestion(item: string) {
    const nextValue = `${value.slice(0, tokenRange.start)}${item}${value.slice(tokenRange.end)}`;
    const nextCaret = tokenRange.start + item.length;
    onChange(nextValue);
    setOpen(false);
    setCaret(nextCaret);
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(nextCaret, nextCaret);
    });
  }

  // 统一同步光标位置，保证补全范围准确。
  function syncCaretFromTarget(target: HTMLTextAreaElement) {
    setCaret(target.selectionStart || 0);
  }

  // 键盘交互：支持上下选择、回车/Tab 确认、Esc 关闭。
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      if (!open || filteredSuggestions.length === 0) return;
      applySuggestion(filteredSuggestions[activeIndex]);
      return;
    }

    if (event.key === "Tab" && open && filteredSuggestions.length > 0) {
      event.preventDefault();
      applySuggestion(filteredSuggestions[activeIndex]);
      return;
    }

    if (event.key === "Escape") {
      setOpen(false);
      return;
    }

    if (event.key === "ArrowDown" && open && filteredSuggestions.length > 0) {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % filteredSuggestions.length);
      return;
    }

    if (event.key === "ArrowUp" && open && filteredSuggestions.length > 0) {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + filteredSuggestions.length) % filteredSuggestions.length);
      return;
    }

    if (event.key === " " && event.ctrlKey) {
      event.preventDefault();
      setOpen(true);
    }
  }

  return (
    // 外层容器：宽度可调整。
    <div ref={rootRef} className="relative shrink-0" style={{ width }}>
      {/* 输入框标题。 */}
      <label className="mb-1 block text-[12px]">{label}</label>
      {/* 输入框主体。 */}
      <div className="relative">
        {/* 单行文本域：保留横向滚动能力，避免自动换行影响 SQL 片段输入。 */}
        <textarea
          ref={textareaRef}
          className="textarea textarea-bordered textarea-sm h-[38px] min-h-[38px] w-full resize-none overflow-x-auto overflow-y-hidden whitespace-nowrap pr-8 leading-[20px]"
          value={value}
          placeholder={placeholder}
          rows={1}
          wrap="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          onFocus={(event) => {
            syncCaretFromTarget(event.currentTarget);
            setOpen(true);
          }}
          onClick={(event) => {
            syncCaretFromTarget(event.currentTarget);
          }}
          onKeyUp={(event) => {
            syncCaretFromTarget(event.currentTarget);
          }}
          onKeyDown={onKeyDown}
          onChange={(event) => {
            const nextValue = event.target.value;
            onChange(nextValue);
            syncCaretFromTarget(event.target);
            setOpen(true);
          }}
        />

        {/* 清空按钮：用于快速清空输入。 */}
        {allowClear && value ? (
          <button
            className="btn btn-circle btn-ghost btn-xs absolute right-1 top-1/2 -translate-y-1/2"
            aria-label={`清空${label}`}
            onClick={() => onChange("")}
          >
            <X size={13} />
          </button>
        ) : null}

        {/* 宽度拖拽把手：按下后可水平调整输入框宽度。 */}
        <div
          className="absolute -right-1 top-1/2 z-20 h-6 w-2 -translate-y-1/2 cursor-ew-resize rounded bg-base-300/70"
          role="separator"
          aria-orientation="vertical"
          aria-label={`${label}输入框宽度调节`}
          onMouseDown={(event) => {
            event.preventDefault();
            resizeStartXRef.current = event.clientX;
            resizeStartWidthRef.current = width;
            setDragging(true);
          }}
        />
      </div>

      {/* 自动补全弹层。 */}
      {open && filteredSuggestions.length > 0 ? (
        <div className="absolute z-[70] mt-1 max-h-56 w-full overflow-auto rounded border border-base-300 bg-base-100 p-1 shadow-xl">
          {filteredSuggestions.map((item, index) => (
            <button
              key={`${item}-${index}`}
              className={`btn btn-ghost btn-xs mb-0.5 w-full justify-start text-left normal-case ${index === activeIndex ? "bg-base-200" : ""}`}
              onMouseDown={(event) => {
                event.preventDefault();
                applySuggestion(item);
              }}
              onMouseEnter={() => {
                setActiveIndex(index);
              }}
            >
              {item}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// 计算光标附近 token 范围：用于替换当前词。
function getTokenRange(text: string, caret: number): TokenRange {
  const safeCaret = Math.max(0, Math.min(caret, text.length));
  let start = safeCaret;
  let end = safeCaret;

  while (start > 0 && TOKEN_PATTERN.test(text[start - 1])) {
    start -= 1;
  }

  while (end < text.length && TOKEN_PATTERN.test(text[end])) {
    end += 1;
  }

  return {
    start,
    end,
    token: text.slice(start, end)
  };
}

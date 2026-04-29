import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  filterSmartInputSuggestions,
  getSmartInputTokenRange,
  resolveSmartInputEnterAction,
  resolveSmartInputWidth,
  shouldOpenSmartInputSuggestions
} from "../logic/smartInput";

type SalesforceSmartInputProps = {
  // 输入框标题（例如 WHERE）。
  label: string;
  // 当前输入值。
  value: string;
  // 占位文案。
  placeholder?: string;
  // 输入值变化回调。
  onChange: (value: string) => void;
  // 自动补全候选词。
  suggestions: string[];
  // 输入框默认宽度。
  defaultWidth: number;
  // 输入框最小宽度。
  minWidth?: number;
  // 输入框最大宽度。
  maxWidth?: number;
  // 是否显示清空按钮。
  allowClear?: boolean;
  // 回车提交：用于在 QueryBar 中触发统一查询动作。
  onSubmit?: () => void;
};

// Token 识别规则：支持字段名、关系字段、SOQL 日期字面量（含冒号）。
const TOKEN_PATTERN = /[A-Za-z0-9_$.:]/;

// Salesforce 智能输入：支持内容自适应宽度与自动补全。
export function SalesforceSmartInput({
  label,
  value,
  placeholder,
  onChange,
  suggestions,
  defaultWidth,
  minWidth = 220,
  maxWidth = 640,
  allowClear = false,
  onSubmit
}: SalesforceSmartInputProps) {
  // 输入框引用：用于读取/设置光标位置。
  const inputRef = useRef<HTMLInputElement | null>(null);
  // 测量节点引用：用于计算输入内容的真实像素宽度。
  const measureRef = useRef<HTMLSpanElement | null>(null);
  // 根容器引用：用于点击外部关闭补全。
  const rootRef = useRef<HTMLDivElement | null>(null);
  // 是否显示候选弹层。
  const [open, setOpen] = useState(false);
  // 当前激活候选索引。
  const [activeIndex, setActiveIndex] = useState(0);
  // 当前光标位置。
  const [caret, setCaret] = useState(0);
  // 宽度状态：仅保留当前组件生命周期，不做本地持久化。
  const [width, setWidth] = useState(defaultWidth);
  // 手动唤起状态：用于支持 Ctrl+Space 在空输入时展示候选。
  const [manualTrigger, setManualTrigger] = useState(false);
  // 显式选择状态：只有方向键移动过候选时，回车才执行补全。
  const [hasExplicitSelection, setHasExplicitSelection] = useState(false);

  // 计算当前光标所在 token。
  const tokenRange = useMemo(() => getSmartInputTokenRange(value, caret, TOKEN_PATTERN), [value, caret]);

  // 根据 token 计算候选列表。
  const filteredSuggestions = useMemo(() => {
    return filterSmartInputSuggestions({
      suggestions,
      token: tokenRange.token
    });
  }, [suggestions, tokenRange.token]);

  // 候选变化或面板关闭时重置激活项，避免误把旧高亮带到下一轮交互。
  useEffect(() => {
    setActiveIndex(0);
    setHasExplicitSelection(false);
  }, [filteredSuggestions.length, open, value]);

  // 点击外部关闭补全弹层。
  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (rootRef.current.contains(event.target as Node)) return;
      setOpen(false);
      setManualTrigger(false);
      setHasExplicitSelection(false);
    };

    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, []);

  // 根据内容实时计算宽度：长内容扩张、短内容收缩，并受最大宽度保护。
  useEffect(() => {
    const measureNode = measureRef.current;
    const input = inputRef.current;
    if (!measureNode || !input) return;
    const computedStyle = window.getComputedStyle(input);
    measureNode.style.font = computedStyle.font;
    measureNode.style.letterSpacing = computedStyle.letterSpacing;
    const nextWidth = resolveSmartInputWidth({
      value,
      placeholder,
      defaultWidth,
      minWidth,
      maxWidth,
      allowClear,
      measureText: (text) => {
        measureNode.textContent = text || " ";
        return measureNode.offsetWidth;
      }
    });
    setWidth(nextWidth);
  }, [allowClear, defaultWidth, maxWidth, minWidth, placeholder, value]);

  // 插入候选词：替换当前 token，并恢复光标位置。
  function applySuggestion(item: string) {
    const nextValue = `${value.slice(0, tokenRange.start)}${item}${value.slice(tokenRange.end)}`;
    const nextCaret = tokenRange.start + item.length;
    onChange(nextValue);
    setOpen(false);
    setManualTrigger(false);
    setHasExplicitSelection(false);
    setCaret(nextCaret);
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(nextCaret, nextCaret);
    });
  }

  // 统一同步光标位置，保证补全范围准确。
  function syncCaretFromTarget(target: HTMLInputElement) {
    setCaret(target.selectionStart || 0);
  }

  // 键盘交互：支持上下选择、回车/Tab 确认、Esc 关闭。
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      const action = resolveSmartInputEnterAction({
        open,
        suggestionCount: filteredSuggestions.length,
        hasExplicitSelection
      });
      if (action === "apply-suggestion" && filteredSuggestions.length > 0) {
        applySuggestion(filteredSuggestions[activeIndex]);
        return;
      }
      setOpen(false);
      setManualTrigger(false);
      setHasExplicitSelection(false);
      onSubmit?.();
      return;
    }

    if (event.key === "Tab" && open && filteredSuggestions.length > 0) {
      event.preventDefault();
      applySuggestion(filteredSuggestions[activeIndex]);
      return;
    }

    if (event.key === "Escape") {
      setOpen(false);
      setManualTrigger(false);
      setHasExplicitSelection(false);
      return;
    }

    if (event.key === "ArrowDown" && open && filteredSuggestions.length > 0) {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % filteredSuggestions.length);
      setHasExplicitSelection(true);
      return;
    }

    if (event.key === "ArrowUp" && open && filteredSuggestions.length > 0) {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + filteredSuggestions.length) % filteredSuggestions.length);
      setHasExplicitSelection(true);
      return;
    }

    if (event.key === " " && event.ctrlKey) {
      event.preventDefault();
      setManualTrigger(true);
      setOpen(true);
    }
  }

  return (
    // 外层容器：宽度跟随内容自适应。
    <div ref={rootRef} className="relative shrink-0" style={{ width }}>
      {/* 隐藏测量节点：用于以真实字体样式计算文本宽度。 */}
      <span ref={measureRef} className="pointer-events-none absolute left-0 top-0 invisible whitespace-pre text-sm leading-[20px]" aria-hidden="true" />
      {/* 输入框标题。 */}
      <label className="mb-1 block text-[12px]">{label}</label>
      {/* 输入框主体。 */}
      <div className="relative">
        {/* 单行输入框：保留自动补全与光标 token 替换，placeholder 垂直居中。 */}
        <input
          ref={inputRef}
          className="input input-bordered input-sm h-[38px] min-h-[38px] w-full pr-8 leading-[20px]"
          value={value}
          placeholder={placeholder}
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          onFocus={(event) => {
            syncCaretFromTarget(event.currentTarget); // 聚焦时同步光标，避免替换范围错误。
          }}
          onClick={(event) => {
            syncCaretFromTarget(event.currentTarget); // 点击后更新光标位置。
          }}
          onKeyUp={(event) => {
            syncCaretFromTarget(event.currentTarget); // 键盘移动光标后同步位置。
          }}
          onKeyDown={onKeyDown}
          onChange={(event) => {
            const nextValue = event.target.value;
            const nextCaret = event.target.selectionStart || 0;
            const nextTokenRange = getSmartInputTokenRange(nextValue, nextCaret, TOKEN_PATTERN);
            onChange(nextValue);
            syncCaretFromTarget(event.target); // 输入后同步光标，保证 token 计算准确。
            setManualTrigger(false); // 行内注释：普通输入后退出手动唤起模式，回到输入驱动提示。
            setHasExplicitSelection(false); // 行内注释：输入变化后重置显式候选选择状态。
            setOpen(
              shouldOpenSmartInputSuggestions({
                value: nextValue,
                token: nextTokenRange.token,
                manualTrigger: false,
                suggestionCount: filterSmartInputSuggestions({
                  suggestions,
                  token: nextTokenRange.token
                }).length
              })
            ); // 行内注释：只有当前 token 非空时才展示候选，空格后的停顿不打断输入。
          }}
        />

        {/* 清空按钮：用于快速清空输入。 */}
        {allowClear && value ? (
          <button
            className="btn btn-circle btn-ghost btn-xs absolute right-1 top-1/2 -translate-y-1/2"
            aria-label={`清空${label}`}
            onClick={() => {
              onChange(""); // 行内注释：清空后立即同步外部草稿值。
              setOpen(false); // 行内注释：清空后关闭候选，避免展示无意义浮层。
              setManualTrigger(false); // 行内注释：清空后重置手动唤起状态。
              setHasExplicitSelection(false); // 行内注释：清空后清除显式候选选择状态。
            }}
          >
            <X size={13} />
          </button>
        ) : null}
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
                applySuggestion(item); // 用鼠标选择候选时直接完成替换。
              }}
              onMouseEnter={() => {
                setActiveIndex(index); // 悬停时同步高亮项，便于回车确认。
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

import { X } from "lucide-react";
import { useMemo } from "react";

// 通知级别：对齐 daisyUI 的 alert 语义类型。
export type NoticeTone = "info" | "success" | "warning" | "error";

type NoticeAlertProps = {
  // 通知级别：决定 alert 的颜色风格。
  tone: NoticeTone;
  // 通知文案：展示核心反馈内容。
  message: string;
  // 关闭回调：用于外部清理通知状态。
  onClose?: () => void;
  // 额外样式类：允许在不同容器内微调定位与层级。
  className?: string;
};

// 通知样式 Hook：统一维护 tone 到 class 的映射。
export function useNoticeToneClass(tone: NoticeTone): string {
  return useMemo(() => {
    const map: Record<NoticeTone, string> = {
      info: "alert-info",
      success: "alert-success",
      warning: "alert-warning",
      error: "alert-error"
    };
    return map[tone];
  }, [tone]);
}

// 通知浅色样式 Hook：统一覆盖为更接近官网的浅色视觉。
export function useNoticeSoftClass(tone: NoticeTone): string {
  return useMemo(() => {
    const map: Record<NoticeTone, string> = {
      info: "border-info/30 bg-info/10 text-info",
      success: "border-success/30 bg-success/10 text-success",
      warning: "border-warning/30 bg-warning/12 text-warning",
      error: "border-error/30 bg-error/10 text-error"
    };
    return map[tone];
  }, [tone]);
}

// 统一通知组件：使用 daisyUI `alert alert-soft` 风格并内置圆角 icon 关闭按钮。
export function NoticeAlert({ tone, message, onClose, className = "" }: NoticeAlertProps) {
  // 颜色类：根据通知级别动态选择。
  const toneClass = useNoticeToneClass(tone);
  // 浅色覆盖类：确保通知呈现更轻量的浅色背景。
  const softClass = useNoticeSoftClass(tone);

  return (
    // Alert 容器：使用软风格通知样式。
    <div
      role="alert"
      className={`alert alert-soft inline-flex w-fit max-w-[420px] items-start gap-2 border ${toneClass} ${softClass} ${className}`}
    >
      {/* 通知文案。 */}
      <span className="min-w-0 flex-1 whitespace-normal break-words text-[12px] leading-5 text-current">{message}</span>
      {onClose ? (
        // 关闭按钮：圆角 icon-only 按钮。
        <button className="btn btn-circle btn-ghost btn-xs ml-auto shrink-0 text-current" aria-label="关闭通知" onClick={onClose}>
          <X size={14} />
        </button>
      ) : null}
    </div>
  );
}

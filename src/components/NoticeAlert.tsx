import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
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

// 通知配色 Hook：按当前软件蓝系主题统一通知颜色。
export function useNoticePaletteClass(tone: NoticeTone): string {
  return useMemo(() => {
    const map: Record<NoticeTone, string> = {
      info: "border border-brand-300 bg-brand-50 text-brand-800",
      success: "border border-[#b8e3c8] bg-[#edf9f2] text-[#1f6b3b]",
      warning: "border border-[#f2d9a6] bg-[#fff8ea] text-[#8a5a00]",
      error: "border border-[#f3c2c2] bg-[#fff1f1] text-[#8b2a2a]"
    };
    return map[tone];
  }, [tone]);
}

// 通知图标 Hook：按通知级别映射对应语义图标。
export function useNoticeIcon(tone: NoticeTone) {
  return useMemo(() => {
    const map: Record<NoticeTone, typeof Info> = {
      info: Info,
      success: CheckCircle2,
      warning: AlertTriangle,
      error: XCircle
    };
    return map[tone];
  }, [tone]);
}

// 统一通知组件：使用 daisyUI `alert alert-{tone}` 风格并内置圆角 icon 关闭按钮。
export function NoticeAlert({ tone, message, onClose, className = "" }: NoticeAlertProps) {
  // 配色类：根据通知级别动态选择当前主题下的浅色样式。
  const paletteClass = useNoticePaletteClass(tone);
  // 图标组件：根据通知级别选择图标。
  const ToneIcon = useNoticeIcon(tone);

  return (
    // Alert 容器：标准 daisyUI 通知样式。
    <div role="alert" className={`alert inline-flex w-fit max-w-[420px] items-start gap-2 shadow-sm ${paletteClass} ${className}`}>
      {/* 通知类型图标。 */}
      <ToneIcon className="h-6 w-6 shrink-0 stroke-current" />
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

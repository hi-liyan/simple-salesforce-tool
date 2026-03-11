
type MonacoEditorLoadingFallbackProps = {
  // 编辑器占位高度：与业务侧传入高度保持一致，避免布局跳动。
  height?: string;
};

// Monaco 编辑器加载占位：在动态加载编辑器代码期间提供稳定反馈。
export function MonacoEditorLoadingFallback({ height = "220px" }: MonacoEditorLoadingFallbackProps) {
  return (
    // 占位容器：复用编辑器区域尺寸，避免懒加载时界面闪动。
    <div className="flex w-full items-center justify-center border border-base-300 bg-base-100" style={{ height }}>
      {/* 占位文案：提示用户编辑器模块正在按需加载。 */}
      <div className="flex items-center gap-2 text-[12px] text-neutral/70">
        {/* 旋转动画：与系统其它 loading 视觉保持一致。 */}
        <span className="loading loading-spinner loading-sm" />
        {/* 当前动作说明。 */}
        <span>正在加载编辑器...</span>
      </div>
    </div>
  );
}

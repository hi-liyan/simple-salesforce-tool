import {
  formatFieldMetadataValue,
  sortFieldMetadataEntries,
  translateFieldMetadataKey
} from "../../../utils/fieldMetadata";
import { HoveredHeaderMetaState } from "../types";

type HeaderMetaPopoverProps = {
  // 当前表头元数据浮层状态；为空时由父组件控制不渲染。
  hoveredHeaderMeta: HoveredHeaderMetaState;
  // 鼠标进入浮层时回调：用于取消延迟关闭。
  onMouseEnter: () => void;
  // 鼠标离开浮层时回调：用于触发延迟关闭。
  onMouseLeave: () => void;
};

// 表头字段元数据浮层：统一承载字段属性展示，便于主组件保持清晰。
export function HeaderMetaPopover({
  hoveredHeaderMeta,
  onMouseEnter,
  onMouseLeave
}: HeaderMetaPopoverProps) {
  return (
    <div
      className="fixed z-[120] max-h-[320px] w-[420px] overflow-auto rounded border p-1.5"
      style={{
        // 使用 fixed + viewport 坐标，避免父容器偏移导致的错位问题。
        left: Math.min(
          Math.max(8, hoveredHeaderMeta.anchorClientX - 210),
          Math.max(8, window.innerWidth - 420 - 8)
        ),
        top: Math.min(
          Math.max(8, hoveredHeaderMeta.anchorClientY + 8),
          Math.max(8, window.innerHeight - 320 - 8)
        ),
        backgroundColor: "#223047",
        borderColor: "#3a557f",
        boxShadow: "0 10px 28px rgba(15, 23, 42, 0.35)",
        pointerEvents: "auto"
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* 元数据标题：展示当前字段名。 */}
      <p className="mb-1 block text-[12px] font-bold text-white">
        {hoveredHeaderMeta.fieldName} 字段元数据
      </p>
      {/* 元数据明细：逐条输出字段属性键值，便于核对权限与类型。 */}
      <div className="pr-0.5">
        {sortFieldMetadataEntries(hoveredHeaderMeta.metadata).map(([key, value]) => (
          <p
            key={key}
            className="block text-[12px] leading-[1.5]"
            style={{ color: "#dbe7ff", fontFamily: "'Cascadia Mono', Consolas, 'Courier New', monospace" }}
          >
            {translateFieldMetadataKey(key)}: {formatFieldMetadataValue(value)}
          </p>
        ))}
      </div>
    </div>
  );
}

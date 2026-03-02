import { GridCell, TextCell } from "@glideapps/glide-data-grid";
import { resolvePicklistDisplayText } from "../utils/picklist";
import { normalizeSelectValue } from "../utils/value";

type GlideEditorProps = {
  value: GridCell;
  target: { width: number };
  onChange: (newValue: GridCell) => void;
  onFinishedEditing: (
    newValue?: GridCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1]
  ) => void;
};

type SelectEditorProps = {
  // Glide 提供的编辑器上下文参数。
  editorProps: GlideEditorProps;
  // 下拉选项。
  options: { label: string; value: string }[];
};

// Select 编辑器：用于 picklist/boolean 类型。
export function SelectEditor({ editorProps, options }: SelectEditorProps) {
  const textValue = editorProps.value as TextCell;
  const currentText = String(textValue.data ?? "");

  return (
    <select
      autoFocus
      className="select select-bordered select-sm w-full bg-base-100"
      style={{ minWidth: Math.max(editorProps.target.width, 180) }}
      value={normalizeSelectValue(currentText, options)}
      onBlur={() => editorProps.onFinishedEditing(undefined, [0, 0])}
      onChange={(event) => {
        const next = String(event.target.value);
        const displayText = resolvePicklistDisplayText(next, options);
        const nextCell: TextCell = {
          ...textValue,
          data: next,
          displayData: displayText
        };
        editorProps.onChange(nextCell); // 同步更新 Glide overlay 内的草稿值。
        editorProps.onFinishedEditing(nextCell, [0, 0]); // 立即提交并关闭编辑器。
      }}
    >
      {options.map((item) => (
        <option key={item.value} value={item.value}>
          {item.label}
        </option>
      ))}
    </select>
  );
}

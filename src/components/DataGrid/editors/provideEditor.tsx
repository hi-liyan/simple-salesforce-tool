import React from "react";
import { DataEditor, GridCellKind, GridColumn, Item } from "@glideapps/glide-data-grid";
import { DateTimeEditor } from "./dateTimeEditor";
import { SelectEditor } from "./selectEditor";
import { getPicklistEditorOptions } from "../utils/picklist";
import { resolveFieldTypeStrategy } from "../logic/fieldTypeStrategy";

type DataEditorProvideEditor = NonNullable<React.ComponentProps<typeof DataEditor>["provideEditor"]>;

type CreateProvideEditorParams = {
  // 当前激活单元格：用于反查当前编辑字段。
  activeEditorCell: Item | null;
  // 当前激活单元格 ref：避免 setState 异步导致读取旧值。
  activeEditorCellRef: React.MutableRefObject<Item | null>;
  // 列定义：用于将索引映射为字段名。
  columns: GridColumn[];
  // 字段元数据：用于推断编辑器类型。
  fieldMetadataMap: Record<string, Record<string, unknown>>;
  // Salesforce 用户时区。
  effectiveSalesforceTimezone: string | null;
  // 用户提示回调。
  onShowMessage: (message: string) => void;
};

// 构建 Glide 自定义编辑器分发器：按字段类型分发到 select/date/datetime 编辑器。
export function createProvideEditor({
  activeEditorCell,
  activeEditorCellRef,
  columns,
  fieldMetadataMap,
  effectiveSalesforceTimezone,
  onShowMessage
}: CreateProvideEditorParams): DataEditorProvideEditor {
  return (cell) => {
    const editorCell = activeEditorCellRef.current || activeEditorCell;
    if (!editorCell) return undefined;
    if (cell.kind !== GridCellKind.Text) return undefined;

    const [col] = editorCell;
    const columnId = String(columns[col]?.id ?? "");
    if (!columnId || columnId.startsWith("__")) return undefined;

    const metadata = fieldMetadataMap[columnId] || {};
    const strategy = resolveFieldTypeStrategy(metadata);

    // picklist/boolean 使用下拉；date/datetime 使用 Salesforce 风格日历面板。
    let editorKind: "select" | "date" | "datetime-local" | null = null;
    let options: { label: string; value: string }[] = [];
    if (strategy === "picklist") {
      editorKind = "select";
      options = getPicklistEditorOptions(metadata);
    } else if (strategy === "boolean") {
      editorKind = "select";
      options = [
        { label: "true", value: "true" },
        { label: "false", value: "false" }
      ];
    } else if (strategy === "date") {
      editorKind = "date";
    } else if (strategy === "datetime") {
      editorKind = "datetime-local";
    } else {
      return undefined;
    }

    return (props) => {
      return editorKind === "select" ? (
        <SelectEditor editorProps={props} options={options} />
      ) : (
        <DateTimeEditor
          editorProps={props}
          columnId={columnId}
          editorKind={editorKind}
          nillable={metadata.nillable === true}
          effectiveSalesforceTimezone={effectiveSalesforceTimezone}
          onShowMessage={onShowMessage}
        />
      );
    };
  };
}

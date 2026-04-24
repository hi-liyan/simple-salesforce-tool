import { isCellEditableByMeta } from "../utils/field.ts";

type ResolveRowContextMenuCapabilitiesInput = {
  // 当前数据源类型：用于区分 Salesforce/MySQL 行为。
  selectedSourceType?: string;
  // 当前字段元数据。
  metadata: Record<string, unknown>;
  // 当前命中的是否为新建行。
  isNewRow: boolean;
  // 当前命中的是否为业务字段列。
  isDataColumn: boolean;
};

type RowContextMenuCapabilities = {
  // 是否允许执行 Set None / Set Null。
  canSetNullish: boolean;
  // 空值动作文案。
  nullishActionLabel: "Set None" | "Set Null" | "";
  // 是否允许执行 Set 默认值。
  canSetDefaultValue: boolean;
  // 默认值动作文案。
  defaultValueActionLabel: "Set 默认值" | "";
  // 默认值动作提交语义。
  defaultValueMode: "mysql-default" | "";
};

// 可空性判定：兼容 Salesforce 的 nillable 与 MySQL 常见 nullable/isNullable 元数据键。
function isNullableField(metadata: Record<string, unknown>): boolean {
  if (metadata.nillable === true) return true;
  if (metadata.nullable === true) return true;
  if (metadata.isNullable === true) return true;
  const rawIsNullable = metadata.IS_NULLABLE;
  if (typeof rawIsNullable === "string" && rawIsNullable.trim().toUpperCase() === "YES") return true;
  return false;
}

// 判断当前字段是否声明了 MySQL 列默认值；空字符串默认值也视为“存在默认值”。
function hasMysqlColumnDefault(metadata: Record<string, unknown>): boolean {
  return metadata.columnDefault !== null && metadata.columnDefault !== undefined;
}

// 统一推导行右键菜单能力，避免渲染层散落条件分支。
export function resolveRowContextMenuCapabilities({
  selectedSourceType,
  metadata,
  isNewRow,
  isDataColumn
}: ResolveRowContextMenuCapabilitiesInput): RowContextMenuCapabilities {
  const isMysqlSource = (selectedSourceType || "salesforce").toLowerCase() === "mysql";
  const editable = isDataColumn && isCellEditableByMeta(metadata, isNewRow);
  const canSetNullish = editable && isNullableField(metadata);
  const canSetDefaultValue = editable && isMysqlSource && hasMysqlColumnDefault(metadata);

  return {
    canSetNullish,
    nullishActionLabel: canSetNullish ? (isMysqlSource ? "Set Null" : "Set None") : "",
    canSetDefaultValue,
    defaultValueActionLabel: canSetDefaultValue ? "Set 默认值" : "",
    defaultValueMode: canSetDefaultValue ? "mysql-default" : ""
  };
}

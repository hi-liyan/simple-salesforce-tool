import { getDataSourceDriver } from "../../../drivers/registry.ts";

// DataGrid 字段策略类型：统一映射不同字段到独立处理分支。
export type FieldTypeStrategy = "picklist" | "date" | "datetime" | "number" | "boolean" | "text";

// 根据字段元数据解析策略类型（统一收敛至当前数据源的 GridAdapter）。
export function resolveFieldTypeStrategy(
  metadata: Record<string, unknown>,
  selectedSourceType?: string
): FieldTypeStrategy {
  return getDataSourceDriver(selectedSourceType).gridAdapter.resolveFieldStrategy(metadata);
}

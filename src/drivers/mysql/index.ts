import type { DataSourceDriver } from "../types.ts";
import {
  createMysqlDraftDefaultValue,
  createMysqlDraftNullValue,
  createMysqlDraftOmitValue,
  createMysqlDraftValue,
  isMysqlBlankValue,
  resolveMysqlDisplayValue
} from "../../features/main/QueryPanel/logic/mysqlValueSemantics.ts";
import { normalizeMysqlDatetimeValueForSave } from "../../components/DataGrid/utils/datetime.ts";
import { stringifyCellValue } from "../../components/DataGrid/utils/value.ts";

// MySQL 前端数据源驱动。
export const mysqlDriver: DataSourceDriver = {
  kind: "mysql",
  displayName: "MySQL",
  badgeLabel: "MySQL",
  badgeClassName: "bg-amber-500/12 text-amber-700 border border-amber-500/20",
  defaultConfig: { port: 3306, charset: "utf8mb4" },
  capabilities: {
    queryLanguage: "mysql",
    supportsDdl: true,
    supportsMutationPreview: true,
    supportsTransactionalBatch: true,
    supportsAuthWindow: false,
    defaultDrawerView: "mysql-fields"
  },
  gridAdapter: {
    nullPlaceholder: "Null",
    nullishActionLabel: "Set Null",
    supportsDefaultValueAction: true,
    omitEmptyOnNewRow: true,
    resolvePrimaryKeyField: (fieldMetadataMap) => {
      const entry = Object.entries(fieldMetadataMap).find(
        ([, metadata]) => String(metadata?.columnKey || "").toUpperCase() === "PRI"
      );
      return entry?.[0] || "";
    },
    resolveRecordKey: (record, primaryKeyField) => {
      if (primaryKeyField && record[primaryKeyField] !== undefined && record[primaryKeyField] !== null) {
        return String(record[primaryKeyField]);
      }
      return String(record.Id ?? "");
    },
    codec: {
      encodeNull: () => createMysqlDraftNullValue(),
      encodeDefault: () => createMysqlDraftDefaultValue(),
      encodeOmit: () => createMysqlDraftOmitValue(),
      encodeValue: (val) => createMysqlDraftValue(val)
    },
    resolveDisplayValue: (raw, metadata) => resolveMysqlDisplayValue(raw, metadata),
    isBlankValue: (raw) => isMysqlBlankValue(raw),
    normalizeDatetimeForSave: (value) => normalizeMysqlDatetimeValueForSave(value),
    formatDateDisplay: (value) => stringifyCellValue(value),
    formatDatetimeDisplay: (value) => stringifyCellValue(value),
    resolveFieldStrategy: (meta) => {
      const t = String(meta.dataType || meta.type || "").toLowerCase();
      if (t === "enum" || t === "set") return "picklist";
      if (t === "date") return "date";
      if (t === "datetime" || t === "timestamp") return "datetime";
      if (t === "boolean" || t === "tinyint(1)") return "boolean";
      const columnType = String(meta.columnType || "").toLowerCase();
      if (columnType.includes("bigint") && columnType.includes("unsigned")) return "text";
      if (["int", "bigint", "smallint", "tinyint", "decimal", "float", "double"].some((k) => t.includes(k))) {
        return "number";
      }
      return "text";
    },
    supportsOpenRecordPage: false
  },
  hydrateSourceSecrets: (source, secretView) => ({
    ...source,
    configJson: {
      ...(source.configJson || {}),
      password: secretView.password || ""
    }
  }),
  defaultTreeGroups: [
    { groupType: "tables", label: "tables" },
    { groupType: "collations", label: "collations" },
    { groupType: "users", label: "users" },
    { groupType: "virtual-views", label: "virtual views" }
  ]
};

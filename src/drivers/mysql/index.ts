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
    supportsExplain: true,
    supportsMultiStatement: true,
    supportsMutationPreview: true,
    supportsTransactionalBatch: true,
    supportsAuthWindow: false,
    defaultDrawerView: "mysql-fields"
  },
  treeConfig: {
    useGroupNodes: true,
    groups: [
      { groupType: "tables", label: "tables" },
      { groupType: "collations", label: "collations" },
      { groupType: "users", label: "users" },
      { groupType: "virtual-views", label: "virtual views" }
    ],
    supportsColumnExpansion: true
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
      const t = String(meta.mysqlDataType || meta.dataType || meta.type || "").trim().toLowerCase();
      if ((t === "enum" || t === "set") && Array.isArray(meta.picklistValues) && meta.picklistValues.length > 0) {
        return "picklist";
      }
      if (t === "date") return "date";
      if (t === "datetime" || t === "timestamp") return "datetime";
      if (t === "boolean" || t === "bool") return "boolean";
      const columnType = String(meta.columnType || "").toLowerCase();
      // DECIMAL / NUMERIC 与 BIGINT（含 signed/unsigned）可能超出 JS Number 安全整数或包含尾随零，统一按文本展示保真。
      if (t === "decimal" || t === "numeric" || t === "newdecimal") return "text";
      if (t === "bigint" || columnType.startsWith("bigint")) return "text";
      if (["tinyint", "smallint", "mediumint", "int", "integer", "float", "double", "real", "year"].includes(t)) {
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

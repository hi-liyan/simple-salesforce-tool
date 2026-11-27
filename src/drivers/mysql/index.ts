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
    supportsTableDesigner: true,
    supportsBackup: true,
    supportsExplain: true,
    supportsMultiStatement: true,
    supportsMutationPreview: true,
    supportsTransactionalBatch: true,
    supportsAuthWindow: false,
    supportsInteractiveTransaction: true,
    defaultDrawerView: "mysql-fields"
  },
  treeConfig: {
    useGroupNodes: true,
    groups: [
      { groupType: "tables", label: "tables" },
      { groupType: "views", label: "views" },
      { groupType: "routines", label: "routines" },
      { groupType: "triggers", label: "triggers" },
      { groupType: "events", label: "events" },
      { groupType: "collations", label: "collations" },
      { groupType: "users", label: "users" },
      { groupType: "virtual-views", label: "virtual views" }
    ],
    supportsColumnExpansion: true,
    objectSubFolders: ["columns", "keys", "indexes"]
  },
  gridAdapter: {
    sourceKind: "mysql",
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
    resolveHeaderDisplayLines: (fieldName, metadata, runtimeType) => {
      // MySQL 表头第二行优先展示精确 columnType，其次回退 mysqlDataType/type/运行时类型。
      const rawType = [metadata.columnType, metadata.mysqlDataType, metadata.type, runtimeType]
        .find((item) => typeof item === "string" && item.trim().length > 0);
      const trimmedType = typeof rawType === "string" ? rawType.trim() : "";
      const typeText = trimmedType
        ? (/^enum\s*\(/i.test(trimmedType) ? "enum" : trimmedType)
        : null;
      // MySQL 表头第三行展示字段注释（comment）。
      const rawComment = typeof metadata.comment === "string" ? metadata.comment.trim() : "";
      return {
        primary: fieldName,
        typeText,
        commentText: rawComment || null
      };
    },
    supportsOpenRecordPage: false
  },
  connectionSchema: {
    description: "连接 MySQL 5.7+ / 8.0+ 关系型数据库，支持表结构探索、DDL 查看与事务级表格编辑。",
    fields: [
      {
        key: "host",
        label: "主机地址 (Host)",
        type: "text",
        placeholder: "127.0.0.1",
        defaultValue: "127.0.0.1",
        required: true,
        group: "auth",
        colSpan: 1
      },
      {
        key: "port",
        label: "端口 (Port)",
        type: "number",
        placeholder: "3306",
        defaultValue: "3306",
        required: true,
        group: "auth",
        colSpan: 1
      },
      {
        key: "database",
        label: "数据库名 (Database)",
        type: "text",
        placeholder: "例如：app_prod",
        required: true,
        group: "auth",
        colSpan: 2
      },
      {
        key: "username",
        label: "用户名 (Username)",
        type: "text",
        placeholder: "root",
        required: true,
        group: "auth",
        colSpan: 1
      },
      {
        key: "password",
        label: "密码 (Password)",
        type: "password",
        placeholder: "输入数据库密码",
        required: false,
        group: "auth",
        colSpan: 1
      },
      {
        key: "primaryKey",
        label: "自定义主键覆盖（可选）",
        type: "text",
        placeholder: "默认自动识别表 PRI 主键，无主键表可手动指定列名",
        required: false,
        group: "advanced",
        colSpan: 2
      },
      {
        key: "transactionMode",
        label: "默认事务模式（控制台）",
        type: "select",
        defaultValue: "auto",
        required: false,
        group: "advanced",
        colSpan: 2,
        helpText: "自动提交：每条立即生效；手动提交：需显式 Commit / Rollback；智能提交：只读不锁表，写操作自动开启事务。",
        options: [
          { label: "自动提交 (Auto-commit)", value: "auto" },
          { label: "手动提交 (Manual commit)", value: "manual" },
          { label: "智能提交 (Smart commit)", value: "smart" }
        ]
      }
    ],
    extractFormValues: (source, secretView) => {
      const cfg = (source.configJson || {}) as Record<string, unknown>;
      const rawTxMode = String(cfg.transactionMode || "auto").toLowerCase();
      const transactionMode = rawTxMode === "manual" || rawTxMode === "smart" ? rawTxMode : "auto";
      return {
        host: String(cfg.host || ""),
        port: String(cfg.port || 3306),
        database: String(cfg.database || ""),
        username: String(cfg.username || ""),
        password: secretView?.password ?? String(cfg.password || ""),
        primaryKey: String(cfg.primaryKey || ""),
        transactionMode
      };
    },
    buildPayload: (values, meta) => {
      const host = (values.host || "").trim();
      const port = Number(values.port) || 3306;
      const database = (values.database || "").trim();
      const username = (values.username || "").trim();
      const password = values.password || "";
      const primaryKey = (values.primaryKey || "").trim();
      const rawTxMode = (values.transactionMode || "auto").trim().toLowerCase();
      const transactionMode = rawTxMode === "manual" || rawTxMode === "smart" ? rawTxMode : "auto";
      return {
        name: meta.name.trim(),
        sourceType: "mysql",
        configJson: {
          host,
          port,
          database,
          username,
          password,
          transactionMode,
          ...(primaryKey ? { primaryKey } : {}),
          ...(meta.color ? { color: meta.color } : {}),
          environment: meta.environment,
          readOnly: meta.readOnly
        },
        instanceUrl: `mysql://${host}:${port}/${database}`,
        accessToken: "",
        apiVersion: "mysql"
      };
    }
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
    { groupType: "views", label: "views" },
    { groupType: "routines", label: "routines" },
    { groupType: "triggers", label: "triggers" },
    { groupType: "events", label: "events" },
    { groupType: "collations", label: "collations" },
    { groupType: "users", label: "users" },
    { groupType: "virtual-views", label: "virtual views" }
  ]
};

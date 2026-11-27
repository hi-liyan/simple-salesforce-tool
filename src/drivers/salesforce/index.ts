import type { DataSourceDriver } from "../types.ts";
import {
  normalizeDateDisplayValue,
  normalizeDatetimeDisplayValue,
  normalizeDatetimeValueForSave
} from "../../components/DataGrid/utils/datetime.ts";
import { isEmptyValue } from "../../components/DataGrid/utils/value.ts";

// Salesforce 前端数据源驱动。
export const salesforceDriver: DataSourceDriver = {
  kind: "salesforce",
  displayName: "Salesforce",
  badgeLabel: "SF",
  badgeClassName: "bg-sky-500/12 text-sky-700 border border-sky-500/20",
  defaultConfig: {},
  capabilities: {
    queryLanguage: "soql",
    supportsDdl: false,
    supportsTableDesigner: false,
    supportsBackup: false,
    supportsExplain: false,
    supportsMultiStatement: false,
    supportsMutationPreview: false,
    supportsTransactionalBatch: false,
    supportsAuthWindow: true,
    supportsInteractiveTransaction: false,
    defaultDrawerView: "salesforce"
  },
  treeConfig: {
    useGroupNodes: false,
    groups: [],
    supportsColumnExpansion: true,
    objectSubFolders: []
  },
  gridAdapter: {
    sourceKind: "salesforce",
    nullPlaceholder: "None",
    nullishActionLabel: "Set None",
    supportsDefaultValueAction: false,
    omitEmptyOnNewRow: false,
    resolvePrimaryKeyField: () => "Id",
    resolveRecordKey: (record) => String(record.Id ?? ""),
    codec: {
      encodeNull: () => null,
      encodeDefault: () => undefined,
      encodeOmit: () => undefined,
      encodeValue: (val) => val
    },
    resolveDisplayValue: (raw) => ({
      value: raw,
      useNullPlaceholder: raw === null || raw === undefined
    }),
    isBlankValue: (raw) => isEmptyValue(raw),
    normalizeDatetimeForSave: (value, timezone) => normalizeDatetimeValueForSave(value, timezone ?? null),
    formatDateDisplay: (value) => normalizeDateDisplayValue(value),
    formatDatetimeDisplay: (value, timezone) => normalizeDatetimeDisplayValue(value, timezone ?? null),
    resolveFieldStrategy: (meta) => {
      const t = String(meta.type || meta.dataType || "").trim().toLowerCase();
      if (t === "picklist" || t === "multipicklist") return "picklist";
      if (t === "date") return "date";
      if (t === "datetime") return "datetime";
      if (t === "boolean") return "boolean";
      if (["int", "double", "currency", "percent", "number"].includes(t)) return "number";
      return "text";
    },
    resolveHeaderDisplayLines: (fieldName, metadata, runtimeType) => {
      // Salesforce 表头第二行展示字段数据类型。
      const rawType = [metadata.type, metadata.dataType, runtimeType]
        .find((item) => typeof item === "string" && item.trim().length > 0);
      const typeText = typeof rawType === "string" && rawType.trim() ? rawType.trim() : null;
      // Salesforce 无 SQL comment，第三行展示与字段名不同的业务标签（label）。
      const rawLabel = typeof metadata.label === "string" ? metadata.label.trim() : "";
      const commentText = rawLabel && rawLabel !== fieldName ? rawLabel : null;
      return {
        primary: fieldName,
        typeText,
        commentText
      };
    },
    supportsOpenRecordPage: true
  },
  connectionSchema: {
    description: "支持 OAuth 浏览器授权与手动 Token 接入 Salesforce Production / Sandbox 组织。",
    supportsOAuthLogin: true,
    isCliManagedSource: (source) => source.id.startsWith("cli-"),
    fields: [
      {
        key: "instanceUrl",
        label: "Instance URL",
        type: "text",
        placeholder: "https://login.salesforce.com 或 https://your-domain.my.salesforce.com",
        defaultValue: "https://login.salesforce.com",
        required: true,
        group: "auth",
        colSpan: 2
      },
      {
        key: "accessToken",
        label: "Access Token",
        type: "password",
        placeholder: "输入 Salesforce Access Token（CLI 同步源可留空）",
        required: false,
        group: "auth",
        colSpan: 2
      },
      {
        key: "apiVersion",
        label: "API Version",
        type: "text",
        placeholder: "v61.0",
        defaultValue: "v61.0",
        required: true,
        group: "advanced",
        colSpan: 1
      }
    ],
    extractFormValues: (source, secretView) => ({
      instanceUrl: source.instanceUrl || "",
      accessToken: secretView?.accessToken ?? source.accessToken ?? "",
      apiVersion: source.apiVersion || "v61.0"
    }),
    buildPayload: (values, meta) => ({
      name: meta.name.trim(),
      sourceType: "salesforce",
      configJson: {
        ...(meta.color ? { color: meta.color } : {}),
        environment: meta.environment,
        readOnly: meta.readOnly
      },
      instanceUrl: (values.instanceUrl || "").trim(),
      accessToken: (values.accessToken || "").trim(),
      apiVersion: (values.apiVersion || "v61.0").trim() || "v61.0"
    })
  },
  hydrateSourceSecrets: (source, secretView) => ({
    ...source,
    accessToken: secretView.accessToken || ""
  }),
  normalizeConsoleFieldType: (rawType) => {
    // 行内注释：将 Salesforce 字段类型归一化为控制台变量逻辑类型。
    const base = String(rawType || "").trim().toLowerCase();
    if (!base) return "unknown";
    if (base === "null") return "null";
    if (base === "boolean") return "boolean";
    if (base === "date") return "date";
    if (base === "datetime") return "datetime";
    if (["int", "double", "currency", "percent", "number"].includes(base)) {
      return "number";
    }
    return "string";
  },
  formatConsoleVariableLiteral: (value, varType) => {
    if (value === null || value === undefined || varType === "null") return "null";
    if (varType === "number") {
      return String(value).trim();
    }
    if (varType === "boolean") {
      if (typeof value === "boolean") return value ? "true" : "false";
      const normalized = String(value).trim().toLowerCase();
      return normalized === "true" || normalized === "1" ? "true" : "false";
    }
    if (varType === "date" || varType === "datetime") {
      // 行内注释：SOQL 的日期与日期时间字面量不带单引号。
      return String(value).trim();
    }
    // 行内注释：SOQL 字符串使用单引号包裹，并转义反斜杠与单引号。
    const escaped = String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    return `'${escaped}'`;
  }
};

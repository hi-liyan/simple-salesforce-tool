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
    supportsExplain: false,
    supportsMultiStatement: false,
    supportsMutationPreview: false,
    supportsTransactionalBatch: false,
    supportsAuthWindow: true,
    defaultDrawerView: "salesforce"
  },
  treeConfig: {
    useGroupNodes: false,
    groups: [],
    supportsColumnExpansion: true,
    objectSubFolders: []
  },
  gridAdapter: {
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
  })
};

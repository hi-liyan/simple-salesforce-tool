import type { DataSourceDriver } from "../types.ts";

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
    supportsMutationPreview: false,
    supportsTransactionalBatch: false,
    supportsAuthWindow: true,
    defaultDrawerView: "salesforce"
  },
  gridAdapter: {
    nullPlaceholder: "None",
    resolvePrimaryKeyField: () => "Id",
    resolveRecordKey: (record) => String(record.Id ?? ""),
    codec: {
      encodeNull: () => null,
      encodeDefault: () => undefined,
      encodeOmit: () => undefined,
      encodeValue: (val) => val
    },
    resolveFieldStrategy: (meta) => {
      const t = String(meta.dataType || meta.type || "").toLowerCase();
      if (t === "picklist" || t === "multipicklist") return "picklist";
      if (t === "date") return "date";
      if (t === "datetime") return "datetime";
      if (t === "boolean") return "boolean";
      if (["int", "double", "currency", "percent", "number"].includes(t)) return "number";
      return "text";
    },
    supportsOpenRecordPage: true
  },
  hydrateSourceSecrets: (source, secretView) => ({
    ...source,
    accessToken: secretView.accessToken || ""
  })
};

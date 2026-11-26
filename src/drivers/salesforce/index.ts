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
    supportsColumnExpansion: true
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
  hydrateSourceSecrets: (source, secretView) => ({
    ...source,
    accessToken: secretView.accessToken || ""
  })
};

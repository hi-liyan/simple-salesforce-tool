import { invoke } from "@tauri-apps/api/core";
import {
  ObjectDescribe,
  QueryResult,
  RecordMutationPayload,
  SalesforceObject,
  SalesforceSource,
  SourceUpsertPayload
} from "../types";

// 统一调用封装，确保前后端错误在 UI 层可直接展示。
async function invokeApi<T>(command: string, payload?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, payload);
  } catch (error) {
    throw new Error(String(error));
  }
}

export const api = {
  listSources: () => invokeApi<SalesforceSource[]>("list_sources"),
  syncCliSources: () => invokeApi<SalesforceSource[]>("sync_cli_sources"),
  createSource: (payload: SourceUpsertPayload) => invokeApi<SalesforceSource>("create_source", { payload }),
  updateSource: (id: string, payload: SourceUpsertPayload) =>
    invokeApi<SalesforceSource>("update_source", { id, payload }),
  deleteSource: (id: string) => invokeApi<void>("delete_source", { id }),
  listObjects: (sourceId: string) => invokeApi<SalesforceObject[]>("list_objects", { sourceId }),
  describeObject: (sourceId: string, objectName: string) =>
    invokeApi<ObjectDescribe>("describe_object", { sourceId, objectName }),
  queryRecords: (sourceId: string, soql: string) =>
    invokeApi<QueryResult>("query_records", { sourceId, soql }),
  createRecord: (payload: RecordMutationPayload) => invokeApi<string>("create_record", { payload }),
  updateRecord: (sourceId: string, objectName: string, recordId: string, values: Record<string, unknown>) =>
    invokeApi<void>("update_record", { sourceId, objectName, recordId, values }),
  deleteRecord: (sourceId: string, objectName: string, recordId: string) =>
    invokeApi<void>("delete_record", { sourceId, objectName, recordId })
};

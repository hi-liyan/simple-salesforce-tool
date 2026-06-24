import { invoke } from "@tauri-apps/api/core";
import type {
  AiCapabilities,
  AiChatTurnV2Request,
  AiChatTurnV2Response,
  CliPathProbe,
  CliPathSettings,
  CliPathStatus,
  CurrentUserContext,
  LlmSettings,
  LlmSettingsSavePayload,
  LanFileReceiverItem,
  LanFileReceiverPreviewPayload,
  LanFileReceiverStatus,
  MutationExecutionResult,
  MutationPreviewSqlItem,
  ObjectDdl,
  ObjectDescribe,
  QueryResult,
  RecordMutationPayload,
  RecordSavePayload,
  RecordSaveWithDeletePayload,
  SalesforceObject,
  SalesforceSource,
  SourceSecretView,
  SourceUpsertPayload,
  SystemLogPage,
  TerminalCommandGroup,
  TerminalCommandGroupUpsertPayload,
  TerminalCommandItem,
  TerminalCommandReorderPayload,
  TerminalShellSettings,
  TerminalCommandUpsertPayload,
  TerminalSessionInfo,
  TerminalShellOption,
  WorkspaceSnapshotDto
} from "../types/index.ts";

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
  getCliPathSettings: () => invokeApi<CliPathSettings>("get_cli_path_settings"),
  saveCliPathSettings: (customCliPath: string | null) =>
    invokeApi<CliPathSettings>("save_cli_path_settings", { customCliPath }),
  checkCliPathStatus: (cliPath: string | null) => invokeApi<CliPathStatus>("check_cli_path_status", { cliPath }),
  detectLocalCliPaths: () => invokeApi<CliPathProbe[]>("detect_local_cli_paths"),
  getLlmSettings: () => invokeApi<LlmSettings>("get_llm_settings"),
  saveLlmSettings: (payload: LlmSettingsSavePayload) => invokeApi<LlmSettings>("save_llm_settings", { payload }),
  aiChatTurnV2: (payload: AiChatTurnV2Request) =>
    invokeApi<AiChatTurnV2Response>("ai_chat_turn_v2", { payload }),
  aiStopTurn: (requestId: string) => invokeApi<void>("ai_stop_turn", { requestId }),
  aiGetCapabilities: () => invokeApi<AiCapabilities>("ai_get_capabilities"),
  stopLlmStreamGeneration: (requestId: string) => invokeApi<void>("stop_llm_stream_generation", { requestId }),
  // 打开外部链接：交由后端使用系统默认浏览器处理，避免前端 window.open。
  openExternalUrl: (url: string) => invokeApi<void>("open_external_url", { url }),
  syncCliSources: () => invokeApi<SalesforceSource[]>("sync_cli_sources"),
  loginCliOrg: (instanceUrl: string) => invokeApi<string>("login_cli_org", { instanceUrl }),
  openAuthWindow: () => invokeApi<void>("open_auth_window"),
  closeAuthWindow: () => invokeApi<void>("close_auth_window"),
  openFieldMetaWindow: (fieldName: string, metadata: Record<string, unknown>) =>
    invokeApi<void>("open_field_meta_window", { fieldName, metadata }),
  listSystemLogs: (page: number, pageSize: number) =>
    invokeApi<SystemLogPage>("list_system_logs", { page, pageSize }),
  createSource: (payload: SourceUpsertPayload) => invokeApi<SalesforceSource>("create_source", { payload }),
  getSource: (sourceId: string) => invokeApi<SalesforceSource>("get_source", { sourceId }),
  getSourceSecretView: (sourceId: string) =>
    invokeApi<SourceSecretView>("get_source_secret_view", { sourceId }),
  testSourceConnection: (payload: SourceUpsertPayload) => invokeApi<void>("test_source_connection", { payload }),
  updateSource: (id: string, payload: SourceUpsertPayload) =>
    invokeApi<SalesforceSource>("update_source", { id, payload }),
  reorderSources: (orderedIds: string[]) => invokeApi<SalesforceSource[]>("reorder_sources", { orderedIds }),
  deleteSource: (id: string) => invokeApi<void>("delete_source", { id }),
  loadWorkspaceSnapshot: () => invokeApi<WorkspaceSnapshotDto>("load_workspace_snapshot"),
  saveWorkspaceSnapshot: (payload: WorkspaceSnapshotDto) =>
    invokeApi<void>("save_workspace_snapshot", { payload }),
  getColumnVisibility: (sourceId: string, objectName: string) =>
    invokeApi<Record<string, boolean>>("get_column_visibility", { sourceId, objectName }),
  saveColumnVisibility: (sourceId: string, objectName: string, visibility: Record<string, boolean>) =>
    invokeApi<void>("save_column_visibility", { sourceId, objectName, visibility }),
  listObjects: (sourceId: string) => invokeApi<SalesforceObject[]>("list_objects", { sourceId }),
  refreshObjects: (sourceId: string) => invokeApi<SalesforceObject[]>("refresh_objects", { sourceId }),
  openObjectListPage: (sourceId: string, objectName: string) =>
    invokeApi<void>("open_object_list_page", { sourceId, objectName }),
  openObjectEditPage: (sourceId: string, objectName: string) =>
    invokeApi<void>("open_object_edit_page", { sourceId, objectName }),
  openRecordPage: (sourceId: string, objectName: string, recordId: string) =>
    invokeApi<void>("open_record_page", { sourceId, objectName, recordId }),
  describeObject: (sourceId: string, objectName: string) =>
    invokeApi<ObjectDescribe>("describe_object", { sourceId, objectName }),
  getObjectDdl: (sourceId: string, objectName: string) =>
    invokeApi<ObjectDdl>("get_object_ddl", { sourceId, objectName }),
  resolveFieldChildRelationshipName: (sourceId: string, objectName: string, fieldName: string) =>
    invokeApi<string | null>("resolve_field_child_relationship_name", { sourceId, objectName, fieldName }),
  queryRecords: (sourceId: string, soql: string, objectName?: string) =>
    invokeApi<QueryResult>("query_records", { sourceId, soql, objectName }),
  getCurrentUserContext: (sourceId: string) =>
    invokeApi<CurrentUserContext>("get_current_user_context", { sourceId }),
  createRecord: (payload: RecordMutationPayload) => invokeApi<string>("create_record", { payload }),
  saveRecords: (payload: RecordSavePayload) => invokeApi<void>("save_records", { payload }),
  // MySQL 提交前预览 SQL：只生成展示用 SQL，不执行数据库写入。
  previewSaveRecordsWithDeletes: (payload: RecordSaveWithDeletePayload) =>
    invokeApi<MutationPreviewSqlItem[]>("preview_save_records_with_deletes", { payload }),
  // MySQL 单事务提交新增/更新/删除。
  saveRecordsWithDeletes: (payload: RecordSaveWithDeletePayload) =>
    invokeApi<MutationExecutionResult>("save_records_with_deletes", { payload }),
  updateRecord: (sourceId: string, objectName: string, recordId: string, values: Record<string, unknown>) =>
    invokeApi<void>("update_record", { sourceId, objectName, recordId, values }),
  deleteRecord: (sourceId: string, objectName: string, recordId: string) =>
    invokeApi<void>("delete_record", { sourceId, objectName, recordId }),
  // 读取全局终端命令组（含命令列表）。
  listTerminalCommandGroups: () =>
    invokeApi<TerminalCommandGroup[]>("list_terminal_command_groups"),
  // 创建终端命令组。
  createTerminalCommandGroup: (name: string) =>
    invokeApi<TerminalCommandGroup>("create_terminal_command_group", { name }),
  // 更新终端命令组。
  updateTerminalCommandGroup: (groupId: string, payload: TerminalCommandGroupUpsertPayload) =>
    invokeApi<TerminalCommandGroup>("update_terminal_command_group", { groupId, payload }),
  // 创建终端命令。
  createTerminalCommand: (payload: TerminalCommandUpsertPayload) =>
    invokeApi<TerminalCommandItem>("create_terminal_command", { payload }),
  // 更新终端命令。
  updateTerminalCommand: (commandId: string, payload: TerminalCommandUpsertPayload) =>
    invokeApi<TerminalCommandItem>("update_terminal_command", { commandId, payload }),
  // 删除终端命令。
  deleteTerminalCommand: (groupId: string, commandId: string) =>
    invokeApi<void>("delete_terminal_command", { groupId, commandId }),
  // 删除终端命令组。
  deleteTerminalCommandGroup: (groupId: string) =>
    invokeApi<void>("delete_terminal_command_group", { groupId }),
  // 调整终端命令排序。
  reorderTerminalCommands: (payload: TerminalCommandReorderPayload) =>
    invokeApi<void>("reorder_terminal_commands", { payload }),
  // 打开终端会话：每个 Tab 对应一个系统 shell 进程。
  openTerminalSession: (tabId: string, cols: number, rows: number, initialCommand?: string) =>
    invokeApi<TerminalSessionInfo>("open_terminal_session", {
      tabId,
      cols,
      rows,
      initialCommand: initialCommand ?? null
    }),
  // 写入终端输入：xterm onData 透传字符流。
  writeTerminalInput: (tabId: string, input: string) => invokeApi<void>("write_terminal_input", { tabId, input }),
  // 调整终端窗口尺寸：xterm fit 后同步 cols/rows。
  resizeTerminalSession: (tabId: string, cols: number, rows: number) =>
    invokeApi<void>("resize_terminal_session", { tabId, cols, rows }),
  // 关闭终端会话并终止对应进程。
  closeTerminalSession: (tabId: string) => invokeApi<void>("close_terminal_session", { tabId }),
  // 列出系统可用终端 Shell（动态探测，包含版本信息）。
  listAvailableTerminalShells: () => invokeApi<TerminalShellOption[]>("list_available_terminal_shells"),
  // 读取终端 Shell 设置：包含当前保存值与旧版偏好兼容字段。
  getTerminalShellSettings: () => invokeApi<TerminalShellSettings>("get_terminal_shell_settings"),
  // 保存终端 Shell 命令路径。
  saveTerminalShellCommand: (command: string) => invokeApi<void>("save_terminal_shell_command", { command }),
  // 以管理员身份打开终端（仅 Windows）。
  openElevatedTerminal: () => invokeApi<void>("open_elevated_terminal"),
  // 读取局域网文件接收服务当前状态。
  getLanFileReceiverStatus: () => invokeApi<LanFileReceiverStatus>("get_lan_file_receiver_status"),
  // 启动局域网文件接收服务。
  startLanFileReceiver: () => invokeApi<LanFileReceiverStatus>("start_lan_file_receiver"),
  // 停止局域网文件接收服务。
  stopLanFileReceiver: () => invokeApi<void>("stop_lan_file_receiver"),
  // 列出已接收文件。
  listLanFileReceiverFiles: () => invokeApi<LanFileReceiverItem[]>("list_lan_file_receiver_files"),
  // 读取指定文件的预览内容。
  readLanFileReceiverPreview: (fileId: string) =>
    invokeApi<LanFileReceiverPreviewPayload>("read_lan_file_receiver_preview", { fileId }),
  // 删除单个已接收文件。
  deleteLanFileReceiverFile: (fileId: string) => invokeApi<void>("delete_lan_file_receiver_file", { fileId }),
  // 清空全部已接收文件。
  clearLanFileReceiverFiles: () => invokeApi<void>("clear_lan_file_receiver_files")
};

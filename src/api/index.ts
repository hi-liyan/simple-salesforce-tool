import { invoke } from "@tauri-apps/api/core";
export { aiApi } from "./ai.ts";
import type {
  AiCapabilities,
  AiChatTurnV2Request,
  AiChatTurnV2Response,
  BackupRequest,
  BackupResult,
  CliPathProbe,
  CliPathSettings,
  CliPathStatus,
  CurrentUserContext,
  DatabaseCollation,
  DatabaseEvent,
  DatabaseRoutine,
  DatabaseTrigger,
  DatabaseUser,
  ExportDataRequest,
  ExportResult,
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
  TableStructureSpec,
  TerminalCommandItem,
  TerminalCommandReorderPayload,
  TerminalShellSettings,
  TerminalCommandUpsertPayload,
  TerminalSessionInfo,
  TerminalShellOption,
  VirtualView,
  VirtualViewUpsertPayload,
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
  listViews: (sourceId: string) => invokeApi<SalesforceObject[]>("list_views", { sourceId }),
  listCollations: (sourceId: string) => invokeApi<DatabaseCollation[]>("list_collations", { sourceId }),
  listUsers: (sourceId: string) => invokeApi<DatabaseUser[]>("list_users", { sourceId }),
  listRoutines: (sourceId: string) => invokeApi<DatabaseRoutine[]>("list_routines", { sourceId }),
  listTriggers: (sourceId: string) => invokeApi<DatabaseTrigger[]>("list_triggers", { sourceId }),
  listEvents: (sourceId: string) => invokeApi<DatabaseEvent[]>("list_events", { sourceId }),
  getSchemaObjectDdl: (sourceId: string, objectKind: string, objectName: string, routineType?: string) =>
    invokeApi<string>("get_schema_object_ddl", { sourceId, objectKind, objectName, routineType }),
  listVirtualViews: (sourceId: string) => invokeApi<VirtualView[]>("list_virtual_views", { sourceId }),
  upsertVirtualView: (payload: VirtualViewUpsertPayload) =>
    invokeApi<VirtualView>("upsert_virtual_view", { payload }),
  deleteVirtualView: (id: string) => invokeApi<void>("delete_virtual_view", { id }),
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
  readCellFullValue: (params: {
    sourceId: string;
    objectName: string;
    primaryKeyField: string;
    primaryKeyValue: string;
    columnName: string;
  }) => invokeApi<string | null>("read_cell_full_value", params),
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
  clearLanFileReceiverFiles: () => invokeApi<void>("clear_lan_file_receiver_files"),
  // 两阶段提交 Phase 1：编译并缓存变更计划。
  prepareMutationPlan: (payload: RecordSaveWithDeletePayload) =>
    invokeApi<{ planId: string; planHash: string; previewItems: MutationPreviewSqlItem[] }>("prepare_mutation_plan", {
      payload
    }),
  // 两阶段提交 Phase 2：按 planId + planHash 原样执行已预览计划。
  commitMutationPlan: (planId: string, planHash: string) =>
    invokeApi<MutationExecutionResult>("commit_mutation_plan", { planId, planHash }),
  // 受安全网关保护的查询执行入口（支持 queryId 取消慢查询与 sessionId 会话事务绑定）。
  executeGuardedQuery: (
    sourceId: string,
    queryText: string,
    objectName?: string,
    confirmed?: boolean,
    queryId?: string,
    sessionId?: string
  ) =>
    invokeApi<{
      status: "executed" | "confirmation_required";
      guardDecision: Record<string, unknown>;
      executedSql: string;
      durationMs: number;
      result?: QueryResult | null;
    }>("execute_guarded_query", { sourceId, queryText, objectName, confirmed, queryId, sessionId }),
  // 取消正在执行中的慢查询。
  cancelQuery: (queryId: string) => invokeApi<boolean>("cancel_query", { queryId }),
  // 读取指定控制台会话的交互式事务状态。
  getConsoleTransactionStatus: (sourceId: string, sessionId: string) =>
    invokeApi<{
      sessionId: string;
      sourceId: string;
      mode: "auto" | "manual" | "smart";
      inTransaction: boolean;
      uncommittedSqls: string[];
      supported: boolean;
    }>("get_console_transaction_status", { sourceId, sessionId }),
  // 切换指定控制台会话的事务模式。
  setConsoleTransactionMode: (sourceId: string, sessionId: string, mode: "auto" | "manual" | "smart") =>
    invokeApi<{
      sessionId: string;
      sourceId: string;
      mode: "auto" | "manual" | "smart";
      inTransaction: boolean;
      uncommittedSqls: string[];
      supported: boolean;
    }>("set_console_transaction_mode", { sourceId, sessionId, mode }),
  // 提交指定控制台会话的挂起事务。
  commitConsoleTransaction: (sourceId: string, sessionId: string) =>
    invokeApi<{
      sessionId: string;
      sourceId: string;
      mode: "auto" | "manual" | "smart";
      inTransaction: boolean;
      uncommittedSqls: string[];
      supported: boolean;
    }>("commit_console_transaction", { sourceId, sessionId }),
  // 回滚指定控制台会话的挂起事务。
  rollbackConsoleTransaction: (sourceId: string, sessionId: string) =>
    invokeApi<{
      sessionId: string;
      sourceId: string;
      mode: "auto" | "manual" | "smart";
      inTransaction: boolean;
      uncommittedSqls: string[];
      supported: boolean;
    }>("rollback_console_transaction", { sourceId, sessionId }),
  // 关闭并清理指定控制台会话（存在未提交事务时自动回滚）。
  closeConsoleSession: (sessionId: string) => invokeApi<void>("close_console_session", { sessionId }),
  // 多语句拆解与顺序执行（返回多结果集与摘要）。
  executeMultiStatementQuery: (sourceId: string, sqlBatch: string, confirmed?: boolean, sessionId?: string) =>
    invokeApi<
      {
        index: number;
        sql: string;
        response?: {
          status: "executed" | "confirmation_required";
          guardDecision: Record<string, unknown>;
          executedSql: string;
          durationMs: number;
          result?: QueryResult | null;
        } | null;
        error?: string | null;
      }[]
    >("execute_multi_statement_query", { sourceId, sqlBatch, confirmed, sessionId }),
  // 基于 Rust sqlparser AST 执行 SQL 实时语法诊断。
  diagnoseSql: (sql: string, dialect: string) =>
    invokeApi<{ line: number; column: number; severity: string; message: string }[]>("diagnose_sql", {
      sql,
      dialect
    }),
  // 查询 SQL 执行审计记录。
  listSqlExecutionAudits: (sourceId?: string, limit?: number) =>
    invokeApi<Record<string, unknown>[]>("list_sql_execution_audits", { sourceId, limit }),
  // 按 key 增量读取应用外壳设置。
  getAppSetting: (key: string) => invokeApi<string | null>("get_app_setting", { key }),
  // 按 key 增量写入应用外壳设置。
  setAppSetting: (key: string, value: string) => invokeApi<void>("set_app_setting", { key, value }),
  // 按 key 删除应用外壳设置。
  deleteAppSetting: (key: string) => invokeApi<void>("delete_app_setting", { key }),
  // 预览解析本地 `.sstplugin` 插件包（不落盘，返回清单供审批权限）。
  inspectPluginPackageBytes: (bytes: number[]) =>
    invokeApi<{
      manifest: {
        id: string;
        name: string;
        version: string;
        apiVersion: string;
        description: string;
        category: string;
        mountTargets: string[];
        permissions: string[];
        entry: string;
        icon?: string | null;
      };
      packageSha256: string;
      packageSizeBytes: number;
      isUpgrade: boolean;
      previousVersion?: string | null;
    }>("inspect_plugin_package_bytes", { bytes }),
  // 安装或升级 `.sstplugin` 插件包。
  installPluginPackageBytes: (bytes: number[]) =>
    invokeApi<{
      pluginId: string;
      name: string;
      version: string;
      apiVersion: string;
      description: string;
      category: string;
      manifestJson: string;
      installDir: string;
      enabled: boolean;
      grantedPermissions: string;
      packageSha256: string;
      installedAt: string;
      updatedAt: string;
    }>("install_plugin_package_bytes", { bytes }),
  // 列出全部已安装的外部插件。
  listInstalledPlugins: () =>
    invokeApi<
      {
        pluginId: string;
        name: string;
        version: string;
        apiVersion: string;
        description: string;
        category: string;
        manifestJson: string;
        installDir: string;
        enabled: boolean;
        grantedPermissions: string;
        packageSha256: string;
        installedAt: string;
        updatedAt: string;
      }[]
    >("list_installed_plugins"),
  // 切换已安装外部插件启用状态。
  setInstalledPluginEnabled: (pluginId: string, enabled: boolean) =>
    invokeApi<void>("set_installed_plugin_enabled", { pluginId, enabled }),
  // 卸载外部插件。
  uninstallPlugin: (pluginId: string) => invokeApi<void>("uninstall_plugin", { pluginId }),
  // 读取表结构完整定义（用于表结构设计器）。
  getTableStructureSpec: (sourceId: string, tableName: string) =>
    invokeApi<TableStructureSpec>("get_table_structure_spec", { sourceId, tableName }),
  // 预览 CREATE TABLE SQL。
  previewCreateTableSql: (spec: TableStructureSpec) =>
    invokeApi<string[]>("preview_create_table_sql", { spec }),
  // 预览 ALTER TABLE SQL 列表。
  previewAlterTableSql: (original: TableStructureSpec, updated: TableStructureSpec) =>
    invokeApi<string[]>("preview_alter_table_sql", { original, updated }),
  // 异步流式导出全表或查询结果到文件。
  exportDataToFile: (request: ExportDataRequest) =>
    invokeApi<ExportResult>("export_data_to_file", { request }),
  // 取消后台导出任务。
  cancelDataExport: (taskId: string) => invokeApi<boolean>("cancel_data_export", { taskId }),
  // 纯 Rust 逻辑 SQL 备份整库或单表。
  backupDatabaseToFile: (request: BackupRequest) =>
    invokeApi<BackupResult>("backup_database_to_file", { request }),
  // 取消后台备份任务。
  cancelDatabaseBackup: (taskId: string) => invokeApi<boolean>("cancel_database_backup", { taskId })
};

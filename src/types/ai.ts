// AI 助手运行模式：ask 为只读问答与语句生成，agent 为可调用查询/诊断工具的多轮循环。
export type AiAssistantMode = "ask" | "agent";

// AI 快捷技能标识。
export type AiSkillAction = "general" | "generate" | "explain" | "optimize" | "fix" | "explore";

// AI 模型配置视图（不含明文密钥）。
export type AiConfigView = {
  id: string;
  name: string;
  provider: string;
  apiStyle: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  apiKeyConfigured: boolean;
  apiKeyMasked: string;
};

// 新增或更新 AI 模型配置载荷。
export type AiConfigUpsertPayload = {
  id?: string | null;
  name: string;
  provider: string;
  apiStyle?: string;
  baseUrl: string;
  model: string;
  apiKey?: string | null;
  timeoutMs?: number;
  isDefault?: boolean;
};

// AI 连通性测试结果。
export type AiConnectionTestResult = {
  ok: boolean;
  latencyMs: number;
  message: string;
};

// 后端流式推送的 Agent 事件联合类型。
export type AgentEvent =
  | { sessionId: string; type: "turn_start"; turn: number }
  | { sessionId: string; type: "turn_end"; turn: number }
  | { sessionId: string; type: "text_delta"; delta: string }
  | { sessionId: string; type: "reasoning_delta"; delta: string }
  | { sessionId: string; type: "tool_call_start"; tool_call_id: string; tool_name: string; args: unknown }
  | { sessionId: string; type: "tool_call_end"; tool_call_id: string; tool_name: string; result: string; is_error: boolean }
  | { sessionId: string; type: "write_sql_confirmation_required"; sql: string; reason: string }
  | { sessionId: string; type: "production_write_blocked"; sql: string; reason: string }
  | { sessionId: string; type: "context_compacted"; removed_count: number; remaining_count: number }
  | { sessionId: string; type: "agent_end"; input_tokens: number; output_tokens: number }
  | { sessionId: string; type: "error"; message: string };

// 单条工具调用步骤展示状态。
export type AiToolStep = {
  id: string;
  name: string;
  argsText: string;
  resultText: string;
  status: "running" | "done" | "error";
};

// 消息关联的结构化引用标签（用于在对话气泡中回显 @对象、选区与附件）。
export type AiMessageMentionBadge = {
  kind: "object" | "selection" | "file" | "image";
  label: string;
};

// 前端展示与持久化用的单条 AI 对话消息。
export type AiChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  mentions?: AiMessageMentionBadge[];
  reasoning?: string;
  toolSteps?: AiToolStep[];
  writeConfirmation?: {
    sql: string;
    reason: string;
    sourceId: string;
    status: "pending" | "confirmed" | "cancelled";
  };
  blockedNotice?: {
    sql: string;
    reason: string;
  };
  createdAt: string;
};

// 持久化的 AI 会话记录。
export type AiConversationRecord = {
  id: string;
  title: string;
  sourceId: string;
  sourceName: string;
  mode: AiAssistantMode;
  messagesJson: string;
  createdAt: string;
  updatedAt: string;
};

// 自定义提示词模板记录。
export type AiPromptTemplateRecord = {
  id: string;
  name: string;
  category: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

// 发起流式 Agent 请求参数。
export type AiAgentStreamRequest = {
  sessionId: string;
  sourceId: string;
  configId?: string | null;
  mode: AiAssistantMode;
  action?: AiSkillAction;
  prompt: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  currentEditorSql: string;
  selectedEditorSql: string;
  mentionedObjects: string[];
  errorMessage: string;
  customInstructions: string;
  confirmedWriteSql?: string | null;
  confirmedSourceId?: string | null;
  maxTurns?: number;
};

// AI 编辑器上下文桥接：由当前激活工作区注入。
export type AiWorkspaceContextBridge = {
  sourceId: string;
  sourceName: string;
  sourceType: string;
  queryLanguage: string;
  currentEditorSql: string;
  selectedEditorSql: string;
  availableObjects: string[];
  onReplaceEditorSql: (sql: string) => void;
  onOpenNewConsoleWithSql: (sql: string) => void;
  onExecuteSqlDirect: (sql: string) => void;
};

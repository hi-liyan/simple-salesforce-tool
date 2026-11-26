import { invoke } from "@tauri-apps/api/core";
import type {
  AiAgentStreamRequest,
  AiConfigUpsertPayload,
  AiConfigView,
  AiConnectionTestResult,
  AiConversationRecord,
  AiPromptTemplateRecord
} from "../types/ai";

// AI 助手与多模型配置前端 IPC 封装。
export const aiApi = {
  // 列出全部加密存储的 AI 模型配置。
  listConfigs: () => invoke<AiConfigView[]>("ai_list_configs"),
  // 新增或更新 AI 模型配置。
  saveConfig: (payload: AiConfigUpsertPayload) => invoke<AiConfigView>("ai_save_config", { payload }),
  // 删除指定 AI 模型配置。
  deleteConfig: (configId: string) => invoke<void>("ai_delete_config", { configId }),
  // 设置默认 AI 模型配置。
  setDefaultConfig: (configId: string) => invoke<void>("ai_set_default_config", { configId }),
  // 测试 AI 模型连通性。
  testConfigConnection: (configId: string) =>
    invoke<AiConnectionTestResult>("ai_test_config_connection", { configId }),
  // 拉取远端模型列表。
  listConfigModels: (configId: string) => invoke<string[]>("ai_list_config_models", { configId }),
  // 启动多轮流式 Agent 对话。
  startAgentStream: (request: AiAgentStreamRequest) => invoke<void>("ai_agent_stream", { request }),
  // 中断当前流式生成。
  cancelStream: (sessionId: string) => invoke<boolean>("ai_cancel_stream", { sessionId }),
  // 列出持久化会话历史。
  listConversations: () => invoke<AiConversationRecord[]>("ai_list_conversations"),
  // 保存会话历史。
  saveConversation: (record: AiConversationRecord) =>
    invoke<AiConversationRecord>("ai_save_conversation", { record }),
  // 删除会话历史。
  deleteConversation: (conversationId: string) =>
    invoke<void>("ai_delete_conversation", { conversationId }),
  // 列出提示词模板。
  listPromptTemplates: () => invoke<AiPromptTemplateRecord[]>("ai_list_prompt_templates"),
  // 保存提示词模板。
  savePromptTemplate: (payload: { id?: string | null; name: string; category: string; content: string }) =>
    invoke<AiPromptTemplateRecord>("ai_save_prompt_template", payload),
  // 删除提示词模板。
  deletePromptTemplate: (templateId: string) =>
    invoke<void>("ai_delete_prompt_template", { templateId })
};

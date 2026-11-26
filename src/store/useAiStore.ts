import { create } from "zustand";
import { aiApi } from "../api/ai";
import type {
  AiAssistantMode,
  AiChatMessage,
  AiConfigView,
  AiConversationRecord,
  AiPromptTemplateRecord,
  AiSkillAction
} from "../types/ai";

// 外部联动请求载荷（如“AI 修复报错”或“发送选中 SQL 到 AI”）。
export type AiPendingLaunchIntent = {
  nonce: number;
  prompt: string;
  action: AiSkillAction;
  mode?: AiAssistantMode;
  errorMessage?: string;
  selectedSql?: string;
  autoSend?: boolean;
};

type AiStoreState = {
  // 右侧 AI 面板是否展开。
  dockOpen: boolean;
  // 右侧 AI 面板是否最大化。
  dockMaximized: boolean;
  // 右侧 AI 面板宽度（像素）。
  dockWidth: number;
  // 当前运行模式（ask / agent）。
  mode: AiAssistantMode;
  // 当前选中的快捷技能。
  action: AiSkillAction;
  // 当前选中的模型配置 ID（空表示使用默认配置）。
  selectedConfigId: string;
  // 已加载的模型配置列表。
  configs: AiConfigView[];
  // 历史会话列表。
  conversations: AiConversationRecord[];
  // 自定义提示词模板列表。
  promptTemplates: AiPromptTemplateRecord[];
  // 当前激活会话 ID。
  activeConversationId: string;
  // 当前会话消息列表。
  messages: AiChatMessage[];
  // 是否正在流式生成中。
  streaming: boolean;
  // 当前在途流会话 ID。
  activeStreamSessionId: string;
  // 代际守卫计数：防止切换会话或取消后旧流事件污染当前消息。
  generationEpoch: number;
  // 状态栏提示（如“第 2 轮推理中...” / “已压缩早期上下文”）。
  statusText: string;
  // 外部触发打开并带入上下文的意图。
  pendingLaunchIntent: AiPendingLaunchIntent | null;

  setDockOpen: (open: boolean) => void;
  toggleDockOpen: () => void;
  setDockMaximized: (maximized: boolean) => void;
  setDockWidth: (width: number) => void;
  setMode: (mode: AiAssistantMode) => void;
  setAction: (action: AiSkillAction) => void;
  setSelectedConfigId: (configId: string) => void;
  setStatusText: (text: string) => void;
  setStreamingState: (streaming: boolean, sessionId?: string) => void;
  bumpGenerationEpoch: () => number;

  loadConfigs: () => Promise<void>;
  loadConversations: () => Promise<void>;
  loadPromptTemplates: () => Promise<void>;

  startNewConversation: () => void;
  openConversation: (record: AiConversationRecord) => void;
  deleteConversationById: (conversationId: string) => Promise<void>;
  setMessages: (updater: AiChatMessage[] | ((prev: AiChatMessage[]) => AiChatMessage[])) => void;
  persistCurrentConversation: (sourceId: string, sourceName: string) => Promise<void>;
  triggerLaunchIntent: (intent: Omit<AiPendingLaunchIntent, "nonce">) => void;
  clearLaunchIntent: () => void;
};

// 解析会话 JSON 为消息数组。
function parseMessagesJson(raw: string): AiChatMessage[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? (parsed as AiChatMessage[]) : [];
  } catch {
    return [];
  }
}

export const useAiStore = create<AiStoreState>((set, get) => ({
  dockOpen: false,
  dockMaximized: false,
  dockWidth: 380,
  mode: "agent",
  action: "general",
  selectedConfigId: "",
  configs: [],
  conversations: [],
  promptTemplates: [],
  activeConversationId: `conv-${Date.now()}`,
  messages: [],
  streaming: false,
  activeStreamSessionId: "",
  generationEpoch: 1,
  statusText: "",
  pendingLaunchIntent: null,

  setDockOpen: (open) => set({ dockOpen: open }),
  toggleDockOpen: () => set((s) => ({ dockOpen: !s.dockOpen })),
  setDockMaximized: (maximized) => set({ dockMaximized: maximized }),
  setDockWidth: (width) => set({ dockWidth: Math.max(320, Math.min(720, Math.round(width))) }),
  setMode: (mode) => set({ mode }),
  setAction: (action) => set({ action }),
  setSelectedConfigId: (configId) => set({ selectedConfigId: configId }),
  setStatusText: (text) => set({ statusText: text }),
  setStreamingState: (streaming, sessionId = "") =>
    set({ streaming, activeStreamSessionId: streaming ? sessionId : "" }),
  bumpGenerationEpoch: () => {
    const next = get().generationEpoch + 1;
    set({ generationEpoch: next });
    return next;
  },

  loadConfigs: async () => {
    const configs = await aiApi.listConfigs().catch(() => []);
    const currentId = get().selectedConfigId;
    const stillValid = configs.some((c) => c.id === currentId);
    const defaultCfg = configs.find((c) => c.isDefault) || configs[0];
    set({
      configs,
      selectedConfigId: stillValid ? currentId : defaultCfg?.id || ""
    });
  },

  loadConversations: async () => {
    const conversations = await aiApi.listConversations().catch(() => []);
    set({ conversations });
  },

  loadPromptTemplates: async () => {
    const promptTemplates = await aiApi.listPromptTemplates().catch(() => []);
    set({ promptTemplates });
  },

  startNewConversation: () => {
    const nextEpoch = get().generationEpoch + 1;
    set({
      activeConversationId: `conv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      messages: [],
      streaming: false,
      activeStreamSessionId: "",
      statusText: "",
      generationEpoch: nextEpoch
    });
  },

  openConversation: (record) => {
    const nextEpoch = get().generationEpoch + 1;
    set({
      activeConversationId: record.id,
      mode: record.mode === "agent" ? "agent" : "ask",
      messages: parseMessagesJson(record.messagesJson),
      streaming: false,
      activeStreamSessionId: "",
      statusText: "",
      generationEpoch: nextEpoch
    });
  },

  deleteConversationById: async (conversationId) => {
    await aiApi.deleteConversation(conversationId);
    set((s) => ({
      conversations: s.conversations.filter((c) => c.id !== conversationId)
    }));
    if (get().activeConversationId === conversationId) {
      get().startNewConversation();
    }
  },

  setMessages: (updater) =>
    set((s) => ({
      messages: typeof updater === "function" ? updater(s.messages) : updater
    })),

  persistCurrentConversation: async (sourceId, sourceName) => {
    const { activeConversationId, messages, mode, conversations } = get();
    if (messages.length === 0) return;

    const firstUserMsg = messages.find((m) => m.role === "user");
    const existing = conversations.find((c) => c.id === activeConversationId);
    const rawTitle = firstUserMsg?.content.trim().replace(/\s+/g, " ") || "新对话";
    const title = existing?.title || (rawTitle.length > 36 ? `${rawTitle.slice(0, 36)}...` : rawTitle);

    const saved = await aiApi
      .saveConversation({
        id: activeConversationId,
        title,
        sourceId,
        sourceName,
        mode,
        messagesJson: JSON.stringify(messages),
        createdAt: existing?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })
      .catch(() => null);

    if (saved) {
      set((s) => ({
        conversations: [saved, ...s.conversations.filter((c) => c.id !== saved.id)]
      }));
    }
  },

  triggerLaunchIntent: (intent) =>
    set({
      dockOpen: true,
      pendingLaunchIntent: {
        ...intent,
        nonce: Date.now()
      }
    }),

  clearLaunchIntent: () => set({ pendingLaunchIntent: null })
}));

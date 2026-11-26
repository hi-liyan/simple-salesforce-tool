import { useEffect, useState } from "react";
import { CheckCircle2, Plus, Save, Sparkles, Star, Trash2, Wifi } from "lucide-react";
import { aiApi } from "../../../api/ai";
import { useAiStore } from "../../../store/useAiStore";
import type { AiConfigView } from "../../../types/ai";

const PROVIDER_PRESETS: Array<{ value: string; label: string; defaultUrl: string; defaultModel: string; apiStyle: string }> = [
  { value: "openai", label: "OpenAI", defaultUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini", apiStyle: "completions" },
  { value: "deepseek", label: "DeepSeek", defaultUrl: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat", apiStyle: "completions" },
  { value: "qwen", label: "通义千问 (Qwen)", defaultUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", defaultModel: "qwen-plus", apiStyle: "completions" },
  { value: "claude", label: "Anthropic Claude", defaultUrl: "https://api.anthropic.com", defaultModel: "claude-sonnet-4-20250514", apiStyle: "anthropic_messages" },
  { value: "ollama", label: "Ollama (本地)", defaultUrl: "http://127.0.0.1:11434/v1", defaultModel: "qwen2.5-coder:7b", apiStyle: "completions" },
  { value: "custom", label: "自定义 OpenAI 兼容", defaultUrl: "https://api.openai.com/v1", defaultModel: "gpt-4.1-mini", apiStyle: "completions" }
];

// AI / LLM 多模型配置管理分区（支持新增、切换默认、AEAD 加密密钥、测试连通性）。
export function LlmSettingsSection() {
  const [configs, setConfigs] = useState<AiConfigView[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("默认模型配置");
  const [provider, setProvider] = useState("openai");
  const [apiStyle, setApiStyle] = useState("completions");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [model, setModel] = useState("gpt-4o-mini");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [timeoutMs, setTimeoutMs] = useState(60000);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState("");
  const [notice, setNotice] = useState("");

  async function refreshList(selectId?: string) {
    const list = await aiApi.listConfigs().catch(() => []);
    setConfigs(list);
    void useAiStore.getState().loadConfigs();
    const target = (selectId ? list.find((c) => c.id === selectId) : null) || list.find((c) => c.isDefault) || list[0];
    if (target) {
      loadIntoForm(target);
    }
  }

  function loadIntoForm(cfg: AiConfigView) {
    setEditingId(cfg.id);
    setName(cfg.name);
    setProvider(cfg.provider);
    setApiStyle(cfg.apiStyle || "completions");
    setBaseUrl(cfg.baseUrl);
    setModel(cfg.model);
    setTimeoutMs(cfg.timeoutMs || 60000);
    setApiKeyInput("");
  }

  function startCreateNew() {
    setEditingId(null);
    setName("新模型配置");
    setProvider("openai");
    setApiStyle("completions");
    setBaseUrl("https://api.openai.com/v1");
    setModel("gpt-4o-mini");
    setTimeoutMs(60000);
    setApiKeyInput("");
    setNotice("");
  }

  useEffect(() => {
    void refreshList();
  }, []);

  async function handleSave() {
    setSaving(true);
    setNotice("");
    try {
      const saved = await aiApi.saveConfig({
        id: editingId,
        name: name.trim(),
        provider,
        apiStyle,
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        apiKey: apiKeyInput.trim() ? apiKeyInput.trim() : null,
        timeoutMs: Number(timeoutMs) || 60000
      });
      setApiKeyInput("");
      setNotice("AI 模型配置已加密保存。");
      await refreshList(saved.id);
    } catch (err) {
      setNotice(`保存失败：${String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleTest(configId: string) {
    setTestingId(configId);
    setNotice("");
    try {
      const res = await aiApi.testConfigConnection(configId);
      setNotice(`${res.message}（耗时 ${res.latencyMs}ms）`);
    } catch (err) {
      setNotice(`连通性测试失败：${String(err)}`);
    } finally {
      setTestingId("");
    }
  }

  const editingConfig = editingId ? configs.find((c) => c.id === editingId) || null : null;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-[14px] font-semibold text-neutral">
            <Sparkles size={16} className="text-primary" />
            <span>AI 与多模型配置</span>
          </h3>
          <p className="mt-0.5 text-[12px] text-neutral/65">
            支持管理多个 OpenAI 兼容 / Claude / DeepSeek / 本地 Ollama 模型，密钥采用系统 AEAD 加密存储。
          </p>
        </div>
        <button type="button" onClick={startCreateNew} className="btn btn-outline btn-xs gap-1 rounded-lg">
          <Plus size={12} />
          <span>新增配置</span>
        </button>
      </div>

      {/* 已保存配置列表。 */}
      {configs.length > 0 && (
        <div className="space-y-1.5">
          {configs.map((cfg) => (
            <div
              key={cfg.id}
              onClick={() => loadIntoForm(cfg)}
              className={`flex cursor-pointer items-center justify-between gap-2 rounded-xl border px-3 py-2 text-[12px] transition-colors ${
                editingId === cfg.id
                  ? "border-primary/50 bg-primary/8"
                  : "border-base-300/80 bg-base-200/20 hover:bg-base-200/40"
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-semibold">{cfg.name}</span>
                  {cfg.isDefault && (
                    <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                      默认
                    </span>
                  )}
                  <span className="rounded bg-base-300/60 px-1.5 py-0.5 text-[10px] text-neutral/70">
                    {cfg.model}
                  </span>
                </div>
                <p className="mt-0.5 truncate font-mono text-[10px] text-neutral/55">{cfg.baseUrl}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                {!cfg.isDefault && (
                  <button
                    type="button"
                    title="设为默认"
                    onClick={async () => {
                      await aiApi.setDefaultConfig(cfg.id);
                      await refreshList(cfg.id);
                    }}
                    className="btn btn-ghost btn-xs px-1.5 text-neutral/70"
                  >
                    <Star size={12} />
                  </button>
                )}
                <button
                  type="button"
                  title="测试连接"
                  disabled={testingId === cfg.id}
                  onClick={() => void handleTest(cfg.id)}
                  className="btn btn-ghost btn-xs px-1.5 text-primary"
                >
                  <Wifi size={12} />
                </button>
                <button
                  type="button"
                  title="删除配置"
                  onClick={async () => {
                    await aiApi.deleteConfig(cfg.id);
                    await refreshList();
                  }}
                  className="btn btn-ghost btn-xs px-1.5 text-error"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 编辑/新建表单。 */}
      <div className="space-y-3 rounded-xl border border-base-300/80 bg-base-200/20 p-3.5">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-[12px] font-medium text-neutral">配置名称</label>
            <input
              type="text"
              className="input input-bordered input-sm w-full rounded-lg text-[12px]"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-medium text-neutral">提供商预设</label>
            <select
              className="select select-bordered select-sm w-full rounded-lg text-[12px]"
              value={provider}
              onChange={(e) => {
                const next = e.target.value;
                setProvider(next);
                const preset = PROVIDER_PRESETS.find((p) => p.value === next);
                if (preset) {
                  setApiStyle(preset.apiStyle);
                  if (!editingId) {
                    setBaseUrl(preset.defaultUrl);
                    setModel(preset.defaultModel);
                  }
                }
              }}
            >
              {PROVIDER_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-[12px] font-medium text-neutral">Base URL</label>
          <input
            type="text"
            className="input input-bordered input-sm w-full rounded-lg text-[12px]"
            placeholder="例如：https://api.openai.com/v1"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className="mb-1 block text-[12px] font-medium text-neutral">模型名称 (Model)</label>
            <input
              type="text"
              className="input input-bordered input-sm w-full rounded-lg text-[12px]"
              placeholder="例如：gpt-4o-mini / deepseek-chat"
              value={model}
              onChange={(event) => setModel(event.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-medium text-neutral">超时 (ms)</label>
            <input
              type="number"
              min={3000}
              max={300000}
              className="input input-bordered input-sm w-full rounded-lg text-[12px]"
              value={timeoutMs}
              onChange={(e) => setTimeoutMs(Number(e.target.value) || 60000)}
            />
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-[12px] font-medium text-neutral">API Key（编辑时留空表示保留当前密钥）</label>
            <span className="text-[11px] text-neutral/60">
              当前状态：{editingConfig?.apiKeyConfigured ? `已配置 (${editingConfig.apiKeyMasked})` : "未配置"}
            </span>
          </div>
          <input
            type="password"
            className="input input-bordered input-sm w-full rounded-lg text-[12px]"
            placeholder="输入 API Key"
            value={apiKeyInput}
            onChange={(event) => setApiKeyInput(event.target.value)}
          />
        </div>
      </div>

      {notice && (
        <p className="flex items-center gap-1.5 text-[12px] text-primary">
          <CheckCircle2 size={13} />
          <span>{notice}</span>
        </p>
      )}

      <div className="flex justify-end gap-2">
        {editingId && (
          <button
            type="button"
            className="btn btn-outline btn-sm gap-1.5 rounded-lg"
            disabled={testingId === editingId}
            onClick={() => void handleTest(editingId)}
          >
            <Wifi size={13} />
            <span>{testingId === editingId ? "测试中..." : "测试连接"}</span>
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary btn-sm gap-1.5 rounded-lg"
          onClick={() => void handleSave()}
          disabled={saving}
        >
          <Save size={13} />
          <span>{saving ? "保存中..." : editingId ? "更新配置" : "保存新配置"}</span>
        </button>
      </div>
    </div>
  );
}

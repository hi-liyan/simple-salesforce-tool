import { useEffect, useState } from "react";
import { Save, Sparkles } from "lucide-react";
import { api } from "../../../api";
import type { LlmSettings } from "../../../types";

// AI / LLM 模型配置分区。
export function LlmSettingsSection() {
  const [settings, setSettings] = useState<LlmSettings | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    void api
      .getLlmSettings()
      .then((res) => {
        if (!active) return;
        setSettings(res);
        setBaseUrl(res.baseUrl || "");
        setModel(res.model || "");
      })
      .catch((err) => {
        if (active) setNotice(`读取 LLM 配置失败：${String(err)}`);
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleSave() {
    setSaving(true);
    setNotice("");
    try {
      const next = await api.saveLlmSettings({
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        apiKey: apiKeyInput.trim() ? apiKeyInput.trim() : undefined
      });
      setSettings(next);
      setApiKeyInput("");
      setNotice("AI / LLM 配置已保存。");
    } catch (err) {
      setNotice(`保存失败：${String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="flex items-center gap-2 text-[14px] font-semibold text-neutral">
          <Sparkles size={16} className="text-primary" />
          <span>AI 与大模型配置</span>
        </h3>
        <p className="mt-0.5 text-[12px] text-neutral/65">配置兼容 OpenAI 接口协议的模型服务地址、模型名与密钥。</p>
      </div>

      <div className="space-y-3 rounded-xl border border-base-300/80 bg-base-200/20 p-3.5">
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

        <div>
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
          <div className="mb-1 flex items-center justify-between">
            <label className="text-[12px] font-medium text-neutral">API Key（留空表示保留当前密钥）</label>
            <span className="text-[11px] text-neutral/60">
              当前状态：{settings?.apiKeyConfigured ? `已配置 (${settings.apiKeyMasked})` : "未配置"}
            </span>
          </div>
          <input
            type="password"
            className="input input-bordered input-sm w-full rounded-lg text-[12px]"
            placeholder="输入新的 API Key 以覆盖"
            value={apiKeyInput}
            onChange={(event) => setApiKeyInput(event.target.value)}
          />
        </div>
      </div>

      {notice && <p className="text-[12px] text-primary">{notice}</p>}

      <div className="flex justify-end">
        <button
          type="button"
          className="btn btn-primary btn-sm gap-1.5 rounded-lg"
          onClick={() => void handleSave()}
          disabled={saving}
        >
          <Save size={13} />
          <span>{saving ? "保存中..." : "保存配置"}</span>
        </button>
      </div>
    </div>
  );
}

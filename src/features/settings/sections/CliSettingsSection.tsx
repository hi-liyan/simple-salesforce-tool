import { useCallback, useEffect, useState } from "react";
import { Check, RefreshCw, Save, Search, Terminal } from "lucide-react";
import { api } from "../../../api";
import type { CliPathProbe, CliPathSettings, CliPathStatus } from "../../../types";

// Salesforce CLI 路径与有效性检测设置分区。
export function CliSettingsSection() {
  const [settings, setSettings] = useState<CliPathSettings | null>(null);
  const [customPathInput, setCustomPathInput] = useState("");
  const [cliStatus, setCliStatus] = useState<CliPathStatus | null>(null);
  const [detectedOptions, setDetectedOptions] = useState<CliPathProbe[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const loadCli = useCallback(async () => {
    setBusy(true);
    setNotice("");
    try {
      const next = await api.getCliPathSettings();
      setSettings(next);
      setCustomPathInput(next.customCliPath || "");
      const status = await api.checkCliPathStatus(null);
      setCliStatus(status);
    } catch (err) {
      setNotice(`读取 CLI 配置失败：${String(err)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadCli();
  }, [loadCli]);

  async function handleSave(pathValue: string | null) {
    setBusy(true);
    setNotice("");
    try {
      const next = await api.saveCliPathSettings(pathValue);
      setSettings(next);
      setCustomPathInput(next.customCliPath || "");
      const status = await api.checkCliPathStatus(null);
      setCliStatus(status);
      setNotice("CLI 路径配置已更新。");
    } catch (err) {
      setNotice(`保存失败：${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleDetect() {
    setBusy(true);
    setNotice("");
    try {
      const probes = await api.detectLocalCliPaths();
      setDetectedOptions(probes);
      if (probes.length === 0) {
        setNotice("未自动探测到 sf / sfdx CLI 可执行文件。");
      }
    } catch (err) {
      setNotice(`探测失败：${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-[14px] font-semibold text-neutral">
            <Terminal size={16} className="text-primary" />
            <span>Salesforce CLI 配置</span>
          </h3>
          <p className="mt-0.5 text-[12px] text-neutral/65">用于 OAuth 浏览器登录与同步本地已认证的 Salesforce Org。</p>
        </div>
        <button type="button" className="btn btn-ghost btn-xs gap-1 rounded-lg" onClick={() => void loadCli()} disabled={busy}>
          <RefreshCw size={12} className={busy ? "animate-spin" : ""} />
          <span>刷新状态</span>
        </button>
      </div>

      {/* 当前生效状态卡片。 */}
      <div className="rounded-xl border border-base-300/80 bg-base-200/20 p-3.5 text-[12px]">
        <div className="flex items-center justify-between">
          <span className="font-medium text-neutral">当前生效状态</span>
          <span className={`badge badge-sm ${cliStatus?.ok ? "badge-success" : "badge-error"}`}>
            {cliStatus?.ok ? "可用" : "不可用"}
          </span>
        </div>
        <div className="mt-2 space-y-1 text-[11px] text-neutral/75">
          <div>生效路径：{settings?.resolvedCliPath || "默认 PATH 查找 (sf)"}</div>
          <div>版本信息：{cliStatus?.version || "-"}</div>
          {cliStatus && !cliStatus.ok && cliStatus.detail && <div className="text-error">错误：{cliStatus.detail}</div>}
        </div>
      </div>

      {/* 自定义路径输入。 */}
      <div className="space-y-2.5 rounded-xl border border-base-300/80 bg-base-200/20 p-3.5">
        <label className="block text-[12px] font-medium text-neutral">自定义 CLI 可执行路径</label>
        <div className="flex gap-2">
          <input
            type="text"
            className="input input-bordered input-sm flex-1 rounded-lg text-[12px]"
            placeholder="留空表示使用系统 PATH 自动查找"
            value={customPathInput}
            onChange={(event) => setCustomPathInput(event.target.value)}
          />
          <button
            type="button"
            className="btn btn-outline btn-sm gap-1 rounded-lg"
            onClick={() => void handleDetect()}
            disabled={busy}
          >
            <Search size={13} />
            <span>探测本机</span>
          </button>
        </div>

        {detectedOptions.length > 0 && (
          <div className="space-y-1 pt-1">
            {detectedOptions.map((opt) => (
              <button
                key={opt.path}
                type="button"
                onClick={() => setCustomPathInput(opt.path)}
                className="flex w-full items-center justify-between rounded-lg border border-base-300 bg-base-100 px-2.5 py-1.5 text-left text-[11px] hover:border-primary/50"
              >
                <span className="truncate font-mono">{opt.path}</span>
                <span className="ml-2 shrink-0 text-neutral/60">{opt.version || "已探测"}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {notice && <p className="text-[12px] text-primary">{notice}</p>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="btn btn-ghost btn-sm rounded-lg"
          onClick={() => void handleSave(null)}
          disabled={busy}
        >
          恢复默认
        </button>
        <button
          type="button"
          className="btn btn-outline btn-sm gap-1 rounded-lg"
          onClick={() =>
            void api
              .checkCliPathStatus(customPathInput.trim() || null)
              .then((st) => {
                setCliStatus(st);
                setNotice(st.ok ? "路径检测有效。" : `路径无效：${st.detail || "未知错误"}`);
              })
          }
          disabled={busy}
        >
          <Check size={13} />
          <span>检测有效</span>
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm gap-1 rounded-lg"
          onClick={() => void handleSave(customPathInput.trim() || null)}
          disabled={busy}
        >
          <Save size={13} />
          <span>保存路径</span>
        </button>
      </div>
    </div>
  );
}

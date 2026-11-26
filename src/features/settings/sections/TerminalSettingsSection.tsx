import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Save, TerminalSquare } from "lucide-react";
import { api } from "../../../api";
import type { TerminalShellOption } from "../../../types";

// 匹配绝对路径或命令名后缀。
function findShellOption(options: TerminalShellOption[], commandValue: string): TerminalShellOption | null {
  const normalized = commandValue.trim().toLowerCase();
  if (!normalized) return null;
  const exact = options.find((opt) => opt.command.trim().toLowerCase() === normalized);
  if (exact) return exact;
  return (
    options.find((opt) => {
      const cmd = opt.command.trim().toLowerCase();
      return cmd.endsWith(`\\${normalized}`) || cmd.endsWith(`/${normalized}`);
    }) || null
  );
}

// 终端与 Shell 设置分区：动态探测本机 Shell 并保存首选路径。
export function TerminalSettingsSection() {
  const [options, setOptions] = useState<TerminalShellOption[]>([]);
  const [shellCommand, setShellCommand] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const isWindows = useMemo(() => /Win/i.test(navigator.platform || navigator.userAgent), []);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setNotice("");
    try {
      const [detected, saved] = await Promise.all([
        api.listAvailableTerminalShells(),
        api.getTerminalShellSettings()
      ]);
      setOptions(detected);
      const matched = findShellOption(detected, saved.commandValue || saved.legacyPreference || "");
      setShellCommand(matched ? matched.command : detected[0]?.command || saved.commandValue || "");
    } catch (err) {
      setNotice(`读取终端配置失败：${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  async function handleSave() {
    const selected = findShellOption(options, shellCommand);
    const targetPath = selected?.command || shellCommand.trim();
    if (!targetPath) {
      setNotice("请选择有效的 Shell 路径。");
      return;
    }
    setSaving(true);
    setNotice("");
    try {
      await api.saveTerminalShellCommand(targetPath);
      setNotice("默认 Shell 已保存，新建终端 Tab 将使用该配置。");
    } catch (err) {
      setNotice(`保存失败：${String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-[14px] font-semibold text-neutral">
            <TerminalSquare size={16} className="text-primary" />
            <span>终端与 Shell 配置</span>
          </h3>
          <p className="mt-0.5 text-[12px] text-neutral/65">
            配置底部集成终端（Ctrl + `）默认启动的 Shell 程序，自动探测本机可用环境。
          </p>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-xs gap-1 rounded-lg"
          onClick={() => void loadSettings()}
          disabled={loading}
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          <span>重新探测</span>
        </button>
      </div>

      <div className="space-y-3 rounded-xl border border-base-300/80 bg-base-200/20 p-3.5">
        <div>
          <label className="mb-1 block text-[12px] font-medium text-neutral">首选 Shell</label>
          <select
            className="select select-bordered select-sm w-full rounded-lg text-[12px]"
            value={shellCommand}
            disabled={loading}
            onChange={(event) => setShellCommand(event.target.value)}
          >
            {options.map((opt) => (
              <option key={opt.command} value={opt.command}>
                {opt.label} ({opt.command})
              </option>
            ))}
          </select>
        </div>

        <p className="text-[11px] text-neutral/60">
          {isWindows
            ? "Windows 平台支持 PowerShell 7 (pwsh.exe)、Windows PowerShell、CMD 与 Git Bash。"
            : "macOS / Linux 平台支持 zsh、bash、fish 等系统默认 Shell。"}
        </p>
      </div>

      {notice && <p className="text-[12px] text-primary">{notice}</p>}

      <div className="flex justify-end">
        <button
          type="button"
          className="btn btn-primary btn-sm gap-1.5 rounded-lg"
          onClick={() => void handleSave()}
          disabled={saving || loading}
        >
          <Save size={13} />
          <span>{saving ? "保存中..." : "保存配置"}</span>
        </button>
      </div>
    </div>
  );
}

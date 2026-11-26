import { useMemo, useState } from "react";
import { Info, Search, Settings, ShieldCheck, Sparkles, Terminal, TerminalSquare, X } from "lucide-react";
import { AboutSettingsSection } from "./sections/AboutSettingsSection";
import { CliSettingsSection } from "./sections/CliSettingsSection";
import { LlmSettingsSection } from "./sections/LlmSettingsSection";
import { QuerySafetySection } from "./sections/QuerySafetySection";
import { TerminalSettingsSection } from "./sections/TerminalSettingsSection";

export type SettingsSectionKey = "query-safety" | "terminal" | "cli" | "llm" | "about";

type SettingsModalProps = {
  // 是否打开设置中心弹窗。
  open: boolean;
  // 关闭弹窗回调。
  onClose: () => void;
  // 可选初始定位分区。
  initialSection?: SettingsSectionKey;
};

const SETTINGS_NAV_ITEMS: {
  key: SettingsSectionKey;
  label: string;
  keywords: string;
  icon: typeof Settings;
}[] = [
  { key: "query-safety", label: "查询与安全", keywords: "limit 安全 生产 审计 脱敏", icon: ShieldCheck },
  { key: "terminal", label: "终端与 Shell", keywords: "terminal shell powershell bash zsh", icon: TerminalSquare },
  { key: "cli", label: "Salesforce CLI", keywords: "cli sf sfdx path oauth", icon: Terminal },
  { key: "llm", label: "AI 与大模型", keywords: "ai llm openai model api key", icon: Sparkles },
  { key: "about", label: "关于与更新", keywords: "about version update github feedback", icon: Info }
];

// DBX 风格设置中心弹窗：左侧分类导航与搜索 + 右侧模块化配置面板。
export function SettingsModal({ open, onClose, initialSection = "query-safety" }: SettingsModalProps) {
  const [activeKey, setActiveKey] = useState<SettingsSectionKey>(initialSection);
  const [searchKeyword, setSearchKeyword] = useState("");

  const filteredNavItems = useMemo(() => {
    const q = searchKeyword.trim().toLowerCase();
    if (!q) return SETTINGS_NAV_ITEMS;
    return SETTINGS_NAV_ITEMS.filter(
      (item) => item.label.toLowerCase().includes(q) || item.keywords.toLowerCase().includes(q)
    );
  }, [searchKeyword]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[105] flex items-center justify-center bg-black/30 backdrop-blur-[2px]" onClick={onClose}>
      <div
        className="flex h-[580px] max-h-[90vh] w-[840px] max-w-[94vw] flex-col overflow-hidden rounded-2xl border border-base-300 bg-base-100 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        {/* 弹窗顶栏。 */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-base-300/80 px-4">
          <div className="flex items-center gap-2">
            <Settings size={16} className="text-primary" />
            <h2 className="text-[14px] font-semibold text-neutral">应用设置</h2>
            <span className="rounded bg-base-200 px-1.5 py-0.5 font-mono text-[10px] text-neutral/60">Ctrl + ,</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral/70 hover:bg-base-200"
          >
            <X size={15} />
          </button>
        </div>

        {/* 主体左右分栏。 */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <aside className="flex w-[210px] shrink-0 flex-col border-r border-base-300/80 bg-base-200/35 p-2.5">
            <label className="mb-2.5 flex h-8 items-center gap-1.5 rounded-lg border border-base-300 bg-base-100 px-2">
              <Search size={13} className="shrink-0 text-neutral/50" />
              <input
                type="text"
                className="min-w-0 flex-1 bg-transparent text-[12px] outline-none"
                placeholder="搜索设置项..."
                value={searchKeyword}
                onChange={(event) => setSearchKeyword(event.target.value)}
              />
              {searchKeyword && (
                <button type="button" onClick={() => setSearchKeyword("")} className="text-neutral/50 hover:text-neutral">
                  <X size={12} />
                </button>
              )}
            </label>

            <nav className="space-y-1">
              {filteredNavItems.map((item) => {
                const Icon = item.icon;
                const active = activeKey === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setActiveKey(item.key)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] transition-colors ${
                      active ? "bg-primary/12 font-semibold text-primary" : "text-neutral/80 hover:bg-base-100/80"
                    }`}
                  >
                    <Icon size={14} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>

          {/* 右侧设置分区内容。 */}
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {activeKey === "query-safety" && <QuerySafetySection />}
            {activeKey === "terminal" && <TerminalSettingsSection />}
            {activeKey === "cli" && <CliSettingsSection />}
            {activeKey === "llm" && <LlmSettingsSection />}
            {activeKey === "about" && <AboutSettingsSection />}
          </div>
        </div>
      </div>
    </div>
  );
}

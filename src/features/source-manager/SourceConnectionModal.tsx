import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Database, Eye, EyeOff, Globe, Lock, ShieldAlert, X } from "lucide-react";
import { api } from "../../api";
import { getDataSourceDriver, listDataSourceDrivers } from "../../drivers/registry";
import type { ConnectionCommonMeta, DataSourceDriver, DriverConnectionField } from "../../drivers/types";
import type { SalesforceSource } from "../../types";
import { getSourceColor, SOURCE_COLOR_PRESETS } from "../main/QueryPanel/logic/sourceColor";

export type SourceConnectionModalMode = "create" | "edit" | "duplicate";

type SourceConnectionModalProps = {
  // 是否打开弹窗。
  open: boolean;
  // 模式：新建、编辑、复制。
  mode: SourceConnectionModalMode;
  // 编辑或复制时的目标数据源。
  source?: SalesforceSource | null;
  // 关闭弹窗回调。
  onClose: () => void;
  // 保存成功回调（返回创建或更新后的数据源 ID）。
  onSaved: (sourceId?: string) => Promise<void> | void;
  // 触发 OAuth 浏览器授权窗口回调。
  onOpenOAuthWindow?: () => void;
};

// 初始化驱动字段默认值。
function buildDefaultValues(driver: DataSourceDriver): Record<string, string> {
  const result: Record<string, string> = {};
  driver.connectionSchema.fields.forEach((field) => {
    result[field.key] = field.defaultValue ?? "";
  });
  return result;
}

// 统一新建/编辑/复制数据源弹窗：由 DataSourceDriver.connectionSchema 驱动，零硬编码分支。
export function SourceConnectionModal({
  open,
  mode,
  source,
  onClose,
  onSaved,
  onOpenOAuthWindow
}: SourceConnectionModalProps) {
  const drivers = useMemo(() => listDataSourceDrivers(), []);

  // 当前选中的驱动类型。
  const [selectedKind, setSelectedKind] = useState<string>(drivers[0]?.kind || "salesforce");
  // 通用连接元信息。
  const [commonMeta, setCommonMeta] = useState<ConnectionCommonMeta>({
    name: "",
    color: "",
    environment: "default",
    readOnly: false
  });
  // 驱动专属字段值。
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  // 密码字段明文切换映射。
  const [revealedKeys, setRevealedKeys] = useState<Record<string, boolean>>({});
  // 高级配置区折叠状态。
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // 编辑态密钥加载中。
  const [hydrating, setHydrating] = useState(false);
  // 提交保存中。
  const [submitting, setSubmitting] = useState(false);
  // 连接测试中。
  const [testing, setTesting] = useState(false);
  // 测试或保存反馈消息。
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const activeDriver = useMemo(() => getDataSourceDriver(selectedKind), [selectedKind]);
  const isCliManaged = useMemo(
    () => mode === "edit" && Boolean(source && activeDriver.connectionSchema.isCliManagedSource?.(source)),
    [mode, source, activeDriver]
  );

  // 打开弹窗时初始化表单或回填现有数据源与密钥。
  useEffect(() => {
    if (!open) return;
    setFeedback(null);
    setRevealedKeys({});
    setAdvancedOpen(false);

    if (mode === "create" || !source) {
      const initialDriver = drivers[0] || activeDriver;
      setSelectedKind(initialDriver.kind);
      setCommonMeta({ name: "", color: "", environment: "default", readOnly: false });
      setFieldValues(buildDefaultValues(initialDriver));
      return;
    }

    const driver = getDataSourceDriver(source.sourceType);
    setSelectedKind(driver.kind);
    const cfg = (source.configJson || {}) as Record<string, unknown>;
    const envRaw = String(cfg.environment || "default");
    const environment: ConnectionCommonMeta["environment"] =
      envRaw === "prod" || envRaw === "staging" ? envRaw : "default";
    setCommonMeta({
      name: mode === "duplicate" ? `${source.name} (副本)` : source.name,
      color: getSourceColor(source),
      environment,
      readOnly: Boolean(cfg.readOnly)
    });
    setFieldValues(driver.connectionSchema.extractFormValues(source, null));

    let active = true;
    setHydrating(true);
    void api
      .getSourceSecretView(source.id)
      .then((secretView) => {
        if (!active) return;
        setFieldValues(driver.connectionSchema.extractFormValues(source, secretView));
      })
      .catch(() => {})
      .finally(() => {
        if (active) setHydrating(false);
      });

    return () => {
      active = false;
    };
  }, [open, mode, source, drivers]);

  // 切换驱动类型（仅新建模式可用）。
  function handleSelectDriver(kind: string) {
    if (mode !== "create") return;
    const nextDriver = getDataSourceDriver(kind);
    setSelectedKind(nextDriver.kind);
    setFieldValues(buildDefaultValues(nextDriver));
    setFeedback(null);
  }

  // 测试当前配置连通性。
  async function handleTestConnection() {
    setFeedback(null);
    setTesting(true);
    const startedAt = performance.now();
    try {
      const payload = activeDriver.connectionSchema.buildPayload(fieldValues, commonMeta);
      await api.testSourceConnection(payload);
      const elapsed = Math.max(1, Math.round(performance.now() - startedAt));
      setFeedback({ tone: "success", text: `连接测试成功（耗时 ${elapsed} ms）` });
    } catch (err) {
      setFeedback({ tone: "error", text: `连接测试失败：${String(err)}` });
    } finally {
      setTesting(false);
    }
  }

  // 保存数据源（新建、更新或复制）。
  async function handleSave() {
    if (!commonMeta.name.trim()) {
      setFeedback({ tone: "error", text: "请输入数据源名称" });
      return;
    }
    setFeedback(null);
    setSubmitting(true);
    try {
      const payload = activeDriver.connectionSchema.buildPayload(fieldValues, commonMeta);
      let saved: SalesforceSource;
      if (mode === "edit" && source) {
        saved = await api.updateSource(source.id, payload);
      } else {
        saved = await api.createSource(payload);
      }
      await onSaved(saved.id);
      onClose();
    } catch (err) {
      setFeedback({ tone: "error", text: `保存失败：${String(err)}` });
    } finally {
      setSubmitting(false);
    }
  }

  // 渲染单个驱动声明字段。
  function renderDriverField(field: DriverConnectionField) {
    const value = fieldValues[field.key] ?? "";
    const isPassword = field.type === "password";
    const revealed = Boolean(revealedKeys[field.key]);
    const disabled = isCliManaged && field.key !== "apiVersion";

    return (
      <div key={field.key} className={field.colSpan === 2 ? "col-span-2" : "col-span-1"}>
        <label className="mb-1 flex items-center gap-1 text-[11px] font-medium text-neutral/80">
          <span>{field.label}</span>
          {field.required && <span className="text-error">*</span>}
        </label>
        <div className="relative">
          <input
            type={isPassword && !revealed ? "password" : field.type === "number" ? "number" : "text"}
            className="input input-bordered input-sm w-full rounded-lg pr-8 text-[12px]"
            placeholder={field.placeholder}
            value={value}
            disabled={disabled || hydrating}
            onChange={(event) => setFieldValues((prev) => ({ ...prev, [field.key]: event.target.value }))}
          />
          {isPassword && (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setRevealedKeys((prev) => ({ ...prev, [field.key]: !prev[field.key] }))}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral/50 hover:text-neutral"
              title={revealed ? "隐藏" : "显示"}
            >
              {revealed ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          )}
        </div>
        {field.helpText && <p className="mt-0.5 text-[10px] text-neutral/60">{field.helpText}</p>}
      </div>
    );
  }

  if (!open) return null;

  const authFields = activeDriver.connectionSchema.fields.filter((f) => f.group === "auth");
  const advancedFields = activeDriver.connectionSchema.fields.filter((f) => f.group === "advanced");
  const modalTitle = mode === "edit" ? `编辑连接 · ${source?.name || ""}` : mode === "duplicate" ? "复制连接" : "新建数据源连接";

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/30 backdrop-blur-[2px]" onClick={onClose}>
      <div
        className="flex h-[580px] max-h-[90vh] w-[780px] max-w-[94vw] flex-col overflow-hidden rounded-2xl border border-base-300 bg-base-100 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        {/* 弹窗标题栏。 */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-base-300/80 px-4">
          <div className="flex items-center gap-2">
            <Database size={16} className="text-primary" />
            <h2 className="text-[14px] font-semibold text-neutral">{modalTitle}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral/70 hover:bg-base-200"
          >
            <X size={15} />
          </button>
        </div>

        {/* 主体区域：新建模式显示左侧驱动列表 + 右侧表单；编辑/复制模式聚焦右侧表单。 */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {mode === "create" && (
            <aside className="w-[220px] shrink-0 overflow-y-auto border-r border-base-300/80 bg-base-200/35 p-2.5">
              <div className="mb-2 px-1.5 text-[11px] font-semibold text-neutral/60">选择数据源驱动</div>
              <div className="space-y-1.5">
                {drivers.map((driver) => {
                  const active = driver.kind === activeDriver.kind;
                  return (
                    <button
                      key={driver.kind}
                      type="button"
                      onClick={() => handleSelectDriver(driver.kind)}
                      className={`flex w-full flex-col items-start rounded-xl border p-2.5 text-left transition-colors ${
                        active
                          ? "border-primary/50 bg-primary/8 shadow-2xs"
                          : "border-transparent bg-base-100/70 hover:border-base-300 hover:bg-base-100"
                      }`}
                    >
                      <div className="flex w-full items-center justify-between gap-2">
                        <span className="text-[12px] font-semibold text-neutral">{driver.displayName}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${driver.badgeClassName}`}>
                          {driver.badgeLabel}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[10.5px] leading-relaxed text-neutral/65">
                        {driver.connectionSchema.description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </aside>
          )}

          {/* 右侧表单区。 */}
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {/* 驱动提示条或 CLI 托管提示。 */}
            {isCliManaged && (
              <div className="mb-3 rounded-xl border border-info/35 bg-info/10 px-3 py-2 text-[11.5px] text-neutral/85">
                当前数据源由 Salesforce CLI 自动同步托管，连接凭证不支持手动修改；您仍可调整名称、环境标识、只读锁与颜色标签。
              </div>
            )}

            {/* OAuth 快捷授权入口（仅支持驱动）。 */}
            {activeDriver.connectionSchema.supportsOAuthLogin && onOpenOAuthWindow && !isCliManaged && (
              <div className="mb-3 flex items-center justify-between rounded-xl border border-primary/30 bg-primary/5 px-3 py-2">
                <div className="flex items-center gap-2 text-[12px]">
                  <Globe size={14} className="text-primary" />
                  <span className="text-neutral/85">推荐使用浏览器 OAuth 授权自动同步 Org 凭证</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenOAuthWindow();
                  }}
                  className="btn btn-primary btn-xs rounded-lg"
                >
                  OAuth 浏览器登录
                </button>
              </div>
            )}

            {/* 通用元信息分组。 */}
            <div className="rounded-xl border border-base-300/80 bg-base-200/20 p-3">
              <div className="mb-2.5 flex items-center justify-between">
                <span className="text-[12px] font-semibold text-neutral">常规与安全配置</span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${activeDriver.badgeClassName}`}>
                  {activeDriver.displayName}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-neutral/80">
                    连接名称 <span className="text-error">*</span>
                  </label>
                  <input
                    autoFocus
                    type="text"
                    className="input input-bordered input-sm w-full rounded-lg text-[12px]"
                    placeholder="例如：生产库 / UAT Sandbox"
                    value={commonMeta.name}
                    onChange={(event) => setCommonMeta((prev) => ({ ...prev, name: event.target.value }))}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-medium text-neutral/80">环境标识</label>
                  <select
                    className="select select-bordered select-sm w-full rounded-lg text-[12px]"
                    value={commonMeta.environment}
                    onChange={(event) =>
                      setCommonMeta((prev) => ({
                        ...prev,
                        environment: event.target.value as ConnectionCommonMeta["environment"]
                      }))
                    }
                  >
                    <option value="default">默认 / 开发 (default)</option>
                    <option value="staging">预发 / 测试 (staging)</option>
                    <option value="prod">生产环境 (prod · 写操作二次确认)</option>
                  </select>
                </div>

                {/* 只读锁定开关。 */}
                <label className="col-span-2 flex cursor-pointer items-center justify-between rounded-lg border border-base-300/70 bg-base-100 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Lock size={13} className={commonMeta.readOnly ? "text-warning" : "text-neutral/50"} />
                    <div>
                      <div className="text-[12px] font-medium text-neutral">只读保护模式 (Read-Only)</div>
                      <div className="text-[10.5px] text-neutral/60">开启后后端安全网关将硬拦截一切写操作与 DDL</div>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    className="toggle toggle-warning toggle-sm"
                    checked={commonMeta.readOnly}
                    onChange={(event) => setCommonMeta((prev) => ({ ...prev, readOnly: event.target.checked }))}
                  />
                </label>

                {/* 标签颜色预设。 */}
                <div className="col-span-2 flex items-center justify-between pt-0.5">
                  <span className="text-[11px] font-medium text-neutral/75">来源标签颜色</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setCommonMeta((prev) => ({ ...prev, color: "" }))}
                      className={`rounded-md border px-2 py-0.5 text-[10.5px] ${
                        !commonMeta.color ? "border-primary bg-primary/10 text-primary" : "border-base-300 text-neutral/65"
                      }`}
                    >
                      无颜色
                    </button>
                    {SOURCE_COLOR_PRESETS.map((preset) => {
                      const active = commonMeta.color.toUpperCase() === preset.color.toUpperCase();
                      return (
                        <button
                          key={preset.color}
                          type="button"
                          title={preset.label}
                          onClick={() => setCommonMeta((prev) => ({ ...prev, color: preset.color }))}
                          className={`h-5 w-5 rounded-full border-2 transition-transform ${
                            active ? "scale-110 border-neutral" : "border-transparent hover:scale-105"
                          }`}
                          style={{ backgroundColor: preset.color }}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* 驱动连接认证字段。 */}
            <div className="mt-3 rounded-xl border border-base-300/80 bg-base-200/20 p-3">
              <div className="mb-2.5 text-[12px] font-semibold text-neutral">连接与认证参数</div>
              <div className="grid grid-cols-2 gap-2.5">{authFields.map(renderDriverField)}</div>
            </div>

            {/* 高级参数折叠区。 */}
            {advancedFields.length > 0 && (
              <div className="mt-3 rounded-xl border border-base-300/80 bg-base-200/20">
                <button
                  type="button"
                  onClick={() => setAdvancedOpen((prev) => !prev)}
                  className="flex w-full items-center justify-between px-3 py-2 text-[12px] font-medium text-neutral/80"
                >
                  <span>高级选项</span>
                  {advancedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                {advancedOpen && <div className="grid grid-cols-2 gap-2.5 border-t border-base-300/60 p-3">{advancedFields.map(renderDriverField)}</div>}
              </div>
            )}

            {/* 测试或保存结果提示。 */}
            {feedback && (
              <div
                className={`mt-3 flex items-center gap-2 rounded-xl border px-3 py-2 text-[12px] ${
                  feedback.tone === "success"
                    ? "border-success/40 bg-success/10 text-success"
                    : "border-error/40 bg-error/10 text-error"
                }`}
              >
                {feedback.tone === "success" ? <CheckCircle2 size={14} /> : <ShieldAlert size={14} />}
                <span className="min-w-0 flex-1 break-all">{feedback.text}</span>
              </div>
            )}
          </div>
        </div>

        {/* 底部操作栏。 */}
        <div className="flex h-13 shrink-0 items-center justify-between border-t border-base-300/80 bg-base-200/25 px-4 py-2.5">
          <button
            type="button"
            className="btn btn-outline btn-sm rounded-lg"
            onClick={() => void handleTestConnection()}
            disabled={testing || submitting || hydrating}
          >
            {testing ? "测试中..." : "测试连接"}
          </button>
          <div className="flex items-center gap-2">
            <button type="button" className="btn btn-ghost btn-sm rounded-lg" onClick={onClose} disabled={submitting}>
              取消
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm rounded-lg"
              onClick={() => void handleSave()}
              disabled={submitting || hydrating}
            >
              {submitting ? "保存中..." : mode === "edit" ? "保存变更" : "创建连接"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

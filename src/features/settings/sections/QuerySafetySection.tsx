import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { api } from "../../../api";

// app_settings 持久化键名。
const KEY_DEFAULT_LIMIT = "query.defaultLimit";
const KEY_CONFIRM_PROD = "query.confirmProdWrite";
const KEY_AUDIT_MASK = "audit.maskLiterals";

// 查询与安全设置分区：按 key 增量读写 app_settings。
export function QuerySafetySection() {
  const [defaultLimit, setDefaultLimit] = useState("200");
  const [confirmProdWrite, setConfirmProdWrite] = useState(true);
  const [auditMaskLiterals, setAuditMaskLiterals] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    void Promise.all([
      api.getAppSetting(KEY_DEFAULT_LIMIT).catch(() => null),
      api.getAppSetting(KEY_CONFIRM_PROD).catch(() => null),
      api.getAppSetting(KEY_AUDIT_MASK).catch(() => null)
    ]).then(([limitRaw, prodRaw, maskRaw]) => {
      if (!active) return;
      if (limitRaw) setDefaultLimit(limitRaw);
      if (prodRaw !== null) setConfirmProdWrite(prodRaw !== "false");
      if (maskRaw !== null) setAuditMaskLiterals(maskRaw === "true");
    });
    return () => {
      active = false;
    };
  }, []);

  async function handleSave() {
    setSaving(true);
    setNotice("");
    try {
      const safeLimit = String(Math.max(10, Math.min(5000, Number(defaultLimit) || 200)));
      setDefaultLimit(safeLimit);
      await Promise.all([
        api.setAppSetting(KEY_DEFAULT_LIMIT, safeLimit),
        api.setAppSetting(KEY_CONFIRM_PROD, String(confirmProdWrite)),
        api.setAppSetting(KEY_AUDIT_MASK, String(auditMaskLiterals))
      ]);
      setNotice("查询与安全偏好已保存。");
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
          <ShieldCheck size={16} className="text-primary" />
          <span>查询与安全策略</span>
        </h3>
        <p className="mt-0.5 text-[12px] text-neutral/65">配置 SQL 控制台默认分页限制、生产环境写保护与审计脱敏策略。</p>
      </div>

      <div className="space-y-3 rounded-xl border border-base-300/80 bg-base-200/20 p-3.5">
        <div>
          <label className="mb-1 block text-[12px] font-medium text-neutral">默认查询分页行数 (LIMIT)</label>
          <input
            type="number"
            min={10}
            max={5000}
            className="input input-bordered input-sm w-44 rounded-lg"
            value={defaultLimit}
            onChange={(event) => setDefaultLimit(event.target.value)}
          />
          <p className="mt-1 text-[11px] text-neutral/60">未显式指定 LIMIT 的查询将自动追加分页上限，防止大表 OOM。</p>
        </div>

        <label className="flex cursor-pointer items-center justify-between rounded-lg border border-base-300/70 bg-base-100 px-3 py-2.5">
          <div>
            <div className="text-[12px] font-medium text-neutral">生产环境写操作强制二次确认</div>
            <div className="text-[11px] text-neutral/60">当数据源标记为 prod 时，执行 INSERT/UPDATE/DELETE 前弹出风险提示</div>
          </div>
          <input
            type="checkbox"
            className="toggle toggle-primary toggle-sm"
            checked={confirmProdWrite}
            onChange={(event) => setConfirmProdWrite(event.target.checked)}
          />
        </label>

        <label className="flex cursor-pointer items-center justify-between rounded-lg border border-base-300/70 bg-base-100 px-3 py-2.5">
          <div>
            <div className="text-[12px] font-medium text-neutral">SQL 审计日志脱敏模式</div>
            <div className="text-[11px] text-neutral/60">对写入 sql_execution_audit 的敏感字面量参数进行掩码记录</div>
          </div>
          <input
            type="checkbox"
            className="toggle toggle-primary toggle-sm"
            checked={auditMaskLiterals}
            onChange={(event) => setAuditMaskLiterals(event.target.checked)}
          />
        </label>
      </div>

      {notice && <p className="text-[12px] text-primary">{notice}</p>}

      <div className="flex justify-end">
        <button type="button" className="btn btn-primary btn-sm rounded-lg" onClick={() => void handleSave()} disabled={saving}>
          {saving ? "保存中..." : "保存设置"}
        </button>
      </div>
    </div>
  );
}

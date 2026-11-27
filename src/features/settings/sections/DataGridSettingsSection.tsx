import { useEffect, useState } from "react";
import { Table2 } from "lucide-react";
import { useDataGridHeaderSettingsStore } from "../../../store/useDataGridHeaderSettingsStore";

// 数据表格设置分区：控制查询结果表格表头显示项，按 key 独立持久化至 app_settings。
export function DataGridSettingsSection() {
  const showHeaderFieldType = useDataGridHeaderSettingsStore((state) => state.showHeaderFieldType);
  const showHeaderFieldComment = useDataGridHeaderSettingsStore((state) => state.showHeaderFieldComment);
  const hydrate = useDataGridHeaderSettingsStore((state) => state.hydrate);
  const setShowHeaderFieldType = useDataGridHeaderSettingsStore((state) => state.setShowHeaderFieldType);
  const setShowHeaderFieldComment = useDataGridHeaderSettingsStore((state) => state.setShowHeaderFieldComment);

  // 操作反馈提示文本。
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // 切换“显示表头字段类型”开关并立即落盘。
  async function handleToggleHeaderType(checked: boolean) {
    setNotice("");
    try {
      await setShowHeaderFieldType(checked);
      setNotice("表头字段类型显示偏好已更新。");
    } catch (error) {
      setNotice(`保存失败：${String(error)}`);
    }
  }

  // 切换“显示表头字段注释”开关并立即落盘。
  async function handleToggleHeaderComment(checked: boolean) {
    setNotice("");
    try {
      await setShowHeaderFieldComment(checked);
      setNotice("表头字段注释显示偏好已更新。");
    } catch (error) {
      setNotice(`保存失败：${String(error)}`);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="flex items-center gap-2 text-[14px] font-semibold text-neutral">
          <Table2 size={16} className="text-primary" />
          <span>数据表格表头</span>
        </h3>
        <p className="mt-0.5 text-[12px] text-neutral/65">
          配置查询结果表格表头展示信息，关闭后将自动收紧表头高度。
        </p>
      </div>

      {/* 表头展示开关列表。 */}
      <div className="space-y-3 rounded-xl border border-base-300/80 bg-base-200/20 p-3.5">
        {/* 开关：显示表头字段类型。 */}
        <label className="flex cursor-pointer items-center justify-between rounded-lg border border-base-300/70 bg-base-100 px-3 py-2.5">
          <div>
            <div className="text-[12px] font-medium text-neutral">显示表头字段类型</div>
            <div className="text-[11px] text-neutral/60">
              在表头第二行展示列数据类型并按类型语义着色（如 int、varchar、datetime）
            </div>
          </div>
          <input
            type="checkbox"
            className="toggle toggle-primary toggle-sm"
            checked={showHeaderFieldType}
            onChange={(event) => void handleToggleHeaderType(event.target.checked)}
          />
        </label>

        {/* 开关：显示表头字段注释。 */}
        <label className="flex cursor-pointer items-center justify-between rounded-lg border border-base-300/70 bg-base-100 px-3 py-2.5">
          <div>
            <div className="text-[12px] font-medium text-neutral">显示表头字段注释</div>
            <div className="text-[11px] text-neutral/60">
              在表头第三行展示字段注释（MySQL 显示 comment，Salesforce 显示字段 label）
            </div>
          </div>
          <input
            type="checkbox"
            className="toggle toggle-primary toggle-sm"
            checked={showHeaderFieldComment}
            onChange={(event) => void handleToggleHeaderComment(event.target.checked)}
          />
        </label>
      </div>

      {notice && <p className="text-[12px] text-primary">{notice}</p>}
    </div>
  );
}

import { Plus, RefreshCw } from "lucide-react";
import { ObjectList } from "../../components/ObjectList";
import { SalesforceObject, SalesforceSource } from "../../types";

type LeftSidebarProps = {
  sources: SalesforceSource[];
  selectedSourceId: string;
  pageLoading: boolean;
  objectsLoading: boolean;
  onOpenAuthWindow: () => void;
  onChangeSource: (sourceId: string) => void;
  onRefreshSources: () => void;
  objects: SalesforceObject[];
  activeTabObjectName: string;
  onOpenObject: (item: SalesforceObject) => void;
};

// 左侧栏：数据源选择与对象列表。
export function LeftSidebar({
  sources,
  selectedSourceId,
  pageLoading,
  objectsLoading,
  onOpenAuthWindow,
  onChangeSource,
  onRefreshSources,
  objects,
  activeTabObjectName,
  onOpenObject
}: LeftSidebarProps) {
  return (
    <>
      {/* 数据源标题与新增按钮区域。 */}
      <div className="border-b border-base-300 px-3 py-2">
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-neutral/70">DATA SOURCE</span>
          <button className="btn btn-ghost btn-square btn-sm" aria-label="新增 Salesforce 认证" onClick={onOpenAuthWindow} disabled={pageLoading}>
            <Plus size={14} />
          </button>
        </div>

        {/* 数据源下拉与刷新按钮。 */}
        <div className="mt-[6px] flex flex-row gap-2">
          <select
            className="select select-bordered select-sm w-full"
            value={selectedSourceId}
            onChange={(event) => onChangeSource(event.target.value)}
          >
            <option value="">请选择数据源</option>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </select>
          <button className="btn btn-primary btn-sm" onClick={onRefreshSources} disabled={pageLoading}>
            <RefreshCw size={14} />
            刷新
          </button>
        </div>
      </div>

      {/* Objects 区块标题。 */}
      <div className="border-b border-base-300 px-3 py-2">
        <span className="text-[12px] text-neutral/70">OBJECTS</span>
      </div>

      {/* 对象列表内容区。 */}
      <div className="min-h-0 flex-1 px-3 pb-3 pt-2">
        {objectsLoading ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-neutral/70">
            <span className="loading loading-spinner" style={{ width: 18, height: 18 }} />
            <span className="text-[12px]">拉取 Object 列表中...</span>
          </div>
        ) : (
          <ObjectList objects={objects} activeObjectName={activeTabObjectName} onOpenObject={onOpenObject} />
        )}
      </div>
    </>
  );
}

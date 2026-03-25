import { ObjectList } from "../../../../components/ObjectList";
import { ObjectDdl, ObjectDescribe, SalesforceObject, SalesforceSource } from "../../../../types";
import { useObjectTreeData } from "../hooks/useObjectTreeData";

type QueryObjectTreeProps = {
  // 数据源列表。
  sources: SalesforceSource[];
  // 当前选中数据源 ID。
  selectedSourceId: string;
  // 对象加载状态。
  objectsLoading: boolean;
  // 对象列表。
  objects: SalesforceObject[];
  // 当前激活对象名。
  activeTabObjectName: string;
  // 打开对象回调。
  onOpenObject: (item: SalesforceObject) => void;
  // 点击不可查询对象回调。
  onNotQueryableObjectClick?: (item: SalesforceObject) => void;
  // 刷新指定 MySQL 对象的字段元数据与 DDL。
  onRefreshMysqlObjectMetadata: (objectName: string) => Promise<{ describe: ObjectDescribe; ddl: ObjectDdl }>;
  // 对象列表展示模式：list/tree。
  objectListMode: "list" | "tree";
};

// Query 对象树：统一封装加载态与 ObjectList 渲染，供 QuerySidebar 复用。
export function QueryObjectTree({
  sources,
  selectedSourceId,
  objectsLoading,
  objects,
  activeTabObjectName,
  onOpenObject,
  onNotQueryableObjectClick,
  onRefreshMysqlObjectMetadata,
  objectListMode
}: QueryObjectTreeProps) {
  // 对象树派生数据：统一计算 sourceType 与 treeMode。
  const { selectedSourceType, treeMode } = useObjectTreeData({
    sources,
    selectedSourceId,
    objectListMode
  });

  return (
    // 对象列表内容区。
    <div className="min-h-0 flex-1 px-3 pb-3 pt-2">
      {objectsLoading ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-neutral/70">
          <span className="loading loading-spinner" style={{ width: 18, height: 18 }} />
          <span className="text-[12px]">拉取 Object 列表中...</span>
        </div>
      ) : (
        <ObjectList
          objects={objects}
          sourceId={selectedSourceId}
          sourceType={selectedSourceType}
          activeObjectName={activeTabObjectName}
          onOpenObject={onOpenObject}
          onNotQueryableClick={onNotQueryableObjectClick}
          onRefreshMysqlObjectMetadata={onRefreshMysqlObjectMetadata}
          treeMode={treeMode}
        />
      )}
    </div>
  );
}

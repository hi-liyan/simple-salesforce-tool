import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { ObjectDdl, ObjectDescribe, SalesforceObject } from "../types";
import {
  buildDisplayMetadataFromField,
  formatFieldMetadataValue,
  sortFieldMetadataEntries,
  translateFieldMetadataKey
} from "../utils/fieldMetadata";

type Props = {
  // 对象数据列表。
  objects: SalesforceObject[];
  // 当前选中的数据源 ID：用于拉取对象字段描述。
  sourceId: string;
  // 当前数据源类型：用于控制右键菜单能力项展示。
  sourceType?: string;
  // 当前激活对象名称。
  activeObjectName: string;
  // 打开对象回调。
  onOpenObject: (objectItem: SalesforceObject) => void;
  // 不可查询徽标点击回调：用于提示当前对象不可查询。
  onNotQueryableClick?: (objectItem: SalesforceObject) => void;
  // 是否使用树形模式：false 为传统列表，true 为对象-字段树。
  treeMode?: boolean;
};

// 对象列表：树形模式（对象 -> 字段 -> 字段元数据）。
export function ObjectList({ objects, sourceId, sourceType, activeObjectName, onOpenObject, onNotQueryableClick, treeMode = false }: Props) {
  // 仅 Salesforce 数据源显示 Salesforce 专属菜单。
  const isSalesforceSource = (sourceType || "salesforce").toLowerCase() === "salesforce";
  // 关键字：用于对象过滤。
  const [keyword, setKeyword] = useState("");
  // 已展开对象集合。
  const [expandedObjectNames, setExpandedObjectNames] = useState<string[]>([]);
  // 已展开字段集合（key: objectName.fieldName）。
  const [expandedFieldKeys, setExpandedFieldKeys] = useState<string[]>([]);
  // 对象描述缓存：避免重复请求 describe。
  const [describeByObjectName, setDescribeByObjectName] = useState<Record<string, ObjectDescribe>>({});
  // 对象字段加载状态。
  const [loadingByObjectName, setLoadingByObjectName] = useState<Record<string, boolean>>({});
  // 对象字段加载错误信息。
  const [errorByObjectName, setErrorByObjectName] = useState<Record<string, string>>({});
  // MySQL DDL 缓存：用于渲染“外键/索引/检查”结构节点。
  const [ddlByObjectName, setDdlByObjectName] = useState<Record<string, ObjectDdl>>({});
  // MySQL DDL 加载状态。
  const [ddlLoadingByObjectName, setDdlLoadingByObjectName] = useState<Record<string, boolean>>({});
  // MySQL DDL 加载错误信息。
  const [ddlErrorByObjectName, setDdlErrorByObjectName] = useState<Record<string, string>>({});
  // MySQL 分类节点展开集合（key: objectName:category）。
  const [expandedMysqlCategoryKeys, setExpandedMysqlCategoryKeys] = useState<string[]>([]);
  // 对象右键菜单状态：记录菜单位置与目标对象。
  const [objectContextMenu, setObjectContextMenu] = useState<{ x: number; y: number; objectItem: SalesforceObject } | null>(null);
  // 树节点单击延迟定时器：用于区分单击展开与双击打开。
  const objectNodeClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 全局关闭对象右键菜单：点击空白、滚动、按下 ESC 时关闭。
  useEffect(() => {
    if (!objectContextMenu) return;

    const closeMenu = () => {
      setObjectContextMenu(null); // 统一关闭菜单，避免浮层残留。
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeMenu(); // ESC 快捷关闭菜单。
    };

    window.addEventListener("click", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [objectContextMenu]);

  // 组件卸载时清理单击延迟定时器，避免悬空回调。
  useEffect(() => {
    return () => {
      if (!objectNodeClickTimerRef.current) return;
      clearTimeout(objectNodeClickTimerRef.current); // 释放残留定时器。
      objectNodeClickTimerRef.current = null;
    };
  }, []);

  // 过滤结果：按对象名和标签模糊匹配。
  const filtered = useMemo(() => {
    const trimmed = keyword.trim().toLowerCase();
    if (!trimmed) return objects;
    return objects.filter((item) => item.name.toLowerCase().includes(trimmed) || item.label.toLowerCase().includes(trimmed));
  }, [keyword, objects]);

  // 字段节点 key 生成器。
  function buildFieldKey(objectName: string, fieldName: string): string {
    return `${objectName}.${fieldName}`;
  }
  // MySQL 分类节点 key 生成器。
  function buildMysqlCategoryKey(objectName: string, categoryName: string): string {
    return `${objectName}:${categoryName}`;
  }

  // 展开/折叠对象节点，并在首次展开时懒加载对象结构信息。
  async function toggleObjectNode(objectItem: SalesforceObject) {
    const objectName = objectItem.name;
    const alreadyExpanded = expandedObjectNames.includes(objectName);
    const isMysqlSource = (sourceType || "salesforce").toLowerCase() === "mysql";

    // 已展开则直接折叠，避免多余请求。
    if (alreadyExpanded) {
      setExpandedObjectNames((current) => current.filter((name) => name !== objectName));
      return;
    }

    // 先更新为展开状态，提升交互响应速度。
    setExpandedObjectNames((current) => [...current, objectName]);

    // 已有缓存时不再重复请求结构。
    const hasDescribeCache = Boolean(describeByObjectName[objectName]);
    const hasDdlCache = !isMysqlSource || Boolean(ddlByObjectName[objectName]);
    if (hasDescribeCache && hasDdlCache) {
      return;
    }
    if (loadingByObjectName[objectName]) return;
    if (!sourceId) {
      setErrorByObjectName((current) => ({ ...current, [objectName]: "请先选择数据源。" }));
      return;
    }

    setLoadingByObjectName((current) => ({ ...current, [objectName]: true }));
    setErrorByObjectName((current) => ({ ...current, [objectName]: "" }));

    try {
      // 调用后端对象描述接口，后端已补齐 reference 字段 childRelationshipName。
      const describe = hasDescribeCache ? describeByObjectName[objectName] : await api.describeObject(sourceId, objectName);
      setDescribeByObjectName((current) => ({ ...current, [objectName]: describe }));
      if (!isMysqlSource || hasDdlCache) return;
      setDdlLoadingByObjectName((current) => ({ ...current, [objectName]: true }));
      setDdlErrorByObjectName((current) => ({ ...current, [objectName]: "" }));
      const ddl = await api.getObjectDdl(sourceId, objectName);
      setDdlByObjectName((current) => ({ ...current, [objectName]: ddl }));
    } catch (error) {
      setErrorByObjectName((current) => ({ ...current, [objectName]: `加载字段失败：${String(error)}` }));
      if (isMysqlSource) {
        setDdlErrorByObjectName((current) => ({ ...current, [objectName]: `加载 DDL 失败：${String(error)}` }));
      }
    } finally {
      setLoadingByObjectName((current) => ({ ...current, [objectName]: false }));
      if (isMysqlSource) {
        setDdlLoadingByObjectName((current) => ({ ...current, [objectName]: false }));
      }
    }
  }

  // 展开/折叠字段节点。
  function toggleFieldNode(objectName: string, fieldName: string) {
    const key = buildFieldKey(objectName, fieldName);
    setExpandedFieldKeys((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
    );
  }
  // 展开/折叠 MySQL 分类节点。
  function toggleMysqlCategoryNode(objectName: string, categoryName: string) {
    const key = buildMysqlCategoryKey(objectName, categoryName);
    setExpandedMysqlCategoryKeys((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
  }

  // 树模式对象名单击：延迟触发展开，给双击留出判定窗口。
  function handleTreeObjectSingleClick(objectItem: SalesforceObject) {
    if (objectNodeClickTimerRef.current) {
      clearTimeout(objectNodeClickTimerRef.current); // 清理上一次未触发的单击任务。
      objectNodeClickTimerRef.current = null;
    }
    objectNodeClickTimerRef.current = setTimeout(() => {
      void toggleObjectNode(objectItem); // 单击最终只执行展开/折叠。
      objectNodeClickTimerRef.current = null;
    }, 220);
  }

  // 树模式对象名双击：取消单击展开，并直接打开数据 Tab。
  function handleTreeObjectDoubleClick(objectItem: SalesforceObject) {
    if (objectNodeClickTimerRef.current) {
      clearTimeout(objectNodeClickTimerRef.current); // 双击命中时取消单击展开。
      objectNodeClickTimerRef.current = null;
    }
    if (!objectItem.queryable) {
      onNotQueryableClick?.(objectItem); // 不可查询对象：提示并阻断打开行为。
      return;
    }
    onOpenObject(objectItem); // 可查询对象：双击直接打开（已存在则激活）。
  }

  // 提取 MySQL 键信息（覆盖主键/唯一键/普通索引键）。
  function buildMysqlKeyItems(describe: ObjectDescribe | undefined): string[] {
    if (!describe) return [];
    return describe.fields
      .map((field) => {
        const rawKey = String(field.metadata?.columnKey || "").trim().toUpperCase();
        if (!rawKey) return "";
        const keyType = rawKey === "PRI" ? "PRIMARY KEY" : rawKey === "UNI" ? "UNIQUE KEY" : "KEY";
        return `${field.name} (${keyType})`;
      })
      .filter((item) => item.length > 0);
  }

  // 提取 MySQL 外键信息（来自约束 DDL）。
  function buildMysqlForeignKeyItems(ddl: ObjectDdl | undefined): string[] {
    if (!ddl) return [];
    return ddl.constraintDdls.filter((item) => /foreign\s+key/i.test(item));
  }

  // 提取 MySQL 索引信息（来自索引 DDL）。
  function buildMysqlIndexItems(ddl: ObjectDdl | undefined): string[] {
    if (!ddl) return [];
    return ddl.indexDdls;
  }

  // 提取 MySQL 检查约束信息（优先 DDL 中 CHECK 语句，其次建表语句内 CHECK 片段）。
  function buildMysqlCheckItems(ddl: ObjectDdl | undefined): string[] {
    if (!ddl) return [];
    const fromConstraints = ddl.constraintDdls.filter((item) => /check\s*\(/i.test(item));
    if (fromConstraints.length > 0) return fromConstraints;
    const fromCreateTable = ddl.createTableDdl.match(/CHECK\s*\([^)]+\)/gi) || [];
    return fromCreateTable;
  }

  // 右键菜单动作：打开当前组织的 Salesforce 对象列表页（自动登录）。
  async function openSalesforceListPageFromMenu() {
    if (!objectContextMenu) return;
    const { objectItem } = objectContextMenu;
    setObjectContextMenu(null); // 立即关闭菜单，避免等待后端响应期间 UI 无反馈。
    if (!sourceId) return;
    if (!objectItem.queryable) {
      onNotQueryableClick?.(objectItem);
      return;
    }
    try {
      await api.openObjectListPage(sourceId, objectItem.name);
    } catch (error) {
      console.error("[ObjectList] 打开 Salesforce 列表页失败:", error);
    }
  }

  // 右键菜单动作：打开当前组织的 Salesforce Object 管理页面（自动登录）。
  async function openSalesforceObjectEditPageFromMenu() {
    if (!objectContextMenu) return;
    const { objectItem } = objectContextMenu;
    setObjectContextMenu(null); // 立即关闭菜单，避免等待后端响应期间 UI 无反馈。
    if (!sourceId) return;
    try {
      await api.openObjectEditPage(sourceId, objectItem.name);
    } catch (error) {
      console.error("[ObjectList] 打开 Object 编辑页失败:", error);
    }
  }

  // 右键菜单动作：复制 Object API 名称到剪贴板。
  async function copyObjectNameFromMenu() {
    if (!objectContextMenu) return;
    const objectName = objectContextMenu.objectItem.name;

    try {
      await navigator.clipboard.writeText(objectName); // 优先使用现代剪贴板 API。
    } catch {
      // 回退方案：兼容剪贴板权限受限场景。
      const textarea = document.createElement("textarea");
      textarea.value = objectName;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    } finally {
      setObjectContextMenu(null); // 执行后关闭菜单。
    }
  }

  return (
    // 容器：输入框 + 可滚动树形列表。
    <div className="flex h-full min-h-0 flex-col">
      {/* 筛选输入框。 */}
      <input
        className="input input-bordered input-sm w-full"
        placeholder="筛选 Object"
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
      />

      {/* 列表容器：支持滚动。 */}
      <div className="mt-2 min-h-0 flex-1 overflow-auto border-t border-base-300">
        {filtered.length === 0 && <p className="px-2 py-2 text-[12px] text-neutral/70">未匹配到对象。</p>}

        {!treeMode &&
          filtered.map((item) => {
            const objectName = item.name;
            const tooltip = `名称: ${objectName}\n标签: ${item.label}\n可查询: ${item.queryable}\n可新增: ${item.createable}\n可更新: ${item.updateable}\n可删除: ${item.deletable}`;
            const selected = objectName === activeObjectName;
            return (
              <div key={objectName}>
                {/* 列表模式：点击对象直接打开对象 Tab。 */}
                <div className={`flex items-start gap-2 px-3 py-1.5 ${selected ? "bg-primary/10 text-primary" : "hover:bg-base-100"}`}>
                  <button
                    className="min-w-0 flex-1 text-left"
                    title={tooltip}
                    type="button"
                    onContextMenu={(event) => {
                      event.preventDefault(); // 阻止浏览器默认右键菜单。
                      setObjectContextMenu({ x: event.clientX, y: event.clientY, objectItem: item }); // 打开对象右键菜单。
                    }}
                    onClick={() => {
                      if (!item.queryable) {
                        onNotQueryableClick?.(item); // 不可查询对象：仅提示，不打开对象。
                        return;
                      }
                      onOpenObject(item); // 可查询对象：正常打开对象 Tab。
                    }}
                  >
                    <div className="truncate text-[12px]">{objectName}</div>
                    <div className="truncate text-[11px] text-neutral/70">{item.label}</div>
                  </button>
                  {!item.queryable && (
                    <span
                      className="badge badge-sm mt-[1px] shrink-0 select-none border-0 bg-base-300 text-[10px] text-base-content"
                      title={`${objectName} 不可查询`}
                    >
                      不可查询
                    </span>
                  )}
                </div>
                <div className="border-b border-base-300" />
              </div>
            );
          })}

        {treeMode && filtered.map((item) => {
          const objectName = item.name;
          const isMysqlSource = (sourceType || "salesforce").toLowerCase() === "mysql";
          const tooltip = `名称: ${objectName}\n标签: ${item.label}\n可查询: ${item.queryable}\n可新增: ${item.createable}\n可更新: ${item.updateable}\n可删除: ${item.deletable}`;
          const selected = objectName === activeObjectName;
          const expanded = expandedObjectNames.includes(objectName);
          const objectDescribe = describeByObjectName[objectName];
          const objectFields = objectDescribe?.fields || [];
          const objectLoading = loadingByObjectName[objectName] === true;
          const objectError = errorByObjectName[objectName];
          const objectDdl = ddlByObjectName[objectName];
          const objectDdlLoading = ddlLoadingByObjectName[objectName] === true;
          const objectDdlError = ddlErrorByObjectName[objectName];
          const mysqlColumns = objectFields.map((field) => `${field.name} (${field.dataType})`);
          const mysqlKeys = buildMysqlKeyItems(objectDescribe);
          const mysqlForeignKeys = buildMysqlForeignKeyItems(objectDdl);
          const mysqlIndexes = buildMysqlIndexItems(objectDdl);
          const mysqlChecks = buildMysqlCheckItems(objectDdl);
          const mysqlCategoryItems = [
            { name: "列", items: mysqlColumns },
            { name: "键", items: mysqlKeys },
            { name: "外键", items: mysqlForeignKeys },
            { name: "索引", items: mysqlIndexes },
            { name: "检查", items: mysqlChecks }
          ];

          return (
            <div key={objectName}>
              {/* 对象节点：点击名称展开字段，右侧按钮用于打开对象 Tab。 */}
              <div className={`flex items-center gap-1 px-2 py-1.5 ${selected ? "bg-primary/10 text-primary" : "hover:bg-base-100"}`}>
                <button
                  className="btn btn-ghost btn-xs h-6 min-h-6 w-6 p-0"
                  type="button"
                  aria-label={`${expanded ? "折叠" : "展开"} ${objectName}`}
                  onClick={() => {
                    void toggleObjectNode(item); // 切换对象树节点展开状态。
                  }}
                >
                  {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>

                <button
                  className="min-w-0 flex-1 text-left"
                  title={tooltip}
                  type="button"
                  onContextMenu={(event) => {
                    event.preventDefault(); // 阻止浏览器默认右键菜单。
                    setObjectContextMenu({ x: event.clientX, y: event.clientY, objectItem: item }); // 打开对象右键菜单。
                  }}
                  onClick={() => {
                    handleTreeObjectSingleClick(item); // 单击对象名：展开/折叠字段。
                  }}
                  onDoubleClick={() => {
                    handleTreeObjectDoubleClick(item); // 双击对象名：直接打开数据 Tab。
                  }}
                >
                  <div className="truncate text-[12px]">{objectName}</div>
                  <div className="truncate text-[11px] text-neutral/70">{item.label}</div>
                </button>

                {!item.queryable && (
                  <span
                    className="badge badge-sm mt-[1px] shrink-0 select-none border-0 bg-base-300 text-[10px] text-base-content"
                    title={`${objectName} 不可查询`}
                  >
                    不可查询
                  </span>
                )}
              </div>

              {/* 对象节点下的结构树。 */}
              {expanded && (
                <div className="mb-1 pl-6 pr-2">
                  {objectLoading && <p className="py-1 text-[12px] text-neutral/70">加载字段中...</p>}
                  {!objectLoading && objectError && <p className="py-1 text-[12px] text-error">{objectError}</p>}
                  {!objectLoading && !objectError && objectFields.length === 0 && (
                    <p className="py-1 text-[12px] text-neutral/70">暂无字段信息。</p>
                  )}

                  {isMysqlSource && !objectLoading && !objectError && (
                    <div>
                      {objectDdlLoading && <p className="py-1 text-[12px] text-neutral/70">加载 DDL 中...</p>}
                      {!objectDdlLoading && objectDdlError && <p className="py-1 text-[12px] text-error">{objectDdlError}</p>}
                      {!objectDdlLoading &&
                        !objectDdlError &&
                        mysqlCategoryItems.map((category) => {
                          const categoryKey = buildMysqlCategoryKey(objectName, category.name);
                          const categoryExpanded = expandedMysqlCategoryKeys.includes(categoryKey);
                          return (
                            <div key={categoryKey} className="mb-1 rounded border border-base-300 bg-base-100">
                              {/* MySQL 分类节点：单击展开“列/键/外键/索引/检查”。 */}
                              <button
                                className="flex w-full items-center gap-1 px-2 py-1 text-left hover:bg-base-200/50"
                                type="button"
                                onClick={() => {
                                  toggleMysqlCategoryNode(objectName, category.name); // 切换分类展开状态。
                                }}
                              >
                                {categoryExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                                <span className="truncate text-[11px] font-medium">{category.name}</span>
                                <span className="ml-auto shrink-0 text-[10px] text-neutral/60">{category.items.length}</span>
                              </button>
                              {/* 分类明细列表。 */}
                              {categoryExpanded && (
                                <div className="border-t border-base-300 px-2 py-1.5 text-[11px]">
                                  {category.items.length === 0 && <p className="text-neutral/70">暂无信息。</p>}
                                  {category.items.map((entry, index) => (
                                    <p key={`${categoryKey}-${index}`} className="break-all">
                                      {entry}
                                    </p>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  )}

                  {!isMysqlSource &&
                    !objectLoading &&
                    !objectError &&
                    objectFields.map((field) => {
                      const fieldKey = buildFieldKey(objectName, field.name);
                      const fieldExpanded = expandedFieldKeys.includes(fieldKey);
                      // 展示前统一加工元数据：复用公共逻辑，确保与对象页 info icon 完全一致。
                      const displayMetadata = buildDisplayMetadataFromField(field);
                      const metadataEntries = sortFieldMetadataEntries(displayMetadata);

                      return (
                        <div key={fieldKey} className="mb-1 rounded border border-base-300 bg-base-100">
                          {/* 字段节点：点击后展开字段详细元数据。 */}
                          <button
                            className="flex w-full items-center gap-1 px-2 py-1 text-left hover:bg-base-200/50"
                            type="button"
                            onClick={() => {
                              toggleFieldNode(objectName, field.name); // 切换字段元数据展开状态。
                            }}
                          >
                            {fieldExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                            <span className="truncate text-[11px] font-medium">{field.label}</span>
                            <span className="truncate text-[11px] text-neutral/70">({field.name})</span>
                            <span className="ml-auto shrink-0 text-[10px] text-neutral/60">{String(displayMetadata.type || "-")}</span>
                          </button>

                          {/* 字段元数据：展示常用属性与 metadata 原始键值。 */}
                          {fieldExpanded && (
                            <div className="border-t border-base-300 px-2 py-1.5 text-[11px]">
                              {metadataEntries.length === 0 && (
                                <p className="text-neutral/70">暂无元数据。</p>
                              )}
                              {metadataEntries.map(([metaKey, metaValue]) => (
                                <p key={`${fieldKey}-meta-${metaKey}`} className="break-all">
                                  {translateFieldMetadataKey(metaKey)}: {formatFieldMetadataValue(metaValue)}
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}

              {/* 分割线。 */}
              <div className="border-b border-base-300" />
            </div>
          );
        })}
      </div>

      {/* 对象右键菜单：提供“打开 Salesforce 列表页”操作。 */}
      {objectContextMenu && (
        <div
          className="fixed z-[80] flex min-w-max flex-col rounded border border-base-300 bg-base-100 p-1 shadow-xl"
          style={{ left: objectContextMenu.x, top: objectContextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            className="btn btn-ghost btn-xs w-full justify-start whitespace-nowrap px-2"
            onClick={() => {
              void copyObjectNameFromMenu(); // 复制对象名称并关闭菜单。
            }}
          >
            复制表名
          </button>
          {isSalesforceSource && (
            <>
              <div className="my-1 border-t border-base-300" />
              <button
                className="btn btn-ghost btn-xs w-full justify-start whitespace-nowrap px-2"
                disabled={!sourceId || !objectContextMenu.objectItem.queryable}
                onClick={() => {
                  void openSalesforceListPageFromMenu(); // 触发菜单动作并关闭菜单。
                }}
              >
                打开 Salesforce 列表页
              </button>
              <button
                className="btn btn-ghost btn-xs w-full justify-start whitespace-nowrap px-2"
                disabled={!sourceId}
                onClick={() => {
                  void openSalesforceObjectEditPageFromMenu(); // 触发菜单动作并关闭菜单。
                }}
              >
                编辑 Object 页面
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

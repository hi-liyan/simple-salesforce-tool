import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "../api";
import { ObjectField, SalesforceObject } from "../types";

// 元数据键名中文映射：用于字段元数据展示时的中文化。
const METADATA_KEY_LABELS: Record<string, string> = {
  aggregatable: "可聚合",
  aiPredictionField: "AI 预测字段",
  autoNumber: "自动编号",
  byteLength: "字节长度",
  calculated: "计算字段",
  calculatedFormula: "计算公式",
  cascadeDelete: "级联删除",
  caseSensitive: "区分大小写",
  compoundFieldName: "复合字段名",
  controllerName: "控制字段",
  createable: "可创建",
  custom: "自定义字段",
  defaultValue: "默认值",
  defaultedOnCreate: "创建时默认赋值",
  deleteConstraint: "删除约束",
  dependentPicklist: "从属选项列表",
  deprecatedAndHidden: "已弃用且隐藏",
  digits: "数字位数",
  displayLocationInDecimal: "地理位置小数位",
  encrypted: "加密字段",
  externalId: "外部 ID",
  filterable: "可过滤",
  groupable: "可分组",
  highScaleNumber: "高精度数值",
  htmlFormatted: "HTML 格式化",
  idLookup: "ID 查找",
  inlineHelpText: "内联帮助文本",
  label: "标签",
  length: "长度",
  mask: "掩码",
  maskType: "掩码类型",
  name: "名称",
  nameField: "名称字段",
  namePointing: "名称指向",
  nillable: "可为空",
  permissionable: "可授权",
  picklistValues: "选项值",
  polymorphicForeignKey: "多态外键",
  precision: "精度",
  queryByDistance: "支持距离查询",
  referenceTargetField: "关联目标字段",
  referenceTo: "关联对象",
  relationshipName: "关系名",
  relationshipOrder: "关系顺序",
  restrictedDelete: "受限删除",
  restrictedPicklist: "受限选项列表",
  scale: "小数位",
  searchable: "可搜索",
  soapType: "SOAP 类型",
  sortable: "可排序",
  type: "类型",
  defaultValueFormula: "默认值公式",
  unique: "唯一",
  updateable: "可更新",
  writeRequiresMasterRead: "写入需主记录读取权限"
};

type Props = {
  // 对象数据列表。
  objects: SalesforceObject[];
  // 当前选中的数据源 ID：用于拉取对象字段描述。
  sourceId: string;
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
export function ObjectList({ objects, sourceId, activeObjectName, onOpenObject, onNotQueryableClick, treeMode = false }: Props) {
  // 关键字：用于对象过滤。
  const [keyword, setKeyword] = useState("");
  // 已展开对象集合。
  const [expandedObjectNames, setExpandedObjectNames] = useState<string[]>([]);
  // 已展开字段集合（key: objectName.fieldName）。
  const [expandedFieldKeys, setExpandedFieldKeys] = useState<string[]>([]);
  // 对象字段缓存：避免重复请求 describe。
  const [fieldsByObjectName, setFieldsByObjectName] = useState<Record<string, ObjectField[]>>({});
  // 对象字段加载状态。
  const [loadingByObjectName, setLoadingByObjectName] = useState<Record<string, boolean>>({});
  // 对象字段加载错误信息。
  const [errorByObjectName, setErrorByObjectName] = useState<Record<string, string>>({});

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

  // 展开/折叠对象节点，并在首次展开时懒加载字段列表。
  async function toggleObjectNode(objectItem: SalesforceObject) {
    const objectName = objectItem.name;
    const alreadyExpanded = expandedObjectNames.includes(objectName);

    // 已展开则直接折叠，避免多余请求。
    if (alreadyExpanded) {
      setExpandedObjectNames((current) => current.filter((name) => name !== objectName));
      return;
    }

    // 先更新为展开状态，提升交互响应速度。
    setExpandedObjectNames((current) => [...current, objectName]);

    // 已有缓存时不再请求 describe，直接使用本地字段列表。
    if (fieldsByObjectName[objectName] || loadingByObjectName[objectName]) return;
    if (!sourceId) {
      setErrorByObjectName((current) => ({ ...current, [objectName]: "请先选择数据源。" }));
      return;
    }

    setLoadingByObjectName((current) => ({ ...current, [objectName]: true }));
    setErrorByObjectName((current) => ({ ...current, [objectName]: "" }));

    try {
      // 调用后端对象描述接口，获取字段与字段元数据。
      const describe = await api.describeObject(sourceId, objectName);
      setFieldsByObjectName((current) => ({ ...current, [objectName]: describe.fields || [] }));
    } catch (error) {
      setErrorByObjectName((current) => ({ ...current, [objectName]: `加载字段失败：${String(error)}` }));
    } finally {
      setLoadingByObjectName((current) => ({ ...current, [objectName]: false }));
    }
  }

  // 展开/折叠字段节点。
  function toggleFieldNode(objectName: string, fieldName: string) {
    const key = buildFieldKey(objectName, fieldName);
    setExpandedFieldKeys((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
    );
  }

  // 将 metadata 值转换为可读文本，复杂对象转 JSON 字符串。
  function stringifyMetadataValue(value: unknown): string {
    if (value === null || value === undefined) return "";
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  // 元数据键名中文化：若没有映射则回退为原键名，避免信息丢失。
  function translateMetadataKey(metaKey: string): string {
    return METADATA_KEY_LABELS[metaKey] || metaKey;
  }

  // 元数据值格式化：与对象页表格保持一致（布尔值显示“是/否”）。
  function formatMetadataValue(value: unknown): string {
    if (typeof value === "boolean") {
      return value ? "是" : "否";
    }
    if (Array.isArray(value)) {
      return value.length === 0 ? "[]" : JSON.stringify(value);
    }
    if (value && typeof value === "object") {
      return JSON.stringify(value);
    }
    if (value === null || value === undefined || value === "") {
      return "-";
    }
    return stringifyMetadataValue(value);
  }

  // 元数据排序：优先展示高价值信息，其次按键名排序，提升可读性。
  function sortMetadataEntries(metadata: Record<string, unknown>): Array<[string, unknown]> {
    const priorityKeys = [
      "type",
      "name",
      "label",
      "referenceTo",
      "relationshipName",
      "picklistValues",
      "nillable",
      "createable",
      "updateable",
      "defaultedOnCreate",
      "calculated",
      "calculatedFormula",
      "length",
      "precision",
      "scale",
      "byteLength",
      "unique",
      "externalId",
      "filterable",
      "sortable",
      "groupable",
      "defaultValue",
      "defaultValueFormula",
      "inlineHelpText"
    ];
    const priorityOrder = priorityKeys.reduce<Record<string, number>>((acc, key, index) => {
      acc[key] = index;
      return acc;
    }, {});

    return Object.entries(metadata).sort(([leftKey], [rightKey]) => {
      const leftRank = priorityOrder[leftKey] ?? Number.MAX_SAFE_INTEGER;
      const rightRank = priorityOrder[rightKey] ?? Number.MAX_SAFE_INTEGER;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return leftKey.localeCompare(rightKey);
    });
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
          const tooltip = `名称: ${objectName}\n标签: ${item.label}\n可查询: ${item.queryable}\n可新增: ${item.createable}\n可更新: ${item.updateable}\n可删除: ${item.deletable}`;
          const selected = objectName === activeObjectName;
          const expanded = expandedObjectNames.includes(objectName);
          const objectFields = fieldsByObjectName[objectName] || [];
          const objectLoading = loadingByObjectName[objectName] === true;
          const objectError = errorByObjectName[objectName];

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
                  onClick={() => {
                    void toggleObjectNode(item); // 点击对象名时展开/折叠字段。
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

              {/* 对象节点下的字段树。 */}
              {expanded && (
                <div className="mb-1 pl-6 pr-2">
                  {objectLoading && <p className="py-1 text-[12px] text-neutral/70">加载字段中...</p>}
                  {!objectLoading && objectError && <p className="py-1 text-[12px] text-error">{objectError}</p>}
                  {!objectLoading && !objectError && objectFields.length === 0 && (
                    <p className="py-1 text-[12px] text-neutral/70">暂无字段信息。</p>
                  )}

                  {!objectLoading &&
                    !objectError &&
                    objectFields.map((field) => {
                      const fieldKey = buildFieldKey(objectName, field.name);
                      const fieldExpanded = expandedFieldKeys.includes(fieldKey);
                      const metadataEntries = sortMetadataEntries(field.metadata || {});

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
                            <span className="ml-auto shrink-0 text-[10px] text-neutral/60">{field.dataType}</span>
                          </button>

                          {/* 字段元数据：展示常用属性与 metadata 原始键值。 */}
                          {fieldExpanded && (
                            <div className="border-t border-base-300 px-2 py-1.5 text-[11px]">
                              <p>标签: {field.label}</p>
                              <p>API 名称: {field.name}</p>
                              <p>字段类型: {field.dataType}</p>
                              <p>可为空: {formatMetadataValue(field.nillable)}</p>
                              <p>可创建: {formatMetadataValue(field.createable)}</p>
                              <p>可更新: {formatMetadataValue(field.updateable)}</p>
                              {metadataEntries.length > 0 && (
                                <div className="mt-1 border-t border-base-300 pt-1">
                                  <p className="text-neutral/70">元数据:</p>
                                  {metadataEntries.map(([metaKey, metaValue]) => (
                                    <p key={`${fieldKey}-meta-${metaKey}`} className="break-all">
                                      {translateMetadataKey(metaKey)}: {formatMetadataValue(metaValue)}
                                    </p>
                                  ))}
                                </div>
                              )}
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
    </div>
  );
}


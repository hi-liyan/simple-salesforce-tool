import { ObjectField } from "../types";

// 字段元数据键名中文映射：对象树和数据表 info icon 共用同一份定义。
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
  childRelationshipName: "子关系名",
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

// 元数据键名翻译：未知键名保留原值，避免信息丢失。
export function translateFieldMetadataKey(metaKey: string): string {
  return METADATA_KEY_LABELS[metaKey] || metaKey;
}

// 元数据值转字符串：对象/数组使用 JSON，失败时回退 String。
function stringifyMetadataValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// 元数据值展示格式：布尔中文化，空值显示 `-`。
export function formatFieldMetadataValue(value: unknown): string {
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

// reference 字段类型细分：保持与对象树展开页一致。
function getDisplayFieldTypeByMetadata(metadata: Record<string, unknown>): string {
  const rawType = typeof metadata.type === "string" ? metadata.type : "";
  if (rawType !== "reference") return rawType;
  const hasRelationshipOrder = typeof metadata.relationshipOrder === "number";
  const writeRequiresMasterRead = metadata.writeRequiresMasterRead === true;
  const cascadeDelete = metadata.cascadeDelete === true;
  if (hasRelationshipOrder || writeRequiresMasterRead || cascadeDelete) {
    return "Master-Detail";
  }
  return "Lookup";
}

// 元数据展示加工：覆盖 type，并规范 childRelationshipName。
export function buildDisplayMetadataFromRaw(metadata: Record<string, unknown>): Record<string, unknown> {
  const next = { ...(metadata || {}) };
  const rawType = typeof next.type === "string" ? next.type : "";
  next.type = getDisplayFieldTypeByMetadata(next);
  if (rawType === "reference") {
    const resolvedValue = typeof next.childRelationshipName === "string" ? next.childRelationshipName.trim() : "";
    next.childRelationshipName = resolvedValue;
  }
  return next;
}

// 对象树字段元数据加工入口：与数据表 info icon 共享同一加工逻辑。
export function buildDisplayMetadataFromField(field: ObjectField): Record<string, unknown> {
  return buildDisplayMetadataFromRaw(field.metadata || {});
}

// 元数据排序：优先展示高价值字段，其余按键名稳定排序。
export function sortFieldMetadataEntries(metadata: Record<string, unknown>): Array<[string, unknown]> {
  const priorityKeys = [
    "type",
    "name",
    "label",
    "referenceTo",
    "relationshipName",
    "childRelationshipName",
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

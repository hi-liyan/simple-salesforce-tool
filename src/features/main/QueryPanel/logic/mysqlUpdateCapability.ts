import type { ObjectDescribe, RowUpdateCapability } from "../../../../types/index.ts";
import { getMysqlPrimaryKeyField } from "./queryUtils.ts";

type ResolveMysqlResultUpdateCapabilityInput = {
  // 当前数据源类型：仅 MySQL 结果集启用本能力模型。
  sourceType?: string;
  // 当前对象 Tab 绑定的表名。
  objectName: string;
  // 当前表字段元数据：用于识别主键列。
  describe: ObjectDescribe | null | undefined;
  // 当前结果集实际执行的 SQL 文本。
  queryText: string;
};

type ParsedMysqlSelectResult =
  | {
      kind: "simple";
      tableName: string;
      selectedFields: string[];
      selectsWildcard: boolean;
    }
  | {
      kind: "multi_table";
      tableName: string;
    }
  | {
      kind: "complex";
      tableName: string;
    };

// 统一构造结果集可更新性对象，避免各分支重复拼装。
function createCapability(
  mode: RowUpdateCapability["mode"],
  reason: string,
  targetTableName: string,
  primaryKeyField: string
): RowUpdateCapability {
  return {
    mode,
    editable: mode === "editable",
    reason,
    targetTableName,
    primaryKeyField
  };
}

// 标识符清洗：仅保留简单列名/表名，遇到复杂表达式时交给上层保守判只读。
function stripMysqlIdentifier(raw: string): string {
  return raw.replace(/`/g, "").trim();
}

// 判断是否为简单 SQL 标识符（允许 table.column 形式）。
function isSimpleMysqlIdentifier(raw: string): boolean {
  return /^[A-Za-z_][\w$]*(\.[A-Za-z_][\w$]*)*$/.test(raw);
}

// 提取简单列名：复杂表达式返回空字符串，交由上层降级为复杂查询。
function extractSimpleFieldName(raw: string): string {
  const normalized = stripMysqlIdentifier(raw);
  if (!normalized || !isSimpleMysqlIdentifier(normalized)) return "";
  const parts = normalized.split(".");
  return parts[parts.length - 1] || "";
}

// 解析简单 SELECT：只接受“单表 + 直接字段列表”的保守子集，其余一律视为只读。
function parseMysqlSelectQuery(queryText: string): ParsedMysqlSelectResult {
  const normalized = queryText.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return {
      kind: "simple",
      tableName: "",
      selectedFields: [],
      selectsWildcard: true
    };
  }

  if (!/^select\b/i.test(normalized)) {
    return { kind: "complex", tableName: "" };
  }

  const lowered = normalized.toLowerCase();
  if (/\b(distinct|union|group\s+by|having|into|procedure)\b/.test(lowered)) {
    return { kind: "complex", tableName: "" };
  }

  const match = normalized.match(/^select\s+(.+?)\s+from\s+(.+?)(?:\s+where\b|\s+order\s+by\b|\s+limit\b|$)/i);
  if (!match) {
    return { kind: "complex", tableName: "" };
  }

  const selectedSegment = match[1]?.trim() || "";
  const fromSegment = match[2]?.trim() || "";
  if (!selectedSegment || !fromSegment) {
    return { kind: "complex", tableName: "" };
  }

  const loweredFromSegment = fromSegment.toLowerCase();
  if (/\bjoin\b/.test(loweredFromSegment) || fromSegment.includes(",")) {
    const joinedTableName = stripMysqlIdentifier(fromSegment.split(/\s+/)[0] || "");
    return { kind: "multi_table", tableName: joinedTableName };
  }

  if (fromSegment.includes("(") || fromSegment.includes(")")) {
    return { kind: "complex", tableName: "" };
  }

  const tableName = stripMysqlIdentifier(fromSegment.split(/\s+/)[0] || "");
  if (!tableName || !isSimpleMysqlIdentifier(tableName)) {
    return { kind: "complex", tableName: "" };
  }

  if (selectedSegment.includes("(") || selectedSegment.includes(")")) {
    return { kind: "complex", tableName };
  }

  const selectedFields = selectedSegment
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (selectedFields.length === 0) {
    return { kind: "complex", tableName };
  }

  let selectsWildcard = false;
  const parsedFieldNames: string[] = [];
  for (const fieldExpression of selectedFields) {
    const normalizedFieldExpression = stripMysqlIdentifier(fieldExpression);
    if (normalizedFieldExpression === "*" || normalizedFieldExpression === `${tableName}.*`) {
      selectsWildcard = true;
      continue;
    }
    if (/\s/.test(normalizedFieldExpression) || /\bas\b/i.test(normalizedFieldExpression)) {
      return { kind: "complex", tableName };
    }
    const fieldName = extractSimpleFieldName(normalizedFieldExpression);
    if (!fieldName) {
      return { kind: "complex", tableName };
    }
    parsedFieldNames.push(fieldName);
  }

  return {
    kind: "simple",
    tableName,
    selectedFields: parsedFieldNames,
    selectsWildcard
  };
}

// 判定当前 MySQL 结果集是否允许进入可信编辑链路；规则保守，宁可只读也不误放开编辑。
export function resolveMysqlResultUpdateCapability({
  sourceType,
  objectName,
  describe,
  queryText
}: ResolveMysqlResultUpdateCapabilityInput): RowUpdateCapability {
  const normalizedSourceType = String(sourceType || "salesforce").toLowerCase();
  const primaryKeyField = getMysqlPrimaryKeyField(describe);
  const fallbackTableName = objectName.trim();
  const normalizedQueryText = queryText.trim();

  if (normalizedSourceType !== "mysql") {
    return createCapability("editable", "当前结果集可编辑。", fallbackTableName, primaryKeyField);
  }

  if (!normalizedQueryText) {
    return createCapability("editable", "当前对象支持编辑。", fallbackTableName, primaryKeyField);
  }

  if (!primaryKeyField) {
    return createCapability(
      "readonly_missing_pk",
      "当前结果集缺少可识别的主键列，已切换为只读。请先确保表结构存在单主键并重新查询。",
      fallbackTableName,
      ""
    );
  }

  const parsed = parseMysqlSelectQuery(normalizedQueryText);
  if (parsed.kind === "multi_table") {
    return createCapability(
      "readonly_multi_table",
      "当前结果集来自多表查询，无法可靠定位单行更新目标，已切换为只读。",
      parsed.tableName || fallbackTableName,
      primaryKeyField
    );
  }

  if (parsed.kind === "complex") {
    return createCapability(
      "readonly_complex_query",
      "当前结果集来自复杂查询（如聚合、子查询或表达式列），已切换为只读。",
      parsed.tableName || fallbackTableName,
      primaryKeyField
    );
  }

  const targetTableName = parsed.tableName || fallbackTableName;
  if (fallbackTableName && targetTableName && targetTableName !== fallbackTableName) {
    return createCapability(
      "readonly_complex_query",
      "当前结果集的目标表与当前 Tab 不一致，已切换为只读。",
      targetTableName,
      primaryKeyField
    );
  }

  if (!parsed.selectsWildcard && !parsed.selectedFields.includes(primaryKeyField)) {
    return createCapability(
      "readonly_missing_pk",
      `当前结果集未包含主键列 ${primaryKeyField}，无法可靠定位更新目标，已切换为只读。`,
      targetTableName,
      primaryKeyField
    );
  }

  return createCapability(
    "editable",
    "当前结果集为单表查询且包含主键列，可直接编辑。",
    targetTableName,
    primaryKeyField
  );
}

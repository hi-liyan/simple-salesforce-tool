import { getDataSourceDriver } from "../../../../drivers/registry.ts";
import type {
  DatabaseCollation,
  DatabaseEvent,
  DatabaseRoutine,
  DatabaseTrigger,
  DatabaseUser,
  ObjectDdl,
  ObjectField,
  SalesforceObject,
  SalesforceSource,
  VirtualView
} from "../../../../types/index.ts";
import type { QueryObjectFolderType, QueryTreeNode, QueryTreeProviderContext } from "../types/tree.ts";

// 构造 source 根节点：统一供左侧树第一层渲染使用。
export function buildSourceRootNodes(sources: SalesforceSource[], context: QueryTreeProviderContext): QueryTreeNode[] {
  return [...sources]
    .sort((a, b) => {
      const sortDiff = (a.sortOrder || 0) - (b.sortOrder || 0);
      if (sortDiff !== 0) return sortDiff;
      return a.name.localeCompare(b.name, "zh-CN");
    })
    .map((source) => ({
      id: `source:${source.id}`,
      kind: "source" as const,
      sourceId: source.id,
      sourceType: String(source.sourceType || "salesforce"),
      sourceName: source.name,
      sourceColor: context.getSourceColor(source),
      label: source.name,
      expandable: true
    }));
}

// 按驱动树配置构造数据源根子节点（由驱动声明决定是否分组及是否允许列展开）。
export async function buildDriverSourceChildren(
  source: SalesforceSource,
  context: QueryTreeProviderContext
): Promise<QueryTreeNode[]> {
  const sourceType = String(source.sourceType || "salesforce");
  const driver = getDataSourceDriver(sourceType);
  if (driver.treeConfig.useGroupNodes) {
    return driver.treeConfig.groups.map((group) =>
      buildGroupNode(source.id, sourceType, group.groupType, group.label)
    );
  }

  const objects = context.withSalesforceSourceReauth
    ? await context.withSalesforceSourceReauth(source, () => context.listObjects(source.id))
    : await context.listObjects(source.id);
  return objects.map((item) =>
    buildObjectNode(source.id, sourceType, item, driver.treeConfig.supportsColumnExpansion)
  );
}

// 兼容导出：构造分组下表/对象子节点。
export function buildGroupObjectChildren(
  sourceId: string,
  sourceType: string,
  objects: SalesforceObject[],
  objectGroupType = "tables"
): QueryTreeNode[] {
  const driver = getDataSourceDriver(sourceType);
  return objects.map((item) =>
    buildObjectNode(sourceId, sourceType, item, driver.treeConfig.supportsColumnExpansion, objectGroupType)
  );
}

// 构造排序规则（collations）分组下的子节点列表。
export function buildGroupCollationChildren(
  sourceId: string,
  sourceType: string,
  collations: DatabaseCollation[]
): QueryTreeNode[] {
  return collations.map((item) => ({
    id: `collation:${sourceId}:${item.name}`,
    kind: "collation",
    sourceId,
    sourceType,
    collationName: item.name,
    charset: item.charset,
    isDefault: item.isDefault,
    label: item.name,
    expandable: false
  }));
}

// 构造数据库用户（users）分组下的子节点列表。
export function buildGroupUserChildren(
  sourceId: string,
  sourceType: string,
  users: DatabaseUser[]
): QueryTreeNode[] {
  return users.map((item) => ({
    id: `user:${sourceId}:${item.accountLabel}`,
    kind: "user",
    sourceId,
    sourceType,
    username: item.username,
    host: item.host,
    accountLabel: item.accountLabel,
    label: item.accountLabel,
    expandable: false
  }));
}

// 构造存储过程/函数（routines）分组下的子节点列表。
export function buildGroupRoutineChildren(
  sourceId: string,
  sourceType: string,
  routines: DatabaseRoutine[]
): QueryTreeNode[] {
  return routines.map((item) => ({
    id: `routine:${sourceId}:${item.routineType}:${item.name}`,
    kind: "routine",
    sourceId,
    sourceType,
    routineName: item.name,
    routineType: item.routineType,
    dataType: item.dataType,
    comment: item.comment,
    label: item.name,
    expandable: false
  }));
}

// 构造触发器（triggers）分组下的子节点列表。
export function buildGroupTriggerChildren(
  sourceId: string,
  sourceType: string,
  triggers: DatabaseTrigger[]
): QueryTreeNode[] {
  return triggers.map((item) => ({
    id: `trigger:${sourceId}:${item.name}`,
    kind: "trigger",
    sourceId,
    sourceType,
    triggerName: item.name,
    tableName: item.tableName,
    timing: item.timing,
    event: item.event,
    label: item.name,
    expandable: false
  }));
}

// 构造定时事件（events）分组下的子节点列表。
export function buildGroupEventChildren(
  sourceId: string,
  sourceType: string,
  events: DatabaseEvent[]
): QueryTreeNode[] {
  return events.map((item) => ({
    id: `event:${sourceId}:${item.name}`,
    kind: "event",
    sourceId,
    sourceType,
    eventName: item.name,
    eventType: item.eventType,
    status: item.status,
    comment: item.comment,
    label: item.name,
    expandable: false
  }));
}

// 构造本地虚拟视图（virtual-views）分组下的子节点列表。
export function buildGroupVirtualViewChildren(
  sourceId: string,
  sourceType: string,
  views: VirtualView[]
): QueryTreeNode[] {
  return views.map((item) => ({
    id: `virtual-view:${sourceId}:${item.id}`,
    kind: "virtual-view",
    sourceId,
    sourceType,
    viewId: item.id,
    viewName: item.name,
    sqlText: item.sqlText,
    description: item.description,
    label: item.name,
    expandable: false
  }));
}

// 构造表/对象下的字段（Columns）子节点列表。
export function buildObjectColumnChildren(
  sourceId: string,
  sourceType: string,
  objectName: string,
  fields: ObjectField[]
): QueryTreeNode[] {
  return fields.map((field) => {
    const columnKey = String(field.metadata?.columnKey || "").toUpperCase();
    const isPrimaryKey = columnKey === "PRI" || field.name === "Id";
    const dataType = String(field.metadata?.columnType || field.dataType || "");
    return {
      id: `column:${sourceId}:${objectName}:${field.name}`,
      kind: "column",
      sourceId,
      sourceType,
      objectName,
      columnName: field.name,
      dataType,
      isPrimaryKey,
      nullable: field.nillable,
      label: dataType ? `${field.name} (${dataType})` : field.name,
      expandable: false
    };
  });
}

// 从字段元数据中提取主键列名列表，供 keys 与 indexes 节点复用。
function extractPrimaryKeyColumnNames(fields: ObjectField[]): string[] {
  return fields
    .filter((field) => String(field.metadata?.columnKey || "").toUpperCase() === "PRI")
    .map((field) => field.name);
}

// 构造表/对象下的键（Keys）子节点列表：包含主键与 UNIQUE / FOREIGN KEY 约束。
export function buildObjectKeyChildren(
  sourceId: string,
  sourceType: string,
  objectName: string,
  fields: ObjectField[],
  ddl?: ObjectDdl | null
): QueryTreeNode[] {
  const nodes: QueryTreeNode[] = [];
  const primaryKeyColumns = extractPrimaryKeyColumnNames(fields);

  if (primaryKeyColumns.length > 0) {
    nodes.push({
      id: `key:${sourceId}:${objectName}:PRIMARY`,
      kind: "key",
      sourceId,
      sourceType,
      objectName,
      keyName: "PRIMARY",
      keyKind: "PK",
      detail: `(${primaryKeyColumns.join(", ")})`,
      label: "PRIMARY",
      expandable: false
    });
  }

  for (const constraintDdl of ddl?.constraintDdls || []) {
    const match = constraintDdl.match(
      /ADD CONSTRAINT `([^`]+)`\s+(UNIQUE|FOREIGN KEY)\s*\(([^)]+)\)(?:\s+REFERENCES\s+`([^`]+)`\s*\(([^)]+)\))?/i
    );
    if (!match) continue;
    const [, constraintName, constraintType, cols, refTable, refCols] = match;
    const keyKind = constraintType.toUpperCase() === "FOREIGN KEY" ? "FK" : "UK";
    const cleanedCols = cols.replace(/`/g, "").trim();
    const cleanedRefCols = refCols ? refCols.replace(/`/g, "").trim() : "";
    const detail = refTable ? `(${cleanedCols}) -> ${refTable}(${cleanedRefCols})` : `(${cleanedCols})`;

    nodes.push({
      id: `key:${sourceId}:${objectName}:${constraintName}`,
      kind: "key",
      sourceId,
      sourceType,
      objectName,
      keyName: constraintName,
      keyKind,
      detail,
      label: constraintName,
      expandable: false
    });
  }

  return nodes;
}

// 构造表/对象下的索引（Indexes）子节点列表：包含主键索引与普通/唯一二级索引。
export function buildObjectIndexChildren(
  sourceId: string,
  sourceType: string,
  objectName: string,
  fields: ObjectField[],
  ddl?: ObjectDdl | null
): QueryTreeNode[] {
  const nodes: QueryTreeNode[] = [];
  const primaryKeyColumns = extractPrimaryKeyColumnNames(fields);

  if (primaryKeyColumns.length > 0) {
    nodes.push({
      id: `index:${sourceId}:${objectName}:PRIMARY`,
      kind: "index",
      sourceId,
      sourceType,
      objectName,
      indexName: "PRIMARY",
      indexKind: "PK",
      detail: `(${primaryKeyColumns.join(", ")})`,
      label: "PRIMARY",
      expandable: false
    });
  }

  for (const indexDdl of ddl?.indexDdls || []) {
    const match = indexDdl.match(
      /^CREATE\s+(UNIQUE\s+)?INDEX\s+`([^`]+)`\s+ON\s+`[^`]+`\s*\(([^)]+)\)(?:\s+USING\s+([^\s;]+))?/i
    );
    if (!match) continue;
    const [, uniqueFlag, indexName, cols, indexType] = match;
    const indexKind = uniqueFlag ? "UX" : "IX";
    const cleanedCols = cols.replace(/`/g, "").trim();
    const detail = indexType ? `(${cleanedCols}) · ${indexType}` : `(${cleanedCols})`;

    nodes.push({
      id: `index:${sourceId}:${objectName}:${indexName}`,
      kind: "index",
      sourceId,
      sourceType,
      objectName,
      indexName,
      indexKind,
      detail,
      label: indexName,
      expandable: false
    });
  }

  return nodes;
}

// 按驱动声明的子目录结构构造表下目录节点（columns / keys / indexes）。
export function buildObjectSubFolderChildren(
  sourceId: string,
  sourceType: string,
  objectName: string,
  subFolders: QueryObjectFolderType[],
  fields: ObjectField[],
  ddl?: ObjectDdl | null
): { folderNode: QueryTreeNode; children: QueryTreeNode[] }[] {
  return subFolders.map((folderType) => {
    let children: QueryTreeNode[] = [];
    if (folderType === "columns") {
      children = buildObjectColumnChildren(sourceId, sourceType, objectName, fields);
    } else if (folderType === "keys") {
      children = buildObjectKeyChildren(sourceId, sourceType, objectName, fields, ddl);
    } else if (folderType === "indexes") {
      children = buildObjectIndexChildren(sourceId, sourceType, objectName, fields, ddl);
    }

    return {
      folderNode: {
        id: `object-folder:${sourceId}:${objectName}:${folderType}`,
        kind: "object-folder",
        sourceId,
        sourceType,
        objectName,
        folderType,
        label: folderType,
        count: children.length,
        expandable: children.length > 0
      },
      children
    };
  });
}

// 兼容导出：委托给通用驱动树构建函数。
export const buildSalesforceRootChildren = buildDriverSourceChildren;
export const buildMySqlRootChildren = buildDriverSourceChildren;

// 构造 group 节点。
function buildGroupNode(sourceId: string, sourceType: string, groupType: string, label: string): QueryTreeNode {
  return {
    id: `group:${sourceId}:${groupType}`,
    kind: "group",
    sourceId,
    sourceType,
    groupType,
    label,
    expandable: true
  };
}

// 构造 object 节点：保留 queryable、注释与可展开列信息。
function buildObjectNode(
  sourceId: string,
  sourceType: string,
  objectItem: SalesforceObject,
  supportsColumnExpansion: boolean,
  objectGroupType = "tables"
): QueryTreeNode {
  const trimmedComment = objectItem.comment?.trim() || ""; // 行内注释：过滤纯空白注释，避免节点渲染空占位。
  return {
    id: `object:${sourceId}:${objectItem.name}`,
    kind: "object",
    sourceId,
    sourceType,
    objectName: objectItem.name,
    objectGroupType,
    label: objectItem.label || objectItem.name,
    comment: trimmedComment || undefined,
    queryable: objectItem.queryable,
    expandable: supportsColumnExpansion
  };
}

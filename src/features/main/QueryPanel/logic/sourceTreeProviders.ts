import type { SalesforceObject, SalesforceSource } from "../../../../types/index.ts";
import type { QueryTreeNode, QueryTreeProviderContext } from "../types/tree.ts";

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

// Salesforce 根子节点：第一版直接映射为对象节点。
export async function buildSalesforceRootChildren(
  source: SalesforceSource,
  context: QueryTreeProviderContext
): Promise<QueryTreeNode[]> {
  const objects = await context.listObjects(source.id);
  return objects.map((item) => buildObjectNode(source.id, String(source.sourceType || "salesforce"), item));
}

// MySQL 根子节点：第一版先提供数据库客户端风格分组。
export async function buildMySqlRootChildren(
  source: SalesforceSource,
  _context: QueryTreeProviderContext
): Promise<QueryTreeNode[]> {
  return [
    buildGroupNode(source.id, String(source.sourceType || "mysql"), "tables", "tables"),
    buildGroupNode(source.id, String(source.sourceType || "mysql"), "collations", "collations"),
    buildGroupNode(source.id, String(source.sourceType || "mysql"), "users", "users"),
    buildGroupNode(source.id, String(source.sourceType || "mysql"), "virtual-views", "virtual views")
  ];
}

// MySQL tables 分组子节点：当前使用对象列表映射表节点，其余分组待后端能力补齐。
export function buildMySqlTableChildren(sourceId: string, objects: SalesforceObject[]): QueryTreeNode[] {
  return objects.map((item) => buildObjectNode(sourceId, "mysql", item));
}

// 构造 group 节点：后续可继续补数量与深层 children。
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

// 构造 object 节点：保留 queryable 信息供后续打开行为判定。
function buildObjectNode(sourceId: string, sourceType: string, objectItem: SalesforceObject): QueryTreeNode {
  return {
    id: `object:${sourceId}:${objectItem.name}`,
    kind: "object",
    sourceId,
    sourceType,
    objectName: objectItem.name,
    label: objectItem.label || objectItem.name,
    queryable: objectItem.queryable,
    expandable: false
  };
}

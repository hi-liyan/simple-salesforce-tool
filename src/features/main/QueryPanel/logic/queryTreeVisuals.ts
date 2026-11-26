import type { QueryTreeNode } from "../types/tree.ts";

// 左侧树视觉类型：统一约束 source/group/object/column/key/index 的极简图标风格。
export type QueryTreeVisualKind =
  | "source-salesforce"
  | "source-mysql"
  | "source-generic"
  | "group-collations"
  | "group-users"
  | "group-tables"
  | "group-views"
  | "group-columns"
  | "group-keys"
  | "group-indexes"
  | "group-generic"
  | "object-mysql-table"
  | "object-queryable"
  | "object-readonly"
  | "column-pk"
  | "column-field"
  | "key-pk"
  | "key-uk"
  | "key-fk"
  | "index-pk"
  | "index-unique"
  | "index-normal";

// 左侧树文字徽标定义：统一控制文案与色调，避免组件内散落判断。
export type QueryTreeBadgeMeta = {
  // 徽标文案。
  text: string;
  // 徽标色调。
  tone: "neutral" | "blue" | "green" | "amber" | "orange" | "gray" | "muted";
};

// 解析树节点视觉类型：避免在组件内直接散落 source/group/object 判断。
export function resolveQueryTreeVisualKind(node: QueryTreeNode): QueryTreeVisualKind {
  if (node.kind === "source") {
    const sourceType = String(node.sourceType || "").toLowerCase();
    if (sourceType === "salesforce") return "source-salesforce";
    if (sourceType === "mysql") return "source-mysql";
    return "source-generic";
  }

  if (node.kind === "group") {
    if (node.groupType === "tables") return "group-tables";
    if (node.groupType === "collations") return "group-collations";
    if (node.groupType === "users") return "group-users";
    if (node.groupType === "virtual-views") return "group-views";
    return "group-generic";
  }

  if (node.kind === "object-folder") {
    if (node.folderType === "columns") return "group-columns";
    if (node.folderType === "keys") return "group-keys";
    if (node.folderType === "indexes") return "group-indexes";
    return "group-generic";
  }

  if (node.kind === "key") {
    if (node.keyKind === "PK") return "key-pk";
    if (node.keyKind === "FK") return "key-fk";
    return "key-uk";
  }

  if (node.kind === "index") {
    if (node.indexKind === "PK") return "index-pk";
    if (node.indexKind === "UX") return "index-unique";
    return "index-normal";
  }

  if (node.kind === "column") {
    return node.isPrimaryKey ? "column-pk" : "column-field";
  }

  if (String(node.sourceType || "").toLowerCase() === "mysql") {
    return "object-mysql-table";
  }

  return node.queryable ? "object-queryable" : "object-readonly";
}

// 根据视觉类型生成文字小徽标：目标是“轻量、统一、可扫读”。
export function resolveQueryTreeBadgeMeta(kind: QueryTreeVisualKind): QueryTreeBadgeMeta {
  switch (kind) {
    case "source-salesforce":
      return { text: "SF", tone: "green" };
    case "source-mysql":
      return { text: "MY", tone: "blue" };
    case "source-generic":
      return { text: "DB", tone: "neutral" };
    case "group-tables":
      return { text: "TB", tone: "amber" };
    case "group-collations":
      return { text: "CL", tone: "neutral" };
    case "group-users":
      return { text: "US", tone: "neutral" };
    case "group-views":
      return { text: "VW", tone: "orange" };
    case "group-columns":
      return { text: "CL", tone: "neutral" };
    case "group-keys":
      return { text: "KY", tone: "amber" };
    case "group-indexes":
      return { text: "IX", tone: "blue" };
    case "group-generic":
      return { text: "GR", tone: "neutral" };
    case "object-mysql-table":
      return { text: "T", tone: "amber" };
    case "object-readonly":
      return { text: "NQ", tone: "muted" };
    case "column-pk":
    case "key-pk":
    case "index-pk":
      return { text: "PK", tone: "amber" };
    case "key-uk":
      return { text: "UK", tone: "blue" };
    case "key-fk":
      return { text: "FK", tone: "orange" };
    case "index-unique":
      return { text: "UX", tone: "blue" };
    case "index-normal":
      return { text: "IX", tone: "gray" };
    case "column-field":
      return { text: "C", tone: "gray" };
    case "object-queryable":
    default:
      return { text: "O", tone: "amber" };
  }
}

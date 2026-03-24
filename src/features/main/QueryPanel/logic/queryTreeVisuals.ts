import type { QueryTreeNode } from "../types/tree.ts";

// 左侧树视觉类型：统一约束 source/group/object 的极简图标风格。
export type QueryTreeVisualKind =
  | "source-salesforce"
  | "source-mysql"
  | "source-generic"
  | "group-collations"
  | "group-users"
  | "group-tables"
  | "group-views"
  | "group-generic"
  | "object-mysql-table"
  | "object-queryable"
  | "object-readonly";

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
    case "group-generic":
      return { text: "GR", tone: "neutral" };
    case "object-mysql-table":
      return { text: "T", tone: "amber" };
    case "object-readonly":
      return { text: "NQ", tone: "muted" };
    case "object-queryable":
    default:
      return { text: "O", tone: "amber" };
  }
}

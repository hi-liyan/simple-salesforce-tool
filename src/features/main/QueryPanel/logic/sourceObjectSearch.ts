import type { SalesforceObject, SalesforceSource } from "../../../../types";

// 左侧数据源搜索结果：统一给 QuerySidebar 搜索面板使用。
export type QuerySourceObjectSearchResult = {
  // 命中的数据源 ID。
  sourceId: string;
  // 命中的数据源名称。
  sourceName: string;
  // 命中的数据源类型。
  sourceType: string;
  // 命中的对象/表名称。
  objectName: string;
  // 命中的展示标题。
  label: string;
  // 命中的对象备注：MySQL 场景优先展示 comment。
  secondaryText: string;
  // 当前对象是否允许直接打开查询。
  queryable: boolean;
};

type SearchSourceObjectsInput = {
  // 搜索关键字。
  keyword: string;
  // 当前数据源。
  source: SalesforceSource;
  // 当前数据源下的对象列表。
  objects: SalesforceObject[];
  // 最大返回条数。
  limit?: number;
};

// 搜索当前数据源对象：按名称、标签、备注做轻量匹配并给出稳定排序。
export function searchSourceObjects({ keyword, source, objects, limit = 24 }: SearchSourceObjectsInput): QuerySourceObjectSearchResult[] {
  const normalizedKeyword = normalizeSearchKeyword(keyword);
  if (!normalizedKeyword) return [];

  return [...objects]
    .map((objectItem) => {
      const matchScore = resolveObjectMatchScore(objectItem, normalizedKeyword);
      return {
        objectItem,
        matchScore
      };
    })
    .filter((item) => item.matchScore > 0)
    .sort((a, b) => {
      if (b.matchScore !== a.matchScore) {
        return b.matchScore - a.matchScore;
      }
      return a.objectItem.name.localeCompare(b.objectItem.name, "zh-CN");
    })
    .slice(0, limit)
    .map(({ objectItem }) => ({
      sourceId: source.id,
      sourceName: source.name,
      sourceType: String(source.sourceType || "salesforce"),
      objectName: objectItem.name,
      label: objectItem.label || objectItem.name,
      secondaryText: resolveObjectSecondaryText(objectItem),
      queryable: objectItem.queryable
    }));
}

// 统一规范搜索关键字：忽略首尾空白并转小写，减少大小写对命中的影响。
function normalizeSearchKeyword(keyword: string): string {
  return String(keyword || "").trim().toLocaleLowerCase();
}

// 解析对象次级说明：Salesforce 优先展示标签，MySQL 优先展示注释。
function resolveObjectSecondaryText(objectItem: SalesforceObject): string {
  const normalizedComment = String(objectItem.comment || "").trim();
  const normalizedLabel = String(objectItem.label || "").trim();
  return normalizedComment || normalizedLabel || objectItem.name;
}

// 计算单个对象的搜索分数：名称命中优先级最高，其次是标签和备注。
function resolveObjectMatchScore(objectItem: SalesforceObject, normalizedKeyword: string): number {
  const normalizedName = String(objectItem.name || "").toLocaleLowerCase();
  const normalizedLabel = String(objectItem.label || "").toLocaleLowerCase();
  const normalizedComment = String(objectItem.comment || "").toLocaleLowerCase();
  let score = 0;

  // 名称精确命中优先最高，便于快速跳到目标 Object/表。
  if (normalizedName === normalizedKeyword) score += 1000;
  else if (normalizedName.startsWith(normalizedKeyword)) score += 700;
  else if (normalizedName.includes(normalizedKeyword)) score += 420;

  // 标签命中作为辅助排序，兼顾 Salesforce 中文标签搜索。
  if (normalizedLabel === normalizedKeyword) score += 320;
  else if (normalizedLabel.startsWith(normalizedKeyword)) score += 220;
  else if (normalizedLabel.includes(normalizedKeyword)) score += 120;

  // 备注命中权重最低，主要用于 MySQL 表注释检索。
  if (normalizedComment === normalizedKeyword) score += 90;
  else if (normalizedComment.startsWith(normalizedKeyword)) score += 60;
  else if (normalizedComment.includes(normalizedKeyword)) score += 30;

  return score;
}

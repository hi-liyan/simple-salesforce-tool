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
  const keywordTokens = tokenizeSearchText(normalizedKeyword);
  const sourceAliasTerms = resolveSourceSearchAliasTerms(source);

  return [...objects]
    .map((objectItem) => {
      const matchScore = resolveObjectMatchScore(objectItem, normalizedKeyword, keywordTokens, sourceAliasTerms);
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
      const nameLengthDiff = a.objectItem.name.length - b.objectItem.name.length;
      if (nameLengthDiff !== 0) {
        return nameLengthDiff; // 行内注释：同分时优先更短、更直接的对象名，减少 archive / backup 类长名称抢前。
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
  return String(keyword || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

// 解析对象次级说明：Salesforce 优先展示标签，MySQL 优先展示注释。
function resolveObjectSecondaryText(objectItem: SalesforceObject): string {
  const normalizedComment = String(objectItem.comment || "").trim();
  const normalizedLabel = String(objectItem.label || "").trim();
  return normalizedComment || normalizedLabel || objectItem.name;
}

type SearchFieldConfig = {
  // 字段已规范化后的完整文本。
  value: string;
  // 字段拆词结果：用于支持多词、多分隔符和 camelCase 搜索。
  tokens: string[];
  // 完整关键字精确命中分数。
  exactScore: number;
  // 完整关键字前缀命中分数。
  prefixScore: number;
  // 完整关键字包含命中分数。
  includeScore: number;
  // 拆词命中基础分数。
  tokenScore: number;
};

// 计算单个对象的搜索分数：优先完整命中，再补充多词维度匹配。
function resolveObjectMatchScore(
  objectItem: SalesforceObject,
  normalizedKeyword: string,
  keywordTokens: string[],
  sourceAliasTerms: string[]
): number {
  const searchFieldConfigs = buildObjectSearchFieldConfigs(objectItem, sourceAliasTerms);
  let score = 0;

  searchFieldConfigs.forEach((fieldConfig) => {
    score += resolveFieldKeywordScore(fieldConfig, normalizedKeyword); // 行内注释：完整关键字命中优先处理，保证精确搜索排序稳定。
  });
  score += resolveFieldTokenCoverageScore(searchFieldConfigs, keywordTokens); // 行内注释：多词和别名命中作为补充分，支持“object account”“table order”这类组合搜索。

  return score;
}

// 构造对象搜索字段配置：统一收口名称、标签、注释与 Object/Table 别名。
function buildObjectSearchFieldConfigs(objectItem: SalesforceObject, sourceAliasTerms: string[]): SearchFieldConfig[] {
  return [
    createSearchFieldConfig(String(objectItem.name || ""), {
      exactScore: 1000,
      prefixScore: 700,
      includeScore: 420,
      tokenScore: 180
    }),
    createSearchFieldConfig(String(objectItem.label || ""), {
      exactScore: 320,
      prefixScore: 220,
      includeScore: 120,
      tokenScore: 80
    }),
    createSearchFieldConfig(String(objectItem.comment || ""), {
      exactScore: 90,
      prefixScore: 60,
      includeScore: 30,
      tokenScore: 36
    }),
    createSearchFieldConfig(sourceAliasTerms.join(" "), {
      exactScore: 60,
      prefixScore: 40,
      includeScore: 20,
      tokenScore: 24
    })
  ];
}

// 构造单个字段搜索配置：统一做规范化与拆词，避免评分逻辑里重复处理。
function createSearchFieldConfig(
  value: string,
  scores: Pick<SearchFieldConfig, "exactScore" | "prefixScore" | "includeScore" | "tokenScore">
): SearchFieldConfig {
  const normalizedValue = normalizeSearchKeyword(value);
  return {
    value: normalizedValue,
    tokens: tokenizeSearchText(value),
    ...scores
  };
}

// 解析完整关键字命中分数：名称命中仍保持最高优先级。
function resolveFieldKeywordScore(fieldConfig: SearchFieldConfig, normalizedKeyword: string): number {
  if (!fieldConfig.value || !normalizedKeyword) return 0;

  if (fieldConfig.value === normalizedKeyword) return fieldConfig.exactScore;
  if (fieldConfig.value.startsWith(normalizedKeyword)) return fieldConfig.prefixScore;
  if (fieldConfig.value.includes(normalizedKeyword)) return fieldConfig.includeScore;
  return 0;
}

// 解析多词覆盖得分：要求每个搜索词至少命中一个字段，避免只命中半句时误召回。
function resolveFieldTokenCoverageScore(fieldConfigs: SearchFieldConfig[], keywordTokens: string[]): number {
  if (keywordTokens.length === 0) return 0;

  let totalScore = 0;
  for (const keywordToken of keywordTokens) {
    let bestTokenScore = 0;
    fieldConfigs.forEach((fieldConfig) => {
      bestTokenScore = Math.max(bestTokenScore, resolveFieldTokenScore(fieldConfig, keywordToken));
    });

    if (bestTokenScore === 0) {
      return 0;
    }
    totalScore += bestTokenScore; // 行内注释：每个 token 只取最优字段，避免名称和标签重复叠分过高。
  }

  return totalScore + keywordTokens.length * 18;
}

// 解析单个 token 在单个字段上的得分：支持精确、前缀、包含与原始文本兜底命中。
function resolveFieldTokenScore(fieldConfig: SearchFieldConfig, keywordToken: string): number {
  if (!fieldConfig.value || !keywordToken) return 0;

  if (fieldConfig.tokens.some((token) => token === keywordToken)) return fieldConfig.tokenScore + 28;
  if (fieldConfig.tokens.some((token) => token.startsWith(keywordToken))) return fieldConfig.tokenScore + 18;
  if (fieldConfig.tokens.some((token) => token.includes(keywordToken))) return fieldConfig.tokenScore;
  if (fieldConfig.value.includes(keywordToken)) return Math.max(12, Math.floor(fieldConfig.tokenScore / 2));
  return 0;
}

// 拆分搜索文本：支持空格、下划线、短横线、点号与 camelCase 等多维度检索。
function tokenizeSearchText(value: string): string[] {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-./:]+/g, " ")
    .split(/\s+/)
    .map((item) => normalizeSearchKeyword(item))
    .filter(Boolean);
}

// 解析当前数据源的搜索别名：支持直接搜 Object / table / 对象 / 表。
function resolveSourceSearchAliasTerms(source: SalesforceSource): string[] {
  const normalizedSourceType = String(source.sourceType || "salesforce").toLocaleLowerCase();
  if (normalizedSourceType === "mysql") {
    return ["table", "tables", "表", "mysql"];
  }
  return ["object", "objects", "sobject", "对象", "salesforce"];
}

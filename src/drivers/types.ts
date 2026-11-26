import type { ObjectDescribe, ObjectField, QueryDrawerView, QueryResult, SalesforceObject, SalesforceSource, SourceSecretView } from "../types/index.ts";
import type { QueryLanguage } from "../components/codemirror/sqlCompletion.ts";

// DataGrid 字段策略类型。
export type GridFieldStrategy = "picklist" | "date" | "datetime" | "number" | "boolean" | "text";

// DataGrid 草稿值语义：统一封装 omit / default / null / value。
export type GridDraftValue =
  | { kind: "omit" }
  | { kind: "default" }
  | { kind: "null" }
  | { kind: "value"; value: unknown };

// DataGrid 数据源适配器：将表格组件与具体数据源解耦。
export interface GridAdapter {
  // 空值显示占位符（如 "Null" / "None"）。
  nullPlaceholder: string;
  // 右键置空动作文案（如 "Set Null" / "Set None"）。
  nullishActionLabel: "Set Null" | "Set None";
  // 是否支持右键“恢复默认值”动作。
  supportsDefaultValueAction: boolean;
  // 新建行留空时是否省略该字段（交由数据库默认值/自增生成）。
  omitEmptyOnNewRow: boolean;
  // 从元数据中解析主键列名（无专用主键列时返回空字符串）。
  resolvePrimaryKeyField: (fieldMetadataMap: Record<string, Record<string, unknown>>) => string;
  // 从记录中解析唯一行定位键。
  resolveRecordKey: (record: Record<string, unknown>, primaryKeyField?: string) => string;
  // 单元格草稿值编解码。
  codec: {
    encodeNull: () => unknown;
    encodeDefault: () => unknown;
    encodeOmit: () => unknown;
    encodeValue: (val: unknown) => unknown;
  };
  // 解析单元格展示状态与空值占位标记。
  resolveDisplayValue: (
    raw: unknown,
    metadata: Record<string, unknown>
  ) => { value: unknown; useNullPlaceholder: boolean };
  // 判断原始单元格值是否为空（用于新建行必填校验）。
  isBlankValue: (raw: unknown) => boolean;
  // 将日期时间字符串规范化为数据源保存格式。
  normalizeDatetimeForSave: (value: string, timezone?: string | null) => string | null;
  // 格式化日期单元格展示文本。
  formatDateDisplay: (value: unknown) => string;
  // 格式化日期时间单元格展示文本。
  formatDatetimeDisplay: (value: unknown, timezone?: string | null) => string;
  // 解析字段编辑与渲染策略。
  resolveFieldStrategy: (fieldMeta: Partial<ObjectField> & Record<string, unknown>) => GridFieldStrategy;
  // 是否支持打开云端记录详情页。
  supportsOpenRecordPage: boolean;
}

// 数据源前端能力声明矩阵。
export interface FrontendDriverCapabilities {
  // 查询语言标识。
  queryLanguage: QueryLanguage;
  // 是否支持 DDL 视图。
  supportsDdl: boolean;
  // 是否支持 EXPLAIN 执行计划。
  supportsExplain: boolean;
  // 是否支持多语句顺序执行。
  supportsMultiStatement: boolean;
  // 是否支持变更前 SQL 预览。
  supportsMutationPreview: boolean;
  // 是否支持单事务批量提交（含删除）。
  supportsTransactionalBatch: boolean;
  // 是否支持独立 OAuth 授权窗口。
  supportsAuthWindow: boolean;
  // 默认右侧抽屉视图。
  defaultDrawerView: QueryDrawerView;
}

// 数据源左侧树配置契约。
export interface DriverTreeConfig {
  // 是否按分组（如 tables）组织对象列表；false 时直接平铺对象节点。
  useGroupNodes: boolean;
  // 分组定义列表。
  groups: { groupType: string; label: string }[];
  // 对象节点是否支持向下展开字段（Columns）子节点。
  supportsColumnExpansion: boolean;
}

// 前端数据源驱动标准契约。
export interface DataSourceDriver {
  // 驱动类型标识（小写，如 "salesforce" / "mysql"）。
  kind: string;
  // 显示名称。
  displayName: string;
  // 徽章短文案。
  badgeLabel: string;
  // 徽章样式类名。
  badgeClassName: string;
  // 默认配置 JSON。
  defaultConfig: Record<string, unknown>;
  // 能力声明矩阵。
  capabilities: FrontendDriverCapabilities;
  // 左侧树展示与展开配置。
  treeConfig: DriverTreeConfig;
  // 表格适配器。
  gridAdapter: GridAdapter;
  // 为设置页按需水合敏感凭证视图。
  hydrateSourceSecrets: (source: SalesforceSource, secretView: SourceSecretView) => SalesforceSource;
  // 数据源树默认分组（兼容旧字段，优先读取 treeConfig.groups）。
  defaultTreeGroups?: { groupType: string; label: string }[];
}

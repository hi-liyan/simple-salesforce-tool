import type {
  ObjectDescribe,
  ObjectField,
  QueryDrawerView,
  QueryResult,
  SalesforceObject,
  SalesforceSource,
  SourceSecretView,
  SourceUpsertPayload
} from "../types/index.ts";
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
  // 驱动类型标识（供通用元数据格式化等纯适配层使用）。
  sourceKind: string;
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
  // 解析表头展示行（字段名、类型、注释/标签）：由驱动适配层统一收口，避免表格组件硬编码数据源分支。
  resolveHeaderDisplayLines?: (
    fieldName: string,
    metadata: Record<string, unknown>,
    runtimeType?: string
  ) => { primary: string; typeText: string | null; commentText: string | null };
  // 是否支持打开云端记录详情页。
  supportsOpenRecordPage: boolean;
}

// 数据源前端能力声明矩阵。
export interface FrontendDriverCapabilities {
  // 查询语言标识。
  queryLanguage: QueryLanguage;
  // 是否支持 DDL 视图。
  supportsDdl: boolean;
  // 是否支持图形化新建表与编辑表结构。
  supportsTableDesigner: boolean;
  // 是否支持逻辑数据库备份。
  supportsBackup: boolean;
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
  // 是否支持控制台交互式会话事务（Auto / Manual / Smart）。
  supportsInteractiveTransaction: boolean;
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
  // 对象节点展开后的子目录结构（如 MySQL 的 columns / keys / indexes）；为空时直接平铺字段。
  objectSubFolders?: ("columns" | "keys" | "indexes")[];
}

// 连接表单字段定义：由各数据源驱动声明，供统一连接向导动态渲染。
export interface DriverConnectionField {
  // 字段键名。
  key: string;
  // 显示标签。
  label: string;
  // 输入类型。
  type: "text" | "password" | "number" | "select";
  // 占位提示。
  placeholder?: string;
  // 默认值。
  defaultValue?: string;
  // 是否必填。
  required?: boolean;
  // 所属分组：auth 为主连接区，advanced 为高级折叠区。
  group: "auth" | "advanced";
  // 栅格跨度（1 或 2 列）。
  colSpan?: 1 | 2;
  // 字段说明。
  helpText?: string;
  // 下拉选项（仅 type === "select" 时使用）。
  options?: { label: string; value: string }[];
}

// 统一连接表单的通用元信息。
export interface ConnectionCommonMeta {
  // 数据源显示名称。
  name: string;
  // 标签颜色（十六进制或空）。
  color: string;
  // 环境标识（用于安全网关生产环境识别）。
  environment: "default" | "staging" | "prod";
  // 是否只读锁定（禁止写操作）。
  readOnly: boolean;
}

// 数据源连接配置 Schema：消除组件层硬编码表单分支。
export interface DriverConnectionSchema {
  // 驱动简介（用于新建向导左侧列表）。
  description: string;
  // 驱动专属字段列表。
  fields: DriverConnectionField[];
  // 是否支持浏览器 OAuth 授权登录。
  supportsOAuthLogin?: boolean;
  // 判断数据源是否由外部 CLI 托管凭证（如 Salesforce CLI 同步源）。
  isCliManagedSource?: (source: SalesforceSource) => boolean;
  // 将现有数据源与密钥视图回填为表单键值对。
  extractFormValues: (source: SalesforceSource, secretView?: SourceSecretView | null) => Record<string, string>;
  // 将表单键值对与通用元信息构造成后端 SourceUpsertPayload。
  buildPayload: (values: Record<string, string>, meta: ConnectionCommonMeta) => SourceUpsertPayload;
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
  // 连接表单 Schema（驱动自描述新建与编辑表单）。
  connectionSchema: DriverConnectionSchema;
  // 为设置页按需水合敏感凭证视图。
  hydrateSourceSecrets: (source: SalesforceSource, secretView: SourceSecretView) => SalesforceSource;
  // 数据源树默认分组（兼容旧字段，优先读取 treeConfig.groups）。
  defaultTreeGroups?: { groupType: string; label: string }[];
}

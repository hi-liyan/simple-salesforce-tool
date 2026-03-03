import type * as Monaco from "monaco-editor";

// 查询编辑器支持的语言类型：当前包含 SOQL 与 MySQL。
export type QueryLanguage = "soql" | "mysql";

// 运行时补全数据：由业务层按当前数据源动态传入。
export type RuntimeCompletions = {
  // 当前上下文可用字段集合。
  fields: string[];
  // 当前上下文可用对象/表集合。
  objects: string[];
  // 对象/表到字段列表的映射（key 不区分大小写）。
  objectFields: Record<string, string[]>;
};

// 通用语言模块接口：每种语言独立实现注册与补全逻辑。
export type MonacoLanguageModule = {
  // Monaco 语言 ID。
  languageId: string;
  // Monaco 主题 ID。
  themeId: string;
  // 注册语言能力（语法/补全/主题），需保证幂等。
  ensureRegistered: (monaco: typeof Monaco) => void;
  // 更新语言补全运行时数据。
  updateRuntimeCompletions: (runtime: RuntimeCompletions) => void;
};

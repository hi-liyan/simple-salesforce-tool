import type { MonacoLanguageModule, QueryLanguage } from "../types";
import { mysqlLanguageModule } from "./mysqlLanguage";
import { soqlLanguageModule } from "./soqlLanguage";

// 语言模块注册表：新增语言时在此处扩展映射。
const LANGUAGE_MODULE_MAP: Record<QueryLanguage, MonacoLanguageModule> = {
  soql: soqlLanguageModule,
  mysql: mysqlLanguageModule
};

// 按语言类型获取对应 Monaco 语言模块。
export function getMonacoLanguageModule(language: QueryLanguage): MonacoLanguageModule {
  return LANGUAGE_MODULE_MAP[language];
}

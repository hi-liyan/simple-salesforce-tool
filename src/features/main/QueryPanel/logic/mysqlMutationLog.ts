// MySQL 操作日志最小 SQL 条目：兼容预览项与执行结果项的公共字段。
export type MysqlMutationTabLogSqlItem = {
  // 操作类型：create/update/delete。
  op: string;
  // 同类操作内的顺序索引：用于在多条 SQL 日志中稳定标识条目。
  operationIndex: number;
  // 当前操作对应的预览 SQL 文本。
  previewSql: string;
};

// 构造单条 MySQL 操作日志标签：例如 create#0。
function buildMysqlMutationTabLogLabel(op: string, operationIndex: number): string {
  return `[${op}#${operationIndex}]`;
}

// 组装 MySQL 增删改 Tab 日志请求文本：多条 SQL 按操作顺序逐行拼接。
export function buildMysqlMutationTabLogRequest(items: MysqlMutationTabLogSqlItem[]): string {
  return items
    .filter((item) => item.previewSql.trim().length > 0)
    .map((item) => `${buildMysqlMutationTabLogLabel(item.op, item.operationIndex)} ${item.previewSql}`)
    .join("\n");
}

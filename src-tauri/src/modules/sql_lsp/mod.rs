use serde::{Deserialize, Serialize};
use sqlparser::dialect::{GenericDialect, MySqlDialect, PostgreSqlDialect};
use sqlparser::parser::{Parser, ParserError};

/// SQL AST 诊断条目（可直接映射为 Monaco Marker）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlDiagnostic {
    /// 起始行号（1-based）。
    pub line: usize,
    /// 起始列号（1-based）。
    pub column: usize,
    /// 诊断严重度（error / warning）。
    pub severity: String,
    /// 诊断说明文本。
    pub message: String,
}

/// 基于 `sqlparser` 对 SQL 文本执行 AST 语法诊断。
pub fn diagnose_sql_ast(sql: &str, dialect_name: &str) -> Vec<SqlDiagnostic> {
    if sql.trim().is_empty() {
        return Vec::new();
    }

    let parse_result = match dialect_name.trim().to_ascii_lowercase().as_str() {
        "mysql" => Parser::parse_sql(&MySqlDialect {}, sql),
        "postgres" | "postgresql" => Parser::parse_sql(&PostgreSqlDialect {}, sql),
        _ => Parser::parse_sql(&GenericDialect {}, sql),
    };

    match parse_result {
        Ok(_) => Vec::new(),
        Err(ParserError::ParserError(msg)) => {
            let (line, column) = extract_line_col(&msg).unwrap_or((1, 1));
            vec![SqlDiagnostic {
                line,
                column,
                severity: "error".to_string(),
                message: msg,
            }]
        }
        Err(other) => vec![SqlDiagnostic {
            line: 1,
            column: 1,
            severity: "error".to_string(),
            message: other.to_string(),
        }],
    }
}

/// 按分号拆解多条 SQL 语句（保留引号与注释中的分号）。
pub fn split_sql_statements(sql: &str) -> Vec<String> {
    let mut statements = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut chars = sql.chars().peekable();

    while let Some(ch) = chars.next() {
        if let Some(q) = quote {
            current.push(ch);
            if ch == '\\' {
                if let Some(next_ch) = chars.next() {
                    current.push(next_ch);
                }
            } else if ch == q {
                quote = None;
            }
            continue;
        }

        if ch == '\'' || ch == '"' || ch == '`' {
            quote = Some(ch);
            current.push(ch);
            continue;
        }

        if ch == '-' && chars.peek() == Some(&'-') {
            current.push(ch);
            for next_ch in chars.by_ref() {
                current.push(next_ch);
                if next_ch == '\n' {
                    break;
                }
            }
            continue;
        }

        if ch == ';' {
            let trimmed = current.trim();
            if !trimmed.is_empty() {
                statements.push(trimmed.to_string());
            }
            current.clear();
            continue;
        }

        current.push(ch);
    }

    let trimmed = current.trim();
    if !trimmed.is_empty() {
        statements.push(trimmed.to_string());
    }
    statements
}

/// 从 `sqlparser` 错误消息中提取 `Line: X, Column: Y`。
fn extract_line_col(message: &str) -> Option<(usize, usize)> {
    let line_marker = "Line: ";
    let col_marker = "Column: ";
    let line_idx = message.find(line_marker)? + line_marker.len();
    let line_str: String = message[line_idx..]
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    let col_idx = message.find(col_marker)? + col_marker.len();
    let col_str: String = message[col_idx..]
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    Some((line_str.parse().ok()?, col_str.parse().ok()?))
}

#[cfg(test)]
mod tests {
    use super::{diagnose_sql_ast, split_sql_statements};

    #[test]
    fn diagnoses_valid_and_invalid_mysql_ast() {
        assert!(diagnose_sql_ast("SELECT id, name FROM users WHERE id = 1", "mysql").is_empty());
        let errors = diagnose_sql_ast("SELECT FROM WHERE", "mysql");
        assert!(!errors.is_empty());
        assert_eq!(errors[0].severity, "error");
    }

    #[test]
    fn splits_multi_statements_respecting_quotes() {
        let stmts = split_sql_statements(
            "SELECT 'a;b' FROM users; UPDATE users SET name = 'x' WHERE id = 1;",
        );
        assert_eq!(stmts.len(), 2);
        assert_eq!(stmts[0], "SELECT 'a;b' FROM users");
        assert_eq!(stmts[1], "UPDATE users SET name = 'x' WHERE id = 1");
    }
}

use serde::{Deserialize, Serialize};

/// SQL 安全检查风险等级。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SqlRiskLevel {
    /// 低风险（如只读查询）。
    Low,
    /// 中风险（如带 WHERE 的单表写操作）。
    Medium,
    /// 高风险（如 DROP/TRUNCATE/ALTER、无 WHERE 删改或生产环境写操作）。
    High,
}

/// SQL 安全网关判定结果。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "decision", rename_all = "camelCase")]
pub enum SqlGuardDecision {
    /// 允许直接执行。
    Allow {
        statement_type: String,
        risk_level: SqlRiskLevel,
    },
    /// 硬拦截（如只读数据源禁止写操作）。
    Deny {
        statement_type: String,
        reason: String,
    },
    /// 高危操作：需要前端弹窗由用户显式二次确认后才允许执行。
    RequireConfirmation {
        statement_type: String,
        risk_level: SqlRiskLevel,
        reason: String,
    },
}

/// SQL 安全检查上下文。
#[derive(Debug, Clone)]
pub struct SqlGuardContext {
    /// 数据源环境（如 default / dev / staging / prod）。
    pub environment: String,
    /// 是否只读数据源。
    pub read_only: bool,
    /// 用户是否已完成高危二次确认。
    pub confirmed: bool,
}

/// 检查 SQL/SOQL 语句安全性，防止只读源写入与无保护高危操作。
pub fn evaluate_sql_safety(sql: &str, ctx: &SqlGuardContext) -> SqlGuardDecision {
    let trimmed = strip_leading_comments(sql).trim();
    if trimmed.is_empty() {
        return SqlGuardDecision::Deny {
            statement_type: "EMPTY".to_string(),
            reason: "SQL 语句不能为空".to_string(),
        };
    }

    let upper = trimmed.to_ascii_uppercase();
    let statement_type = detect_statement_type(&upper);
    let is_read_only_stmt = matches!(
        statement_type.as_str(),
        "SELECT" | "SHOW" | "DESCRIBE" | "DESC" | "EXPLAIN" | "WITH"
    );

    if ctx.read_only && !is_read_only_stmt {
        return SqlGuardDecision::Deny {
            statement_type,
            reason: "当前数据源已锁定为只读模式，禁止执行任何写入或 DDL 语句。".to_string(),
        };
    }

    if is_read_only_stmt {
        return SqlGuardDecision::Allow {
            statement_type,
            risk_level: SqlRiskLevel::Low,
        };
    }

    // 检查高危 DDL。
    if matches!(statement_type.as_str(), "DROP" | "TRUNCATE" | "ALTER") {
        if ctx.confirmed {
            return SqlGuardDecision::Allow {
                statement_type,
                risk_level: SqlRiskLevel::High,
            };
        }
        return SqlGuardDecision::RequireConfirmation {
            statement_type: statement_type.clone(),
            risk_level: SqlRiskLevel::High,
            reason: format!("检测到高危结构变更语句 `{statement_type}`，请确认后再执行。"),
        };
    }

    // 检查无 WHERE 条件的 UPDATE / DELETE。
    if matches!(statement_type.as_str(), "UPDATE" | "DELETE") && !has_where_clause(&upper) {
        if ctx.confirmed {
            return SqlGuardDecision::Allow {
                statement_type,
                risk_level: SqlRiskLevel::High,
            };
        }
        return SqlGuardDecision::RequireConfirmation {
            statement_type: statement_type.clone(),
            risk_level: SqlRiskLevel::High,
            reason: format!("检测到无 WHERE 条件的 `{statement_type}` 全表变更语句，请确认后再执行。"),
        };
    }

    // 生产环境任意写操作均需二次确认。
    if ctx.environment.trim().eq_ignore_ascii_case("prod") && !ctx.confirmed {
        return SqlGuardDecision::RequireConfirmation {
            statement_type,
            risk_level: SqlRiskLevel::High,
            reason: "当前处于生产环境（prod），执行写操作前需要二次确认。".to_string(),
        };
    }

    SqlGuardDecision::Allow {
        statement_type,
        risk_level: SqlRiskLevel::Medium,
    }
}

/// 剥离前导单行/多行注释，避免注释干扰语句类型识别。
fn strip_leading_comments(mut input: &str) -> &str {
    loop {
        let trimmed = input.trim_start();
        if let Some(rest) = trimmed.strip_prefix("--") {
            if let Some(idx) = rest.find('\n') {
                input = &rest[idx + 1..];
                continue;
            }
            return "";
        }
        if let Some(rest) = trimmed.strip_prefix("/*") {
            if let Some(idx) = rest.find("*/") {
                input = &rest[idx + 2..];
                continue;
            }
            return "";
        }
        return trimmed;
    }
}

/// 识别主语句关键字。
fn detect_statement_type(upper_sql: &str) -> String {
    upper_sql
        .split(|ch: char| ch.is_whitespace() || ch == '(' || ch == ';')
        .find(|token| !token.is_empty())
        .unwrap_or("UNKNOWN")
        .to_string()
}

/// 判断 UPDATE / DELETE 语句是否包含 WHERE 子句。
fn has_where_clause(upper_sql: &str) -> bool {
    upper_sql
        .split(|ch: char| !ch.is_ascii_alphanumeric() && ch != '_')
        .any(|token| token == "WHERE")
}

#[cfg(test)]
mod tests {
    use super::{evaluate_sql_safety, SqlGuardContext, SqlGuardDecision, SqlRiskLevel};

    #[test]
    fn denies_write_statements_on_readonly_source() {
        let decision = evaluate_sql_safety(
            "DELETE FROM users WHERE id = 1",
            &SqlGuardContext {
                environment: "dev".into(),
                read_only: true,
                confirmed: true,
            },
        );
        assert!(matches!(decision, SqlGuardDecision::Deny { .. }));
    }

    #[test]
    fn requires_confirmation_for_update_without_where() {
        let decision = evaluate_sql_safety(
            "/* comment */ UPDATE users SET active = 0",
            &SqlGuardContext {
                environment: "dev".into(),
                read_only: false,
                confirmed: false,
            },
        );
        assert!(matches!(
            decision,
            SqlGuardDecision::RequireConfirmation {
                risk_level: SqlRiskLevel::High,
                ..
            }
        ));
    }

    #[test]
    fn allows_select_on_readonly_prod_source() {
        let decision = evaluate_sql_safety(
            "SELECT id, name FROM users LIMIT 10",
            &SqlGuardContext {
                environment: "prod".into(),
                read_only: true,
                confirmed: false,
            },
        );
        assert_eq!(
            decision,
            SqlGuardDecision::Allow {
                statement_type: "SELECT".into(),
                risk_level: SqlRiskLevel::Low,
            }
        );
    }
}

use crate::error::AppError;

/// 校验 MySQL 标识符（表名/字段名），防止 SQL 注入。
pub fn ensure_safe_identifier(raw: &str, label: &str) -> Result<String, AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::Biz(format!("{label}不能为空")));
    }
    if trimmed
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '$')
    {
        Ok(trimmed.to_string())
    } else {
        Err(AppError::Biz(format!("{label}包含非法字符: {trimmed}")))
    }
}

/// 限制 query_records 为只读语句，避免把写操作误放到查询入口。
pub fn ensure_readonly_query(query_text: &str) -> Result<(), AppError> {
    let normalized = query_text.trim().to_lowercase();
    if normalized.is_empty() {
        return Err(AppError::Biz("查询语句不能为空".to_string()));
    }
    if normalized.starts_with("select")
        || normalized.starts_with("show")
        || normalized.starts_with("with")
        || normalized.starts_with("desc")
        || normalized.starts_with("describe")
    {
        return Ok(());
    }
    Err(AppError::Biz(
        "MySQL 查询仅允许只读语句（SELECT/SHOW/WITH/DESC）".to_string(),
    ))
}

/// 从 SQL 文本中尝试推断首个 FROM 表名。
pub fn infer_table_name_from_query(query_text: &str) -> Option<String> {
    let lower = query_text.to_lowercase();
    let from_index = lower.find(" from ")?;
    let tail = query_text[from_index + 6..].trim_start();
    let token = tail
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .trim_matches('`')
        .trim_matches(',')
        .trim();
    if token.is_empty() {
        return None;
    }
    if ensure_safe_identifier(token, "表名").is_ok() {
        Some(token.to_string())
    } else {
        None
    }
}

/// 去掉尾部 `;`，避免包装子查询时生成非法 SQL。
pub fn trim_trailing_semicolon(query_text: &str) -> &str {
    query_text.trim().trim_end_matches(';').trim_end()
}

/// 判断当前位置是否命中完整关键字。
pub fn is_keyword_matched(query_text: &str, start_index: usize, keyword: &str) -> bool {
    let lower_query_text = query_text.to_ascii_lowercase();
    let lower_keyword = keyword.to_ascii_lowercase();
    if !lower_query_text[start_index..].starts_with(&lower_keyword) {
        return false;
    }
    let before_char = if start_index > 0 {
        query_text[..start_index].chars().next_back().unwrap_or(' ')
    } else {
        ' '
    };
    let after_index = start_index + keyword.len();
    let after_char = query_text[after_index..].chars().next().unwrap_or(' ');
    !before_char.is_ascii_alphanumeric()
        && before_char != '_'
        && !after_char.is_ascii_alphanumeric()
        && after_char != '_'
}

/// 查找顶层关键字位置：忽略括号内子查询与字符串字面量中的同名片段。
pub fn find_top_level_keyword_index(
    query_text: &str,
    keyword: &str,
    from_index: usize,
) -> Option<usize> {
    let mut depth = 0usize;
    let mut string_quote: Option<char> = None;

    for (index, ch) in query_text.char_indices() {
        if index < from_index {
            continue;
        }
        if let Some(quote) = string_quote {
            if ch == quote {
                let previous_char = query_text[..index].chars().next_back().unwrap_or('\0');
                if previous_char != '\\' {
                    string_quote = None;
                }
            }
            continue;
        }
        if ch == '\'' || ch == '"' {
            let previous_char = query_text[..index].chars().next_back().unwrap_or('\0');
            if previous_char != '\\' {
                string_quote = Some(ch);
            }
            continue;
        }
        if ch == '(' {
            depth += 1;
            continue;
        }
        if ch == ')' {
            depth = depth.saturating_sub(1);
            continue;
        }
        if depth == 0 && is_keyword_matched(query_text, index, keyword) {
            return Some(index);
        }
    }

    None
}

/// 删除根查询级 LIMIT/OFFSET 片段。
pub fn strip_top_level_limit_offset_clause(query_text: &str) -> String {
    let normalized = trim_trailing_semicolon(query_text);
    let limit_index = find_top_level_keyword_index(normalized, "limit", 0);
    let offset_index = find_top_level_keyword_index(normalized, "offset", 0);
    let cut_index = match (limit_index, offset_index) {
        (Some(limit), Some(offset)) => Some(limit.min(offset)),
        (Some(limit), None) => Some(limit),
        (None, Some(offset)) => Some(offset),
        (None, None) => None,
    };
    cut_index
        .map(|index| normalized[..index].trim_end().to_string())
        .unwrap_or_else(|| normalized.to_string())
}

/// 删除根查询级 ORDER BY，供 COUNT 包装复用。
pub fn strip_top_level_order_by_clause(query_text: &str) -> String {
    let normalized = trim_trailing_semicolon(query_text);
    find_top_level_keyword_index(normalized, "order by", 0)
        .map(|index| normalized[..index].trim_end().to_string())
        .unwrap_or_else(|| normalized.to_string())
}

/// 判断根查询是否显式带 LIMIT/OFFSET。
pub fn has_top_level_limit_or_offset(query_text: &str) -> bool {
    let normalized = trim_trailing_semicolon(query_text);
    find_top_level_keyword_index(normalized, "limit", 0).is_some()
        || find_top_level_keyword_index(normalized, "offset", 0).is_some()
}

/// 为分页查询构造真实总数统计 SQL。
pub fn build_total_count_query(query_text: &str) -> String {
    let without_pagination = strip_top_level_limit_offset_clause(query_text);
    let without_order = strip_top_level_order_by_clause(&without_pagination);
    format!(
        "SELECT COUNT(*) AS total_count FROM ({}) AS query_panel_total",
        without_order.trim()
    )
}

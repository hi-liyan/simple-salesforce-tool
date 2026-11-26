use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::storage::{secret_repo, Storage};

/// AI 模型配置持久化记录（不含明文密钥，密钥通过 `secret_repo` AEAD 加密落盘）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfigRecord {
    /// 配置主键 ID。
    pub id: String,
    /// 配置名称（如 "DeepSeek R1"、"OpenAI GPT-4o"）。
    pub name: String,
    /// 模型提供商标识（openai / openai_compatible / claude / deepseek / qwen / ollama / custom）。
    pub provider: String,
    /// 协议风格（completions / anthropic_messages）。
    pub api_style: String,
    /// API 基础地址。
    pub base_url: String,
    /// 默认模型名称。
    pub model: String,
    /// 请求超时时间（毫秒）。
    pub timeout_ms: i64,
    /// 是否为默认配置。
    pub is_default: bool,
    /// 创建时间（RFC3339）。
    pub created_at: String,
    /// 更新时间（RFC3339）。
    pub updated_at: String,
}

/// AI 配置完整视图（供前端安全展示，包含密钥掩码）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfigView {
    #[serde(flatten)]
    pub config: AiConfigRecord,
    /// 是否已配置 API Key。
    pub api_key_configured: bool,
    /// API Key 掩码文本。
    pub api_key_masked: String,
}

/// AI 配置写入负载。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfigUpsertPayload {
    /// 编辑时传入 ID，新建时可为空。
    pub id: Option<String>,
    /// 配置名称。
    pub name: String,
    /// 模型提供商标识。
    pub provider: String,
    /// 协议风格（默认 completions）。
    pub api_style: Option<String>,
    /// API 基础地址。
    pub base_url: String,
    /// 模型名称。
    pub model: String,
    /// 密钥明文（编辑时留空或 None 表示保留原有密钥）。
    pub api_key: Option<String>,
    /// 超时毫秒数。
    pub timeout_ms: Option<i64>,
    /// 是否设为默认。
    pub is_default: Option<bool>,
}

/// AI 会话持久化记录。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConversationRecord {
    /// 会话唯一 ID。
    pub id: String,
    /// 会话标题。
    pub title: String,
    /// 关联数据源 ID。
    pub source_id: String,
    /// 关联数据源名称。
    pub source_name: String,
    /// 会话模式（ask / agent）。
    pub mode: String,
    /// 序列化消息列表 JSON。
    pub messages_json: String,
    /// 创建时间（RFC3339）。
    pub created_at: String,
    /// 更新时间（RFC3339）。
    pub updated_at: String,
}

/// AI 提示词模板记录。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiPromptTemplateRecord {
    /// 模板 ID。
    pub id: String,
    /// 模板名称。
    pub name: String,
    /// 分类（general / sql / optimize / explain）。
    pub category: String,
    /// 模板正文。
    pub content: String,
    /// 创建时间。
    pub created_at: String,
    /// 更新时间。
    pub updated_at: String,
}

/// 读取指定配置的密钥明文（用于后端发起模型请求）。
pub fn read_ai_config_api_key(storage: &Storage, config_id: &str) -> Result<String, AppError> {
    storage.write_tx(|tx| {
        let Some(bundle) = secret_repo::find_bundle_by_owner(tx, "ai_config", config_id)? else {
            return Ok(String::new());
        };
        Ok(secret_repo::read_secret_item_plaintext(tx, &bundle.id, "api_key")?.unwrap_or_default())
    })
}

/// 对密钥做安全掩码，禁止将明文透传前端。
pub fn mask_secret_key(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if trimmed.len() <= 8 {
        return "****".to_string();
    }
    format!("{}****{}", &trimmed[..3], &trimmed[trimmed.len() - 4..])
}

/// 列出全部 AI 配置视图。
pub fn list_ai_configs(storage: &Storage) -> Result<Vec<AiConfigView>, AppError> {
    let records = storage.read(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, name, provider, api_style, base_url, model, timeout_ms, is_default, created_at, updated_at
             FROM ai_configs
             ORDER BY is_default DESC, updated_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(AiConfigRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                provider: row.get(2)?,
                api_style: row.get(3)?,
                base_url: row.get(4)?,
                model: row.get(5)?,
                timeout_ms: row.get(6)?,
                is_default: row.get::<_, i64>(7)? != 0,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
    })?;

    let mut views = Vec::with_capacity(records.len());
    for config in records {
        let key = read_ai_config_api_key(storage, &config.id).unwrap_or_default();
        views.push(AiConfigView {
            config,
            api_key_configured: !key.trim().is_empty(),
            api_key_masked: mask_secret_key(&key),
        });
    }
    Ok(views)
}

/// 获取指定配置（或默认配置）及其明文密钥。
pub fn get_ai_config_with_secret(
    storage: &Storage,
    config_id: Option<&str>,
) -> Result<Option<(AiConfigRecord, String)>, AppError> {
    let record = storage.read(|conn| {
        if let Some(id) = config_id.map(str::trim).filter(|v| !v.is_empty()) {
            conn.query_row(
                "SELECT id, name, provider, api_style, base_url, model, timeout_ms, is_default, created_at, updated_at
                 FROM ai_configs WHERE id = ?1",
                params![id],
                |row| {
                    Ok(AiConfigRecord {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        provider: row.get(2)?,
                        api_style: row.get(3)?,
                        base_url: row.get(4)?,
                        model: row.get(5)?,
                        timeout_ms: row.get(6)?,
                        is_default: row.get::<_, i64>(7)? != 0,
                        created_at: row.get(8)?,
                        updated_at: row.get(9)?,
                    })
                },
            )
            .optional()
            .map_err(AppError::from)
        } else {
            conn.query_row(
                "SELECT id, name, provider, api_style, base_url, model, timeout_ms, is_default, created_at, updated_at
                 FROM ai_configs
                 ORDER BY is_default DESC, updated_at DESC
                 LIMIT 1",
                [],
                |row| {
                    Ok(AiConfigRecord {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        provider: row.get(2)?,
                        api_style: row.get(3)?,
                        base_url: row.get(4)?,
                        model: row.get(5)?,
                        timeout_ms: row.get(6)?,
                        is_default: row.get::<_, i64>(7)? != 0,
                        created_at: row.get(8)?,
                        updated_at: row.get(9)?,
                    })
                },
            )
            .optional()
            .map_err(AppError::from)
        }
    })?;

    let Some(config) = record else {
        return Ok(None);
    };
    let key = read_ai_config_api_key(storage, &config.id)?;
    Ok(Some((config, key)))
}

/// 新增或更新 AI 配置，并将 apiKey 通过 AEAD 加密落盘至 `secret_items`。
pub fn upsert_ai_config(
    storage: &Storage,
    payload: AiConfigUpsertPayload,
) -> Result<AiConfigView, AppError> {
    let name = payload.name.trim();
    let provider = payload.provider.trim();
    let base_url = payload.base_url.trim();
    let model = payload.model.trim();
    if name.is_empty() || base_url.is_empty() || model.is_empty() {
        return Err(AppError::Biz("AI 配置名称、Base URL 与模型名称不能为空".to_string()));
    }

    let now = Utc::now().to_rfc3339();
    let config_id = payload
        .id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| format!("ai-cfg-{}", uuid::Uuid::new_v4()));
    let api_style = payload
        .api_style
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| {
            if provider.eq_ignore_ascii_case("claude")
                || provider.eq_ignore_ascii_case("anthropic_compatible")
            {
                "anthropic_messages"
            } else {
                "completions"
            }
        })
        .to_string();
    let timeout_ms = payload.timeout_ms.unwrap_or(60_000).clamp(3_000, 300_000);

    let saved = storage.write_tx(|tx| {
        let existing_count: i64 =
            tx.query_row("SELECT COUNT(1) FROM ai_configs", [], |row| row.get(0))?;
        let make_default = payload.is_default.unwrap_or(existing_count == 0);
        if make_default {
            tx.execute("UPDATE ai_configs SET is_default = 0 WHERE is_default = 1", [])?;
        }

        let created_at: String = tx
            .query_row(
                "SELECT created_at FROM ai_configs WHERE id = ?1",
                params![config_id],
                |row| row.get(0),
            )
            .optional()?
            .unwrap_or_else(|| now.clone());

        tx.execute(
            "INSERT INTO ai_configs (
                id, name, provider, api_style, base_url, model, timeout_ms, is_default, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                provider = excluded.provider,
                api_style = excluded.api_style,
                base_url = excluded.base_url,
                model = excluded.model,
                timeout_ms = excluded.timeout_ms,
                is_default = CASE WHEN excluded.is_default = 1 THEN 1 ELSE ai_configs.is_default END,
                updated_at = excluded.updated_at",
            params![
                config_id,
                name,
                provider,
                api_style,
                base_url,
                model,
                timeout_ms,
                if make_default { 1 } else { 0 },
                created_at,
                now
            ],
        )?;

        if let Some(raw_key) = payload.api_key.as_deref() {
            let trimmed_key = raw_key.trim();
            if !trimmed_key.is_empty() {
                let existing_bundle = secret_repo::find_bundle_by_owner(tx, "ai_config", &config_id)?;
                let bundle_id = secret_repo::ensure_secret_bundle(
                    tx,
                    "ai_config",
                    &config_id,
                    existing_bundle.as_ref().map(|b| b.id.as_str()),
                    &format!("AI 配置密钥 ({name})"),
                )?;
                secret_repo::upsert_secret_item(
                    tx,
                    &secret_repo::SecretItemRecord {
                        id: format!("sec-{config_id}-api_key"),
                        bundle_id,
                        secret_key: "api_key".to_string(),
                        plain_text: trimmed_key.to_string(),
                    },
                )?;
            }
        }

        let is_default: i64 = tx.query_row(
            "SELECT is_default FROM ai_configs WHERE id = ?1",
            params![config_id],
            |row| row.get(0),
        )?;

        Ok(AiConfigRecord {
            id: config_id.clone(),
            name: name.to_string(),
            provider: provider.to_string(),
            api_style,
            base_url: base_url.to_string(),
            model: model.to_string(),
            timeout_ms,
            is_default: is_default != 0,
            created_at,
            updated_at: now,
        })
    })?;

    let key = read_ai_config_api_key(storage, &saved.id).unwrap_or_default();
    Ok(AiConfigView {
        config: saved,
        api_key_configured: !key.trim().is_empty(),
        api_key_masked: mask_secret_key(&key),
    })
}

/// 将指定配置设为默认。
pub fn set_default_ai_config(storage: &Storage, config_id: &str) -> Result<(), AppError> {
    storage.write_tx(|tx| {
        tx.execute("UPDATE ai_configs SET is_default = 0 WHERE is_default = 1", [])?;
        let affected = tx.execute(
            "UPDATE ai_configs SET is_default = 1, updated_at = ?2 WHERE id = ?1",
            params![config_id, Utc::now().to_rfc3339()],
        )?;
        if affected == 0 {
            return Err(AppError::Biz(format!("未找到 AI 配置: {config_id}")));
        }
        Ok(())
    })
}

/// 删除指定 AI 配置及关联加密密钥。
pub fn delete_ai_config(storage: &Storage, config_id: &str) -> Result<(), AppError> {
    storage.write_tx(|tx| {
        let was_default: Option<i64> = tx
            .query_row(
                "SELECT is_default FROM ai_configs WHERE id = ?1",
                params![config_id],
                |row| row.get(0),
            )
            .optional()?;
        tx.execute("DELETE FROM ai_configs WHERE id = ?1", params![config_id])?;
        if let Some(bundle) = secret_repo::find_bundle_by_owner(tx, "ai_config", config_id)? {
            tx.execute("DELETE FROM secret_items WHERE bundle_id = ?1", params![bundle.id])?;
            tx.execute("DELETE FROM secret_bundles WHERE id = ?1", params![bundle.id])?;
        }
        // 若删掉了默认配置，自动将最近更新的一条设为默认。
        if was_default == Some(1) {
            if let Some(next_id) = tx
                .query_row(
                    "SELECT id FROM ai_configs ORDER BY updated_at DESC LIMIT 1",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .optional()?
            {
                tx.execute(
                    "UPDATE ai_configs SET is_default = 1 WHERE id = ?1",
                    params![next_id],
                )?;
            }
        }
        Ok(())
    })
}

/// 列出全部持久化的 AI 会话历史（按更新时间倒序）。
pub fn list_ai_conversations(storage: &Storage) -> Result<Vec<AiConversationRecord>, AppError> {
    storage.read(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, title, source_id, source_name, mode, messages_json, created_at, updated_at
             FROM ai_conversations
             ORDER BY updated_at DESC
             LIMIT 100",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(AiConversationRecord {
                id: row.get(0)?,
                title: row.get(1)?,
                source_id: row.get(2)?,
                source_name: row.get(3)?,
                mode: row.get(4)?,
                messages_json: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
    })
}

/// 保存或更新单条 AI 会话历史。
pub fn save_ai_conversation(
    storage: &Storage,
    record: AiConversationRecord,
) -> Result<AiConversationRecord, AppError> {
    let now = Utc::now().to_rfc3339();
    storage.write_tx(|tx| {
        let created_at: String = tx
            .query_row(
                "SELECT created_at FROM ai_conversations WHERE id = ?1",
                params![record.id],
                |row| row.get(0),
            )
            .optional()?
            .unwrap_or_else(|| {
                if record.created_at.trim().is_empty() {
                    now.clone()
                } else {
                    record.created_at.clone()
                }
            });
        tx.execute(
            "INSERT INTO ai_conversations (id, title, source_id, source_name, mode, messages_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                source_id = excluded.source_id,
                source_name = excluded.source_name,
                mode = excluded.mode,
                messages_json = excluded.messages_json,
                updated_at = excluded.updated_at",
            params![
                record.id,
                record.title,
                record.source_id,
                record.source_name,
                record.mode,
                record.messages_json,
                created_at,
                now
            ],
        )?;
        Ok(AiConversationRecord {
            created_at,
            updated_at: now,
            ..record
        })
    })
}

/// 删除指定 AI 会话历史。
pub fn delete_ai_conversation(storage: &Storage, conversation_id: &str) -> Result<(), AppError> {
    storage.write(|conn| {
        conn.execute("DELETE FROM ai_conversations WHERE id = ?1", params![conversation_id])?;
        Ok(())
    })
}

/// 列出全部自定义提示词模板。
pub fn list_ai_prompt_templates(storage: &Storage) -> Result<Vec<AiPromptTemplateRecord>, AppError> {
    storage.read(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, name, category, content, created_at, updated_at
             FROM ai_prompt_templates
             ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(AiPromptTemplateRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                category: row.get(2)?,
                content: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
    })
}

/// 新增或更新自定义提示词模板。
pub fn save_ai_prompt_template(
    storage: &Storage,
    id: Option<String>,
    name: String,
    category: String,
    content: String,
) -> Result<AiPromptTemplateRecord, AppError> {
    let now = Utc::now().to_rfc3339();
    let template_id = id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| format!("tpl-{}", uuid::Uuid::new_v4()));

    storage.write_tx(|tx| {
        let created_at: String = tx
            .query_row(
                "SELECT created_at FROM ai_prompt_templates WHERE id = ?1",
                params![template_id],
                |row| row.get(0),
            )
            .optional()?
            .unwrap_or_else(|| now.clone());
        tx.execute(
            "INSERT INTO ai_prompt_templates (id, name, category, content, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                category = excluded.category,
                content = excluded.content,
                updated_at = excluded.updated_at",
            params![template_id, name, category, content, created_at, now],
        )?;
        Ok(AiPromptTemplateRecord {
            id: template_id,
            name,
            category,
            content,
            created_at,
            updated_at: now,
        })
    })
}

/// 删除指定提示词模板。
pub fn delete_ai_prompt_template(storage: &Storage, template_id: &str) -> Result<(), AppError> {
    storage.write(|conn| {
        conn.execute("DELETE FROM ai_prompt_templates WHERE id = ?1", params![template_id])?;
        Ok(())
    })
}

use std::time::Duration;

use serde::{Deserialize, Serialize};
use sqlx::mysql::{MySqlPool, MySqlPoolOptions};

use crate::drivers::mysql::sql_utils::ensure_safe_identifier;
use crate::error::AppError;
use crate::models::SalesforceSource;

/// MySQL 数据源连接配置（来自 source.config_json）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MySqlSourceConfig {
    /// 数据库主机地址。
    pub host: String,
    /// 数据库端口，默认 3306。
    #[serde(default = "default_mysql_port")]
    pub port: u16,
    /// 目标数据库（schema）名称。
    pub database: String,
    /// 用户名。
    pub username: String,
    /// 密码。
    #[serde(default)]
    pub password: String,
    /// 连接字符集，默认 utf8mb4。
    #[serde(default = "default_mysql_charset")]
    pub charset: String,
    /// SSL 模式（disable/preferred/required）。
    #[serde(default)]
    pub ssl_mode: Option<String>,
    /// 主键字段名覆盖（未配置时自动读取信息架构）。
    #[serde(default)]
    pub primary_key: Option<String>,
    /// 直接连接串（配置时优先于 host/port 拼接）。
    #[serde(default)]
    pub url: Option<String>,
}

/// MySQL 默认端口。
pub fn default_mysql_port() -> u16 {
    3306
}

/// MySQL 默认字符集。
pub fn default_mysql_charset() -> String {
    "utf8mb4".to_string()
}

impl MySqlSourceConfig {
    /// 从通用数据源结构中解析 MySQL 配置并做基础校验。
    pub fn from_source(source: &SalesforceSource) -> Result<Self, AppError> {
        let mut parsed = serde_json::from_value::<MySqlSourceConfig>(source.config_json.clone())
            .map_err(|error| AppError::Biz(format!("MySQL 配置解析失败: {error}")))?;

        if parsed.host.trim().is_empty() {
            return Err(AppError::Biz("MySQL host 不能为空".to_string()));
        }
        if parsed.database.trim().is_empty() {
            return Err(AppError::Biz("MySQL database 不能为空".to_string()));
        }
        if parsed.username.trim().is_empty() {
            return Err(AppError::Biz("MySQL username 不能为空".to_string()));
        }
        if let Some(primary_key) = parsed.primary_key.as_ref() {
            let _ = ensure_safe_identifier(primary_key, "primaryKey")?;
        }
        if parsed.charset.trim().is_empty() {
            parsed.charset = default_mysql_charset();
        }
        Ok(parsed)
    }

    /// 生成连接 URL（优先使用显式 url）。
    pub fn to_connection_url(&self) -> String {
        if let Some(url) = self.url.as_ref() {
            if !url.trim().is_empty() {
                return url.trim().to_string();
            }
        }
        let username = urlencoding::encode(self.username.trim());
        let password = urlencoding::encode(self.password.trim());
        let host = self.host.trim();
        let database = self.database.trim();
        format!(
            "mysql://{username}:{password}@{host}:{port}/{database}?charset={charset}",
            port = self.port,
            charset = self.charset
        )
    }
}

/// 建立 MySQL 连接池。
pub async fn build_mysql_pool(config: &MySqlSourceConfig) -> Result<MySqlPool, AppError> {
    MySqlPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(Duration::from_secs(8))
        .connect(&config.to_connection_url())
        .await
        .map_err(|error| AppError::Db(format!("连接 MySQL 失败: {error}")))
}

use thiserror::Error;

/// 统一错误定义，便于 Tauri command 返回一致错误消息。
#[derive(Debug, Error)]
pub enum AppError {
    #[error("数据库错误: {0}")]
    Db(String),
    #[error("网络请求错误: {0}")]
    Http(String),
    #[error("序列化错误: {0}")]
    Serde(String),
    #[error("业务错误: {0}")]
    Biz(String),
}

impl From<rusqlite::Error> for AppError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Db(value.to_string())
    }
}

impl From<reqwest::Error> for AppError {
    fn from(value: reqwest::Error) -> Self {
        Self::Http(value.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(value: serde_json::Error) -> Self {
        Self::Serde(value.to_string())
    }
}

impl AppError {
    pub fn to_string_error(self) -> String {
        self.to_string()
    }
}

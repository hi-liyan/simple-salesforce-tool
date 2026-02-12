use thiserror::Error;

/// 统一错误定义，便于 Tauri command 返回一致错误消息。
#[derive(Debug, Error)]
pub enum AppError {
    /// 数据库相关错误（SQLite 读写、SQL 执行失败等）。
    #[error("数据库错误: {0}")]
    Db(String),
    /// HTTP 请求相关错误（网络问题、超时、协议异常等）。
    #[error("网络请求错误: {0}")]
    Http(String),
    /// JSON 序列化/反序列化错误。
    #[error("序列化错误: {0}")]
    Serde(String),
    /// 业务规则错误（参数不合法、上游返回业务失败等）。
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
    /// 将统一错误类型转成 Tauri command 需要的字符串错误。
    pub fn to_string_error(self) -> String {
        self.to_string()
    }
}

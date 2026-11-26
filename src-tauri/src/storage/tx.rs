use std::thread;
use std::time::Duration;

use crate::error::AppError;

/// SQLite 忙碌/锁冲突最大重试次数。
const MAX_BUSY_RETRY_ATTEMPTS: usize = 5;

/// 判断错误是否属于可重试的 SQLite 锁竞争错误。
fn is_sqlite_busy_or_locked(error: &AppError) -> bool {
    match error {
        AppError::Db(message) => {
            let lower = message.to_ascii_lowercase();
            lower.contains("database is locked")
                || lower.contains("database table is locked")
                || lower.contains("sqlite_busy")
                || lower.contains("sqlite_locked")
        }
        _ => false,
    }
}

/// 在发生 `SQLITE_BUSY` / `SQLITE_LOCKED` 时执行指数退避重试。
pub fn with_sqlite_retry<T, F>(mut operation: F) -> Result<T, AppError>
where
    F: FnMut() -> Result<T, AppError>,
{
    let mut attempt = 0usize;
    loop {
        match operation() {
            Ok(value) => return Ok(value),
            Err(error) if is_sqlite_busy_or_locked(&error) && attempt < MAX_BUSY_RETRY_ATTEMPTS => {
                // 行内注释：采用 10ms 起步的指数退避，避免并发写瞬时碰撞导致失败。
                let backoff_ms = 10u64 << attempt.min(4);
                attempt += 1;
                thread::sleep(Duration::from_millis(backoff_ms));
            }
            Err(error) => return Err(error),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::with_sqlite_retry;
    use crate::error::AppError;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn retries_on_sqlite_busy_and_eventually_succeeds() {
        let attempts = AtomicUsize::new(0);
        let result = with_sqlite_retry(|| {
            let count = attempts.fetch_add(1, Ordering::SeqCst);
            if count < 2 {
                return Err(AppError::Db("database is locked".to_string()));
            }
            Ok(42)
        })
        .unwrap();

        assert_eq!(result, 42);
        assert_eq!(attempts.load(Ordering::SeqCst), 3);
    }
}

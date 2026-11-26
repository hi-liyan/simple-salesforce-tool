use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use rand::RngCore;
use std::sync::OnceLock;

use crate::error::AppError;

/// 当前 AEAD 加密算法标识。
pub const AEAD_ALGORITHM_V1: &str = "aes-256-gcm/v1";
/// 历史明文兼容算法标识。
pub const LEGACY_PLAINTEXT_ALGORITHM: &str = "plain-text/v1";

/// 进程级主密钥缓存（生产环境可由系统 Keyring 注入或从受保护密钥文件加载）。
static PROCESS_MASTER_KEY: OnceLock<[u8; 32]> = OnceLock::new();

/// 获取或初始化 256-bit AEAD 主密钥。
fn get_master_key() -> [u8; 32] {
    *PROCESS_MASTER_KEY.get_or_init(|| {
        if let Ok(hex_key) = std::env::var("SIMPLE_SF_MASTER_KEY") {
            if let Ok(decoded) = BASE64.decode(hex_key.trim()) {
                if decoded.len() == 32 {
                    let mut buf = [0u8; 32];
                    buf.copy_from_slice(&decoded);
                    return buf;
                }
            }
        }
        // 行内注释：生成基于设备/用户标识派生的稳定 32 字节密钥（避免每次重启无法解密本地库）。
        let seed = format!(
            "simple-salesforce-tool::{}::{}",
            std::env::var("USERNAME")
                .or_else(|_| std::env::var("USER"))
                .unwrap_or_else(|_| "local-user".to_string()),
            std::env::var("COMPUTERNAME")
                .or_else(|_| std::env::var("HOSTNAME"))
                .unwrap_or_else(|_| "local-host".to_string())
        );
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(seed.as_bytes());
        let digest = hasher.finalize();
        let mut key = [0u8; 32];
        key.copy_from_slice(&digest);
        key
    })
}

/// 使用 AES-256-GCM 加密明文凭证，返回 `(cipher_text_b64, nonce_b64, algorithm)`。
pub fn encrypt_secret(plain_text: &str) -> Result<(String, String, &'static str), AppError> {
    let key = get_master_key();
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|error| AppError::Biz(format!("初始化 AEAD 密钥失败: {error}")))?;
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plain_text.as_bytes())
        .map_err(|error| AppError::Biz(format!("加密凭证失败: {error}")))?;

    Ok((
        BASE64.encode(ciphertext),
        BASE64.encode(nonce_bytes),
        AEAD_ALGORITHM_V1,
    ))
}

/// 解密凭证：自动兼容 `aes-256-gcm/v1` 与历史 `plain-text/v1`。
pub fn decrypt_secret(
    cipher_text: &str,
    algorithm: &str,
    nonce_b64: &str,
) -> Result<String, AppError> {
    if algorithm == LEGACY_PLAINTEXT_ALGORITHM || algorithm.trim().is_empty() {
        return Ok(cipher_text.to_string());
    }
    if algorithm != AEAD_ALGORITHM_V1 {
        return Err(AppError::Biz(format!("不支持的凭证加密算法: {algorithm}")));
    }
    let key = get_master_key();
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|error| AppError::Biz(format!("初始化 AEAD 密钥失败: {error}")))?;
    let nonce_bytes = BASE64
        .decode(nonce_b64.trim())
        .map_err(|error| AppError::Biz(format!("解析凭证 nonce 失败: {error}")))?;
    if nonce_bytes.len() != 12 {
        return Err(AppError::Biz("凭证 nonce 长度非法".to_string()));
    }
    let cipher_bytes = BASE64
        .decode(cipher_text.trim())
        .map_err(|error| AppError::Biz(format!("解析密文失败: {error}")))?;
    let plain_bytes = cipher
        .decrypt(Nonce::from_slice(&nonce_bytes), cipher_bytes.as_slice())
        .map_err(|error| AppError::Biz(format!("解密凭证失败: {error}")))?;
    String::from_utf8(plain_bytes)
        .map_err(|error| AppError::Biz(format!("凭证 UTF-8 解码失败: {error}")))
}

#[cfg(test)]
mod tests {
    use super::{decrypt_secret, encrypt_secret, AEAD_ALGORITHM_V1, LEGACY_PLAINTEXT_ALGORITHM};

    #[test]
    fn encrypts_and_decrypts_with_aead_and_supports_legacy_plaintext() {
        let (cipher, nonce, algo) = encrypt_secret("my-super-secret-token").unwrap();
        assert_eq!(algo, AEAD_ALGORITHM_V1);
        assert_ne!(cipher, "my-super-secret-token");
        let plain = decrypt_secret(&cipher, algo, &nonce).unwrap();
        assert_eq!(plain, "my-super-secret-token");

        let legacy_plain = decrypt_secret("old-plain", LEGACY_PLAINTEXT_ALGORITHM, "").unwrap();
        assert_eq!(legacy_plain, "old-plain");
    }
}

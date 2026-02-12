use serde::Deserialize;
use serde_json::Value;
use std::collections::HashSet;
use std::env;
use std::path::Path;
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::error::AppError;
use crate::models::SourceUpsertPayload;

#[derive(Debug, Deserialize)]
struct SfAuthListResponse {
    /// CLI 退出状态码，0 为成功。
    status: i32,
    /// 已认证组织列表。
    result: Vec<SfAuthOrg>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SfAuthOrg {
    /// 组织 Id（18 位）。
    org_id: String,
    /// 用户名。
    username: String,
    /// 实例地址。
    instance_url: String,
    /// 访问令牌。
    access_token: String,
    /// 组织别名（可为空）。
    alias: Option<String>,
}

/// CLI 同步时用于写库的种子数据。
#[derive(Debug, Clone)]
pub struct CliSourceSeed {
    /// 本地数据源 ID（约定为 cli-<orgId>）。
    pub id: String,
    /// 入库 payload。
    pub payload: SourceUpsertPayload,
}

/// CLI 登录返回结果。
#[derive(Debug)]
pub struct CliLoginResult {
    /// 登录组织 orgId。
    pub org_id: String,
}

/// 从 Salesforce CLI 读取所有已认证组织，并转换为应用数据源。
pub fn load_cli_sources() -> Result<Vec<CliSourceSeed>, AppError> {
    let stdout = run_sf_auth_list_json()?;
    let text = String::from_utf8(stdout)
        .map_err(|error| AppError::Serde(format!("解析 CLI 输出文本失败: {error}")))?;
    let parsed: SfAuthListResponse = serde_json::from_str(&text)?;

    if parsed.status != 0 {
        return Err(AppError::Biz(format!("Salesforce CLI 状态异常: {}", parsed.status)));
    }

    let mut seeds = Vec::new();
    for org in parsed.result {
        // 缺失关键鉴权信息的组织直接跳过，避免写入不可用数据源。
        if org.access_token.trim().is_empty() || org.instance_url.trim().is_empty() {
            continue;
        }

        let display_name = org
            .alias
            .as_ref()
            .and_then(|value| value.split(',').next())
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .map(|value| format!("{} ({})", value, org.username))
            .unwrap_or_else(|| org.username.clone());

        seeds.push(CliSourceSeed {
            id: format!("cli-{}", org.org_id),
            payload: SourceUpsertPayload {
                name: display_name,
                instance_url: org.instance_url,
                access_token: org.access_token,
                // CLI 输出不稳定包含 API 版本，因此使用稳定默认值。
                api_version: "v61.0".to_string(),
            },
        });
    }

    Ok(seeds)
}

/// 按 source_id（cli-<orgId>）读取最新 CLI 数据源信息。
pub fn load_cli_source_by_id(source_id: &str) -> Result<CliSourceSeed, AppError> {
    load_cli_sources()?
        .into_iter()
        .find(|item| item.id == source_id)
        .ok_or_else(|| AppError::Biz(format!("CLI 中未找到数据源: {source_id}")))
}

/// 触发 Salesforce CLI OAuth 登录，并返回 org_id。
pub fn login_web(instance_url: &str, cancel_token: Arc<AtomicBool>) -> Result<CliLoginResult, AppError> {
    let stdout = run_sf_login_web_json(instance_url, &cancel_token)?;
    let text = String::from_utf8(stdout)
        .map_err(|error| AppError::Serde(format!("解析 CLI 输出文本失败: {error}")))?;
    let value: Value = serde_json::from_str(&text)?;

    if let Some(status) = value.get("status").and_then(|item| item.as_i64()) {
        if status != 0 {
            let message = value
                .get("message")
                .and_then(|item| item.as_str())
                .unwrap_or("Salesforce CLI 登录失败");
            return Err(AppError::Biz(format!("{message} (status={status})")));
        }
    }

    let org_id = extract_org_id(&value).ok_or_else(|| {
        AppError::Biz("Salesforce CLI 登录成功，但未能解析 orgId。".to_string())
    })?;

    Ok(CliLoginResult { org_id })
}

/// 执行 `sf org list auth --json`：优先使用 SF_CLI_PATH，其次尝试多个可执行文件名称。
fn run_sf_auth_list_json() -> Result<Vec<u8>, AppError> {
    let candidates = build_cli_candidates();
    let mut errors = Vec::new();

    for cli in &candidates {
        match Command::new(cli)
            .args(["org", "list", "auth", "--json"])
            .output()
        {
            Ok(output) if output.status.success() => return Ok(output.stdout),
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                let status = output
                    .status
                    .code()
                    .map(|code| code.to_string())
                    .unwrap_or_else(|| "unknown".to_string());
                errors.push(format!("{cli}: exit={status}, stderr={stderr}"));
            }
            Err(error) => errors.push(format!("{cli}: {error}")),
        }
    }

    Err(AppError::Biz(format!(
        "调用 Salesforce CLI 失败。已尝试: {}。可设置环境变量 SF_CLI_PATH 指向 sf/sfdx 可执行文件。详情: {}",
        candidates.join(", "),
        errors.join(" | ")
    )))
}

/// 执行 `sf org login web --instance-url <url> --json` / `sfdx force:auth:web:login -r <url> --json`。
fn run_sf_login_web_json(instance_url: &str, cancel_token: &Arc<AtomicBool>) -> Result<Vec<u8>, AppError> {
    let candidates = build_cli_candidates();
    let mut errors = Vec::new();
    let timeout = cli_login_timeout();

    for cli in &candidates {
        let args = login_args_for(cli, instance_url);
        match run_command_with_cancel_and_timeout(cli, &args, cancel_token, timeout) {
            Ok(output) if output.status.success() => return Ok(output.stdout),
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                let status = output
                    .status
                    .code()
                    .map(|code| code.to_string())
                    .unwrap_or_else(|| "unknown".to_string());
                errors.push(format!("{cli}: exit={status}, stderr={stderr}"));
            }
            Err(error) => {
                let message = error.to_string();
                if message.contains("登录已取消") || message.contains("登录超时") {
                    return Err(error);
                }
                errors.push(format!("{cli}: {message}"));
            }
        }
    }

    Err(AppError::Biz(format!(
        "调用 Salesforce CLI 登录失败。已尝试: {}。可设置环境变量 SF_CLI_PATH 指向 sf/sfdx 可执行文件。详情: {}",
        candidates.join(", "),
        errors.join(" | ")
    )))
}

fn login_args_for(cli: &str, instance_url: &str) -> Vec<String> {
    let filename = Path::new(cli)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(cli);
    let is_sfdx = filename.eq_ignore_ascii_case("sfdx")
        || filename.eq_ignore_ascii_case("sfdx.cmd")
        || filename.eq_ignore_ascii_case("sfdx.exe");

    if is_sfdx {
        // sfdx 旧命令格式。
        vec![
            "force:auth:web:login".to_string(),
            "-r".to_string(),
            instance_url.to_string(),
            "--json".to_string(),
        ]
    } else {
        // sf 新命令格式。
        vec![
            "org".to_string(),
            "login".to_string(),
            "web".to_string(),
            "--instance-url".to_string(),
            instance_url.to_string(),
            "--json".to_string(),
        ]
    }
}

/// 从 CLI 登录响应里提取 orgId，兼容不同字段命名。
fn extract_org_id(value: &Value) -> Option<String> {
    let result = value.get("result")?;
    if let Some(org_id) = result.get("orgId").and_then(|item| item.as_str()) {
        return Some(org_id.to_string());
    }
    if let Some(org_id) = result.get("org_id").and_then(|item| item.as_str()) {
        return Some(org_id.to_string());
    }
    if let Some(org_id) = result.get("id").and_then(|item| item.as_str()) {
        return Some(org_id.to_string());
    }
    None
}

/// 生成 CLI 候选路径：
/// 1) SF_CLI_PATH（绝对路径）
/// 2) 命令名回退 sf/sf.cmd/sfdx/sfdx.cmd
/// 3) Windows 常见 npm 全局目录与安装目录回退
fn build_cli_candidates() -> Vec<String> {
    let mut raw = Vec::new();

    if let Ok(path) = env::var("SF_CLI_PATH") {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            raw.push(trimmed.to_string());
        }
    }

    raw.extend([
        "sf".to_string(),
        "sf.cmd".to_string(),
        "sfdx".to_string(),
        "sfdx.cmd".to_string(),
    ]);

    if cfg!(target_os = "windows") {
        if let Ok(appdata) = env::var("APPDATA") {
            raw.push(format!(r"{appdata}\npm\sf.cmd"));
            raw.push(format!(r"{appdata}\npm\sfdx.cmd"));
        }
        if let Ok(program_files) = env::var("ProgramFiles") {
            raw.push(format!(r"{program_files}\sf\bin\sf.cmd"));
        }
        if let Ok(program_files_x86) = env::var("ProgramFiles(x86)") {
            raw.push(format!(r"{program_files_x86}\sf\bin\sf.cmd"));
        }
    }

    // 去重并过滤明显无效路径，保持插入顺序。
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for candidate in raw {
        let normalized = candidate.trim().to_string();
        if normalized.is_empty() {
            continue;
        }

        // 仅对包含路径分隔符的候选做文件存在性检查。
        if (normalized.contains('\\') || normalized.contains('/')) && !Path::new(&normalized).exists() {
            continue;
        }

        if seen.insert(normalized.clone()) {
            result.push(normalized);
        }
    }

    result
}

fn cli_login_timeout() -> Duration {
    let seconds = env::var("SF_CLI_LOGIN_TIMEOUT_SECONDS")
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(300);
    Duration::from_secs(seconds)
}

fn run_command_with_cancel_and_timeout(
    cli: &str,
    args: &[String],
    cancel_token: &Arc<AtomicBool>,
    timeout: Duration,
) -> Result<Output, AppError> {
    let mut child = Command::new(cli)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| AppError::Biz(error.to_string()))?;

    let started_at = Instant::now();
    loop {
        if cancel_token.load(Ordering::Relaxed) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(AppError::Biz("登录已取消。".to_string()));
        }

        if started_at.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err(AppError::Biz(format!("登录超时（{} 秒）。", timeout.as_secs())));
        }

        match child.try_wait() {
            Ok(Some(_)) => {
                return child
                    .wait_with_output()
                    .map_err(|error| AppError::Biz(format!("读取 CLI 输出失败: {error}")));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(180)),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(AppError::Biz(format!("等待 CLI 进程失败: {error}")));
            }
        }
    }
}

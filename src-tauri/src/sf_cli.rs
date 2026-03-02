use serde::Deserialize;
use serde_json::Value;
use std::cmp::Ordering as CmpOrdering;
use std::collections::HashSet;
use std::env;
use std::path::Path;
use std::process::{Child, Command, Output, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::error::AppError;
use crate::models::{CliPathProbe, CliPathSettings, CliPathStatus, SourceUpsertPayload};

/// Salesforce CLI 默认 OAuth 本地回调端口。
const SF_OAUTH_LOCAL_PORT: u16 = 1717;

/// 创建子进程命令：Windows 下统一隐藏控制台窗口，避免安装版弹出终端。
fn build_hidden_command(program: &str) -> Command {
    let mut command = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        // 强制子进程在无控制台窗口模式下运行。
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

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
pub fn load_cli_sources(preferred_cli_path: Option<&str>) -> Result<Vec<CliSourceSeed>, AppError> {
    let stdout = run_sf_auth_list_json(preferred_cli_path)?;
    let text = String::from_utf8(stdout)
        .map_err(|error| AppError::Serde(format!("解析 CLI 输出文本失败: {error}")))?;
    let parsed: SfAuthListResponse = serde_json::from_str(&text)?;

    if parsed.status != 0 {
        return Err(AppError::Biz(format!(
            "Salesforce CLI 状态异常: {}",
            parsed.status
        )));
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

/// 通过 CLI 主动刷新指定 source_id（cli-<orgId>）对应组织的 accessToken。
/// 说明：相比 `org list auth`，`org display --verbose` 更容易触发 token 刷新。
pub fn refresh_cli_source_by_id(
    source_id: &str,
    preferred_cli_path: Option<&str>,
) -> Result<CliSourceSeed, AppError> {
    let org_id = source_id
        .strip_prefix("cli-")
        .ok_or_else(|| AppError::Biz(format!("仅支持 CLI 数据源刷新: {source_id}")))?;

    // 优先使用 alias/username 作为 target-org，最后回退 orgId，兼容不同 CLI 的识别差异。
    let target_org_candidates = resolve_org_display_targets(org_id, preferred_cli_path);
    let stdout = run_sf_org_display_json(&target_org_candidates, preferred_cli_path)?;
    let text = String::from_utf8(stdout)
        .map_err(|error| AppError::Serde(format!("解析 CLI 输出文本失败: {error}")))?;
    let value: Value = serde_json::from_str(&text)?;

    let status = value
        .get("status")
        .and_then(|item| item.as_i64())
        .unwrap_or(1);
    if status != 0 {
        let message = value
            .get("message")
            .and_then(|item| item.as_str())
            .unwrap_or("Salesforce CLI 刷新 token 失败");
        return Err(AppError::Biz(format!("{message} (status={status})")));
    }

    let result = value
        .get("result")
        .ok_or_else(|| AppError::Biz("CLI 刷新 token 返回缺少 result 字段。".to_string()))?;

    let next_org_id = result
        .get("orgId")
        .and_then(|item| item.as_str())
        .or_else(|| result.get("id").and_then(|item| item.as_str()))
        .unwrap_or(org_id)
        .to_string();

    let username = result
        .get("username")
        .and_then(|item| item.as_str())
        .unwrap_or("")
        .to_string();
    let alias = result
        .get("alias")
        .and_then(|item| item.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let instance_url = result
        .get("instanceUrl")
        .and_then(|item| item.as_str())
        .or_else(|| result.get("instance_url").and_then(|item| item.as_str()))
        .unwrap_or("")
        .to_string();
    let access_token = result
        .get("accessToken")
        .and_then(|item| item.as_str())
        .or_else(|| result.get("access_token").and_then(|item| item.as_str()))
        .unwrap_or("")
        .to_string();
    let api_version = result
        .get("apiVersion")
        .and_then(|item| item.as_str())
        .map(|item| {
            if item.starts_with('v') {
                item.to_string()
            } else {
                format!("v{item}")
            }
        })
        .unwrap_or_else(|| "v61.0".to_string());

    if instance_url.trim().is_empty() || access_token.trim().is_empty() {
        return Err(AppError::Biz(
            "CLI 刷新 token 结果缺少 instanceUrl/accessToken。".to_string(),
        ));
    }

    let display_name = if alias.is_empty() {
        username.clone()
    } else if username.is_empty() {
        alias
    } else {
        format!("{alias} ({username})")
    };

    Ok(CliSourceSeed {
        id: format!("cli-{next_org_id}"),
        payload: SourceUpsertPayload {
            name: display_name,
            instance_url,
            access_token,
            api_version,
        },
    })
}

/// 通过 Salesforce CLI 直接打开指定组织的页面路径（系统默认浏览器）。
/// 说明：仅支持 `cli-<orgId>` 数据源。
pub fn open_org_path(
    source_id: &str,
    path: &str,
    preferred_cli_path: Option<&str>,
) -> Result<(), AppError> {
    let org_id = source_id
        .strip_prefix("cli-")
        .ok_or_else(|| AppError::Biz(format!("仅支持 CLI 数据源打开页面: {source_id}")))?;
    let normalized_path = if path.trim().is_empty() {
        "/".to_string()
    } else if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    };

    // Windows 下先尝试清理残留 CLI 进程，避免偶发命令卡死。
    cleanup_stale_cli_processes();

    let target_org_candidates = resolve_org_display_targets(org_id, preferred_cli_path);
    let candidates = build_cli_candidates(preferred_cli_path);
    let mut errors = Vec::new();

    for cli in &candidates {
        for target_org in &target_org_candidates {
            let args = org_open_args_for(cli, target_org, &normalized_path);
            match build_hidden_command(cli).args(&args).output() {
                Ok(output) if output.status.success() => return Ok(()),
                Ok(output) => {
                    errors.push(format!(
                        "{cli} (target={target_org}): {}",
                        format_cli_failure(&output)
                    ));
                }
                Err(error) => errors.push(format!("{cli} (target={target_org}): {error}")),
            }
        }
    }

    Err(AppError::Biz(format!(
        "调用 Salesforce CLI 打开页面失败。已尝试: {}。详情: {}",
        candidates.join(", "),
        errors.join(" | ")
    )))
}

/// 触发 Salesforce CLI OAuth 登录，并返回 org_id。
pub fn login_web(
    instance_url: &str,
    cancel_token: Arc<AtomicBool>,
    preferred_cli_path: Option<&str>,
) -> Result<CliLoginResult, AppError> {
    let stdout = run_sf_login_web_json(instance_url, &cancel_token, preferred_cli_path)?;
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

    let org_id = extract_org_id(&value)
        .ok_or_else(|| AppError::Biz("Salesforce CLI 登录成功，但未能解析 orgId。".to_string()))?;

    Ok(CliLoginResult { org_id })
}

/// 执行 `sf org list auth --json`：优先使用 SF_CLI_PATH，其次尝试多个可执行文件名称。
fn run_sf_auth_list_json(preferred_cli_path: Option<&str>) -> Result<Vec<u8>, AppError> {
    let candidates = build_cli_candidates(preferred_cli_path);
    let mut errors = Vec::new();

    for cli in &candidates {
        match build_hidden_command(cli)
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
fn run_sf_login_web_json(
    instance_url: &str,
    cancel_token: &Arc<AtomicBool>,
    preferred_cli_path: Option<&str>,
) -> Result<Vec<u8>, AppError> {
    // 跨平台尝试清理 OAuth 回调端口占用，减少中断登录后端口残留导致的重试失败。
    cleanup_oauth_redirect_port();
    // Windows 下先清理一次残留 CLI 进程，避免上次中断登录后进程树残留影响本次登录。
    cleanup_stale_cli_processes();

    let candidates = build_cli_candidates(preferred_cli_path);
    let mut errors = Vec::new();
    let timeout = cli_login_timeout();

    for cli in &candidates {
        let args = login_args_for(cli, instance_url);
        match run_command_with_cancel_and_timeout(cli, &args, cancel_token, timeout) {
            Ok(output) if output.status.success() => return Ok(output.stdout),
            Ok(output) => {
                // 同时记录 stdout/stderr，便于定位 sf 将错误写入 stdout 的场景。
                errors.push(format!("{cli}: {}", format_cli_failure(&output)));
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

    let detail = errors.join(" | ");
    if is_oauth_port_in_use_error(&detail) {
        return Err(AppError::Biz(
            "1717 被占用，请关闭占用进程后重试".to_string(),
        ));
    }

    Err(AppError::Biz(format!(
        "调用 Salesforce CLI 登录失败。已尝试: {}。可设置环境变量 SF_CLI_PATH 指向 sf/sfdx 可执行文件。详情: {}",
        candidates.join(", "),
        detail
    )))
}

/// 执行 `sf org display --target-org <orgId> --verbose --json`
/// 或 `sfdx force:org:display -u <orgId> --verbose --json`。
fn run_sf_org_display_json(
    target_org_candidates: &[String],
    preferred_cli_path: Option<&str>,
) -> Result<Vec<u8>, AppError> {
    // Windows 下先尝试清理残留 CLI 进程，避免僵尸进程或句柄占用导致刷新失败。
    cleanup_stale_cli_processes();

    let candidates = build_cli_candidates(preferred_cli_path);
    let mut errors = Vec::new();

    for cli in &candidates {
        for target_org in target_org_candidates {
            let args = org_display_args_for(cli, target_org);
            match build_hidden_command(cli).args(&args).output() {
                Ok(output) if output.status.success() => return Ok(output.stdout),
                Ok(output) => {
                    // 同时记录 stdout/stderr；sf 很多错误信息写在 stdout JSON 的 message 字段。
                    errors.push(format!(
                        "{cli} (target={target_org}): {}",
                        format_cli_failure(&output)
                    ));
                }
                Err(error) => errors.push(format!("{cli} (target={target_org}): {error}")),
            }
        }
    }

    Err(AppError::Biz(format!(
        "调用 Salesforce CLI 刷新 token 失败。已尝试: {}。详情: {}",
        candidates.join(", "),
        errors.join(" | ")
    )))
}

/// 根据 orgId 解析可用于 `--target-org` 的候选值。
/// 顺序：alias -> username -> orgId。
fn resolve_org_display_targets(org_id: &str, preferred_cli_path: Option<&str>) -> Vec<String> {
    let mut targets = Vec::new();

    // 辅助函数：保持插入顺序去重。
    let mut push_unique = |value: &str| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return;
        }
        if !targets.iter().any(|item| item == trimmed) {
            targets.push(trimmed.to_string());
        }
    };

    if let Ok(stdout) = run_sf_auth_list_json(preferred_cli_path) {
        if let Ok(text) = String::from_utf8(stdout) {
            if let Ok(parsed) = serde_json::from_str::<SfAuthListResponse>(&text) {
                if parsed.status == 0 {
                    if let Some(matched_org) =
                        parsed.result.into_iter().find(|item| item.org_id == org_id)
                    {
                        if let Some(alias_raw) = matched_org.alias {
                            // alias 可能是 "a,b"；优先使用第一项。
                            let alias = alias_raw
                                .split(',')
                                .map(|item| item.trim())
                                .find(|item| !item.is_empty())
                                .unwrap_or("");
                            push_unique(alias);
                        }
                        push_unique(&matched_org.username);
                    }
                }
            }
        }
    }

    // 回退：始终保留 orgId，避免候选为空。
    push_unique(org_id);
    targets
}

/// 清理可能残留的 Salesforce CLI 进程。
/// 说明：
/// 1) 仅在 Windows 执行；
/// 2) 失败不影响主流程（best-effort）；
/// 3) 仅针对 sf/sfdx 可执行文件，避免误伤其它进程。
fn cleanup_stale_cli_processes() {
    if !cfg!(target_os = "windows") {
        return;
    }

    for image in ["sf.exe", "sfdx.exe"] {
        let _ = build_hidden_command("taskkill")
            .args(["/F", "/T", "/IM", image])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

/// 清理 OAuth 本地回调端口占用（best-effort，不影响主流程）。
fn cleanup_oauth_redirect_port() {
    if cfg!(target_os = "windows") {
        cleanup_oauth_redirect_port_windows();
    } else {
        cleanup_oauth_redirect_port_unix();
    }
}

/// Windows：通过 netstat 找到占用 1717 端口的 PID 后执行 taskkill。
fn cleanup_oauth_redirect_port_windows() {
    let output = match build_hidden_command("netstat")
        .args(["-ano", "-p", "tcp"])
        .output()
    {
        Ok(item) => item,
        Err(_) => return,
    };
    let text = String::from_utf8_lossy(&output.stdout);
    let target_suffix = format!(":{SF_OAUTH_LOCAL_PORT}");
    let mut pids = Vec::new();

    for line in text.lines() {
        let columns = line.split_whitespace().collect::<Vec<_>>();
        if columns.len() < 5 {
            continue;
        }
        let local_addr = columns[1];
        let pid = columns[columns.len() - 1];
        if !local_addr.ends_with(&target_suffix) {
            continue;
        }
        if pid.chars().all(|item| item.is_ascii_digit())
            && !pids.iter().any(|item| item == pid)
        {
            pids.push(pid.to_string());
        }
    }

    for pid in pids {
        let _ = build_hidden_command("taskkill")
            .args(["/F", "/T", "/PID", pid.as_str()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

/// Unix：通过 lsof 找到占用 1717 监听端口的 PID 后执行 kill -9。
fn cleanup_oauth_redirect_port_unix() {
    let port = SF_OAUTH_LOCAL_PORT.to_string();
    let output = match build_hidden_command("lsof")
        .args(["-t", "-iTCP", port.as_str(), "-sTCP:LISTEN"])
        .output()
    {
        Ok(item) => item,
        Err(_) => return,
    };
    let text = String::from_utf8_lossy(&output.stdout);
    for pid in text.lines().map(str::trim).filter(|item| !item.is_empty()) {
        if !pid.chars().all(|item| item.is_ascii_digit()) {
            continue;
        }
        let _ = build_hidden_command("kill")
            .args(["-9", pid])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

/// 判断是否为 OAuth 回调端口被占用导致的登录失败。
fn is_oauth_port_in_use_error(detail: &str) -> bool {
    let text = detail.to_ascii_lowercase();
    text.contains("cannot start the oauth redirect server on port 1717")
        || text.contains("portinuseerror")
        || (text.contains("port 1717") && text.contains("oauth"))
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

fn org_display_args_for(cli: &str, org_identifier: &str) -> Vec<String> {
    let filename = Path::new(cli)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(cli);
    let is_sfdx = filename.eq_ignore_ascii_case("sfdx")
        || filename.eq_ignore_ascii_case("sfdx.cmd")
        || filename.eq_ignore_ascii_case("sfdx.exe");

    if is_sfdx {
        vec![
            "force:org:display".to_string(),
            "-u".to_string(),
            org_identifier.to_string(),
            "--verbose".to_string(),
            "--json".to_string(),
        ]
    } else {
        vec![
            "org".to_string(),
            "display".to_string(),
            "--target-org".to_string(),
            org_identifier.to_string(),
            "--verbose".to_string(),
            "--json".to_string(),
        ]
    }
}

fn org_open_args_for(cli: &str, org_identifier: &str, path: &str) -> Vec<String> {
    let filename = Path::new(cli)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(cli);
    let is_sfdx = filename.eq_ignore_ascii_case("sfdx")
        || filename.eq_ignore_ascii_case("sfdx.cmd")
        || filename.eq_ignore_ascii_case("sfdx.exe");

    if is_sfdx {
        vec![
            "force:org:open".to_string(),
            "-u".to_string(),
            org_identifier.to_string(),
            "-p".to_string(),
            path.to_string(),
        ]
    } else {
        vec![
            "org".to_string(),
            "open".to_string(),
            "--target-org".to_string(),
            org_identifier.to_string(),
            "--path".to_string(),
            path.to_string(),
        ]
    }
}

/// 统一格式化 CLI 失败输出，优先提取 stdout JSON 的 message 字段。
fn format_cli_failure(output: &Output) -> String {
    let status = output
        .status
        .code()
        .map(|code| code.to_string())
        .unwrap_or_else(|| "unknown".to_string());
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let message = extract_cli_message(&stdout).unwrap_or_default();
    let short_stdout = truncate_for_log(&stdout, 280);

    if !message.is_empty() {
        format!("exit={status}, message={message}, stderr={stderr}, stdout={short_stdout}")
    } else {
        format!("exit={status}, stderr={stderr}, stdout={short_stdout}")
    }
}

/// 从 CLI 的 JSON stdout 提取可读错误信息（如 message 字段）。
fn extract_cli_message(stdout: &str) -> Option<String> {
    if stdout.trim().is_empty() {
        return None;
    }

    let value: Value = serde_json::from_str(stdout).ok()?;
    let message = value.get("message").and_then(|item| item.as_str())?;
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_string())
}

/// 截断日志文本，避免错误明细过长影响可读性。
fn truncate_for_log(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let mut shortened = text.chars().take(max_chars).collect::<String>();
    shortened.push_str("...");
    shortened
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

/// 探测 CLI 路径与版本，返回最终可用路径和候选详情。
pub fn detect_cli_path_settings(custom_cli_path: Option<String>) -> CliPathSettings {
    let custom = custom_cli_path
        .as_ref()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty());
    let candidates = build_cli_candidates(custom.as_deref());

    let mut probes = Vec::new();
    let mut resolved_cli_path: Option<String> = None;
    let mut resolved_cli_version: Option<String> = None;

    for cli in candidates {
        match probe_cli_version(&cli) {
            Ok(version) => {
                probes.push(CliPathProbe {
                    path: cli.clone(),
                    ok: true,
                    version: Some(version.clone()),
                    detail: "可用".to_string(),
                });
                if resolved_cli_path.is_none() {
                    resolved_cli_path = Some(cli);
                    resolved_cli_version = Some(version);
                }
            }
            Err(detail) => {
                probes.push(CliPathProbe {
                    path: cli,
                    ok: false,
                    version: None,
                    detail,
                });
            }
        }
    }

    CliPathSettings {
        custom_cli_path: custom,
        resolved_cli_path,
        resolved_cli_version,
        probes,
    }
}

/// 探测指定 CLI 的版本信息。
fn probe_cli_version(cli: &str) -> Result<String, String> {
    match build_hidden_command(cli).arg("--version").output() {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let text = if !stdout.is_empty() { stdout } else { stderr };
            if text.is_empty() {
                Ok("unknown".to_string())
            } else {
                Ok(text.lines().next().unwrap_or("unknown").to_string())
            }
        }
        Ok(output) => {
            let code = output
                .status
                .code()
                .map(|item| item.to_string())
                .unwrap_or_else(|| "unknown".to_string());
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            Err(format!("exit={code}, stderr={stderr}, stdout={stdout}"))
        }
        Err(error) => Err(format!("program not found: {error}")),
    }
}

/// 生成 CLI 候选路径：
/// 1) SF_CLI_PATH（绝对路径）
/// 2) 命令名回退 sf/sf.cmd/sfdx/sfdx.cmd
/// 3) Windows 常见 npm 全局目录与安装目录回退
fn build_cli_candidates(preferred_cli_path: Option<&str>) -> Vec<String> {
    let mut raw = Vec::new();

    if let Some(path) = preferred_cli_path {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            raw.push(trimmed.to_string());
        }
    }

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
        if (normalized.contains('\\') || normalized.contains('/'))
            && !Path::new(&normalized).exists()
        {
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

/// 终止 CLI 子进程：Windows 下优先结束整个进程树，避免 cmd/node 派生进程残留。
fn terminate_cli_child(child: &mut Child) {
    #[cfg(target_os = "windows")]
    {
        let pid = child.id().to_string();
        let _ = build_hidden_command("taskkill")
            .args(["/F", "/T", "/PID", pid.as_str()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }

    let _ = child.kill();
    let _ = child.wait();
}

fn run_command_with_cancel_and_timeout(
    cli: &str,
    args: &[String],
    cancel_token: &Arc<AtomicBool>,
    timeout: Duration,
) -> Result<Output, AppError> {
    let mut child = build_hidden_command(cli)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| AppError::Biz(error.to_string()))?;

    let started_at = Instant::now();
    loop {
        if cancel_token.load(Ordering::Relaxed) {
            terminate_cli_child(&mut child);
            return Err(AppError::Biz("登录已取消。".to_string()));
        }

        if started_at.elapsed() >= timeout {
            terminate_cli_child(&mut child);
            return Err(AppError::Biz(format!(
                "登录超时（{} 秒）。",
                timeout.as_secs()
            )));
        }

        match child.try_wait() {
            Ok(Some(_)) => {
                return child
                    .wait_with_output()
                    .map_err(|error| AppError::Biz(format!("读取 CLI 输出失败: {error}")));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(180)),
            Err(error) => {
                terminate_cli_child(&mut child);
                return Err(AppError::Biz(format!("等待 CLI 进程失败: {error}")));
            }
        }
    }
}

/// 读取 CLI 路径设置（不做自动探测，仅返回当前配置与默认生效路径）。
pub fn read_cli_path_settings(custom_cli_path: Option<String>) -> CliPathSettings {
    let custom = custom_cli_path
        .as_ref()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty());
    let resolved_cli_path = resolve_effective_cli_path(custom.clone());
    CliPathSettings {
        custom_cli_path: custom,
        resolved_cli_path,
        resolved_cli_version: None,
        probes: Vec::new(),
    }
}

/// 解析当前生效的 CLI 路径（不校验有效性）。
pub fn resolve_effective_cli_path(custom_cli_path: Option<String>) -> Option<String> {
    build_cli_candidates(custom_cli_path.as_deref())
        .into_iter()
        .next()
}

/// 自动探测本地可用 CLI 路径：仅返回探测成功的候选项。
pub fn detect_available_cli_paths(custom_cli_path: Option<String>) -> Vec<CliPathProbe> {
    detect_cli_path_settings(custom_cli_path)
        .probes
        .into_iter()
        .filter(|probe| probe.ok)
        .collect()
}

/// 检测指定路径是否可用，并尝试判断是否存在可用更新。
pub fn check_cli_path_status(input_cli_path: Option<String>) -> CliPathStatus {
    let path = input_cli_path
        .as_ref()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty());
    let Some(cli_path) = path else {
        return CliPathStatus {
            path: None,
            ok: false,
            version: None,
            has_update: None,
            latest_version: None,
            detail: "未配置可用 CLI 路径。".to_string(),
        };
    };

    match probe_cli_version(&cli_path) {
        Ok(version_text) => {
            let current_semver = extract_semver(&version_text);
            let latest_version = fetch_latest_cli_version().ok();
            let latest_semver = latest_version
                .as_ref()
                .and_then(|value| extract_semver(value));
            let has_update = match (current_semver.as_deref(), latest_semver.as_deref()) {
                (Some(current), Some(latest)) => {
                    Some(compare_semver(current, latest) == CmpOrdering::Less)
                }
                _ => None,
            };
            CliPathStatus {
                path: Some(cli_path),
                ok: true,
                version: Some(version_text),
                has_update,
                latest_version,
                detail: "可用".to_string(),
            }
        }
        Err(detail) => CliPathStatus {
            path: Some(cli_path),
            ok: false,
            version: None,
            has_update: None,
            latest_version: None,
            detail,
        },
    }
}

/// 从 npm registry 拉取 Salesforce CLI 的最新版本号。
fn fetch_latest_cli_version() -> Result<String, String> {
    let response = reqwest::blocking::get("https://registry.npmjs.org/%40salesforce%2Fcli/latest")
        .map_err(|error| format!("请求最新版本失败: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("请求最新版本失败: status={}", response.status()));
    }
    let payload: Value = response
        .json()
        .map_err(|error| format!("解析最新版本响应失败: {error}"))?;
    let version = payload
        .get("version")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if version.is_empty() {
        return Err("最新版本响应缺少 version 字段。".to_string());
    }
    Ok(version)
}

/// 从任意版本文本中提取第一个 `x.y.z` 语义版本号。
fn extract_semver(text: &str) -> Option<String> {
    for token in text.split(|ch: char| !(ch.is_ascii_alphanumeric() || ch == '.' || ch == '-')) {
        let normalized = token.trim().trim_start_matches('v');
        if normalized.is_empty() {
            continue;
        }
        let mut parts = normalized.split('.');
        let major = parts.next().unwrap_or("");
        let minor = parts.next().unwrap_or("");
        let patch = parts.next().unwrap_or("");
        if major.chars().all(|ch| ch.is_ascii_digit())
            && minor.chars().all(|ch| ch.is_ascii_digit())
            && patch.chars().all(|ch| ch.is_ascii_digit())
        {
            return Some(format!("{major}.{minor}.{patch}"));
        }
    }
    None
}

/// 比较两个 `x.y.z` 版本号大小。
fn compare_semver(left: &str, right: &str) -> CmpOrdering {
    let parse_triplet = |value: &str| -> [u64; 3] {
        let mut numbers = [0_u64, 0_u64, 0_u64];
        for (index, part) in value.split('.').take(3).enumerate() {
            numbers[index] = part.parse::<u64>().unwrap_or(0);
        }
        numbers
    };
    parse_triplet(left).cmp(&parse_triplet(right))
}

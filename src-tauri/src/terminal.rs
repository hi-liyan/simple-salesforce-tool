use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::process::Command as StdCommand;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

/// 终端输出事件名：后端读取 PTY 输出后统一发给前端。
pub const TERMINAL_OUTPUT_EVENT: &str = "terminal://output";
/// 终端关闭事件名：进程退出或异常结束时通知前端。
pub const TERMINAL_CLOSED_EVENT: &str = "terminal://closed";

/// 终端会话输出事件负载。
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOutputEvent {
    /// 对应前端 Tab ID。
    pub tab_id: String,
    /// 输出文本分片。
    pub data: String,
}

/// 终端会话关闭事件负载。
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalClosedEvent {
    /// 对应前端 Tab ID。
    pub tab_id: String,
    /// 退出码（可能为空，例如强制终止）。
    pub exit_code: Option<i32>,
}

/// 前端创建终端后需要展示的元信息。
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionInfo {
    /// 终端进程 PID。
    pub pid: u32,
    /// 启动命令行文本（用于 Tab 悬浮提示）。
    pub command_line: String,
    /// 终端程序名称（如 powershell / bash）。
    pub shell_name: String,
    /// 终端程序版本（如 7.5.0）。
    pub shell_version: String,
}

/// 可选终端 Shell 条目：用于前端设置页展示和选择。
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalShellOption {
    /// 显示名称（含版本与路径）。
    pub label: String,
    /// 可执行程序路径（保存到设置后用于启动终端）。
    pub command: String,
    /// shell 名称（如 PowerShell / Windows PowerShell / bash）。
    pub shell_name: String,
    /// shell 版本文本。
    pub shell_version: String,
}

/// 单个终端会话句柄：保存写入流、窗口句柄和子进程控制器。
pub struct TerminalSession {
    /// PTY 主端：用于 resize。
    pub master: Box<dyn MasterPty + Send>,
    /// PTY 写入流：用于接收前端键盘输入。
    pub writer: Box<dyn Write + Send>,
    /// 子进程控制器：用于 kill/wait。
    pub child: Box<dyn portable_pty::Child + Send>,
}

/// 关闭并回收全部终端会话：用于应用退出时兜底清理子进程。
pub fn close_all_terminal_sessions(
    sessions: &Mutex<HashMap<String, TerminalSession>>,
) -> Result<(), String> {
    let mut session_map = sessions
        .lock()
        .map_err(|error| format!("终端会话锁获取失败: {error}"))?;
    let tab_ids = session_map.keys().cloned().collect::<Vec<_>>();
    for tab_id in tab_ids {
        if let Some(mut session) = session_map.remove(&tab_id) {
            let _ = session.child.kill(); // 主进程退出前强制终止子终端。
            let _ = session.child.wait(); // 等待回收，避免僵尸进程。
        }
    }
    Ok(())
}

/// 打开终端会话并启动输出监听线程。
pub fn open_terminal_session(
    app_handle: &AppHandle,
    sessions: &Mutex<HashMap<String, TerminalSession>>,
    tab_id: &str,
    cols: u16,
    rows: u16,
    preferred_shell_command: Option<&str>,
    initial_command: Option<&str>,
) -> Result<TerminalSessionInfo, String> {
    // 若同一 Tab 已存在会话，先关闭旧会话，避免泄露僵尸进程。
    close_terminal_session(sessions, tab_id)?;

    let pty_system = native_pty_system();
    let pty_size = PtySize {
        rows: rows.max(10),
        cols: cols.max(20),
        pixel_width: 0,
        pixel_height: 0,
    };
    let pty_pair = pty_system
        .openpty(pty_size)
        .map_err(|error| format!("创建 PTY 失败: {error}"))?;

    let (program, args, shell_name) = resolve_shell_command(preferred_shell_command);
    let mut command_builder = CommandBuilder::new(program.clone());
    for arg in &args {
        command_builder.arg(arg);
    }
    command_builder.env("TERM", "xterm-256color");
    let command_line = if args.is_empty() {
        program.clone()
    } else {
        format!("{program} {}", args.join(" "))
    };

    let child = pty_pair
        .slave
        .spawn_command(command_builder)
        .map_err(|error| format!("启动终端进程失败: {error}"))?;
    let pid = child.process_id().unwrap_or_default();
    let writer = pty_pair
        .master
        .take_writer()
        .map_err(|error| format!("创建终端写入流失败: {error}"))?;
    let mut reader = pty_pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("创建终端读取流失败: {error}"))?;

    let tab_id_for_reader = tab_id.to_string();
    let app_handle_for_reader = app_handle.clone();
    std::thread::spawn(move || {
        // 持续读取 PTY 输出并推送到前端 xterm。
        let mut buffer = [0u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    let _ = app_handle_for_reader.emit(
                        TERMINAL_CLOSED_EVENT,
                        TerminalClosedEvent {
                            tab_id: tab_id_for_reader.clone(),
                            exit_code: None,
                        },
                    );
                    break;
                }
                Ok(size) => {
                    let text = String::from_utf8_lossy(&buffer[..size]).to_string();
                    let _ = app_handle_for_reader.emit(
                        TERMINAL_OUTPUT_EVENT,
                        TerminalOutputEvent {
                            tab_id: tab_id_for_reader.clone(),
                            data: text,
                        },
                    );
                }
                Err(error) => {
                    let _ = app_handle_for_reader.emit(
                        TERMINAL_OUTPUT_EVENT,
                        TerminalOutputEvent {
                            tab_id: tab_id_for_reader.clone(),
                            data: format!("\r\n[Terminal read error] {error}\r\n"),
                        },
                    );
                    let _ = app_handle_for_reader.emit(
                        TERMINAL_CLOSED_EVENT,
                        TerminalClosedEvent {
                            tab_id: tab_id_for_reader.clone(),
                            exit_code: None,
                        },
                    );
                    break;
                }
            }
        }
    });

    let mut session = TerminalSession {
        master: pty_pair.master,
        writer,
        child,
    };

    // 新建终端时可直接下发种子命令（用于“复制到新终端并执行”）。
    if let Some(command) = initial_command {
        let trimmed = command.trim();
        if !trimmed.is_empty() {
            session
                .writer
                .write_all(format!("{trimmed}\r").as_bytes())
                .map_err(|error| format!("写入初始命令失败: {error}"))?;
            session
                .writer
                .flush()
                .map_err(|error| format!("刷新初始命令失败: {error}"))?;
        }
    }

    let mut session_map = sessions
        .lock()
        .map_err(|error| format!("终端会话锁获取失败: {error}"))?;
    session_map.insert(tab_id.to_string(), session);

    let shell_version = detect_shell_version(&program, &shell_name);
    Ok(TerminalSessionInfo {
        pid,
        command_line,
        shell_name,
        shell_version,
    })
}

/// 向指定终端会话写入输入数据（xterm 键盘事件透传）。
pub fn write_terminal_input(
    sessions: &Mutex<HashMap<String, TerminalSession>>,
    tab_id: &str,
    input: &str,
) -> Result<(), String> {
    let mut session_map = sessions
        .lock()
        .map_err(|error| format!("终端会话锁获取失败: {error}"))?;
    let session = session_map
        .get_mut(tab_id)
        .ok_or_else(|| format!("终端会话不存在: {tab_id}"))?;
    session
        .writer
        .write_all(input.as_bytes())
        .map_err(|error| format!("写入终端输入失败: {error}"))?;
    session
        .writer
        .flush()
        .map_err(|error| format!("刷新终端输入失败: {error}"))?;
    Ok(())
}

/// 调整终端窗口大小（xterm fit 后同步给 PTY）。
pub fn resize_terminal_session(
    sessions: &Mutex<HashMap<String, TerminalSession>>,
    tab_id: &str,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let mut session_map = sessions
        .lock()
        .map_err(|error| format!("终端会话锁获取失败: {error}"))?;
    let session = session_map
        .get_mut(tab_id)
        .ok_or_else(|| format!("终端会话不存在: {tab_id}"))?;
    session
        .master
        .resize(PtySize {
            rows: rows.max(10),
            cols: cols.max(20),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("调整终端尺寸失败: {error}"))?;
    Ok(())
}

/// 关闭指定终端会话并回收子进程。
pub fn close_terminal_session(
    sessions: &Mutex<HashMap<String, TerminalSession>>,
    tab_id: &str,
) -> Result<(), String> {
    let mut session_map = sessions
        .lock()
        .map_err(|error| format!("终端会话锁获取失败: {error}"))?;
    let mut session = match session_map.remove(tab_id) {
        Some(item) => item,
        None => return Ok(()),
    };
    let _ = session.child.kill();
    let _ = session.child.wait();
    Ok(())
}

/// 平台化解析默认 shell 启动命令。
fn resolve_shell_command(preferred_shell_command: Option<&str>) -> (String, Vec<String>, String) {
    if cfg!(target_os = "windows") {
        // Windows：动态探测可用终端列表，不限制特定版本。
        let options = list_available_terminal_shells();
        if let Some(preferred) = preferred_shell_command.map(|item| item.trim()).filter(|item| !item.is_empty()) {
            if let Some(matched) = options.iter().find(|item| item.command.eq_ignore_ascii_case(preferred)) {
                return (
                    matched.command.clone(),
                    windows_terminal_args(),
                    matched.shell_name.clone(),
                );
            }
        }
        if let Some(first) = options.first() {
            return (
                first.command.clone(),
                windows_terminal_args(),
                first.shell_name.clone(),
            );
        }
        // 兜底回退：若探测失败，仍尽量使用系统默认 powershell。
        return (
            "powershell.exe".to_string(),
            windows_terminal_args(),
            "Windows PowerShell".to_string(),
        );
    }

    // Unix 默认取 SHELL 环境变量，未配置时回退 /bin/bash。
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
    let shell_name = shell
        .rsplit('/')
        .next()
        .map(|item| item.to_string())
        .unwrap_or_else(|| "shell".to_string());
    (shell, vec!["-i".to_string()], shell_name)
}

/// Windows 终端参数：注入父进程守护任务，确保主进程异常退出后子终端自终止。
fn windows_terminal_args() -> Vec<String> {
    let parent_pid = std::process::id();
    let guard_script = build_windows_parent_guard_script(parent_pid);
    vec![
        "-NoExit".to_string(),
        "-NoLogo".to_string(),
        "-Command".to_string(),
        guard_script,
    ]
}

/// 构建 PowerShell 父进程守护脚本：周期检测主进程是否存活，不存活则结束当前 shell。
pub fn build_windows_parent_guard_script(parent_pid: u32) -> String {
    format!(
        "$__sstParentPid={parent_pid}; Start-Job -ScriptBlock {{ param($ppid,$selfPid) while($true) {{ if(-not (Get-Process -Id $ppid -ErrorAction SilentlyContinue)) {{ Stop-Process -Id $selfPid -Force; break }} Start-Sleep -Seconds 2 }} }} -ArgumentList $__sstParentPid,$PID | Out-Null"
    )
}

/// 列出当前系统可用终端（Windows 动态探测 PowerShell，非 Windows 使用 SHELL）。
pub fn list_available_terminal_shells() -> Vec<TerminalShellOption> {
    if cfg!(target_os = "windows") {
        let mut candidates = Vec::<String>::new();
        candidates.extend(discover_windows_shell_paths("pwsh.exe"));
        candidates.extend(discover_windows_shell_paths("powershell.exe"));

        if candidates.is_empty() {
            candidates.push("powershell.exe".to_string());
        }

        let mut options: Vec<TerminalShellOption> = candidates
            .into_iter()
            .filter_map(|command| {
                let (shell_name, shell_version) = detect_windows_shell_meta(&command);
                if shell_version.is_empty() {
                    return None;
                }
                Some(TerminalShellOption {
                    label: format!("{shell_name} {shell_version} ({command})"),
                    command,
                    shell_name,
                    shell_version,
                })
            })
            .collect();

        // 按版本号从高到低排序，默认优先最新版本。
        options.sort_by(|a, b| compare_version_desc(&a.shell_version, &b.shell_version));
        options.dedup_by(|a, b| a.command.eq_ignore_ascii_case(&b.command));
        return options;
    }

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
    let shell_name = shell
        .rsplit('/')
        .next()
        .map(|item| item.to_string())
        .unwrap_or_else(|| "shell".to_string());
    let shell_version = detect_shell_version(&shell, &shell_name);
    vec![TerminalShellOption {
        label: format!("{shell_name} ({shell})"),
        command: shell,
        shell_name,
        shell_version,
    }]
}

/// Windows 通过 where 命令检索可执行路径（可返回多条）。
fn discover_windows_shell_paths(program: &str) -> Vec<String> {
    if !cfg!(target_os = "windows") {
        return Vec::new();
    }
    let output = StdCommand::new("where").arg(program).output();
    let mut paths = Vec::<String>::new();
    if let Ok(result) = output {
        let text = String::from_utf8_lossy(&result.stdout).to_string();
        for line in text.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            paths.push(trimmed.to_string());
        }
    }
    if paths.is_empty() {
        paths.push(program.to_string());
    }
    paths
}

/// 检测 Windows shell 元信息（名称 + 版本）。
fn detect_windows_shell_meta(command: &str) -> (String, String) {
    let lower = command.to_lowercase();
    let shell_name = if lower.contains("pwsh") {
        "PowerShell".to_string()
    } else {
        "Windows PowerShell".to_string()
    };
    let version = detect_shell_version(command, &shell_name);
    (shell_name, version)
}

/// 对版本号做降序比较（仅处理数值段，不可解析时降级为字符串比较）。
fn compare_version_desc(a: &str, b: &str) -> std::cmp::Ordering {
    let parse = |input: &str| {
        input
            .split('.')
            .map(|item| item.trim().parse::<u32>().unwrap_or(0))
            .collect::<Vec<_>>()
    };
    let av = parse(a);
    let bv = parse(b);
    bv.cmp(&av).then_with(|| b.cmp(a))
}

/// 探测终端程序版本：用于 Tab 悬浮展示当前终端版本信息。
fn detect_shell_version(program: &str, shell_name: &str) -> String {
    // Windows：优先读取 PowerShell 的 PSVersion。
    if cfg!(target_os = "windows") {
        let output = StdCommand::new(program)
            .args([
                "-NoProfile",
                "-Command",
                "$PSVersionTable.PSVersion.ToString()",
            ])
            .output();
        if let Ok(result) = output {
            let version = String::from_utf8_lossy(&result.stdout).trim().to_string();
            if !version.is_empty() {
                return version;
            }
        }
        return "unknown".to_string();
    }

    // Unix：通用尝试 --version，取第一行展示。
    let output = StdCommand::new(program).arg("--version").output();
    if let Ok(result) = output {
        let text = String::from_utf8_lossy(&result.stdout).trim().to_string();
        if let Some(first_line) = text.lines().next() {
            let normalized = first_line.trim();
            if !normalized.is_empty() {
                return normalized.to_string();
            }
        }
    }

    // fallback：返回终端名称，避免 tooltip 空值。
    format!("{shell_name} unknown")
}

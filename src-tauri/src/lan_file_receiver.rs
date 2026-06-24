use std::net::Ipv4Addr;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use axum::body::Body;
use axum::extract::{DefaultBodyLimit, Multipart, Path as AxumPath, State as AxumState};
use axum::http::header::{CONTENT_DISPOSITION, CONTENT_TYPE};
use axum::http::{HeaderValue, StatusCode};
use axum::response::{Html, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::Engine as _;
use chrono::Utc;
use local_ip_address::list_afinet_netifas;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use uuid::Uuid;

use crate::app_state::{ensure_data_dir, AppState};

/// 上传页面模板：供手机、平板和桌面浏览器直接访问上传文件。
const LAN_FILE_RECEIVER_PAGE_HTML: &str =
    include_str!("../assets/lan-file-receiver.html");
/// 接收根目录名称：位于应用数据目录下。
const LAN_FILE_RECEIVER_ROOT_DIR: &str = "lan-file-receiver";
/// 接收文件目录名称：每个文件使用独立子目录承载元数据与载荷。
const LAN_FILE_RECEIVER_ITEMS_DIR: &str = "items";
/// 单个文件元数据文件名。
const LAN_FILE_RECEIVER_META_FILE: &str = "meta.json";
/// 上传页单次请求体积上限：兼顾常见图片/文档场景，避免误传过大文件。
const LAN_FILE_RECEIVER_BODY_LIMIT_BYTES: usize = 512 * 1024 * 1024;
/// 文本预览最大字节数：过大内容截断后再展示。
const LAN_FILE_RECEIVER_TEXT_PREVIEW_LIMIT_BYTES: usize = 256 * 1024;
/// 图片内嵌预览最大字节数：避免把超大图片转成 data URL 造成前端卡顿。
const LAN_FILE_RECEIVER_IMAGE_PREVIEW_LIMIT_BYTES: usize = 12 * 1024 * 1024;

/// 局域网文件接收服务运行时：保存监听端口与关闭句柄。
pub struct LanFileReceiverRuntime {
    /// 当前监听端口。
    pub port: u16,
    /// 优雅关闭信号。
    shutdown_sender: Option<oneshot::Sender<()>>,
}

/// 局域网接入地址：用于前端展示可访问的 `ip:port`。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanFileReceiverAddress {
    /// 网卡或地址标签。
    pub label: String,
    /// IPv4 文本。
    pub ip: String,
    /// 完整访问地址。
    pub url: String,
    /// 是否为推荐地址。
    pub is_preferred: bool,
}

/// 接收服务状态：描述当前监听状态、地址与文件数量。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanFileReceiverStatus {
    /// 当前是否已开启接收服务。
    pub enabled: bool,
    /// 当前监听端口；未开启时为空。
    pub port: Option<u16>,
    /// 本机访问地址：用于桌面端一键在浏览器中打开上传页。
    pub local_base_url: Option<String>,
    /// 局域网访问地址列表。
    pub access_urls: Vec<LanFileReceiverAddress>,
    /// 已接收文件总数。
    pub file_count: usize,
}

/// 文件预览类型：供前端决定图片、文本或占位视图。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LanFilePreviewKind {
    /// 图片文件，可直接显示缩略图或大图。
    Image,
    /// 文本文件，可直接读取 UTF-8 内容。
    Text,
    /// 其它文件，当前只展示元信息和外部操作。
    Unsupported,
}

/// 单个已接收文件的结构化信息。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanFileReceiverItem {
    /// 文件唯一 ID。
    pub id: String,
    /// 原始文件名。
    pub original_name: String,
    /// MIME 类型。
    pub mime_type: String,
    /// 预览类型：`image` / `text` / `unsupported`。
    pub preview_kind: String,
    /// 文件大小（字节）。
    pub size_bytes: u64,
    /// 接收时间（RFC3339）。
    pub received_at: String,
}

/// 文件预览载荷：用于前端右侧预览面板。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanFileReceiverPreviewPayload {
    /// 文件唯一 ID。
    pub id: String,
    /// 原始文件名。
    pub original_name: String,
    /// MIME 类型。
    pub mime_type: String,
    /// 预览类型。
    pub preview_kind: String,
    /// 文件大小（字节）。
    pub size_bytes: u64,
    /// 接收时间。
    pub received_at: String,
    /// 文本预览内容；仅文本文件返回。
    pub text_content: Option<String>,
    /// 图片预览 data URL；仅图片且尺寸可接受时返回。
    pub data_url: Option<String>,
    /// 当前预览是否被截断。
    pub truncated: bool,
    /// 预览提示：用于解释不支持或被截断原因。
    pub preview_message: Option<String>,
}

/// 落盘元数据：保存在每个文件目录内。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredLanFileMeta {
    /// 文件唯一 ID。
    id: String,
    /// 原始文件名。
    original_name: String,
    /// 实际保存到磁盘的文件名。
    stored_name: String,
    /// MIME 类型。
    mime_type: String,
    /// 文件大小（字节）。
    size_bytes: u64,
    /// 接收时间（RFC3339）。
    received_at: String,
}

/// 服务侧共享状态：上传页与文件接口复用同一份目录配置。
#[derive(Clone)]
struct LanFileReceiverServerState {
    /// Tauri 应用句柄：用于上传成功后向桌面端发送刷新事件。
    app_handle: AppHandle,
    /// 文件根目录。
    items_dir: PathBuf,
}

/// 上传成功响应：回传本次已接收文件列表。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UploadResponse {
    /// 成功保存的文件数量。
    saved_count: usize,
    /// 本次保存的文件列表。
    files: Vec<LanFileReceiverItem>,
}

/// 启动局域网文件接收服务；若已启动则直接返回当前状态。
#[tauri::command]
pub async fn start_lan_file_receiver(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<LanFileReceiverStatus, String> {
    {
        let runtime_guard = state
            .lan_file_receiver
            .lock()
            .map_err(|error| format!("读取接收服务状态失败: {error}"))?;
        if let Some(runtime) = runtime_guard.as_ref() {
            return build_lan_file_receiver_status(&app, Some(runtime.port));
        }
    }

    let items_dir = ensure_lan_file_receiver_items_dir(&app)?;
    let listener = TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0))
        .await
        .map_err(|error| format!("绑定局域网接收端口失败: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("读取局域网接收端口失败: {error}"))?
        .port();
    let (shutdown_sender, shutdown_receiver) = oneshot::channel::<()>();

    let router = build_lan_file_receiver_router().with_state(LanFileReceiverServerState {
        app_handle: app.clone(),
        items_dir: items_dir.clone(),
    });

    tauri::async_runtime::spawn(async move {
        let server = axum::serve(listener, router.into_make_service()).with_graceful_shutdown(async move {
            let _ = shutdown_receiver.await;
        });
        if let Err(error) = server.await {
            eprintln!("局域网文件接收服务异常退出: {error}");
        }
    });

    let mut runtime_guard = state
        .lan_file_receiver
        .lock()
        .map_err(|error| format!("写入接收服务状态失败: {error}"))?;
    *runtime_guard = Some(LanFileReceiverRuntime {
        port,
        shutdown_sender: Some(shutdown_sender),
    });
    drop(runtime_guard);

    build_lan_file_receiver_status(&app, Some(port))
}

/// 构造局域网接收服务路由：供运行时和测试共用，确保路径声明始终一致。
fn build_lan_file_receiver_router() -> Router<LanFileReceiverServerState> {
    Router::new()
        .route("/", get(render_lan_file_receiver_page))
        .route("/api/upload", post(handle_lan_file_upload))
        .route("/files/{file_id}/preview", get(handle_file_preview_request))
        .route("/files/{file_id}/download", get(handle_file_download_request))
        .layer(DefaultBodyLimit::max(LAN_FILE_RECEIVER_BODY_LIMIT_BYTES))
}

/// 关闭局域网文件接收服务；已关闭时直接返回成功。
#[tauri::command]
pub fn stop_lan_file_receiver(state: State<'_, AppState>) -> Result<(), String> {
    close_lan_file_receiver_runtime(&state.lan_file_receiver)
}

/// 读取接收服务当前状态：供工具页进入时初始化开关与地址展示。
#[tauri::command]
pub fn get_lan_file_receiver_status(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<LanFileReceiverStatus, String> {
    let runtime_guard = state
        .lan_file_receiver
        .lock()
        .map_err(|error| format!("读取接收服务状态失败: {error}"))?;
    let port = runtime_guard.as_ref().map(|runtime| runtime.port);
    build_lan_file_receiver_status(&app, port)
}

/// 列出已经接收的全部文件：按时间倒序返回。
#[tauri::command]
pub fn list_lan_file_receiver_files(app: tauri::AppHandle) -> Result<Vec<LanFileReceiverItem>, String> {
    let items_dir = ensure_lan_file_receiver_items_dir(&app)?;
    list_lan_file_receiver_items(&items_dir)
}

/// 读取指定文件的预览载荷：文本返回内容，图片返回 data URL。
#[tauri::command]
pub async fn read_lan_file_receiver_preview(
    app: tauri::AppHandle,
    file_id: String,
) -> Result<LanFileReceiverPreviewPayload, String> {
    let items_dir = ensure_lan_file_receiver_items_dir(&app)?;
    let meta = read_lan_file_meta_by_id(&items_dir, &file_id)?;
    let file_path = build_file_payload_path(&items_dir.join(&meta.id), &meta.stored_name);
    let preview_kind = detect_preview_kind(&meta.mime_type, &meta.original_name);

    match preview_kind {
        LanFilePreviewKind::Text => {
            let bytes = tokio::fs::read(&file_path)
                .await
                .map_err(|error| format!("读取文本预览失败: {error}"))?;
            let truncated = bytes.len() > LAN_FILE_RECEIVER_TEXT_PREVIEW_LIMIT_BYTES;
            let visible_bytes = if truncated {
                &bytes[..LAN_FILE_RECEIVER_TEXT_PREVIEW_LIMIT_BYTES]
            } else {
                &bytes[..]
            };
            Ok(LanFileReceiverPreviewPayload {
                id: meta.id,
                original_name: meta.original_name,
                mime_type: meta.mime_type,
                preview_kind: preview_kind.as_str().to_string(),
                size_bytes: meta.size_bytes,
                received_at: meta.received_at,
                text_content: Some(String::from_utf8_lossy(visible_bytes).to_string()),
                data_url: None,
                truncated,
                preview_message: truncated.then(|| "文本内容较大，已仅展示前 256 KB。".to_string()),
            })
        }
        LanFilePreviewKind::Image => {
            if meta.size_bytes as usize > LAN_FILE_RECEIVER_IMAGE_PREVIEW_LIMIT_BYTES {
                return Ok(LanFileReceiverPreviewPayload {
                    id: meta.id,
                    original_name: meta.original_name,
                    mime_type: meta.mime_type,
                    preview_kind: preview_kind.as_str().to_string(),
                    size_bytes: meta.size_bytes,
                    received_at: meta.received_at,
                    text_content: None,
                    data_url: None,
                    truncated: false,
                    preview_message: Some("图片体积较大，当前仅展示文件信息，请在本机浏览器中打开上传页或导出查看。".to_string()),
                });
            }

            let bytes = tokio::fs::read(&file_path)
                .await
                .map_err(|error| format!("读取图片预览失败: {error}"))?;
            let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
            Ok(LanFileReceiverPreviewPayload {
                id: meta.id,
                original_name: meta.original_name,
                mime_type: meta.mime_type.clone(),
                preview_kind: preview_kind.as_str().to_string(),
                size_bytes: meta.size_bytes,
                received_at: meta.received_at,
                text_content: None,
                data_url: Some(format!("data:{};base64,{}", meta.mime_type, encoded)),
                truncated: false,
                preview_message: None,
            })
        }
        LanFilePreviewKind::Unsupported => Ok(LanFileReceiverPreviewPayload {
            id: meta.id,
            original_name: meta.original_name,
            mime_type: meta.mime_type,
            preview_kind: preview_kind.as_str().to_string(),
            size_bytes: meta.size_bytes,
            received_at: meta.received_at,
            text_content: None,
            data_url: None,
            truncated: false,
            preview_message: Some("当前文件类型暂不支持内嵌预览，可保留在列表中继续管理。".to_string()),
        }),
    }
}

/// 删除单个已接收文件。
#[tauri::command]
pub fn delete_lan_file_receiver_file(
    app: tauri::AppHandle,
    file_id: String,
) -> Result<(), String> {
    let items_dir = ensure_lan_file_receiver_items_dir(&app)?;
    let target_dir = items_dir.join(file_id.trim());
    if target_dir.exists() {
        std::fs::remove_dir_all(&target_dir)
            .map_err(|error| format!("删除接收文件失败: {error}"))?;
    }
    Ok(())
}

/// 清空全部已接收文件。
#[tauri::command]
pub fn clear_lan_file_receiver_files(app: tauri::AppHandle) -> Result<(), String> {
    let items_dir = ensure_lan_file_receiver_items_dir(&app)?;
    let read_dir = std::fs::read_dir(&items_dir)
        .map_err(|error| format!("读取接收目录失败: {error}"))?;
    for entry in read_dir {
        let entry = entry.map_err(|error| format!("遍历接收目录失败: {error}"))?;
        let path = entry.path();
        if path.is_dir() {
            std::fs::remove_dir_all(&path)
                .map_err(|error| format!("删除接收文件失败: {error}"))?;
        }
    }
    Ok(())
}

/// 关闭运行中的接收服务：供命令和应用退出阶段复用。
pub fn close_lan_file_receiver_runtime(
    runtime_store: &Mutex<Option<LanFileReceiverRuntime>>,
) -> Result<(), String> {
    let mut runtime_guard = runtime_store
        .lock()
        .map_err(|error| format!("读取接收服务状态失败: {error}"))?;
    if let Some(mut runtime) = runtime_guard.take() {
        if let Some(shutdown_sender) = runtime.shutdown_sender.take() {
            let _ = shutdown_sender.send(());
        }
    }
    Ok(())
}

/// 渲染局域网上传页面。
async fn render_lan_file_receiver_page() -> Html<&'static str> {
    Html(LAN_FILE_RECEIVER_PAGE_HTML)
}

/// 处理上传请求：支持一次选择多个文件。
async fn handle_lan_file_upload(
    AxumState(state): AxumState<LanFileReceiverServerState>,
    mut multipart: Multipart,
) -> Result<Json<UploadResponse>, (StatusCode, String)> {
    let mut saved_files: Vec<LanFileReceiverItem> = Vec::new();

    loop {
        let Some(field) = multipart
            .next_field()
            .await
            .map_err(|error| (StatusCode::BAD_REQUEST, format!("解析上传表单失败: {error}")))?
        else {
            break;
        };

        let original_name = sanitize_upload_file_name(
            field
                .file_name()
                .map(|value| value.trim())
                .unwrap_or("unnamed.bin"),
        );
        let mime_type = normalize_mime_type(
            field.content_type(),
            &original_name,
        );
        let bytes = field
            .bytes()
            .await
            .map_err(|error| (StatusCode::BAD_REQUEST, format!("读取上传文件失败: {error}")))?;

        let meta = persist_uploaded_file(&state.items_dir, &original_name, &mime_type, &bytes)
            .await
            .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error))?;
        saved_files.push(to_lan_file_receiver_item(&meta));
    }

    if saved_files.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "未检测到可保存的文件，请先选择文件后再上传。".to_string()));
    }

    let _ = state.app_handle.emit(
        "sf:lan-file-receiver-files-updated",
        serde_json::json!({
            "savedCount": saved_files.len()
        }),
    );

    Ok(Json(UploadResponse {
        saved_count: saved_files.len(),
        files: saved_files,
    }))
}

/// 以浏览器可直接消费的方式返回指定文件内容。
async fn handle_file_preview_request(
    AxumState(state): AxumState<LanFileReceiverServerState>,
    AxumPath(file_id): AxumPath<String>,
) -> Result<Response, (StatusCode, String)> {
    build_file_http_response(&state.items_dir, &file_id, false).await
}

/// 以附件下载方式返回指定文件内容。
async fn handle_file_download_request(
    AxumState(state): AxumState<LanFileReceiverServerState>,
    AxumPath(file_id): AxumPath<String>,
) -> Result<Response, (StatusCode, String)> {
    build_file_http_response(&state.items_dir, &file_id, true).await
}

/// 构造文件 HTTP 响应：支持 inline 预览与 attachment 下载两种模式。
async fn build_file_http_response(
    items_dir: &Path,
    file_id: &str,
    force_download: bool,
) -> Result<Response, (StatusCode, String)> {
    let meta = read_lan_file_meta_by_id(items_dir, file_id)
        .map_err(|error| (StatusCode::NOT_FOUND, error))?;
    let file_path = build_file_payload_path(&items_dir.join(&meta.id), &meta.stored_name);
    let bytes = tokio::fs::read(&file_path)
        .await
        .map_err(|error| (StatusCode::NOT_FOUND, format!("读取文件失败: {error}")))?;
    let disposition = if force_download { "attachment" } else { "inline" };

    let mut response = Response::new(Body::from(bytes));
    response.headers_mut().insert(
        CONTENT_TYPE,
        HeaderValue::from_str(&meta.mime_type)
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    response.headers_mut().insert(
        CONTENT_DISPOSITION,
        HeaderValue::from_str(&build_content_disposition(disposition, &meta.original_name))
            .unwrap_or_else(|_| HeaderValue::from_static("inline")),
    );
    Ok(response)
}

/// 计算当前状态对象：根据监听端口拼装地址与文件数量。
fn build_lan_file_receiver_status(
    app: &AppHandle,
    port: Option<u16>,
) -> Result<LanFileReceiverStatus, String> {
    let items_dir = ensure_lan_file_receiver_items_dir(app)?;
    let file_count = list_lan_file_receiver_items(&items_dir)?.len();
    let access_urls = port
        .map(collect_lan_access_urls)
        .transpose()?
        .unwrap_or_default();

    Ok(LanFileReceiverStatus {
        enabled: port.is_some(),
        port,
        local_base_url: port.map(|value| format!("http://127.0.0.1:{value}")),
        access_urls,
        file_count,
    })
}

/// 列出磁盘上的已接收文件，并按时间倒序排序。
fn list_lan_file_receiver_items(items_dir: &Path) -> Result<Vec<LanFileReceiverItem>, String> {
    let read_dir = std::fs::read_dir(items_dir)
        .map_err(|error| format!("读取接收目录失败: {error}"))?;
    let mut items: Vec<LanFileReceiverItem> = Vec::new();

    for entry in read_dir {
        let entry = entry.map_err(|error| format!("遍历接收目录失败: {error}"))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let meta = read_lan_file_meta(&path)?;
        items.push(to_lan_file_receiver_item(&meta));
    }

    items.sort_by(|left, right| right.received_at.cmp(&left.received_at));
    Ok(items)
}

/// 将元数据结构转换为前端文件列表项。
fn to_lan_file_receiver_item(meta: &StoredLanFileMeta) -> LanFileReceiverItem {
    LanFileReceiverItem {
        id: meta.id.clone(),
        original_name: meta.original_name.clone(),
        mime_type: meta.mime_type.clone(),
        preview_kind: detect_preview_kind(&meta.mime_type, &meta.original_name)
            .as_str()
            .to_string(),
        size_bytes: meta.size_bytes,
        received_at: meta.received_at.clone(),
    }
}

/// 将上传文件写入磁盘：目录内同时保存 `meta.json` 和实际文件。
async fn persist_uploaded_file(
    items_dir: &Path,
    original_name: &str,
    mime_type: &str,
    bytes: &[u8],
) -> Result<StoredLanFileMeta, String> {
    let file_id = Uuid::new_v4().to_string();
    let item_dir = items_dir.join(&file_id);
    tokio::fs::create_dir_all(&item_dir)
        .await
        .map_err(|error| format!("创建接收目录失败: {error}"))?;

    let stored_name = sanitize_upload_file_name(original_name);
    let file_path = build_file_payload_path(&item_dir, &stored_name);
    tokio::fs::write(&file_path, bytes)
        .await
        .map_err(|error| format!("写入接收文件失败: {error}"))?;

    let meta = StoredLanFileMeta {
        id: file_id,
        original_name: original_name.to_string(),
        stored_name,
        mime_type: mime_type.to_string(),
        size_bytes: bytes.len() as u64,
        received_at: Utc::now().to_rfc3339(),
    };
    let meta_path = build_meta_file_path(&item_dir);
    let meta_json = serde_json::to_string_pretty(&meta)
        .map_err(|error| format!("序列化接收元数据失败: {error}"))?;
    tokio::fs::write(&meta_path, meta_json)
        .await
        .map_err(|error| format!("写入接收元数据失败: {error}"))?;
    Ok(meta)
}

/// 读取指定 ID 的元数据。
fn read_lan_file_meta_by_id(items_dir: &Path, file_id: &str) -> Result<StoredLanFileMeta, String> {
    let normalized_id = file_id.trim();
    if normalized_id.is_empty() || normalized_id.contains("..") || normalized_id.contains('/') || normalized_id.contains('\\') {
        return Err("文件标识无效。".to_string());
    }
    read_lan_file_meta(&items_dir.join(normalized_id))
}

/// 读取单个文件目录内的 `meta.json`。
fn read_lan_file_meta(item_dir: &Path) -> Result<StoredLanFileMeta, String> {
    let meta_path = build_meta_file_path(item_dir);
    let raw = std::fs::read_to_string(&meta_path)
        .map_err(|error| format!("读取接收元数据失败: {error}"))?;
    serde_json::from_str::<StoredLanFileMeta>(&raw)
        .map_err(|error| format!("解析接收元数据失败: {error}"))
}

/// 拼装 `meta.json` 路径。
fn build_meta_file_path(item_dir: &Path) -> PathBuf {
    item_dir.join(LAN_FILE_RECEIVER_META_FILE)
}

/// 拼装文件载荷路径。
fn build_file_payload_path(item_dir: &Path, stored_name: &str) -> PathBuf {
    item_dir.join(stored_name)
}

/// 解析并创建接收目录。
fn ensure_lan_file_receiver_items_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let mut root_dir = ensure_data_dir(app)?;
    root_dir.push(LAN_FILE_RECEIVER_ROOT_DIR);
    root_dir.push(LAN_FILE_RECEIVER_ITEMS_DIR);
    std::fs::create_dir_all(&root_dir)
        .map_err(|error| format!("创建局域网接收目录失败: {error}"))?;
    Ok(root_dir)
}

/// 收集当前主机可用于局域网访问的 IPv4 地址。
fn collect_lan_access_urls(port: u16) -> Result<Vec<LanFileReceiverAddress>, String> {
    let raw_interfaces = list_afinet_netifas()
        .map_err(|error| format!("读取本机 IPv4 地址失败: {error}"))?;
    let mut addresses: Vec<(String, Ipv4Addr)> = raw_interfaces
        .into_iter()
        .filter_map(|(label, ip)| match ip {
            std::net::IpAddr::V4(ipv4)
                if !ipv4.is_loopback() && !ipv4.is_unspecified() && !ipv4.is_multicast() =>
            {
                Some((label, ipv4))
            }
            _ => None,
        })
        .collect();

    addresses.sort_by(|left, right| {
        let left_private = is_private_ipv4(&left.1);
        let right_private = is_private_ipv4(&right.1);
        right_private
            .cmp(&left_private)
            .then_with(|| left.0.cmp(&right.0))
            .then_with(|| left.1.octets().cmp(&right.1.octets()))
    });
    addresses.dedup_by(|left, right| left.1 == right.1);

    Ok(addresses
        .into_iter()
        .enumerate()
        .map(|(index, (label, ip))| LanFileReceiverAddress {
            label,
            ip: ip.to_string(),
            url: format!("http://{}:{port}", ip),
            is_preferred: index == 0,
        })
        .collect())
}

/// 归一化上传文件名：移除危险字符并保留可读性。
pub fn sanitize_upload_file_name(raw_name: &str) -> String {
    let raw_file_name = raw_name
        .trim()
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
        .trim_matches('.');

    let mut normalized = String::new();
    let mut previous_is_separator = false;

    for character in raw_file_name.chars() {
        let should_replace = character.is_control()
            || character.is_whitespace()
            || matches!(character, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*');
        if should_replace {
            if !previous_is_separator {
                normalized.push('_');
                previous_is_separator = true;
            }
            continue;
        }

        normalized.push(character);
        previous_is_separator = character == '_';
    }

    let normalized = normalized.trim_matches('_').to_string();
    if normalized.is_empty() {
        return "unnamed.bin".to_string();
    }

    if normalized.len() <= 120 {
        return normalized;
    }

    let extension = file_extension(&normalized);
    if extension.is_empty() {
        return normalized.chars().take(120).collect();
    }

    let suffix = format!(".{extension}");
    let max_base_len = 120usize.saturating_sub(suffix.len());
    let base_name = normalized
        .trim_end_matches(&suffix)
        .chars()
        .take(max_base_len)
        .collect::<String>();
    format!("{base_name}{suffix}")
}

/// 根据 MIME 与扩展名推断预览能力。
pub fn detect_preview_kind(mime_type: &str, file_name: &str) -> LanFilePreviewKind {
    let normalized_mime_type = mime_type.trim().to_ascii_lowercase();
    let extension = file_extension(file_name);

    if normalized_mime_type.starts_with("image/")
        || matches!(
            extension.as_str(),
            "png" | "jpg" | "jpeg" | "gif" | "bmp" | "webp" | "svg"
        )
    {
        return LanFilePreviewKind::Image;
    }

    if normalized_mime_type.starts_with("text/")
        || matches!(
            normalized_mime_type.as_str(),
            "application/json"
                | "application/xml"
                | "application/javascript"
                | "application/x-javascript"
                | "application/x-sh"
                | "application/x-yaml"
                | "application/yaml"
        )
        || matches!(
            extension.as_str(),
            "txt"
                | "md"
                | "log"
                | "json"
                | "csv"
                | "tsv"
                | "xml"
                | "html"
                | "css"
                | "js"
                | "jsx"
                | "ts"
                | "tsx"
                | "sql"
                | "yaml"
                | "yml"
                | "ini"
                | "conf"
                | "env"
        )
    {
        return LanFilePreviewKind::Text;
    }

    LanFilePreviewKind::Unsupported
}

/// 提取文件扩展名：统一转为小写，供预览识别复用。
fn file_extension(file_name: &str) -> String {
    Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default()
}

/// MIME 归一化：优先使用上传字段提供的值，缺失时回退扩展名推断。
fn normalize_mime_type(raw_mime_type: Option<&str>, file_name: &str) -> String {
    raw_mime_type
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.trim().to_string())
        .unwrap_or_else(|| {
            mime_guess::from_path(file_name)
                .first_raw()
                .unwrap_or("application/octet-stream")
                .to_string()
        })
}

/// 构造 `Content-Disposition`：兼顾中文文件名下载。
fn build_content_disposition(disposition: &str, file_name: &str) -> String {
    let escaped_ascii_name = sanitize_upload_file_name(file_name);
    let encoded_name = urlencoding::encode(file_name);
    format!(
        "{disposition}; filename=\"{escaped_ascii_name}\"; filename*=UTF-8''{encoded_name}"
    )
}

/// 判断 IPv4 是否属于常见局域网私网地址段。
fn is_private_ipv4(ip: &Ipv4Addr) -> bool {
    let [first, second, ..] = ip.octets();
    first == 10
        || (first == 172 && (16..=31).contains(&second))
        || (first == 192 && second == 168)
}

impl LanFilePreviewKind {
    /// 转成前端约定的字符串值。
    fn as_str(&self) -> &'static str {
        match self {
            Self::Image => "image",
            Self::Text => "text",
            Self::Unsupported => "unsupported",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_content_disposition, build_lan_file_receiver_router, detect_preview_kind,
        file_extension, sanitize_upload_file_name, LanFilePreviewKind,
    };

    #[test]
    fn sanitize_upload_file_name_replaces_invalid_characters_and_falls_back() {
        assert_eq!(
            sanitize_upload_file_name(" ..\\\\mobile/screen shot?.png "),
            "screen_shot_.png"
        );
        assert_eq!(sanitize_upload_file_name("   "), "unnamed.bin");
    }

    #[test]
    fn detect_preview_kind_supports_image_and_text_files() {
        assert_eq!(
            detect_preview_kind("image/png", "photo.png"),
            LanFilePreviewKind::Image
        );
        assert_eq!(
            detect_preview_kind("text/plain", "log.txt"),
            LanFilePreviewKind::Text
        );
        assert_eq!(
            detect_preview_kind("application/json", "data.json"),
            LanFilePreviewKind::Text
        );
        assert_eq!(
            detect_preview_kind("application/zip", "bundle.zip"),
            LanFilePreviewKind::Unsupported
        );
    }

    #[test]
    fn file_extension_returns_lowercase_extension() {
        assert_eq!(file_extension("Photo.PNG"), "png");
        assert_eq!(file_extension("README"), "");
    }

    #[test]
    fn build_content_disposition_includes_utf8_filename() {
        let header = build_content_disposition("attachment", "测试.png");
        assert!(header.contains("attachment;"));
        assert!(header.contains("filename*=UTF-8''"));
    }

    #[test]
    fn build_lan_file_receiver_router_does_not_panic() {
        let result = std::panic::catch_unwind(build_lan_file_receiver_router);
        assert!(result.is_ok(), "局域网接收服务路由不应在构建时 panic");
    }
}

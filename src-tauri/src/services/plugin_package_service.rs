use std::fs::{self, File};
use std::io::{Cursor, Read};
use std::path::{Component, Path, PathBuf};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zip::ZipArchive;

use crate::error::AppError;
use crate::storage::{
    plugin_repo::{self, InstalledPluginRecord},
    Storage,
};

/// 外部插件包标准清单结构（对应 `.sstplugin` 内的 `manifest.json`）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalPluginManifest {
    /// 全局唯一插件 ID（仅允许小写字母、数字、点号、中划线、下划线）。
    pub id: String,
    /// 插件显示名称。
    pub name: String,
    /// 插件版本号（SemVer）。
    pub version: String,
    /// 声明兼容的宿主插件 API 版本（如 "^1.0.0"）。
    #[serde(default = "default_api_version")]
    pub api_version: String,
    /// 插件简短说明。
    #[serde(default)]
    pub description: String,
    /// 插件分类（dev-tool / terminal / network / database）。
    #[serde(default = "default_category")]
    pub category: String,
    /// 挂载目标（workspace-tab / dock-right / modal）。
    #[serde(default = "default_mount_targets")]
    pub mount_targets: Vec<String>,
    /// 申请的权限清单（storage / workspace:read / workspace:write / clipboard / ipc:terminal / ipc:lan-receiver）。
    #[serde(default)]
    pub permissions: Vec<String>,
    /// 插件入口 HTML 相对路径（默认 `dist/index.html`）。
    #[serde(default = "default_entry")]
    pub entry: String,
    /// 插件图标相对路径（可选，如 `icon.svg`）。
    #[serde(default)]
    pub icon: Option<String>,
}

fn default_api_version() -> String {
    "^1.0.0".to_string()
}

fn default_category() -> String {
    "dev-tool".to_string()
}

fn default_mount_targets() -> Vec<String> {
    vec!["workspace-tab".to_string()]
}

fn default_entry() -> String {
    "dist/index.html".to_string()
}

/// 预览解析 `.sstplugin` 插件包返回结果：供前端弹窗确认权限后再安装。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginPackageInspection {
    /// 解析后的清单。
    pub manifest: ExternalPluginManifest,
    /// 插件包 SHA-256 校验值。
    pub package_sha256: String,
    /// 文件总大小（字节）。
    pub package_size_bytes: u64,
    /// 是否覆盖已安装的旧版本。
    pub is_upgrade: bool,
    /// 若已安装，返回旧版本号。
    pub previous_version: Option<String>,
}

/// 外部插件包管理服务：负责 `.sstplugin` 校验、解压、落盘安装、启停、卸载与静态资源读取。
pub struct PluginPackageService<'a> {
    storage: &'a Storage,
    plugins_root: PathBuf,
}

impl<'a> PluginPackageService<'a> {
    /// 创建插件包管理服务（`plugins_root` 通常为 `{app_data_dir}/plugins`）。
    pub fn new(storage: &'a Storage, plugins_root: PathBuf) -> Self {
        Self {
            storage,
            plugins_root,
        }
    }

    /// 校验并预览 `.sstplugin` 压缩包（不落盘），提取 `manifest.json` 供用户审批权限。
    pub fn inspect_package_bytes(
        &self,
        bytes: &[u8],
    ) -> Result<PluginPackageInspection, AppError> {
        let package_sha256 = compute_sha256_hex(bytes);
        let package_size_bytes = bytes.len() as u64;
        let mut archive = ZipArchive::new(Cursor::new(bytes))
            .map_err(|e| AppError::Biz(format!("无法读取 .sstplugin 压缩包: {e}")))?;

        let manifest_raw = read_zip_entry_text(&mut archive, "manifest.json")?;
        let manifest: ExternalPluginManifest = serde_json::from_str(&manifest_raw)
            .map_err(|e| AppError::Biz(format!("manifest.json 解析失败: {e}")))?;
        validate_manifest(&manifest, &mut archive)?;

        let existing = self
            .storage
            .read(|conn| plugin_repo::get_installed_plugin(conn, &manifest.id))?;

        Ok(PluginPackageInspection {
            manifest,
            package_sha256,
            package_size_bytes,
            is_upgrade: existing.is_some(),
            previous_version: existing.map(|item| item.version),
        })
    }

    /// 安装或升级 `.sstplugin` 插件包到 `{plugins_root}/{plugin_id}/` 并写入 SQLite。
    pub fn install_package_bytes(
        &self,
        bytes: &[u8],
    ) -> Result<InstalledPluginRecord, AppError> {
        let inspection = self.inspect_package_bytes(bytes)?;
        let manifest = &inspection.manifest;
        let target_dir = self.plugins_root.join(&manifest.id);
        let staging_dir = self
            .plugins_root
            .join(format!(".staging-{}-{}", manifest.id, uuid::Uuid::new_v4()));

        fs::create_dir_all(&self.plugins_root)
            .map_err(|e| AppError::Biz(format!("创建插件根目录失败: {e}")))?;
        fs::create_dir_all(&staging_dir)
            .map_err(|e| AppError::Biz(format!("创建插件暂存目录失败: {e}")))?;

        let mut archive = ZipArchive::new(Cursor::new(bytes))
            .map_err(|e| AppError::Biz(format!("读取插件包失败: {e}")))?;

        // 行内注释：逐项安全解压，严格校验相对路径防止 ZipSlip 目录穿越。
        for index in 0..archive.len() {
            let mut file = archive
                .by_index(index)
                .map_err(|e| AppError::Biz(format!("读取压缩条目失败: {e}")))?;
            let rel_path = sanitize_zip_entry_path(file.name())?;
            let out_path = staging_dir.join(&rel_path);
            if file.is_dir() {
                fs::create_dir_all(&out_path)
                    .map_err(|e| AppError::Biz(format!("创建插件子目录失败: {e}")))?;
            } else {
                if let Some(parent) = out_path.parent() {
                    fs::create_dir_all(parent)
                        .map_err(|e| AppError::Biz(format!("创建插件父目录失败: {e}")))?;
                }
                let mut out_file = File::create(&out_path)
                    .map_err(|e| AppError::Biz(format!("写入插件文件失败: {e}")))?;
                std::io::copy(&mut file, &mut out_file)
                    .map_err(|e| AppError::Biz(format!("解压插件内容失败: {e}")))?;
            }
        }

        if target_dir.exists() {
            fs::remove_dir_all(&target_dir)
                .map_err(|e| AppError::Biz(format!("清理旧版插件目录失败: {e}")))?;
        }
        fs::rename(&staging_dir, &target_dir)
            .map_err(|e| AppError::Biz(format!("落盘插件目录失败: {e}")))?;

        let now = Utc::now().to_rfc3339();
        let manifest_json = serde_json::to_string(manifest)
            .map_err(|e| AppError::Biz(format!("序列化 manifest 失败: {e}")))?;
        let granted_permissions = serde_json::to_string(&manifest.permissions)
            .map_err(|e| AppError::Biz(format!("序列化权限失败: {e}")))?;

        let record = InstalledPluginRecord {
            plugin_id: manifest.id.clone(),
            name: manifest.name.clone(),
            version: manifest.version.clone(),
            api_version: manifest.api_version.clone(),
            description: manifest.description.clone(),
            category: manifest.category.clone(),
            manifest_json,
            install_dir: target_dir.to_string_lossy().to_string(),
            enabled: true,
            granted_permissions,
            package_sha256: inspection.package_sha256,
            installed_at: now.clone(),
            updated_at: now,
        };

        self.storage
            .write_tx(|tx| plugin_repo::upsert_installed_plugin(tx, &record))?;

        Ok(record)
    }

    /// 从本地文件路径预览 `.sstplugin` 插件包。
    #[allow(dead_code)]
    pub fn inspect_package_file(
        &self,
        package_path: &str,
    ) -> Result<PluginPackageInspection, AppError> {
        let bytes = fs::read(package_path)
            .map_err(|e| AppError::Biz(format!("读取插件包文件失败: {e}")))?;
        self.inspect_package_bytes(&bytes)
    }

    /// 从本地文件路径安装 `.sstplugin` 插件包。
    pub fn install_package_file(
        &self,
        package_path: &str,
    ) -> Result<InstalledPluginRecord, AppError> {
        let bytes = fs::read(package_path)
            .map_err(|e| AppError::Biz(format!("读取插件包文件失败: {e}")))?;
        self.install_package_bytes(&bytes)
    }

    /// 列出全部已安装的外部插件。
    pub fn list_installed(&self) -> Result<Vec<InstalledPluginRecord>, AppError> {
        self.storage.read(plugin_repo::list_installed_plugins)
    }

    /// 切换外部插件启用状态。
    pub fn set_enabled(&self, plugin_id: &str, enabled: bool) -> Result<(), AppError> {
        self.storage
            .write_tx(|tx| plugin_repo::set_installed_plugin_enabled(tx, plugin_id, enabled))
    }

    /// 卸载外部插件并清理安装目录与隔离 KV 数据。
    pub fn uninstall(&self, plugin_id: &str) -> Result<(), AppError> {
        let existing = self
            .storage
            .read(|conn| plugin_repo::get_installed_plugin(conn, plugin_id))?;
        if let Some(record) = existing {
            let dir = PathBuf::from(&record.install_dir);
            if dir.exists() {
                let _ = fs::remove_dir_all(&dir);
            }
        }
        self.storage
            .write_tx(|tx| plugin_repo::delete_installed_plugin(tx, plugin_id))
    }

    /// 安全解析并读取 `plugin://<plugin-id>/<asset-path>` 对应的本地文件字节与 MIME。
    pub fn read_plugin_asset(
        &self,
        plugin_id: &str,
        asset_rel_path: &str,
    ) -> Result<(Vec<u8>, String), AppError> {
        validate_plugin_id(plugin_id)?;
        let record = self
            .storage
            .read(|conn| plugin_repo::get_installed_plugin(conn, plugin_id))?
            .ok_or_else(|| AppError::Biz(format!("未找到已安装插件: {plugin_id}")))?;
        if !record.enabled {
            return Err(AppError::Biz(format!("插件已禁用: {plugin_id}")));
        }

        let clean_rel = sanitize_zip_entry_path(asset_rel_path)?;
        let root_dir = PathBuf::from(&record.install_dir)
            .canonicalize()
            .map_err(|e| AppError::Biz(format!("插件目录不可访问: {e}")))?;
        let target_path = root_dir
            .join(&clean_rel)
            .canonicalize()
            .map_err(|_| AppError::Biz(format!("插件资源不存在: {asset_rel_path}")))?;

        if !target_path.starts_with(&root_dir) {
            return Err(AppError::Biz(
                "禁止访问插件安装目录之外的资源".to_string(),
            ));
        }

        let bytes =
            fs::read(&target_path).map_err(|e| AppError::Biz(format!("读取插件资源失败: {e}")))?;
        let mime = mime_guess::from_path(&target_path)
            .first_or_octet_stream()
            .essence_str()
            .to_string();
        Ok((bytes, mime))
    }
}

/// 校验插件 ID 合法性（禁止空格、斜杠及路径穿越字符）。
fn validate_plugin_id(plugin_id: &str) -> Result<(), AppError> {
    let trimmed = plugin_id.trim();
    if trimmed.is_empty()
        || trimmed.starts_with("builtin.")
        || !trimmed
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '-' | '_'))
    {
        return Err(AppError::Biz(format!(
            "非法插件 ID（仅允许小写字母、数字、'.'、'-'、'_' 且不可使用 builtin. 前缀）: {plugin_id}"
        )));
    }
    Ok(())
}

/// 校验 `manifest.json` 必填字段与入口文件存在性。
fn validate_manifest(
    manifest: &ExternalPluginManifest,
    archive: &mut ZipArchive<Cursor<&[u8]>>,
) -> Result<(), AppError> {
    validate_plugin_id(&manifest.id)?;
    if manifest.name.trim().is_empty() {
        return Err(AppError::Biz("manifest.name 不能为空".to_string()));
    }
    if manifest.version.trim().is_empty() {
        return Err(AppError::Biz("manifest.version 不能为空".to_string()));
    }
    let clean_entry = sanitize_zip_entry_path(&manifest.entry)?;
    let entry_key = clean_entry.to_string_lossy().replace('\\', "/");
    if archive.by_name(&entry_key).is_err() {
        return Err(AppError::Biz(format!(
            "插件包缺少入口文件: {entry_key}"
        )));
    }
    Ok(())
}

/// 清洗并校验压缩包内部路径，严防 ZipSlip。
fn sanitize_zip_entry_path(raw: &str) -> Result<PathBuf, AppError> {
    let normalized = raw.trim().trim_start_matches('/');
    if normalized.is_empty() {
        return Err(AppError::Biz("插件资源路径不能为空".to_string()));
    }
    let mut out = PathBuf::new();
    for comp in Path::new(normalized).components() {
        match comp {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            _ => {
                return Err(AppError::Biz(format!(
                    "检测到非法插件资源路径: {raw}"
                )));
            }
        }
    }
    if out.as_os_str().is_empty() {
        return Err(AppError::Biz(format!("非法插件资源路径: {raw}")));
    }
    Ok(out)
}

/// 读取压缩包内指定 UTF-8 文本文件。
fn read_zip_entry_text(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    name: &str,
) -> Result<String, AppError> {
    let mut entry = archive
        .by_name(name)
        .map_err(|_| AppError::Biz(format!("插件包缺少必需文件: {name}")))?;
    let mut buf = String::new();
    entry
        .read_to_string(&mut buf)
        .map_err(|e| AppError::Biz(format!("读取 {name} 失败: {e}")))?;
    Ok(buf)
}

/// 计算字节流的 SHA-256 十六进制摘要。
fn compute_sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::PluginPackageService;
    use crate::storage::Storage;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    fn build_sample_sstplugin_bytes(id: &str, version: &str) -> Vec<u8> {
        let mut cursor = std::io::Cursor::new(Vec::new());
        {
            let mut zip = zip::ZipWriter::new(&mut cursor);
            let options = SimpleFileOptions::default();
            zip.start_file("manifest.json", options).unwrap();
            let manifest = serde_json::json!({
                "id": id,
                "name": "示例外部插件",
                "version": version,
                "apiVersion": "^1.0.0",
                "description": "测试专用格式插件包安装",
                "category": "database",
                "mountTargets": ["workspace-tab"],
                "permissions": ["storage", "workspace:read"],
                "entry": "dist/index.html"
            });
            zip.write_all(manifest.to_string().as_bytes()).unwrap();

            zip.start_file("dist/index.html", options).unwrap();
            zip.write_all(b"<html><body>Hello Plugin</body></html>")
                .unwrap();
            zip.finish().unwrap();
        }
        cursor.into_inner()
    }

    #[test]
    fn inspects_installs_toggles_reads_asset_and_uninstalls_sstplugin() {
        let storage = Storage::open_test().unwrap();
        let root =
            std::env::temp_dir().join(format!("sstplugin-test-{}", uuid::Uuid::new_v4()));
        let service = PluginPackageService::new(&storage, root.clone());

        let pkg_v1 = build_sample_sstplugin_bytes("com.example.demo", "1.0.0");
        let inspection = service.inspect_package_bytes(&pkg_v1).unwrap();
        assert_eq!(inspection.manifest.id, "com.example.demo");
        assert!(!inspection.is_upgrade);

        let installed = service.install_package_bytes(&pkg_v1).unwrap();
        assert_eq!(installed.version, "1.0.0");
        assert!(installed.enabled);

        let (html, mime) = service
            .read_plugin_asset("com.example.demo", "dist/index.html")
            .unwrap();
        assert!(String::from_utf8_lossy(&html).contains("Hello Plugin"));
        assert_eq!(mime, "text/html");

        service.set_enabled("com.example.demo", false).unwrap();
        assert!(service
            .read_plugin_asset("com.example.demo", "dist/index.html")
            .is_err());

        service.uninstall("com.example.demo").unwrap();
        assert!(service.list_installed().unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }
}

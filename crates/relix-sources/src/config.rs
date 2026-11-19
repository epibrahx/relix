use std::path::{Path, PathBuf};

use relix_core::{ProjectConfig, postgres_config_key};

use crate::error::SourceError;

/// Identifies where a schema came from so `relix.toml` can be resolved without storing credentials.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SchemaSourceKind {
    File(PathBuf),
    PostgresUrl(String),
}

/// Resolve the `relix.toml` path for a schema source:
/// - SQLite / SQL file: `relix.toml` in the same directory as the file.
/// - Postgres: `<user_config_dir>/relix/<pg_host_db_hash>.toml` (never stores credentials).
pub fn resolve_config_path(source: &SchemaSourceKind) -> Result<PathBuf, SourceError> {
    match source {
        SchemaSourceKind::File(path) => {
            let parent = path
                .parent()
                .filter(|p| !p.as_os_str().is_empty())
                .unwrap_or_else(|| Path::new("."));
            Ok(parent.join("relix.toml"))
        }
        SchemaSourceKind::PostgresUrl(url) => {
            let base = dirs::config_dir().ok_or_else(|| {
                SourceError::PermissionOrIo("无法定位系统用户配置目录".to_string())
            })?;
            let key = postgres_config_key(url);
            Ok(base.join("relix").join(format!("{key}.toml")))
        }
    }
}

/// Load `ProjectConfig` from `path`, returning `ProjectConfig::default()` if the file does not exist yet.
pub fn load_project_config(path: &Path) -> Result<ProjectConfig, SourceError> {
    if !path.exists() {
        return Ok(ProjectConfig::default());
    }
    let content = std::fs::read_to_string(path)
        .map_err(|err| SourceError::PermissionOrIo(format!("{}: {err}", path.display())))?;
    ProjectConfig::from_toml_str(&content).map_err(|err| {
        SourceError::SqlParseFailed(format!("配置文件 {} 解析失败: {err}", path.display()))
    })
}

/// Persist `ProjectConfig` to `path`, creating parent directories if needed.
pub fn save_project_config(path: &Path, config: &ProjectConfig) -> Result<(), SourceError> {
    if let Some(parent) = path.parent()
        && !parent.as_os_str().is_empty()
    {
        std::fs::create_dir_all(parent)
            .map_err(|err| SourceError::PermissionOrIo(format!("{}: {err}", parent.display())))?;
    }
    let toml_text = config
        .to_toml_string()
        .map_err(|err| SourceError::PermissionOrIo(format!("序列化配置失败: {err}")))?;
    std::fs::write(path, toml_text)
        .map_err(|err| SourceError::PermissionOrIo(format!("{}: {err}", path.display())))
}

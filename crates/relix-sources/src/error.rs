use thiserror::Error;

/// Errors produced when connecting to or reading metadata from a schema source.
#[derive(Debug, Error)]
pub enum SourceError {
    #[error("数据源文件不存在: {0}")]
    FileNotFound(String),

    #[error("无法打开数据源（权限不足或路径无效）: {0}")]
    PermissionOrIo(String),

    #[error("无法连接数据库: {0}")]
    ConnectionFailed(String),

    #[error("数据库查询失败: {0}")]
    QueryFailed(String),

    #[error("SQL 文件解析失败: {0}")]
    SqlParseFailed(String),

    #[error("数据源为空，未发现任何表或视图: {0}")]
    EmptySchema(String),

    #[error("不支持的数据源或连接串格式: {0}")]
    UnsupportedSource(String),
}

use std::path::Path;

use epibrhx_core::{Schema, parse_sql_schema};

use crate::error::SourceError;

/// Load schema metadata from a `.sql` DDL file.
pub fn load_sql_file(path: impl AsRef<Path>) -> Result<Schema, SourceError> {
    let path = path.as_ref();
    if !path.exists() {
        return Err(SourceError::FileNotFound(path.display().to_string()));
    }

    let sql = std::fs::read_to_string(path)
        .map_err(|err| SourceError::PermissionOrIo(format!("{}: {err}", path.display())))?;

    load_sql_str(&sql, "public")
}

/// Parse raw SQL DDL text into a [`Schema`] using `default_schema` for unqualified tables.
pub fn load_sql_str(sql: &str, default_schema: &str) -> Result<Schema, SourceError> {
    parse_sql_schema(sql, default_schema).map_err(|msg| {
        if msg.contains("为空") || msg.contains("未解析出任何表") {
            SourceError::EmptySchema(msg)
        } else {
            SourceError::SqlParseFailed(msg)
        }
    })
}

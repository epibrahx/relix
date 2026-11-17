//! Native schema loaders for SQLite, PostgreSQL, SQL DDL files, and `epibrhx.toml` persistence.

pub mod config;
pub mod error;
pub mod postgres;
pub mod sqlfile;
pub mod sqlite;

pub use config::{SchemaSourceKind, load_project_config, resolve_config_path, save_project_config};
pub use error::SourceError;
pub use postgres::{PostgresLoadOptions, load_postgres, load_postgres_with_options};
pub use sqlfile::{load_sql_file, load_sql_str};
pub use sqlite::{load_sqlite_connection, load_sqlite_file};

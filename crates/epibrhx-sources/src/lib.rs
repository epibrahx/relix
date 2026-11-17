//! Native schema loaders for SQLite, PostgreSQL, and SQL DDL files.

pub mod error;
pub mod sqlite;

pub use error::SourceError;
pub use sqlite::{load_sqlite_connection, load_sqlite_file};

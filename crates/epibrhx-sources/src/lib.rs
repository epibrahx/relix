//! Native schema loaders for SQLite, PostgreSQL, and SQL DDL files.

pub mod error;
pub mod postgres;
pub mod sqlfile;
pub mod sqlite;

pub use error::SourceError;
pub use postgres::{PostgresLoadOptions, load_postgres, load_postgres_with_options};
pub use sqlfile::{load_sql_file, load_sql_str};
pub use sqlite::{load_sqlite_connection, load_sqlite_file};

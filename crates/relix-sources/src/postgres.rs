use std::collections::{BTreeMap, HashMap};
use std::str::FromStr;
use std::sync::Arc;

use relix_core::{
    Column, Dialect, Index, Relation, Schema, Table, TableKind, normalize_type_family,
    redact_connection_url,
};
use rustls::RootCertStore;
use tokio_postgres::config::SslMode;
use tokio_postgres::{Client, NoTls};
use tokio_postgres_rustls::MakeRustlsConnect;

use crate::error::SourceError;

/// Options controlling PostgreSQL metadata extraction.
#[derive(Debug, Clone, Default)]
pub struct PostgresLoadOptions {
    /// If non-empty, only load tables/views from these schemas.
    /// Otherwise loads all non-system schemas (excluding `pg_catalog`, `information_schema`, `pg_toast*`, `pg_temp_*`).
    pub schemas: Vec<String>,
}

/// Load schema metadata from a PostgreSQL instance in strictly read-only mode.
///
/// Security invariants:
/// - Immediately executes `SET default_transaction_read_only = on` and wraps queries in `BEGIN READ ONLY`.
/// - Only queries `pg_catalog` and `information_schema`; never selects business table rows.
/// - All errors and logs use [`redact_connection_url`] so passwords never leak.
pub fn load_postgres(url: &str) -> Result<Schema, SourceError> {
    load_postgres_with_options(url, &PostgresLoadOptions::default())
}

/// Load PostgreSQL schema metadata with explicit schema filter options.
pub fn load_postgres_with_options(
    url: &str,
    options: &PostgresLoadOptions,
) -> Result<Schema, SourceError> {
    let redacted = redact_connection_url(url);
    tracing::debug!(source = %redacted, "connecting to PostgreSQL in read-only mode");

    let config = tokio_postgres::Config::from_str(url).map_err(|err| {
        SourceError::UnsupportedSource(format!("无法解析 PostgreSQL 连接串 ({redacted}): {err}"))
    })?;

    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_io()
        .enable_time()
        .build()
        .map_err(|err| SourceError::ConnectionFailed(format!("创建运行时失败: {err}")))?;

    rt.block_on(load_postgres_async(config, &redacted, options))
}

async fn load_postgres_async(
    config: tokio_postgres::Config,
    redacted_url: &str,
    options: &PostgresLoadOptions,
) -> Result<Schema, SourceError> {
    let client = connect_client(config, redacted_url).await?;

    // Enforce session-level read-only default and run introspection inside a READ ONLY transaction.
    client
        .batch_execute("SET default_transaction_read_only = on; BEGIN READ ONLY;")
        .await
        .map_err(|e| map_pg_error("无法开启只读事务", redacted_url, &e))?;

    let result = introspect_postgres(&client, redacted_url, options).await;

    // Best-effort close transaction cleanly.
    let _ = client.batch_execute("COMMIT;").await;
    result
}

async fn connect_client(
    config: tokio_postgres::Config,
    redacted_url: &str,
) -> Result<Client, SourceError> {
    if matches!(config.get_ssl_mode(), SslMode::Disable) {
        let (client, connection) = config
            .connect(NoTls)
            .await
            .map_err(|e| map_pg_error("连接失败", redacted_url, &e))?;
        tokio::spawn(async move {
            if let Err(err) = connection.await {
                tracing::warn!(error = %err, "postgres connection task ended with error");
            }
        });
        return Ok(client);
    }

    let mut roots = RootCertStore::empty();
    let cert_res = rustls_native_certs::load_native_certs();
    for cert in cert_res.certs {
        let _ = roots.add(cert);
    }

    let tls_config = rustls::ClientConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .map_err(|e| SourceError::ConnectionFailed(format!("TLS 配置失败 ({redacted_url}): {e}")))?
    .with_root_certificates(roots)
    .with_no_client_auth();

    let tls = MakeRustlsConnect::new(tls_config);
    let (client, connection) = config
        .connect(tls)
        .await
        .map_err(|e| map_pg_error("TLS 连接失败", redacted_url, &e))?;
    tokio::spawn(async move {
        if let Err(err) = connection.await {
            tracing::warn!(error = %err, "postgres TLS connection task ended with error");
        }
    });
    Ok(client)
}

async fn introspect_postgres(
    client: &Client,
    redacted_url: &str,
    options: &PostgresLoadOptions,
) -> Result<Schema, SourceError> {
    let mut schema = Schema::new(Dialect::Postgres);

    // 1. Read tables & views via pg_catalog + information_schema check (only system catalogs).
    let filter_schemas = !options.schemas.is_empty();
    let rel_rows = client
        .query(
            "SELECT c.oid, n.nspname, c.relname, c.relkind::text, \
                    pg_catalog.obj_description(c.oid, 'pg_class') AS comment \
             FROM pg_catalog.pg_class c \
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace \
             WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') \
               AND n.nspname NOT LIKE 'pg_toast%' \
               AND n.nspname NOT LIKE 'pg_temp_%' \
               AND c.relkind IN ('r', 'p', 'v', 'm') \
               AND ($1::bool = false OR n.nspname = ANY($2::text[])) \
             ORDER BY n.nspname, c.relname",
            &[&filter_schemas, &options.schemas],
        )
        .await
        .map_err(|e| map_pg_error("读取表清单失败", redacted_url, &e))?;

    if rel_rows.is_empty() {
        return Err(SourceError::EmptySchema(redacted_url.to_string()));
    }

    let mut oid_to_idx: HashMap<u32, usize> = HashMap::with_capacity(rel_rows.len());
    let mut oids: Vec<u32> = Vec::with_capacity(rel_rows.len());

    for row in rel_rows {
        let oid: u32 = row.get(0);
        let nspname: String = row.get(1);
        let relname: String = row.get(2);
        let relkind: String = row.get(3);
        let comment: Option<String> = row.get(4);

        let kind = match relkind.as_str() {
            "v" | "m" => TableKind::View,
            _ => TableKind::Table,
        };
        let id = format!("{nspname}.{relname}");
        let idx = schema.tables.len();
        oid_to_idx.insert(oid, idx);
        oids.push(oid);

        schema.tables.push(Table {
            id,
            schema: nspname,
            name: relname,
            kind,
            comment,
            columns: Vec::new(),
            primary_key: Vec::new(),
            unique_keys: Vec::new(),
            indexes: Vec::new(),
        });
    }

    // 2. Read columns (keeping attnum -> column name map per OID for constraint/index resolution).
    let mut attnum_map: HashMap<(u32, i16), String> = HashMap::new();
    let col_rows = client
        .query(
            "SELECT a.attrelid, a.attnum, a.attname, \
                    pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type, \
                    NOT a.attnotnull AS nullable, \
                    pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS default_expr, \
                    pg_catalog.col_description(a.attrelid, a.attnum) AS comment \
             FROM pg_catalog.pg_attribute a \
             LEFT JOIN pg_catalog.pg_attrdef d \
               ON d.adrelid = a.attrelid AND d.adnum = a.attnum \
             WHERE a.attrelid = ANY($1::oid[]) \
               AND a.attnum > 0 \
               AND NOT a.attisdropped \
             ORDER BY a.attrelid, a.attnum",
            &[&oids],
        )
        .await
        .map_err(|e| map_pg_error("读取字段信息失败", redacted_url, &e))?;

    for row in col_rows {
        let attrelid: u32 = row.get(0);
        let attnum: i16 = row.get(1);
        let name: String = row.get(2);
        let data_type: String = row.get(3);
        let nullable: bool = row.get(4);
        let default: Option<String> = row.get(5);
        let comment: Option<String> = row.get(6);

        attnum_map.insert((attrelid, attnum), name.clone());
        if let Some(&tbl_idx) = oid_to_idx.get(&attrelid) {
            let type_family = normalize_type_family(Dialect::Postgres, &data_type);
            schema.tables[tbl_idx].columns.push(Column {
                name,
                data_type,
                type_family,
                nullable,
                default,
                comment,
            });
        }
    }

    // 3. Read constraints (PK, UNIQUE, FK) from pg_constraint.
    let con_rows = client
        .query(
            "SELECT c.conrelid, c.contype::text, c.conkey, c.confrelid, c.confkey, c.conname \
             FROM pg_catalog.pg_constraint c \
             WHERE c.conrelid = ANY($1::oid[]) \
               AND c.contype IN ('p', 'u', 'f') \
             ORDER BY c.conrelid, c.conname",
            &[&oids],
        )
        .await
        .map_err(|e| map_pg_error("读取约束信息失败", redacted_url, &e))?;

    for row in con_rows {
        let conrelid: u32 = row.get(0);
        let contype: String = row.get(1);
        let conkey: Option<Vec<i16>> = row.get(2);
        let confrelid: u32 = row.get(3);
        let confkey: Option<Vec<i16>> = row.get(4);
        let conname: String = row.get(5);

        let Some(&tbl_idx) = oid_to_idx.get(&conrelid) else {
            continue;
        };
        let keys = conkey.unwrap_or_default();
        let col_names: Vec<String> = keys
            .iter()
            .filter_map(|&num| attnum_map.get(&(conrelid, num)).cloned())
            .collect();

        if col_names.len() != keys.len() || col_names.is_empty() {
            schema.warnings.push(format!(
                "表 {} 的约束 {conname} 包含无法解析的列，已跳过",
                schema.tables[tbl_idx].id
            ));
            continue;
        }

        match contype.as_str() {
            "p" => {
                schema.tables[tbl_idx].primary_key = col_names;
            }
            "u" => {
                if !schema.tables[tbl_idx].unique_keys.contains(&col_names) {
                    schema.tables[tbl_idx].unique_keys.push(col_names);
                }
            }
            "f" => {
                let Some(&target_idx) = oid_to_idx.get(&confrelid) else {
                    schema.warnings.push(format!(
                        "表 {} 的外键 {conname} 指向范围之外的表 (oid={confrelid})，已跳过",
                        schema.tables[tbl_idx].id
                    ));
                    continue;
                };
                let fkeys = confkey.unwrap_or_default();
                let to_cols: Vec<String> = fkeys
                    .iter()
                    .filter_map(|&num| attnum_map.get(&(confrelid, num)).cloned())
                    .collect();
                if to_cols.len() != col_names.len() {
                    schema.warnings.push(format!(
                        "表 {} 的外键 {conname} 目标列无法匹配，已跳过",
                        schema.tables[tbl_idx].id
                    ));
                    continue;
                }
                let from_id = schema.tables[tbl_idx].id.clone();
                let to_id = schema.tables[target_idx].id.clone();
                schema
                    .relations
                    .push(Relation::declared(from_id, col_names, to_id, to_cols));
            }
            _ => {}
        }
    }

    // 4. Read explicit indexes (excluding PK/UNIQUE constraint-backing indexes).
    let idx_rows = client
        .query(
            "SELECT i.indrelid, ic.relname, i.indisunique, i.indkey::int2[], \
                    (i.indpred IS NOT NULL) AS is_partial, \
                    EXISTS (SELECT 1 FROM pg_catalog.pg_constraint con WHERE con.conindid = i.indexrelid) AS is_constraint \
             FROM pg_catalog.pg_index i \
             JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid \
             WHERE i.indrelid = ANY($1::oid[]) \
               AND NOT i.indisprimary \
             ORDER BY i.indrelid, ic.relname",
            &[&oids],
        )
        .await
        .map_err(|e| map_pg_error("读取索引信息失败", redacted_url, &e))?;

    let mut per_table_indexes: BTreeMap<usize, Vec<Index>> = BTreeMap::new();
    for row in idx_rows {
        let indrelid: u32 = row.get(0);
        let idx_name: String = row.get(1);
        let is_unique: bool = row.get(2);
        let indkey: Vec<i16> = row.get(3);
        let is_partial: bool = row.get(4);
        let is_constraint: bool = row.get(5);

        let Some(&tbl_idx) = oid_to_idx.get(&indrelid) else {
            continue;
        };
        if indkey.contains(&0) {
            if !is_constraint {
                schema.warnings.push(format!(
                    "表 {} 的索引 {idx_name} 为表达式索引，MVP 暂忽略",
                    schema.tables[tbl_idx].id
                ));
            }
            continue;
        }
        let cols: Vec<String> = indkey
            .iter()
            .filter_map(|&num| attnum_map.get(&(indrelid, num)).cloned())
            .collect();
        if cols.len() != indkey.len() || cols.is_empty() {
            continue;
        }

        if is_unique && !is_partial && !schema.tables[tbl_idx].unique_keys.contains(&cols) {
            schema.tables[tbl_idx].unique_keys.push(cols.clone());
        }

        if !is_constraint {
            per_table_indexes.entry(tbl_idx).or_default().push(Index {
                name: idx_name,
                columns: cols,
                unique: is_unique,
            });
        }
    }

    for (tbl_idx, idxs) in per_table_indexes {
        schema.tables[tbl_idx].indexes = idxs;
    }

    // Check information_schema accessibility note if any tables lacked columns due to restrictive grants.
    if let Err(err) = client
        .query_one(
            "SELECT count(*) FROM information_schema.tables LIMIT 1",
            &[],
        )
        .await
    {
        schema
            .warnings
            .push(format!("部分 information_schema 视图访问受限: {}", err));
    }

    for tbl in &mut schema.tables {
        tbl.unique_keys.sort();
        tbl.unique_keys.dedup();
        tbl.indexes.sort_by(|a, b| a.name.cmp(&b.name));
    }
    schema.tables.sort_by(|a, b| a.id.cmp(&b.id));
    schema.relations.sort_by(|a, b| a.id.cmp(&b.id));
    schema.relations.dedup_by(|a, b| a.id == b.id);
    schema.warnings.sort();
    schema.warnings.dedup();

    Ok(schema)
}

fn map_pg_error(context: &str, redacted_url: &str, err: &tokio_postgres::Error) -> SourceError {
    if let Some(db_err) = err.as_db_error() {
        let code = db_err.code().code();
        if code == "42501" || code == "28P01" || code == "28000" {
            return SourceError::PermissionOrIo(format!(
                "{context} ({redacted_url}): 权限不足或认证失败 — {}",
                db_err.message()
            ));
        }
        return SourceError::QueryFailed(format!(
            "{context} ({redacted_url}): [{}] {}",
            code,
            db_err.message()
        ));
    }
    SourceError::ConnectionFailed(format!("{context} ({redacted_url}): {err}"))
}

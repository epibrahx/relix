use std::collections::BTreeMap;
use std::path::Path;

use relix_core::{
    Column, Dialect, Index, Relation, Schema, Table, TableKind, normalize_type_family,
};
use rusqlite::{Connection, OpenFlags};

use crate::error::SourceError;

/// Load schema metadata from a SQLite database file in strictly read-only mode.
///
/// Only queries `sqlite_master` / `PRAGMA` system metadata; never reads business table rows.
pub fn load_sqlite_file(path: impl AsRef<Path>) -> Result<Schema, SourceError> {
    let path = path.as_ref();
    if !path.exists() {
        return Err(SourceError::FileNotFound(path.display().to_string()));
    }

    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let conn = Connection::open_with_flags(path, flags).map_err(|err| {
        let msg = err.to_string();
        if msg.contains("Permission denied") || msg.contains("unable to open database file") {
            SourceError::PermissionOrIo(format!("{}: {msg}", path.display()))
        } else {
            SourceError::ConnectionFailed(format!("{}: {msg}", path.display()))
        }
    })?;

    load_sqlite_connection(&conn, &path.display().to_string())
}

/// Load schema metadata from an already-opened SQLite [`Connection`].
///
/// Enforces `PRAGMA query_only = ON` and only inspects `sqlite_master` and `PRAGMA` tables.
pub fn load_sqlite_connection(conn: &Connection, label: &str) -> Result<Schema, SourceError> {
    conn.pragma_update(None, "query_only", "ON")
        .map_err(|e| SourceError::QueryFailed(format!("failed to enable query_only: {e}")))?;

    let mut schema = Schema::new(Dialect::Sqlite);

    // Query sqlite_master instead of PRAGMA table_list so we capture views and exclude internal tables reliably.
    let objects = read_sqlite_objects(conn)?;
    if objects.is_empty() {
        return Err(SourceError::EmptySchema(label.to_string()));
    }

    let mut pending_fks: Vec<PendingFk> = Vec::new();
    let mut table_pks: BTreeMap<String, Vec<String>> = BTreeMap::new();

    for (obj_name, kind) in objects {
        let table_id = format!("main.{obj_name}");
        let (columns, primary_key) = read_columns_and_pk(conn, &obj_name)?;

        let mut unique_keys: Vec<Vec<String>> = Vec::new();
        let mut indexes: Vec<Index> = Vec::new();

        if kind == TableKind::Table {
            let (uqs, idxs, idx_warnings) = read_indexes(conn, &obj_name)?;
            unique_keys = uqs;
            indexes = idxs;
            schema.warnings.extend(idx_warnings);

            let mut fks = read_foreign_keys(conn, &table_id, &obj_name)?;
            pending_fks.append(&mut fks);
        }

        table_pks.insert(table_id.clone(), primary_key.clone());

        schema.tables.push(Table {
            id: table_id,
            schema: "main".to_string(),
            name: obj_name,
            kind,
            comment: None,
            columns,
            primary_key,
            unique_keys,
            indexes,
        });
    }

    for fk in pending_fks {
        let to_table_id = format!("main.{}", fk.to_table_name);
        let mut to_columns = Vec::with_capacity(fk.pairs.len());
        let mut unresolved = false;

        for (seq, (_from_col, maybe_to_col)) in fk.pairs.iter().enumerate() {
            if let Some(to_col) = maybe_to_col {
                to_columns.push(to_col.clone());
            } else if let Some(pk) = table_pks.get(&to_table_id).and_then(|pk| pk.get(seq)) {
                to_columns.push(pk.clone());
            } else {
                unresolved = true;
                break;
            }
        }

        if unresolved {
            schema.warnings.push(format!(
                "表 {} 的外键指向 {} 但无法解析目标主键列，已跳过",
                fk.from_table_id, to_table_id
            ));
            continue;
        }

        let from_columns: Vec<String> = fk.pairs.into_iter().map(|(c, _)| c).collect();
        schema.relations.push(Relation::declared(
            fk.from_table_id,
            from_columns,
            to_table_id,
            to_columns,
        ));
    }

    schema.tables.sort_by(|a, b| a.id.cmp(&b.id));
    schema.relations.sort_by(|a, b| a.id.cmp(&b.id));
    schema.warnings.sort();
    schema.warnings.dedup();

    Ok(schema)
}

fn read_sqlite_objects(conn: &Connection) -> Result<Vec<(String, TableKind)>, SourceError> {
    let mut stmt = conn
        .prepare(
            "SELECT name, type FROM sqlite_master \
             WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' \
             ORDER BY name ASC",
        )
        .map_err(|e| SourceError::QueryFailed(format!("sqlite_master query failed: {e}")))?;

    let rows = stmt
        .query_map([], |row| {
            let name: String = row.get(0)?;
            let kind_str: String = row.get(1)?;
            let kind = if kind_str.eq_ignore_ascii_case("view") {
                TableKind::View
            } else {
                TableKind::Table
            };
            Ok((name, kind))
        })
        .map_err(|e| SourceError::QueryFailed(format!("sqlite_master read failed: {e}")))?;

    let mut objects = Vec::new();
    for row in rows {
        objects.push(row.map_err(|e| SourceError::QueryFailed(e.to_string()))?);
    }
    Ok(objects)
}

fn read_columns_and_pk(
    conn: &Connection,
    table_name: &str,
) -> Result<(Vec<Column>, Vec<String>), SourceError> {
    let sql = format!("PRAGMA main.table_info({})", quote_ident(table_name));
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| SourceError::QueryFailed(format!("PRAGMA table_info({table_name}): {e}")))?;

    let rows = stmt
        .query_map([], |row| {
            let name: String = row.get(1)?;
            let raw_type: String = row.get(2)?;
            let notnull: i64 = row.get(3)?;
            let default: Option<String> = row.get(4)?;
            let pk_pos: i64 = row.get(5)?;
            Ok((name, raw_type, notnull, default, pk_pos))
        })
        .map_err(|e| SourceError::QueryFailed(format!("table_info({table_name}): {e}")))?;

    let mut columns = Vec::new();
    let mut pk_entries: Vec<(i64, String)> = Vec::new();

    for row in rows {
        let (name, raw_type, notnull, default, pk_pos) =
            row.map_err(|e| SourceError::QueryFailed(e.to_string()))?;
        if pk_pos > 0 {
            pk_entries.push((pk_pos, name.clone()));
        }
        let type_family = normalize_type_family(Dialect::Sqlite, &raw_type);
        // Primary key columns are non-nullable across dialects for cross-loader equivalence.
        let nullable = notnull == 0 && pk_pos == 0;
        columns.push(Column {
            name,
            data_type: raw_type,
            type_family,
            nullable,
            default,
            comment: None,
        });
    }

    pk_entries.sort_by_key(|(pos, _)| *pos);
    let primary_key = pk_entries.into_iter().map(|(_, col)| col).collect();

    Ok((columns, primary_key))
}

type IndexQueryResult = (Vec<Vec<String>>, Vec<Index>, Vec<String>);

fn read_indexes(conn: &Connection, table_name: &str) -> Result<IndexQueryResult, SourceError> {
    let sql = format!("PRAGMA main.index_list({})", quote_ident(table_name));
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| SourceError::QueryFailed(format!("PRAGMA index_list({table_name}): {e}")))?;

    let rows = stmt
        .query_map([], |row| {
            let name: String = row.get(1)?;
            let unique: i64 = row.get(2)?;
            let origin: String = row.get(3)?;
            let partial: i64 = row.get(4)?;
            Ok((name, unique != 0, origin, partial != 0))
        })
        .map_err(|e| SourceError::QueryFailed(format!("index_list({table_name}): {e}")))?;

    let mut index_meta = Vec::new();
    for row in rows {
        index_meta.push(row.map_err(|e| SourceError::QueryFailed(e.to_string()))?);
    }

    let mut unique_keys: Vec<Vec<String>> = Vec::new();
    let mut indexes: Vec<Index> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();

    for (idx_name, is_unique, origin, is_partial) in index_meta {
        let cols = read_index_columns(conn, &idx_name)?;
        if cols.is_empty() {
            if origin == "c" {
                warnings.push(format!(
                    "表 {table_name} 的索引 {idx_name} 为表达式索引，MVP 暂忽略"
                ));
            }
            continue;
        }

        if is_unique && origin != "pk" && !is_partial && !unique_keys.contains(&cols) {
            unique_keys.push(cols.clone());
        }

        if origin == "c" {
            indexes.push(Index {
                name: idx_name,
                columns: cols,
                unique: is_unique,
            });
        }
    }

    unique_keys.sort();
    indexes.sort_by(|a, b| a.name.cmp(&b.name));

    Ok((unique_keys, indexes, warnings))
}

fn read_index_columns(conn: &Connection, index_name: &str) -> Result<Vec<String>, SourceError> {
    let sql = format!("PRAGMA main.index_info({})", quote_ident(index_name));
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| SourceError::QueryFailed(format!("PRAGMA index_info({index_name}): {e}")))?;

    let rows = stmt
        .query_map([], |row| {
            let seqno: i64 = row.get(0)?;
            let name: Option<String> = row.get(2)?;
            Ok((seqno, name))
        })
        .map_err(|e| SourceError::QueryFailed(format!("index_info({index_name}): {e}")))?;

    let mut entries: Vec<(i64, String)> = Vec::new();
    for row in rows {
        let (seqno, maybe_name) = row.map_err(|e| SourceError::QueryFailed(e.to_string()))?;
        if let Some(name) = maybe_name {
            entries.push((seqno, name));
        } else {
            // Expression index column has NULL name; skip entire index as non-column key.
            return Ok(Vec::new());
        }
    }

    entries.sort_by_key(|(seqno, _)| *seqno);
    Ok(entries.into_iter().map(|(_, col)| col).collect())
}

struct PendingFk {
    from_table_id: String,
    to_table_name: String,
    pairs: Vec<(String, Option<String>)>,
}

fn read_foreign_keys(
    conn: &Connection,
    from_table_id: &str,
    table_name: &str,
) -> Result<Vec<PendingFk>, SourceError> {
    let sql = format!("PRAGMA main.foreign_key_list({})", quote_ident(table_name));
    let mut stmt = conn.prepare(&sql).map_err(|e| {
        SourceError::QueryFailed(format!("PRAGMA foreign_key_list({table_name}): {e}"))
    })?;

    let rows = stmt
        .query_map([], |row| {
            let fk_id: i64 = row.get(0)?;
            let seq: i64 = row.get(1)?;
            let to_table: String = row.get(2)?;
            let from_col: String = row.get(3)?;
            let to_col: Option<String> = row.get(4)?;
            Ok((fk_id, seq, to_table, from_col, to_col))
        })
        .map_err(|e| SourceError::QueryFailed(format!("foreign_key_list({table_name}): {e}")))?;

    type FkGroup = (String, Vec<(i64, String, Option<String>)>);
    let mut grouped: BTreeMap<i64, FkGroup> = BTreeMap::new();

    for row in rows {
        let (fk_id, seq, to_table, from_col, to_col) =
            row.map_err(|e| SourceError::QueryFailed(e.to_string()))?;
        let entry = grouped
            .entry(fk_id)
            .or_insert_with(|| (to_table, Vec::new()));
        entry.1.push((seq, from_col, to_col));
    }

    let mut out = Vec::with_capacity(grouped.len());
    for (_fk_id, (to_table_name, mut cols)) in grouped {
        cols.sort_by_key(|(seq, _, _)| *seq);
        let pairs = cols.into_iter().map(|(_, f, t)| (f, t)).collect();
        out.push(PendingFk {
            from_table_id: from_table_id.to_string(),
            to_table_name,
            pairs,
        });
    }

    Ok(out)
}

fn quote_ident(ident: &str) -> String {
    format!("\"{}\"", ident.replace('"', "\"\""))
}

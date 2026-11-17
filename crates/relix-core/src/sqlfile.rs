use std::collections::BTreeMap;

use sqlparser::ast::{
    AlterTableOperation, ColumnOption, CommentObject, CreateIndex, CreateTable, Expr, ObjectName,
    SelectItem, SetExpr, Statement, TableConstraint, TableFactor,
};
use sqlparser::dialect::{GenericDialect, PostgreSqlDialect, SQLiteDialect};
use sqlparser::parser::Parser;

use crate::model::{
    Column, Dialect, Index, Relation, Schema, Table, TableKind, TypeFamily, normalize_type_family,
};

/// Parse SQL DDL text (`schema.sql`) into a unified [`Schema`].
///
/// Unqualified tables are placed in `default_schema` (typically `"public"` or `"main"`).
/// Unrecognized or non-DDL statements are recorded in `schema.warnings` without aborting.
pub fn parse_sql_schema(sql: &str, default_schema: &str) -> Result<Schema, String> {
    if sql.trim().is_empty() {
        return Err("SQL 文件内容为空".to_string());
    }

    let mut state = BuilderState::new(default_schema);
    let statements = split_sql_statements(sql);

    for stmt_sql in statements {
        let trimmed = stmt_sql.trim();
        if trimmed.is_empty() {
            continue;
        }
        match parse_single_statement(trimmed) {
            Ok(parsed) => {
                for stmt in parsed {
                    state.apply_statement(stmt);
                }
            }
            Err(err) => {
                let preview = truncate_preview(trimmed, 72);
                state
                    .warnings
                    .push(format!("无法解析 SQL 语句（已跳过）: `{preview}` — {err}"));
            }
        }
    }

    if state.tables.is_empty() {
        return Err("SQL 文件中未解析出任何表或视图".to_string());
    }

    Ok(state.into_schema())
}

fn parse_single_statement(stmt_sql: &str) -> Result<Vec<Statement>, String> {
    if let Ok(stmts) = Parser::parse_sql(&PostgreSqlDialect {}, stmt_sql) {
        return Ok(stmts);
    }
    if let Ok(stmts) = Parser::parse_sql(&SQLiteDialect {}, stmt_sql) {
        return Ok(stmts);
    }
    Parser::parse_sql(&GenericDialect {}, stmt_sql).map_err(|e| e.to_string())
}

struct BuilderState {
    default_schema: String,
    tables: BTreeMap<String, Table>,
    relations: Vec<Relation>,
    warnings: Vec<String>,
}

impl BuilderState {
    fn new(default_schema: &str) -> Self {
        Self {
            default_schema: default_schema.to_string(),
            tables: BTreeMap::new(),
            relations: Vec::new(),
            warnings: Vec::new(),
        }
    }

    fn resolve_object_name(&self, name: &ObjectName) -> (String, String, String) {
        let parts: Vec<String> = name.0.iter().map(|i| i.value.clone()).collect();
        match parts.as_slice() {
            [tbl] => {
                let schema = self.default_schema.clone();
                (format!("{schema}.{tbl}"), schema, tbl.clone())
            }
            [schema, tbl] => (format!("{schema}.{tbl}"), schema.clone(), tbl.clone()),
            [.., schema, tbl] => (format!("{schema}.{tbl}"), schema.clone(), tbl.clone()),
            [] => (
                format!("{}.unknown", self.default_schema),
                self.default_schema.clone(),
                "unknown".to_string(),
            ),
        }
    }

    fn apply_statement(&mut self, stmt: Statement) {
        match stmt {
            Statement::CreateTable(ct) => self.handle_create_table(ct),
            Statement::AlterTable {
                name, operations, ..
            } => self.handle_alter_table(name, operations),
            Statement::CreateIndex(ci) => self.handle_create_index(ci),
            Statement::CreateView {
                name,
                columns,
                query,
                comment,
                ..
            } => self.handle_create_view(name, columns, query, comment),
            Statement::Comment {
                object_type,
                object_name,
                comment,
                ..
            } => self.handle_comment(object_type, object_name, comment),
            other => {
                let label = truncate_preview(&other.to_string(), 64);
                self.warnings
                    .push(format!("已忽略非结构/暂不支持的语句: `{label}`"));
            }
        }
    }

    fn handle_create_table(&mut self, ct: CreateTable) {
        let (table_id, schema_name, table_name) = self.resolve_object_name(&ct.name);
        let mut columns = Vec::with_capacity(ct.columns.len());
        let mut primary_key: Vec<String> = Vec::new();
        let mut unique_keys: Vec<Vec<String>> = Vec::new();
        let mut pending_fks: Vec<(Vec<String>, ObjectName, Vec<String>)> = Vec::new();

        for col_def in ct.columns {
            let col_name = col_def.name.value.clone();
            let raw_type = col_def.data_type.to_string();
            let type_family = normalize_type_family(Dialect::Sqlfile, &raw_type);

            let mut not_null = false;
            let mut is_pk = false;
            let mut is_unique = false;
            let mut default = None;
            let mut comment = None;

            for opt_def in col_def.options {
                match opt_def.option {
                    ColumnOption::NotNull => not_null = true,
                    ColumnOption::Null => not_null = false,
                    ColumnOption::Default(expr) => default = Some(expr.to_string()),
                    ColumnOption::Comment(c) => comment = Some(c),
                    ColumnOption::Unique { is_primary, .. } => {
                        if is_primary {
                            is_pk = true;
                        } else {
                            is_unique = true;
                        }
                    }
                    ColumnOption::ForeignKey {
                        foreign_table,
                        referred_columns,
                        ..
                    } => {
                        let to_cols: Vec<String> =
                            referred_columns.into_iter().map(|i| i.value).collect();
                        pending_fks.push((vec![col_name.clone()], foreign_table, to_cols));
                    }
                    _ => {}
                }
            }

            if is_pk && !primary_key.contains(&col_name) {
                primary_key.push(col_name.clone());
            }
            if is_unique {
                unique_keys.push(vec![col_name.clone()]);
            }

            columns.push(Column {
                name: col_name,
                data_type: raw_type,
                type_family,
                nullable: !not_null && !is_pk,
                default,
                comment,
            });
        }

        for constraint in ct.constraints {
            self.apply_table_constraint(
                &table_id,
                &mut columns,
                &mut primary_key,
                &mut unique_keys,
                &mut pending_fks,
                constraint,
            );
        }

        let table_comment = ct.comment.map(|c| c.to_string());
        self.tables.insert(
            table_id.clone(),
            Table {
                id: table_id.clone(),
                schema: schema_name,
                name: table_name,
                kind: TableKind::Table,
                comment: table_comment,
                columns,
                primary_key,
                unique_keys,
                indexes: Vec::new(),
            },
        );

        for (from_cols, foreign_table, to_cols) in pending_fks {
            self.add_foreign_key(&table_id, from_cols, &foreign_table, to_cols);
        }
    }

    fn apply_table_constraint(
        &mut self,
        table_id: &str,
        columns: &mut [Column],
        primary_key: &mut Vec<String>,
        unique_keys: &mut Vec<Vec<String>>,
        pending_fks: &mut Vec<(Vec<String>, ObjectName, Vec<String>)>,
        constraint: TableConstraint,
    ) {
        match constraint {
            TableConstraint::PrimaryKey {
                columns: pk_cols, ..
            } => {
                let names: Vec<String> = pk_cols.into_iter().map(|c| c.value).collect();
                for name in &names {
                    if let Some(col) = columns.iter_mut().find(|c| &c.name == name) {
                        col.nullable = false;
                    }
                }
                *primary_key = names;
            }
            TableConstraint::Unique {
                columns: uq_cols, ..
            } => {
                let names: Vec<String> = uq_cols.into_iter().map(|c| c.value).collect();
                if !names.is_empty() && !unique_keys.contains(&names) {
                    unique_keys.push(names);
                }
            }
            TableConstraint::ForeignKey {
                columns: fk_cols,
                foreign_table,
                referred_columns,
                ..
            } => {
                let from_cols: Vec<String> = fk_cols.into_iter().map(|c| c.value).collect();
                let to_cols: Vec<String> = referred_columns.into_iter().map(|c| c.value).collect();
                pending_fks.push((from_cols, foreign_table, to_cols));
            }
            _ => {
                self.warnings.push(format!(
                    "表 {table_id} 的部分约束（如 CHECK/EXCLUDE）已跳过"
                ));
            }
        }
    }

    fn handle_alter_table(&mut self, name: ObjectName, operations: Vec<AlterTableOperation>) {
        let (table_id, _, _) = self.resolve_object_name(&name);
        for op in operations {
            match op {
                AlterTableOperation::AddConstraint(constraint) => {
                    let Some(table) = self.tables.get_mut(&table_id) else {
                        self.warnings
                            .push(format!("ALTER TABLE 引用了未定义的表 {table_id}"));
                        continue;
                    };
                    let mut pending_fks = Vec::new();
                    let mut columns = std::mem::take(&mut table.columns);
                    let mut pk = std::mem::take(&mut table.primary_key);
                    let mut uq = std::mem::take(&mut table.unique_keys);

                    self.apply_table_constraint(
                        &table_id,
                        &mut columns,
                        &mut pk,
                        &mut uq,
                        &mut pending_fks,
                        constraint,
                    );

                    if let Some(table) = self.tables.get_mut(&table_id) {
                        table.columns = columns;
                        table.primary_key = pk;
                        table.unique_keys = uq;
                    }
                    for (from_cols, foreign_table, to_cols) in pending_fks {
                        self.add_foreign_key(&table_id, from_cols, &foreign_table, to_cols);
                    }
                }
                AlterTableOperation::AddColumn { column_def, .. } => {
                    if let Some(table) = self.tables.get_mut(&table_id) {
                        let col_name = column_def.name.value.clone();
                        let raw_type = column_def.data_type.to_string();
                        let type_family = normalize_type_family(Dialect::Sqlfile, &raw_type);
                        let not_null = column_def
                            .options
                            .iter()
                            .any(|o| matches!(o.option, ColumnOption::NotNull));
                        table.columns.push(Column {
                            name: col_name,
                            data_type: raw_type,
                            type_family,
                            nullable: !not_null,
                            default: None,
                            comment: None,
                        });
                    } else {
                        self.warnings.push(format!(
                            "ALTER TABLE ADD COLUMN 引用了未定义的表 {table_id}"
                        ));
                    }
                }
                _ => {
                    self.warnings
                        .push(format!("表 {table_id} 的部分 ALTER TABLE 操作已跳过"));
                }
            }
        }
    }

    fn handle_create_index(&mut self, ci: CreateIndex) {
        let (table_id, _, _) = self.resolve_object_name(&ci.table_name);
        let idx_name = ci
            .name
            .as_ref()
            .map(|n| n.0.last().map(|i| i.value.clone()).unwrap_or_default())
            .unwrap_or_else(|| "unnamed_index".to_string());

        let mut cols = Vec::with_capacity(ci.columns.len());
        for order_expr in ci.columns {
            match order_expr.expr {
                Expr::Identifier(ident) => cols.push(ident.value),
                Expr::CompoundIdentifier(idents) => {
                    if let Some(last) = idents.last() {
                        cols.push(last.value.clone());
                    }
                }
                _ => {
                    self.warnings.push(format!(
                        "表 {table_id} 的索引 {idx_name} 为表达式索引，MVP 暂忽略"
                    ));
                    return;
                }
            }
        }

        let Some(table) = self.tables.get_mut(&table_id) else {
            self.warnings
                .push(format!("CREATE INDEX 引用了未定义的表 {table_id}"));
            return;
        };

        if ci.unique
            && ci.predicate.is_none()
            && !cols.is_empty()
            && !table.unique_keys.contains(&cols)
        {
            table.unique_keys.push(cols.clone());
        }

        table.indexes.push(Index {
            name: idx_name,
            columns: cols,
            unique: ci.unique,
        });
    }

    fn handle_create_view(
        &mut self,
        name: ObjectName,
        explicit_cols: Vec<sqlparser::ast::ViewColumnDef>,
        query: Box<sqlparser::ast::Query>,
        comment: Option<String>,
    ) {
        let (view_id, schema_name, view_name) = self.resolve_object_name(&name);
        let mut columns = Vec::new();

        if !explicit_cols.is_empty() {
            for col in explicit_cols {
                columns.push(Column {
                    name: col.name.value,
                    data_type: String::new(),
                    type_family: TypeFamily::Other,
                    nullable: true,
                    default: None,
                    comment: None,
                });
            }
        } else if let SetExpr::Select(select) = query.body.as_ref() {
            // Best-effort resolve simple `SELECT col` or `SELECT alias.col` projections from known tables.
            let mut alias_to_table: BTreeMap<String, String> = BTreeMap::new();
            for tbl_join in &select.from {
                if let TableFactor::Table { name, alias, .. } = &tbl_join.relation {
                    let (tid, _, tname) = self.resolve_object_name(name);
                    alias_to_table.insert(tname, tid.clone());
                    if let Some(a) = alias {
                        alias_to_table.insert(a.name.value.clone(), tid);
                    }
                }
            }

            for item in &select.projection {
                match item {
                    SelectItem::UnnamedExpr(Expr::Identifier(ident)) => {
                        let col_name = ident.value.clone();
                        let (dt, tf) = self.lookup_view_col(&alias_to_table, None, &col_name);
                        columns.push(Column {
                            name: col_name,
                            data_type: dt,
                            type_family: tf,
                            nullable: true,
                            default: None,
                            comment: None,
                        });
                    }
                    SelectItem::UnnamedExpr(Expr::CompoundIdentifier(parts))
                        if parts.len() == 2 =>
                    {
                        let alias_name = &parts[0].value;
                        let col_name = parts[1].value.clone();
                        let (dt, tf) =
                            self.lookup_view_col(&alias_to_table, Some(alias_name), &col_name);
                        columns.push(Column {
                            name: col_name,
                            data_type: dt,
                            type_family: tf,
                            nullable: true,
                            default: None,
                            comment: None,
                        });
                    }
                    SelectItem::ExprWithAlias { alias, .. } => {
                        columns.push(Column {
                            name: alias.value.clone(),
                            data_type: String::new(),
                            type_family: TypeFamily::Other,
                            nullable: true,
                            default: None,
                            comment: None,
                        });
                    }
                    _ => {}
                }
            }
        }

        self.tables.insert(
            view_id.clone(),
            Table {
                id: view_id,
                schema: schema_name,
                name: view_name,
                kind: TableKind::View,
                comment,
                columns,
                primary_key: Vec::new(),
                unique_keys: Vec::new(),
                indexes: Vec::new(),
            },
        );
    }

    fn lookup_view_col(
        &self,
        alias_to_table: &BTreeMap<String, String>,
        alias: Option<&str>,
        col_name: &str,
    ) -> (String, TypeFamily) {
        if let Some(a) = alias {
            if let Some(tid) = alias_to_table.get(a)
                && let Some(tbl) = self.tables.get(tid)
                && let Some(col) = tbl.columns.iter().find(|c| c.name == col_name)
            {
                return (col.data_type.clone(), col.type_family);
            }
        } else {
            for tid in alias_to_table.values() {
                if let Some(tbl) = self.tables.get(tid)
                    && let Some(col) = tbl.columns.iter().find(|c| c.name == col_name)
                {
                    return (col.data_type.clone(), col.type_family);
                }
            }
        }
        (String::new(), TypeFamily::Other)
    }

    fn handle_comment(
        &mut self,
        object_type: CommentObject,
        object_name: ObjectName,
        comment: Option<String>,
    ) {
        let parts: Vec<String> = object_name.0.iter().map(|i| i.value.clone()).collect();
        match object_type {
            CommentObject::Table => {
                let (table_id, _, _) = self.resolve_object_name(&object_name);
                if let Some(table) = self.tables.get_mut(&table_id) {
                    table.comment = comment;
                } else {
                    self.warnings
                        .push(format!("COMMENT ON TABLE 引用了未定义的表 {table_id}"));
                }
            }
            CommentObject::Column => {
                let (table_id, col_name) = match parts.as_slice() {
                    [tbl, col] => (format!("{}.{tbl}", self.default_schema), col.clone()),
                    [schema, tbl, col] => (format!("{schema}.{tbl}"), col.clone()),
                    _ => {
                        self.warnings
                            .push(format!("无法识别的 COMMENT ON COLUMN 目标: {object_name}"));
                        return;
                    }
                };
                if let Some(table) = self.tables.get_mut(&table_id) {
                    if let Some(col) = table.columns.iter_mut().find(|c| c.name == col_name) {
                        col.comment = comment;
                    } else {
                        self.warnings
                            .push(format!("COMMENT ON COLUMN 未找到列 {table_id}.{col_name}"));
                    }
                } else {
                    self.warnings
                        .push(format!("COMMENT ON COLUMN 引用了未定义的表 {table_id}"));
                }
            }
            _ => {
                self.warnings
                    .push(format!("已忽略不支持的 COMMENT ON {object_type}"));
            }
        }
    }

    fn add_foreign_key(
        &mut self,
        from_table_id: &str,
        from_cols: Vec<String>,
        foreign_table: &ObjectName,
        mut to_cols: Vec<String>,
    ) {
        let (to_table_id, _, _) = self.resolve_object_name(foreign_table);
        if to_cols.is_empty()
            && let Some(target_tbl) = self.tables.get(&to_table_id)
        {
            to_cols = target_tbl.primary_key.clone();
        }
        if from_cols.is_empty() || to_cols.is_empty() || from_cols.len() != to_cols.len() {
            self.warnings.push(format!(
                "表 {from_table_id} 指向 {to_table_id} 的外键列无法匹配，已跳过"
            ));
            return;
        }
        self.relations.push(Relation::declared(
            from_table_id,
            from_cols,
            to_table_id,
            to_cols,
        ));
    }

    fn into_schema(mut self) -> Schema {
        let mut tables: Vec<Table> = self.tables.into_values().collect();
        for tbl in &mut tables {
            tbl.unique_keys.sort();
            tbl.unique_keys.dedup();
            tbl.indexes.sort_by(|a, b| a.name.cmp(&b.name));
        }
        tables.sort_by(|a, b| a.id.cmp(&b.id));
        self.relations.sort_by(|a, b| a.id.cmp(&b.id));
        self.relations.dedup_by(|a, b| a.id == b.id);
        self.warnings.sort();
        self.warnings.dedup();

        Schema {
            dialect: Dialect::Sqlfile,
            tables,
            relations: self.relations,
            warnings: self.warnings,
        }
    }
}

/// Split SQL text into top-level semicolon-terminated statements, respecting strings,
/// quoted identifiers, `--` line comments, `/* */` block comments, and Postgres `$$...$$` blocks.
fn split_sql_statements(sql: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let bytes = sql.as_bytes();
    let mut i = 0;

    while i < bytes.len() {
        let b = bytes[i];
        // Line comment --
        if b == b'-' && i + 1 < bytes.len() && bytes[i + 1] == b'-' {
            while i < bytes.len() && bytes[i] != b'\n' {
                cur.push(bytes[i] as char);
                i += 1;
            }
            continue;
        }
        // Block comment /* ... */
        if b == b'/' && i + 1 < bytes.len() && bytes[i + 1] == b'*' {
            cur.push_str("/*");
            i += 2;
            while i < bytes.len() {
                if bytes[i] == b'*' && i + 1 < bytes.len() && bytes[i + 1] == b'/' {
                    cur.push_str("*/");
                    i += 2;
                    break;
                }
                let ch = sql[i..].chars().next().unwrap();
                cur.push(ch);
                i += ch.len_utf8();
            }
            continue;
        }
        // Single-quoted string or double-quoted identifier
        if b == b'\'' || b == b'"' {
            let quote = b;
            cur.push(quote as char);
            i += 1;
            while i < bytes.len() {
                let ch = sql[i..].chars().next().unwrap();
                cur.push(ch);
                i += ch.len_utf8();
                if ch as u32 == u32::from(quote) {
                    if i < bytes.len() && bytes[i] == quote {
                        cur.push(quote as char);
                        i += 1;
                    } else {
                        break;
                    }
                }
            }
            continue;
        }
        // Postgres dollar-quoted block $$...$$ or $tag$...$tag$
        if b == b'$'
            && let Some(tag_len) = parse_dollar_tag(&sql[i..])
        {
            let tag = &sql[i..i + tag_len];
            cur.push_str(tag);
            i += tag_len;
            if let Some(end_rel) = sql[i..].find(tag) {
                cur.push_str(&sql[i..i + end_rel + tag_len]);
                i += end_rel + tag_len;
            } else {
                cur.push_str(&sql[i..]);
                break;
            }
            continue;
        }

        if b == b';' {
            let stmt = cur.trim();
            if !stmt.is_empty() {
                out.push(stmt.to_string());
            }
            cur.clear();
            i += 1;
            continue;
        }

        let ch = sql[i..].chars().next().unwrap();
        cur.push(ch);
        i += ch.len_utf8();
    }

    let tail = cur.trim();
    if !tail.is_empty() {
        out.push(tail.to_string());
    }
    out
}

fn parse_dollar_tag(s: &str) -> Option<usize> {
    let bytes = s.as_bytes();
    if bytes.first() != Some(&b'$') {
        return None;
    }
    let mut j = 1;
    while j < bytes.len() {
        if bytes[j] == b'$' {
            return Some(j + 1);
        }
        if !(bytes[j].is_ascii_alphanumeric() || bytes[j] == b'_') {
            return None;
        }
        j += 1;
    }
    None
}

fn truncate_preview(s: &str, max_chars: usize) -> String {
    let collapsed: String = s.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut out = String::new();
    for (idx, ch) in collapsed.chars().enumerate() {
        if idx >= max_chars {
            out.push_str("...");
            break;
        }
        out.push(ch);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_alter_table_fk_and_comments_and_ignores_unknown_statements() {
        let sql = r#"
            SET statement_timeout = 0;
            CREATE TABLE users (
                id BIGINT PRIMARY KEY,
                email VARCHAR(255) NOT NULL UNIQUE
            );
            CREATE TABLE orders (
                id BIGINT PRIMARY KEY,
                user_id BIGINT NOT NULL
            );
            ALTER TABLE orders ADD CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id);
            CREATE INDEX idx_orders_user ON orders(user_id);
            COMMENT ON TABLE users IS 'Account users';
            COMMENT ON COLUMN users.email IS 'Primary contact email';
            CREATE TRIGGER bogus_stmt_not_supported_here BEFORE INSERT ON users FOR EACH ROW BEGIN END;
            INSERT INTO users VALUES (1, 'a@b.com');
        "#;

        let schema = parse_sql_schema(sql, "public").expect("parse sql");
        assert_eq!(schema.dialect, Dialect::Sqlfile);
        assert_eq!(schema.tables.len(), 2);

        let users = schema.table_by_id("public.users").expect("users table");
        assert_eq!(users.comment.as_deref(), Some("Account users"));
        assert_eq!(
            users.columns[1].comment.as_deref(),
            Some("Primary contact email")
        );

        let orders = schema.table_by_id("public.orders").expect("orders table");
        assert_eq!(orders.indexes.len(), 1);
        assert_eq!(orders.indexes[0].name, "idx_orders_user");

        assert_eq!(schema.relations.len(), 1);
        assert_eq!(schema.relations[0].from_table, "public.orders");
        assert_eq!(schema.relations[0].to_table, "public.users");

        assert!(!schema.warnings.is_empty());
    }
}

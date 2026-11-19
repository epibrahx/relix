use serde::{Deserialize, Serialize};

/// Source SQL dialect of an extracted [`Schema`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Dialect {
    Postgres,
    Sqlite,
    Sqlfile,
}

/// Normalized logical column type family used for cross-dialect comparison and inference.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TypeFamily {
    Integer,
    Text,
    Uuid,
    Numeric,
    Bool,
    Timestamp,
    Json,
    Binary,
    Other,
}

/// Whether a [`Table`] entry represents a base table or a database view.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TableKind {
    #[default]
    Table,
    View,
}

/// Whether a [`Relation`] comes from an explicit `FOREIGN KEY` constraint or inference.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RelationKind {
    Declared,
    Inferred,
}

/// User-facing status of a [`Relation`]; only meaningful for [`RelationKind::Inferred`].
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RelationStatus {
    #[default]
    Auto,
    Confirmed,
    Rejected,
}

/// Unified database schema representation shared by all loaders, inference, layout, and UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Schema {
    pub dialect: Dialect,
    pub tables: Vec<Table>,
    pub relations: Vec<Relation>,
    #[serde(default)]
    pub warnings: Vec<String>,
}

impl Schema {
    /// Create an empty schema for the given dialect.
    pub fn new(dialect: Dialect) -> Self {
        Self {
            dialect,
            tables: Vec::new(),
            relations: Vec::new(),
            warnings: Vec::new(),
        }
    }

    /// Look up a table by its canonical `id` (`"schema.name"`).
    pub fn table_by_id(&self, id: &str) -> Option<&Table> {
        self.tables.iter().find(|t| t.id == id)
    }

    /// Serialize this schema to pretty-printed JSON.
    pub fn to_json_pretty(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string_pretty(self)
    }

    /// Deserialize a schema from JSON.
    pub fn from_json_str(json: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(json)
    }
}

/// A database table or view.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Table {
    /// Canonical identifier: `"schema.name"` (`"main.name"` for SQLite).
    pub id: String,
    pub schema: String,
    pub name: String,
    #[serde(default)]
    pub kind: TableKind,
    #[serde(default)]
    pub comment: Option<String>,
    #[serde(default)]
    pub columns: Vec<Column>,
    #[serde(default)]
    pub primary_key: Vec<String>,
    #[serde(default)]
    pub unique_keys: Vec<Vec<String>>,
    #[serde(default)]
    pub indexes: Vec<Index>,
}

/// A single column inside a [`Table`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Column {
    pub name: String,
    pub data_type: String,
    pub type_family: TypeFamily,
    pub nullable: bool,
    #[serde(default)]
    pub default: Option<String>,
    #[serde(default)]
    pub comment: Option<String>,
}

/// A table index definition.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Index {
    pub name: String,
    pub columns: Vec<String>,
    pub unique: bool,
}

/// A directed relationship from `from_table(from_columns)` to `to_table(to_columns)`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Relation {
    pub id: String,
    pub from_table: String,
    pub from_columns: Vec<String>,
    pub to_table: String,
    pub to_columns: Vec<String>,
    pub kind: RelationKind,
    #[serde(default)]
    pub status: RelationStatus,
    #[serde(default)]
    pub evidence: Vec<String>,
}

impl Relation {
    /// Compute a deterministic, platform-independent relation ID from endpoints.
    ///
    /// Uses 128-bit FNV-1a over length-prefixed UTF-8 segments so persisted decisions
    /// in `relix.toml` remain stable across Rust versions and 32/64-bit targets.
    pub fn compute_id(
        from_table: &str,
        from_columns: &[String],
        to_table: &str,
        to_columns: &[String],
    ) -> String {
        const FNV_OFFSET: u128 = 0x6c62_272e_07bb_0142_62b8_2175_6295_c58d;
        const FNV_PRIME: u128 = 0x0000_0000_0100_0000_0000_0000_0000_013b;

        let mut hash = FNV_OFFSET;
        let mut feed_bytes = |bytes: &[u8]| {
            for &b in &(bytes.len() as u64).to_le_bytes() {
                hash ^= u128::from(b);
                hash = hash.wrapping_mul(FNV_PRIME);
            }
            for &b in bytes {
                hash ^= u128::from(b);
                hash = hash.wrapping_mul(FNV_PRIME);
            }
        };

        feed_bytes(from_table.as_bytes());
        feed_bytes(&(from_columns.len() as u64).to_le_bytes());
        for col in from_columns {
            feed_bytes(col.as_bytes());
        }
        feed_bytes(to_table.as_bytes());
        feed_bytes(&(to_columns.len() as u64).to_le_bytes());
        for col in to_columns {
            feed_bytes(col.as_bytes());
        }

        format!("rel_{hash:032x}")
    }

    /// Construct a declared foreign-key relation with deterministic ID.
    pub fn declared(
        from_table: impl Into<String>,
        from_columns: Vec<String>,
        to_table: impl Into<String>,
        to_columns: Vec<String>,
    ) -> Self {
        let from_table = from_table.into();
        let to_table = to_table.into();
        let id = Self::compute_id(&from_table, &from_columns, &to_table, &to_columns);
        Self {
            id,
            from_table,
            from_columns,
            to_table,
            to_columns,
            kind: RelationKind::Declared,
            status: RelationStatus::Auto,
            evidence: Vec::new(),
        }
    }
}

/// Normalize a raw SQL column type string into a [`TypeFamily`].
pub fn normalize_type_family(dialect: Dialect, raw_type: &str) -> TypeFamily {
    let trimmed = raw_type.trim();
    if trimmed.is_empty() {
        return TypeFamily::Other;
    }

    let lower = trimmed.to_ascii_lowercase();
    // Array types (e.g. `integer[]`, `text[]`, `uuid[]`, Postgres `_int4`) should not match scalar keys.
    if lower.ends_with("[]")
        || lower.contains(" array")
        || (dialect == Dialect::Postgres && lower.starts_with('_'))
    {
        return TypeFamily::Other;
    }

    // Strip parenthesized precision/length modifiers, e.g. `varchar(255)`, `numeric(10, 2)`.
    let without_parens = strip_parens(&lower);
    let collapsed = collapse_whitespace(&without_parens);

    // Handle multi-word and qualified names (e.g. `pg_catalog.int4`).
    let base = collapsed.rsplit('.').next().unwrap_or(&collapsed).trim();

    // Strip trailing `unsigned` / `zerofill` / `signed` SQL modifiers if present.
    let base = base
        .strip_suffix(" unsigned")
        .or_else(|| base.strip_suffix(" signed"))
        .unwrap_or(base)
        .trim();

    match base {
        "int" | "int2" | "int4" | "int8" | "integer" | "smallint" | "bigint" | "tinyint"
        | "mediumint" | "serial" | "bigserial" | "smallserial" | "serial2" | "serial4"
        | "serial8" | "int32" | "int64" | "rowid" => TypeFamily::Integer,

        "text" | "varchar" | "character varying" | "char" | "character" | "bpchar" | "nvarchar"
        | "nchar" | "clob" | "citext" | "name" | "tinytext" | "mediumtext" | "longtext" => {
            TypeFamily::Text
        }

        "uuid" | "uniqueidentifier" => TypeFamily::Uuid,

        "numeric" | "decimal" | "dec" | "real" | "float" | "float4" | "float8" | "double"
        | "double precision" | "money" | "smallmoney" | "number" => TypeFamily::Numeric,

        "bool" | "boolean" => TypeFamily::Bool,

        "timestamp"
        | "timestamptz"
        | "timestamp with time zone"
        | "timestamp without time zone"
        | "datetime"
        | "datetime2"
        | "smalldatetime"
        | "date"
        | "time"
        | "timetz"
        | "time with time zone"
        | "time without time zone" => TypeFamily::Timestamp,

        "json" | "jsonb" => TypeFamily::Json,

        "bytea" | "blob" | "binary" | "varbinary" | "tinyblob" | "mediumblob" | "longblob" => {
            TypeFamily::Binary
        }

        // SQLite type affinity fallback for compound type declarations like `UNSIGNED BIG INT` or `VARYING CHARACTER`.
        _ if dialect == Dialect::Sqlite => sqlite_affinity_fallback(base),

        _ => TypeFamily::Other,
    }
}

fn sqlite_affinity_fallback(lower_base: &str) -> TypeFamily {
    if lower_base.contains("int") {
        TypeFamily::Integer
    } else if lower_base.contains("char")
        || lower_base.contains("clob")
        || lower_base.contains("text")
    {
        TypeFamily::Text
    } else if lower_base.contains("blob") {
        TypeFamily::Binary
    } else if lower_base.contains("real")
        || lower_base.contains("floa")
        || lower_base.contains("doub")
        || lower_base.contains("num")
        || lower_base.contains("dec")
    {
        TypeFamily::Numeric
    } else {
        TypeFamily::Other
    }
}

fn strip_parens(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut depth = 0usize;
    for ch in s.chars() {
        match ch {
            '(' => depth += 1,
            ')' => depth = depth.saturating_sub(1),
            _ if depth == 0 => out.push(ch),
            _ => {}
        }
    }
    out
}

fn collapse_whitespace(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_json_round_trip_is_lossless() {
        let mut schema = Schema::new(Dialect::Postgres);
        schema
            .warnings
            .push("skipped unsupported trigger".to_string());
        schema.tables.push(Table {
            id: "public.users".to_string(),
            schema: "public".to_string(),
            name: "users".to_string(),
            kind: TableKind::Table,
            comment: Some("Application users".to_string()),
            columns: vec![
                Column {
                    name: "id".to_string(),
                    data_type: "bigint".to_string(),
                    type_family: TypeFamily::Integer,
                    nullable: false,
                    default: Some("nextval('users_id_seq')".to_string()),
                    comment: None,
                },
                Column {
                    name: "email".to_string(),
                    data_type: "varchar(255)".to_string(),
                    type_family: TypeFamily::Text,
                    nullable: false,
                    default: None,
                    comment: Some("User email".to_string()),
                },
            ],
            primary_key: vec!["id".to_string()],
            unique_keys: vec![vec!["email".to_string()]],
            indexes: vec![Index {
                name: "idx_users_email".to_string(),
                columns: vec!["email".to_string()],
                unique: true,
            }],
        });
        schema.relations.push(Relation::declared(
            "public.orders",
            vec!["user_id".to_string()],
            "public.users",
            vec!["id".to_string()],
        ));

        let json = schema.to_json_pretty().expect("serialize schema");
        let parsed = Schema::from_json_str(&json).expect("deserialize schema");
        assert_eq!(schema, parsed);
    }

    #[test]
    fn relation_id_is_deterministic_and_sensitive_to_order() {
        let a = Relation::compute_id(
            "main.orders",
            &["user_id".to_string()],
            "main.users",
            &["id".to_string()],
        );
        let b = Relation::compute_id(
            "main.orders",
            &["user_id".to_string()],
            "main.users",
            &["id".to_string()],
        );
        let c = Relation::compute_id(
            "main.orders",
            &["tenant_id".to_string(), "user_id".to_string()],
            "main.users",
            &["tenant_id".to_string(), "id".to_string()],
        );
        let d = Relation::compute_id(
            "main.orders",
            &["user_id".to_string(), "tenant_id".to_string()],
            "main.users",
            &["id".to_string(), "tenant_id".to_string()],
        );
        assert_eq!(a, b);
        assert!(a.starts_with("rel_"));
        assert_ne!(a, c);
        assert_ne!(c, d);
    }

    #[test]
    fn normalize_type_family_table_driven() {
        let cases = [
            // Postgres types
            (Dialect::Postgres, "integer", TypeFamily::Integer),
            (Dialect::Postgres, "INT4", TypeFamily::Integer),
            (Dialect::Postgres, "bigint", TypeFamily::Integer),
            (Dialect::Postgres, "bigserial", TypeFamily::Integer),
            (Dialect::Postgres, "pg_catalog.int8", TypeFamily::Integer),
            (
                Dialect::Postgres,
                "character varying(255)",
                TypeFamily::Text,
            ),
            (Dialect::Postgres, "varchar(64)", TypeFamily::Text),
            (Dialect::Postgres, "char(2)", TypeFamily::Text),
            (Dialect::Postgres, "text", TypeFamily::Text),
            (Dialect::Postgres, "citext", TypeFamily::Text),
            (Dialect::Postgres, "uuid", TypeFamily::Uuid),
            (Dialect::Postgres, "numeric(12, 2)", TypeFamily::Numeric),
            (Dialect::Postgres, "double precision", TypeFamily::Numeric),
            (Dialect::Postgres, "real", TypeFamily::Numeric),
            (Dialect::Postgres, "boolean", TypeFamily::Bool),
            (Dialect::Postgres, "bool", TypeFamily::Bool),
            (
                Dialect::Postgres,
                "timestamp with time zone",
                TypeFamily::Timestamp,
            ),
            (Dialect::Postgres, "timestamptz", TypeFamily::Timestamp),
            (
                Dialect::Postgres,
                "timestamp(6) without time zone",
                TypeFamily::Timestamp,
            ),
            (Dialect::Postgres, "date", TypeFamily::Timestamp),
            (Dialect::Postgres, "jsonb", TypeFamily::Json),
            (Dialect::Postgres, "json", TypeFamily::Json),
            (Dialect::Postgres, "bytea", TypeFamily::Binary),
            (Dialect::Postgres, "integer[]", TypeFamily::Other),
            (Dialect::Postgres, "_int4", TypeFamily::Other),
            (Dialect::Postgres, "inet", TypeFamily::Other),
            // SQLite types
            (Dialect::Sqlite, "INTEGER", TypeFamily::Integer),
            (Dialect::Sqlite, "INT", TypeFamily::Integer),
            (Dialect::Sqlite, "UNSIGNED BIG INT", TypeFamily::Integer),
            (Dialect::Sqlite, "TEXT", TypeFamily::Text),
            (Dialect::Sqlite, "VARCHAR(100)", TypeFamily::Text),
            (Dialect::Sqlite, "NVARCHAR(50)", TypeFamily::Text),
            (Dialect::Sqlite, "UUID", TypeFamily::Uuid),
            (Dialect::Sqlite, "REAL", TypeFamily::Numeric),
            (Dialect::Sqlite, "DECIMAL(10,2)", TypeFamily::Numeric),
            (Dialect::Sqlite, "BOOLEAN", TypeFamily::Bool),
            (Dialect::Sqlite, "DATETIME", TypeFamily::Timestamp),
            (Dialect::Sqlite, "TIMESTAMP", TypeFamily::Timestamp),
            (Dialect::Sqlite, "JSON", TypeFamily::Json),
            (Dialect::Sqlite, "BLOB", TypeFamily::Binary),
            (Dialect::Sqlite, "", TypeFamily::Other),
        ];

        for (dialect, raw, expected) in cases {
            assert_eq!(
                normalize_type_family(dialect, raw),
                expected,
                "dialect={dialect:?}, raw={raw:?}"
            );
        }
    }
}

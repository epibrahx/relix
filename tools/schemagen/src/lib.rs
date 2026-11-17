use relix_core::{Column, Dialect, Index, Relation, Schema, Table, TableKind, TypeFamily};

const DOMAINS: &[&str] = &[
    "auth",
    "users",
    "billing",
    "orders",
    "catalog",
    "inventory",
    "shipping",
    "audit",
    "notify",
    "analytics",
];

/// Generate a synthetic relational [`Schema`] with realistic domain clusters and foreign keys.
pub fn generate_synthetic_schema(
    table_count: usize,
    cols_per_table: usize,
    fk_density: f64,
    seed: u64,
) -> Schema {
    let mut rng = SplitMix64(seed);
    let mut schema = Schema::new(Dialect::Postgres);
    let cols_per_table = cols_per_table.max(2);

    let domain_count = if table_count <= 20 { 3 } else { DOMAINS.len() };

    for i in 0..table_count {
        let domain = DOMAINS[i % domain_count];
        let table_name = format!("{domain}_entity_{i:04}");
        let table_id = format!("public.{table_name}");

        let mut columns = Vec::with_capacity(cols_per_table);
        columns.push(Column {
            name: "id".to_string(),
            data_type: "bigint".to_string(),
            type_family: TypeFamily::Integer,
            nullable: false,
            default: None,
            comment: None,
        });

        let mut fk_targets: Vec<(String, String)> = Vec::new();
        let desired_fks = if i == 0 {
            0
        } else {
            let base = fk_density.floor() as usize;
            let frac = fk_density - (base as f64);
            let extra = usize::from(rng.next_f64() < frac);
            (base + extra).min(cols_per_table.saturating_sub(2))
        };

        for fk_idx in 0..desired_fks {
            // Bias 75% toward earlier tables in the same domain, 25% across domains.
            let target_idx = if i >= domain_count && rng.next_f64() < 0.75 {
                let same_domain_max = i / domain_count;
                let step = rng.next_usize(same_domain_max.max(1));
                (step * domain_count + (i % domain_count)).min(i - 1)
            } else {
                rng.next_usize(i)
            };
            let target_domain = DOMAINS[target_idx % domain_count];
            let target_id = format!("public.{target_domain}_entity_{target_idx:04}");
            let col_name = if fk_idx == 0 {
                format!("ref_{target_idx:04}_id")
            } else {
                format!("ref_{target_idx:04}_{fk_idx}_id")
            };
            columns.push(Column {
                name: col_name.clone(),
                data_type: "bigint".to_string(),
                type_family: TypeFamily::Integer,
                nullable: fk_idx % 2 == 1,
                default: None,
                comment: None,
            });
            fk_targets.push((col_name, target_id));
        }

        while columns.len() < cols_per_table {
            let idx = columns.len();
            let (data_type, type_family) = match idx % 5 {
                0 => ("varchar(128)", TypeFamily::Text),
                1 => ("integer", TypeFamily::Integer),
                2 => ("timestamp", TypeFamily::Timestamp),
                3 => ("boolean", TypeFamily::Bool),
                _ => ("numeric(10, 2)", TypeFamily::Numeric),
            };
            columns.push(Column {
                name: format!("field_{idx:02}"),
                data_type: data_type.to_string(),
                type_family,
                nullable: idx % 3 == 0,
                default: None,
                comment: None,
            });
        }

        for (from_col, to_table) in fk_targets {
            schema.relations.push(Relation::declared(
                table_id.clone(),
                vec![from_col],
                to_table,
                vec!["id".to_string()],
            ));
        }

        schema.tables.push(Table {
            id: table_id,
            schema: "public".to_string(),
            name: table_name,
            kind: TableKind::Table,
            comment: None,
            columns,
            primary_key: vec!["id".to_string()],
            unique_keys: Vec::new(),
            indexes: vec![Index {
                name: format!("idx_entity_{i:04}_pk"),
                columns: vec!["id".to_string()],
                unique: true,
            }],
        });
    }

    schema
}

struct SplitMix64(u64);

impl SplitMix64 {
    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    fn next_usize(&mut self, bound: usize) -> usize {
        if bound <= 1 {
            0
        } else {
            (self.next_u64() as usize) % bound
        }
    }

    fn next_f64(&mut self) -> f64 {
        ((self.next_u64() >> 11) as f64) / ((1u64 << 53) as f64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_requested_table_counts_deterministically() {
        let s1 = generate_synthetic_schema(100, 8, 1.5, 42);
        let s2 = generate_synthetic_schema(100, 8, 1.5, 42);
        assert_eq!(s1, s2);
        assert_eq!(s1.tables.len(), 100);
        assert!(s1.tables.iter().all(|t| t.columns.len() == 8));
        assert!(s1.relations.len() >= 100);
    }
}

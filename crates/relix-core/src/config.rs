use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::model::{Relation, RelationKind, RelationStatus, Schema};

/// 2D node position persisted after manual dragging on the ER canvas.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct NodePosition {
    pub x: f32,
    pub y: f32,
}

/// Persisted viewport pan/zoom state.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ViewportState {
    pub zoom: f32,
    pub pan_x: f32,
    pub pan_y: f32,
}

impl Default for ViewportState {
    fn default() -> Self {
        Self {
            zoom: 1.0,
            pan_x: 0.0,
            pan_y: 0.0,
        }
    }
}

/// User-confirmed relation created manually (for example, resolving an ambiguous column).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ManualRelation {
    pub from_table: String,
    pub from_columns: Vec<String>,
    pub to_table: String,
    pub to_columns: Vec<String>,
}

/// Local structural configuration (`relix.toml`).
///
/// Security invariant: NEVER contains connection strings, usernames, passwords, or business data.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ProjectConfig {
    #[serde(default)]
    pub confirmed_relations: Vec<String>,
    #[serde(default)]
    pub rejected_relations: Vec<String>,
    #[serde(default)]
    pub manual_relations: Vec<ManualRelation>,
    /// Mapping from `table_id` -> group name.
    #[serde(default)]
    pub table_groups: BTreeMap<String, String>,
    /// Collapsed state per group name.
    #[serde(default)]
    pub collapsed_groups: BTreeMap<String, bool>,
    /// Dragged node coordinates keyed by `table_id` (or `group:<name>`).
    #[serde(default)]
    pub node_positions: BTreeMap<String, NodePosition>,
    #[serde(default)]
    pub viewport: ViewportState,
}

impl ProjectConfig {
    /// Serialize configuration to pretty TOML.
    pub fn to_toml_string(&self) -> Result<String, toml::ser::Error> {
        toml::to_string_pretty(self)
    }

    /// Deserialize configuration from TOML.
    pub fn from_toml_str(input: &str) -> Result<Self, toml::de::Error> {
        toml::from_str(input)
    }

    /// Mark an inferred relation as confirmed (removing from rejected if present).
    pub fn confirm_relation(&mut self, relation_id: &str) {
        self.rejected_relations.retain(|id| id != relation_id);
        if !self.confirmed_relations.iter().any(|id| id == relation_id) {
            self.confirmed_relations.push(relation_id.to_string());
        }
    }

    /// Mark an inferred relation as rejected (removing from confirmed if present).
    pub fn reject_relation(&mut self, relation_id: &str) {
        self.confirmed_relations.retain(|id| id != relation_id);
        if !self.rejected_relations.iter().any(|id| id == relation_id) {
            self.rejected_relations.push(relation_id.to_string());
        }
    }

    /// Reset an inferred relation back to `Auto`.
    pub fn reset_relation(&mut self, relation_id: &str) {
        self.confirmed_relations.retain(|id| id != relation_id);
        self.rejected_relations.retain(|id| id != relation_id);
    }

    /// Apply persisted `confirmed` / `rejected` / `manual` relation decisions onto a [`Schema`].
    pub fn apply_to_schema(&self, schema: &mut Schema) {
        for rel in &mut schema.relations {
            if rel.kind != RelationKind::Inferred {
                continue;
            }
            if self.confirmed_relations.iter().any(|id| id == &rel.id) {
                rel.status = RelationStatus::Confirmed;
            } else if self.rejected_relations.iter().any(|id| id == &rel.id) {
                rel.status = RelationStatus::Rejected;
            } else {
                rel.status = RelationStatus::Auto;
            }
        }

        for manual in &self.manual_relations {
            let id = Relation::compute_id(
                &manual.from_table,
                &manual.from_columns,
                &manual.to_table,
                &manual.to_columns,
            );
            if let Some(existing) = schema.relations.iter_mut().find(|r| r.id == id) {
                if existing.kind == RelationKind::Inferred {
                    existing.status = RelationStatus::Confirmed;
                }
            } else {
                schema.relations.push(Relation {
                    id,
                    from_table: manual.from_table.clone(),
                    from_columns: manual.from_columns.clone(),
                    to_table: manual.to_table.clone(),
                    to_columns: manual.to_columns.clone(),
                    kind: RelationKind::Inferred,
                    status: RelationStatus::Confirmed,
                    evidence: vec!["用户手动确认".to_string()],
                });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Dialect;

    #[test]
    fn config_round_trip_and_restores_relation_statuses() {
        let mut cfg = ProjectConfig::default();
        let rel_confirmed = Relation::compute_id(
            "main.posts",
            &["author_id".to_string()],
            "main.authors",
            &["id".to_string()],
        );
        let rel_rejected = Relation::compute_id(
            "main.posts",
            &["category_id".to_string()],
            "main.categories",
            &["id".to_string()],
        );

        cfg.confirm_relation(&rel_confirmed);
        cfg.reject_relation(&rel_rejected);
        cfg.table_groups
            .insert("main.posts".to_string(), "content".to_string());
        cfg.collapsed_groups.insert("content".to_string(), false);
        cfg.node_positions
            .insert("main.posts".to_string(), NodePosition { x: 120.5, y: 48.0 });
        cfg.viewport = ViewportState {
            zoom: 1.25,
            pan_x: -40.0,
            pan_y: 12.0,
        };

        let toml_text = cfg.to_toml_string().expect("serialize toml");
        let parsed = ProjectConfig::from_toml_str(&toml_text).expect("parse toml");
        assert_eq!(cfg, parsed);

        let mut schema = Schema::new(Dialect::Sqlite);
        schema.relations.push(Relation {
            id: rel_confirmed.clone(),
            from_table: "main.posts".to_string(),
            from_columns: vec!["author_id".to_string()],
            to_table: "main.authors".to_string(),
            to_columns: vec!["id".to_string()],
            kind: RelationKind::Inferred,
            status: RelationStatus::Auto,
            evidence: vec!["test".to_string()],
        });
        schema.relations.push(Relation {
            id: rel_rejected.clone(),
            from_table: "main.posts".to_string(),
            from_columns: vec!["category_id".to_string()],
            to_table: "main.categories".to_string(),
            to_columns: vec!["id".to_string()],
            kind: RelationKind::Inferred,
            status: RelationStatus::Auto,
            evidence: vec!["test".to_string()],
        });

        parsed.apply_to_schema(&mut schema);
        assert_eq!(schema.relations[0].status, RelationStatus::Confirmed);
        assert_eq!(schema.relations[1].status, RelationStatus::Rejected);
    }
}

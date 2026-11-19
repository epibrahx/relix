use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::PathBuf;

use relix_core::{
    AmbiguousColumn, InferConfig, ManualRelation, NodePosition, ProjectConfig, Relation,
    RelationCandidate, RelationKind, RelationStatus, Schema, Table, infer_relations,
    populate_inferred_relations,
};
use relix_layout::{
    LayoutConfig, LayoutEngine, LayoutResult, NodeBox, SugiyamaLayout, compute_table_height,
    focus_subgraph,
};
use web_time::Instant;

use crate::source_loader::{LoadedSource, persist_project_config};

pub const DEFAULT_VISIBLE_COLS: usize = 8;
pub const GROUP_NODE_PREFIX: &str = "group::";
pub const GROUP_CARD_WIDTH: f32 = 240.0;
pub const GROUP_CARD_HEIGHT: f32 = 84.0;
const FLASH_DURATION_MS: u64 = 1600;

/// Group container bounding box rendered behind expanded group members on canvas.
#[derive(Debug, Clone)]
pub struct GroupContainer {
    pub name: String,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub table_count: usize,
}

/// Visual node kind rendered on the ER canvas (either an individual table or a collapsed domain group).
#[derive(Debug, Clone)]
pub enum RenderNodeKind {
    Table {
        table_idx: usize,
        group: String,
    },
    CollapsedGroup {
        group: String,
        table_ids: Vec<String>,
    },
}

/// A canvas node with layout bounds and metadata derived from [`AppState`].
#[derive(Debug, Clone)]
pub struct RenderNode {
    pub id: String,
    pub kind: RenderNodeKind,
    pub bounds: NodeBox,
}

/// A canvas edge between two [`RenderNode`] indices.
#[derive(Debug, Clone)]
pub struct RenderEdge {
    pub relation_id: String,
    pub from_node_idx: usize,
    pub to_node_idx: usize,
    pub from_table: String,
    pub to_table: String,
    pub label: String,
    pub kind: RelationKind,
    pub status: RelationStatus,
    pub evidence: Vec<String>,
}

/// Derived visual scene ready for GPU rendering and hit-testing.
#[derive(Debug, Clone, Default)]
pub struct SceneGraph {
    pub nodes: Vec<RenderNode>,
    pub edges: Vec<RenderEdge>,
    pub containers: Vec<GroupContainer>,
    pub table_to_node: HashMap<String, usize>,
    pub highlighted_nodes: HashSet<usize>,
    pub highlighted_edges: HashSet<usize>,
    pub has_selection_highlight: bool,
    pub total_width: f32,
    pub total_height: f32,
}

/// Match result in sidebar search (table or column match).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchMatch {
    pub table_id: String,
    pub table_name: String,
    pub group: String,
    pub matched_columns: Vec<String>,
}

/// Authoritative RELIX UI state shared across toolbar, navigation sidebar, ER canvas, and inspector.
pub struct AppState {
    pub schema: Schema,
    pub raw_sql: Option<String>,
    pub source_label: String,
    pub config: ProjectConfig,
    pub config_path: Option<PathBuf>,
    pub ambiguous: Vec<AmbiguousColumn>,

    pub expanded_tables: HashSet<String>,
    pub selected_table_id: Option<String>,
    pub selected_relation_id: Option<String>,
    pub hovered_relation_id: Option<String>,
    pub search_query: String,

    pub focus_mode: bool,
    pub focus_hops: usize,
    pub auto_group: bool,

    /// Base auto-layout boxes computed by `SugiyamaLayout` before manual overrides.
    pub base_layout: LayoutResult,
    pub layout_ms: f32,
    pub last_error: Option<String>,

    /// Smooth camera animation target (`pan_x`, `pan_y`) when jumping from search.
    pub target_pan: Option<(f32, f32)>,
    /// Table highlighted temporarily after search jump.
    pub flash_table: Option<(String, Instant)>,

    pub scene: SceneGraph,
    pub version: u64,
}

impl AppState {
    pub fn from_loaded(loaded: LoadedSource) -> Self {
        let mut schema = loaded.schema;
        loaded.config.apply_to_schema(&mut schema);

        let ambiguous = infer_relations(&schema, &InferConfig::default()).ambiguous;
        let t0 = Instant::now();
        let layout_cfg = LayoutConfig {
            max_visible_cols: DEFAULT_VISIBLE_COLS,
            ..LayoutConfig::default()
        };
        let base_layout = SugiyamaLayout.layout(&schema, &layout_cfg);
        let layout_ms = t0.elapsed().as_secs_f32() * 1000.0;

        let mut state = Self {
            schema,
            raw_sql: loaded.raw_sql,
            source_label: loaded.source_label,
            config: loaded.config,
            config_path: loaded.config_path,
            ambiguous,
            expanded_tables: HashSet::new(),
            selected_table_id: None,
            selected_relation_id: None,
            hovered_relation_id: None,
            search_query: String::new(),
            focus_mode: false,
            focus_hops: 2,
            auto_group: true,
            base_layout,
            layout_ms,
            last_error: None,
            target_pan: None,
            flash_table: None,
            scene: SceneGraph::default(),
            version: 1,
        };
        state.rebuild_scene();
        state
    }

    pub fn load_new_source(&mut self, loaded: LoadedSource) {
        *self = Self::from_loaded(loaded);
    }

    /// Re-run automatic hierarchical layout and clear manual position overrides (`P5-T9`).
    pub fn reset_auto_layout(&mut self) {
        self.config.node_positions.clear();
        let t0 = Instant::now();
        let layout_cfg = LayoutConfig {
            max_visible_cols: DEFAULT_VISIBLE_COLS,
            ..LayoutConfig::default()
        };
        self.base_layout = SugiyamaLayout.layout(&self.schema, &layout_cfg);
        self.layout_ms = t0.elapsed().as_secs_f32() * 1000.0;
        self.rebuild_scene();
        self.save_config_best_effort();
    }

    /// Resolve effective business-domain group for each table (`config.table_groups` overrides auto prefix).
    pub fn resolved_table_groups(&self) -> HashMap<String, String> {
        let mut prefix_counts: HashMap<String, usize> = HashMap::new();
        let mut stems: HashMap<String, String> = HashMap::new();

        for tbl in &self.schema.tables {
            if let Some(stem) = extract_domain_stem(&tbl.name) {
                *prefix_counts.entry(stem.clone()).or_insert(0) += 1;
                stems.insert(tbl.id.clone(), stem);
            }
        }

        let mut result = HashMap::with_capacity(self.schema.tables.len());
        for tbl in &self.schema.tables {
            let group = if let Some(manual) = self.config.table_groups.get(&tbl.id) {
                manual.clone()
            } else if self.auto_group {
                if let Some(stem) = stems.get(&tbl.id) {
                    if prefix_counts.get(stem).copied().unwrap_or(0) >= 2 {
                        stem.clone()
                    } else if tbl.schema != "main" && tbl.schema != "public" {
                        tbl.schema.clone()
                    } else {
                        "core".to_string()
                    }
                } else if tbl.schema != "main" && tbl.schema != "public" {
                    tbl.schema.clone()
                } else {
                    "core".to_string()
                }
            } else {
                tbl.schema.clone()
            };
            result.insert(tbl.id.clone(), group);
        }
        result
    }

    /// List all domain groups and their member table ids.
    pub fn group_summary(&self) -> BTreeMap<String, Vec<String>> {
        let resolved = self.resolved_table_groups();
        let mut groups: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for tbl in &self.schema.tables {
            let group = resolved
                .get(&tbl.id)
                .cloned()
                .unwrap_or_else(|| "core".to_string());
            groups.entry(group).or_default().push(tbl.id.clone());
        }
        groups
    }

    pub fn toggle_table_expanded(&mut self, table_id: &str) {
        if !self.expanded_tables.remove(table_id) {
            self.expanded_tables.insert(table_id.to_string());
        }
        self.rebuild_scene();
    }

    pub fn is_table_expanded(&self, table_id: &str) -> bool {
        self.expanded_tables.contains(table_id)
    }

    pub fn set_table_group(&mut self, table_id: &str, group: impl Into<String>) {
        let group_name = group.into().trim().to_string();
        if group_name.is_empty() {
            self.config.table_groups.remove(table_id);
        } else {
            self.config
                .table_groups
                .insert(table_id.to_string(), group_name);
        }
        self.rebuild_scene();
        self.save_config_best_effort();
    }

    pub fn toggle_group_collapsed(&mut self, group_name: &str) {
        let collapsed = self
            .config
            .collapsed_groups
            .get(group_name)
            .copied()
            .unwrap_or(false);
        self.config
            .collapsed_groups
            .insert(group_name.to_string(), !collapsed);
        self.rebuild_scene();
        self.save_config_best_effort();
    }

    pub fn set_auto_group(&mut self, enabled: bool) {
        self.auto_group = enabled;
        self.rebuild_scene();
    }

    pub fn set_focus_mode(&mut self, enabled: bool) {
        self.focus_mode = enabled;
        self.rebuild_scene();
    }

    pub fn adjust_focus_hops(&mut self, delta: isize) {
        let next = (self.focus_hops as isize + delta).clamp(1, 5) as usize;
        self.focus_hops = next;
        if self.focus_mode {
            self.rebuild_scene();
        }
    }

    pub fn select_table(&mut self, table_id: Option<String>) {
        self.selected_table_id = table_id;
        self.selected_relation_id = None;
        self.rebuild_scene();
    }

    pub fn select_relation(&mut self, relation_id: Option<String>) {
        self.selected_relation_id = relation_id;
        self.rebuild_scene();
    }

    pub fn confirm_relation(&mut self, relation_id: &str) {
        self.config.confirm_relation(relation_id);
        self.config.apply_to_schema(&mut self.schema);
        self.rebuild_scene();
        self.save_config_best_effort();
    }

    pub fn reject_relation(&mut self, relation_id: &str) {
        self.config.reject_relation(relation_id);
        self.config.apply_to_schema(&mut self.schema);
        if self.selected_relation_id.as_deref() == Some(relation_id) {
            self.selected_relation_id = None;
        }
        self.rebuild_scene();
        self.save_config_best_effort();
    }

    pub fn reset_relation(&mut self, relation_id: &str) {
        self.config.reset_relation(relation_id);
        for rel in &mut self.schema.relations {
            if rel.id == relation_id && rel.kind == RelationKind::Inferred {
                rel.status = RelationStatus::Auto;
            }
        }
        self.rebuild_scene();
        self.save_config_best_effort();
    }

    /// Promote one candidate from an [`AmbiguousColumn`] into a persisted confirmed relation (`P5-T8`).
    pub fn resolve_ambiguous(
        &mut self,
        from_table: &str,
        from_column: &str,
        candidate: &RelationCandidate,
    ) {
        let manual = ManualRelation {
            from_table: from_table.to_string(),
            from_columns: vec![from_column.to_string()],
            to_table: candidate.to_table.clone(),
            to_columns: vec![candidate.to_column.clone()],
        };
        let duplicate = self
            .config
            .manual_relations
            .iter()
            .any(|existing| existing == &manual);
        if !duplicate {
            self.config.manual_relations.push(manual);
        }
        self.config.apply_to_schema(&mut self.schema);
        // Recompute ambiguity excluding newly resolved columns covered by confirmed relations.
        self.recompute_ambiguous_remaining();
        self.rebuild_scene();
        self.save_config_best_effort();
    }

    fn recompute_ambiguous_remaining(&mut self) {
        let base = infer_relations(&self.schema, &InferConfig::default()).ambiguous;
        let resolved: HashSet<(&str, &str)> = self
            .schema
            .relations
            .iter()
            .filter(|r| r.status == RelationStatus::Confirmed)
            .flat_map(|r| {
                r.from_columns
                    .iter()
                    .map(move |c| (r.from_table.as_str(), c.as_str()))
            })
            .collect();
        self.ambiguous = base
            .into_iter()
            .filter(|a| !resolved.contains(&(a.from_table.as_str(), a.from_column.as_str())))
            .collect();
    }

    pub fn search_matches(&self) -> Vec<SearchMatch> {
        let q = self.search_query.trim().to_ascii_lowercase();
        let groups = self.resolved_table_groups();
        let mut matches = Vec::new();
        for tbl in &self.schema.tables {
            let group = groups
                .get(&tbl.id)
                .cloned()
                .unwrap_or_else(|| "core".to_string());
            if q.is_empty() {
                matches.push(SearchMatch {
                    table_id: tbl.id.clone(),
                    table_name: tbl.name.clone(),
                    group,
                    matched_columns: Vec::new(),
                });
                continue;
            }
            let table_hit = tbl.name.to_ascii_lowercase().contains(&q)
                || tbl.id.to_ascii_lowercase().contains(&q);
            let col_hits: Vec<String> = tbl
                .columns
                .iter()
                .filter(|c| c.name.to_ascii_lowercase().contains(&q))
                .map(|c| c.name.clone())
                .collect();
            if table_hit || !col_hits.is_empty() {
                matches.push(SearchMatch {
                    table_id: tbl.id.clone(),
                    table_name: tbl.name.clone(),
                    group,
                    matched_columns: col_hits,
                });
            }
        }
        matches
    }

    /// Update a node's dragged world position in `ProjectConfig` and rebuild the scene (`P5-T9`).
    pub fn set_node_position(&mut self, node_id: &str, x: f32, y: f32) {
        self.config
            .node_positions
            .insert(node_id.to_string(), NodePosition { x, y });
    }

    pub fn commit_node_positions_and_viewport(&mut self, zoom: f32, pan_x: f32, pan_y: f32) {
        self.config.viewport.zoom = zoom;
        self.config.viewport.pan_x = pan_x;
        self.config.viewport.pan_y = pan_y;
        self.rebuild_scene();
        self.save_config_best_effort();
    }

    /// Handle drop of a dragged table node onto another group container or collapsed group card (`P5-T7`).
    /// Returns `true` if group reassignment occurred.
    pub fn try_drop_table_into_other_group(
        &mut self,
        table_id: &str,
        cx_world: f32,
        cy_world: f32,
    ) -> bool {
        if !self.auto_group {
            return false;
        }
        let current_group = self
            .resolved_table_groups()
            .get(table_id)
            .cloned()
            .unwrap_or_else(|| "core".to_string());

        // Prefer collapsed group cards first, then expanded group containers (excluding current group).
        for node in &self.scene.nodes {
            if let RenderNodeKind::CollapsedGroup { group, .. } = &node.kind
                && group != &current_group
                && cx_world >= node.bounds.x
                && cx_world <= node.bounds.x + node.bounds.width
                && cy_world >= node.bounds.y
                && cy_world <= node.bounds.y + node.bounds.height
            {
                self.set_table_group(table_id, group.clone());
                return true;
            }
        }
        for c in &self.scene.containers {
            if c.name != current_group
                && cx_world >= c.x
                && cx_world <= c.x + c.width
                && cy_world >= c.y
                && cy_world <= c.y + c.height
            {
                self.set_table_group(table_id, c.name.clone());
                return true;
            }
        }
        false
    }

    /// Trigger smooth pan centering and flash highlight onto a table (`P5-T4`).
    pub fn focus_and_flash_table(
        &mut self,
        table_id: &str,
        viewport_width: f32,
        viewport_height: f32,
        zoom: f32,
    ) {
        // If the table's group was collapsed, expand it so the table card itself becomes visible.
        if let Some(group) = self.resolved_table_groups().get(table_id)
            && self
                .config
                .collapsed_groups
                .get(group)
                .copied()
                .unwrap_or(false)
        {
            self.config.collapsed_groups.insert(group.clone(), false);
        }
        self.selected_table_id = Some(table_id.to_string());
        self.selected_relation_id = None;
        self.rebuild_scene();

        if let Some(&node_idx) = self.scene.table_to_node.get(table_id)
            && let Some(node) = self.scene.nodes.get(node_idx)
        {
            let (cx_w, cy_w) = node.bounds.center();
            let target_pan_x = viewport_width * 0.5 - cx_w * zoom;
            let target_pan_y = viewport_height * 0.5 - cy_w * zoom;
            self.target_pan = Some((target_pan_x, target_pan_y));
        }
        self.flash_table = Some((table_id.to_string(), Instant::now()));
        self.version += 1;
    }

    /// Progress of the flash animation (`1.0` -> `0.0`), returning `None` when inactive/expired.
    pub fn flash_intensity_for(&self, node: &RenderNode) -> Option<f32> {
        let (target_id, started) = self.flash_table.as_ref()?;
        let elapsed_ms = started.elapsed().as_millis() as u64;
        if elapsed_ms >= FLASH_DURATION_MS {
            return None;
        }
        let matches = match &node.kind {
            RenderNodeKind::Table { table_idx, .. } => self
                .schema
                .tables
                .get(*table_idx)
                .is_some_and(|t| &t.id == target_id),
            RenderNodeKind::CollapsedGroup { table_ids, .. } => {
                table_ids.iter().any(|id| id == target_id)
            }
        };
        if !matches {
            return None;
        }
        let phase = (elapsed_ms as f32) / (FLASH_DURATION_MS as f32);
        // Two smooth pulse waves
        let pulse = ((phase * std::f32::consts::PI * 4.0).sin().abs()) * (1.0 - phase);
        Some(pulse.clamp(0.15, 1.0))
    }

    pub fn table_by_id(&self, id: &str) -> Option<&Table> {
        self.schema.tables.iter().find(|t| t.id == id)
    }

    pub fn relation_by_id(&self, id: &str) -> Option<&Relation> {
        self.schema.relations.iter().find(|r| r.id == id)
    }

    pub fn add_inferred_if_missing(&mut self) {
        populate_inferred_relations(&mut self.schema, &InferConfig::default());
        self.rebuild_scene();
    }

    /// Recompute [`SceneGraph`] cleanly from schema + config + focus/group/expansion state.
    pub fn rebuild_scene(&mut self) {
        let visible_ids: Option<HashSet<String>> = if self.focus_mode {
            self.selected_table_id
                .as_deref()
                .map(|center| focus_subgraph(&self.schema, center, self.focus_hops))
        } else {
            None
        };

        let resolved_groups = self.resolved_table_groups();
        let mut nodes: Vec<RenderNode> = Vec::new();
        let mut table_to_node: HashMap<String, usize> = HashMap::new();
        let mut collapsed_members: BTreeMap<String, Vec<usize>> = BTreeMap::new();

        // 1. Create table nodes for non-collapsed groups; accumulate tables for collapsed groups.
        for (table_idx, tbl) in self.schema.tables.iter().enumerate() {
            if let Some(vis) = &visible_ids
                && !vis.contains(&tbl.id)
            {
                continue;
            }
            let group = resolved_groups
                .get(&tbl.id)
                .cloned()
                .unwrap_or_else(|| "core".to_string());
            let is_collapsed = self.auto_group
                && self
                    .config
                    .collapsed_groups
                    .get(&group)
                    .copied()
                    .unwrap_or(false);
            if is_collapsed {
                collapsed_members.entry(group).or_default().push(table_idx);
                continue;
            }

            let base_box = self
                .base_layout
                .nodes
                .get(&tbl.id)
                .copied()
                .unwrap_or(NodeBox {
                    x: 40.0 + (table_idx % 4) as f32 * 280.0,
                    y: 40.0 + (table_idx / 4) as f32 * 200.0,
                    width: 240.0,
                    height: 100.0,
                });
            let (x, y) = self
                .config
                .node_positions
                .get(&tbl.id)
                .map_or((base_box.x, base_box.y), |p| (p.x, p.y));
            let max_cols = if self.expanded_tables.contains(&tbl.id) {
                usize::MAX
            } else {
                DEFAULT_VISIBLE_COLS
            };
            let height_cfg = LayoutConfig {
                max_visible_cols: max_cols,
                ..LayoutConfig::default()
            };
            let height = compute_table_height(tbl, &height_cfg);
            let node_idx = nodes.len();
            table_to_node.insert(tbl.id.clone(), node_idx);
            nodes.push(RenderNode {
                id: tbl.id.clone(),
                kind: RenderNodeKind::Table { table_idx, group },
                bounds: NodeBox {
                    x,
                    y,
                    width: base_box.width,
                    height,
                },
            });
        }

        // 2. Materialize one node per collapsed domain group.
        for (group, member_indices) in collapsed_members {
            let group_id = format!("{GROUP_NODE_PREFIX}{group}");
            let mut sum_x = 0.0f32;
            let mut sum_y = 0.0f32;
            let mut table_ids = Vec::with_capacity(member_indices.len());
            for &t_idx in &member_indices {
                let tbl = &self.schema.tables[t_idx];
                table_ids.push(tbl.id.clone());
                let pos = self
                    .config
                    .node_positions
                    .get(&tbl.id)
                    .copied()
                    .or_else(|| {
                        self.base_layout
                            .nodes
                            .get(&tbl.id)
                            .map(|b| NodePosition { x: b.x, y: b.y })
                    })
                    .unwrap_or(NodePosition { x: 80.0, y: 80.0 });
                sum_x += pos.x;
                sum_y += pos.y;
            }
            let count = member_indices.len().max(1) as f32;
            let (gx, gy) = self
                .config
                .node_positions
                .get(&group_id)
                .map_or((sum_x / count, sum_y / count), |p| (p.x, p.y));

            let node_idx = nodes.len();
            for tid in &table_ids {
                table_to_node.insert(tid.clone(), node_idx);
            }
            nodes.push(RenderNode {
                id: group_id,
                kind: RenderNodeKind::CollapsedGroup { group, table_ids },
                bounds: NodeBox {
                    x: gx,
                    y: gy,
                    width: GROUP_CARD_WIDTH,
                    height: GROUP_CARD_HEIGHT,
                },
            });
        }

        // 3. Build active non-rejected edges between visible/collapsed nodes.
        let mut edges: Vec<RenderEdge> = Vec::new();
        let mut seen_group_pairs: HashSet<(usize, usize, bool)> = HashSet::new();
        for rel in &self.schema.relations {
            if rel.status == RelationStatus::Rejected {
                continue;
            }
            if let (Some(&from_node_idx), Some(&to_node_idx)) = (
                table_to_node.get(&rel.from_table),
                table_to_node.get(&rel.to_table),
            ) {
                let touches_collapsed = matches!(
                    nodes[from_node_idx].kind,
                    RenderNodeKind::CollapsedGroup { .. }
                ) || matches!(
                    nodes[to_node_idx].kind,
                    RenderNodeKind::CollapsedGroup { .. }
                );
                if touches_collapsed && from_node_idx == to_node_idx {
                    continue;
                }
                let is_dashed =
                    rel.kind == RelationKind::Inferred && rel.status != RelationStatus::Confirmed;
                if touches_collapsed
                    && !seen_group_pairs.insert((from_node_idx, to_node_idx, is_dashed))
                {
                    continue;
                }
                let label = format!(
                    "{} -> {}",
                    rel.from_columns.join(", "),
                    rel.to_columns.join(", ")
                );
                edges.push(RenderEdge {
                    relation_id: rel.id.clone(),
                    from_node_idx,
                    to_node_idx,
                    from_table: rel.from_table.clone(),
                    to_table: rel.to_table.clone(),
                    label,
                    kind: rel.kind,
                    status: rel.status,
                    evidence: rel.evidence.clone(),
                });
            }
        }

        // 4. Compute 1-hop upstream/downstream highlight set for selected table or selected relation (P5-T5).
        let mut highlighted_nodes: HashSet<usize> = HashSet::new();
        let mut highlighted_edges: HashSet<usize> = HashSet::new();
        let mut has_selection_highlight = false;

        if let Some(sel_tbl) = &self.selected_table_id
            && let Some(&sel_idx) = table_to_node.get(sel_tbl)
        {
            has_selection_highlight = true;
            highlighted_nodes.insert(sel_idx);
            for (e_idx, edge) in edges.iter().enumerate() {
                if edge.from_node_idx == sel_idx || edge.to_node_idx == sel_idx {
                    highlighted_edges.insert(e_idx);
                    highlighted_nodes.insert(edge.from_node_idx);
                    highlighted_nodes.insert(edge.to_node_idx);
                }
            }
        } else if let Some(sel_rel) = &self.selected_relation_id {
            for (e_idx, edge) in edges.iter().enumerate() {
                if &edge.relation_id == sel_rel {
                    has_selection_highlight = true;
                    highlighted_edges.insert(e_idx);
                    highlighted_nodes.insert(edge.from_node_idx);
                    highlighted_nodes.insert(edge.to_node_idx);
                }
            }
        }

        // 5. Compute Group Container bounding boxes when auto_group is enabled.
        let mut containers = Vec::new();
        if self.auto_group {
            let mut per_group: BTreeMap<String, Vec<NodeBox>> = BTreeMap::new();
            for node in &nodes {
                if let RenderNodeKind::Table { group, .. } = &node.kind {
                    per_group
                        .entry(group.clone())
                        .or_default()
                        .push(node.bounds);
                }
            }
            for (name, boxes) in per_group {
                if boxes.len() < 2 {
                    continue;
                }
                let mut min_x = f32::MAX;
                let mut min_y = f32::MAX;
                let mut max_x = f32::MIN;
                let mut max_y = f32::MIN;
                for b in &boxes {
                    min_x = min_x.min(b.x);
                    min_y = min_y.min(b.y);
                    max_x = max_x.max(b.x + b.width);
                    max_y = max_y.max(b.y + b.height);
                }
                let pad = 18.0;
                containers.push(GroupContainer {
                    name,
                    x: min_x - pad,
                    y: min_y - pad - 22.0,
                    width: (max_x - min_x) + pad * 2.0,
                    height: (max_y - min_y) + pad * 2.0 + 22.0,
                    table_count: boxes.len(),
                });
            }
        }

        let mut max_w = 800.0f32;
        let mut max_h = 600.0f32;
        for n in &nodes {
            max_w = max_w.max(n.bounds.x + n.bounds.width + 60.0);
            max_h = max_h.max(n.bounds.y + n.bounds.height + 60.0);
        }

        self.scene = SceneGraph {
            nodes,
            edges,
            containers,
            table_to_node,
            highlighted_nodes,
            highlighted_edges,
            has_selection_highlight,
            total_width: max_w,
            total_height: max_h,
        };
        self.version += 1;
    }

    fn save_config_best_effort(&mut self) {
        if let Err(err) = persist_project_config(self.config_path.as_ref(), &self.config) {
            self.last_error = Some(err.to_string());
        }
    }
}

fn extract_domain_stem(table_name: &str) -> Option<String> {
    let lower = table_name.to_ascii_lowercase();
    let stripped = lower
        .strip_prefix("tbl_")
        .or_else(|| lower.strip_prefix("t_"))
        .unwrap_or(&lower);
    let prefix = stripped.split('_').next().unwrap_or(stripped);
    if prefix.len() >= 2 {
        Some(naive_singular(prefix))
    } else {
        None
    }
}

fn naive_singular(word: &str) -> String {
    if let Some(stem) = word.strip_suffix("ies")
        && stem.len() >= 2
    {
        return format!("{stem}y");
    }
    if let Some(stem) = word.strip_suffix('s')
        && !word.ends_with("ss")
        && stem.len() >= 3
    {
        return stem.to_string();
    }
    word.to_string()
}

/// Canonical helper for formatting column attributes for sidebar / inspector rendering.
pub fn format_column_badges(tbl: &Table, col_name: &str) -> String {
    let mut tags = Vec::new();
    if tbl.primary_key.iter().any(|k| k == col_name) {
        tags.push("PK");
    }
    if tbl
        .unique_keys
        .iter()
        .any(|uk| uk.iter().any(|c| c == col_name))
    {
        tags.push("UQ");
    }
    tags.join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::source_loader::{BuiltinFixture, SourceSpec, load_source};

    #[test]
    fn groups_focus_and_expand_behave_deterministically() {
        let loaded = load_source(&SourceSpec::Builtin(BuiltinFixture::BlogCms)).unwrap();
        let mut state = AppState::from_loaded(loaded);

        let groups = state.group_summary();
        assert!(
            groups.contains_key("post"),
            "expected post domain group in {groups:?}"
        );
        assert!(groups["post"].contains(&"main.posts".to_string()));
        assert!(groups["post"].contains(&"main.post_tags".to_string()));

        // Toggle group collapse shrinks multiple member tables into one CollapsedGroup node.
        let initial_nodes = state.scene.nodes.len();
        state.toggle_group_collapsed("post");
        assert!(state.scene.nodes.len() < initial_nodes);
        assert!(
            state
                .scene
                .nodes
                .iter()
                .any(|n| matches!(n.kind, RenderNodeKind::CollapsedGroup { ref group, .. } if group == "post"))
        );

        // Expand back and test 1-hop highlight & focus mode.
        state.toggle_group_collapsed("post");
        state.select_table(Some("main.posts".to_string()));
        assert!(state.scene.has_selection_highlight);
        assert!(!state.scene.highlighted_nodes.is_empty());

        state.set_focus_mode(true);
        assert!(state.scene.nodes.iter().any(|n| n.id == "main.posts"));

        // Confirm / Reject inferred relation updates schema + config.
        let inferred_id = state
            .schema
            .relations
            .iter()
            .find(|r| r.kind == RelationKind::Inferred)
            .map(|r| r.id.clone())
            .expect("blog fixture has inferred relations");
        state.confirm_relation(&inferred_id);
        assert!(state.config.confirmed_relations.contains(&inferred_id));
        state.reject_relation(&inferred_id);
        assert!(state.config.rejected_relations.contains(&inferred_id));
    }

    #[test]
    fn search_matches_table_and_column_names() {
        let loaded = load_source(&SourceSpec::Builtin(BuiltinFixture::Ecommerce)).unwrap();
        let mut state = AppState::from_loaded(loaded);
        state.search_query = "sku".to_string();
        let hits = state.search_matches();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].table_name, "products");
        assert_eq!(hits[0].matched_columns, vec!["sku"]);
    }

    #[test]
    fn ambiguous_resolution_drag_persistence_and_relayout_work() {
        let loaded = load_source(&SourceSpec::Builtin(BuiltinFixture::WildLegacy)).unwrap();
        let mut state = AppState::from_loaded(loaded);

        // Verify expanding long tables increases rendered card height.
        let sample_tbl = state
            .schema
            .tables
            .iter()
            .find(|t| t.columns.len() > DEFAULT_VISIBLE_COLS)
            .map(|t| t.id.clone());
        if let Some(tid) = sample_tbl {
            let h_before = state.scene.nodes[state.scene.table_to_node[&tid]]
                .bounds
                .height;
            state.toggle_table_expanded(&tid);
            let h_after = state.scene.nodes[state.scene.table_to_node[&tid]]
                .bounds
                .height;
            assert!(h_after > h_before);
        }

        // Verify manual node drag persists into config and auto-layout clears it.
        let first_id = state.schema.tables[0].id.clone();
        state.set_node_position(&first_id, 999.0, 777.0);
        state.commit_node_positions_and_viewport(1.25, 10.0, 20.0);
        let pos = state.scene.nodes[state.scene.table_to_node[&first_id]].bounds;
        assert!((pos.x - 999.0).abs() < 0.01 && (pos.y - 777.0).abs() < 0.01);
        assert_eq!(state.config.viewport.zoom, 1.25);

        state.reset_auto_layout();
        assert!(state.config.node_positions.is_empty());

        // Resolve ambiguous candidate if present in 03_wild_legacy (or ecommerce tenant_members/etc.).
        if let Some(amb) = state.ambiguous.first().cloned() {
            let cand = amb.candidates[0].clone();
            let before_confirmed = state
                .schema
                .relations
                .iter()
                .filter(|r| r.status == RelationStatus::Confirmed)
                .count();
            state.resolve_ambiguous(&amb.from_table, &amb.from_column, &cand);
            let after_confirmed = state
                .schema
                .relations
                .iter()
                .filter(|r| r.status == RelationStatus::Confirmed)
                .count();
            assert_eq!(after_confirmed, before_confirmed + 1);
            assert!(!state.config.manual_relations.is_empty());
        }
    }
}

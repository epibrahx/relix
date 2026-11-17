//! Pure graph layout algorithms for ER diagrams; compiles to `wasm32-unknown-unknown`.

use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};

use epibrhx_core::{RelationStatus, Schema, Table};
use petgraph::Direction;
use petgraph::graph::{DiGraph, NodeIndex};

/// Parameters controlling card dimensions and spacing during graph layout.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LayoutConfig {
    pub node_width: f32,
    pub header_height: f32,
    pub row_height: f32,
    pub footer_padding: f32,
    pub max_visible_cols: usize,
    pub h_gap: f32,
    pub v_gap: f32,
    /// Maximum nodes placed in one horizontal row before wrapping into sub-rows.
    pub max_nodes_per_row: usize,
}

impl Default for LayoutConfig {
    fn default() -> Self {
        Self {
            node_width: 240.0,
            header_height: 32.0,
            row_height: 20.0,
            footer_padding: 10.0,
            max_visible_cols: 8,
            h_gap: 64.0,
            v_gap: 56.0,
            max_nodes_per_row: 16,
        }
    }
}

/// World-space bounding box of a single table card (or collapsed group card).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct NodeBox {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

impl NodeBox {
    pub fn center(self) -> (f32, f32) {
        (self.x + self.width * 0.5, self.y + self.height * 0.5)
    }

    pub fn intersects(self, left: f32, top: f32, right: f32, bottom: f32) -> bool {
        self.x + self.width >= left
            && self.x <= right
            && self.y + self.height >= top
            && self.y <= bottom
    }
}

/// Output of a graph layout pass.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct LayoutResult {
    pub nodes: BTreeMap<String, NodeBox>,
    pub total_width: f32,
    pub total_height: f32,
}

/// Trait abstracting ER diagram layout engines so algorithms can be swapped cleanly.
pub trait LayoutEngine {
    fn layout(&self, schema: &Schema, config: &LayoutConfig) -> LayoutResult;
}

/// Compute visual card height for a table given `config`.
pub fn compute_table_height(table: &Table, config: &LayoutConfig) -> f32 {
    let shown_cols = table.columns.len().min(config.max_visible_cols);
    let has_more = usize::from(table.columns.len() > config.max_visible_cols);
    config.header_height
        + ((shown_cols + has_more) as f32) * config.row_height
        + config.footer_padding
}

/// Simplified Sugiyama layered layout (cycle-breaking -> longest-path layering ->
/// barycenter crossing minimization -> wrapped row coordinate assignment).
#[derive(Debug, Default, Clone, Copy)]
pub struct SugiyamaLayout;

impl LayoutEngine for SugiyamaLayout {
    fn layout(&self, schema: &Schema, config: &LayoutConfig) -> LayoutResult {
        if schema.tables.is_empty() {
            return LayoutResult::default();
        }

        let n = schema.tables.len();
        let mut graph = DiGraph::<usize, ()>::with_capacity(n, schema.relations.len());
        let mut id_to_node: HashMap<&str, NodeIndex> = HashMap::with_capacity(n);
        let mut heights: Vec<f32> = Vec::with_capacity(n);

        for (idx, table) in schema.tables.iter().enumerate() {
            let node = graph.add_node(idx);
            id_to_node.insert(table.id.as_str(), node);
            heights.push(compute_table_height(table, config));
        }

        // Orient edges parent -> child (referenced `to_table` -> referencing `from_table`)
        // so root entity tables appear at the top layers and dependent tables flow downward.
        for rel in &schema.relations {
            if rel.status == RelationStatus::Rejected || rel.from_table == rel.to_table {
                continue;
            }
            if let (Some(&parent), Some(&child)) = (
                id_to_node.get(rel.to_table.as_str()),
                id_to_node.get(rel.from_table.as_str()),
            ) && !graph.contains_edge(parent, child)
            {
                graph.add_edge(parent, child, ());
            }
        }

        // 1. Cycle breaking via iterative DFS back-edge reversal.
        let dag_edges = break_cycles_to_dag(&graph, n);

        // 2. Longest-path layering on the resulting DAG.
        let layers = assign_layers(n, &dag_edges);
        let max_layer = layers.iter().copied().max().unwrap_or(0);
        let mut by_layer: Vec<Vec<usize>> = vec![Vec::new(); max_layer + 1];
        for (node_idx, &layer) in layers.iter().enumerate() {
            by_layer[layer].push(node_idx);
        }

        // 3. Crossing minimization: 2 sweeps of barycenter ordering.
        minimize_crossings(&mut by_layer, &dag_edges, n);

        // 4. Coordinate assignment (wrapping wide layers so 500–2000 tables stay compact).
        let mut nodes = BTreeMap::new();
        let mut cur_y = 0.0f32;
        let mut total_width = 0.0f32;

        let max_per_row = config.max_nodes_per_row.max(1);
        for layer_nodes in &by_layer {
            if layer_nodes.is_empty() {
                continue;
            }
            for chunk in layer_nodes.chunks(max_per_row) {
                let row_width = (chunk.len() as f32) * config.node_width
                    + ((chunk.len().saturating_sub(1)) as f32) * config.h_gap;
                total_width = total_width.max(row_width);

                let mut max_h = 0.0f32;
                for (col_idx, &node_idx) in chunk.iter().enumerate() {
                    let h = heights[node_idx];
                    max_h = max_h.max(h);
                    let x = (col_idx as f32) * (config.node_width + config.h_gap);
                    nodes.insert(
                        schema.tables[node_idx].id.clone(),
                        NodeBox {
                            x,
                            y: cur_y,
                            width: config.node_width,
                            height: h,
                        },
                    );
                }
                cur_y += max_h + config.v_gap;
            }
        }

        let total_height = (cur_y - config.v_gap).max(0.0);

        // Center-align narrower rows horizontally relative to total_width.
        if total_width > 0.0 {
            for layer_nodes in &by_layer {
                for chunk in layer_nodes.chunks(max_per_row) {
                    let row_width = (chunk.len() as f32) * config.node_width
                        + ((chunk.len().saturating_sub(1)) as f32) * config.h_gap;
                    let shift = (total_width - row_width) * 0.5;
                    if shift > 0.5 {
                        for &node_idx in chunk {
                            if let Some(b) = nodes.get_mut(&schema.tables[node_idx].id) {
                                b.x += shift;
                            }
                        }
                    }
                }
            }
        }

        LayoutResult {
            nodes,
            total_width,
            total_height,
        }
    }
}

fn break_cycles_to_dag(graph: &DiGraph<usize, ()>, n: usize) -> Vec<(usize, usize)> {
    // 0 = unvisited, 1 = visiting (on stack), 2 = visited
    let mut state = vec![0u8; n];
    let mut dag_edges = Vec::with_capacity(graph.edge_count());

    for start in 0..n {
        if state[start] != 0 {
            continue;
        }
        // Iterative DFS stack: (node, neighbor_cursor)
        let mut neighbors_cache: Vec<usize> = graph
            .neighbors_directed(NodeIndex::new(start), Direction::Outgoing)
            .map(|nx| nx.index())
            .collect();
        neighbors_cache.sort_unstable();
        let mut stack: Vec<(usize, Vec<usize>, usize)> = vec![(start, neighbors_cache, 0)];
        state[start] = 1;

        while let Some((u, nbrs, cursor)) = stack.last_mut() {
            let u_val = *u;
            if *cursor < nbrs.len() {
                let v = nbrs[*cursor];
                *cursor += 1;
                match state[v] {
                    0 => {
                        dag_edges.push((u_val, v));
                        state[v] = 1;
                        let mut v_nbrs: Vec<usize> = graph
                            .neighbors_directed(NodeIndex::new(v), Direction::Outgoing)
                            .map(|nx| nx.index())
                            .collect();
                        v_nbrs.sort_unstable();
                        stack.push((v, v_nbrs, 0));
                    }
                    1 => {
                        // Back-edge creates a cycle; reverse it so u -> v becomes v -> u.
                        if v != u_val {
                            dag_edges.push((v, u_val));
                        }
                    }
                    _ => {
                        dag_edges.push((u_val, v));
                    }
                }
            } else {
                state[u_val] = 2;
                stack.pop();
            }
        }
    }

    dag_edges.sort_unstable();
    dag_edges.dedup();
    dag_edges
}

fn assign_layers(n: usize, dag_edges: &[(usize, usize)]) -> Vec<usize> {
    let mut adj = vec![Vec::new(); n];
    let mut in_deg = vec![0usize; n];
    for &(u, v) in dag_edges {
        if u != v {
            adj[u].push(v);
            in_deg[v] += 1;
        }
    }

    let mut q = VecDeque::new();
    for (idx, &deg) in in_deg.iter().enumerate() {
        if deg == 0 {
            q.push_back(idx);
        }
    }

    let mut layers = vec![0usize; n];
    let mut visited = 0usize;
    while let Some(u) = q.pop_front() {
        visited += 1;
        let next_layer = layers[u] + 1;
        for &v in &adj[u] {
            if layers[v] < next_layer {
                layers[v] = next_layer;
            }
            in_deg[v] -= 1;
            if in_deg[v] == 0 {
                q.push_back(v);
            }
        }
    }

    // Defensive fallback if any edge somehow remained cyclic.
    if visited < n {
        for (i, deg) in in_deg.iter().enumerate() {
            if *deg > 0 {
                layers[i] = 0;
            }
        }
    }

    layers
}

fn minimize_crossings(by_layer: &mut [Vec<usize>], dag_edges: &[(usize, usize)], n: usize) {
    if by_layer.len() <= 1 {
        return;
    }
    let mut parents = vec![Vec::new(); n];
    let mut children = vec![Vec::new(); n];
    for &(u, v) in dag_edges {
        parents[v].push(u);
        children[u].push(v);
    }

    let mut pos = vec![0usize; n];
    let refresh_positions = |layers: &[Vec<usize>], pos: &mut [usize]| {
        for layer in layers {
            for (idx, &node) in layer.iter().enumerate() {
                pos[node] = idx;
            }
        }
    };

    refresh_positions(by_layer, &mut pos);

    for _sweep in 0..2 {
        // Top-down sweep
        for layer in by_layer.iter_mut().skip(1) {
            let mut keyed: Vec<(f32, usize)> = layer
                .iter()
                .map(|&node| {
                    let ps = &parents[node];
                    let avg = if ps.is_empty() {
                        pos[node] as f32
                    } else {
                        ps.iter().map(|&p| pos[p] as f32).sum::<f32>() / (ps.len() as f32)
                    };
                    (avg, node)
                })
                .collect();
            keyed.sort_by(|a, b| a.0.total_cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
            *layer = keyed.into_iter().map(|(_, node)| node).collect();
            for (idx, &node) in layer.iter().enumerate() {
                pos[node] = idx;
            }
        }

        // Bottom-up sweep
        let len = by_layer.len();
        for layer in by_layer[..len.saturating_sub(1)].iter_mut().rev() {
            let mut keyed: Vec<(f32, usize)> = layer
                .iter()
                .map(|&node| {
                    let cs = &children[node];
                    let avg = if cs.is_empty() {
                        pos[node] as f32
                    } else {
                        cs.iter().map(|&c| pos[c] as f32).sum::<f32>() / (cs.len() as f32)
                    };
                    (avg, node)
                })
                .collect();
            keyed.sort_by(|a, b| a.0.total_cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
            *layer = keyed.into_iter().map(|(_, node)| node).collect();
            for (idx, &node) in layer.iter().enumerate() {
                pos[node] = idx;
            }
        }
    }
}

/// Return table IDs within `hops` undirected steps of `center_id` (excluding rejected relations).
pub fn focus_subgraph(schema: &Schema, center_id: &str, hops: usize) -> HashSet<String> {
    let mut visible = HashSet::new();
    if schema.table_by_id(center_id).is_none() {
        return visible;
    }

    let mut adj: HashMap<&str, Vec<&str>> = HashMap::new();
    for rel in &schema.relations {
        if rel.status == RelationStatus::Rejected {
            continue;
        }
        adj.entry(rel.from_table.as_str())
            .or_default()
            .push(rel.to_table.as_str());
        adj.entry(rel.to_table.as_str())
            .or_default()
            .push(rel.from_table.as_str());
    }

    let mut queue = VecDeque::new();
    visible.insert(center_id.to_string());
    queue.push_back((center_id, 0usize));

    while let Some((cur, depth)) = queue.pop_front() {
        if depth >= hops {
            continue;
        }
        if let Some(nbrs) = adj.get(cur) {
            for &nxt in nbrs {
                if visible.insert(nxt.to_string()) {
                    queue.push_back((nxt, depth + 1));
                }
            }
        }
    }

    visible
}

#[cfg(test)]
mod tests {
    use super::*;
    use epibrhx_core::{Column, Dialect, Relation, TableKind, TypeFamily};

    fn make_table(name: &str, col_count: usize) -> Table {
        Table {
            id: format!("public.{name}"),
            schema: "public".to_string(),
            name: name.to_string(),
            kind: TableKind::Table,
            comment: None,
            columns: (0..col_count)
                .map(|i| Column {
                    name: format!("c{i}"),
                    data_type: "int".to_string(),
                    type_family: TypeFamily::Integer,
                    nullable: false,
                    default: None,
                    comment: None,
                })
                .collect(),
            primary_key: vec!["c0".to_string()],
            unique_keys: Vec::new(),
            indexes: Vec::new(),
        }
    }

    #[test]
    fn sugiyama_handles_cycles_without_node_overlap() {
        let mut schema = Schema::new(Dialect::Postgres);
        for name in ["a", "b", "c", "d"] {
            schema.tables.push(make_table(name, 4));
        }
        schema.relations.push(Relation::declared(
            "public.b",
            vec!["c0".to_string()],
            "public.a",
            vec!["c0".to_string()],
        ));
        schema.relations.push(Relation::declared(
            "public.c",
            vec!["c0".to_string()],
            "public.b",
            vec!["c0".to_string()],
        ));
        // Cycle back edge: a -> c
        schema.relations.push(Relation::declared(
            "public.a",
            vec!["c0".to_string()],
            "public.c",
            vec!["c0".to_string()],
        ));

        let layout = SugiyamaLayout.layout(&schema, &LayoutConfig::default());
        assert_eq!(layout.nodes.len(), 4);

        let boxes: Vec<NodeBox> = layout.nodes.values().copied().collect();
        for i in 0..boxes.len() {
            for j in (i + 1)..boxes.len() {
                let a = boxes[i];
                let b = boxes[j];
                let overlaps = a.x < b.x + b.width
                    && a.x + a.width > b.x
                    && a.y < b.y + b.height
                    && a.y + a.height > b.y;
                assert!(!overlaps, "nodes overlap: {a:?} vs {b:?}");
            }
        }
    }

    #[test]
    fn focus_subgraph_respects_hop_count() {
        let mut schema = Schema::new(Dialect::Postgres);
        for name in ["a", "b", "c", "d"] {
            schema.tables.push(make_table(name, 2));
        }
        schema.relations.push(Relation::declared(
            "public.b",
            vec!["c0".to_string()],
            "public.a",
            vec!["c0".to_string()],
        ));
        schema.relations.push(Relation::declared(
            "public.c",
            vec!["c0".to_string()],
            "public.b",
            vec!["c0".to_string()],
        ));
        schema.relations.push(Relation::declared(
            "public.d",
            vec!["c0".to_string()],
            "public.c",
            vec!["c0".to_string()],
        ));

        let hop1 = focus_subgraph(&schema, "public.a", 1);
        assert_eq!(
            hop1,
            ["public.a", "public.b"]
                .into_iter()
                .map(str::to_string)
                .collect()
        );
        let hop2 = focus_subgraph(&schema, "public.a", 2);
        assert_eq!(
            hop2,
            ["public.a", "public.b", "public.c"]
                .into_iter()
                .map(str::to_string)
                .collect()
        );
    }
}

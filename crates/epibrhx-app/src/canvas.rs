use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use epibrhx_core::{RelationKind, RelationStatus, TableKind};
use gpui_kit::base::StyledExt as _;
use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::{ActiveTheme as _, Sizable as _};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;
use web_time::Instant;

use crate::state::{AppState, DEFAULT_VISIBLE_COLS, RenderNodeKind};

const MIN_ZOOM: f32 = 0.08;
const MAX_ZOOM: f32 = 2.50;
const LOD_FULL_THRESHOLD: f32 = 0.45;
const LOD_TITLE_THRESHOLD: f32 = 0.18;

/// Pre-formatted immutable card metadata cached per `AppState` version.
#[derive(Clone)]
pub struct CachedTableVisual {
    pub id: String,
    pub title: SharedString,
    pub is_view: bool,
    pub group: String,
    pub rows: Vec<(SharedString, SharedString, bool)>,
    pub footer_label: Option<SharedString>,
}

#[derive(Clone, Copy)]
enum DragMode {
    Pan {
        last_pos: Point<Pixels>,
    },
    Node {
        node_idx: usize,
        node_kind_is_table: bool,
        last_pos: Point<Pixels>,
        moved: bool,
    },
}

/// Automated pan+zoom benchmark state preserved for performance regression checks.
#[derive(Clone)]
pub struct BenchRunner {
    pub active: bool,
    pub exit_on_done: bool,
    pub target_frames: usize,
    pub completed_frames: usize,
    pub start_time: Instant,
    pub last_frame_time: Instant,
    pub frame_times_ms: Vec<f32>,
    pub cpu_times_ms: Vec<f32>,
    pub scale_tables: usize,
    pub layout_ms: f32,
    pub first_frame_ms: Option<f32>,
    pub reported: bool,
}

impl BenchRunner {
    pub fn new(scale_tables: usize, layout_ms: f32) -> Self {
        let now = Instant::now();
        Self {
            active: false,
            exit_on_done: false,
            target_frames: 120,
            completed_frames: 0,
            start_time: now,
            last_frame_time: now,
            frame_times_ms: Vec::with_capacity(128),
            cpu_times_ms: Vec::with_capacity(128),
            scale_tables,
            layout_ms,
            first_frame_ms: None,
            reported: false,
        }
    }

    pub fn summary_line(&self) -> String {
        if self.frame_times_ms.is_empty() {
            return format!(
                "Tables: {} | Layout: {:.1}ms | FirstFrame: {}",
                self.scale_tables,
                self.layout_ms,
                self.first_frame_ms
                    .map(|v| format!("{v:.1}ms"))
                    .unwrap_or_else(|| "pending".into())
            );
        }
        let n = self.frame_times_ms.len() as f32;
        let sum: f32 = self.frame_times_ms.iter().sum();
        let mean_ms = sum / n;
        let fps = if mean_ms > 0.0 { 1000.0 / mean_ms } else { 0.0 };
        let mut sorted = self.frame_times_ms.clone();
        sorted.sort_by(f32::total_cmp);
        let p95 = sorted[((sorted.len() as f32 * 0.95) as usize).min(sorted.len() - 1)];
        let cpu_mean = if self.cpu_times_ms.is_empty() {
            0.0
        } else {
            self.cpu_times_ms.iter().sum::<f32>() / (self.cpu_times_ms.len() as f32)
        };
        format!(
            "Tables: {} | Layout: {:.1}ms | 1stFrame: {:.1}ms | Mean: {:.2}ms ({:.1} FPS) | P95: {:.2}ms | CPU: {:.2}ms ({}/{})",
            self.scale_tables,
            self.layout_ms,
            self.first_frame_ms.unwrap_or(0.0),
            mean_ms,
            fps,
            p95,
            cpu_mean,
            self.completed_frames,
            self.target_frames
        )
    }
}

/// Interactive ER diagram canvas view driven by [`AppState`].
pub struct ErCanvasView {
    pub app: Entity<AppState>,
    cached_version: u64,
    cached_tables: Arc<HashMap<String, CachedTableVisual>>,
    pub zoom: f32,
    pub pan_x: f32,
    pub pan_y: f32,
    pub canvas_bounds: Option<Bounds<Pixels>>,
    drag: Option<DragMode>,
    hover_pos: Option<Point<Pixels>>,
    hovered_edge_idx: Option<usize>,
    pub load_started_at: Instant,
    pub bench: BenchRunner,
    pub last_visible_nodes: usize,
    pub last_visible_edges: usize,
    _app_sub: Subscription,
}

impl ErCanvasView {
    pub fn new(app: Entity<AppState>, cx: &mut Context<Self>) -> Self {
        let load_started_at = Instant::now();
        let (table_count, layout_ms, viewport) = {
            let st = app.read(cx);
            (st.schema.tables.len(), st.layout_ms, st.config.viewport)
        };
        let initial_zoom = if viewport.zoom != 1.0 || viewport.pan_x != 0.0 || viewport.pan_y != 0.0
        {
            viewport.zoom.clamp(MIN_ZOOM, MAX_ZOOM)
        } else if table_count > 100 {
            0.65
        } else {
            1.0
        };
        let (pan_x, pan_y) =
            if viewport.zoom != 1.0 || viewport.pan_x != 0.0 || viewport.pan_y != 0.0 {
                (viewport.pan_x, viewport.pan_y)
            } else {
                (40.0, 40.0)
            };

        let _app_sub = cx.observe(&app, |this, _, cx| {
            this.sync_cache(cx);
            cx.notify();
        });

        let mut view = Self {
            app,
            cached_version: 0,
            cached_tables: Arc::new(HashMap::new()),
            zoom: initial_zoom,
            pan_x,
            pan_y,
            canvas_bounds: None,
            drag: None,
            hover_pos: None,
            hovered_edge_idx: None,
            load_started_at,
            bench: BenchRunner::new(table_count, layout_ms),
            last_visible_nodes: 0,
            last_visible_edges: 0,
            _app_sub,
        };
        view.sync_cache(cx);
        view
    }

    pub fn sync_cache(&mut self, cx: &App) {
        let st = self.app.read(cx);
        if self.cached_version == st.version {
            return;
        }
        let groups = st.resolved_table_groups();
        let mut map = HashMap::with_capacity(st.schema.tables.len());
        for tbl in &st.schema.tables {
            let pk_set: HashSet<&str> = tbl.primary_key.iter().map(String::as_str).collect();
            let expanded = st.expanded_tables.contains(&tbl.id);
            let limit = if expanded {
                tbl.columns.len()
            } else {
                DEFAULT_VISIBLE_COLS
            };
            let mut rows = Vec::with_capacity(tbl.columns.len().min(limit));
            for col in tbl.columns.iter().take(limit) {
                let is_pk = pk_set.contains(col.name.as_str());
                let name_label: SharedString = if is_pk {
                    format!("PK {}", col.name).into()
                } else {
                    col.name.clone().into()
                };
                let type_label: SharedString = col.data_type.clone().into();
                rows.push((name_label, type_label, is_pk));
            }
            let footer_label = if tbl.columns.len() > DEFAULT_VISIBLE_COLS {
                if expanded {
                    Some("Collapse columns".into())
                } else {
                    Some(
                        format!(
                            "+{} more columns (expand)",
                            tbl.columns.len() - DEFAULT_VISIBLE_COLS
                        )
                        .into(),
                    )
                }
            } else {
                None
            };
            map.insert(
                tbl.id.clone(),
                CachedTableVisual {
                    id: tbl.id.clone(),
                    title: tbl.name.clone().into(),
                    is_view: tbl.kind == TableKind::View,
                    group: groups
                        .get(&tbl.id)
                        .cloned()
                        .unwrap_or_else(|| "core".to_string()),
                    rows,
                    footer_label,
                },
            );
        }
        self.cached_tables = Arc::new(map);
        self.cached_version = st.version;
        self.bench.scale_tables = st.schema.tables.len();
        self.bench.layout_ms = st.layout_ms;
    }

    pub fn reset_camera_for_new_source(&mut self, cx: &App) {
        let st = self.app.read(cx);
        let vp = st.config.viewport;
        if vp.zoom != 1.0 || vp.pan_x != 0.0 || vp.pan_y != 0.0 {
            self.zoom = vp.zoom.clamp(MIN_ZOOM, MAX_ZOOM);
            self.pan_x = vp.pan_x;
            self.pan_y = vp.pan_y;
        } else {
            self.zoom = if st.schema.tables.len() > 100 {
                0.65
            } else {
                1.0
            };
            self.pan_x = 40.0;
            self.pan_y = 40.0;
        }
        self.load_started_at = Instant::now();
        self.bench = BenchRunner::new(st.schema.tables.len(), st.layout_ms);
    }

    pub fn start_benchmark(&mut self, exit_on_done: bool, cx: &mut Context<Self>) {
        let now = Instant::now();
        self.bench.active = true;
        self.bench.exit_on_done = exit_on_done;
        self.bench.completed_frames = 0;
        self.bench.start_time = now;
        self.bench.last_frame_time = now;
        self.bench.frame_times_ms.clear();
        self.bench.cpu_times_ms.clear();
        self.bench.reported = false;
        self.zoom = 0.75;
        self.pan_x = 40.0;
        self.pan_y = 40.0;
        cx.notify();
    }

    pub fn fit_to_view(&mut self, cx: &mut Context<Self>) {
        let (tw, th) = {
            let st = self.app.read(cx);
            (
                st.scene.total_width.max(1.0),
                st.scene.total_height.max(1.0),
            )
        };
        if let Some(bounds) = self.canvas_bounds {
            let vw = bounds.size.width.as_f32().max(200.0);
            let vh = bounds.size.height.as_f32().max(200.0);
            let z = ((vw * 0.9) / tw).min((vh * 0.9) / th).clamp(MIN_ZOOM, 1.0);
            self.zoom = z;
            self.pan_x = (vw - tw * z) * 0.5;
            self.pan_y = (vh - th * z) * 0.5;
            self.app.update(cx, |st, _| {
                st.target_pan = None;
                st.config.viewport.zoom = z;
                st.config.viewport.pan_x = self.pan_x;
                st.config.viewport.pan_y = self.pan_y;
            });
            cx.notify();
        }
    }

    pub fn jump_to_table(&mut self, table_id: &str, cx: &mut Context<Self>) {
        let (vw, vh) = self
            .canvas_bounds
            .map(|b| (b.size.width.as_f32(), b.size.height.as_f32()))
            .unwrap_or((900.0, 650.0));
        if self.zoom < 0.75 {
            self.zoom = 0.95;
        }
        let zoom = self.zoom;
        self.app.update(cx, |st, cx| {
            st.focus_and_flash_table(table_id, vw, vh, zoom);
            cx.notify();
        });
        cx.notify();
    }

    fn world_coords(&self, window_pos: Point<Pixels>) -> Option<(f32, f32)> {
        let origin = self.canvas_bounds?.origin;
        let wx = (window_pos.x.as_f32() - origin.x.as_f32() - self.pan_x) / self.zoom;
        let wy = (window_pos.y.as_f32() - origin.y.as_f32() - self.pan_y) / self.zoom;
        Some((wx, wy))
    }

    fn hit_test_node(&self, window_pos: Point<Pixels>, cx: &App) -> Option<usize> {
        let (wx, wy) = self.world_coords(window_pos)?;
        let st = self.app.read(cx);
        st.scene.nodes.iter().rposition(|n| {
            wx >= n.bounds.x
                && wx <= n.bounds.x + n.bounds.width
                && wy >= n.bounds.y
                && wy <= n.bounds.y + n.bounds.height
        })
    }

    fn hit_test_edge(&self, window_pos: Point<Pixels>, cx: &App) -> Option<usize> {
        let origin = self.canvas_bounds?.origin;
        let sx_ptr = window_pos.x.as_f32();
        let sy_ptr = window_pos.y.as_f32();
        let ox = origin.x.as_f32() + self.pan_x;
        let oy = origin.y.as_f32() + self.pan_y;
        let zoom = self.zoom;
        let st = self.app.read(cx);

        let mut best: Option<(usize, f32)> = None;
        for (idx, edge) in st.scene.edges.iter().enumerate() {
            let from_b = st.scene.nodes[edge.from_node_idx].bounds;
            let to_b = st.scene.nodes[edge.to_node_idx].bounds;
            let dist = if edge.from_node_idx == edge.to_node_idx {
                let sx = ox + (from_b.x + from_b.width) * zoom;
                let sy = oy + (from_b.y + 18.0 * zoom.max(0.5)) * zoom;
                let loop_w = 18.0 * zoom;
                let loop_h = 22.0 * zoom;
                point_to_seg_dist(sx_ptr, sy_ptr, sx, sy, sx + loop_w, sy)
                    .min(point_to_seg_dist(
                        sx_ptr,
                        sy_ptr,
                        sx + loop_w,
                        sy,
                        sx + loop_w,
                        sy + loop_h,
                    ))
                    .min(point_to_seg_dist(
                        sx_ptr,
                        sy_ptr,
                        sx + loop_w,
                        sy + loop_h,
                        sx,
                        sy + loop_h,
                    ))
            } else {
                let (fx, fy) = from_b.center();
                let (tx, ty) = to_b.center();
                let sx = ox + fx * zoom;
                let sy = oy + fy * zoom;
                let ex = ox + tx * zoom;
                let ey = oy + ty * zoom;
                let mid_y = (sy + ey) * 0.5;
                point_to_seg_dist(sx_ptr, sy_ptr, sx, sy, sx, mid_y)
                    .min(point_to_seg_dist(sx_ptr, sy_ptr, sx, mid_y, ex, mid_y))
                    .min(point_to_seg_dist(sx_ptr, sy_ptr, ex, mid_y, ex, ey))
            };
            if dist <= 7.0 && best.is_none_or(|(_, d)| dist < d) {
                best = Some((idx, dist));
            }
        }
        best.map(|(i, _)| i)
    }

    fn on_mouse_down(&mut self, event: &MouseDownEvent, _: &mut Window, cx: &mut Context<Self>) {
        if event.button != MouseButton::Left && event.button != MouseButton::Middle {
            return;
        }
        if event.button == MouseButton::Left
            && let Some(node_idx) = self.hit_test_node(event.position, cx)
        {
            let world_pt = self.world_coords(event.position);
            let mut toggled_expand_or_group = false;
            let mut is_table = false;

            self.app.update(cx, |st, cx| {
                st.target_pan = None;
                let node = st.scene.nodes[node_idx].clone();
                match node.kind {
                    RenderNodeKind::Table { table_idx, .. } => {
                        is_table = true;
                        let has_footer = st
                            .schema
                            .tables
                            .get(table_idx)
                            .is_some_and(|t| t.columns.len() > DEFAULT_VISIBLE_COLS);
                        let in_footer = has_footer
                            && world_pt.is_some_and(|(_, wy)| {
                                wy >= node.bounds.y + node.bounds.height - 24.0
                            });
                        if in_footer {
                            st.toggle_table_expanded(&node.id);
                            toggled_expand_or_group = true;
                        } else {
                            st.select_table(Some(node.id.clone()));
                        }
                    }
                    RenderNodeKind::CollapsedGroup { group, .. } => {
                        if event.click_count >= 2 {
                            st.toggle_group_collapsed(&group);
                            toggled_expand_or_group = true;
                        }
                    }
                }
                cx.notify();
            });

            if !toggled_expand_or_group {
                self.drag = Some(DragMode::Node {
                    node_idx,
                    node_kind_is_table: is_table,
                    last_pos: event.position,
                    moved: false,
                });
            }
            cx.notify();
            return;
        }

        if event.button == MouseButton::Left
            && let Some(edge_idx) = self.hit_test_edge(event.position, cx)
        {
            self.app.update(cx, |st, cx| {
                st.target_pan = None;
                if let Some(edge) = st.scene.edges.get(edge_idx) {
                    let rid = edge.relation_id.clone();
                    st.select_relation(Some(rid));
                    cx.notify();
                }
            });
            cx.notify();
            return;
        }

        self.app.update(cx, |st, cx| {
            st.target_pan = None;
            st.select_table(None);
            cx.notify();
        });
        self.drag = Some(DragMode::Pan {
            last_pos: event.position,
        });
        cx.notify();
    }

    fn on_mouse_move(&mut self, event: &MouseMoveEvent, _: &mut Window, cx: &mut Context<Self>) {
        self.hover_pos = Some(event.position);
        let Some(mode) = self.drag else {
            let prev_hover = self.hovered_edge_idx;
            let next_hover = if self.hit_test_node(event.position, cx).is_some() {
                None
            } else {
                self.hit_test_edge(event.position, cx)
            };
            if prev_hover != next_hover {
                self.hovered_edge_idx = next_hover;
                let rid = next_hover.and_then(|idx| {
                    self.app
                        .read(cx)
                        .scene
                        .edges
                        .get(idx)
                        .map(|e| e.relation_id.clone())
                });
                self.app.update(cx, |st, _| st.hovered_relation_id = rid);
                cx.notify();
            }
            return;
        };

        if !event.dragging() {
            self.drag = None;
            return;
        }

        match mode {
            DragMode::Pan { last_pos } => {
                let dx = event.position.x.as_f32() - last_pos.x.as_f32();
                let dy = event.position.y.as_f32() - last_pos.y.as_f32();
                self.pan_x += dx;
                self.pan_y += dy;
                self.drag = Some(DragMode::Pan {
                    last_pos: event.position,
                });
                cx.notify();
            }
            DragMode::Node {
                node_idx,
                node_kind_is_table,
                last_pos,
                moved,
            } => {
                let dx = (event.position.x.as_f32() - last_pos.x.as_f32()) / self.zoom;
                let dy = (event.position.y.as_f32() - last_pos.y.as_f32()) / self.zoom;
                let next_moved = moved || dx.abs() > 0.2 || dy.abs() > 0.2;
                self.app.update(cx, |st, _| {
                    if let Some(node) = st.scene.nodes.get_mut(node_idx) {
                        node.bounds.x += dx;
                        node.bounds.y += dy;
                        let nid = node.id.clone();
                        let nx = node.bounds.x;
                        let ny = node.bounds.y;
                        st.set_node_position(&nid, nx, ny);
                    }
                });
                self.drag = Some(DragMode::Node {
                    node_idx,
                    node_kind_is_table,
                    last_pos: event.position,
                    moved: next_moved,
                });
                cx.notify();
            }
        }
    }

    fn on_mouse_up(&mut self, _: &MouseUpEvent, _: &mut Window, cx: &mut Context<Self>) {
        if let Some(DragMode::Node {
            node_idx,
            node_kind_is_table,
            moved,
            ..
        }) = self.drag.take()
            && moved
        {
            let zoom = self.zoom;
            let pan_x = self.pan_x;
            let pan_y = self.pan_y;
            self.app.update(cx, |st, cx| {
                if node_kind_is_table && let Some(node) = st.scene.nodes.get(node_idx).cloned() {
                    let (cx_w, cy_w) = node.bounds.center();
                    let _ = st.try_drop_table_into_other_group(&node.id, cx_w, cy_w);
                }
                st.commit_node_positions_and_viewport(zoom, pan_x, pan_y);
                cx.notify();
            });
            cx.notify();
        } else {
            self.drag = None;
        }
    }

    fn on_scroll_wheel(&mut self, event: &ScrollEvent, _: &mut Window, cx: &mut Context<Self>) {
        let delta = event.delta.pixel_delta(px(18.0));
        let dy = delta.y.as_f32();
        if dy.abs() < f32::EPSILON {
            return;
        }

        let origin = self.canvas_bounds.map(|b| b.origin).unwrap_or_default();
        let local_x = event.position.x.as_f32() - origin.x.as_f32();
        let local_y = event.position.y.as_f32() - origin.y.as_f32();
        let world_x = (local_x - self.pan_x) / self.zoom;
        let world_y = (local_y - self.pan_y) / self.zoom;

        let factor = (1.0 + dy * 0.0025).clamp(0.75, 1.35);
        let next_zoom = (self.zoom * factor).clamp(MIN_ZOOM, MAX_ZOOM);
        self.zoom = next_zoom;
        self.pan_x = local_x - world_x * next_zoom;
        self.pan_y = local_y - world_y * next_zoom;
        self.app.update(cx, |st, _| {
            st.target_pan = None;
            st.config.viewport.zoom = next_zoom;
            st.config.viewport.pan_x = self.pan_x;
            st.config.viewport.pan_y = self.pan_y;
        });
        cx.notify();
    }

    fn step_animations(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let mut animate = false;
        self.app.update(cx, |st, _| {
            if let Some((tx, ty)) = st.target_pan {
                let dx = tx - self.pan_x;
                let dy = ty - self.pan_y;
                if dx.abs() < 0.75 && dy.abs() < 0.75 {
                    self.pan_x = tx;
                    self.pan_y = ty;
                    st.target_pan = None;
                } else {
                    self.pan_x += dx * 0.25;
                    self.pan_y += dy * 0.25;
                    animate = true;
                }
            }
            if let Some((_, started)) = st.flash_table {
                if started.elapsed().as_millis() < 1600 {
                    animate = true;
                } else {
                    st.flash_table = None;
                }
            }
        });
        if animate {
            window.request_animation_frame();
        }
    }

    fn advance_benchmark(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.bench.active {
            return;
        }
        let now = Instant::now();
        if self.bench.completed_frames > 0 {
            let dt_ms = now.duration_since(self.bench.last_frame_time).as_secs_f32() * 1000.0;
            self.bench.frame_times_ms.push(dt_ms);
        }
        self.bench.last_frame_time = now;

        if self.bench.completed_frames < self.bench.target_frames {
            let phase = (self.bench.completed_frames as f32) * 0.08;
            self.pan_x = 40.0 - (phase.sin().abs() * 1200.0) - (phase * 18.0);
            self.pan_y = 40.0 - (phase.cos().abs() * 600.0);
            self.zoom = if self.bench.completed_frames % 40 < 20 {
                0.75
            } else {
                0.55
            };
            self.bench.completed_frames += 1;
            window.request_animation_frame();
        } else {
            self.bench.active = false;
            if !self.bench.reported {
                self.bench.reported = true;
                tracing::info!("PHASE4_BENCH: {}", self.bench.summary_line());
                println!("PHASE4_BENCH: {}", self.bench.summary_line());
                if self.bench.exit_on_done {
                    cx.quit();
                }
            }
        }
    }
}

impl Render for ErCanvasView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.sync_cache(cx);
        self.step_animations(window, cx);
        self.advance_benchmark(window, cx);

        let view_entity = cx.entity();
        let zoom = self.zoom;
        let pan_x = self.pan_x;
        let pan_y = self.pan_y;
        let cached_tables = self.cached_tables.clone();
        let hovered_edge_idx = self.hovered_edge_idx;

        let theme = cx.theme();
        let canvas_bg = theme.background;
        let card_bg = theme.popover;
        let header_bg = theme.secondary;
        let view_header_bg = theme.accent;
        let group_bg = theme.secondary.alpha(0.35);
        let group_border = theme.border;
        let card_border_default = theme.border;
        let selected_border = theme.primary;
        let flash_border = theme.warning;
        let confirmed_accent = theme.success;
        let inferred_line = theme.warning;
        let line_declared = theme.muted_foreground.alpha(0.72);
        let fg_color = theme.foreground;
        let muted_fg = theme.muted_foreground;

        let (selected_table_id, selected_rel, hov_rel) = {
            let st = self.app.read(cx);
            let sel_rel = st
                .selected_relation_id
                .as_deref()
                .and_then(|id| st.relation_by_id(id).cloned());
            let hov_rel = hovered_edge_idx
                .and_then(|idx| st.scene.edges.get(idx))
                .and_then(|e| st.relation_by_id(&e.relation_id).cloned())
                .or_else(|| {
                    st.hovered_relation_id
                        .as_deref()
                        .and_then(|id| st.relation_by_id(id).cloned())
                });
            (st.selected_table_id.clone(), sel_rel, hov_rel)
        };

        let app_for_overlay = self.app.clone();
        let tooltip_rel = hov_rel.or(selected_rel.clone());

        div()
            .id("er-canvas-root")
            .relative()
            .size_full()
            .overflow_hidden()
            .bg(canvas_bg)
            .on_mouse_down(MouseButton::Left, cx.listener(Self::on_mouse_down))
            .on_mouse_down(MouseButton::Middle, cx.listener(Self::on_mouse_down))
            .on_mouse_move(cx.listener(Self::on_mouse_move))
            .on_mouse_up(MouseButton::Left, cx.listener(Self::on_mouse_up))
            .on_mouse_up(MouseButton::Middle, cx.listener(Self::on_mouse_up))
            .on_scroll(cx.listener(Self::on_scroll_wheel))
            .child(
                canvas(
                    move |bounds, _, cx| {
                        let frame_cpu_start = Instant::now();
                        view_entity.update(cx, |this, _| {
                            this.canvas_bounds = Some(bounds);
                            if this.bench.first_frame_ms.is_none() {
                                this.bench.first_frame_ms =
                                    Some(this.load_started_at.elapsed().as_secs_f32() * 1000.0);
                            }
                        });

                        let app_handle = view_entity.read(cx).app.clone();
                        let st = app_handle.read(cx);
                        let vw = bounds.size.width.as_f32().max(1.0);
                        let vh = bounds.size.height.as_f32().max(1.0);
                        let view_left = -pan_x / zoom - 120.0;
                        let view_top = -pan_y / zoom - 120.0;
                        let view_right = (vw - pan_x) / zoom + 120.0;
                        let view_bottom = (vh - pan_y) / zoom + 120.0;

                        let visible_nodes: Vec<usize> = st
                            .scene
                            .nodes
                            .iter()
                            .enumerate()
                            .filter_map(|(i, n)| {
                                let b = n.bounds;
                                if b.x + b.width >= view_left
                                    && b.x <= view_right
                                    && b.y + b.height >= view_top
                                    && b.y <= view_bottom
                                {
                                    Some(i)
                                } else {
                                    None
                                }
                            })
                            .collect();

                        let visible_edges: Vec<usize> = st
                            .scene
                            .edges
                            .iter()
                            .enumerate()
                            .filter_map(|(i, e)| {
                                let (fx, fy) = st.scene.nodes[e.from_node_idx].bounds.center();
                                let (tx, ty) = st.scene.nodes[e.to_node_idx].bounds.center();
                                if fx.max(tx) >= view_left
                                    && fx.min(tx) <= view_right
                                    && fy.max(ty) >= view_top
                                    && fy.min(ty) <= view_bottom
                                {
                                    Some(i)
                                } else {
                                    None
                                }
                            })
                            .collect();

                        let scene_snapshot = st.scene.clone();
                        let flashes: HashMap<usize, f32> = visible_nodes
                            .iter()
                            .filter_map(|&idx| {
                                st.flash_intensity_for(&scene_snapshot.nodes[idx])
                                    .map(|v| (idx, v))
                            })
                            .collect();
                        let selected_rel_id = st.selected_relation_id.clone();

                        view_entity.update(cx, |this, _| {
                            this.last_visible_nodes = visible_nodes.len();
                            this.last_visible_edges = visible_edges.len();
                        });

                        (
                            bounds,
                            scene_snapshot,
                            visible_nodes,
                            visible_edges,
                            flashes,
                            selected_rel_id,
                            view_entity,
                            frame_cpu_start,
                        )
                    },
                    move |_,
                          (
                        bounds,
                        scene,
                        visible_nodes,
                        visible_edges,
                        flashes,
                        selected_rel_id,
                        view_entity,
                        frame_cpu_start,
                    ),
                          window,
                          cx| {
                        let base_font = window.text_style().font();
                        window.with_content_mask(Some(ContentMask { bounds }), |window| {
                            let ox = bounds.origin.x.as_f32() + pan_x;
                            let oy = bounds.origin.y.as_f32() + pan_y;

                            // 1. Domain Group Containers (drawn behind edges & cards when auto-grouped).
                            for container in &scene.containers {
                                let gx = ox + container.x * zoom;
                                let gy = oy + container.y * zoom;
                                let gw = container.width * zoom;
                                let gh = container.height * zoom;
                                let c_bounds = Bounds {
                                    origin: point(px(gx), px(gy)),
                                    size: size(px(gw), px(gh)),
                                };
                                window.paint_quad(quad(
                                    c_bounds,
                                    Corners::all(px((10.0 * zoom).clamp(3.0, 12.0))),
                                    group_bg,
                                    Edges::all(px(1.0)),
                                    group_border,
                                    BorderStyle::Solid,
                                ));
                                if zoom >= LOD_TITLE_THRESHOLD {
                                    let lbl: SharedString =
                                        format!("{} ({})", container.name, container.table_count)
                                            .into();
                                    let label_px = (11.0 * zoom).clamp(8.0, 13.0);
                                    let run = TextRun {
                                        len: lbl.len(),
                                        font: base_font.clone(),
                                        color: muted_fg,
                                        ..Default::default()
                                    };
                                    let shaped = window.text_system().shape_line(
                                        lbl,
                                        px(label_px),
                                        &[run],
                                        Some(px((gw - 16.0).max(20.0))),
                                    );
                                    let _ = shaped.paint(
                                        point(px(gx + 10.0 * zoom), px(gy + 4.0 * zoom)),
                                        px(label_px * 1.3),
                                        TextAlign::Left,
                                        None,
                                        window,
                                        cx,
                                    );
                                }
                            }

                            // 2. Paint edges (solid declared, dashed inferred-auto, accented solid confirmed).
                            for &edge_idx in &visible_edges {
                                let edge = &scene.edges[edge_idx];
                                let from_b = scene.nodes[edge.from_node_idx].bounds;
                                let to_b = scene.nodes[edge.to_node_idx].bounds;
                                let is_hovered = hovered_edge_idx == Some(edge_idx);
                                let is_edge_selected =
                                    selected_rel_id.as_deref() == Some(edge.relation_id.as_str());
                                let is_hl = is_hovered
                                    || is_edge_selected
                                    || scene.highlighted_edges.contains(&edge_idx);
                                let dim = scene.has_selection_highlight && !is_hl;

                                let dashed = edge.kind == RelationKind::Inferred
                                    && edge.status != RelationStatus::Confirmed;
                                let mut color = if is_hovered || is_edge_selected {
                                    selected_border
                                } else if edge.kind == RelationKind::Inferred
                                    && edge.status == RelationStatus::Confirmed
                                {
                                    confirmed_accent
                                } else if dashed {
                                    inferred_line
                                } else {
                                    line_declared
                                };
                                if dim {
                                    color = color.alpha(0.18);
                                }
                                let stroke_w = if is_hovered || is_edge_selected {
                                    (2.6 * zoom).clamp(1.6, 3.6)
                                } else if is_hl && scene.has_selection_highlight {
                                    (2.2 * zoom).clamp(1.4, 3.0)
                                } else {
                                    (1.5 * zoom).clamp(1.0, 2.4)
                                };

                                if edge.from_node_idx == edge.to_node_idx {
                                    let sx = ox + (from_b.x + from_b.width) * zoom;
                                    let sy = oy + (from_b.y + 18.0 * zoom.max(0.5)) * zoom;
                                    let loop_w = 18.0 * zoom;
                                    let loop_h = 22.0 * zoom;
                                    paint_ortho_seg(
                                        window,
                                        sx,
                                        sy,
                                        sx + loop_w,
                                        sy,
                                        stroke_w,
                                        color,
                                        dashed,
                                    );
                                    paint_ortho_seg(
                                        window,
                                        sx + loop_w,
                                        sy,
                                        sx + loop_w,
                                        sy + loop_h,
                                        stroke_w,
                                        color,
                                        dashed,
                                    );
                                    paint_ortho_seg(
                                        window,
                                        sx + loop_w,
                                        sy + loop_h,
                                        sx,
                                        sy + loop_h,
                                        stroke_w,
                                        color,
                                        dashed,
                                    );
                                    continue;
                                }

                                let (fx, fy) = from_b.center();
                                let (tx, ty) = to_b.center();
                                let sx = ox + fx * zoom;
                                let sy = oy + fy * zoom;
                                let ex = ox + tx * zoom;
                                let ey = oy + ty * zoom;
                                let mid_y = (sy + ey) * 0.5;
                                paint_ortho_seg(window, sx, sy, sx, mid_y, stroke_w, color, dashed);
                                paint_ortho_seg(
                                    window, sx, mid_y, ex, mid_y, stroke_w, color, dashed,
                                );
                                paint_ortho_seg(window, ex, mid_y, ex, ey, stroke_w, color, dashed);

                                // Confirmed inferred edge midpoint badge
                                if edge.kind == RelationKind::Inferred
                                    && edge.status == RelationStatus::Confirmed
                                    && zoom >= LOD_TITLE_THRESHOLD
                                {
                                    let mx = (sx + ex) * 0.5;
                                    let badge_r = (5.0 * zoom).clamp(3.0, 6.0);
                                    window.paint_quad(quad(
                                        Bounds {
                                            origin: point(px(mx - badge_r), px(mid_y - badge_r)),
                                            size: size(px(badge_r * 2.0), px(badge_r * 2.0)),
                                        },
                                        Corners::all(px(badge_r)),
                                        confirmed_accent,
                                        Edges::all(px(1.0)),
                                        card_bg,
                                        BorderStyle::Solid,
                                    ));
                                }
                            }

                            // 3. Paint visible nodes (Table cards or CollapsedGroup cards).
                            let show_cols = zoom >= LOD_FULL_THRESHOLD;
                            let show_title = zoom >= LOD_TITLE_THRESHOLD;
                            let title_px = (12.5 * zoom).clamp(7.0, 18.0);
                            let col_px = (11.0 * zoom).clamp(7.0, 15.0);
                            let title_lh = px(title_px * 1.25);
                            let col_lh = px(col_px * 1.3);

                            for &node_idx in &visible_nodes {
                                let node = &scene.nodes[node_idx];
                                let b = node.bounds;
                                let x = ox + b.x * zoom;
                                let y = oy + b.y * zoom;
                                let w = b.width * zoom;
                                let h = b.height * zoom;
                                let is_selected =
                                    selected_table_id.as_deref() == Some(node.id.as_str());
                                let is_hl =
                                    is_selected || scene.highlighted_nodes.contains(&node_idx);
                                let dim = scene.has_selection_highlight && !is_hl;
                                let flash = flashes.get(&node_idx).copied();

                                let card_bounds = Bounds {
                                    origin: point(px(x), px(y)),
                                    size: size(px(w), px(h)),
                                };

                                if let Some(intensity) = flash {
                                    let glow = 4.0 + intensity * 6.0;
                                    window.paint_quad(quad(
                                        Bounds {
                                            origin: point(px(x - glow), px(y - glow)),
                                            size: size(px(w + glow * 2.0), px(h + glow * 2.0)),
                                        },
                                        Corners::all(px(10.0)),
                                        flash_border.alpha(0.28 * intensity),
                                        Edges::all(px(2.5)),
                                        flash_border.alpha(0.85 * intensity),
                                        BorderStyle::Solid,
                                    ));
                                }

                                let card_border = if flash.is_some() {
                                    flash_border
                                } else if is_selected {
                                    selected_border
                                } else if scene.has_selection_highlight && is_hl {
                                    selected_border.alpha(0.75)
                                } else if dim {
                                    card_border_default.alpha(0.35)
                                } else {
                                    card_border_default
                                };
                                let border_w = if is_selected || flash.is_some() {
                                    px(2.2)
                                } else {
                                    px(1.0)
                                };
                                let alpha_mul = if dim { 0.35 } else { 1.0 };

                                if !show_title {
                                    let block_bg = header_bg.alpha(alpha_mul);
                                    window.paint_quad(quad(
                                        card_bounds,
                                        Corners::all(px(2.0)),
                                        block_bg,
                                        Edges::all(px(1.0)),
                                        card_border,
                                        BorderStyle::Solid,
                                    ));
                                    continue;
                                }

                                window.paint_quad(quad(
                                    card_bounds,
                                    Corners::all(px((6.0 * zoom).clamp(2.0, 8.0))),
                                    card_bg.alpha(alpha_mul),
                                    Edges::all(border_w),
                                    card_border,
                                    BorderStyle::Solid,
                                ));

                                match &node.kind {
                                    RenderNodeKind::CollapsedGroup { group, table_ids } => {
                                        let hdr_h = (30.0 * zoom).min(h);
                                        window.paint_quad(fill(
                                            Bounds {
                                                origin: point(px(x), px(y)),
                                                size: size(px(w), px(hdr_h)),
                                            },
                                            view_header_bg.alpha(alpha_mul),
                                        ));
                                        let pad_x = (10.0 * zoom).clamp(3.0, 12.0);
                                        let title: SharedString = format!("Group: {group}").into();
                                        let sub: SharedString = format!(
                                            "{} tables (double-click to expand)",
                                            table_ids.len()
                                        )
                                        .into();
                                        let run = TextRun {
                                            len: title.len(),
                                            font: base_font.clone(),
                                            color: fg_color.alpha(alpha_mul),
                                            ..Default::default()
                                        };
                                        let shaped = window.text_system().shape_line(
                                            title,
                                            px(title_px),
                                            &[run],
                                            Some(px((w - pad_x * 2.0).max(16.0))),
                                        );
                                        let _ = shaped.paint(
                                            point(
                                                px(x + pad_x),
                                                px(y + ((hdr_h - title_lh.as_f32()) * 0.5)
                                                    .max(1.0)),
                                            ),
                                            title_lh,
                                            TextAlign::Left,
                                            None,
                                            window,
                                            cx,
                                        );
                                        if show_cols {
                                            let sub_run = TextRun {
                                                len: sub.len(),
                                                font: base_font.clone(),
                                                color: muted_fg.alpha(alpha_mul),
                                                ..Default::default()
                                            };
                                            let shaped_sub = window.text_system().shape_line(
                                                sub,
                                                px(col_px),
                                                &[sub_run],
                                                Some(px((w - pad_x * 2.0).max(16.0))),
                                            );
                                            let _ = shaped_sub.paint(
                                                point(px(x + pad_x), px(y + hdr_h + 10.0 * zoom)),
                                                col_lh,
                                                TextAlign::Left,
                                                None,
                                                window,
                                                cx,
                                            );
                                        }
                                    }
                                    RenderNodeKind::Table { .. } => {
                                        let Some(tbl) = cached_tables.get(&node.id) else {
                                            continue;
                                        };
                                        let hdr_h =
                                            if show_cols { (32.0 * zoom).min(h) } else { h };
                                        window.paint_quad(fill(
                                            Bounds {
                                                origin: point(px(x), px(y)),
                                                size: size(px(w), px(hdr_h)),
                                            },
                                            if tbl.is_view {
                                                view_header_bg.alpha(alpha_mul)
                                            } else {
                                                header_bg.alpha(alpha_mul)
                                            },
                                        ));

                                        let pad_x = (10.0 * zoom).clamp(3.0, 12.0);
                                        let title_origin = point(
                                            px(x + pad_x),
                                            px(y + ((hdr_h - title_lh.as_f32()) * 0.5).max(1.0)),
                                        );
                                        let title_run = TextRun {
                                            len: tbl.title.len(),
                                            font: base_font.clone(),
                                            color: fg_color.alpha(alpha_mul),
                                            ..Default::default()
                                        };
                                        let shaped_title = window.text_system().shape_line(
                                            tbl.title.clone(),
                                            px(title_px),
                                            &[title_run],
                                            Some(px((w - pad_x * 2.0).max(16.0))),
                                        );
                                        let _ = shaped_title.paint(
                                            title_origin,
                                            title_lh,
                                            TextAlign::Left,
                                            None,
                                            window,
                                            cx,
                                        );

                                        if !show_cols {
                                            continue;
                                        }

                                        let row_step = 20.0 * zoom;
                                        let mut row_y = y + hdr_h + 4.0 * zoom;
                                        for (name_label, type_label, is_pk) in &tbl.rows {
                                            let row_color = if *is_pk {
                                                selected_border.alpha(alpha_mul)
                                            } else {
                                                fg_color.alpha(alpha_mul)
                                            };
                                            let name_run = TextRun {
                                                len: name_label.len(),
                                                font: base_font.clone(),
                                                color: row_color,
                                                ..Default::default()
                                            };
                                            let shaped_name = window.text_system().shape_line(
                                                name_label.clone(),
                                                px(col_px),
                                                &[name_run],
                                                Some(px((w * 0.58).max(12.0))),
                                            );
                                            let _ = shaped_name.paint(
                                                point(px(x + pad_x), px(row_y)),
                                                col_lh,
                                                TextAlign::Left,
                                                None,
                                                window,
                                                cx,
                                            );

                                            let type_run = TextRun {
                                                len: type_label.len(),
                                                font: base_font.clone(),
                                                color: muted_fg.alpha(alpha_mul),
                                                ..Default::default()
                                            };
                                            let shaped_type = window.text_system().shape_line(
                                                type_label.clone(),
                                                px(col_px),
                                                &[type_run],
                                                Some(px((w * 0.36).max(12.0))),
                                            );
                                            let type_x =
                                                (x + w - pad_x - shaped_type.width().as_f32())
                                                    .max(x + w * 0.55);
                                            let _ = shaped_type.paint(
                                                point(px(type_x), px(row_y)),
                                                col_lh,
                                                TextAlign::Left,
                                                None,
                                                window,
                                                cx,
                                            );

                                            row_y += row_step;
                                        }

                                        if let Some(footer_label) = &tbl.footer_label {
                                            let footer_run = TextRun {
                                                len: footer_label.len(),
                                                font: base_font.clone(),
                                                color: selected_border.alpha(alpha_mul),
                                                ..Default::default()
                                            };
                                            let shaped_more = window.text_system().shape_line(
                                                footer_label.clone(),
                                                px(col_px),
                                                &[footer_run],
                                                Some(px((w - pad_x * 2.0).max(12.0))),
                                            );
                                            let _ = shaped_more.paint(
                                                point(px(x + pad_x), px(row_y)),
                                                col_lh,
                                                TextAlign::Left,
                                                None,
                                                window,
                                                cx,
                                            );
                                        }
                                    }
                                }
                            }
                        });

                        let cpu_ms = frame_cpu_start.elapsed().as_secs_f32() * 1000.0;
                        view_entity.update(cx, |this, _| {
                            if this.bench.active {
                                this.bench.cpu_times_ms.push(cpu_ms);
                            }
                        });
                    },
                )
                .absolute()
                .size_full(),
            )
            // Floating relation evidence tooltip + direct Confirm/Reject/Reset actions (P5-T3 & P5-T8)
            .when_some(tooltip_rel, |el, rel| {
                let is_selected = selected_rel.as_ref().is_some_and(|s| s.id == rel.id);
                let kind_badge = match (rel.kind, rel.status) {
                    (RelationKind::Declared, _) => "Declared FK",
                    (RelationKind::Inferred, RelationStatus::Auto) => "Inferred (Auto)",
                    (RelationKind::Inferred, RelationStatus::Confirmed) => "Inferred (Confirmed)",
                    (RelationKind::Inferred, RelationStatus::Rejected) => "Rejected",
                };
                let evidence_text = if rel.evidence.is_empty() {
                    "Declared in schema metadata / DDL".to_string()
                } else {
                    rel.evidence.join(" · ")
                };
                let rel_id = rel.id.clone();
                let app_confirm = app_for_overlay.clone();
                let app_reject = app_for_overlay.clone();
                let app_reset = app_for_overlay.clone();

                el.child(
                    div()
                        .absolute()
                        .bottom_3()
                        .left_3()
                        .max_w(px(560.0))
                        .p_2p5()
                        .rounded(px(8.0))
                        .bg(theme.popover.alpha(0.96))
                        .border_1()
                        .border_color(if is_selected {
                            theme.primary
                        } else {
                            theme.border
                        })
                        .flex()
                        .flex_col()
                        .gap_1p5()
                        .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                        .child(
                            div()
                                .flex()
                                .flex_row()
                                .items_center()
                                .justify_between()
                                .gap_3()
                                .child(
                                    div()
                                        .text_xs()
                                        .font_semibold()
                                        .text_color(theme.foreground)
                                        .child(format!(
                                            "{} ({}) → {} ({})",
                                            rel.from_table,
                                            rel.from_columns.join(", "),
                                            rel.to_table,
                                            rel.to_columns.join(", ")
                                        )),
                                )
                                .child(
                                    div()
                                        .text_xs()
                                        .px_1p5()
                                        .py_0p5()
                                        .rounded(px(4.0))
                                        .bg(theme.secondary)
                                        .text_color(theme.secondary_foreground)
                                        .child(kind_badge),
                                ),
                        )
                        .child(
                            div()
                                .text_xs()
                                .text_color(theme.muted_foreground)
                                .child(evidence_text),
                        )
                        .when(rel.kind == RelationKind::Inferred, |card| {
                            let id_c = rel_id.clone();
                            let id_r = rel_id.clone();
                            let id_z = rel_id.clone();
                            card.child(
                                div()
                                    .flex()
                                    .flex_row()
                                    .items_center()
                                    .gap_2()
                                    .when(rel.status != RelationStatus::Confirmed, |row| {
                                        row.child(
                                            Button::new("edge-confirm")
                                                .xsmall()
                                                .primary()
                                                .label("Confirm Relation")
                                                .on_click(move |_, _, cx| {
                                                    app_confirm.update(cx, |st, cx| {
                                                        st.confirm_relation(&id_c);
                                                        cx.notify();
                                                    });
                                                }),
                                        )
                                    })
                                    .child(
                                        Button::new("edge-reject")
                                            .xsmall()
                                            .danger()
                                            .label("Reject")
                                            .on_click(move |_, _, cx| {
                                                app_reject.update(cx, |st, cx| {
                                                    st.reject_relation(&id_r);
                                                    cx.notify();
                                                });
                                            }),
                                    )
                                    .when(rel.status == RelationStatus::Confirmed, |row| {
                                        row.child(
                                            Button::new("edge-reset")
                                                .xsmall()
                                                .label("Reset Auto")
                                                .on_click(move |_, _, cx| {
                                                    app_reset.update(cx, |st, cx| {
                                                        st.reset_relation(&id_z);
                                                        cx.notify();
                                                    });
                                                }),
                                        )
                                    }),
                            )
                        }),
                )
            })
    }
}

fn point_to_seg_dist(px_v: f32, py_v: f32, x1: f32, y1: f32, x2: f32, y2: f32) -> f32 {
    let dx = x2 - x1;
    let dy = y2 - y1;
    let len_sq = dx * dx + dy * dy;
    if len_sq < f32::EPSILON {
        return ((px_v - x1).powi(2) + (py_v - y1).powi(2)).sqrt();
    }
    let t = (((px_v - x1) * dx + (py_v - y1) * dy) / len_sq).clamp(0.0, 1.0);
    let proj_x = x1 + t * dx;
    let proj_y = y1 + t * dy;
    ((px_v - proj_x).powi(2) + (py_v - proj_y).powi(2)).sqrt()
}

#[allow(clippy::too_many_arguments)]
fn paint_ortho_seg(
    window: &mut Window,
    x1: f32,
    y1: f32,
    x2: f32,
    y2: f32,
    thickness: f32,
    color: Hsla,
    dashed: bool,
) {
    let min_x = x1.min(x2);
    let max_x = x1.max(x2);
    let min_y = y1.min(y2);
    let max_y = y1.max(y2);
    let horizontal = (y2 - y1).abs() <= (x2 - x1).abs();
    let len = if horizontal {
        max_x - min_x
    } else {
        max_y - min_y
    };
    if len < 0.5 {
        return;
    }

    if !dashed {
        let bounds = if horizontal {
            Bounds {
                origin: point(px(min_x), px(min_y - thickness * 0.5)),
                size: size(px(len), px(thickness)),
            }
        } else {
            Bounds {
                origin: point(px(min_x - thickness * 0.5), px(min_y)),
                size: size(px(thickness), px(len)),
            }
        };
        window.paint_quad(fill(bounds, color));
        return;
    }

    let dash_len = 6.0f32;
    let gap_len = 4.0f32;
    let step = dash_len + gap_len;
    let mut offset = 0.0f32;
    while offset < len {
        let seg = (len - offset).min(dash_len);
        let bounds = if horizontal {
            Bounds {
                origin: point(px(min_x + offset), px(min_y - thickness * 0.5)),
                size: size(px(seg), px(thickness)),
            }
        } else {
            Bounds {
                origin: point(px(min_x - thickness * 0.5), px(min_y + offset)),
                size: size(px(thickness), px(seg)),
            }
        };
        window.paint_quad(fill(bounds, color));
        offset += step;
    }
}

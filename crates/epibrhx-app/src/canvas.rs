use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use epibrhx_core::{RelationKind, RelationStatus, Schema, TableKind};
use epibrhx_layout::{LayoutConfig, LayoutEngine, NodeBox, SugiyamaLayout};
use gpui_kit::base::ElementExt as _;
use gpui_kit::component::ActiveTheme as _;
use gpui_kit::*;
use web_time::Instant;

const MIN_ZOOM: f32 = 0.08;
const MAX_ZOOM: f32 = 2.50;
const LOD_FULL_THRESHOLD: f32 = 0.45;
const LOD_TITLE_THRESHOLD: f32 = 0.18;
const MAX_VISIBLE_COLS: usize = 8;

/// Pre-formatted immutable card metadata cached once per schema load.
#[derive(Clone)]
pub struct CachedTable {
    pub id: String,
    pub title: SharedString,
    pub is_view: bool,
    pub rows: Vec<(SharedString, SharedString, bool)>,
    pub extra_cols_label: Option<SharedString>,
}

/// Pre-resolved edge index referencing `CachedTable` indices.
#[derive(Clone, Copy)]
pub struct CachedEdge {
    pub from_idx: usize,
    pub to_idx: usize,
    pub is_inferred: bool,
    pub is_confirmed: bool,
}

#[derive(Clone, Copy)]
enum DragMode {
    Pan {
        last_pos: Point<Pixels>,
    },
    Node {
        table_idx: usize,
        last_pos: Point<Pixels>,
    },
}

/// Automated pan+zoom benchmark state for Phase 4 performance verification.
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
    fn new(scale_tables: usize, layout_ms: f32) -> Self {
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

/// Interactive ER diagram canvas state supporting pan, zoom, node dragging, viewport culling, and LOD.
pub struct ErCanvasState {
    pub tables: Arc<Vec<CachedTable>>,
    pub edges: Arc<Vec<CachedEdge>>,
    pub boxes: Vec<NodeBox>,
    pub total_bounds: (f32, f32),
    pub zoom: f32,
    pub pan_x: f32,
    pub pan_y: f32,
    pub selected_idx: Option<usize>,
    pub canvas_bounds: Option<Bounds<Pixels>>,
    drag: Option<DragMode>,
    pub load_started_at: Instant,
    pub bench: BenchRunner,
    pub last_visible_nodes: usize,
    pub last_visible_edges: usize,
}

impl ErCanvasState {
    pub fn from_schema(schema: &Schema) -> Self {
        let load_started_at = Instant::now();
        let layout_cfg = LayoutConfig {
            max_visible_cols: MAX_VISIBLE_COLS,
            ..LayoutConfig::default()
        };
        let t0 = Instant::now();
        let layout = SugiyamaLayout.layout(schema, &layout_cfg);
        let layout_ms = t0.elapsed().as_secs_f32() * 1000.0;

        let mut id_to_idx = HashMap::with_capacity(schema.tables.len());
        let mut cached_tables = Vec::with_capacity(schema.tables.len());
        let mut boxes = Vec::with_capacity(schema.tables.len());

        for (idx, tbl) in schema.tables.iter().enumerate() {
            id_to_idx.insert(tbl.id.as_str(), idx);
            let pk_set: HashSet<&str> = tbl.primary_key.iter().map(String::as_str).collect();
            let mut rows = Vec::with_capacity(tbl.columns.len().min(MAX_VISIBLE_COLS));
            for col in tbl.columns.iter().take(MAX_VISIBLE_COLS) {
                let is_pk = pk_set.contains(col.name.as_str());
                let name_label: SharedString = if is_pk {
                    format!("PK {}", col.name).into()
                } else {
                    col.name.clone().into()
                };
                let type_label: SharedString = col.data_type.clone().into();
                rows.push((name_label, type_label, is_pk));
            }
            let extra_cols_label = if tbl.columns.len() > MAX_VISIBLE_COLS {
                Some(format!("+{} more columns", tbl.columns.len() - MAX_VISIBLE_COLS).into())
            } else {
                None
            };
            cached_tables.push(CachedTable {
                id: tbl.id.clone(),
                title: tbl.name.clone().into(),
                is_view: tbl.kind == TableKind::View,
                rows,
                extra_cols_label,
            });
            let node_box = layout.nodes.get(&tbl.id).copied().unwrap_or(NodeBox {
                x: 0.0,
                y: 0.0,
                width: layout_cfg.node_width,
                height: 80.0,
            });
            boxes.push(node_box);
        }

        let mut cached_edges = Vec::with_capacity(schema.relations.len());
        for rel in &schema.relations {
            if rel.status == RelationStatus::Rejected {
                continue;
            }
            if let (Some(&from_idx), Some(&to_idx)) = (
                id_to_idx.get(rel.from_table.as_str()),
                id_to_idx.get(rel.to_table.as_str()),
            ) {
                cached_edges.push(CachedEdge {
                    from_idx,
                    to_idx,
                    is_inferred: rel.kind == RelationKind::Inferred,
                    is_confirmed: rel.status == RelationStatus::Confirmed,
                });
            }
        }

        let table_count = cached_tables.len();
        Self {
            tables: Arc::new(cached_tables),
            edges: Arc::new(cached_edges),
            boxes,
            total_bounds: (layout.total_width, layout.total_height),
            zoom: if table_count > 100 { 0.65 } else { 1.0 },
            pan_x: 40.0,
            pan_y: 40.0,
            selected_idx: None,
            canvas_bounds: None,
            drag: None,
            load_started_at,
            bench: BenchRunner::new(table_count, layout_ms),
            last_visible_nodes: 0,
            last_visible_edges: 0,
        }
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
        if let Some(bounds) = self.canvas_bounds {
            let vw = bounds.size.width.as_f32().max(200.0);
            let vh = bounds.size.height.as_f32().max(200.0);
            let tw = self.total_bounds.0.max(1.0);
            let th = self.total_bounds.1.max(1.0);
            let z = ((vw * 0.9) / tw).min((vh * 0.9) / th).clamp(MIN_ZOOM, 1.0);
            self.zoom = z;
            self.pan_x = (vw - tw * z) * 0.5;
            self.pan_y = (vh - th * z) * 0.5;
            cx.notify();
        }
    }

    fn hit_test_node(&self, window_pos: Point<Pixels>) -> Option<usize> {
        let origin = self.canvas_bounds?.origin;
        let wx = (window_pos.x.as_f32() - origin.x.as_f32() - self.pan_x) / self.zoom;
        let wy = (window_pos.y.as_f32() - origin.y.as_f32() - self.pan_y) / self.zoom;
        self.boxes
            .iter()
            .rposition(|b| wx >= b.x && wx <= b.x + b.width && wy >= b.y && wy <= b.y + b.height)
    }

    fn on_mouse_down(&mut self, event: &MouseDownEvent, _: &mut Window, cx: &mut Context<Self>) {
        if event.button != MouseButton::Left && event.button != MouseButton::Middle {
            return;
        }
        if event.button == MouseButton::Left
            && let Some(idx) = self.hit_test_node(event.position)
        {
            self.selected_idx = Some(idx);
            self.drag = Some(DragMode::Node {
                table_idx: idx,
                last_pos: event.position,
            });
            cx.notify();
            return;
        }
        self.selected_idx = None;
        self.drag = Some(DragMode::Pan {
            last_pos: event.position,
        });
        cx.notify();
    }

    fn on_mouse_move(&mut self, event: &MouseMoveEvent, _: &mut Window, cx: &mut Context<Self>) {
        let Some(mode) = self.drag else {
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
                table_idx,
                last_pos,
            } => {
                let dx = (event.position.x.as_f32() - last_pos.x.as_f32()) / self.zoom;
                let dy = (event.position.y.as_f32() - last_pos.y.as_f32()) / self.zoom;
                if let Some(b) = self.boxes.get_mut(table_idx) {
                    b.x += dx;
                    b.y += dy;
                }
                self.drag = Some(DragMode::Node {
                    table_idx,
                    last_pos: event.position,
                });
                cx.notify();
            }
        }
    }

    fn on_mouse_up(&mut self, _: &MouseUpEvent, _: &mut Window, _: &mut Context<Self>) {
        self.drag = None;
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
        cx.notify();
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
        self.bench.completed_frames += 1;

        if self.bench.completed_frames >= self.bench.target_frames {
            self.bench.active = false;
            if !self.bench.reported {
                self.bench.reported = true;
                let summary = self.bench.summary_line();
                #[cfg(not(target_family = "wasm"))]
                println!("[EPIBRHX-BENCH] {summary}");
                #[cfg(target_family = "wasm")]
                log::info!("[EPIBRHX-BENCH] {summary}");

                let exit_on_done = self.bench.exit_on_done;
                let entity = cx.entity().clone();
                window.on_next_frame(move |_, app| {
                    app.update_entity(&entity, |_, cx| cx.notify());
                    if exit_on_done {
                        app.quit();
                    }
                });
            }
            return;
        }

        // First half: smooth pan across the canvas; second half: smooth zoom sweep across LOD levels.
        let t = self.bench.completed_frames as f32 / self.bench.target_frames as f32;
        if t < 0.5 {
            self.pan_x -= 18.0;
            self.pan_y -= 9.0;
        } else {
            let phase = (t - 0.5) * 2.0; // 0..1
            let zoom_wave = 0.75 - 0.55 * (phase * std::f32::consts::PI).sin();
            self.zoom = zoom_wave.clamp(MIN_ZOOM, MAX_ZOOM);
        }

        window.request_animation_frame();
    }
}

impl Render for ErCanvasState {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let frame_cpu_start = Instant::now();
        if self.bench.first_frame_ms.is_none() {
            self.bench.first_frame_ms = Some(self.load_started_at.elapsed().as_secs_f32() * 1000.0);
        }

        self.advance_benchmark(window, cx);

        let tables = Arc::clone(&self.tables);
        let edges = Arc::clone(&self.edges);
        let boxes = self.boxes.clone();
        let zoom = self.zoom;
        let pan_x = self.pan_x;
        let pan_y = self.pan_y;
        let selected_idx = self.selected_idx;

        let theme = cx.theme();
        let bg_color = theme.background;
        let card_bg = theme.popover;
        let header_bg = theme.secondary;
        let view_header_bg = theme.accent;
        let border_color = theme.border;
        let selected_border = theme.primary;
        let fg_color = theme.foreground;
        let muted_fg = theme.muted_foreground;
        let line_declared = theme.muted_foreground.opacity(0.65);
        let line_inferred = theme.primary.opacity(0.8);

        let entity = cx.entity().clone();

        div()
            .id("er-canvas-surface")
            .size_full()
            .relative()
            .bg(bg_color)
            .on_mouse_down(MouseButton::Left, cx.listener(Self::on_mouse_down))
            .on_mouse_down(MouseButton::Middle, cx.listener(Self::on_mouse_down))
            .on_mouse_move(cx.listener(Self::on_mouse_move))
            .on_mouse_up(MouseButton::Left, cx.listener(Self::on_mouse_up))
            .on_mouse_up(MouseButton::Middle, cx.listener(Self::on_mouse_up))
            .on_scroll(cx.listener(Self::on_scroll_wheel))
            .on_prepaint({
                let entity = entity.clone();
                move |bounds, _, cx| {
                    entity.update(cx, |this, _| {
                        this.canvas_bounds = Some(bounds);
                    });
                }
            })
            .child(
                canvas(
                    move |bounds, _, cx| {
                        // Viewport culling in world coordinates (P4-T4).
                        let vw = bounds.size.width.as_f32();
                        let vh = bounds.size.height.as_f32();
                        let pad = 90.0 / zoom.max(MIN_ZOOM);
                        let view_left = -pan_x / zoom - pad;
                        let view_top = -pan_y / zoom - pad;
                        let view_right = (-pan_x + vw) / zoom + pad;
                        let view_bottom = (-pan_y + vh) / zoom + pad;

                        let visible_nodes: Vec<(usize, NodeBox)> = boxes
                            .iter()
                            .enumerate()
                            .filter(|(_, b)| {
                                b.intersects(view_left, view_top, view_right, view_bottom)
                            })
                            .map(|(i, &b)| (i, b))
                            .collect();

                        let visible_edges: Vec<CachedEdge> = edges
                            .iter()
                            .copied()
                            .filter(|e| {
                                let (fx, fy) = boxes[e.from_idx].center();
                                let (tx, ty) = boxes[e.to_idx].center();
                                let min_x = fx.min(tx);
                                let max_x = fx.max(tx);
                                let min_y = fy.min(ty);
                                let max_y = fy.max(ty);
                                max_x >= view_left
                                    && min_x <= view_right
                                    && max_y >= view_top
                                    && min_y <= view_bottom
                            })
                            .collect();

                        entity.update(cx, |this, _| {
                            this.last_visible_nodes = visible_nodes.len();
                            this.last_visible_edges = visible_edges.len();
                        });

                        (
                            bounds,
                            visible_nodes,
                            visible_edges,
                            boxes,
                            entity,
                            frame_cpu_start,
                        )
                    },
                    move |_,
                          (
                        bounds,
                        visible_nodes,
                        visible_edges,
                        boxes,
                        entity,
                        frame_cpu_start,
                    ),
                          window,
                          cx| {
                        let base_font = window.text_style().font();
                        window.with_content_mask(Some(ContentMask { bounds }), |window| {
                            let ox = bounds.origin.x.as_f32() + pan_x;
                            let oy = bounds.origin.y.as_f32() + pan_y;

                            // 1. Paint visible orthogonal edges using GPU quads (no Lyon tessellation overhead).
                            let stroke_w = (1.5 * zoom).clamp(1.0, 2.5);
                            for edge in &visible_edges {
                                let from_b = boxes[edge.from_idx];
                                let to_b = boxes[edge.to_idx];
                                let color = if edge.is_inferred && !edge.is_confirmed {
                                    line_inferred
                                } else {
                                    line_declared
                                };
                                let dashed = edge.is_inferred && !edge.is_confirmed;

                                if edge.from_idx == edge.to_idx {
                                    // Compact self-reference loop on right edge.
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
                            }

                            // 2. Paint visible table cards with LOD degradation.
                            let show_cols = zoom >= LOD_FULL_THRESHOLD;
                            let show_title = zoom >= LOD_TITLE_THRESHOLD;
                            // Quantize scaled font size to 0.5px buckets to maximize GPUI text shaping cache hits.
                            let title_px = ((12.5 * zoom).clamp(7.0, 20.0) * 2.0).round() * 0.5;
                            let col_px = ((11.0 * zoom).clamp(6.5, 17.0) * 2.0).round() * 0.5;
                            let title_lh = px(title_px + 4.0);
                            let col_lh = px(col_px + 4.0);

                            for &(idx, node_box) in &visible_nodes {
                                let tbl = &tables[idx];
                                let x = ox + node_box.x * zoom;
                                let y = oy + node_box.y * zoom;
                                let w = node_box.width * zoom;
                                let h = node_box.height * zoom;
                                let card_bounds = Bounds {
                                    origin: point(px(x), px(y)),
                                    size: size(px(w), px(h)),
                                };

                                let is_selected = selected_idx == Some(idx);
                                let card_border = if is_selected {
                                    selected_border
                                } else {
                                    border_color
                                };
                                let border_w = if is_selected { px(2.0) } else { px(1.0) };

                                if !show_title {
                                    // Ultra-zoomed-out LOD: fast flat block only.
                                    let block_bg = if is_selected {
                                        selected_border
                                    } else {
                                        header_bg
                                    };
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

                                // Card frame
                                window.paint_quad(quad(
                                    card_bounds,
                                    Corners::all(px((6.0 * zoom).clamp(2.0, 8.0))),
                                    card_bg,
                                    Edges::all(border_w),
                                    card_border,
                                    BorderStyle::Solid,
                                ));

                                // Header bar
                                let hdr_h = if show_cols { (32.0 * zoom).min(h) } else { h };
                                let hdr_bounds = Bounds {
                                    origin: point(px(x), px(y)),
                                    size: size(px(w), px(hdr_h)),
                                };
                                window.paint_quad(fill(
                                    hdr_bounds,
                                    if tbl.is_view {
                                        view_header_bg
                                    } else {
                                        header_bg
                                    },
                                ));

                                // Table title text
                                let pad_x = (10.0 * zoom).clamp(3.0, 12.0);
                                let title_origin = point(
                                    px(x + pad_x),
                                    px(y + ((hdr_h - title_lh.as_f32()) * 0.5).max(1.0)),
                                );
                                let title_run = TextRun {
                                    len: tbl.title.len(),
                                    font: base_font.clone(),
                                    color: fg_color,
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

                                // Column rows (only when zoomed in >= LOD_FULL_THRESHOLD)
                                let row_step = 20.0 * zoom;
                                let mut row_y = y + hdr_h + 4.0 * zoom;
                                for (name_label, type_label, is_pk) in &tbl.rows {
                                    let row_color = if *is_pk { selected_border } else { fg_color };
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
                                        color: muted_fg,
                                        ..Default::default()
                                    };
                                    let shaped_type = window.text_system().shape_line(
                                        type_label.clone(),
                                        px(col_px),
                                        &[type_run],
                                        Some(px((w * 0.36).max(12.0))),
                                    );
                                    let type_x = (x + w - pad_x - shaped_type.width().as_f32())
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

                                if let Some(more_label) = &tbl.extra_cols_label {
                                    let more_run = TextRun {
                                        len: more_label.len(),
                                        font: base_font.clone(),
                                        color: muted_fg,
                                        ..Default::default()
                                    };
                                    let shaped_more = window.text_system().shape_line(
                                        more_label.clone(),
                                        px(col_px),
                                        &[more_run],
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
                        });
                        let cpu_ms = frame_cpu_start.elapsed().as_secs_f32() * 1000.0;
                        entity.update(cx, |this, _| {
                            if this.bench.active {
                                this.bench.cpu_times_ms.push(cpu_ms);
                            }
                        });
                    },
                )
                .absolute()
                .size_full(),
            )
    }
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

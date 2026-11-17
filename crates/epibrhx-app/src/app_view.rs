use epibrhx_core::Schema;
use gpui_kit::component::{
    ActiveTheme as _, Sizable as _,
    button::{Button, ButtonVariants},
    label::Label,
};
use gpui_kit::*;

use crate::canvas::ErCanvasState;

/// Root Phase 4 spike application view with scale switcher, pan/zoom canvas, and FPS HUD.
pub struct EpibrhxSpikeView {
    canvas: Entity<ErCanvasState>,
    _canvas_observer: Subscription,
}

impl EpibrhxSpikeView {
    pub fn new(
        initial_tables: usize,
        auto_bench: bool,
        exit_on_done: bool,
        cx: &mut Context<Self>,
    ) -> Self {
        let schema = schemagen::generate_synthetic_schema(initial_tables, 10, 1.4, 20261117);
        let canvas = cx.new(|_| ErCanvasState::from_schema(&schema));
        let _canvas_observer = cx.observe(&canvas, |_, _, cx| cx.notify());
        if auto_bench {
            canvas.update(cx, |state, cx| state.start_benchmark(exit_on_done, cx));
        }
        Self {
            canvas,
            _canvas_observer,
        }
    }

    pub fn from_schema(schema: &Schema, cx: &mut Context<Self>) -> Self {
        let canvas = cx.new(|_| ErCanvasState::from_schema(schema));
        let _canvas_observer = cx.observe(&canvas, |_, _, cx| cx.notify());
        Self {
            canvas,
            _canvas_observer,
        }
    }

    fn load_scale(&mut self, tables: usize, auto_bench: bool, cx: &mut Context<Self>) {
        let schema = schemagen::generate_synthetic_schema(tables, 10, 1.4, 20261117);
        self.canvas.update(cx, |state, cx| {
            *state = ErCanvasState::from_schema(&schema);
            if auto_bench {
                state.start_benchmark(false, cx);
            } else {
                cx.notify();
            }
        });
    }
}

impl Render for EpibrhxSpikeView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let state = self.canvas.read(cx);
        let summary: SharedString = state.bench.summary_line().into();
        let viewport_info: SharedString = format!(
            "Zoom: {:.0}% | Visible: {}/{} tables, {}/{} edges",
            state.zoom * 100.0,
            state.last_visible_nodes,
            state.tables.len(),
            state.last_visible_edges,
            state.edges.len(),
        )
        .into();

        div()
            .flex()
            .flex_col()
            .size_full()
            .bg(cx.theme().background)
            .text_color(cx.theme().foreground)
            .child(
                div()
                    .flex()
                    .flex_row()
                    .items_center()
                    .justify_between()
                    .px_3()
                    .py_2()
                    .border_b_1()
                    .border_color(cx.theme().border)
                    .gap_2()
                    .child(
                        div()
                            .flex()
                            .flex_row()
                            .items_center()
                            .gap_2()
                            .child(Label::new("EPIBRHX Phase 4 Canvas"))
                            .child(Button::new("scale-100").small().label("100").on_click(
                                cx.listener(|this, _, _, cx| {
                                    this.load_scale(100, false, cx);
                                }),
                            ))
                            .child(Button::new("scale-500").small().label("500").on_click(
                                cx.listener(|this, _, _, cx| {
                                    this.load_scale(500, false, cx);
                                }),
                            ))
                            .child(Button::new("scale-2000").small().label("2000").on_click(
                                cx.listener(|this, _, _, cx| {
                                    this.load_scale(2000, false, cx);
                                }),
                            ))
                            .child(Button::new("fit-view").small().label("Fit").on_click(
                                cx.listener(|this, _, _, cx| {
                                    this.canvas.update(cx, |s, cx| s.fit_to_view(cx));
                                }),
                            ))
                            .child(
                                Button::new("run-bench")
                                    .primary()
                                    .small()
                                    .label("Bench Pan/Zoom")
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.canvas
                                            .update(cx, |s, cx| s.start_benchmark(false, cx));
                                    })),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .items_end()
                            .child(Label::new(summary))
                            .child(Label::new(viewport_info)),
                    ),
            )
            .child(div().flex_1().size_full().child(self.canvas.clone()))
    }
}

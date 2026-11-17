use std::rc::Rc;

use epibrhx_core::redact_connection_url;
use gpui_kit::base::StyledExt as _;
use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::dock::{
    DockArea, DockLayout, DockPlacement, DockSkin, PanelStyle, panel_handle,
};
use gpui_kit::component::input::{Editor, EditorState, Input, InputState};
use gpui_kit::component::label::Label;
use gpui_kit::component::theme::Theme;
use gpui_kit::component::{ActiveTheme as _, Sizable as _};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;

use crate::canvas::ErCanvasView;
use crate::panels::canvas_panel::ErCanvasPanel;
use crate::panels::inspector::InspectorPanel;
use crate::panels::sidebar::NavigationPanel;
use crate::source_loader::{SourceSpec, load_source};
use crate::state::AppState;

/// Root EPIBRHX workbench window integrating Top Toolbar, Dock Layout (Left Navigator, Center ER Canvas,
/// Right Inspector), Import/Open Modal, and System Appearance Theme Sync (`P5-T1`, `P5-T11`, `P5-T12`).
pub struct EpibrhxApp {
    pub app: Entity<AppState>,
    pub canvas: Entity<ErCanvasView>,
    dock_area: Entity<DockArea>,
    _dock_skin: Rc<DockSkin>,
    show_import_modal: bool,
    import_target_input: Entity<InputState>,
    import_sql_editor: Entity<EditorState>,
    import_error: Option<String>,
    _subs: Vec<Subscription>,
}

impl EpibrhxApp {
    pub fn new(
        initial_source: SourceSpec,
        auto_bench: bool,
        exit_on_done: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        // P5-T12: Sync initial light/dark theme from OS and subscribe to live appearance changes.
        Theme::sync_system_appearance(Some(window), cx);
        let appearance_sub = window.observe_window_appearance(|window, cx| {
            Theme::sync_system_appearance(Some(window), cx);
        });

        let loaded = load_source(&initial_source).unwrap_or_else(|err| {
            let mut fallback =
                load_source(&SourceSpec::default()).expect("built-in fixture always parses");
            fallback
                .schema
                .warnings
                .push(format!("Initial source load failed: {err}"));
            fallback
        });

        let app = cx.new(|_| AppState::from_loaded(loaded));
        let canvas = cx.new(|cx| ErCanvasView::new(app.clone(), cx));
        if auto_bench {
            canvas.update(cx, |cv, cx| cv.start_benchmark(exit_on_done, cx));
        }

        let nav_panel = cx.new(|cx| NavigationPanel::new(app.clone(), canvas.clone(), window, cx));
        let canvas_panel = cx.new(|cx| ErCanvasPanel::new(canvas.clone(), cx));
        let insp_panel = cx.new(|cx| InspectorPanel::new(app.clone(), canvas.clone(), window, cx));

        let (dock_area, dock_skin) = DockSkin::dock_area("epibrhx-workbench", Some(1), window, cx);
        dock_skin.set_panel_style(PanelStyle::Auto, cx);
        dock_area.update(cx, |area, cx| {
            area.set_center(
                DockLayout::tabs().panel_view(panel_handle(canvas_panel), cx),
                window,
                cx,
            );
            area.set_dock(
                DockPlacement::Left,
                DockLayout::tabs().panel_view(panel_handle(nav_panel), cx),
                window,
                cx,
            );
            area.set_dock_size(DockPlacement::Left, px(270.0), window, cx);
            area.set_dock(
                DockPlacement::Right,
                DockLayout::tabs().panel_view(panel_handle(insp_panel), cx),
                window,
                cx,
            );
            area.set_dock_size(DockPlacement::Right, px(320.0), window, cx);
        });

        let import_target_input = cx.new(|cx| {
            InputState::new(window, cx)
                .placeholder("Path (.db / .sql / .json) or postgres://user:pass@host/db")
        });
        let import_sql_editor = cx.new(|cx| {
            EditorState::new(window, cx)
                .language("sql")
                .line_number(true)
        });
        import_sql_editor.update(cx, |ed, cx| {
            ed.set_value(
                "-- Paste DDL SQL or exported schema JSON here\nCREATE TABLE accounts (\n  id INTEGER PRIMARY KEY,\n  email TEXT NOT NULL UNIQUE\n);\nCREATE TABLE sessions (\n  id INTEGER PRIMARY KEY,\n  account_id INTEGER NOT NULL\n);",
                window,
                cx,
            );
        });

        let app_sub = cx.observe(&app, |_, _, cx| cx.notify());
        let canvas_sub = cx.observe(&canvas, |_, _, cx| cx.notify());

        Self {
            app,
            canvas,
            dock_area,
            _dock_skin: dock_skin,
            show_import_modal: false,
            import_target_input,
            import_sql_editor,
            import_error: None,
            _subs: vec![appearance_sub, app_sub, canvas_sub],
        }
    }

    fn apply_loaded_source(&mut self, spec: SourceSpec, cx: &mut Context<Self>) {
        match load_source(&spec) {
            Ok(loaded) => {
                self.app.update(cx, |st, cx| {
                    st.load_new_source(loaded);
                    cx.notify();
                });
                self.canvas.update(cx, |cv, cx| {
                    cv.reset_camera_for_new_source(cx);
                    cx.notify();
                });
                self.import_error = None;
                self.show_import_modal = false;
                cx.notify();
            }
            Err(err) => {
                // Redact any accidental connection URLs before showing error text.
                self.import_error = Some(redact_connection_url(&err.to_string()));
                cx.notify();
            }
        }
    }

    fn load_pasted_content(&mut self, cx: &mut Context<Self>) {
        let text = self.import_sql_editor.read(cx).value().to_string();
        let trimmed = text.trim();
        if trimmed.is_empty() {
            self.import_error = Some("Please paste SQL DDL or a schema JSON document.".to_string());
            cx.notify();
            return;
        }
        let spec = if trimmed.starts_with('{') {
            SourceSpec::SchemaJson {
                label: "pasted: schema.json".to_string(),
                json: trimmed.to_string(),
            }
        } else {
            SourceSpec::SqlText {
                label: "pasted: schema.sql".to_string(),
                sql: trimmed.to_string(),
            }
        };
        self.apply_loaded_source(spec, cx);
    }

    #[cfg(not(target_family = "wasm"))]
    fn load_native_input(&mut self, cx: &mut Context<Self>) {
        let target = self.import_target_input.read(cx).value().trim().to_string();
        if target.is_empty() {
            self.import_error = Some("Enter a SQLite/SQL/JSON path or PostgreSQL URL.".to_string());
            cx.notify();
            return;
        }
        self.apply_loaded_source(SourceSpec::NativeInput(target), cx);
    }
}

impl Render for EpibrhxApp {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme().clone();
        let (source_label, focus_mode, focus_hops, auto_group, has_selected_table, last_error) = {
            let st = self.app.read(cx);
            (
                redact_connection_url(&st.source_label),
                st.focus_mode,
                st.focus_hops,
                st.auto_group,
                st.selected_table_id.is_some(),
                st.last_error.clone(),
            )
        };
        let cv = self.canvas.read(cx);
        let zoom_pct = (cv.zoom * 100.0).round() as usize;
        let bench_active = cv.bench.active || !cv.bench.frame_times_ms.is_empty();
        let bench_summary: SharedString = cv.bench.summary_line().into();
        let left_open = self.dock_area.read(cx).is_dock_open(DockPlacement::Left);
        let right_open = self.dock_area.read(cx).is_dock_open(DockPlacement::Right);

        div()
            .relative()
            .flex()
            .flex_col()
            .size_full()
            .bg(theme.background)
            .text_color(theme.foreground)
            // Top workbench toolbar
            .child(
                div()
                    .flex()
                    .flex_row()
                    .items_center()
                    .justify_between()
                    .px_3()
                    .py_2()
                    .border_b_1()
                    .border_color(theme.border)
                    .bg(theme.title_bar)
                    .gap_2()
                    // Left section: brand + sidebar toggle + source badge + open
                    .child(
                        div()
                            .flex()
                            .flex_row()
                            .items_center()
                            .gap_2()
                            .child(
                                Button::new("tgl-left-dock")
                                    .xsmall()
                                    .ghost()
                                    .label(if left_open { "Hide Nav" } else { "Show Nav" })
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        this.dock_area.update(cx, |area, cx| {
                                            area.toggle_dock(DockPlacement::Left, window, cx);
                                        });
                                    })),
                            )
                            .child(Label::new("EPIBRHX").text_sm().font_semibold())
                            .child(
                                div()
                                    .px_2()
                                    .py_0p5()
                                    .rounded(px(4.0))
                                    .bg(theme.secondary)
                                    .text_xs()
                                    .text_color(theme.secondary_foreground)
                                    .child(source_label),
                            )
                            .child(
                                Button::new("btn-open-source")
                                    .xsmall()
                                    .primary()
                                    .label("Open / Import")
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.show_import_modal = !this.show_import_modal;
                                        this.import_error = None;
                                        cx.notify();
                                    })),
                            ),
                    )
                    // Right section: layout, focus mode, auto-group, fit, inspector toggle
                    .child(
                        div()
                            .flex()
                            .flex_row()
                            .items_center()
                            .gap_1p5()
                            .when(bench_active, |row| {
                                row.child(
                                    div()
                                        .text_xs()
                                        .text_color(theme.muted_foreground)
                                        .child(bench_summary),
                                )
                            })
                            .child(
                                Button::new("btn-focus-mode")
                                    .xsmall()
                                    .when(focus_mode, |b| b.primary())
                                    .label(if focus_mode {
                                        format!("Focus ({focus_hops}-hop) ON")
                                    } else if has_selected_table {
                                        format!("Focus ({focus_hops}-hop)")
                                    } else {
                                        "Focus (select table)".to_string()
                                    })
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.app.update(cx, |st, cx| {
                                            st.set_focus_mode(!st.focus_mode);
                                            cx.notify();
                                        });
                                    })),
                            )
                            .child(
                                Button::new("btn-hop-dec")
                                    .xsmall()
                                    .ghost()
                                    .label("-Hop")
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.app.update(cx, |st, cx| {
                                            st.adjust_focus_hops(-1);
                                            cx.notify();
                                        });
                                    })),
                            )
                            .child(
                                Button::new("btn-hop-inc")
                                    .xsmall()
                                    .ghost()
                                    .label("+Hop")
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.app.update(cx, |st, cx| {
                                            st.adjust_focus_hops(1);
                                            cx.notify();
                                        });
                                    })),
                            )
                            .child(
                                Button::new("btn-auto-group")
                                    .xsmall()
                                    .when(auto_group, |b| b.primary())
                                    .label("Groups")
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.app.update(cx, |st, cx| {
                                            st.set_auto_group(!st.auto_group);
                                            cx.notify();
                                        });
                                    })),
                            )
                            .child(
                                Button::new("btn-fit-view")
                                    .xsmall()
                                    .label(format!("Fit ({zoom_pct}%)"))
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.canvas.update(cx, |cv, cx| cv.fit_to_view(cx));
                                    })),
                            )
                            .child(
                                Button::new("btn-relayout")
                                    .xsmall()
                                    .label("Auto Layout")
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.app.update(cx, |st, cx| {
                                            st.reset_auto_layout();
                                            cx.notify();
                                        });
                                        this.canvas.update(cx, |cv, cx| cv.fit_to_view(cx));
                                    })),
                            )
                            .child(
                                Button::new("tgl-right-dock")
                                    .xsmall()
                                    .ghost()
                                    .label(if right_open {
                                        "Hide Inspector"
                                    } else {
                                        "Show Inspector"
                                    })
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        this.dock_area.update(cx, |area, cx| {
                                            area.toggle_dock(DockPlacement::Right, window, cx);
                                        });
                                    })),
                            ),
                    ),
            )
            .when_some(last_error, |root, err| {
                root.child(
                    div()
                        .px_3()
                        .py_1()
                        .bg(theme.danger.alpha(0.15))
                        .border_b_1()
                        .border_color(theme.danger.alpha(0.4))
                        .text_xs()
                        .text_color(theme.danger)
                        .child(redact_connection_url(&err)),
                )
            })
            // Center DockArea (Left Navigator + Center ER Canvas + Right Inspector)
            .child(
                div()
                    .flex_1()
                    .min_h_0()
                    .size_full()
                    .child(self.dock_area.clone()),
            )
            // Open / Import Modal Overlay (supports Native path/PG URL + WASM/Desktop SQL or JSON paste)
            .when(self.show_import_modal, |root| {
                root.child(
                    div()
                        .id("import-modal-backdrop")
                        .absolute()
                        .inset_0()
                        .bg(gpui::black().alpha(0.45))
                        .flex()
                        .items_center()
                        .justify_center()
                        .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                        .child(
                            div()
                                .w(px(640.0))
                                .max_h(px(540.0))
                                .p_4()
                                .rounded(px(10.0))
                                .bg(theme.popover)
                                .border_1()
                                .border_color(theme.border)
                                .flex()
                                .flex_col()
                                .gap_3()
                                .child(
                                    div()
                                        .flex()
                                        .flex_row()
                                        .items_center()
                                        .justify_between()
                                        .child(
                                            div()
                                                .text_base()
                                                .font_semibold()
                                                .child("Open Schema Source"),
                                        )
                                        .child(
                                            Button::new("modal-close")
                                                .xsmall()
                                                .ghost()
                                                .label("Close")
                                                .on_click(cx.listener(|this, _, _, cx| {
                                                    this.show_import_modal = false;
                                                    cx.notify();
                                                })),
                                        ),
                                )
                                .when(cfg!(not(target_family = "wasm")), |modal| {
                                    modal.child(
                                        div()
                                            .flex()
                                            .flex_col()
                                            .gap_1p5()
                                            .child(
                                                div()
                                                    .text_xs()
                                                    .font_semibold()
                                                    .text_color(theme.muted_foreground)
                                                    .child(
                                                        "LOCAL FILE OR POSTGRES URL (READ-ONLY)",
                                                    ),
                                            )
                                            .child(
                                                div()
                                                    .flex()
                                                    .flex_row()
                                                    .gap_2()
                                                    .child(
                                                        div().flex_1().child(
                                                            Input::new(&self.import_target_input)
                                                                .small(),
                                                        ),
                                                    )
                                                    .child(
                                                        Button::new("modal-load-native")
                                                            .small()
                                                            .primary()
                                                            .label("Connect / Open")
                                                            .on_click(cx.listener(
                                                                |this, _, _, cx| {
                                                                    #[cfg(not(
                                                                        target_family = "wasm"
                                                                    ))]
                                                                    this.load_native_input(cx);
                                                                    #[cfg(target_family = "wasm")]
                                                                    let _ = (this, cx);
                                                                },
                                                            )),
                                                    ),
                                            ),
                                    )
                                })
                                .child(
                                    div()
                                        .flex()
                                        .flex_col()
                                        .gap_1p5()
                                        .child(
                                            div()
                                                .text_xs()
                                                .font_semibold()
                                                .text_color(theme.muted_foreground)
                                                .child("PASTE SQL DDL OR EXPORTED SCHEMA JSON"),
                                        )
                                        .child(
                                            div()
                                                .h(px(260.0))
                                                .child(Editor::new(&self.import_sql_editor)),
                                        )
                                        .child(
                                            div()
                                                .flex()
                                                .flex_row()
                                                .justify_between()
                                                .items_center()
                                                .child(
                                                    Button::new("modal-bench-500")
                                                        .xsmall()
                                                        .ghost()
                                                        .label("Load 500-Table Bench")
                                                        .on_click(cx.listener(|this, _, _, cx| {
                                                            this.apply_loaded_source(
                                                                SourceSpec::Bench(500),
                                                                cx,
                                                            );
                                                        })),
                                                )
                                                .child(
                                                    Button::new("modal-load-pasted")
                                                        .small()
                                                        .primary()
                                                        .label("Parse SQL / JSON")
                                                        .on_click(cx.listener(|this, _, _, cx| {
                                                            this.load_pasted_content(cx);
                                                        })),
                                                ),
                                        ),
                                )
                                .when_some(self.import_error.clone(), |modal, err| {
                                    modal.child(
                                        div()
                                            .p_2()
                                            .rounded(px(6.0))
                                            .bg(theme.danger.alpha(0.14))
                                            .text_xs()
                                            .text_color(theme.danger)
                                            .child(err),
                                    )
                                }),
                        ),
                )
            })
    }
}

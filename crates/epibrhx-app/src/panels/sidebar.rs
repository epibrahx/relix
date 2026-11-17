use gpui_kit::base::StyledExt as _;
use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::dock::{BasePanel, Panel, PanelEvent};
use gpui_kit::component::input::{Input, InputEvent, InputState};
use gpui_kit::component::scroll::ScrollableElement as _;
use gpui_kit::component::{ActiveTheme as _, Sizable as _};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;

use crate::canvas::ErCanvasView;
use crate::source_loader::{BuiltinFixture, SourceSpec, load_source};
use crate::state::AppState;

/// Left dock navigation panel: search tables/columns, browse domain groups, switch fixtures (`P5-T1`, `P5-T4`, `P5-T7`).
pub struct NavigationPanel {
    app: Entity<AppState>,
    canvas: Entity<ErCanvasView>,
    search_input: Entity<InputState>,
    focus_handle: FocusHandle,
    _subs: Vec<Subscription>,
}

impl NavigationPanel {
    pub fn new(
        app: Entity<AppState>,
        canvas: Entity<ErCanvasView>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let search_input =
            cx.new(|cx| InputState::new(window, cx).placeholder("Search tables or columns..."));
        let sub_search = cx.subscribe(&search_input, |this, entity, ev: &InputEvent, cx| {
            if matches!(ev, InputEvent::Change) {
                let query = entity.read(cx).value().to_string();
                this.app.update(cx, |st, cx| {
                    st.search_query = query;
                    cx.notify();
                });
                cx.notify();
            }
        });
        let sub_app = cx.observe(&app, |_, _, cx| cx.notify());

        Self {
            app,
            canvas,
            search_input,
            focus_handle: cx.focus_handle(),
            _subs: vec![sub_search, sub_app],
        }
    }

    fn switch_fixture(&mut self, fixture: BuiltinFixture, cx: &mut Context<Self>) {
        match load_source(&SourceSpec::Builtin(fixture)) {
            Ok(loaded) => {
                self.app.update(cx, |st, cx| {
                    st.load_new_source(loaded);
                    cx.notify();
                });
                self.canvas.update(cx, |cv, cx| {
                    cv.reset_camera_for_new_source(cx);
                    cx.notify();
                });
            }
            Err(err) => {
                self.app.update(cx, |st, cx| {
                    st.last_error = Some(err.to_string());
                    cx.notify();
                });
            }
        }
    }
}

impl EventEmitter<PanelEvent> for NavigationPanel {}

impl Focusable for NavigationPanel {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl BasePanel for NavigationPanel {
    fn panel_name(&self) -> &'static str {
        "epibrhx-navigation-panel"
    }

    fn closable(&self, _: &App) -> bool {
        false
    }
}

impl Panel for NavigationPanel {
    fn title(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        "Schema Navigator"
    }

    fn inner_padding(&self, _: &App) -> bool {
        false
    }
}

impl Render for NavigationPanel {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme().clone();
        let (matches, groups, collapsed_map, selected_id, auto_group, total_tables, search_active) = {
            let st = self.app.read(cx);
            (
                st.search_matches(),
                st.group_summary(),
                st.config.collapsed_groups.clone(),
                st.selected_table_id.clone(),
                st.auto_group,
                st.schema.tables.len(),
                !st.search_query.trim().is_empty(),
            )
        };

        div()
            .flex()
            .flex_col()
            .size_full()
            .bg(theme.sidebar)
            .text_color(theme.sidebar_foreground)
            // Search input header
            .child(
                div()
                    .p_2p5()
                    .border_b_1()
                    .border_color(theme.border)
                    .flex()
                    .flex_col()
                    .gap_2()
                    .child(Input::new(&self.search_input).small().cleanable(true))
                    .child(
                        div()
                            .flex()
                            .flex_row()
                            .items_center()
                            .justify_between()
                            .text_xs()
                            .text_color(theme.muted_foreground)
                            .child(format!(
                                "Showing {} / {} tables",
                                matches.len(),
                                total_tables
                            ))
                            .when(selected_id.is_some(), |d| {
                                d.child(
                                    Button::new("nav-clear-sel")
                                        .xsmall()
                                        .ghost()
                                        .label("Clear")
                                        .on_click(cx.listener(|this, _, _, cx| {
                                            this.app.update(cx, |st, cx| {
                                                st.select_table(None);
                                                cx.notify();
                                            });
                                        })),
                                )
                            }),
                    ),
            )
            // Scrollable tables + groups body
            .child(
                div()
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scrollbar()
                    .p_2()
                    .flex()
                    .flex_col()
                    .gap_3()
                    // Builtin samples quick switcher
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
                                    .child("BUILTIN FIXTURES"),
                            )
                            .child(div().flex().flex_row().flex_wrap().gap_1().children(
                                BuiltinFixture::ALL.into_iter().map(|fix| {
                                    Button::new(format!("fix-{}", fix.title()))
                                        .xsmall()
                                        .label(fix.title())
                                        .on_click(cx.listener(move |this, _, _, cx| {
                                            this.switch_fixture(fix, cx);
                                        }))
                                }),
                            )),
                    )
                    // Domain groups section
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_1()
                            .child(
                                div()
                                    .flex()
                                    .flex_row()
                                    .items_center()
                                    .justify_between()
                                    .child(
                                        div()
                                            .text_xs()
                                            .font_semibold()
                                            .text_color(theme.muted_foreground)
                                            .child(format!("DOMAIN GROUPS ({})", groups.len())),
                                    )
                                    .child(
                                        div()
                                            .text_xs()
                                            .text_color(theme.muted_foreground)
                                            .child(if auto_group { "Auto" } else { "Schema" }),
                                    ),
                            )
                            .children(groups.into_iter().map(|(gname, member_ids)| {
                                let is_collapsed =
                                    collapsed_map.get(&gname).copied().unwrap_or(false);
                                let toggle_name = gname.clone();
                                div()
                                    .flex()
                                    .flex_row()
                                    .items_center()
                                    .justify_between()
                                    .px_2()
                                    .py_1()
                                    .rounded(px(5.0))
                                    .bg(theme.secondary.alpha(0.45))
                                    .child(
                                        div()
                                            .text_xs()
                                            .font_medium()
                                            .child(format!("{gname} ({})", member_ids.len())),
                                    )
                                    .when(auto_group, |row| {
                                        row.child(
                                            Button::new(format!("grp-tgl-{gname}"))
                                                .xsmall()
                                                .ghost()
                                                .label(if is_collapsed {
                                                    "Expand"
                                                } else {
                                                    "Collapse"
                                                })
                                                .on_click(cx.listener(move |this, _, _, cx| {
                                                    this.app.update(cx, |st, cx| {
                                                        st.toggle_group_collapsed(&toggle_name);
                                                        cx.notify();
                                                    });
                                                })),
                                        )
                                    })
                            })),
                    )
                    // Tables list
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_1()
                            .child(
                                div()
                                    .text_xs()
                                    .font_semibold()
                                    .text_color(theme.muted_foreground)
                                    .child(if search_active {
                                        "SEARCH RESULTS"
                                    } else {
                                        "TABLES"
                                    }),
                            )
                            .children(matches.into_iter().take(250).map(|m| {
                                let is_selected =
                                    selected_id.as_deref() == Some(m.table_id.as_str());
                                let tid = m.table_id.clone();
                                let subtitle = if !m.matched_columns.is_empty() {
                                    format!("{} · cols: {}", m.group, m.matched_columns.join(", "))
                                } else {
                                    m.group.clone()
                                };
                                div()
                                    .id(SharedString::from(format!("nav-tbl-{}", m.table_id)))
                                    .px_2()
                                    .py_1p5()
                                    .rounded(px(6.0))
                                    .cursor_pointer()
                                    .bg(if is_selected {
                                        theme.primary.alpha(0.18)
                                    } else {
                                        gpui::transparent_black()
                                    })
                                    .border_1()
                                    .border_color(if is_selected {
                                        theme.primary
                                    } else {
                                        gpui::transparent_black()
                                    })
                                    .hover(|s| s.bg(theme.secondary.alpha(0.6)))
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        this.canvas.update(cx, |cv, cx| {
                                            cv.jump_to_table(&tid, cx);
                                        });
                                    }))
                                    .child(
                                        div()
                                            .flex()
                                            .flex_row()
                                            .items_center()
                                            .justify_between()
                                            .child(
                                                div().text_sm().font_medium().child(m.table_name),
                                            )
                                            .child(
                                                div()
                                                    .text_xs()
                                                    .text_color(theme.muted_foreground)
                                                    .child(subtitle),
                                            ),
                                    )
                            })),
                    ),
            )
    }
}

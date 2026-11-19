use gpui_kit::base::StyledExt as _;
use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::dock::{BasePanel, Panel, PanelEvent};
use gpui_kit::component::input::{Editor, EditorState, Input, InputState};
use gpui_kit::component::scroll::ScrollableElement as _;
use gpui_kit::component::{ActiveTheme as _, Sizable as _};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;
use relix_core::{RelationKind, RelationStatus};

use crate::canvas::ErCanvasView;
use crate::state::{AppState, format_column_badges};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum InspectorTab {
    Details,
    SqlDdl,
    Warnings,
}

/// Right dock inspector panel showing columns, indexes, incoming/outgoing relations,
/// ambiguous relation resolution, manual domain group assignment, warnings, and read-only SQL DDL (`P5-T8`, `P5-T10`).
pub struct InspectorPanel {
    app: Entity<AppState>,
    canvas: Entity<ErCanvasView>,
    tab: InspectorTab,
    group_input: Entity<InputState>,
    sql_editor: Entity<EditorState>,
    last_sql_version: u64,
    last_table_for_group_input: Option<String>,
    focus_handle: FocusHandle,
    _app_sub: Subscription,
}

impl InspectorPanel {
    pub fn new(
        app: Entity<AppState>,
        canvas: Entity<ErCanvasView>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let group_input = cx.new(|cx| InputState::new(window, cx).placeholder("Assign group..."));
        let sql_editor = cx.new(|cx| {
            EditorState::new(window, cx)
                .language("sql")
                .line_number(true)
        });
        let initial_sql = app.read(cx).raw_sql.clone().unwrap_or_else(|| {
            "-- No raw DDL source attached (loaded from live database or JSON)".to_string()
        });
        sql_editor.update(cx, |ed, cx| ed.set_value(initial_sql, window, cx));
        let initial_ver = app.read(cx).version;

        let _app_sub = cx.observe(&app, |_, _, cx| cx.notify());

        Self {
            app,
            canvas,
            tab: InspectorTab::Details,
            group_input,
            sql_editor,
            last_sql_version: initial_ver,
            last_table_for_group_input: None,
            focus_handle: cx.focus_handle(),
            _app_sub,
        }
    }

    fn sync_dynamic_inputs(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let (ver, raw_sql, sel_tbl_id, current_group) = {
            let st = self.app.read(cx);
            let group = st
                .selected_table_id
                .as_deref()
                .and_then(|id| st.resolved_table_groups().get(id).cloned())
                .unwrap_or_default();
            (
                st.version,
                st.raw_sql.clone(),
                st.selected_table_id.clone(),
                group,
            )
        };
        if ver != self.last_sql_version {
            let text = raw_sql.unwrap_or_else(|| {
                "-- No raw DDL source attached (loaded from live database or JSON)".to_string()
            });
            self.sql_editor
                .update(cx, |ed, cx| ed.set_value(text, window, cx));
            self.last_sql_version = ver;
        }
        if sel_tbl_id != self.last_table_for_group_input {
            self.last_table_for_group_input = sel_tbl_id;
            self.group_input
                .update(cx, |inp, cx| inp.set_value(current_group, window, cx));
        }
    }
}

impl EventEmitter<PanelEvent> for InspectorPanel {}

impl Focusable for InspectorPanel {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl BasePanel for InspectorPanel {
    fn panel_name(&self) -> &'static str {
        "relix-inspector-panel"
    }

    fn closable(&self, _: &App) -> bool {
        false
    }
}

impl Panel for InspectorPanel {
    fn title(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        "Inspector"
    }

    fn inner_padding(&self, _: &App) -> bool {
        false
    }
}

impl Render for InspectorPanel {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.sync_dynamic_inputs(window, cx);
        let theme = cx.theme().clone();

        let (
            warnings_count,
            selected_table,
            selected_relation,
            outgoing_rels,
            incoming_rels,
            ambiguous_for_table,
            warnings,
            summary_counts,
            existing_groups,
        ) = {
            let st = self.app.read(cx);
            let sel_tbl = st
                .selected_table_id
                .as_deref()
                .and_then(|id| st.table_by_id(id).cloned());
            let sel_rel = st
                .selected_relation_id
                .as_deref()
                .and_then(|id| st.relation_by_id(id).cloned());
            let mut out_rels = Vec::new();
            let mut in_rels = Vec::new();
            let mut ambig = Vec::new();
            if let Some(ref tbl) = sel_tbl {
                for r in &st.schema.relations {
                    if r.from_table == tbl.id {
                        out_rels.push(r.clone());
                    }
                    if r.to_table == tbl.id {
                        in_rels.push(r.clone());
                    }
                }
                for a in &st.ambiguous {
                    if a.from_table == tbl.id {
                        ambig.push(a.clone());
                    }
                }
            }
            let declared = st
                .schema
                .relations
                .iter()
                .filter(|r| r.kind == RelationKind::Declared)
                .count();
            let inferred_auto = st
                .schema
                .relations
                .iter()
                .filter(|r| r.kind == RelationKind::Inferred && r.status == RelationStatus::Auto)
                .count();
            let confirmed = st
                .schema
                .relations
                .iter()
                .filter(|r| r.status == RelationStatus::Confirmed)
                .count();
            let rejected = st
                .schema
                .relations
                .iter()
                .filter(|r| r.status == RelationStatus::Rejected)
                .count();
            let groups: Vec<String> = st.group_summary().keys().cloned().collect();
            (
                st.schema.warnings.len(),
                sel_tbl,
                sel_rel,
                out_rels,
                in_rels,
                ambig,
                st.schema.warnings.clone(),
                (
                    st.schema.dialect,
                    st.schema.tables.len(),
                    declared,
                    inferred_auto,
                    confirmed,
                    rejected,
                    st.ambiguous.len(),
                ),
                groups,
            )
        };
        let show_overview = selected_table.is_none() && selected_relation.is_none();

        div()
            .flex()
            .flex_col()
            .size_full()
            .bg(theme.sidebar)
            .text_color(theme.sidebar_foreground)
            // Internal inspector tabs
            .child(
                div()
                    .flex()
                    .flex_row()
                    .items_center()
                    .gap_1()
                    .p_2()
                    .border_b_1()
                    .border_color(theme.border)
                    .child(
                        Button::new("tab-details")
                            .xsmall()
                            .when(self.tab == InspectorTab::Details, |b| b.primary())
                            .label("Details")
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.tab = InspectorTab::Details;
                                cx.notify();
                            })),
                    )
                    .child(
                        Button::new("tab-sql")
                            .xsmall()
                            .when(self.tab == InspectorTab::SqlDdl, |b| b.primary())
                            .label("DDL / SQL")
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.tab = InspectorTab::SqlDdl;
                                cx.notify();
                            })),
                    )
                    .child(
                        Button::new("tab-warnings")
                            .xsmall()
                            .when(self.tab == InspectorTab::Warnings, |b| b.primary())
                            .label(format!("Warnings ({warnings_count})"))
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.tab = InspectorTab::Warnings;
                                cx.notify();
                            })),
                    ),
            )
            .child(match self.tab {
                InspectorTab::SqlDdl => div()
                    .flex_1()
                    .min_h_0()
                    .p_2()
                    .child(Editor::new(&self.sql_editor).readonly(true))
                    .into_any_element(),
                InspectorTab::Warnings => div()
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scrollbar()
                    .p_3()
                    .flex()
                    .flex_col()
                    .gap_2()
                    .when(warnings.is_empty(), |d| {
                        d.child(
                            div()
                                .text_xs()
                                .text_color(theme.muted_foreground)
                                .child("No loader or DDL warnings recorded."),
                        )
                    })
                    .children(warnings.into_iter().map(|w| {
                        div()
                            .p_2()
                            .rounded(px(6.0))
                            .bg(theme.warning.alpha(0.14))
                            .border_1()
                            .border_color(theme.warning.alpha(0.4))
                            .text_xs()
                            .child(w)
                    }))
                    .into_any_element(),
                InspectorTab::Details => div()
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scrollbar()
                    .p_3()
                    .flex()
                    .flex_col()
                    .gap_3()
                    // Selected relation card
                    .when_some(selected_relation, |d, rel| {
                        let rel_id_c = rel.id.clone();
                        let rel_id_r = rel.id.clone();
                        let rel_id_z = rel.id.clone();
                        d.child(
                            div()
                                .p_2p5()
                                .rounded(px(8.0))
                                .bg(theme.popover)
                                .border_1()
                                .border_color(theme.primary)
                                .flex()
                                .flex_col()
                                .gap_2()
                                .child(
                                    div()
                                        .text_xs()
                                        .font_semibold()
                                        .text_color(theme.primary)
                                        .child("SELECTED RELATION"),
                                )
                                .child(div().text_sm().font_medium().child(format!(
                                    "{} ({}) → {} ({})",
                                    rel.from_table,
                                    rel.from_columns.join(", "),
                                    rel.to_table,
                                    rel.to_columns.join(", ")
                                )))
                                .child(div().text_xs().text_color(theme.muted_foreground).child(
                                    format!("Kind: {:?} · Status: {:?}", rel.kind, rel.status),
                                ))
                                .children(rel.evidence.iter().map(|ev| {
                                    div()
                                        .text_xs()
                                        .text_color(theme.muted_foreground)
                                        .child(format!("• {ev}"))
                                }))
                                .when(rel.kind == RelationKind::Inferred, |box_el| {
                                    box_el.child(
                                        div()
                                            .flex()
                                            .flex_row()
                                            .gap_1p5()
                                            .when(rel.status != RelationStatus::Confirmed, |row| {
                                                row.child(
                                                    Button::new("insp-rel-confirm")
                                                        .xsmall()
                                                        .primary()
                                                        .label("Confirm")
                                                        .on_click(cx.listener(move |this, _, _, cx| {
                                                            this.app.update(cx, |st, cx| {
                                                                st.confirm_relation(&rel_id_c);
                                                                cx.notify();
                                                            });
                                                        })),
                                                )
                                            })
                                            .when(rel.status != RelationStatus::Rejected, |row| {
                                                row.child(
                                                    Button::new("insp-rel-reject")
                                                        .xsmall()
                                                        .danger()
                                                        .label("Reject")
                                                        .on_click(cx.listener(move |this, _, _, cx| {
                                                            this.app.update(cx, |st, cx| {
                                                                st.reject_relation(&rel_id_r);
                                                                cx.notify();
                                                            });
                                                        })),
                                                )
                                            })
                                            .when(rel.status != RelationStatus::Auto, |row| {
                                                row.child(
                                                    Button::new("insp-rel-reset")
                                                        .xsmall()
                                                        .label("Reset")
                                                        .on_click(cx.listener(move |this, _, _, cx| {
                                                            this.app.update(cx, |st, cx| {
                                                                st.reset_relation(&rel_id_z);
                                                                cx.notify();
                                                            });
                                                        })),
                                                )
                                            }),
                                    )
                                }),
                        )
                    })
                    // Selected table details OR schema overview
                    .when_some(selected_table, |d, tbl| {
                        let tid_for_group = tbl.id.clone();
                        let tid_for_ambig = tbl.id.clone();
                        let other_groups: Vec<String> = existing_groups.into_iter().take(6).collect();
                        d.child(
                            div()
                                .flex()
                                .flex_col()
                                .gap_3()
                                // Header + kind + comment
                                .child(
                                    div()
                                        .flex()
                                        .flex_col()
                                        .gap_1()
                                        .child(div().text_base().font_semibold().child(tbl.name.clone()))
                                        .child(
                                            div()
                                                .text_xs()
                                                .text_color(theme.muted_foreground)
                                                .child(format!(
                                                    "{} · {:?} · {} cols · {} indexes",
                                                    tbl.id,
                                                    tbl.kind,
                                                    tbl.columns.len(),
                                                    tbl.indexes.len()
                                                )),
                                        )
                                        .when_some(tbl.comment.clone(), |col, cmt| {
                                            col.child(
                                                div()
                                                    .text_xs()
                                                    .text_color(theme.muted_foreground)
                                                    .child(cmt),
                                            )
                                        }),
                                )
                                // Manual Group Assignment (P5-T7)
                                .child(
                                    div()
                                        .p_2()
                                        .rounded(px(6.0))
                                        .bg(theme.secondary.alpha(0.4))
                                        .flex()
                                        .flex_col()
                                        .gap_1p5()
                                        .child(
                                            div()
                                                .text_xs()
                                                .font_semibold()
                                                .text_color(theme.muted_foreground)
                                                .child("DOMAIN GROUP"),
                                        )
                                        .child(
                                            div()
                                                .flex()
                                                .flex_row()
                                                .items_center()
                                                .gap_1p5()
                                                .child(div().flex_1().child(Input::new(&self.group_input).small()))
                                                .child(
                                                    Button::new("insp-set-group")
                                                        .xsmall()
                                                        .label("Apply")
                                                        .on_click(cx.listener(move |this, _, _, cx| {
                                                            let g = this.group_input.read(cx).value().to_string();
                                                            this.app.update(cx, |st, cx| {
                                                                st.set_table_group(&tid_for_group, g);
                                                                cx.notify();
                                                            });
                                                        })),
                                                ),
                                        )
                                        .child(
                                            div()
                                                .flex()
                                                .flex_row()
                                                .flex_wrap()
                                                .gap_1()
                                                .children(other_groups.into_iter().map(|g| {
                                                    let tid_chip = tbl.id.clone();
                                                    let g_val = g.clone();
                                                    Button::new(format!("grp-chip-{g}"))
                                                        .xsmall()
                                                        .ghost()
                                                        .label(g)
                                                        .on_click(cx.listener(move |this, _, _, cx| {
                                                            this.app.update(cx, |st, cx| {
                                                                st.set_table_group(&tid_chip, g_val.clone());
                                                                cx.notify();
                                                            });
                                                        }))
                                                })),
                                        ),
                                )
                                // Columns section
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
                                                .child("COLUMNS"),
                                        )
                                        .children(tbl.columns.iter().map(|col| {
                                            let badges = format_column_badges(&tbl, &col.name);
                                            let null_tag = if col.nullable { "NULL" } else { "NOT NULL" };
                                            let meta = if let Some(def) = &col.default {
                                                format!("{} · {null_tag} · default={def}", col.data_type)
                                            } else {
                                                format!("{} · {null_tag}", col.data_type)
                                            };
                                            div()
                                                .p_1p5()
                                                .rounded(px(5.0))
                                                .bg(theme.popover.alpha(0.75))
                                                .border_1()
                                                .border_color(theme.border)
                                                .flex()
                                                .flex_col()
                                                .gap_0p5()
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
                                                                .child(col.name.clone()),
                                                        )
                                                        .when(!badges.is_empty(), |r| {
                                                            r.child(
                                                                div()
                                                                    .text_xs()
                                                                    .text_color(theme.primary)
                                                                    .child(badges),
                                                            )
                                                        }),
                                                )
                                                .child(
                                                    div()
                                                        .text_xs()
                                                        .text_color(theme.muted_foreground)
                                                        .child(meta),
                                                )
                                        })),
                                )
                                // Indexes section
                                .when(!tbl.indexes.is_empty(), |sec| {
                                    sec.child(
                                        div()
                                            .flex()
                                            .flex_col()
                                            .gap_1()
                                            .child(
                                                div()
                                                    .text_xs()
                                                    .font_semibold()
                                                    .text_color(theme.muted_foreground)
                                                    .child("INDEXES"),
                                            )
                                            .children(tbl.indexes.iter().map(|ix| {
                                                div()
                                                    .text_xs()
                                                    .p_1p5()
                                                    .rounded(px(4.0))
                                                    .bg(theme.secondary.alpha(0.35))
                                                    .child(format!(
                                                        "{} {}({})",
                                                        if ix.unique { "UNIQUE" } else { "INDEX" },
                                                        ix.name,
                                                        ix.columns.join(", ")
                                                    ))
                                            })),
                                    )
                                })
                                // Outgoing & Incoming Relations
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
                                                .child(format!("REFERENCES ({})", outgoing_rels.len())),
                                        )
                                        .children(outgoing_rels.into_iter().map(|rel| {
                                            let rid = rel.id.clone();
                                            let rid_jump = rel.to_table.clone();
                                            let tag = match (rel.kind, rel.status) {
                                                (RelationKind::Declared, _) => "FK",
                                                (RelationKind::Inferred, RelationStatus::Auto) => "Inferred",
                                                (RelationKind::Inferred, RelationStatus::Confirmed) => "Confirmed",
                                                (RelationKind::Inferred, RelationStatus::Rejected) => "Rejected",
                                            };
                                            div()
                                                .flex()
                                                .flex_row()
                                                .items_center()
                                                .justify_between()
                                                .p_1p5()
                                                .rounded(px(5.0))
                                                .bg(theme.secondary.alpha(0.35))
                                                .child(div().text_xs().child(format!(
                                                    "({}) → {} [{}]",
                                                    rel.from_columns.join(", "),
                                                    rel.to_table,
                                                    tag
                                                )))
                                                .child(
                                                    div()
                                                        .flex()
                                                        .flex_row()
                                                        .gap_1()
                                                        .child(
                                                            Button::new(format!("out-inspect-{rid}"))
                                                                .xsmall()
                                                                .ghost()
                                                                .label("Select")
                                                                .on_click(cx.listener(move |this, _, _, cx| {
                                                                    this.app.update(cx, |st, cx| {
                                                                        st.select_relation(Some(rid.clone()));
                                                                        cx.notify();
                                                                    });
                                                                })),
                                                        )
                                                        .child(
                                                            Button::new(format!("out-go-{}", rel.id))
                                                                .xsmall()
                                                                .ghost()
                                                                .label("Go")
                                                                .on_click(cx.listener(move |this, _, _, cx| {
                                                                    this.canvas.update(cx, |cv, cx| {
                                                                        cv.jump_to_table(&rid_jump, cx);
                                                                    });
                                                                })),
                                                        ),
                                                )
                                        })),
                                )
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
                                                .child(format!("REFERENCED BY ({})", incoming_rels.len())),
                                        )
                                        .children(incoming_rels.into_iter().map(|rel| {
                                            let from_tbl = rel.from_table.clone();
                                            let rid = rel.id.clone();
                                            div()
                                                .flex()
                                                .flex_row()
                                                .items_center()
                                                .justify_between()
                                                .p_1p5()
                                                .rounded(px(5.0))
                                                .bg(theme.secondary.alpha(0.35))
                                                .child(div().text_xs().child(format!(
                                                    "{} ({})",
                                                    rel.from_table,
                                                    rel.from_columns.join(", ")
                                                )))
                                                .child(
                                                    Button::new(format!("in-go-{rid}"))
                                                        .xsmall()
                                                        .ghost()
                                                        .label("Go")
                                                        .on_click(cx.listener(move |this, _, _, cx| {
                                                            this.canvas.update(cx, |cv, cx| {
                                                                cv.jump_to_table(&from_tbl, cx);
                                                            });
                                                        })),
                                                )
                                        })),
                                )
                                // Ambiguous relation candidates (P5-T8)
                                .when(!ambiguous_for_table.is_empty(), |sec| {
                                    sec.child(
                                        div()
                                            .flex()
                                            .flex_col()
                                            .gap_1p5()
                                            .child(
                                                div()
                                                    .text_xs()
                                                    .font_semibold()
                                                    .text_color(theme.warning)
                                                    .child("AMBIGUOUS CANDIDATES (MANUAL RESOLVE)"),
                                            )
                                            .children(ambiguous_for_table.into_iter().map(|amb| {
                                                let col_name = amb.from_column.clone();
                                                let from_t = tid_for_ambig.clone();
                                                div()
                                                    .p_2()
                                                    .rounded(px(6.0))
                                                    .bg(theme.warning.alpha(0.12))
                                                    .border_1()
                                                    .border_color(theme.warning.alpha(0.4))
                                                    .flex()
                                                    .flex_col()
                                                    .gap_1()
                                                    .child(
                                                        div()
                                                            .text_xs()
                                                            .font_semibold()
                                                            .child(format!("Column: {col_name}")),
                                                    )
                                                    .children(amb.candidates.into_iter().enumerate().map(
                                                        |(c_idx, cand)| {
                                                            let cand_clone = cand.clone();
                                                            let ft = from_t.clone();
                                                            let fc = col_name.clone();
                                                            div()
                                                                .flex()
                                                                .flex_row()
                                                                .items_center()
                                                                .justify_between()
                                                                .gap_2()
                                                                .child(div().text_xs().child(format!(
                                                                    "→ {}.{}",
                                                                    cand.to_table, cand.to_column
                                                                )))
                                                                .child(
                                                                    Button::new(format!(
                                                                        "amb-res-{fc}-{c_idx}"
                                                                    ))
                                                                    .xsmall()
                                                                    .primary()
                                                                    .label("Confirm")
                                                                    .on_click(cx.listener(
                                                                        move |this, _, _, cx| {
                                                                            this.app.update(
                                                                                cx,
                                                                                |st, cx| {
                                                                                    st.resolve_ambiguous(
                                                                                        &ft,
                                                                                        &fc,
                                                                                        &cand_clone,
                                                                                    );
                                                                                    cx.notify();
                                                                                },
                                                                            );
                                                                        },
                                                                    )),
                                                                )
                                                        },
                                                    ))
                                            })),
                                    )
                                }),
                        )
                    })
                    .when(show_overview, |d| {
                        let (dialect, tables, declared, inferred_auto, confirmed, rejected, amb_n) =
                            summary_counts;
                        d.child(
                            div()
                                .p_2p5()
                                .rounded(px(8.0))
                                .bg(theme.popover)
                                .border_1()
                                .border_color(theme.border)
                                .flex()
                                .flex_col()
                                .gap_1p5()
                                .child(div().text_sm().font_semibold().child("Schema Overview"))
                                .child(div().text_xs().child(format!("Dialect: {dialect:?}")))
                                .child(div().text_xs().child(format!("Tables / Views: {tables}")))
                                .child(div().text_xs().child(format!("Declared FKs: {declared}")))
                                .child(
                                    div()
                                        .text_xs()
                                        .child(format!("Inferred (Auto): {inferred_auto}")),
                                )
                                .child(
                                    div()
                                        .text_xs()
                                        .child(format!("Confirmed: {confirmed} · Rejected: {rejected}")),
                                )
                                .child(
                                    div()
                                        .text_xs()
                                        .child(format!("Ambiguous Columns: {amb_n}")),
                                )
                                .child(
                                    div()
                                        .pt_2()
                                        .text_xs()
                                        .text_color(theme.muted_foreground)
                                        .child("Click any table card to highlight 1-hop upstream/downstream relations, or click/hover an edge to inspect & confirm inferred relations."),
                                ),
                        )
                    })
                    .into_any_element(),
            })
    }
}

use gpui_kit::component::dock::{BasePanel, Panel, PanelEvent};
use gpui_kit::*;

use crate::canvas::ErCanvasView;

/// Dock center panel wrapping [`ErCanvasView`].
pub struct ErCanvasPanel {
    pub canvas: Entity<ErCanvasView>,
    focus_handle: FocusHandle,
}

impl ErCanvasPanel {
    pub fn new(canvas: Entity<ErCanvasView>, cx: &mut Context<Self>) -> Self {
        Self {
            canvas,
            focus_handle: cx.focus_handle(),
        }
    }
}

impl EventEmitter<PanelEvent> for ErCanvasPanel {}

impl Focusable for ErCanvasPanel {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl BasePanel for ErCanvasPanel {
    fn panel_name(&self) -> &'static str {
        "epibrhx-canvas-panel"
    }

    fn closable(&self, _: &App) -> bool {
        false
    }

    fn zoomable(&self, _: &App) -> bool {
        false
    }
}

impl Panel for ErCanvasPanel {
    fn title(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        "ER Diagram"
    }

    fn title_bar(&self, _: &App) -> bool {
        false
    }

    fn inner_padding(&self, _: &App) -> bool {
        false
    }
}

impl Render for ErCanvasPanel {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div().size_full().child(self.canvas.clone())
    }
}

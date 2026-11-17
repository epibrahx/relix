use gpui_kit::component::{
    ActiveTheme as _,
    button::{Button, ButtonVariants},
    label::Label,
};
use gpui_kit::*;

/// Minimal Phase 0 Hello World view shared across desktop and WASM targets.
#[derive(Default)]
pub struct HelloWorld {
    clicks: usize,
}

impl Render for HelloWorld {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .flex()
            .flex_col()
            .size_full()
            .items_center()
            .justify_center()
            .gap_3()
            .bg(cx.theme().background)
            .text_color(cx.theme().foreground)
            .child(Label::new("EPIBRHX — Hello, World!"))
            .child(Label::new(format!(
                "Core v{} | Clicks: {}",
                epibrhx_core::core_version(),
                self.clicks
            )))
            .child(
                Button::new("hello")
                    .primary()
                    .label("Click me")
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.clicks += 1;
                        cx.notify();
                    })),
            )
    }
}

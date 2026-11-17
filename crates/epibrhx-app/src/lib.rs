//! EPIBRHX desktop and WASM UI application entry points.

pub mod app_view;
pub mod canvas;
pub mod exporter;
pub mod panels;
pub mod source_loader;
pub mod state;

#[cfg(not(target_family = "wasm"))]
pub fn run_desktop(
    initial_source: source_loader::SourceSpec,
    auto_bench: bool,
    exit_on_done: bool,
) {
    use gpui_kit::AppContext as _;
    use gpui_kit::component::Root;
    use gpui_kit::{WindowOptions, application, assets::Assets, init, open_window};

    application().with_assets(Assets).run(move |cx| {
        init(cx);
        open_window(WindowOptions::default(), cx, move |window, cx| {
            let view = cx.new(|cx| {
                app_view::EpibrhxApp::new(initial_source, auto_bench, exit_on_done, window, cx)
            });
            cx.new(|cx| Root::new(view, window, cx))
        })
        .expect("Failed to open EPIBRHX window");
        cx.activate(true);
    });
}

#[cfg(target_family = "wasm")]
mod wasm_entry {
    use std::borrow::Cow;
    use std::cell::RefCell;
    use std::rc::Rc;
    use std::sync::Arc;

    use gpui_kit::assets::Assets;
    use gpui_kit::component::Root;
    use gpui_kit::web::{CanvasFontFallback, WebBackendPreference, WebPlatform};
    use gpui_kit::{App, AppContext as _, Application, ApplicationHandle, WindowOptions};
    use wasm_bindgen::prelude::*;

    use crate::app_view::EpibrhxApp;
    use crate::source_loader::{BuiltinFixture, SourceSpec};

    thread_local! {
        static APPLICATION: RefCell<Option<ApplicationHandle>> = const { RefCell::new(None) };
    }

    #[wasm_bindgen]
    pub fn run(bench_tables: Option<usize>) -> Result<(), JsValue> {
        console_error_panic_hook::set_once();
        let _ = console_log::init_with_level(log::Level::Info);
        tracing_wasm::set_as_global_default();

        gpui_kit::platform::web_init();

        let platform = Rc::new(WebPlatform::new_with_backend_and_font_fallback(
            false,
            WebBackendPreference::Auto,
            CanvasFontFallback::EmojiAndCjk,
        ));
        let http_client = Arc::new(platform.fetch_http_client());
        let app = Application::with_platform(platform)
            .with_http_client(http_client)
            .with_assets(Assets::new(""));

        let initial_source = match bench_tables {
            Some(n) => SourceSpec::Bench(n),
            None => SourceSpec::Builtin(BuiltinFixture::BlogCms),
        };
        let auto_bench = bench_tables.is_some();

        let launch = move |cx: &mut App| {
            gpui_kit::init(cx);

            let system_font =
                Cow::Borrowed(include_bytes!("../fonts/IBMPlexSans-Regular.ttf").as_slice());
            let ui_font = Cow::Borrowed(include_bytes!("../fonts/Inter-Regular.ttf").as_slice());
            cx.text_system()
                .add_fonts(vec![system_font, ui_font])
                .expect("Failed to load embedded WASM fonts");

            gpui_kit::open_window(WindowOptions::default(), cx, move |window, cx| {
                let view =
                    cx.new(|cx| EpibrhxApp::new(initial_source, auto_bench, false, window, cx));
                cx.new(|cx| Root::new(view, window, cx))
            })
            .expect("Failed to open WASM window");
            cx.activate(true);
        };

        APPLICATION.with(|application| {
            *application.borrow_mut() = Some(app.run_embedded(launch));
        });

        Ok(())
    }
}

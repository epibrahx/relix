#[cfg(not(target_family = "wasm"))]
fn main() {
    epibrhx_app::run_desktop();
}

#[cfg(target_family = "wasm")]
fn main() {}

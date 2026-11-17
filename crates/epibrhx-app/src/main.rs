#[cfg(not(target_family = "wasm"))]
fn main() {
    let mut bench_tables: Option<usize> = None;
    let mut exit_on_done = false;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--bench"
            && let Some(val) = args.next()
        {
            bench_tables = val.parse().ok();
        } else if arg == "--bench-exit" {
            exit_on_done = true;
        }
    }
    epibrhx_app::run_desktop(bench_tables, exit_on_done);
}

#[cfg(target_family = "wasm")]
fn main() {}

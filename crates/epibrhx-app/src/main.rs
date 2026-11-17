#[cfg(not(target_family = "wasm"))]
fn main() {
    use epibrhx_app::source_loader::{BuiltinFixture, SourceSpec};

    let mut bench_tables: Option<usize> = None;
    let mut exit_on_done = false;
    let mut positional: Option<String> = None;

    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--bench"
            && let Some(val) = args.next()
        {
            bench_tables = val.parse().ok();
        } else if arg == "--bench-exit" {
            exit_on_done = true;
        } else if !arg.starts_with('-') && positional.is_none() {
            positional = Some(arg);
        }
    }

    let (source, auto_bench) = if let Some(n) = bench_tables {
        (SourceSpec::Bench(n), true)
    } else if let Some(target) = positional {
        (SourceSpec::NativeInput(target), false)
    } else {
        (SourceSpec::Builtin(BuiltinFixture::BlogCms), false)
    };

    epibrhx_app::run_desktop(source, auto_bench, exit_on_done);
}

#[cfg(target_family = "wasm")]
fn main() {}

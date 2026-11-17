#[cfg(not(target_family = "wasm"))]
fn main() {
    use std::path::PathBuf;

    use epibrhx_app::exporter::{ExportFormat, run_cli_export};
    use epibrhx_app::source_loader::{BuiltinFixture, SourceSpec};
    use epibrhx_core::redact_connection_url;

    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "-h" || a == "--help") {
        print_usage();
        return;
    }
    if args.iter().any(|a| a == "-V" || a == "--version") {
        println!("epibrhx {}", env!("CARGO_PKG_VERSION"));
        return;
    }

    if args.first().map(String::as_str) == Some("export") {
        match parse_export_args(&args[1..]) {
            Ok((source, format, out_path)) => {
                match run_cli_export(&source, format, out_path.as_deref()) {
                    Ok(rendered) => {
                        if let Some(path) = out_path {
                            println!("Exported {} to {}", format.label(), path.display());
                        } else {
                            print!("{rendered}");
                        }
                    }
                    Err(err) => {
                        eprintln!("Error: {}", redact_connection_url(&err.to_string()));
                        std::process::exit(1);
                    }
                }
            }
            Err(msg) => {
                eprintln!("Error: {msg}\n");
                print_usage();
                std::process::exit(2);
            }
        }
        return;
    }

    let mut bench_tables: Option<usize> = None;
    let mut exit_on_done = false;
    let mut positional: Option<String> = None;

    let mut it = args.into_iter();
    while let Some(arg) = it.next() {
        if arg == "--bench"
            && let Some(val) = it.next()
        {
            bench_tables = val.parse().ok();
        } else if arg == "--bench-exit" {
            exit_on_done = true;
        } else if !arg.starts_with('-') && positional.is_none() {
            positional = Some(arg);
        } else if arg.starts_with('-') {
            eprintln!("Unknown option: {arg}");
            print_usage();
            std::process::exit(2);
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

    fn parse_export_args(
        rest: &[String],
    ) -> Result<(String, ExportFormat, Option<PathBuf>), String> {
        let mut source: Option<String> = None;
        let mut format = ExportFormat::Mermaid;
        let mut out_path: Option<PathBuf> = None;

        let mut i = 0;
        while i < rest.len() {
            match rest[i].as_str() {
                "-f" | "--format" => {
                    i += 1;
                    let val = rest.get(i).ok_or("missing value for --format")?;
                    format = ExportFormat::parse(val).map_err(|e| e.to_string())?;
                }
                "-o" | "--output" => {
                    i += 1;
                    let val = rest.get(i).ok_or("missing value for --output")?;
                    out_path = Some(PathBuf::from(val));
                }
                arg if arg.starts_with('-') => {
                    return Err(format!("unknown export flag `{arg}`"));
                }
                arg => {
                    if source.is_none() {
                        source = Some(arg.to_string());
                    } else {
                        return Err(format!("unexpected extra positional argument `{arg}`"));
                    }
                }
            }
            i += 1;
        }
        let src = source.ok_or("missing <source> argument for `epibrhx export`")?;
        Ok((src, format, out_path))
    }

    fn print_usage() {
        println!(
            "EPIBRHX {} — Read-only Database Schema Visualizer\n\n\
             USAGE:\n\
               epibrhx [<source>]                  Launch GUI (SQLite .db, .sql, .json, or postgres://...)\n\
               epibrhx export <source> [OPTIONS]   Export schema without launching GUI\n\
               epibrhx --bench <N> [--bench-exit]  Run synthetic canvas benchmark\n\n\
             EXPORT OPTIONS:\n\
               -f, --format <mermaid|md|svg|html|json>   Output format (default: mermaid)\n\
               -o, --output <path>                       Write output to file (default: stdout)\n\
               -h, --help                                Show this help message\n\
               -V, --version                             Print version",
            env!("CARGO_PKG_VERSION")
        );
    }
}

#[cfg(target_family = "wasm")]
fn main() {}

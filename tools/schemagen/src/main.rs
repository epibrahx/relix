use std::path::PathBuf;

use anyhow::{Context, Result, bail};
use schemagen::generate_synthetic_schema;

fn main() -> Result<()> {
    let mut tables = 500usize;
    let mut cols = 10usize;
    let mut fk_density = 1.4f64;
    let mut seed = 20261117u64;
    let mut out: Option<PathBuf> = None;

    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--tables" => {
                let val = args.next().context("--tables requires a value")?;
                tables = val.parse().context("invalid --tables")?;
            }
            "--cols" => {
                let val = args.next().context("--cols requires a value")?;
                cols = val.parse().context("invalid --cols")?;
            }
            "--fk-density" => {
                let val = args.next().context("--fk-density requires a value")?;
                fk_density = val.parse().context("invalid --fk-density")?;
            }
            "--seed" => {
                let val = args.next().context("--seed requires a value")?;
                seed = val.parse().context("invalid --seed")?;
            }
            "--out" | "-o" => {
                let val = args.next().context("--out requires a path")?;
                out = Some(PathBuf::from(val));
            }
            "--help" | "-h" => {
                println!(
                    "Usage: schemagen [--tables N] [--cols N] [--fk-density F] [--seed S] [--out PATH]"
                );
                return Ok(());
            }
            other => bail!("unknown argument: {other}"),
        }
    }

    let schema = generate_synthetic_schema(tables, cols, fk_density, seed);
    let json = schema.to_json_pretty()?;

    if let Some(path) = out {
        if let Some(parent) = path.parent()
            && !parent.as_os_str().is_empty()
        {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&path, json)?;
        eprintln!(
            "Wrote {} tables, {} relations to {}",
            schema.tables.len(),
            schema.relations.len(),
            path.display()
        );
    } else {
        println!("{json}");
    }

    Ok(())
}

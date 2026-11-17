#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> Running CI checks..."
./scripts/ci.sh "$@"

echo "==> Building native release binary..."
cargo build --release -p epibrhx-app "$@"
echo "Native binary: $ROOT_DIR/target/release/epibrhx-app"

echo "==> Building WASM release bundle..."
if env -u RUSTUP_TOOLCHAIN cargo +nightly --version >/dev/null 2>&1; then
  env -u RUSTUP_TOOLCHAIN cargo +nightly rustc -p epibrhx-app --lib --target wasm32-unknown-unknown --release "$@" -- \
    -C link-arg=-zstack-size=8388608
  wasm-bindgen "$ROOT_DIR/target/wasm32-unknown-unknown/release/epibrhx_app.wasm" \
    --out-dir "$ROOT_DIR/crates/epibrhx-app/www/src/wasm" \
    --target web \
    --no-typescript
  if [[ -d "$ROOT_DIR/crates/epibrhx-app/www/node_modules" ]]; then
    (cd "$ROOT_DIR/crates/epibrhx-app/www" && bun run build)
    echo "Static web bundle: $ROOT_DIR/crates/epibrhx-app/www/dist"
  else
    echo "Skipped Vite bundle (run 'cd crates/epibrhx-app/www && bun install && bun run build' to bundle static web assets)."
  fi
else
  echo "Skipped WASM release build (nightly toolchain not installed)."
fi

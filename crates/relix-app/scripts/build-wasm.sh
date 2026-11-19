#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKSPACE_ROOT="$(cd "$APP_DIR/../.." && pwd)"

RELEASE_FLAG=""
BUILD_MODE="debug"
if [[ "${1:-}" == "--release" ]]; then
  RELEASE_FLAG="--release"
  BUILD_MODE="release"
fi

WASM_TOOLCHAIN="${RELIX_WASM_TOOLCHAIN:-nightly}"

cd "$WORKSPACE_ROOT"
env -u RUSTUP_TOOLCHAIN cargo +"$WASM_TOOLCHAIN" rustc -p relix-app --lib --target wasm32-unknown-unknown $RELEASE_FLAG -- \
  -C link-arg=-zstack-size=8388608

WASM_PATH="$WORKSPACE_ROOT/target/wasm32-unknown-unknown/$BUILD_MODE/relix_app.wasm"
if [[ ! -f "$WASM_PATH" ]]; then
  echo "Error: WASM artifact not found at $WASM_PATH" >&2
  exit 1
fi

mkdir -p "$APP_DIR/www/src/wasm"
wasm-bindgen "$WASM_PATH" \
  --out-dir "$APP_DIR/www/src/wasm" \
  --target web \
  --no-typescript

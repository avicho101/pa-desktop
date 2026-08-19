#!/usr/bin/env bash
set -euo pipefail
# pa-desktop build/verify helper
echo "[pa-desktop] Building bridge + app"
cd "$(dirname "$0")"
cd bridge && npm install --no-audit --no-fund && echo "[bridge] ok" && cd ..
cd app && npm install --no-audit --no-fund && npm run build && cd ..
echo "[pa-desktop] npm build passed"
echo "[pa-desktop] Verifying Rust backend (cargo check)..."
cd app/src-tauri && cargo check 2>&1 | tail -5
echo "[pa-desktop] Done. cargo check exit: ${PIPESTATUS[0]}"

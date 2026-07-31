#!/usr/bin/env bash
set -euo pipefail
# =============================================================================
# capture-screenshots.sh — capture marketing screenshots from the REAL app.
#
# Builds + launches Notesage (e2e-testing feature), starts the tauri-webdriver
# bridge, runs e2e-real/tests/marketing-screenshots.manual.ts (which drives the
# app over the demo workspace and writes PNGs into content/screenshots/), then
# tears everything down. Modeled on scripts/run-real-e2e.sh but scoped to the
# one manual capture spec.
#
# NOTE: this opens the app window on your Mac for a few minutes.
#
# Usage: ./scripts/capture-screenshots.sh
# =============================================================================
PLUGIN_PORT=4445
DRIVER_PORT=4444
APP_READY_TIMEOUT=900   # cold debug build can take several minutes
POLL=2

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(pwd)"

# ---------------------------------------------------------------------------
# DEV DATA ISOLATION — never touch the user's real Notesage data.
# The app resolves ALL its data paths from $HOME: `dirs::home_dir()` in Rust
# (→ ~/.notesage config + index DBs, ~/Notesage library) and the WebKit
# localStorage under $HOME/Library/Application Support/<id> (→ chat, connections,
# settings persist). Pointing $HOME at a repo-local dev home isolates every one
# of these at once, so screenshots can NEVER expose personal tags/mentions/chat.
# The cargo/rustup/pnpm toolchain is pinned back at the REAL home so the build
# still works — only the launched APP sees the dev home.
# ---------------------------------------------------------------------------
REAL_HOME="$HOME"
DEV_HOME="$REPO_ROOT/.dev-home"
mkdir -p "$DEV_HOME"
export CARGO_HOME="${CARGO_HOME:-$REAL_HOME/.cargo}"
export RUSTUP_HOME="${RUSTUP_HOME:-$REAL_HOME/.rustup}"
export PNPM_HOME="${PNPM_HOME:-$REAL_HOME/Library/pnpm}"
export HOME="$DEV_HOME"
echo "[capture] DEV DATA ISOLATION → HOME=$DEV_HOME (toolchain pinned at $REAL_HOME)"

TAURI_PID=""
DRIVER_PID=""

free_ports() {
  pkill -f "tauri-webdriver" 2>/dev/null || true
  lsof -ti:1420,4444,4445 2>/dev/null | xargs kill 2>/dev/null || true
}
cleanup() {
  local code=${1:-$?}
  [ -n "$DRIVER_PID" ] && kill "$DRIVER_PID" 2>/dev/null || true
  [ -n "$TAURI_PID" ] && { kill -- -"$TAURI_PID" 2>/dev/null || kill "$TAURI_PID" 2>/dev/null || true; }
  free_ports
  exit "$code"
}
trap 'cleanup' EXIT INT TERM

free_ports; sleep 2

# Launch at the config window size (1200x800 — already narrower than the wide
# restored window) by clearing the window-state plugin file. A runtime
# browser.setWindowSize wedges the Tiptap editor, so size is set at launch only.
rm -f "$HOME/Library/Application Support/com.notesage.app/.window-state.json" 2>/dev/null \
  && echo "[capture] cleared window-state (launches at config 1200x800)" || true

echo "[capture] building + launching app (capture config: visible + focus + alwaysOnTop → window stays un-occluded so the editor's rAF hydration never stalls)…"
set -m
pnpm tauri dev --features e2e-testing --config src-tauri/tauri.capture.conf.json > /tmp/notesage-capture-app.log 2>&1 &
TAURI_PID=$!
set +m
echo "[capture] app PID $TAURI_PID — waiting for WebDriver plugin :$PLUGIN_PORT (<= ${APP_READY_TIMEOUT}s)"

elapsed=0
while (( elapsed < APP_READY_TIMEOUT )); do
  if ! kill -0 "$TAURI_PID" 2>/dev/null; then
    echo "[capture] app exited early. Last log lines:"; tail -30 /tmp/notesage-capture-app.log; exit 1
  fi
  if curl -sf "http://localhost:$PLUGIN_PORT/status" >/dev/null 2>&1; then
    echo "[capture] plugin ready (${elapsed}s)"; break
  fi
  sleep $POLL; elapsed=$((elapsed + POLL))
  (( elapsed % 20 == 0 )) && echo "[capture]   …still starting (${elapsed}s)"
done
if (( elapsed >= APP_READY_TIMEOUT )); then
  echo "[capture] timed out waiting for the app"; tail -30 /tmp/notesage-capture-app.log; exit 1
fi

echo "[capture] starting tauri-webdriver bridge…"
tauri-webdriver > /tmp/notesage-capture-driver.log 2>&1 &
DRIVER_PID=$!
for _ in $(seq 1 15); do
  curl -sf "http://localhost:$DRIVER_PORT/status" >/dev/null 2>&1 && break
  sleep 1
done

# Bring the app window to the FOREGROUND. macOS WebKit pauses
# requestAnimationFrame for occluded/background windows, and the editor's
# post-paint hydration (deferPastPaint = rAF×2) never fires while the window
# sits behind the terminal — the doc parses but never renders. Activating the
# app keeps rAF alive for the whole capture.
osascript -e 'tell application "System Events" to set frontmost of (first process whose name contains "notesage") to true' 2>/dev/null \
  && echo "[capture] activated app window (keeps rAF firing)" \
  || echo "[capture] could not activate app window (rAF may stall)"
sleep 1

echo "[capture] running the standalone capture driver (openscans pattern)…"
node scripts/capture-screenshots.mjs || echo "[capture] driver reported a failure — check partial screenshots below"

echo "[capture] done. content/screenshots/:"
ls -l content/screenshots/*.png 2>/dev/null | awk '{print "  "$5" bytes  "$NF}'

#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# run-real-e2e.sh — One-command runner for real Tauri E2E tests
#
# Lifecycle:
#   0. Kill leftover processes from previous runs
#   1. Start `pnpm tauri:test` (Tauri dev with e2e-testing feature flag)
#   2. Wait for the app's WebDriver plugin endpoint (localhost:4445)
#   3. Start `tauri-webdriver` bridge (bridges 4445 → 4444)
#   4. Wait for tauri-webdriver readiness (localhost:4444)
#   5. Run `pnpm test:e2e-real` (WebDriverIO tests)
#   6. Clean up all background processes
#
# Usage:
#   ./scripts/run-real-e2e.sh            # Full run (build + test)
#   ./scripts/run-real-e2e.sh --no-build # Skip Tauri build, assume app is running
# ==============================================================================

# --- Configuration -----------------------------------------------------------

WEBDRIVER_HOST="localhost"
PLUGIN_PORT=4445             # tauri-plugin-webdriver embedded HTTP server
DRIVER_PORT=4444             # tauri-webdriver bridge (W3C WebDriver endpoint)
APP_READY_TIMEOUT=120        # seconds — Tauri dev build can be slow
DRIVER_READY_TIMEOUT=15      # seconds — tauri-webdriver starts fast
POLL_INTERVAL=2              # seconds between readiness polls

# --- Color output ------------------------------------------------------------

if [[ -t 1 ]] && command -v tput &>/dev/null && [[ $(tput colors 2>/dev/null || echo 0) -ge 8 ]]; then
    RED=$(tput setaf 1)
    GREEN=$(tput setaf 2)
    YELLOW=$(tput setaf 3)
    CYAN=$(tput setaf 6)
    BOLD=$(tput bold)
    RESET=$(tput sgr0)
else
    RED="" GREEN="" YELLOW="" CYAN="" BOLD="" RESET=""
fi

# --- Helpers -----------------------------------------------------------------

ts() {
    date "+%H:%M:%S"
}

log()  { echo "${CYAN}[$(ts)]${RESET} $*"; }
ok()   { echo "${GREEN}[$(ts)] ✓${RESET} $*"; }
warn() { echo "${YELLOW}[$(ts)] !${RESET} $*"; }
err()  { echo "${RED}[$(ts)] ✗${RESET} $*" >&2; }

START_TIME=$SECONDS

# --- Parse flags -------------------------------------------------------------

NO_BUILD=false
for arg in "$@"; do
    case "$arg" in
        --no-build) NO_BUILD=true ;;
        --help|-h)
            echo "Usage: $0 [--no-build]"
            echo ""
            echo "  --no-build   Skip starting Tauri app; assume it is already running"
            exit 0
            ;;
        *)
            err "Unknown flag: $arg"
            exit 1
            ;;
    esac
done

# --- Ensure we are in the project root ---------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

log "Project root: ${BOLD}$PROJECT_ROOT${RESET}"

# --- PID tracking & cleanup -------------------------------------------------

TAURI_PID=""
DRIVER_PID=""

cleanup() {
    local exit_code=${1:-$?}
    log "Cleaning up background processes..."

    # Kill tauri-webdriver
    if [[ -n "$DRIVER_PID" ]] && kill -0 "$DRIVER_PID" 2>/dev/null; then
        log "Stopping tauri-webdriver (PID $DRIVER_PID)..."
        kill "$DRIVER_PID" 2>/dev/null || true
        wait "$DRIVER_PID" 2>/dev/null || true
    fi

    # Kill Tauri app and its entire process group
    if [[ -n "$TAURI_PID" ]] && kill -0 "$TAURI_PID" 2>/dev/null; then
        log "Stopping Tauri app (PID $TAURI_PID)..."
        # Kill the process group to get cargo, vite, and the app itself
        kill -- -"$TAURI_PID" 2>/dev/null || kill "$TAURI_PID" 2>/dev/null || true
        wait "$TAURI_PID" 2>/dev/null || true
    fi

    # Belt-and-suspenders: kill any leftovers
    pkill -f "tauri-webdriver" 2>/dev/null || true
    # Kill Vite dev server if orphaned
    lsof -ti:1420 2>/dev/null | xargs kill 2>/dev/null || true

    exit "$exit_code"
}

trap 'cleanup' EXIT
trap 'err "Interrupted"; cleanup 130' INT TERM

# --- Step 0: Kill leftover processes from previous runs --------------------

log "Cleaning up leftover processes..."
pkill -f "tauri-webdriver" 2>/dev/null || true
lsof -ti:1420,4444,4445 2>/dev/null | xargs kill 2>/dev/null || true
# Give a moment for ports to be released
sleep 2

# --- Step 1: Start Tauri app ------------------------------------------------

if [[ "$NO_BUILD" == true ]]; then
    warn "Skipping Tauri app start (--no-build). Assuming app is already running."
else
    log "Starting Tauri app with e2e-testing feature flag..."

    # Start in a new process group (setsid equivalent on macOS) so we can kill
    # the entire tree (cargo + vite + app) in cleanup.
    # Bash's `set -m` enables job control which gives child its own PGID.
    set -m
    pnpm tauri:test > /tmp/notesage-e2e-tauri.log 2>&1 &
    TAURI_PID=$!
    set +m

    ok "Tauri app starting (PID $TAURI_PID, log: /tmp/notesage-e2e-tauri.log)"
fi

# --- Step 2: Wait for plugin endpoint (port 4445) --------------------------

log "Waiting for WebDriver plugin at ${BOLD}${WEBDRIVER_HOST}:${PLUGIN_PORT}${RESET} (timeout: ${APP_READY_TIMEOUT}s)..."

elapsed=0
while (( elapsed < APP_READY_TIMEOUT )); do
    # Check if the Tauri process died unexpectedly
    if [[ "$NO_BUILD" == false ]] && ! kill -0 "$TAURI_PID" 2>/dev/null; then
        err "Tauri app exited unexpectedly. Last 20 lines of log:"
        tail -20 /tmp/notesage-e2e-tauri.log 2>/dev/null || true
        exit 1
    fi

    # Try connecting to the plugin's embedded HTTP server on port 4445
    if curl -sf "http://${WEBDRIVER_HOST}:${PLUGIN_PORT}/status" > /dev/null 2>&1; then
        ok "WebDriver plugin is ready (${elapsed}s)"
        break
    fi

    sleep "$POLL_INTERVAL"
    elapsed=$(( elapsed + POLL_INTERVAL ))

    # Progress indicator every 10 seconds
    if (( elapsed % 10 == 0 )); then
        log "  Still waiting... (${elapsed}s / ${APP_READY_TIMEOUT}s)"
    fi
done

if (( elapsed >= APP_READY_TIMEOUT )); then
    err "Timed out waiting for WebDriver plugin after ${APP_READY_TIMEOUT}s"
    if [[ -f /tmp/notesage-e2e-tauri.log ]]; then
        err "Last 30 lines of Tauri log:"
        tail -30 /tmp/notesage-e2e-tauri.log 2>/dev/null || true
    fi
    exit 1
fi

# --- Step 3: Start tauri-webdriver -------------------------------------------

log "Starting tauri-webdriver bridge..."

if ! command -v tauri-webdriver &>/dev/null; then
    # Check if it's available via npx/pnpm
    if pnpm exec tauri-webdriver --version &>/dev/null 2>&1; then
        DRIVER_CMD="pnpm exec tauri-webdriver"
    else
        err "tauri-webdriver not found in PATH or node_modules."
        err "Install it with: cargo install tauri-webdriver"
        exit 1
    fi
else
    DRIVER_CMD="tauri-webdriver"
fi

$DRIVER_CMD > /tmp/notesage-e2e-driver.log 2>&1 &
DRIVER_PID=$!

ok "tauri-webdriver starting (PID $DRIVER_PID, log: /tmp/notesage-e2e-driver.log)"

# --- Step 4: Wait for tauri-webdriver readiness ------------------------------

log "Waiting for tauri-webdriver to be ready (timeout: ${DRIVER_READY_TIMEOUT}s)..."

elapsed=0
while (( elapsed < DRIVER_READY_TIMEOUT )); do
    if ! kill -0 "$DRIVER_PID" 2>/dev/null; then
        err "tauri-webdriver exited unexpectedly. Log:"
        cat /tmp/notesage-e2e-driver.log 2>/dev/null || true
        exit 1
    fi

    # tauri-webdriver bridges plugin (4445) to W3C WebDriver (4444)
    if curl -sf "http://${WEBDRIVER_HOST}:${DRIVER_PORT}/status" > /dev/null 2>&1; then
        ok "tauri-webdriver is ready (${elapsed}s)"
        break
    fi

    sleep 1
    elapsed=$(( elapsed + 1 ))
done

if (( elapsed >= DRIVER_READY_TIMEOUT )); then
    err "Timed out waiting for tauri-webdriver after ${DRIVER_READY_TIMEOUT}s"
    cat /tmp/notesage-e2e-driver.log 2>/dev/null || true
    exit 1
fi

# --- Step 5: Run tests -------------------------------------------------------

log "Running WebDriverIO tests (sequential, one spec at a time)..."
echo ""

TEST_EXIT_CODE=0
SPECS_PASSED=0
SPECS_FAILED=0

for spec in e2e-real/tests/*.test.ts; do
    spec_name=$(basename "$spec")
    log "Running: ${BOLD}${spec_name}${RESET}"
    if pnpm wdio run wdio.conf.ts --spec "./$spec" 2>&1; then
        ok "$spec_name passed"
        SPECS_PASSED=$((SPECS_PASSED + 1))
    else
        err "$spec_name failed"
        SPECS_FAILED=$((SPECS_FAILED + 1))
        TEST_EXIT_CODE=1
    fi
    echo ""
done

# --- Step 6: Summary ---------------------------------------------------------

ELAPSED_TOTAL=$(( SECONDS - START_TIME ))
MINUTES=$(( ELAPSED_TOTAL / 60 ))
SECS=$(( ELAPSED_TOTAL % 60 ))

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [[ $TEST_EXIT_CODE -eq 0 ]]; then
    echo "${GREEN}${BOLD}  PASS${RESET}  Real E2E tests completed successfully"
else
    echo "${RED}${BOLD}  FAIL${RESET}  Real E2E tests failed"
fi
printf "  Specs: %s passed, %s failed\n" "$SPECS_PASSED" "$SPECS_FAILED"
printf "  Time: %dm %ds\n" "$MINUTES" "$SECS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# cleanup trap will handle killing background processes
exit $TEST_EXIT_CODE

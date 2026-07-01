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
#   5. Run each spec as its own `wdio` invocation against the shared app.
#      On failure, restart the app + bridge and retry the spec ONCE — see
#      "Resilience" below.
#   6. Clean up all background processes
#
# Resilience (issue: real-E2E session-timeout cascade):
#   Specs run as separate `wdio` invocations against ONE long-lived app. Some
#   operations (notably `browser.setWindowSize`) can wedge
#   tauri-plugin-webdriver's session teardown; once wedged, EVERY subsequent
#   spec fails to create a session ("before all … Timeout",
#   "[webview unknown macos]"), turning one flaky spec into a whole-job failure.
#   To contain this, a spec failure triggers a full app+bridge restart and a
#   single retry. A clean app can't inherit a previous spec's wedge, so failures
#   stay local instead of cascading, and a transient flake self-heals on retry.
#   Restarts only happen on failure — green runs pay nothing.
#
# Usage:
#   ./scripts/run-real-e2e.sh            # Full run (build + test)
#   ./scripts/run-real-e2e.sh --no-build # Skip Tauri build, assume app is running
# ==============================================================================

# --- Configuration -----------------------------------------------------------

WEBDRIVER_HOST="localhost"
PLUGIN_PORT=4445             # tauri-plugin-webdriver embedded HTTP server
DRIVER_PORT=4444             # tauri-webdriver bridge (W3C WebDriver endpoint)
APP_READY_TIMEOUT=600        # seconds — cold cargo build on CI can take 5-10 min; dev rebuilds are seconds. 10-minute upper bound absorbs cold-build runners without masking genuine hangs.
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
DRIVER_CMD="tauri-webdriver"

free_ports() {
    pkill -f "tauri-webdriver" 2>/dev/null || true
    lsof -ti:1420,4444,4445 2>/dev/null | xargs kill 2>/dev/null || true
}

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
    free_ports

    exit "$exit_code"
}

trap 'cleanup' EXIT
trap 'err "Interrupted"; cleanup 130' INT TERM

# --- Lifecycle functions -----------------------------------------------------

# Start the Tauri app (build + launch) and wait for the WebDriver plugin
# endpoint. No-op in --no-build mode (the app is managed externally).
# Returns 0 on ready, 1 on failure.
start_app() {
    if [[ "$NO_BUILD" == true ]]; then
        return 0
    fi

    log "Starting Tauri app with e2e-testing feature flag..."
    # Start in a new process group so we can kill the whole tree (cargo + vite
    # + app) in cleanup. `set -m` gives the child its own PGID.
    set -m
    pnpm tauri:test > /tmp/notesage-e2e-tauri.log 2>&1 &
    TAURI_PID=$!
    set +m
    ok "Tauri app starting (PID $TAURI_PID, log: /tmp/notesage-e2e-tauri.log)"

    log "Waiting for WebDriver plugin at ${BOLD}${WEBDRIVER_HOST}:${PLUGIN_PORT}${RESET} (timeout: ${APP_READY_TIMEOUT}s)..."
    local elapsed=0
    while (( elapsed < APP_READY_TIMEOUT )); do
        if ! kill -0 "$TAURI_PID" 2>/dev/null; then
            err "Tauri app exited unexpectedly. Last 20 lines of log:"
            tail -20 /tmp/notesage-e2e-tauri.log 2>/dev/null || true
            return 1
        fi
        if curl -sf "http://${WEBDRIVER_HOST}:${PLUGIN_PORT}/status" > /dev/null 2>&1; then
            ok "WebDriver plugin is ready (${elapsed}s)"
            return 0
        fi
        sleep "$POLL_INTERVAL"
        elapsed=$(( elapsed + POLL_INTERVAL ))
        if (( elapsed % 10 == 0 )); then
            log "  Still waiting... (${elapsed}s / ${APP_READY_TIMEOUT}s)"
        fi
    done

    err "Timed out waiting for WebDriver plugin after ${APP_READY_TIMEOUT}s"
    tail -30 /tmp/notesage-e2e-tauri.log 2>/dev/null || true
    return 1
}

# Start the tauri-webdriver bridge and wait for readiness.
# Returns 0 on ready, 1 on failure.
start_bridge() {
    log "Starting tauri-webdriver bridge..."
    $DRIVER_CMD > /tmp/notesage-e2e-driver.log 2>&1 &
    DRIVER_PID=$!
    ok "tauri-webdriver starting (PID $DRIVER_PID, log: /tmp/notesage-e2e-driver.log)"

    log "Waiting for tauri-webdriver to be ready (timeout: ${DRIVER_READY_TIMEOUT}s)..."
    local elapsed=0
    while (( elapsed < DRIVER_READY_TIMEOUT )); do
        if ! kill -0 "$DRIVER_PID" 2>/dev/null; then
            err "tauri-webdriver exited unexpectedly. Log:"
            cat /tmp/notesage-e2e-driver.log 2>/dev/null || true
            return 1
        fi
        if curl -sf "http://${WEBDRIVER_HOST}:${DRIVER_PORT}/status" > /dev/null 2>&1; then
            ok "tauri-webdriver is ready (${elapsed}s)"
            return 0
        fi
        sleep 1
        elapsed=$(( elapsed + 1 ))
    done

    err "Timed out waiting for tauri-webdriver after ${DRIVER_READY_TIMEOUT}s"
    cat /tmp/notesage-e2e-driver.log 2>/dev/null || true
    return 1
}

# Tear down the app + bridge and free the ports.
stop_stack() {
    if [[ -n "$DRIVER_PID" ]] && kill -0 "$DRIVER_PID" 2>/dev/null; then
        kill "$DRIVER_PID" 2>/dev/null || true
        wait "$DRIVER_PID" 2>/dev/null || true
    fi
    if [[ "$NO_BUILD" == false && -n "$TAURI_PID" ]] && kill -0 "$TAURI_PID" 2>/dev/null; then
        kill -- -"$TAURI_PID" 2>/dev/null || kill "$TAURI_PID" 2>/dev/null || true
        wait "$TAURI_PID" 2>/dev/null || true
    fi
    DRIVER_PID=""
    if [[ "$NO_BUILD" == false ]]; then TAURI_PID=""; fi
    free_ports
    sleep 2
}

# Restart the app (when we own it) + bridge — clears a wedged plugin session
# so a failed spec doesn't cascade into the rest. Returns 0 on success.
restart_stack() {
    warn "Restarting app + bridge to clear any wedged WebDriver session..."
    stop_stack
    if [[ "$NO_BUILD" == false ]]; then
        start_app || return 1
    fi
    start_bridge || return 1
}

run_spec() {
    pnpm wdio run wdio.conf.ts --spec "./$1" 2>&1
}

# --- Step 0: Kill leftover processes from previous runs --------------------

log "Cleaning up leftover processes..."
free_ports
sleep 2

# --- Resolve the bridge command ---------------------------------------------

if ! command -v tauri-webdriver &>/dev/null; then
    if pnpm exec tauri-webdriver --version &>/dev/null 2>&1; then
        DRIVER_CMD="pnpm exec tauri-webdriver"
    else
        err "tauri-webdriver not found in PATH or node_modules."
        err "Install it with: cargo install tauri-webdriver"
        exit 1
    fi
fi

# --- Steps 1-4: Start the stack ---------------------------------------------

if [[ "$NO_BUILD" == true ]]; then
    warn "Skipping Tauri app start (--no-build). Assuming app is already running."
fi
start_app || exit 1
start_bridge || exit 1

# --- Step 5: Run tests (with restart-on-failure + single retry) -------------

log "Running WebDriverIO tests (sequential, one spec at a time)..."
echo ""

TEST_EXIT_CODE=0
SPECS_PASSED=0
SPECS_FAILED=0
SPECS_RETRIED=0

for spec in e2e-real/tests/*.test.ts; do
    spec_name=$(basename "$spec")
    log "Running: ${BOLD}${spec_name}${RESET}"

    if run_spec "$spec"; then
        ok "$spec_name passed"
        SPECS_PASSED=$((SPECS_PASSED + 1))
        echo ""
        continue
    fi

    # First attempt failed. Restart the stack to clear any wedged session, then
    # retry once. If we can't restart (e.g. --no-build), retry against the same
    # app — still useful for genuinely transient failures.
    warn "$spec_name failed — restarting app + retrying once"
    SPECS_RETRIED=$((SPECS_RETRIED + 1))
    if ! restart_stack; then
        err "Could not restart the stack — aborting remaining specs"
        SPECS_FAILED=$((SPECS_FAILED + 1))
        TEST_EXIT_CODE=1
        break
    fi

    if run_spec "$spec"; then
        ok "$spec_name passed on retry"
        SPECS_PASSED=$((SPECS_PASSED + 1))
    else
        err "$spec_name failed after retry"
        SPECS_FAILED=$((SPECS_FAILED + 1))
        TEST_EXIT_CODE=1
        # Restart again so a wedge from this spec doesn't poison the next one.
        restart_stack || { err "Restart failed — aborting"; break; }
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
printf "  Specs: %s passed, %s failed (%s retried)\n" "$SPECS_PASSED" "$SPECS_FAILED" "$SPECS_RETRIED"
printf "  Time: %dm %ds\n" "$MINUTES" "$SECS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# cleanup trap will handle killing background processes
exit $TEST_EXIT_CODE

#!/usr/bin/env bash
# pi Seatbelt spike (task #2, PRD 2026-07-29-pi-local-agent-preset):
# prove that pi v0.80.6 with PI_OFFLINE=1 completes an agentic turn against a
# localhost OpenAI-compatible stub under a deny-all-network Seatbelt profile,
# and pin down the HTTP_PROXY/undici interaction.
#
# macOS only (sandbox-exec). Run locally or via the spike-pi-seatbelt workflow.
# Scenarios:
#   1. baseline   — sandboxed, no proxy env            → must PASS
#   2. proxy-env  — sandboxed, HTTP(S)_PROXY set to an unreachable port,
#                   no NO_PROXY                        → outcome recorded
#   3. no-proxy   — same proxy env + NO_PROXY=localhost,127.0.0.1 → must PASS
# Exit 0 only if scenarios 1 and 3 pass; scenario 2's outcome decides whether
# task #16 must inject NO_PROXY (see summary line).
set -euo pipefail

PI_VERSION="${PI_VERSION:-0.80.6}"
STUB_PORT="${STUB_PORT:-8137}"
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${WORK_DIR:-$(mktemp -d /tmp/pi-seatbelt-spike.XXXXXX)}"

[[ "$(uname)" == "Darwin" ]] || { echo "ERROR: Seatbelt spike requires macOS (sandbox-exec)"; exit 1; }
command -v node >/dev/null || { echo "ERROR: node is required for the stub server + RPC driver"; exit 1; }

case "$(uname -m)" in
  arm64) ASSET="pi-darwin-arm64.tar.gz" ;;
  x86_64) ASSET="pi-darwin-x64.tar.gz" ;;
  *) echo "ERROR: unsupported arch $(uname -m)"; exit 1 ;;
esac

echo "== work dir: $WORK (pi v$PI_VERSION, $ASSET)"
cd "$WORK"

# --- Fetch + verify (same integrity bar as the managed install, task #15) ---
BASE="https://github.com/earendil-works/pi/releases/download/v${PI_VERSION}"
[[ -f "$ASSET" ]] || curl -fsSL --retry 3 -o "$ASSET" "$BASE/$ASSET"
curl -fsSL --retry 3 -o SHA256SUMS "$BASE/SHA256SUMS"
grep " ${ASSET}\$" SHA256SUMS | shasum -a 256 -c -
mkdir -p extracted && tar xzf "$ASSET" -C extracted
PI_BIN="$WORK/extracted/pi/pi"

# --- pi home (flat layout — verified in spike #1) ---
PI_HOME="$WORK/pi-home"
mkdir -p "$PI_HOME/extensions"
cp "$HERE/pi-seatbelt/extensions/marker.ts" "$PI_HOME/extensions/"
cat > "$PI_HOME/models.json" <<EOF
{
  "providers": {
    "local": {
      "name": "Local Stub",
      "baseUrl": "http://127.0.0.1:${STUB_PORT}/v1",
      "api": "openai-completions",
      "apiKey": "dummy",
      "models": [
        { "id": "stub-model", "name": "Stub Model", "contextWindow": 8192, "maxTokens": 1024 }
      ]
    }
  }
}
EOF

# --- Seatbelt profile: deny all network except loopback:STUB_PORT ---
# Mirrors the network posture of the Local Agent preset profile (deny default
# + single localhost port literal). FS is left open — this spike isolates the
# NETWORK question; the full preset profile is regression-locked in sandbox.rs.
PROFILE="$WORK/spike.sb"
cat > "$PROFILE" <<EOF
(version 1)
(allow default)
(deny network*)
(allow network-outbound (remote ip "localhost:${STUB_PORT}"))
EOF

# --- Stub server ---
rm -f "$WORK/stub.log"
STUB_PORT="$STUB_PORT" STUB_LOG="$WORK/stub.log" node "$HERE/pi-seatbelt/stub-openai.mjs" &
STUB_PID=$!
trap 'kill "$STUB_PID" 2>/dev/null || true' EXIT
sleep 1

run_scenario() {
  local name="$1" extra_env_json="$2"
  echo "== scenario: $name"
  local rc=0
  PI_BIN="$PI_BIN" PI_HOME="$PI_HOME" SANDBOX_PROFILE="$PROFILE" \
    SPIKE_MARKER_FILE="$WORK/marker-$name.txt" EXTRA_ENV_JSON="$extra_env_json" \
    node "$HERE/pi-seatbelt/rpc-turn.mjs" || rc=$?
  echo "== scenario $name exit: $rc"
  return $rc
}

FAIL=0
run_scenario baseline '{}' || { echo "FAIL: baseline sandboxed turn"; FAIL=1; }

# Unreachable proxy: if pi honors HTTP(S)_PROXY for the localhost call, the
# turn cannot complete. Deadline exit (2) or error (3) here means task #16
# MUST inject NO_PROXY / strip proxy env for the pi preset.
PROXY_ENV='{"HTTP_PROXY":"http://127.0.0.1:9","HTTPS_PROXY":"http://127.0.0.1:9"}'
if run_scenario proxy-env "$PROXY_ENV"; then
  echo "RESULT proxy-env: pi ignored the proxy for localhost — NO_PROXY optional (defense-in-depth only)"
else
  echo "RESULT proxy-env: pi honors HTTP(S)_PROXY for localhost — task #16 MUST set NO_PROXY (expected outcome)"
fi

NOPROXY_ENV='{"HTTP_PROXY":"http://127.0.0.1:9","HTTPS_PROXY":"http://127.0.0.1:9","NO_PROXY":"localhost,127.0.0.1","no_proxy":"localhost,127.0.0.1"}'
run_scenario no-proxy "$NOPROXY_ENV" || { echo "FAIL: NO_PROXY mitigation did not restore the turn"; FAIL=1; }

echo "== stub request log:"
cat "$WORK/stub.log"
echo "== extension marker (baseline):"
cat "$WORK/marker-baseline.txt" 2>/dev/null || { echo "FAIL: extension did not load under sandbox"; FAIL=1; }

if [[ "$FAIL" == 0 ]]; then
  echo "SPIKE #2: PASS (record this output in docs/research/2026-07-29-pi-spikes.md)"
else
  echo "SPIKE #2: FAIL — see scenario output above"
fi
exit "$FAIL"

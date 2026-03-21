#!/bin/bash
# Test Seatbelt deny-default network isolation profiles
# Based on Anthropic sandbox-runtime analysis (2026-03-21)
#
# Key insight: srt uses (deny default) as blanket deny, then selective (allow ...) rules.
# There are ZERO explicit (deny network*) rules — all network denial comes from the default deny.
# Notesage already has (deny default) at the top of its profile. The fix is to remove
# (allow network*) and add targeted network allows instead.
#
# Usage: ./test-seatbelt-network-deny.sh [proxy_port]
# Requires: macOS with sandbox-exec, a running HTTP server on localhost for proxy simulation

set -euo pipefail

PROXY_PORT="${1:-8899}"
PROFILE_DIR=$(mktemp -d)
PASS=0
FAIL=0
SKIP=0

cleanup() {
    rm -rf "$PROFILE_DIR"
}
trap cleanup EXIT

log_pass() { echo "  PASS: $1"; ((PASS++)); }
log_fail() { echo "  FAIL: $1"; ((FAIL++)); }
log_skip() { echo "  SKIP: $1"; ((SKIP++)); }

# Start a simple HTTP echo server on the proxy port for testing
start_echo_server() {
    # Use python to create a minimal server that responds to any request
    python3 -c "
import http.server, socketserver, threading
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self): self.send_response(200); self.end_headers(); self.wfile.write(b'OK')
    def do_CONNECT(self): self.send_response(200); self.end_headers()
    def log_message(self, *a): pass
s = socketserver.TCPServer(('127.0.0.1', $PROXY_PORT), H)
s.serve_forever()
" &
    ECHO_PID=$!
    sleep 0.5
    # Verify it started
    if ! kill -0 $ECHO_PID 2>/dev/null; then
        echo "ERROR: Could not start echo server on port $PROXY_PORT"
        exit 1
    fi
}

stop_echo_server() {
    if [[ -n "${ECHO_PID:-}" ]]; then
        kill $ECHO_PID 2>/dev/null || true
        wait $ECHO_PID 2>/dev/null || true
    fi
}

# ============================================================================
# Profile 1: Baseline — (deny default) + (allow network*)
# This is what Notesage does today. Should work for everything.
# ============================================================================
test_baseline() {
    echo ""
    echo "=== Profile 1: Baseline (deny default + allow network*) ==="

    cat > "$PROFILE_DIR/baseline.sb" << 'EOF'
(version 1)
(deny default)
(allow file-read*)
(allow process-exec*)
(allow process-fork)
(allow sysctl-read)
(allow mach-lookup)
(allow signal)
(allow ipc-posix-shm*)
(allow network*)
EOF

    # Test: can reach external site
    if sandbox-exec -f "$PROFILE_DIR/baseline.sb" curl -s --max-time 5 -o /dev/null -w "%{http_code}" https://httpbin.org/get 2>/dev/null | grep -q "200"; then
        log_pass "Baseline can reach external site"
    else
        log_skip "Baseline external site (network may be unavailable)"
    fi

    # Test: can reach localhost
    if sandbox-exec -f "$PROFILE_DIR/baseline.sb" curl -s --max-time 2 -o /dev/null http://127.0.0.1:$PROXY_PORT 2>/dev/null; then
        log_pass "Baseline can reach localhost:$PROXY_PORT"
    else
        log_fail "Baseline cannot reach localhost:$PROXY_PORT"
    fi
}

# ============================================================================
# Profile 2: deny-default with NO network allows (everything blocked)
# Validates that (deny default) actually blocks network when no allow is present
# ============================================================================
test_deny_all() {
    echo ""
    echo "=== Profile 2: Deny all network (no network allows) ==="

    cat > "$PROFILE_DIR/deny-all.sb" << 'EOF'
(version 1)
(deny default)
(allow file-read*)
(allow process-exec*)
(allow process-fork)
(allow sysctl-read)
(allow mach-lookup)
(allow signal)
(allow ipc-posix-shm*)
EOF

    # Test: CANNOT reach external site
    if sandbox-exec -f "$PROFILE_DIR/deny-all.sb" curl -s --max-time 3 -o /dev/null https://httpbin.org/get 2>/dev/null; then
        log_fail "Deny-all should NOT reach external site"
    else
        log_pass "Deny-all correctly blocks external site"
    fi

    # Test: CANNOT reach localhost
    if sandbox-exec -f "$PROFILE_DIR/deny-all.sb" curl -s --max-time 2 -o /dev/null http://127.0.0.1:$PROXY_PORT 2>/dev/null; then
        log_fail "Deny-all should NOT reach localhost"
    else
        log_pass "Deny-all correctly blocks localhost"
    fi
}

# ============================================================================
# Profile 3: Selective localhost allow (exact proxy port)
# The srt approach: only allow outbound to the specific proxy port
# ============================================================================
test_proxy_port_only() {
    echo ""
    echo "=== Profile 3: Allow only proxy port (localhost:$PROXY_PORT) ==="

    cat > "$PROFILE_DIR/proxy-only.sb" << EOF
(version 1)
(deny default)
(allow file-read*)
(allow process-exec*)
(allow process-fork)
(allow sysctl-read)
(allow mach-lookup)
(allow signal)
(allow ipc-posix-shm*)

;; Allow only the proxy port on localhost (srt pattern)
(allow network-outbound (remote ip "localhost:$PROXY_PORT"))
EOF

    # Test: CAN reach proxy port
    if sandbox-exec -f "$PROFILE_DIR/proxy-only.sb" curl -s --max-time 2 -o /dev/null http://127.0.0.1:$PROXY_PORT 2>/dev/null; then
        log_pass "Proxy-only can reach localhost:$PROXY_PORT"
    else
        log_fail "Proxy-only cannot reach localhost:$PROXY_PORT"
    fi

    # Test: CANNOT reach external site
    if sandbox-exec -f "$PROFILE_DIR/proxy-only.sb" curl -s --max-time 3 -o /dev/null https://httpbin.org/get 2>/dev/null; then
        log_fail "Proxy-only should NOT reach external site"
    else
        log_pass "Proxy-only correctly blocks external site"
    fi

    # Test: CANNOT reach other localhost ports
    local OTHER_PORT=$((PROXY_PORT + 1))
    if sandbox-exec -f "$PROFILE_DIR/proxy-only.sb" curl -s --max-time 2 -o /dev/null http://127.0.0.1:$OTHER_PORT 2>/dev/null; then
        log_fail "Proxy-only should NOT reach other localhost ports"
    else
        log_pass "Proxy-only correctly blocks other localhost ports"
    fi
}

# ============================================================================
# Profile 4: Localhost wildcard (srt's allowLocalBinding pattern)
# Uses "*:*" for IPv6 dual-stack compatibility
# ============================================================================
test_localhost_wildcard() {
    echo ""
    echo "=== Profile 4: Allow all localhost (srt allowLocalBinding pattern) ==="

    cat > "$PROFILE_DIR/localhost-wild.sb" << EOF
(version 1)
(deny default)
(allow file-read*)
(allow process-exec*)
(allow process-fork)
(allow sysctl-read)
(allow mach-lookup)
(allow signal)
(allow ipc-posix-shm*)

;; srt pattern: "*:*" with (local ...) for IPv6 dual-stack compatibility
(allow network-bind (local ip "*:*"))
(allow network-inbound (local ip "*:*"))
(allow network-outbound (remote ip "localhost:$PROXY_PORT"))
EOF

    # Test: CAN reach proxy port
    if sandbox-exec -f "$PROFILE_DIR/localhost-wild.sb" curl -s --max-time 2 -o /dev/null http://127.0.0.1:$PROXY_PORT 2>/dev/null; then
        log_pass "Localhost-wild can reach proxy port"
    else
        log_fail "Localhost-wild cannot reach proxy port"
    fi

    # Test: CANNOT reach external site
    if sandbox-exec -f "$PROFILE_DIR/localhost-wild.sb" curl -s --max-time 3 -o /dev/null https://httpbin.org/get 2>/dev/null; then
        log_fail "Localhost-wild should NOT reach external site"
    else
        log_pass "Localhost-wild correctly blocks external site"
    fi
}

# ============================================================================
# Profile 5: Full Notesage-compatible profile (srt-inspired)
# This is the profile we want to ship — includes all needed rules
# ============================================================================
test_full_profile() {
    echo ""
    echo "=== Profile 5: Full Notesage profile (srt-inspired) ==="

    local HOME_DIR="$HOME"

    cat > "$PROFILE_DIR/full.sb" << EOF
(version 1)
(deny default)

;; Allow reading system files (agents need binaries, libraries, configs)
(allow file-read*)

;; Allow writing to temp and agent config dirs
(allow file-write*
  (subpath "/tmp")
  (subpath "/private/tmp")
  (subpath "/private/var/folders")
  (subpath "$HOME_DIR/.notesage")
  (subpath "$HOME_DIR/.claude")
  (subpath "$HOME_DIR/.codex")
  (subpath "$HOME_DIR/.copilot")
  (subpath "$HOME_DIR/.gemini")
  (subpath "$HOME_DIR/.config"))

;; DENY reading sensitive directories
(deny file-read*
  (subpath "$HOME_DIR/.ssh")
  (subpath "$HOME_DIR/.aws")
  (subpath "$HOME_DIR/.gnupg")
  (subpath "$HOME_DIR/.config/gcloud")
  (regex #"\\.env$")
  (regex #"\\.env\\..*$"))

;; Protect .git internals from writes
(deny file-write*
  (regex #".*/\\.git($|/.*)"))

;; Process execution
(allow process-exec*)
(allow process-fork)

;; System IPC and info
(allow sysctl-read)
(allow mach-lookup)
(allow signal)
(allow ipc-posix-shm*)

;; NETWORK: deny-default handles the deny. Selective allows below.

;; Allow connecting to the proxy port
(allow network-outbound (remote ip "localhost:$PROXY_PORT"))

;; Allow localhost bind + inbound for agent subprocesses
(allow network-bind (local ip "*:*"))
(allow network-inbound (local ip "*:*"))

;; Allow Unix domain sockets for system IPC (mDNSResponder, etc.)
(allow system-socket (socket-domain AF_UNIX))
(allow network-outbound (remote unix-socket (subpath "/var/run")))
(allow network-outbound (remote unix-socket (subpath "/private/var/run")))
(allow network-bind (local unix-socket (subpath "/tmp")))
(allow network-bind (local unix-socket (subpath "/private/tmp")))

;; Go TLS cert verification needs trustd
(allow mach-lookup (global-name "com.apple.trustd.agent"))

;; System socket for AF_SYSTEM (kernel events, safe)
(allow system-socket (require-all (socket-domain AF_SYSTEM) (socket-protocol 2)))
EOF

    # Test: CAN reach proxy port
    if sandbox-exec -f "$PROFILE_DIR/full.sb" curl -s --max-time 2 -o /dev/null http://127.0.0.1:$PROXY_PORT 2>/dev/null; then
        log_pass "Full profile can reach proxy port"
    else
        log_fail "Full profile cannot reach proxy port"
    fi

    # Test: CANNOT reach external site directly
    if sandbox-exec -f "$PROFILE_DIR/full.sb" curl -s --max-time 3 -o /dev/null https://httpbin.org/get 2>/dev/null; then
        log_fail "Full profile should NOT reach external site"
    else
        log_pass "Full profile correctly blocks external site"
    fi

    # Test: CAN reach external site through proxy
    if sandbox-exec -f "$PROFILE_DIR/full.sb" curl -s --max-time 5 --proxy "http://127.0.0.1:$PROXY_PORT" -o /dev/null http://127.0.0.1:$PROXY_PORT 2>/dev/null; then
        log_pass "Full profile can reach proxy (agent would use HTTP_PROXY)"
    else
        log_fail "Full profile cannot reach proxy"
    fi

    # Test: CAN write to allowed paths
    if sandbox-exec -f "$PROFILE_DIR/full.sb" touch /tmp/notesage-sandbox-test 2>/dev/null; then
        log_pass "Full profile can write to /tmp"
        rm -f /tmp/notesage-sandbox-test
    else
        log_fail "Full profile cannot write to /tmp"
    fi

    # Test: CANNOT read .ssh
    if sandbox-exec -f "$PROFILE_DIR/full.sb" ls "$HOME_DIR/.ssh/" >/dev/null 2>&1; then
        log_fail "Full profile should NOT read .ssh"
    else
        log_pass "Full profile correctly blocks .ssh read"
    fi

    # Test: CAN run git
    if sandbox-exec -f "$PROFILE_DIR/full.sb" git --version >/dev/null 2>&1; then
        log_pass "Full profile can run git"
    else
        log_fail "Full profile cannot run git"
    fi

    # Test: CAN run node (if available — agents are Node.js)
    if command -v node >/dev/null 2>&1; then
        if sandbox-exec -f "$PROFILE_DIR/full.sb" node -e "console.log('ok')" >/dev/null 2>&1; then
            log_pass "Full profile can run node"
        else
            log_fail "Full profile cannot run node"
        fi
    else
        log_skip "node not found"
    fi

    echo ""
    echo "  Full profile saved to: $PROFILE_DIR/full.sb"
    echo "  Inspect with: cat $PROFILE_DIR/full.sb"
}

# ============================================================================
# Profile 6: Test with actual agent binary (if available)
# ============================================================================
test_agent_binary() {
    local agent_name="$1"
    local agent_bin="$2"

    echo ""
    echo "=== Agent test: $agent_name ==="

    if ! command -v "$agent_bin" >/dev/null 2>&1; then
        # Check managed install path
        local managed="$HOME/.notesage/agents/bin/$agent_bin"
        if [[ -x "$managed" ]]; then
            agent_bin="$managed"
        else
            log_skip "$agent_name not found ($agent_bin)"
            return
        fi
    fi

    # Test: can the agent binary start under the full profile?
    # We just test if it can be executed (--version or --help), not a full session
    if sandbox-exec -f "$PROFILE_DIR/full.sb" "$agent_bin" --version >/dev/null 2>&1; then
        log_pass "$agent_name can start under full profile"
    elif sandbox-exec -f "$PROFILE_DIR/full.sb" "$agent_bin" --help >/dev/null 2>&1; then
        log_pass "$agent_name can start under full profile (--help)"
    else
        log_fail "$agent_name CANNOT start under full profile"
    fi
}

# ============================================================================
# Main
# ============================================================================
echo "Seatbelt Network Deny Test Suite"
echo "================================"
echo "macOS version: $(sw_vers -productVersion)"
echo "Proxy port: $PROXY_PORT"
echo "Profile dir: $PROFILE_DIR"

start_echo_server

test_baseline
test_deny_all
test_proxy_port_only
test_localhost_wildcard
test_full_profile

# Test agent binaries if available
test_agent_binary "Claude Code" "claude"
test_agent_binary "Codex" "codex"
test_agent_binary "Copilot" "copilot"
test_agent_binary "Gemini CLI" "gemini"

stop_echo_server

echo ""
echo "================================"
echo "Results: $PASS passed, $FAIL failed, $SKIP skipped"
echo ""

if [[ $FAIL -gt 0 ]]; then
    echo "SOME TESTS FAILED — review output above"
    exit 1
else
    echo "ALL TESTS PASSED"
    exit 0
fi

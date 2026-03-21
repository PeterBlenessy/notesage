#!/bin/bash
# Verify that a Seatbelt sandbox profile actually blocks direct network access.
#
# This script reads the most recently generated sandbox profile from
# ~/.notesage/sandbox/profiles/ and runs tests under it.
#
# Usage: ./verify-kernel-enforcement.sh [profile_path]
#   If no profile path given, uses the newest .sb file in ~/.notesage/sandbox/profiles/

set -euo pipefail

PROFILE="${1:-}"

if [[ -z "$PROFILE" ]]; then
    PROFILE=$(ls -t ~/.notesage/sandbox/profiles/*.sb 2>/dev/null | head -1)
    if [[ -z "$PROFILE" ]]; then
        echo "No sandbox profiles found in ~/.notesage/sandbox/profiles/"
        echo "Start an agent with sandbox + network restriction + kernel enforcement enabled first."
        exit 1
    fi
fi

echo "Seatbelt profile: $PROFILE"
echo "macOS: $(sw_vers -productVersion)"
echo ""

# Check if profile uses deny-first (no "allow network*")
if grep -q "(allow network\*)" "$PROFILE"; then
    echo "WARNING: This profile uses (allow network*) — kernel enforcement is OFF."
    echo "Enable 'Kernel enforcement' in the connection config and restart the agent."
    echo ""
fi

echo "=== Profile network rules ==="
grep -E "network|AF_UNIX|AF_SYSTEM|trustd" "$PROFILE" | head -20
echo ""

# --- Test 1: Direct external connection (should FAIL) ---
echo "=== Test 1: Direct connection to external site ==="
echo "  Running: curl -s --connect-timeout 3 https://httpbin.org/get"
if sandbox-exec -f "$PROFILE" curl -s --connect-timeout 3 https://httpbin.org/get >/dev/null 2>&1; then
    echo "  FAIL: Direct external connection succeeded — kernel enforcement NOT working"
else
    echo "  PASS: Direct external connection blocked (exit $?)"
fi
echo ""

# --- Test 2: Direct connection to a non-proxy localhost port (should FAIL if strict) ---
echo "=== Test 2: Connection to random localhost port ==="
echo "  Running: curl -s --connect-timeout 2 http://127.0.0.1:19999"
if sandbox-exec -f "$PROFILE" curl -s --connect-timeout 2 http://127.0.0.1:19999 >/dev/null 2>&1; then
    echo "  INFO: Localhost connection succeeded (expected if profile allows localhost:*)"
else
    echo "  INFO: Localhost connection blocked (strict proxy-port-only mode)"
fi
echo ""

# --- Test 3: DNS resolution (should FAIL — DNS goes through proxy) ---
echo "=== Test 3: DNS resolution ==="
echo "  Running: nslookup httpbin.org"
if sandbox-exec -f "$PROFILE" nslookup httpbin.org 127.0.0.1 >/dev/null 2>&1; then
    echo "  INFO: DNS resolution works (some profiles allow UDP 53)"
else
    echo "  PASS: DNS resolution blocked (expected — DNS should go through proxy)"
fi
echo ""

# --- Test 4: Node.js direct fetch (simulates what an agent would do) ---
echo "=== Test 4: Node.js direct HTTPS fetch ==="
if command -v node >/dev/null 2>&1; then
    RESULT=$(sandbox-exec -f "$PROFILE" node -e "
const https = require('https');
const req = https.get('https://httpbin.org/get', (res) => {
  process.stdout.write('CONNECTED:' + res.statusCode);
  process.exit(0);
});
req.on('error', (e) => {
  process.stdout.write('BLOCKED:' + e.code);
  process.exit(0);
});
req.setTimeout(3000, () => { process.stdout.write('TIMEOUT'); req.destroy(); process.exit(0); });
" 2>/dev/null)
    if [[ "$RESULT" == BLOCKED:* ]] || [[ "$RESULT" == "TIMEOUT" ]]; then
        echo "  PASS: Node.js direct fetch blocked ($RESULT)"
    else
        echo "  FAIL: Node.js direct fetch succeeded ($RESULT)"
    fi
else
    echo "  SKIP: node not found"
fi
echo ""

# --- Test 5: Node.js fetch through proxy (simulates normal agent behavior) ---
echo "=== Test 5: Node.js fetch through proxy (find proxy port from profile) ==="
PROXY_PORT=$(grep -o 'localhost:[0-9]*' "$PROFILE" | head -1 | cut -d: -f2)
if [[ -n "$PROXY_PORT" ]]; then
    echo "  Proxy port from profile: $PROXY_PORT"
    RESULT=$(sandbox-exec -f "$PROFILE" node -e "
const http = require('http');
const req = http.get('http://127.0.0.1:$PROXY_PORT', (res) => {
  process.stdout.write('CONNECTED:' + res.statusCode);
  process.exit(0);
});
req.on('error', (e) => {
  process.stdout.write('ERROR:' + e.code);
  process.exit(0);
});
req.setTimeout(2000, () => { process.stdout.write('TIMEOUT'); req.destroy(); process.exit(0); });
" 2>/dev/null)
    if [[ "$RESULT" == CONNECTED:* ]]; then
        echo "  PASS: Can reach proxy port ($RESULT)"
    else
        echo "  INFO: Proxy port not responding ($RESULT) — is the agent running?"
    fi
else
    echo "  SKIP: Could not extract proxy port from profile"
fi
echo ""

# --- Test 6: Check system log for sandbox violations ---
echo "=== Test 6: Recent sandbox violations (last 30s) ==="
log show --predicate 'eventMessage CONTAINS "deny"' --style compact --last 30s 2>/dev/null | grep -i sandbox | tail -5
if [[ $? -ne 0 ]]; then
    echo "  (no recent sandbox violations found)"
fi
echo ""

echo "=== Summary ==="
echo "If Test 1 and Test 4 show PASS, kernel enforcement is working."
echo "Agents can only reach the network through the proxy on port ${PROXY_PORT:-unknown}."

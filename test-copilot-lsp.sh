#!/bin/bash
# Test script: talk to copilot-language-server directly and see raw responses
# Usage: ./test-copilot-lsp.sh

BINARY=$(which copilot-language-server 2>/dev/null || echo "$HOME/.npm-global/bin/copilot-language-server")
if [ ! -x "$BINARY" ]; then
  echo "copilot-language-server not found"
  exit 1
fi

TMPDIR=$(mktemp -d)
FIFO_IN="$TMPDIR/lsp_in"
FIFO_OUT="$TMPDIR/lsp_out"
mkfifo "$FIFO_IN" "$FIFO_OUT"

# Start the LSP
"$BINARY" --stdio < "$FIFO_IN" > "$FIFO_OUT" 2>"$TMPDIR/lsp_stderr.log" &
LSP_PID=$!
echo "LSP PID: $LSP_PID"

send_msg() {
  local json="$1"
  local len=${#json}
  printf "Content-Length: %d\r\n\r\n%s" "$len" "$json" > "$FIFO_IN"
}

read_msg() {
  # Read Content-Length header
  local header
  read -r header < "$FIFO_OUT"
  local length=$(echo "$header" | grep -oP '\d+')
  read -r _ < "$FIFO_OUT"  # empty line
  # Read body
  dd bs=1 count="$length" < "$FIFO_OUT" 2>/dev/null
  echo
}

# 1. Initialize
echo "=== Sending initialize ==="
INIT_REQ='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"processId":'$$',"workspaceFolders":[{"uri":"file:///tmp/test","name":"test"}],"capabilities":{"workspace":{"workspaceFolders":true,"configuration":true},"textDocument":{"synchronization":{"dynamicRegistration":false},"inlineCompletion":{"dynamicRegistration":false}}},"initializationOptions":{"editorInfo":{"name":"TestEditor","version":"1.0.0"},"editorPluginInfo":{"name":"test-copilot","version":"1.0.0"}}}}'
send_msg "$INIT_REQ"
echo "=== Initialize response ==="
read_msg

# 2. initialized notification
echo "=== Sending initialized ==="
send_msg '{"jsonrpc":"2.0","method":"initialized","params":{}}'

# 3. didChangeConfiguration
echo "=== Sending didChangeConfiguration ==="
send_msg '{"jsonrpc":"2.0","method":"workspace/didChangeConfiguration","params":{"settings":{"telemetry":{"telemetryLevel":"off"},"github.copilot":{"enable":{"*":true,"markdown":true},"inlineSuggest.enable":true}}}}'

# Wait for server to settle and process any requests
echo "=== Waiting 3s for server ==="
sleep 3

# Read any server-initiated messages
echo "=== Server stderr (first 50 lines) ==="
head -50 "$TMPDIR/lsp_stderr.log" 2>/dev/null

# 4. didOpen
echo "=== Sending didOpen ==="
send_msg '{"jsonrpc":"2.0","method":"textDocument/didOpen","params":{"textDocument":{"uri":"file:///tmp/test/test.md","languageId":"markdown","version":0,"text":"# Hello World\n\nThis is a test document about programming.\n\n"}}}'

# 5. didFocus
echo "=== Sending didFocus ==="
send_msg '{"jsonrpc":"2.0","method":"textDocument/didFocus","params":{"textDocument":{"uri":"file:///tmp/test/test.md"}}}'

sleep 1

# 6. didChange - add some text
echo "=== Sending didChange ==="
send_msg '{"jsonrpc":"2.0","method":"textDocument/didChange","params":{"textDocument":{"uri":"file:///tmp/test/test.md","version":1},"contentChanges":[{"text":"# Hello World\n\nThis is a test document about programming.\n\nfunction calculateSum("}]}}'

sleep 1

# 7. Request completion
echo "=== Sending inlineCompletion request ==="
send_msg '{"jsonrpc":"2.0","id":2,"method":"textDocument/inlineCompletion","params":{"textDocument":{"uri":"file:///tmp/test/test.md","version":1},"position":{"line":4,"character":22},"context":{"triggerKind":2},"formattingOptions":{"tabSize":2,"insertSpaces":true}}}'

echo "=== Waiting 5s for completion response ==="
sleep 5

echo "=== Server stderr ==="
cat "$TMPDIR/lsp_stderr.log" 2>/dev/null

# Cleanup
kill $LSP_PID 2>/dev/null
rm -rf "$TMPDIR"
echo "=== Done ==="

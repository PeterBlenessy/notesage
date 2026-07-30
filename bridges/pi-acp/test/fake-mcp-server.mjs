#!/usr/bin/env node
// Minimal MCP stdio server for tests: newline-delimited JSON-RPC 2.0 with one
// tool, `echo`, that returns its input prefixed. Mirrors the transport
// Notesage's Rust client and the mcp-tools extension speak.
let buf = '';
const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    handle(msg);
  }
});
function handle(msg) {
  if (msg.method === 'initialize') {
    send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fake-mcp', version: '1.0.0' } } });
  } else if (msg.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'echo', description: 'Echo back the input', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }] } });
  } else if (msg.method === 'tools/call') {
    const text = msg.params?.arguments?.text ?? '';
    // Surfaces the env secret discipline: report whether a secret env var
    // reached this process (it should, via the spawn env — never via disk).
    const secret = process.env.FAKE_MCP_SECRET ? 'secret-present' : 'secret-missing';
    send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: `mcp-echo:${text}:${secret}` }], isError: false } });
  } else if (typeof msg.id === 'number') {
    send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'method not found' } });
  }
}
process.stdin.on('end', () => process.exit(0));

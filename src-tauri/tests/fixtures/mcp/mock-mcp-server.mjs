#!/usr/bin/env node
//
// A mock MCP server over stdio, for the dual-era client work (#573).
//
// Speaks the same Content-Length framing the real client expects, and picks a
// behaviour from argv so one file covers every case the era-detection tests
// need. A real child process over real pipes rather than an in-memory fake:
// `JsonRpcTransport` holds a concrete `ChildStdin` and is shared with the
// Copilot LSP client, so making it generic to admit a fake would cascade into
// a subsystem that has nothing to do with MCP.
//
// Behaviours (argv[2]):
//   modern          — answers `server/discover` with a DiscoverResult
//   modern-newer    — rejects our version once (-32021), then answers
//   legacy          — method-not-found for `server/discover`, answers `initialize`
//   silent          — reads and never replies, for the probe-timeout case
//
// Usage: node mock-mcp-server.mjs <behaviour>

const behaviour = process.argv[2] ?? "modern";
const MODERN_VERSION = "2026-07-28";
const LEGACY_VERSION = "2025-06-18";

/** Frame and write one JSON-RPC message, the way the client reads them. */
function send(message) {
  const body = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
}

let rejectedOnce = false;

function handle(request) {
  const { id, method } = request;

  if (method === "server/discover") {
    if (behaviour === "legacy") {
      // What a pre-2026 server does with a method it has never heard of.
      return send({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
    }
    if (behaviour === "modern-newer" && !rejectedOnce) {
      rejectedOnce = true;
      return send({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32021,
          message: "Unsupported protocol version",
          data: { supported: [MODERN_VERSION] },
        },
      });
    }
    return send({
      jsonrpc: "2.0",
      id,
      result: { protocolVersion: MODERN_VERSION, serverInfo: { name: "mock", version: "0.0.0" } },
    });
  }

  if (method === "initialize") {
    return send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: LEGACY_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "mock", version: "0.0.0" },
      },
    });
  }

  if (method === "tools/list") {
    return send({ jsonrpc: "2.0", id, result: { tools: [] } });
  }

  // Notifications carry no id and want no reply.
  if (id === undefined || id === null) return;
  send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
}

// Content-Length framing, accumulated across chunk boundaries — a header and
// its body do not necessarily arrive in one read.
let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const split = buffer.indexOf("\r\n\r\n");
    if (split === -1) return;
    const header = buffer.subarray(0, split).toString("utf8");
    const match = /Content-Length: *(\d+)/i.exec(header);
    if (!match) return;
    const length = Number(match[1]);
    const start = split + 4;
    if (buffer.length < start + length) return;
    const body = buffer.subarray(start, start + length).toString("utf8");
    buffer = buffer.subarray(start + length);
    if (behaviour === "silent") continue;
    try {
      handle(JSON.parse(body));
    } catch {
      // A malformed frame is the client's problem to report, not ours to crash on.
    }
  }
});

process.stdin.on("end", () => process.exit(0));

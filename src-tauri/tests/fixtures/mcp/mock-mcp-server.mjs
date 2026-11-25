#!/usr/bin/env node
//
// A mock MCP server over stdio.
//
// Speaks the real MCP stdio framing: newline-delimited JSON, one JSON-RPC
// message per line, UTF-8, no embedded newlines — exactly what the official
// SDK's `ReadBuffer` / `serializeMessage` do. (It used to speak LSP-style
// `Content-Length` framing, the same mistake the client made, which is why
// the client's tests passed against it while no real server could be reached.)
//
// It picks a behaviour from argv so one file covers every case the client
// tests need. A real child process over real pipes rather than an in-memory
// fake: `JsonRpcTransport` holds a concrete `ChildStdin` and is shared with
// the Copilot LSP client, so making it generic to admit a fake would cascade
// into a subsystem that has nothing to do with MCP.
//
// Behaviours (argv[2]):
//   modern           — answers `server/discover` with a DiscoverResult
//   modern-newer     — rejects our version once (-32021), then answers
//   legacy           — method-not-found for `server/discover`, answers `initialize`
//   silent           — reads and never replies, for the timeout case
//   noisy            — prints non-JSON log lines and blank lines on stdout,
//                      before and between its replies (a stray console.log)
//   paginated        — `tools/list` comes in three pages (`nextCursor`)
//   pinger           — after `notifications/initialized` sends the client a
//                      `ping` and a `roots/list` request; the `await_replies`
//                      tool answers with what the client replied
//   tools-error      — `tools/list` fails with an internal error
//   no-tools         — `tools/list` is method-not-found (a server without tools)
//   exit-mid-session — writes to stderr and exits with code 3 on `tools/call`
//   exit-on-start    — writes to stderr and exits with code 2 before answering
//
// Every behaviour except the last two and `silent` answers `initialize`,
// `tools/list` (one `echo` tool unless stated) and `tools/call`.
//
// Usage: node mock-mcp-server.mjs <behaviour>

const behaviour = process.argv[2] ?? "modern";
const MODERN_VERSION = "2026-07-28";
const LEGACY_VERSION = "2025-06-18";

/** Write one JSON-RPC message as a line, the way a client reads them. */
function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

/** A line that is not part of the protocol, as a careless server prints. */
function noise(text) {
  if (behaviour === "noisy") process.stdout.write(text + "\n");
}

const ECHO_TOOL = {
  name: "echo",
  description: "Echoes its `text` argument.",
  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
};

function numberedTool(n) {
  return { name: `tool_${n}`, description: `Tool number ${n}`, inputSchema: { type: "object" } };
}

// tools/list pages for the `paginated` behaviour, keyed by the cursor asked for.
const PAGES = {
  "": { tools: [numberedTool(1), numberedTool(2)], nextCursor: "page-2" },
  "page-2": { tools: [numberedTool(3), numberedTool(4)], nextCursor: "page-3" },
  "page-3": { tools: [numberedTool(5)] },
};

let rejectedOnce = false;

// `pinger`: the replies the client sent to our own requests, by request id,
// and a tools/call that is waiting for them.
const clientReplies = new Map();
let waitingCall = null;
const SERVER_REQUEST_IDS = ["srv-ping", "srv-roots"];

function answerWaitingCall() {
  if (waitingCall === null) return;
  if (!SERVER_REQUEST_IDS.every((id) => clientReplies.has(id))) return;
  const replies = Object.fromEntries(clientReplies);
  send({
    jsonrpc: "2.0",
    id: waitingCall,
    result: { content: [{ type: "text", text: JSON.stringify(replies) }], isError: false },
  });
  waitingCall = null;
}

function handle(message) {
  const { id, method } = message;

  // A reply to one of OUR requests (it has an id and no method).
  if (method === undefined) {
    if (id !== undefined && id !== null) {
      clientReplies.set(String(id), "error" in message ? { error: message.error } : { result: message.result });
      answerWaitingCall();
    }
    return;
  }

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
    noise("[mock] handling initialize");
    // Like a real server: agree to the client's version when it is one we
    // know, otherwise answer with our own.
    const asked = message.params?.protocolVersion;
    const known = ["2024-11-05", "2025-03-26", LEGACY_VERSION];
    return send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: known.includes(asked) ? asked : LEGACY_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "mock", version: "0.0.0" },
      },
    });
  }

  if (method === "notifications/initialized") {
    if (behaviour === "pinger") {
      send({ jsonrpc: "2.0", id: "srv-ping", method: "ping" });
      send({ jsonrpc: "2.0", id: "srv-roots", method: "roots/list" });
    }
    return;
  }

  if (method === "ping") {
    return send({ jsonrpc: "2.0", id, result: {} });
  }

  if (method === "tools/list") {
    noise("");
    noise("[mock] listing tools {not json}");
    if (behaviour === "tools-error") {
      return send({ jsonrpc: "2.0", id, error: { code: -32603, message: "tool registry unavailable" } });
    }
    if (behaviour === "no-tools") {
      return send({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
    }
    if (behaviour === "paginated") {
      const page = PAGES[message.params?.cursor ?? ""];
      if (!page) {
        return send({ jsonrpc: "2.0", id, error: { code: -32602, message: "Invalid cursor" } });
      }
      return send({ jsonrpc: "2.0", id, result: page });
    }
    const tools = behaviour === "pinger" ? [ECHO_TOOL, { ...ECHO_TOOL, name: "await_replies" }] : [ECHO_TOOL];
    return send({ jsonrpc: "2.0", id, result: { tools } });
  }

  if (method === "tools/call") {
    if (behaviour === "exit-mid-session") {
      process.stderr.write("fatal: the mock was told to crash\n");
      process.exit(3);
    }
    const name = message.params?.name;
    if (name === "await_replies") {
      waitingCall = id;
      return answerWaitingCall();
    }
    if (name === "echo") {
      noise("[mock] echo");
      const text = String(message.params?.arguments?.text ?? "");
      return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }], isError: false } });
    }
    return send({ jsonrpc: "2.0", id, error: { code: -32602, message: `Unknown tool: ${name}` } });
  }

  // Notifications carry no id and want no reply.
  if (id === undefined || id === null) return;
  send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
}

if (behaviour === "exit-on-start") {
  process.stderr.write("Error: MOCK_API_KEY is not set\n");
  process.exit(2);
}

noise("Mock MCP server v0.0.0 listening on stdio");

// Newline-delimited framing, accumulated across chunk boundaries — a line
// does not necessarily arrive in one read. Bytes, not strings, so a multi-byte
// character split across two chunks survives.
let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const newline = buffer.indexOf("\n");
    if (newline === -1) return;
    const line = buffer.toString("utf8", 0, newline).replace(/\r$/, "");
    buffer = buffer.subarray(newline + 1);
    if (behaviour === "silent" || line.trim() === "") continue;
    try {
      handle(JSON.parse(line));
    } catch {
      // A malformed line is the client's problem to report, not ours to crash on.
    }
  }
});

process.stdin.on("end", () => process.exit(0));

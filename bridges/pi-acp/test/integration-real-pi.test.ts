// Opt-in integration against the REAL pi binary (task #11, first slice).
// Skipped unless PI_BINARY points at a pi executable. Re-run whenever the
// pinned pi version moves — this is the churn tripwire.
//
//   PI_BINARY=/path/to/extracted/pi/pi pnpm test
//
// Starts a stub OpenAI-compatible server, builds an isolated flat pi home
// (models.json + no extensions), and drives one prompt turn through
// PiProcess, asserting the event lifecycle recorded in spike #1.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RequestPermissionResponse } from "@agentclientprotocol/sdk";
import { PiAcpAgent } from "../src/acp-server";
import { PiProcess } from "../src/pi-process";
import { PiRpc } from "../src/pi-rpc";

const EXT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "extensions");

const PI_BINARY = process.env.PI_BINARY;
const d = describe.skipIf(!PI_BINARY);

let server: Server;
let port = 0;
let piHome: string;

function startStub(): Promise<void> {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url === "/v1/models") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ object: "list", data: [{ id: "stub-model", object: "model" }] }));
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      const base = { id: "c1", object: "chat.completion.chunk", created: 1, model: "stub-model" };
      // Tool-call turn: when the user asks to write AND there's no tool
      // result yet in this transcript, emit a `write` tool call; else text.
      const wantsWrite = body.includes("WRITE_THE_FILE") && !body.includes('"role":"tool"');
      const wantsMcp = body.includes("USE_MCP_ECHO") && !body.includes('"role":"tool"');
      if (wantsMcp) {
        send({ ...base, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call_mcp_1", type: "function", function: { name: "mcp_fake_echo", arguments: "" } }] }, finish_reason: null }] });
        send({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ text: "hello-mcp" }) } }] }, finish_reason: null }] });
        send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
      } else if (wantsWrite) {
        const target = join(piHome, "tool-out.txt");
        send({ ...base, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call_int_1", type: "function", function: { name: "write", arguments: "" } }] }, finish_reason: null }] });
        send({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ path: target, content: "written by real pi" }) } }] }, finish_reason: null }] });
        send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
      } else {
        send({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "Hello from stub." }, finish_reason: "stop" }] });
      }
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
}

d("real pi integration", () => {
  beforeAll(async () => {
    await startStub();
    piHome = mkdtempSync(join(tmpdir(), "pi-acp-int-"));
    writeFileSync(
      join(piHome, "models.json"),
      JSON.stringify({
        providers: {
          local: {
            name: "Local Stub",
            baseUrl: `http://127.0.0.1:${port}/v1`,
            api: "openai-completions",
            apiKey: "dummy",
            models: [{ id: "stub-model", name: "Stub", contextWindow: 8192, maxTokens: 1024 }],
          },
        },
      }),
    );
  });

  afterAll(() => {
    server?.close();
    rmSync(piHome, { recursive: true, force: true });
  });

  it("completes a prompt turn with the spike-#1 event lifecycle", async () => {
    const events: Record<string, unknown>[] = [];
    let resolveSettled!: () => void;
    const settled = new Promise<void>((r) => (resolveSettled = r));
    const pi = new PiProcess({
      piBin: PI_BINARY!,
      args: ["--provider", "local", "--model", "stub-model", "--no-session"],
      env: { ...process.env, PI_OFFLINE: "1", PI_CODING_AGENT_DIR: piHome, NO_COLOR: "1" },
      onEvent: (e) => {
        events.push(e);
        if (e.type === "agent_settled") resolveSettled();
      },
    });
    // pi needs a moment to boot before reading stdin; send() buffers via pipe.
    pi.send({ type: "prompt", message: "Say hello." });
    await Promise.race([
      settled,
      new Promise((_, rej) => setTimeout(() => rej(new Error("no agent_settled within 30s")), 30_000)),
    ]);
    const types = events.map((e) => e.type);
    for (const expected of ["agent_start", "turn_start", "message_start", "message_end", "turn_end", "agent_end", "agent_settled"]) {
      expect(types).toContain(expected);
    }
    const final = events.filter((e) => e.type === "message_end").at(-1) as {
      message?: { role?: string; content?: Array<{ type: string; text?: string }> };
    };
    expect(final.message?.role).toBe("assistant");
    expect(final.message?.content?.some((c) => c.type === "text" && c.text?.includes("Hello from stub."))).toBe(true);
    await pi.stop();
    expect(pi.isAlive).toBe(false);
  }, 40_000);

  function makeAgent(
    decide: () => Promise<RequestPermissionResponse>,
    onSessionUpdate?: (sid: string, u: import("../src/translate").SessionUpdate) => void,
  ): PiAcpAgent {
    return new PiAcpAgent({
      spawnPi: ({ cwd, extraEnv }, onEvent) =>
        new PiRpc({
          piBin: PI_BINARY!,
          args: ["--provider", "local", "--model", "stub-model", "--session-dir", join(piHome, "sessions")],
          cwd,
          env: { ...process.env, ...(extraEnv ?? {}), PI_OFFLINE: "1", PI_CODING_AGENT_DIR: piHome, NO_COLOR: "1" },
          onEvent,
        }),
      requestPermission: (_sid, _ask) => decide(),
      onSessionUpdate,
    });
  }

  it("REAL permission-gate extension: allow executes the write, deny blocks it", async () => {
    // Install the shipped gate into the real pi home (what task #16 will do).
    mkdirSync(join(piHome, "extensions"), { recursive: true });
    copyFileSync(join(EXT_DIR, "permission-gate.ts"), join(piHome, "extensions", "permission-gate.ts"));
    const target = join(piHome, "tool-out.txt");

    // Allow path.
    const allowAgent = makeAgent(async () => ({ outcome: { outcome: "selected", optionId: "allow_once" } }));
    try {
      const { sessionId } = await allowAgent.newSession({ cwd: piHome, mcpServers: [] });
      const res = await allowAgent.prompt({ sessionId, prompt: [{ type: "text", text: "WRITE_THE_FILE please" }] });
      expect(res.stopReason).toBe("end_turn");
      expect(existsSync(target)).toBe(true);
    } finally {
      await allowAgent.shutdown();
    }

    // Deny path (fresh pi process + fresh target).
    rmSync(target, { force: true });
    const denyAgent = makeAgent(async () => ({ outcome: { outcome: "selected", optionId: "reject_once" } }));
    try {
      const { sessionId } = await denyAgent.newSession({ cwd: piHome, mcpServers: [] });
      const res = await denyAgent.prompt({ sessionId, prompt: [{ type: "text", text: "WRITE_THE_FILE please" }] });
      expect(res.stopReason).toBe("end_turn"); // denied tool, turn still completes
      expect(existsSync(target)).toBe(false);
    } finally {
      await denyAgent.shutdown();
    }
  }, 90_000);

  it("REAL mcp-tools extension: MCP tool discovered, gated, called via env-only secret handoff", async () => {
    mkdirSync(join(piHome, "extensions"), { recursive: true });
    copyFileSync(join(EXT_DIR, "permission-gate.ts"), join(piHome, "extensions", "permission-gate.ts"));
    copyFileSync(join(EXT_DIR, "mcp-tools.ts"), join(piHome, "extensions", "mcp-tools.ts"));
    const fakeMcp = join(dirname(fileURLToPath(import.meta.url)), "fake-mcp-server.mjs");

    const updates: import("../src/translate").SessionUpdate[] = [];
    const agent = makeAgent(
      async () => ({ outcome: { outcome: "selected", optionId: "allow_once" } }),
      (_sid, u) => updates.push(u),
    );
    try {
      const { sessionId } = await agent.newSession({
        cwd: piHome,
        mcpServers: [
          {
            name: "fake",
            command: process.execPath,
            args: [fakeMcp],
            env: [{ name: "FAKE_MCP_SECRET", value: "resolved-from-keychain" }],
          },
        ],
      });
      const res = await agent.prompt({ sessionId, prompt: [{ type: "text", text: "USE_MCP_ECHO now" }] });
      expect(res.stopReason).toBe("end_turn");
      // The MCP tool executed and returned its content — including proof the
      // secret env reached the server process via the spawn env.
      const toolEnd = updates.filter((u) => u.sessionUpdate === "tool_call_update").at(-1);
      expect(JSON.stringify(toolEnd)).toContain("mcp-echo:hello-mcp:secret-present");
      // Secrets discipline: nothing under the pi home may contain the secret.
      const { execSync } = await import("node:child_process");
      const grep = execSync(
        `grep -r "resolved-from-keychain" ${JSON.stringify(piHome)} --include='*' -l || true`,
      ).toString().trim();
      expect(grep).toBe("");
    } finally {
      await agent.shutdown();
    }
  }, 90_000);
});

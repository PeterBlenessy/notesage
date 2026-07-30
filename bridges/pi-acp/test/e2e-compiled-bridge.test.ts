// Capstone E2E (task #11): the COMPILED bridge binary, driven exactly the way
// Notesage's acp.rs will drive it — as an ACP client over the child's stdio.
//
// Opt-in: needs BOTH env vars (built artifacts are not present in normal CI):
//   PI_BINARY      path to the real pi executable
//   BRIDGE_BINARY  path to a bun-compiled notesage-pi-acp binary
//                  (scripts/build-binaries.sh bun-linux-x64 → extract dist tar)
//
// Covers: initialize handshake → session/new → streamed prompt turn →
// permission-gated write (request_permission round trip through the shipped
// extension) → usage_update → teardown leaves no orphaned pi.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  ClientSideConnection,
  ndJsonStream,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from "@agentclientprotocol/sdk";

const PI_BINARY = process.env.PI_BINARY;
const BRIDGE_BINARY = process.env.BRIDGE_BINARY;
const d = describe.skipIf(!PI_BINARY || !BRIDGE_BINARY);

const EXT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "extensions");

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
      const base = { id: "e2e", object: "chat.completion.chunk", created: 1, model: "stub-model" };
      const wantsWrite = body.includes("WRITE_THE_FILE") && !body.includes('"role":"tool"');
      if (wantsWrite) {
        const target = join(piHome, "e2e-out.txt");
        send({ ...base, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call_e2e", type: "function", function: { name: "write", arguments: "" } }] }, finish_reason: null }] });
        send({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ path: target, content: "compiled bridge e2e" }) } }] }, finish_reason: null }] });
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

d("compiled bridge E2E (ACP client over stdio)", () => {
  let bridge: ChildProcess;
  const notifications: SessionNotification[] = [];
  const permissionAsks: RequestPermissionRequest[] = [];

  beforeAll(async () => {
    await startStub();
    piHome = mkdtempSync(join(tmpdir(), "pi-acp-e2e-"));
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
    mkdirSync(join(piHome, "extensions"), { recursive: true });
    for (const ext of readdirSync(EXT_DIR)) {
      copyFileSync(join(EXT_DIR, ext), join(piHome, "extensions", ext));
    }
  });

  afterAll(() => {
    server?.close();
    try {
      bridge?.kill("SIGKILL");
    } catch {
      /* already gone */
    }
    rmSync(piHome, { recursive: true, force: true });
  });

  it("full conversation through the compiled binary", async () => {
    bridge = spawn(
      BRIDGE_BINARY!,
      ["--pi-bin", PI_BINARY!, "--", "--provider", "local", "--model", "stub-model", "--session-dir", join(piHome, "sessions")],
      {
        env: {
          ...process.env,
          PI_OFFLINE: "1",
          PI_CODING_AGENT_DIR: piHome,
          NO_COLOR: "1",
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    bridge.stderr!.on("data", () => {});

    const conn = new ClientSideConnection(
      () => ({
        sessionUpdate: (n: SessionNotification) => {
          notifications.push(n);
        },
        requestPermission: (params: RequestPermissionRequest): RequestPermissionResponse => {
          permissionAsks.push(params);
          return { outcome: { outcome: "selected", optionId: "allow_once" } };
        },
      }),
      ndJsonStream(
        Writable.toWeb(bridge.stdin!) as WritableStream<Uint8Array>,
        Readable.toWeb(bridge.stdout!) as ReadableStream<Uint8Array>,
      ),
    );

    const init = await conn.initialize({ protocolVersion: 1, clientCapabilities: {} });
    expect(init.agentInfo?.name).toBe("notesage-pi-acp");
    expect(init.agentCapabilities?.loadSession).toBe(true);

    const { sessionId } = await conn.newSession({ cwd: piHome, mcpServers: [] });
    expect(sessionId).toBeTruthy();

    // Plain streamed turn.
    const turn1 = await conn.prompt({ sessionId, prompt: [{ type: "text", text: "Say hello." }] });
    expect(turn1.stopReason).toBe("end_turn");
    const text = notifications
      .filter((n) => n.update.sessionUpdate === "agent_message_chunk")
      .map((n) => (n.update as { content?: { text?: string } }).content?.text ?? "")
      .join("");
    expect(text).toContain("Hello from stub.");
    expect(notifications.some((n) => n.update.sessionUpdate === "usage_update")).toBe(true);

    // Permission-gated write through the shipped extension.
    const target = join(piHome, "e2e-out.txt");
    const turn2 = await conn.prompt({ sessionId, prompt: [{ type: "text", text: "WRITE_THE_FILE please" }] });
    expect(turn2.stopReason).toBe("end_turn");
    expect(permissionAsks).toHaveLength(1);
    expect(permissionAsks[0]!.sessionId).toBe(sessionId);
    expect(existsSync(target)).toBe(true);

    // Teardown: closing stdin ends the bridge, which must reap pi.
    const bridgeExited = new Promise<void>((r) => bridge.once("exit", () => r()));
    bridge.stdin!.end();
    await Promise.race([
      bridgeExited,
      new Promise((_, rej) => setTimeout(() => rej(new Error("bridge did not exit on stdin close")), 10_000)),
    ]);
  }, 120_000);
});

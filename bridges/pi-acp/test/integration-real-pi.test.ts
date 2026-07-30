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
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiProcess } from "../src/pi-process";

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
      send({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "Hello from stub." }, finish_reason: "stop" }] });
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
});

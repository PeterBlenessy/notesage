// Notesage MCP tools extension (task #14) — shipped INTO the pi config dir by
// local_agent_write_config; not a user-editable file.
//
// Reads stdio MCP server configs from the NOTESAGE_MCP_SERVERS env var
// (JSON: [{name, command, args, env}] — placed there by the notesage-pi-acp
// bridge from ACP session/new, so resolved secrets never touch disk), spawns
// each server as a child of pi (inheriting pi's sandbox), performs the MCP
// initialize handshake, and registers every discovered tool with pi.
//
// Transport: MCP stdio — newline-delimited JSON-RPC 2.0 (same as Notesage's
// Rust client). Tool schemas pass through as-is: MCP inputSchema is JSON
// Schema, which is what pi's TypeBox-based validation consumes at runtime.
//
// MCP tool calls are NOT in the permission gate's read-only set, so every
// call prompts through the ACP permission flow — the safe default.
import { spawn, type ChildProcess } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface ServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

class McpStdioClient {
  private child: ChildProcess;
  private buf = "";
  private nextId = 0;
  private pending = new Map<number, { resolve: (r: unknown) => void; reject: (e: Error) => void }>();

  constructor(readonly config: ServerConfig) {
    this.child = spawn(config.command, config.args ?? [], {
      env: { ...process.env, ...(config.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout!.on("data", (d: Buffer) => {
      this.buf += d.toString();
      let i: number;
      while ((i = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, i);
        this.buf = this.buf.slice(i + 1);
        if (!line.trim()) continue;
        try {
          this.dispatch(JSON.parse(line));
        } catch {
          /* non-JSON stderr-ish noise on stdout — ignore */
        }
      }
    });
    this.child.on("exit", () => {
      const err = new Error(`MCP server ${config.name} exited`);
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    });
  }

  private dispatch(msg: { id?: number; result?: unknown; error?: { message?: string } }): void {
    if (typeof msg.id !== "number") return; // notification — ignored
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message ?? "MCP error"));
    else p.resolve(msg.result);
  }

  request(method: string, params?: unknown, timeoutMs = 30_000): Promise<unknown> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP ${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (r) => {
          clearTimeout(t);
          resolve(r);
        },
        reject: (e) => {
          clearTimeout(t);
          reject(e);
        },
      });
      this.child.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  notify(method: string, params?: unknown): void {
    this.child.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  async initialize(): Promise<McpTool[]> {
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "notesage-pi-acp", version: "0.1.0" },
    });
    this.notify("notifications/initialized");
    const res = (await this.request("tools/list", {})) as { tools?: McpTool[] };
    return res.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
    const res = (await this.request("tools/call", { name, arguments: args }, 120_000)) as {
      content?: Array<{ type?: string; text?: string }>;
      isError?: boolean;
    };
    const text = (res.content ?? [])
      .filter((c) => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text)
      .join("\n");
    return { text: text || "(no text content)", isError: res.isError === true };
  }
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}

export default async function (pi: ExtensionAPI) {
  const raw = process.env.NOTESAGE_MCP_SERVERS;
  if (!raw) return;
  let configs: ServerConfig[];
  try {
    configs = JSON.parse(raw) as ServerConfig[];
  } catch {
    return; // malformed handoff — no MCP rather than a broken agent
  }

  for (const config of configs) {
    try {
      const client = new McpStdioClient(config);
      const tools = await client.initialize();
      for (const tool of tools) {
        pi.registerTool({
          name: `mcp_${sanitize(config.name)}_${sanitize(tool.name)}`,
          label: `${config.name}: ${tool.name}`,
          description: tool.description ?? `MCP tool ${tool.name} from ${config.name}`,
          // MCP inputSchema is JSON Schema — TypeBox-compatible at runtime.
          parameters: tool.inputSchema ?? { type: "object", properties: {}, additionalProperties: true },
          async execute(_toolCallId: string, params: Record<string, unknown>) {
            const { text, isError } = await client.callTool(tool.name, params ?? {});
            if (isError) throw new Error(text);
            return { content: [{ type: "text", text }], details: {} };
          },
        });
      }
    } catch {
      // Server failed to start/handshake — skip it; the rest still register.
      // (Notesage validated servers on add; a failure here is environmental.)
    }
  }
}

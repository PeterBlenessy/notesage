// notesage-pi-acp entry point.
//
// Bun-compiles to a self-contained binary (task #12) that Notesage spawns as a
// `custom_acp` agent: ACP JSON-RPC on this process's stdio, a `pi --mode rpc`
// child underneath. Wiring lands with tasks #6-#10; the scaffold only fixes
// the CLI contract so the Rust side can pin its spawn shape early.
//
// Usage: notesage-pi-acp --pi-bin <path-to-pi-executable>
// The pi child inherits this process's env (PI_OFFLINE, PI_CODING_AGENT_DIR,
// provider config all come from the Notesage spawn env, task #16).

export { BRIDGE_VERSION } from "./version";
import { BRIDGE_VERSION } from "./version";
import type { PiAcpAgent } from "./acp-server";

export interface BridgeOptions {
  /** Absolute path to the pi executable (inside its extracted release folder). */
  piBin: string;
}

/** Parse argv (post-node/binary) into bridge options. Throws on missing --pi-bin. */
export function parseArgs(argv: string[]): BridgeOptions {
  const i = argv.indexOf("--pi-bin");
  const piBin = i >= 0 ? argv[i + 1] : undefined;
  if (!piBin) throw new Error("notesage-pi-acp: missing required --pi-bin <path>");
  return { piBin };
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const { AgentSideConnection, ndJsonStream } = await import("@agentclientprotocol/sdk");
  const { Readable, Writable } = await import("node:stream");
  const { PiAcpAgent: PiAcpAgentImpl } = await import("./acp-server");
  const { PiRpc } = await import("./pi-rpc");

  const { piBin } = parseArgs(argv);
  let agent!: PiAcpAgent;
  const conn = new AgentSideConnection(
    () => {
      agent = new PiAcpAgentImpl({
        spawnPi: (cwd, onEvent) =>
          new PiRpc({
            piBin,
            cwd,
            env: process.env,
            onEvent,
            onStderr: (t) => process.stderr.write(`[pi] ${t}`),
          }),
        onSessionUpdate: (sessionId, update) => {
          void conn.sessionUpdate({ sessionId, update });
        },
      });
      return agent;
    },
    ndJsonStream(
      Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
      Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
    ),
  );

  // Orphan-proofing: any exit path tears the pi child down (awaited group kill).
  const shutdown = async (code: number) => {
    await agent?.shutdown().catch(() => {});
    process.exit(code);
  };
  process.on("SIGTERM", () => void shutdown(0));
  process.on("SIGINT", () => void shutdown(0));
  process.stdin.on("close", () => void shutdown(0));
}

if (import.meta.main) {
  if (process.argv.includes("--version")) {
    console.log(BRIDGE_VERSION);
    process.exit(0);
  }
  void main();
}

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

if (import.meta.main) {
  if (process.argv.includes("--version")) {
    console.log(BRIDGE_VERSION);
    process.exit(0);
  }
  parseArgs(process.argv.slice(2));
  // Tasks #6-#10: start AcpServer on stdio, spawn PiProcess, connect translate layer.
  console.error("notesage-pi-acp: bridge core not yet implemented (tasks #6-#10)");
  process.exit(1);
}

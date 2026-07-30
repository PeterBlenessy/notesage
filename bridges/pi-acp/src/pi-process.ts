// pi child-process owner (task #6).
//
// Spawns `<piBin> --mode rpc ...` in its OWN process group (detached) so
// teardown can kill the whole subtree — pi's bash tool can have spawned
// grandchildren — and so a bridge crash never leaves half a tree behind.
// `stop()` is awaited teardown: SIGTERM to the group, bounded grace, then
// SIGKILL to the group, and it resolves only after the child's `exit` event.
// This is the orphan-proofing the tasks file flags; the Rust side's
// kill_on_drop on the bridge relies on the bridge doing this on signal/stdin
// close.

import { spawn, type ChildProcess } from "node:child_process";
import { encodeJsonl, JsonlDecoder } from "./jsonl";

export interface PiProcessOptions {
  /** Path to the pi executable (inside its extracted release folder). */
  piBin: string;
  /** Extra CLI args after `--mode rpc` (e.g. --provider/--model). */
  args?: string[];
  /** Environment for pi (PI_OFFLINE, PI_CODING_AGENT_DIR, ... from the host). */
  env?: NodeJS.ProcessEnv;
  /** Working directory for pi (the ACP session cwd). */
  cwd?: string;
  /** Every parsed JSONL event from pi's stdout. */
  onEvent: (event: Record<string, unknown>) => void;
  /** Raw stderr chunks (diagnostics; forwarded to the host's logs). */
  onStderr?: (text: string) => void;
  /** Non-JSON stdout lines (never fatal). */
  onNonJson?: (line: string) => void;
  /** Child exited (any path — normal, stop(), crash). */
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
}

export class PiProcess {
  private child: ChildProcess;
  private exited = false;
  private exitWaiters: Array<() => void> = [];

  constructor(opts: PiProcessOptions) {
    const decoder = new JsonlDecoder(opts.onNonJson);
    this.child = spawn(opts.piBin, ["--mode", "rpc", ...(opts.args ?? [])], {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: true, // own process group → group kill reaches grandchildren
    });
    this.child.stdout!.on("data", (d: Buffer) => {
      for (const e of decoder.push(d)) {
        if (e && typeof e === "object") opts.onEvent(e as Record<string, unknown>);
      }
    });
    this.child.stderr!.on("data", (d: Buffer) => opts.onStderr?.(d.toString()));
    this.child.on("exit", (code, signal) => {
      this.exited = true;
      this.exitWaiters.splice(0).forEach((w) => w());
      opts.onExit?.(code, signal);
    });
    // A spawn error (bad path) surfaces as exit too, so stop() can't hang on it.
    this.child.on("error", () => {
      if (!this.exited) {
        this.exited = true;
        this.exitWaiters.splice(0).forEach((w) => w());
        opts.onExit?.(null, null);
      }
    });
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  get isAlive(): boolean {
    return !this.exited;
  }

  /** Send one RPC command (JSONL-framed). Returns false if pi is gone. */
  send(command: Record<string, unknown>): boolean {
    if (this.exited || !this.child.stdin?.writable) return false;
    this.child.stdin.write(encodeJsonl(command));
    return true;
  }

  private killGroup(signal: NodeJS.Signals): void {
    const pid = this.child.pid;
    if (pid === undefined) return;
    try {
      process.kill(-pid, signal); // negative pid → whole process group
    } catch {
      try {
        this.child.kill(signal); // group already gone; best-effort direct
      } catch {
        /* already dead */
      }
    }
  }

  private waitExit(timeoutMs: number): Promise<boolean> {
    if (this.exited) return Promise.resolve(true);
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(false), timeoutMs);
      this.exitWaiters.push(() => {
        clearTimeout(t);
        resolve(true);
      });
    });
  }

  /**
   * Awaited teardown: SIGTERM group → grace → SIGKILL group → await exit.
   * Safe to call multiple times; resolves when the child is confirmed gone.
   */
  async stop(graceMs = 3000): Promise<void> {
    if (this.exited) return;
    this.killGroup("SIGTERM");
    if (await this.waitExit(graceMs)) return;
    this.killGroup("SIGKILL");
    await this.waitExit(graceMs); // SIGKILL is not ignorable; this resolves
  }
}

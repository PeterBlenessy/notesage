// Request/response correlation + turn lifecycle over a PiProcess (task #7).
//
// pi RPC commands accept an optional `id` echoed back on the matching
// `response` event (verified live against pi v0.80.6). Everything that is not
// a response — the streaming event firehose — is forwarded to `onEvent` for
// the translate layer (#8).

import { PiProcess, type PiProcessOptions } from "./pi-process";

export interface PiResponse {
  type: "response";
  command: string;
  success: boolean;
  id?: string;
  data?: Record<string, unknown>;
  error?: string;
}

export interface PiRpcOptions {
  piBin: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** Non-response events (message_update, tool_execution_*, extension_ui_request, ...). */
  onEvent?: (event: Record<string, unknown>) => void;
  onStderr?: (text: string) => void;
  onExit?: PiProcessOptions["onExit"];
}

export class PiRpcError extends Error {
  constructor(
    message: string,
    readonly command?: string,
  ) {
    super(message);
  }
}

export class PiRpc {
  private readonly proc: PiProcess;
  private nextId = 0;
  private readonly pending = new Map<string, (r: PiResponse) => void>();
  private settledWaiters: Array<() => void> = [];

  constructor(opts: PiRpcOptions) {
    this.proc = new PiProcess({
      piBin: opts.piBin,
      args: opts.args,
      env: opts.env,
      cwd: opts.cwd,
      onStderr: opts.onStderr,
      onExit: (code, signal) => {
        // Fail every pending request so callers can surface a real error
        // instead of hanging (pi crash mid-request).
        const waiters = [...this.pending.values()];
        this.pending.clear();
        for (const resolve of waiters) {
          resolve({ type: "response", command: "?", success: false, error: `pi exited (code=${code} signal=${signal})` });
        }
        this.settledWaiters.splice(0).forEach((w) => w());
        opts.onExit?.(code, signal);
      },
      onEvent: (e) => {
        if (e.type === "response") {
          const r = e as unknown as PiResponse;
          if (r.id && this.pending.has(r.id)) {
            const resolve = this.pending.get(r.id)!;
            this.pending.delete(r.id);
            resolve(r);
            return;
          }
        }
        if (e.type === "agent_settled") {
          this.settledWaiters.splice(0).forEach((w) => w());
        }
        opts.onEvent?.(e);
      },
    });
  }

  get isAlive(): boolean {
    return this.proc.isAlive;
  }

  /**
   * Send a command and await its correlated response. Throws PiRpcError when
   * pi rejects the command (`success: false`) or is not running.
   */
  request(command: Record<string, unknown>): Promise<PiResponse> {
    const id = `b${++this.nextId}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, (r) => {
        if (!r.success) reject(new PiRpcError(r.error ?? `pi rejected ${String(command.type)}`, r.command));
        else resolve(r);
      });
      if (!this.proc.send({ ...command, id })) {
        this.pending.delete(id);
        reject(new PiRpcError("pi is not running", String(command.type)));
      }
    });
  }

  /**
   * Promise for the NEXT agent_settled (or pi exit). Create BEFORE sending the
   * prompt so a fast turn can't slip past the wait.
   */
  nextSettled(): Promise<void> {
    return new Promise((resolve) => this.settledWaiters.push(resolve));
  }

  /** Fire-and-forget send without correlation (e.g. extension_ui_response). */
  notify(command: Record<string, unknown>): boolean {
    return this.proc.send(command);
  }

  stop(graceMs?: number): Promise<void> {
    return this.proc.stop(graceMs);
  }
}

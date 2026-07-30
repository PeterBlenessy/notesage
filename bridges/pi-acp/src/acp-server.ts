// ACP agent implementation backed by a pi RPC child (task #7).
//
// Session identity: the ACP sessionId IS pi's session FILE PATH (from
// get_session_stats.sessionFile). It is opaque to the ACP client, it is
// exactly what pi's switch_session wants, and it survives bridge restarts —
// which is what makes session/load work across respawns.
//
// Fork semantics: ACP's fork ("new session inheriting current state") maps to
// pi's `clone` (duplicate active branch into a new session), NOT pi's `fork`
// (rewind to an earlier user message).
//
// The pi child is spawned lazily on the first session request so its cwd can
// follow the first session's cwd (pi has no chdir RPC; tools use absolute
// paths, so a later session with a different cwd still works — only pi's
// session-file organization keys off cwd).

import {
  PROTOCOL_VERSION,
  type Agent,
  type AuthenticateRequest,
  type AuthenticateResponse,
  type CancelNotification,
  type ForkSessionRequest,
  type ForkSessionResponse,
  type InitializeRequest,
  type InitializeResponse,
  type LoadSessionRequest,
  type LoadSessionResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type PromptRequest,
  type PromptResponse,
} from "@agentclientprotocol/sdk";
import { PiRpc, type PiRpcOptions } from "./pi-rpc";
import { PermissionBroker, type AcpPermissionAsk } from "./permissions";
import { PiEventTranslator, type SessionUpdate } from "./translate";
import { usageUpdateFromStats } from "./usage";
import { BRIDGE_VERSION } from "./version";

export type SpawnPi = (cwd: string | undefined, onEvent: (e: Record<string, unknown>) => void) => PiRpc;

export interface PiAcpAgentOptions {
  /** Factory for the pi child (indirection = fake pi in tests). */
  spawnPi: SpawnPi;
  /** Raw hook: every non-response pi event (diagnostics). */
  onPiEvent?: (e: Record<string, unknown>) => void;
  /** Translated ACP session updates (#8) for the active session. */
  onSessionUpdate?: (sessionId: string, update: SessionUpdate) => void;
  /** ACP session/request_permission round-trip (#9). Absent → every gated
   *  tool call is denied (fail-safe for a host that never wires it). */
  requestPermission?: (sessionId: string, ask: AcpPermissionAsk) => Promise<import("@agentclientprotocol/sdk").RequestPermissionResponse>;
  /** Broker safety timeout override (tests). */
  permissionSafetyTimeoutMs?: number;
}

export function defaultSpawnPi(piBin: string, extraArgs: string[] = [], env?: NodeJS.ProcessEnv): SpawnPi {
  return (cwd, onEvent) =>
    new PiRpc({ piBin, args: extraArgs, env, cwd, onEvent } satisfies PiRpcOptions);
}

export class PiAcpAgent implements Agent {
  private pi: PiRpc | null = null;
  /** ACP sessionId (= pi sessionFile) currently active in the pi child. */
  private activeSession: string | null = null;
  private cancelling = false;

  private readonly translator: PiEventTranslator;
  private broker: PermissionBroker | null = null;

  constructor(private readonly opts: PiAcpAgentOptions) {
    this.translator = new PiEventTranslator((update) => {
      if (this.activeSession) this.opts.onSessionUpdate?.(this.activeSession, update);
    });
  }

  private ensurePi(cwd?: string): PiRpc {
    if (!this.pi || !this.pi.isAlive) {
      const broker = new PermissionBroker(
        async (ask) => {
          if (!this.opts.requestPermission || !this.activeSession) {
            return { outcome: { outcome: "cancelled" } };
          }
          return this.opts.requestPermission(this.activeSession, ask);
        },
        (response) => {
          this.pi?.notify({ type: "extension_ui_response", ...response });
        },
        this.opts.permissionSafetyTimeoutMs,
      );
      this.broker = broker;
      this.pi = this.opts.spawnPi(cwd, (e) => {
        const consumed = broker.handle(e);
        if (!consumed) this.translator.handle(e);
        this.opts.onPiEvent?.(e);
      });
      this.activeSession = null;
    }
    return this.pi;
  }

  /** Current session file path from pi (the ACP sessionId). */
  private async currentSessionId(pi: PiRpc): Promise<string> {
    const stats = await pi.request({ type: "get_session_stats" });
    const file = stats.data?.sessionFile;
    if (typeof file !== "string" || !file) throw new Error("pi returned no sessionFile");
    return file;
  }

  private async activate(pi: PiRpc, sessionId: string): Promise<void> {
    if (this.activeSession === sessionId) return;
    await pi.request({ type: "switch_session", sessionPath: sessionId });
    this.activeSession = sessionId;
  }

  async initialize(params: InitializeRequest): Promise<InitializeResponse> {
    return {
      protocolVersion: Math.min(params.protocolVersion, PROTOCOL_VERSION),
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { image: true },
      },
      agentInfo: { name: "notesage-pi-acp", version: BRIDGE_VERSION },
    };
  }

  async authenticate(params: AuthenticateRequest): Promise<AuthenticateResponse> {
    void params;
    return {}; // local-only agent — no auth methods are advertised
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    const pi = this.ensurePi(params.cwd);
    await pi.request({ type: "new_session" });
    const sessionId = await this.currentSessionId(pi);
    this.activeSession = sessionId;
    return { sessionId };
  }

  async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    const pi = this.ensurePi(params.cwd);
    await this.activate(pi, params.sessionId);
    return {};
  }

  async unstable_forkSession(params: ForkSessionRequest): Promise<ForkSessionResponse> {
    const pi = this.ensurePi(params.cwd ?? undefined);
    await this.activate(pi, params.sessionId);
    await pi.request({ type: "clone" });
    const sessionId = await this.currentSessionId(pi);
    this.activeSession = sessionId;
    return { sessionId };
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    const pi = this.ensurePi();
    await this.activate(pi, params.sessionId);
    this.cancelling = false;

    const texts: string[] = [];
    const images: Array<{ type: "image"; data: string; mimeType: string }> = [];
    for (const block of params.prompt) {
      if (block.type === "text") texts.push(block.text);
      else if (block.type === "image" && block.data) {
        images.push({ type: "image", data: block.data, mimeType: block.mimeType });
      } else if (block.type === "resource_link") {
        texts.push(block.uri);
      }
    }

    const settled = pi.nextSettled();
    await pi.request({
      type: "prompt",
      message: texts.join("\n"),
      ...(images.length ? { images } : {}),
    });
    await settled;
    if (!pi.isAlive) throw new Error("pi exited during the turn");

    // Best-effort usage report (#10) — never delays or fails the turn result
    // beyond the single stats round-trip; a shape mismatch degrades silently.
    const usage = await usageUpdateFromStats(pi);
    if (usage && this.activeSession) this.opts.onSessionUpdate?.(this.activeSession, usage);

    return { stopReason: this.cancelling ? "cancelled" : "end_turn" };
  }

  async cancel(params: CancelNotification): Promise<void> {
    void params;
    if (!this.pi?.isAlive) return;
    this.cancelling = true;
    // Spike-#3 rule: answer every outstanding extension_ui_request BEFORE
    // abort — abort with a pending UI request wedges pi.
    this.broker?.cancelAll();
    await this.pi.request({ type: "abort" }).catch(() => {});
  }

  async shutdown(): Promise<void> {
    await this.pi?.stop();
    this.pi = null;
    this.activeSession = null;
  }
}

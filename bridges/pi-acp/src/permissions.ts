// extension_ui_request ↔ ACP session/request_permission broker (task #9).
//
// Spike-#3 rules baked in:
//   1. NEVER abort while a UI request is outstanding — pi wedges. cancelAll()
//      answers every pending request (cancelled: true → the gate blocks) and
//      MUST be called before abort (PiAcpAgent.cancel does).
//   2. The 30s auto-deny lives on the Notesage side (its PermissionCard flow
//      responds "cancelled"); the broker adds a safety timeout as a last
//      resort so a crashed/unresponsive ACP client can't wedge pi forever.
//   3. Unknown UI requests (not carrying the permission marker) are answered
//      cancelled immediately — fail-safe, never wedge, never silently allow.

import type { PermissionOption, RequestPermissionResponse, ToolCallUpdate } from "@agentclientprotocol/sdk";

export const PERMISSION_MARKER = "__NOTESAGE_PERMISSION__";
const ALLOW = "Allow";

export interface PermissionUiRequest {
  id: string;
  method?: string;
  title?: string;
  options?: string[];
}

export interface AcpPermissionAsk {
  toolCall: ToolCallUpdate;
  options: PermissionOption[];
}

export type RequestPermissionFn = (ask: AcpPermissionAsk) => Promise<RequestPermissionResponse>;
export type UiResponder = (response: { id: string; value?: string; cancelled?: true }) => void;

export const PERMISSION_OPTIONS: PermissionOption[] = [
  { optionId: "allow_once", name: "Allow", kind: "allow_once" },
  { optionId: "allow_always", name: "Allow always", kind: "allow_always" },
  { optionId: "reject_once", name: "Deny", kind: "reject_once" },
];

interface KnownTool {
  toolName: string;
  args: Record<string, unknown>;
  title: string;
}

export class PermissionBroker {
  /** toolCallId → info from tool_execution_start (enriches the ACP ask). */
  private readonly knownTools = new Map<string, KnownTool>();
  /** UI request id → settle function (idempotent). */
  private readonly pending = new Map<string, (value?: string) => void>();

  constructor(
    private readonly requestPermission: RequestPermissionFn,
    private readonly respond: UiResponder,
    private readonly safetyTimeoutMs = 120_000,
  ) {}

  get pendingCount(): number {
    return this.pending.size;
  }

  /** Feed every pi event; returns true when the event was consumed. */
  handle(e: Record<string, unknown>): boolean {
    if (e.type === "tool_execution_start") {
      const id = String(e.toolCallId ?? "");
      if (id) {
        this.knownTools.set(id, {
          toolName: String(e.toolName ?? "tool"),
          args: (e.args ?? {}) as Record<string, unknown>,
          title: String(e.toolName ?? "tool"),
        });
      }
      return false; // not consumed — the translator also needs it
    }
    if (e.type === "tool_execution_end") {
      this.knownTools.delete(String(e.toolCallId ?? ""));
      return false;
    }
    if (e.type !== "extension_ui_request") return false;

    const req = e as unknown as PermissionUiRequest;
    if (!req.id) return true;
    const envelope = this.parseMarker(req.title);
    if (!envelope) {
      // Not ours (or malformed) — answer immediately so pi can never wedge on
      // a UI surface the bridge doesn't understand. cancelled → gate blocks.
      this.respond({ id: req.id, cancelled: true });
      return true;
    }
    void this.ask(req.id, envelope.toolCallId, envelope.toolName);
    return true;
  }

  private parseMarker(title: string | undefined): { toolCallId: string; toolName: string } | null {
    if (!title?.startsWith(PERMISSION_MARKER)) return null;
    try {
      const parsed = JSON.parse(title.slice(PERMISSION_MARKER.length)) as {
        toolCallId?: unknown;
        toolName?: unknown;
      };
      return {
        toolCallId: String(parsed.toolCallId ?? ""),
        toolName: String(parsed.toolName ?? "tool"),
      };
    } catch {
      return null;
    }
  }

  private async ask(uiRequestId: string, toolCallId: string, toolName: string): Promise<void> {
    // Idempotent settle: first of {ACP outcome, cancelAll, safety timeout} wins.
    let settled = false;
    const settle = (value?: string) => {
      if (settled) return;
      settled = true;
      this.pending.delete(uiRequestId);
      clearTimeout(timer);
      if (value) this.respond({ id: uiRequestId, value });
      else this.respond({ id: uiRequestId, cancelled: true });
    };
    this.pending.set(uiRequestId, settle);
    const timer = setTimeout(() => settle(), this.safetyTimeoutMs);

    const known = this.knownTools.get(toolCallId);
    try {
      const res = await this.requestPermission({
        toolCall: {
          toolCallId,
          ...(known ? { title: `${known.toolName}`, rawInput: known.args } : { title: toolName }),
        },
        options: PERMISSION_OPTIONS,
      });
      const outcome = res.outcome;
      if (outcome && outcome.outcome === "selected" && String(outcome.optionId).startsWith("allow")) {
        settle(ALLOW);
      } else {
        settle(); // rejected / cancelled / unknown → cancelled → gate blocks
      }
    } catch {
      settle(); // ACP transport error → block, never wedge
    }
  }

  /** Answer every outstanding request (cancelled). MUST run before abort. */
  cancelAll(): void {
    for (const settle of [...this.pending.values()]) settle();
  }
}

// Notesage permission gate (task #13) — shipped INTO the pi config dir by
// local_agent_write_config; not a user-editable file.
//
// Blocks every non-read-only tool call until the host approves. In RPC mode
// the ctx.ui.select() surfaces as an extension_ui_request on stdout, which the
// notesage-pi-acp bridge translates to ACP session/request_permission (task
// #9); the answer flows back as extension_ui_response. Fail-safe on every
// path: no UI (-p mode), handler error, or a cancelled request all BLOCK.
//
// Stateless by design: tiered "allow always/session" approvals live in
// Notesage's ScopedApproval store, which answers the ACP request without
// re-prompting the user — from pi's perspective every decision is one-shot.
//
// The title carries a machine-parseable envelope so the bridge can correlate
// the UI request to the exact tool call (toolCallId comes from the hook event).
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const PERMISSION_MARKER = "__NOTESAGE_PERMISSION__";
export const ALLOW = "Allow";
export const DENY = "Deny";

/** Tools that never prompt — mirrors Notesage's direct-API auto-allow split. */
const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls"]);

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (READ_ONLY_TOOLS.has(event.toolName)) return undefined;
    if (!ctx.hasUI) {
      return { block: true, reason: "Blocked: no host available to approve this tool call" };
    }
    const envelope = JSON.stringify({
      toolCallId: event.toolCallId,
      toolName: event.toolName,
    });
    const choice = await ctx.ui.select(`${PERMISSION_MARKER}${envelope}`, [ALLOW, DENY]);
    if (choice !== ALLOW) {
      return { block: true, reason: "Tool call denied" };
    }
    return undefined;
  });
}

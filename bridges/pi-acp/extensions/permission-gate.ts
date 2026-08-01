// Notesage permission gate (task #13) — shipped INTO the pi config dir by
// local_agent_write_config; not a user-editable file.
//
// Blocks every non-read-only tool call until the host approves. In RPC mode
// the ctx.ui.select() surfaces as an extension_ui_request on stdout, which the
// notesage-acp-pi bridge translates to ACP session/request_permission (task
// #9); the answer flows back as extension_ui_response. Fail-safe on every
// path: no UI (-p mode), handler error, or a cancelled request all BLOCK.
//
// Stateless by design: tiered "allow always/session" approvals live in
// Notesage's ScopedApproval store, which answers the ACP request without
// re-prompting the user — from pi's perspective every decision is one-shot.
// Session modes live in the bridge for the same reason: this file holds no
// policy, it only asks and reports.
//
// The title carries a machine-parseable envelope so the bridge can correlate
// the UI request to the exact tool call (toolCallId comes from the hook event).
//
// The answer may carry a reason: the bridge can settle a select with
// BLOCK_REASON_PREFIX + text, and that text becomes the block reason handed to
// the model. Without it a refusal is indistinguishable from any other denial,
// so a model in Read Only cannot tell "not this time" from "never in this
// session" and will retry the same write until the turn burns out.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const PERMISSION_MARKER = "__NOTESAGE_PERMISSION__";
export const BLOCK_REASON_PREFIX = "__NOTESAGE_BLOCK__";
export const ALLOW = "Allow";
export const DENY = "Deny";

/**
 * Tools that never prompt — mirrors Notesage's direct-API auto-allow split.
 *
 * This is an ALLOW-LIST, and that direction is load-bearing: pi's built-in set
 * (read, bash, edit, write, grep, find, ls — packages/coding-agent/docs/
 * extensions.md) can grow, extensions can register their own tools, and MCP
 * servers contribute more. Anything not named here prompts, so a tool this
 * file has never heard of is gated by default rather than waved through.
 */
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
    if (choice === ALLOW) return undefined;
    if (choice?.startsWith(BLOCK_REASON_PREFIX)) {
      return { block: true, reason: choice.slice(BLOCK_REASON_PREFIX.length) };
    }
    // A human picking "Deny" in a TUI, a cancelled request, or an unknown
    // answer — all one-off denials with nothing more to say.
    return { block: true, reason: "Tool call denied" };
  });
}

// pi event stream → ACP session/update translation (task #8).
//
// Sources of truth: pi v0.80.6's bundled docs/rpc.md (event shapes recorded
// live in spikes #1/#3) and @agentclientprotocol/sdk's generated schema.
//
// Mapping:
//   message_update.text_delta      → agent_message_chunk
//   message_update.thinking_delta  → agent_thought_chunk
//   tool_execution_start           → tool_call (in_progress, kind, rawInput,
//                                    Diff content derived from edit/write args)
//   tool_execution_update          → tool_call_update (accumulated content —
//                                    pi sends the full partialResult, so each
//                                    update REPLACES the content list)
//   tool_execution_end             → tool_call_update (completed/failed,
//                                    rawOutput, result content)
// Everything else (queue/compaction/retry lifecycle) is intentionally not
// forwarded — ACP has no equivalent and Notesage derives turn state from the
// prompt response.

import type { ContentBlock, SessionNotification, ToolCallContent, ToolKind } from "@agentclientprotocol/sdk";

export type SessionUpdate = SessionNotification["update"];

const TOOL_KINDS: Record<string, ToolKind> = {
  read: "read",
  ls: "read",
  edit: "edit",
  write: "edit",
  bash: "execute",
  grep: "search",
  find: "search",
};

export function toolKindFor(toolName: string): ToolKind {
  return TOOL_KINDS[toolName] ?? "other";
}

function firstString(...vals: unknown[]): string | undefined {
  for (const v of vals) if (typeof v === "string" && v) return v;
  return undefined;
}

/** Human title in the style Notesage's formatToolLabel expects to refine. */
export function toolTitleFor(toolName: string, args: Record<string, unknown>): string {
  const detail = firstString(args.path, args.file, args.command, args.pattern, args.url, args.query);
  if (!detail) return toolName;
  const trimmed = detail.length > 80 ? `${detail.slice(0, 77)}...` : detail;
  return `${toolName}: ${trimmed}`;
}

/** Derive ACP Diff content from pi edit/write tool ARGS (issue #5121 shape:
 *  `edits: [{oldText,newText}]`, with legacy top-level oldText/newText). */
export function diffContentFor(toolName: string, args: Record<string, unknown>): ToolCallContent[] {
  const path = firstString(args.path, args.file);
  if (!path) return [];
  if (toolName === "write" && typeof args.content === "string") {
    return [{ type: "diff", path, oldText: null, newText: args.content }];
  }
  if (toolName !== "edit") return [];
  const edits = Array.isArray(args.edits) ? args.edits : [];
  const diffs: ToolCallContent[] = [];
  for (const e of edits) {
    if (e && typeof e === "object" && typeof (e as { newText?: unknown }).newText === "string") {
      const edit = e as { oldText?: string; newText: string };
      diffs.push({ type: "diff", path, oldText: edit.oldText ?? null, newText: edit.newText });
    }
  }
  // Legacy single-edit shape.
  if (!diffs.length && typeof args.newText === "string") {
    diffs.push({ type: "diff", path, oldText: (args.oldText as string | undefined) ?? null, newText: args.newText });
  }
  return diffs;
}

/** pi result content items → ACP tool-call content wrappers. */
export function resultContent(items: unknown): ToolCallContent[] {
  if (!Array.isArray(items)) return [];
  const out: ToolCallContent[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const c = item as { type?: string; text?: string; data?: string; mimeType?: string };
    if (c.type === "text" && typeof c.text === "string") {
      out.push({ type: "content", content: { type: "text", text: c.text } satisfies ContentBlock });
    } else if (c.type === "image" && typeof c.data === "string" && typeof c.mimeType === "string") {
      out.push({ type: "content", content: { type: "image", data: c.data, mimeType: c.mimeType } satisfies ContentBlock });
    }
  }
  return out;
}

export class PiEventTranslator {
  /** Diff content captured at tool_call start, re-attached on completion so
   *  the final update (which replaces content) keeps the diff visible. */
  private readonly startDiffs = new Map<string, ToolCallContent[]>();

  constructor(private readonly send: (update: SessionUpdate) => void) {}

  handle(e: Record<string, unknown>): void {
    switch (e.type) {
      case "message_update": {
        const ev = e.assistantMessageEvent as { type?: string; delta?: string } | undefined;
        if (!ev?.type || typeof ev.delta !== "string" || !ev.delta) return;
        if (ev.type === "text_delta") {
          this.send({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: ev.delta } });
        } else if (ev.type === "thinking_delta") {
          this.send({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: ev.delta } });
        }
        return;
      }
      case "tool_execution_start": {
        const toolCallId = String(e.toolCallId ?? "");
        const toolName = String(e.toolName ?? "tool");
        const args = (e.args ?? {}) as Record<string, unknown>;
        if (!toolCallId) return;
        const diffs = diffContentFor(toolName, args);
        if (diffs.length) this.startDiffs.set(toolCallId, diffs);
        const path = firstString(args.path, args.file);
        this.send({
          sessionUpdate: "tool_call",
          toolCallId,
          title: toolTitleFor(toolName, args),
          name: toolName,
          kind: toolKindFor(toolName),
          status: "in_progress",
          rawInput: args,
          ...(diffs.length ? { content: diffs } : {}),
          ...(path ? { locations: [{ path }] } : {}),
        });
        return;
      }
      case "tool_execution_update": {
        const toolCallId = String(e.toolCallId ?? "");
        if (!toolCallId) return;
        const partial = e.partialResult as { content?: unknown } | undefined;
        this.send({
          sessionUpdate: "tool_call_update",
          toolCallId,
          status: "in_progress",
          content: [...(this.startDiffs.get(toolCallId) ?? []), ...resultContent(partial?.content)],
        });
        return;
      }
      case "tool_execution_end": {
        const toolCallId = String(e.toolCallId ?? "");
        if (!toolCallId) return;
        const result = e.result as { content?: unknown } | undefined;
        const diffs = this.startDiffs.get(toolCallId) ?? [];
        this.startDiffs.delete(toolCallId);
        this.send({
          sessionUpdate: "tool_call_update",
          toolCallId,
          status: e.isError ? "failed" : "completed",
          content: [...diffs, ...resultContent(result?.content)],
          rawOutput: result,
        });
        return;
      }
      default:
        return;
    }
  }
}

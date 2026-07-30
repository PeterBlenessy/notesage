import { beforeEach, describe, expect, it } from "vitest";
import { diffContentFor, PiEventTranslator, resultContent, toolKindFor, toolTitleFor, type SessionUpdate } from "../src/translate";

let updates: SessionUpdate[];
let t: PiEventTranslator;

beforeEach(() => {
  updates = [];
  t = new PiEventTranslator((u) => updates.push(u));
});

describe("toolKindFor / toolTitleFor", () => {
  it("maps pi built-ins to ACP kinds", () => {
    expect(toolKindFor("read")).toBe("read");
    expect(toolKindFor("edit")).toBe("edit");
    expect(toolKindFor("write")).toBe("edit");
    expect(toolKindFor("bash")).toBe("execute");
    expect(toolKindFor("grep")).toBe("search");
    expect(toolKindFor("hello")).toBe("other");
  });

  it("builds titles from the most informative arg, truncated", () => {
    expect(toolTitleFor("bash", { command: "ls -la" })).toBe("bash: ls -la");
    expect(toolTitleFor("read", { path: "/a/b.md" })).toBe("read: /a/b.md");
    expect(toolTitleFor("hello", {})).toBe("hello");
    expect(toolTitleFor("bash", { command: "x".repeat(100) })).toHaveLength("bash: ".length + 80);
  });
});

describe("diffContentFor", () => {
  it("maps edit args (edits array) to one Diff per edit", () => {
    const diffs = diffContentFor("edit", {
      path: "/p/file.ts",
      edits: [
        { oldText: "a", newText: "b" },
        { oldText: "c", newText: "d" },
      ],
    });
    expect(diffs).toEqual([
      { type: "diff", path: "/p/file.ts", oldText: "a", newText: "b" },
      { type: "diff", path: "/p/file.ts", oldText: "c", newText: "d" },
    ]);
  });

  it("maps legacy top-level oldText/newText", () => {
    expect(diffContentFor("edit", { path: "/p/f", oldText: "x", newText: "y" })).toEqual([
      { type: "diff", path: "/p/f", oldText: "x", newText: "y" },
    ]);
  });

  it("maps write to a new-file diff", () => {
    expect(diffContentFor("write", { path: "/p/new.md", content: "hello" })).toEqual([
      { type: "diff", path: "/p/new.md", oldText: null, newText: "hello" },
    ]);
  });

  it("returns nothing for non-mutating tools or missing path", () => {
    expect(diffContentFor("bash", { command: "ls" })).toEqual([]);
    expect(diffContentFor("edit", { edits: [{ oldText: "a", newText: "b" }] })).toEqual([]);
  });
});

describe("resultContent", () => {
  it("wraps text and image items, skipping unknown types", () => {
    expect(
      resultContent([
        { type: "text", text: "out" },
        { type: "image", data: "b64", mimeType: "image/png" },
        { type: "mystery" },
      ]),
    ).toEqual([
      { type: "content", content: { type: "text", text: "out" } },
      { type: "content", content: { type: "image", data: "b64", mimeType: "image/png" } },
    ]);
  });
});

describe("PiEventTranslator", () => {
  it("translates text and thinking deltas to chunks", () => {
    t.handle({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Hel" } });
    t.handle({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "hmm" } });
    t.handle({ type: "message_update", assistantMessageEvent: { type: "text_end", contentIndex: 0, content: "Hel" } });
    expect(updates).toEqual([
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hel" } },
      { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "hmm" } },
    ]);
  });

  it("translates the bash tool lifecycle (spike-recorded shapes)", () => {
    t.handle({ type: "tool_execution_start", toolCallId: "call_1", toolName: "bash", args: { command: "ls -la" } });
    t.handle({
      type: "tool_execution_update",
      toolCallId: "call_1",
      toolName: "bash",
      args: { command: "ls -la" },
      partialResult: { content: [{ type: "text", text: "partial" }], details: {} },
    });
    t.handle({
      type: "tool_execution_end",
      toolCallId: "call_1",
      toolName: "bash",
      result: { content: [{ type: "text", text: "total 48" }], details: {} },
      isError: false,
    });
    expect(updates[0]).toMatchObject({
      sessionUpdate: "tool_call",
      toolCallId: "call_1",
      title: "bash: ls -la",
      kind: "execute",
      status: "in_progress",
      rawInput: { command: "ls -la" },
    });
    expect(updates[1]).toMatchObject({
      sessionUpdate: "tool_call_update",
      toolCallId: "call_1",
      status: "in_progress",
      content: [{ type: "content", content: { type: "text", text: "partial" } }],
    });
    expect(updates[2]).toMatchObject({
      sessionUpdate: "tool_call_update",
      toolCallId: "call_1",
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "total 48" } }],
    });
  });

  it("attaches Diff content on edit start and keeps it through completion", () => {
    t.handle({
      type: "tool_execution_start",
      toolCallId: "c2",
      toolName: "edit",
      args: { path: "/p/f.ts", edits: [{ oldText: "a", newText: "b" }] },
    });
    t.handle({
      type: "tool_execution_end",
      toolCallId: "c2",
      toolName: "edit",
      result: { content: [{ type: "text", text: "ok" }] },
      isError: false,
    });
    expect(updates[0]).toMatchObject({
      sessionUpdate: "tool_call",
      kind: "edit",
      locations: [{ path: "/p/f.ts" }],
      content: [{ type: "diff", path: "/p/f.ts", oldText: "a", newText: "b" }],
    });
    expect(updates[1]).toMatchObject({
      sessionUpdate: "tool_call_update",
      status: "completed",
      content: [
        { type: "diff", path: "/p/f.ts", oldText: "a", newText: "b" },
        { type: "content", content: { type: "text", text: "ok" } },
      ],
    });
  });

  it("marks failed tools (spike deny shape: isError + reason text)", () => {
    t.handle({ type: "tool_execution_start", toolCallId: "c3", toolName: "write", args: { path: "/p/x", content: "hi" } });
    t.handle({
      type: "tool_execution_end",
      toolCallId: "c3",
      toolName: "write",
      result: { content: [{ type: "text", text: "denied by user" }], details: {} },
      isError: true,
    });
    expect(updates[1]).toMatchObject({ sessionUpdate: "tool_call_update", status: "failed" });
  });

  it("ignores lifecycle noise", () => {
    for (const type of ["agent_start", "turn_start", "queue_update", "compaction_start", "agent_settled"]) {
      t.handle({ type });
    }
    expect(updates).toEqual([]);
  });
});

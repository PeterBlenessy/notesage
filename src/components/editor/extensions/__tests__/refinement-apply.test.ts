/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { EditorState } from "@tiptap/pm/state";
import { Schema } from "@tiptap/pm/model";
import {
  RefinementApply,
  RefinementApplyPluginKey,
  applyRefinement,
  applyRefinementToDoc,
  isAnchorValid,
} from "../refinement-apply";
import { useEditorStore } from "@/stores/editor-store";
import { useRefinementStore } from "@/stores/refinement-store";
import type { RefinementEntry } from "@/lib/ai/refinement";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DOC_PATH = "/tmp/notes/refine.md";

function createEditor(html: string): Editor {
  return new Editor({
    extensions: [StarterKit, TaskList, TaskItem, RefinementApply],
    content: html,
  });
}

/** Register `DOC_PATH` as the single active document in the editor store. */
function seedActiveDoc(): void {
  useEditorStore.setState({
    openDocuments: [
      {
        id: "tab-1",
        filePath: DOC_PATH,
        fileName: "refine.md",
        isDirty: false,
        content: "",
        frontmatter: null,
        fileType: "markdown",
      },
    ],
    activeTabId: "tab-1",
  });
}

function makeEntry(overrides: Partial<RefinementEntry> = {}): RefinementEntry {
  return {
    id: "entry-1",
    docPath: DOC_PATH,
    anchor: { from: 1, to: 10 },
    srcHash: "hash",
    originalText: "Follow up",
    result: {
      verdict: "sharpen",
      outcome: "Email Priya by Fri to confirm Q3 scope",
      steps: [],
      rationale: "made specific",
    },
    status: "pending",
    createdAt: Date.now(),
    ...overrides,
  };
}

function pendingEntries() {
  return useRefinementStore
    .getState()
    .entries.filter((e) => e.status === "pending");
}

/** Count widget decorations currently produced by the plugin. */
function widgetCount(editor: Editor): number {
  const set = RefinementApplyPluginKey.getState(editor.state);
  return set ? set.find().length : 0;
}

// ---------------------------------------------------------------------------
// Reset shared stores between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  useRefinementStore.setState({ entries: [], seen: new Set<string>() });
  useEditorStore.setState({ openDocuments: [], activeTabId: null });
});

// ---------------------------------------------------------------------------
// Extension surface
// ---------------------------------------------------------------------------

describe("RefinementApply extension", () => {
  it("exports a Tiptap Extension named refinementApply", () => {
    expect(RefinementApply).toBeDefined();
    expect(RefinementApply.name).toBe("refinementApply");
  });

  it("exports a PluginKey", () => {
    expect(RefinementApplyPluginKey).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Anchor validation (pure)
// ---------------------------------------------------------------------------

describe("isAnchorValid", () => {
  it("accepts an in-range, ordered, non-empty anchor", () => {
    const editor = createEditor("<p>Follow up with the team</p>");
    const entry = makeEntry({ anchor: { from: 1, to: 10 } });
    expect(isAnchorValid(editor.state.doc, entry)).toBe(true);
    editor.destroy();
  });

  it("rejects an out-of-range anchor", () => {
    const editor = createEditor("<p>short</p>");
    const entry = makeEntry({ anchor: { from: 1, to: 9999 } });
    expect(isAnchorValid(editor.state.doc, entry)).toBe(false);
    editor.destroy();
  });

  it("rejects an inverted / empty anchor", () => {
    const editor = createEditor("<p>Follow up</p>");
    expect(isAnchorValid(editor.state.doc, makeEntry({ anchor: { from: 5, to: 5 } }))).toBe(false);
    expect(isAnchorValid(editor.state.doc, makeEntry({ anchor: { from: 8, to: 3 } }))).toBe(false);
    editor.destroy();
  });
});

// ---------------------------------------------------------------------------
// Decoration production
// ---------------------------------------------------------------------------

describe("RefinementApply decorations", () => {
  it("produces a widget for a pending entry on the active doc", () => {
    seedActiveDoc();
    const editor = createEditor("<p>Follow up with the team</p>");
    useRefinementStore.getState().upsertEntry(makeEntry({ anchor: { from: 1, to: 10 } }));
    // Subscriber dispatches a meta ping → rebuild. Force a sync rebuild check.
    expect(widgetCount(editor)).toBe(1);
    editor.destroy();
  });

  it("produces no widget when there is no active document", () => {
    // No seedActiveDoc — store has the entry but no active path.
    const editor = createEditor("<p>Follow up with the team</p>");
    useRefinementStore.getState().upsertEntry(makeEntry({ anchor: { from: 1, to: 10 } }));
    expect(widgetCount(editor)).toBe(0);
    editor.destroy();
  });

  it("skips entries with the 'keep' verdict", () => {
    seedActiveDoc();
    const editor = createEditor("<p>Already a clear next step</p>");
    useRefinementStore.getState().upsertEntry(
      makeEntry({ result: { verdict: "keep", outcome: "", steps: [], rationale: "fine" } }),
    );
    expect(widgetCount(editor)).toBe(0);
    editor.destroy();
  });

  it("skips entries with a stale (out-of-range) anchor", () => {
    seedActiveDoc();
    const editor = createEditor("<p>short</p>");
    useRefinementStore.getState().upsertEntry(makeEntry({ anchor: { from: 1, to: 9999 } }));
    expect(widgetCount(editor)).toBe(0);
    editor.destroy();
  });

  it("rebuilds when the store changes (subscription)", () => {
    seedActiveDoc();
    const editor = createEditor("<p>Follow up with the team</p>");
    expect(widgetCount(editor)).toBe(0);
    useRefinementStore.getState().upsertEntry(makeEntry({ anchor: { from: 1, to: 10 } }));
    expect(widgetCount(editor)).toBe(1);
    useRefinementStore.getState().dismiss("entry-1");
    expect(widgetCount(editor)).toBe(0);
    editor.destroy();
  });
});

// ---------------------------------------------------------------------------
// Apply (end-to-end through the view)
// ---------------------------------------------------------------------------

describe("applyRefinement", () => {
  it("swaps the anchored text to the outcome and marks the entry applied", () => {
    seedActiveDoc();
    const editor = createEditor("<p>Follow up</p>");
    // "<p>Follow up</p>" → text "Follow up" spans positions 1..10.
    const entry = makeEntry({
      anchor: { from: 1, to: 10 },
      result: { verdict: "sharpen", outcome: "Email Priya by Friday", steps: [], rationale: "" },
    });
    useRefinementStore.getState().upsertEntry(entry);

    const edited = applyRefinement(editor.view, "entry-1");
    expect(edited).toBe(true);
    expect(editor.state.doc.textContent).toBe("Email Priya by Friday");
    // No longer pending.
    expect(pendingEntries()).toHaveLength(0);
    editor.destroy();
  });

  it("inserts sub-steps as a nested task list after the line", () => {
    seedActiveDoc();
    const editor = createEditor("<p>Ship the feature</p>");
    const entry = makeEntry({
      anchor: { from: 1, to: 16 }, // "Ship the feature"
      result: {
        verdict: "split",
        outcome: "Ship the onboarding feature",
        steps: [{ text: "Write tests" }, { text: "Wire the UI" }],
        rationale: "compound task",
      },
    });
    useRefinementStore.getState().upsertEntry(entry);

    const edited = applyRefinement(editor.view, "entry-1");
    expect(edited).toBe(true);

    const json = editor.getJSON();
    const types = json.content?.map((n) => n.type) ?? [];
    expect(types).toContain("taskList");

    const taskList = json.content?.find((n) => n.type === "taskList");
    const items = (taskList?.content ?? []) as Array<{ attrs?: { checked?: boolean } }>;
    expect(items).toHaveLength(2);
    // Both task items are unchecked.
    for (const item of items) {
      expect(item.attrs?.checked).toBe(false);
    }

    // The line text was also rewritten to the outcome.
    expect(editor.state.doc.textContent).toContain("Ship the onboarding feature");
    expect(pendingEntries()).toHaveLength(0);
    editor.destroy();
  });

  it("dismisses without editing when the anchor is stale", () => {
    seedActiveDoc();
    const editor = createEditor("<p>short</p>");
    const before = editor.state.doc.textContent;
    useRefinementStore.getState().upsertEntry(makeEntry({ anchor: { from: 1, to: 9999 } }));

    const edited = applyRefinement(editor.view, "entry-1");
    expect(edited).toBe(false);
    expect(editor.state.doc.textContent).toBe(before);
    expect(pendingEntries()).toHaveLength(0);
    editor.destroy();
  });

  it("applies as a single undo step", () => {
    seedActiveDoc();
    const editor = createEditor("<p>Do the thing</p>");
    const entry = makeEntry({
      anchor: { from: 1, to: 13 }, // "Do the thing"
      result: {
        verdict: "split",
        outcome: "Do the important thing",
        steps: [{ text: "Step one" }],
        rationale: "",
      },
    });
    useRefinementStore.getState().upsertEntry(entry);

    applyRefinement(editor.view, "entry-1");
    expect(editor.getJSON().content?.some((n) => n.type === "taskList")).toBe(true);

    // A single undo reverts the entire edit (text swap + task list insertion).
    editor.commands.undo();
    expect(editor.state.doc.textContent).toBe("Do the thing");
    expect(editor.getJSON().content?.some((n) => n.type === "taskList")).toBe(false);
    editor.destroy();
  });
});

// ---------------------------------------------------------------------------
// Pure apply helper against a constructed EditorState (no view)
// ---------------------------------------------------------------------------

describe("applyRefinementToDoc (pure)", () => {
  it("returns null for a stale anchor", () => {
    const editor = createEditor("<p>short</p>");
    const tr = applyRefinementToDoc(editor.state, makeEntry({ anchor: { from: 1, to: 9999 } }));
    expect(tr).toBeNull();
    editor.destroy();
  });

  it("returns null for a 'keep' verdict with no steps", () => {
    const editor = createEditor("<p>Follow up</p>");
    const tr = applyRefinementToDoc(
      editor.state,
      makeEntry({ result: { verdict: "keep", outcome: "", steps: [], rationale: "" } }),
    );
    expect(tr).toBeNull();
    editor.destroy();
  });

  it("builds a transaction that replaces the anchored text", () => {
    const editor = createEditor("<p>Follow up</p>");
    const tr = applyRefinementToDoc(
      editor.state,
      makeEntry({ anchor: { from: 1, to: 10 }, result: { verdict: "sharpen", outcome: "Sharper", steps: [], rationale: "" } }),
    );
    expect(tr).not.toBeNull();
    const next = editor.state.apply(tr!);
    expect(next.doc.textContent).toBe("Sharper");
    editor.destroy();
  });

  it("works against a minimal hand-built schema EditorState (paragraph only)", () => {
    // A schema WITHOUT taskList/taskItem — the helper must still replace text and
    // simply skip the (impossible) step insertion.
    const schema = new Schema({
      nodes: {
        doc: { content: "block+" },
        paragraph: { group: "block", content: "text*", toDOM: () => ["p", 0] },
        text: {},
      },
      marks: {},
    });
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("Follow up")]),
    ]);
    const state = EditorState.create({ schema, doc });

    const tr = applyRefinementToDoc(
      state,
      makeEntry({
        anchor: { from: 1, to: 10 },
        result: { verdict: "sharpen", outcome: "Sharper", steps: [{ text: "ignored" }], rationale: "" },
      }),
    );
    expect(tr).not.toBeNull();
    const next = state.apply(tr!);
    expect(next.doc.textContent).toBe("Sharper");
    // No taskList node exists in this schema, so nothing was inserted.
    expect(next.doc.childCount).toBe(1);
  });
});

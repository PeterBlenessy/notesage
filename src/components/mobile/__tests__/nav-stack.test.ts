import { describe, it, expect } from "vitest";

import {
  deriveNavStack,
  diffNavStack,
  documentScreenId,
  storeStateForScreen,
  type NavScreen,
} from "../nav-stack";

/**
 * The native navigation stack, derived from the store (PRD
 * `docs/prds/2026-09-06-ios-native-navigation.md`).
 *
 * Every interesting case is a SEQUENCE — open two folders and a document, pop
 * two levels at once, follow a link trail and retrace it — and a wrong answer
 * shows up as a stack that no longer matches what is on screen, which is the
 * kind of bug that is miserable to chase on a phone and trivial here.
 */

const ROOT = { rootTitle: "Notesage", homeEditorTitle: "Edit Home" };
const base = { folderStack: [], docStack: [], openDoc: null, homeEditorOpen: false, ...ROOT };
const folder = (relPath: string, name = relPath) => ({ relPath, name });

describe("deriveNavStack", () => {
  it("is Home alone at the root", () => {
    expect(deriveNavStack(base)).toEqual([{ id: "", title: "Notesage" }]);
  });

  it("mirrors the folder trail, deepest last", () => {
    expect(
      deriveNavStack({ ...base, folderStack: [folder("Inbox"), folder("Inbox/2026", "2026")] }),
    ).toEqual([
      { id: "", title: "Notesage" },
      { id: "Inbox", title: "Inbox" },
      { id: "Inbox/2026", title: "2026" },
    ]);
  });

  it("puts the open document on top of its folder", () => {
    const stack = deriveNavStack({
      ...base,
      folderStack: [folder("Inbox")],
      openDoc: folder("Inbox/note.md", "note.md"),
    });
    expect(stack.map((s) => s.id)).toEqual(["", "Inbox", documentScreenId("Inbox/note.md")]);
  });

  it("keeps the link trail as real screens, so Back retraces it", () => {
    // Following three links and pressing Back should walk them, which is
    // exactly what a stack does — and the reason the trail is not flattened.
    const stack = deriveNavStack({
      ...base,
      folderStack: [folder("Inbox")],
      docStack: [folder("Inbox/a.md", "a"), folder("Inbox/b.md", "b")],
      openDoc: folder("Inbox/c.md", "c"),
    });
    expect(stack.map((s) => s.title)).toEqual(["Notesage", "Inbox", "a", "b", "c"]);
  });

  it("shows the Home editor as a screen on Home, with nothing under it", () => {
    // It is opened FROM Home and nothing nests inside it, so a folder trail
    // left over from before must not appear beneath it.
    const stack = deriveNavStack({
      ...base,
      homeEditorOpen: true,
      folderStack: [folder("Inbox")],
    });
    expect(stack.map((s) => s.id)).toEqual(["", "home-editor"]);
  });

  it("gives a document a different id from a folder of the same path", () => {
    // A note and the folder it sits in can share a relative path prefix; two
    // screens with one id would make the diff pop the wrong one.
    expect(documentScreenId("Inbox")).not.toBe("Inbox");
  });
});

describe("diffNavStack", () => {
  const screen = (id: string, title = id): NavScreen => ({ id, title });

  it("pushes what is new", () => {
    expect(diffNavStack([screen("")], [screen(""), screen("Inbox")])).toEqual({
      pops: 0,
      pushes: [screen("Inbox")],
    });
  });

  it("pops what is gone", () => {
    expect(diffNavStack([screen(""), screen("Inbox"), screen("Inbox/2026")], [screen("")])).toEqual({
      pops: 2,
      pushes: [],
    });
  });

  it("pops and pushes when the branch changes", () => {
    // Jumping from one folder to another at the same depth is not a push.
    expect(
      diffNavStack([screen(""), screen("Inbox")], [screen(""), screen("Recordings")]),
    ).toEqual({ pops: 1, pushes: [screen("Recordings")] });
  });

  it("treats a renamed screen as neither a push nor a pop", () => {
    // The id survives a rename; only the title moves. Rebuilding the stack
    // under someone because they renamed a folder would be its own bug.
    expect(
      diffNavStack([screen("Inbox", "Inbox")], [screen("Inbox", "Posteingang")]),
    ).toEqual({ pops: 0, pushes: [] });
  });

  it("does nothing when nothing changed", () => {
    const stack = [screen(""), screen("Inbox")];
    expect(diffNavStack(stack, [...stack])).toEqual({ pops: 0, pushes: [] });
  });
});

describe("storeStateForScreen", () => {
  const stack = deriveNavStack({
    ...base,
    folderStack: [folder("Inbox"), folder("Inbox/2026", "2026")],
    docStack: [folder("Inbox/2026/a.md", "a")],
    openDoc: folder("Inbox/2026/b.md", "b"),
  });

  it("reads a folder screen as a depth with no document", () => {
    expect(storeStateForScreen(stack, "Inbox")).toEqual({
      folderDepth: 1,
      docTrail: 0,
      closesDoc: true,
    });
  });

  it("reads the root as depth zero", () => {
    expect(storeStateForScreen(stack, "")).toEqual({
      folderDepth: 0,
      docTrail: 0,
      closesDoc: true,
    });
  });

  it("reads a document in the trail as the trail below it", () => {
    // Popping to `a` leaves `a` open with nothing beneath it.
    expect(storeStateForScreen(stack, documentScreenId("Inbox/2026/a.md"))).toEqual({
      folderDepth: 2,
      docTrail: 0,
      closesDoc: false,
    });
  });

  it("returns null for a screen it does not know", () => {
    // The two have drifted; the caller re-derives rather than guessing, which
    // is the difference between a glitch and a stack that lies.
    expect(storeStateForScreen(stack, "Nowhere")).toBeNull();
  });
});

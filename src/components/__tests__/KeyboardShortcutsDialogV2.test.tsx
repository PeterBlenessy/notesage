// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { KeyboardShortcutsDialogV2 } from "@/components/KeyboardShortcutsDialogV2";
import manifest from "@/shared/appCommandManifest.json";

const { isAlphaBuildMock } = vi.hoisted(() => ({
  isAlphaBuildMock: vi.fn<() => boolean>(() => true),
}));

vi.mock("@/lib/build-channel", () => ({
  isAlphaBuild: isAlphaBuildMock,
}));

interface RenderedRow {
  commandId: string | null;
  action: string;
  chord: string;
  group: string;
}

// Radix Dialog renders into a portal, so query document.body.
function renderRows(): RenderedRow[] {
  render(<KeyboardShortcutsDialogV2 open onOpenChange={() => {}} />);
  const rows: RenderedRow[] = [];
  for (const section of Array.from(document.body.querySelectorAll("section"))) {
    const group = section.querySelector("h3")?.textContent ?? "";
    for (const row of Array.from(section.querySelectorAll("h3 + div > div"))) {
      rows.push({
        commandId: row.getAttribute("data-command-id"),
        action: row.querySelector("span")?.textContent ?? "",
        chord: Array.from(row.querySelectorAll("kbd"))
          .map((kbd) => kbd.textContent ?? "")
          .join(""),
        group,
      });
    }
  }
  return rows;
}

function chordFor(rows: RenderedRow[], action: string): string | undefined {
  return rows.find((row) => row.action === action)?.chord;
}

describe("KeyboardShortcutsDialogV2", () => {
  beforeEach(() => {
    isAlphaBuildMock.mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
  });

  it("shows every manifest command with the manifest's label and chord", () => {
    const rows = renderRows();
    expect(manifest.commands.length).toBeGreaterThan(0);
    for (const command of manifest.commands) {
      const matches = rows.filter((row) => row.commandId === command.id);
      expect(matches, `command "${command.id}" should appear exactly once`).toHaveLength(1);
      expect(matches[0].chord, `chord for "${command.id}"`).toBe(command.display);
      expect(matches[0].action, `label for "${command.id}"`).toBe(command.label);
    }
  });

  it("has no app-level row that the manifest does not own", () => {
    const ids = new Set(manifest.commands.map((command) => command.id));
    for (const row of renderRows()) {
      if (row.commandId !== null) expect(ids.has(row.commandId)).toBe(true);
    }
  });

  it("places every manifest command in a named group (no 'Other' fallback)", () => {
    const groups = new Set(renderRows().map((row) => row.group));
    expect(groups.has("Other")).toBe(false);
    expect([...groups]).toEqual([
      "File Operations",
      "Editor",
      "Find",
      "Navigation",
      "AI & Voice",
      "Settings",
    ]);
  });

  it("never shows one chord for two different actions", () => {
    const seen = new Map<string, string>();
    for (const row of renderRows()) {
      expect(
        seen.get(row.chord),
        `"${row.chord}" is shown for both "${seen.get(row.chord)}" and "${row.action}"`,
      ).toBeUndefined();
      seen.set(row.chord, row.action);
    }
  });

  it("no static (editor-owned) row reuses a chord the manifest owns", () => {
    const manifestChords = new Set(manifest.commands.map((command) => command.display));
    for (const row of renderRows()) {
      if (row.commandId === null) {
        expect(manifestChords.has(row.chord), `static "${row.action}" uses ${row.chord}`).toBe(
          false,
        );
      }
    }
  });

  it("shows the chords the audit found wrong with their real bindings", () => {
    const rows = renderRows();
    const byId = (id: string) => rows.find((row) => row.commandId === id)?.chord;
    expect(byId("copy-document-path")).toBe("⌘⌥P");
    expect(byId("export-document")).toBe("⌘⇧E");
    expect(byId("find-files")).toBe("⌘⇧F");
    expect(byId("open-inbox")).toBe("⌘⇧I");
    expect(byId("inbox-next")).toBe("⌘↓");
    expect(byId("inbox-previous")).toBe("⌘↑");
    expect(byId("open-commands-palette")).toBe("⌘⇧P");
    expect(byId("zoom-in")).toBe("⌘+");
    expect(byId("zoom-out")).toBe("⌘-");
    expect(byId("zoom-reset")).toBe("⌘0");
    // Editor-owned: comment-mark.ts binds ⌘⌥C, Tiptap's Strike binds ⌘⇧S.
    expect(chordFor(rows, "Add comment on selection")).toBe("⌘⌥C");
    expect(chordFor(rows, "Strikethrough")).toBe("⌘⇧S");
  });

  it("no longer lists removed or never-bound entries", () => {
    const rows = renderRows();
    const chords = rows.map((row) => row.chord);
    expect(chords).not.toContain("⌘⇧M"); // "Add comment" was never bound here
    expect(chords).not.toContain("⌘⇧C"); // removed command-bar summon
    expect(chords).not.toContain("⌘⇧X"); // strikethrough is ⌘⇧S
    const actions = rows.map((row) => row.action.toLowerCase());
    expect(actions.some((action) => action.includes("tree overlay"))).toBe(false);
    expect(actions.some((action) => action.includes("third path"))).toBe(false);
    expect(rows.filter((row) => row.chord === "⌘⇧E")).toHaveLength(1);
    expect(rows.find((row) => row.chord === "⌘⇧F")?.action).toBe("Find files");
  });

  it("hides the devtools chord on builds where it does nothing", () => {
    isAlphaBuildMock.mockReturnValue(false);
    const rows = renderRows();
    expect(rows.some((row) => row.commandId === "open-devtools")).toBe(false);
    expect(rows.map((row) => row.chord)).not.toContain("⌘⌥I");
  });

  it("takes the reopen hint in the header from the manifest", () => {
    renderRows();
    const hint = document.body.querySelector("h2 + p");
    const reopen = manifest.commands.find((command) => command.id === "keyboard-shortcuts");
    expect(
      Array.from(hint?.querySelectorAll("kbd") ?? [])
        .map((kbd) => kbd.textContent)
        .join(""),
    ).toBe(reopen?.display);
  });
});

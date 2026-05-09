import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import manifest from "@/shared/appCommandManifest.json";

const REQUIRED_IDS = [
  "open-command-palette",
  "open-tasks",
  "open-mentions",
  "open-tags",
  "open-research",
  "open-commands-palette",
  "find-replace",
  "find-files",
  "find-in-document",
  "close-active-document",
  "toggle-focus-mode",
  "export-document",
  "open-document-outline",
  "toggle-sidebar",
  "toggle-activity-agent",
  "toggle-chat-panel",
  "toggle-recording",
  "keyboard-shortcuts",
  "open-settings",
  "toggle-theme",
  "new-note",
  "new-project",
  "open-folder",
  "cycle-recent-next",
  "cycle-recent-previous",
  "copy-document-path",
  "reveal-in-finder",
  "exit-focus-mode",
  "open-devtools",
];

describe("appCommandManifest drift vs docs/keyboard-shortcuts.md", () => {
  it("manifest has at least 20 commands", () => {
    expect(manifest.commands.length).toBeGreaterThanOrEqual(20);
  });

  it("every manifest display string appears in docs as a backtick-quoted string", () => {
    const docs = readFileSync(
      join(process.cwd(), "docs/keyboard-shortcuts.md"),
      "utf-8",
    );
    for (const cmd of manifest.commands) {
      expect(
        docs,
        `command "${cmd.id}" has display "${cmd.display}" which is not found in docs/keyboard-shortcuts.md as \`${cmd.display}\``,
      ).toContain(`\`${cmd.display}\``);
    }
  });

  it("manifest contains all required command IDs", () => {
    const ids = new Set(manifest.commands.map((c: { id: string }) => c.id));
    for (const requiredId of REQUIRED_IDS) {
      expect(
        ids.has(requiredId),
        `required command id "${requiredId}" not found in manifest`,
      ).toBe(true);
    }
  });
});

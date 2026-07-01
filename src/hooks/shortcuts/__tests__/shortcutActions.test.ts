import { describe, it, expect } from "vitest";

import { catalog } from "@/lib/appCommandCatalog";
import { shortcutActions } from "@/hooks/shortcuts/shortcutActions";

/**
 * Global-scope commands whose behaviour is intentionally owned by another
 * surface, so they deliberately have NO `shortcutActions` entry. Empty after
 * Step 4 — every global chord is now dispatched by `useGlobalShortcuts`
 * (focus mode toggles/exits through the controller bridge).
 */
const OWNED_ELSEWHERE = new Set<string>([]);

describe("shortcutActions ↔ manifest integrity", () => {
  it("every global manifest command has exactly one action", () => {
    for (const cmd of Object.values(catalog)) {
      if ((cmd.scope ?? "global") !== "global") continue;
      if (OWNED_ELSEWHERE.has(cmd.id)) {
        expect(
          shortcutActions[cmd.id],
          `"${cmd.id}" is owned elsewhere and must NOT have an action`,
        ).toBeUndefined();
        continue;
      }
      expect(
        shortcutActions[cmd.id],
        `global command "${cmd.id}" is missing a shortcutActions entry`,
      ).toBeTypeOf("function");
    }
  });

  it("every shortcutActions id maps to a global manifest command", () => {
    for (const id of Object.keys(shortcutActions)) {
      const cmd = catalog[id];
      expect(cmd, `action "${id}" has no manifest command`).toBeDefined();
      expect(cmd.scope ?? "global").toBe("global");
    }
  });
});

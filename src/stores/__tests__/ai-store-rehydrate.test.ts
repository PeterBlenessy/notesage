// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

const { reportRehydrateError } = vi.hoisted(() => ({ reportRehydrateError: vi.fn() }));
vi.mock("@/lib/persist-rehydrate", () => ({ reportRehydrateError }));

describe("ai-store rehydration", () => {
  beforeEach(() => {
    vi.resetModules();
    reportRehydrateError.mockClear();
    localStorage.clear();
  });

  it("seeds the default prompts without reporting a rehydration error", async () => {
    // A saved value from before the defaults were bundled. Hydration from
    // localStorage is synchronous, so the seeding used to run before the
    // store constant existed, throw, and come back as a "could not restore
    // your settings" error on every launch.
    localStorage.setItem(
      "notesage-ai-settings",
      JSON.stringify({ state: { customPrompts: [], defaultPromptsBundled: false }, version: 0 }),
    );
    const { useAIStore } = await import("@/stores/ai-store");
    await Promise.resolve();

    expect(reportRehydrateError).not.toHaveBeenCalled();
    expect(useAIStore.getState().defaultPromptsBundled).toBe(true);
    expect(useAIStore.getState().customPrompts.length).toBeGreaterThan(0);
  });
});

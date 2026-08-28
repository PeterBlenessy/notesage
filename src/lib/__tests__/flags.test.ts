// @vitest-environment jsdom
import "@/test/local-storage";
import { describe, it, expect, beforeEach } from "vitest";
import { flagEntries, flagIds, isKnownFlag, type FlagId } from "@/lib/flags";
import { useFlagStore, isFlagEnabled } from "@/stores/flag-store";

/**
 * The defaults-off lock.
 *
 * This is what replaces the old channel-isolation guarantee — "stable users
 * never receive alpha builds" — now that everyone receives the same binary.
 * The failure it guards is silent and reaches every user at once, which is
 * exactly how alpha builds once shipped to stable
 * (`.claude/feedback/feedback_channel_isolation_hard_guarantee.md`).
 */
describe("flag registry — defaults-off guarantee", () => {
  it("every registered flag defaults to off", () => {
    for (const [id, spec] of flagEntries()) {
      expect(spec.default, `flag "${id}" must default to false`).toBe(false);
    }
  });

  it("a fresh store enables nothing", () => {
    useFlagStore.setState({ enabled: [] });
    expect(useFlagStore.getState().enabled).toEqual([]);
    expect(useFlagStore.getState().anyEnabled()).toBe(false);
  });

  it("every flag carries the metadata the Labs panel and graduation need", () => {
    for (const [id, spec] of flagEntries()) {
      expect(spec.summary.length, `flag "${id}" needs a user-facing summary`).toBeGreaterThan(0);
      expect(["experimental", "beta"]).toContain(spec.stage);
      // The clock for the graduation review.
      expect(spec.introducedIn).toMatch(/^\d+\.\d+\.\d+/);
    }
  });
});

describe("flag store", () => {
  beforeEach(() => useFlagStore.setState({ enabled: [] }));

  it("toggles a flag on and off without duplicating it", () => {
    const id = "demo-flag" as FlagId;
    const { setEnabled } = useFlagStore.getState();
    setEnabled(id, true);
    setEnabled(id, true);
    expect(useFlagStore.getState().enabled).toEqual([id]);
    expect(isFlagEnabled(id)).toBe(true);

    setEnabled(id, false);
    expect(useFlagStore.getState().enabled).toEqual([]);
    expect(isFlagEnabled(id)).toBe(false);
  });

  it("anyEnabled drives the telemetry default", () => {
    expect(useFlagStore.getState().anyEnabled()).toBe(false);
    useFlagStore.getState().setEnabled("demo-flag" as FlagId, true);
    expect(useFlagStore.getState().anyEnabled()).toBe(true);
  });

  it("resetAll gives a user one way back", () => {
    useFlagStore.setState({ enabled: ["a", "b"] as FlagId[] });
    useFlagStore.getState().resetAll();
    expect(useFlagStore.getState().enabled).toEqual([]);
  });

  it("only stores enabled flags, so absence means off", () => {
    // The persisted shape must not carry `false` entries: ids come and go,
    // and a stale `false` would be indistinguishable from a removed flag.
    useFlagStore.getState().setEnabled("x" as FlagId, false);
    expect(useFlagStore.getState().enabled).toEqual([]);
  });
});

describe("registry membership", () => {
  it("rejects ids that are not registered", () => {
    expect(isKnownFlag("definitely-not-a-flag")).toBe(false);
  });

  it("accepts every registered id", () => {
    for (const id of flagIds()) expect(isKnownFlag(id)).toBe(true);
  });
});

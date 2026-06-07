/**
 * Unit tests for the usage-telemetry helper (`src/lib/telemetry.ts`).
 *
 * Covers: the `track()` no-op gate (off → no emit, on → emit with exact props),
 * that the payload sent is exactly the typed props (no PII appended), and the
 * `providerKind` low-cardinality mapping.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mutable state the mocked store returns; each test sets what it needs.
const mockState: { telemetryUsageEnabled: boolean | null; releaseChannel: "stable" | "alpha" } = {
  telemetryUsageEnabled: null,
  releaseChannel: "stable",
};

vi.mock("@/stores/settings-store", () => ({
  useSettingsStore: { getState: () => mockState },
  // Re-implement the real selector semantics so the gate is tested honestly.
  selectEffectiveTelemetryUsage: (s: typeof mockState) =>
    s.telemetryUsageEnabled ?? s.releaseChannel === "alpha",
}));

const trackEvent = vi.fn(async () => {});
vi.mock("@aptabase/tauri", () => ({ trackEvent: (...args: unknown[]) => trackEvent(...args) }));

import { track, providerKind } from "../telemetry";

beforeEach(() => {
  trackEvent.mockClear();
  mockState.telemetryUsageEnabled = null;
  mockState.releaseChannel = "stable";
});

describe("track() gating", () => {
  it("no-ops when usage is off (stable channel, no override)", () => {
    mockState.releaseChannel = "stable";
    mockState.telemetryUsageEnabled = null; // → effective false
    track("document_opened", { format: "md" });
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it("emits when usage is on via channel default (alpha)", () => {
    mockState.releaseChannel = "alpha";
    mockState.telemetryUsageEnabled = null; // → effective true
    track("document_opened", { format: "pdf" });
    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(trackEvent).toHaveBeenCalledWith("document_opened", { format: "pdf" });
  });

  it("emits when explicitly enabled even on stable", () => {
    mockState.releaseChannel = "stable";
    mockState.telemetryUsageEnabled = true; // explicit override wins
    track("ai_action_used", { action: "improve" });
    expect(trackEvent).toHaveBeenCalledWith("ai_action_used", { action: "improve" });
  });

  it("no-ops when explicitly disabled even on alpha", () => {
    mockState.releaseChannel = "alpha";
    mockState.telemetryUsageEnabled = false; // explicit override wins
    track("ai_action_used", { action: "expand" });
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it("sends exactly the typed props — nothing appended (no PII)", () => {
    mockState.telemetryUsageEnabled = true;
    track("ai_chat_sent", { path: "acp", provider_kind: "agent_managed" });
    const [, props] = trackEvent.mock.calls[0]!;
    expect(props).toEqual({ path: "acp", provider_kind: "agent_managed" });
    // Guard: no install id, no path, no content leaked into the payload.
    expect(Object.keys(props as object).sort()).toEqual(["path", "provider_kind"]);
  });

  it("never throws into the caller even if the SDK rejects", () => {
    mockState.telemetryUsageEnabled = true;
    trackEvent.mockImplementationOnce(() => {
      throw new Error("transport down");
    });
    expect(() => track("feature_used", { feature: "focus_mode" })).not.toThrow();
  });
});

describe("providerKind", () => {
  it("collapses every agent_managed provider to one kind", () => {
    expect(providerKind("claude", "agent_managed")).toBe("agent_managed");
    expect(providerKind("gemini", "agent_managed")).toBe("agent_managed");
  });

  it("maps local_bundled and local/ollama", () => {
    expect(providerKind("whatever", "local_bundled")).toBe("local_bundled");
    expect(providerKind("ollama", "local")).toBe("ollama");
    expect(providerKind("something", "local")).toBe("local");
  });

  it("maps api_key providers by provider name", () => {
    expect(providerKind("anthropic", "api_key")).toBe("anthropic");
    expect(providerKind("openai", "api_key")).toBe("openai");
    expect(providerKind("openai_compatible", "api_key")).toBe("openai_compatible");
  });

  it("falls back to a known kind for anything unrecognized", () => {
    expect(providerKind("mystery", "api_key")).toBe("local");
  });
});

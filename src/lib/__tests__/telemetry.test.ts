/**
 * Unit tests for the usage-telemetry helper (`src/lib/telemetry.ts`).
 *
 * Covers: the `track()` no-op gate (off → no emit, on → emit with exact props),
 * that the payload sent is exactly the typed props (no PII appended), and the
 * `providerKind` low-cardinality mapping.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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

// `track()` invokes the Rust `tauri-plugin-aptabase` command directly through
// the v2 IPC (`plugin:aptabase|track_event`), so the unit boundary is `invoke`.
const invoke = vi.fn(
  (_cmd: string, _args?: Record<string, unknown>): Promise<unknown> => Promise.resolve(),
);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invoke(cmd, args),
}));

// Mock the logger: track() now emits diagnostic logs (and the real logger would
// forward them via its own `invoke`, perturbing the assertions above). Spying
// also lets us assert the diagnostic behavior the user relies on.
const logMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({ log: logMock }));

import { track, trackSettingToggle, providerKind, coarseOs } from "../telemetry";

const TRACK_CMD = "plugin:aptabase|track_event";

beforeEach(() => {
  invoke.mockClear();
  logMock.debug.mockClear();
  logMock.info.mockClear();
  logMock.warn.mockClear();
  logMock.error.mockClear();
  mockState.telemetryUsageEnabled = null;
  mockState.releaseChannel = "stable";
});

// `track()` fires the invoke in a microtask, so flush the queue before asserting.
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe("track() gating", () => {
  it("no-ops when usage is off (stable channel, no override)", async () => {
    mockState.releaseChannel = "stable";
    mockState.telemetryUsageEnabled = null; // → effective false
    track("document_opened", { format: "md" });
    await flush();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("emits when usage is on via channel default (alpha)", async () => {
    mockState.releaseChannel = "alpha";
    mockState.telemetryUsageEnabled = null; // → effective true
    track("document_opened", { format: "pdf" });
    await flush();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith(TRACK_CMD, {
      name: "document_opened",
      props: { format: "pdf" },
    });
  });

  it("emits when explicitly enabled even on stable", async () => {
    mockState.releaseChannel = "stable";
    mockState.telemetryUsageEnabled = true; // explicit override wins
    track("ai_action_used", { action: "improve" });
    await flush();
    expect(invoke).toHaveBeenCalledWith(TRACK_CMD, {
      name: "ai_action_used",
      props: { action: "improve" },
    });
  });

  it("no-ops when explicitly disabled even on alpha", async () => {
    mockState.releaseChannel = "alpha";
    mockState.telemetryUsageEnabled = false; // explicit override wins
    track("ai_action_used", { action: "expand" });
    await flush();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("sends exactly the typed props — nothing appended (no PII)", async () => {
    mockState.telemetryUsageEnabled = true;
    track("ai_chat_sent", { path: "acp", provider_kind: "agent_managed" });
    await flush();
    const args = invoke.mock.calls[0]?.[1] as
      | { name: string; props: Record<string, string> }
      | undefined;
    expect(args?.name).toBe("ai_chat_sent");
    expect(args?.props).toEqual({ path: "acp", provider_kind: "agent_managed" });
    // Guard: no install id, no path, no content leaked into the payload.
    expect(Object.keys(args?.props ?? {}).sort()).toEqual(["path", "provider_kind"]);
  });

  it("ai_turn_ended carries only how the turn finished, never what it was doing", async () => {
    // The whole point of this event is field visibility into agents running out
    // of room. It must not become a channel for prompt or file content.
    mockState.telemetryUsageEnabled = true;
    track("ai_turn_ended", {
      path: "acp",
      provider_kind: "agent_managed",
      stop_reason: "max_tokens",
    });
    await flush();
    const args = invoke.mock.calls[0]?.[1] as
      | { name: string; props: Record<string, string> }
      | undefined;
    expect(args?.name).toBe("ai_turn_ended");
    expect(Object.keys(args?.props ?? {}).sort()).toEqual([
      "path",
      "provider_kind",
      "stop_reason",
    ]);
    expect(args?.props.stop_reason).toBe("max_tokens");
  });

  it("never throws into the caller even if the IPC rejects", async () => {
    mockState.telemetryUsageEnabled = true;
    invoke.mockImplementationOnce(() => Promise.reject(new Error("transport down")));
    expect(() => track("feature_used", { feature: "focus_mode" })).not.toThrow();
    await flush(); // the rejection is swallowed inside track's .catch
  });
});

describe("track() diagnostic logging", () => {
  it("logs a debug skip line when usage is off (no event name leaked beyond the enum)", async () => {
    mockState.telemetryUsageEnabled = false;
    track("document_opened", { format: "md" });
    await flush();
    expect(logMock.debug).toHaveBeenCalledWith(
      "telemetry",
      expect.stringContaining("document_opened"),
    );
    expect(logMock.info).not.toHaveBeenCalled();
  });

  it("logs an info line when an event is tracked", async () => {
    mockState.telemetryUsageEnabled = true;
    track("ai_chat_sent", { path: "acp", provider_kind: "agent_managed" });
    await flush();
    expect(logMock.info).toHaveBeenCalledWith(
      "telemetry",
      expect.stringContaining("ai_chat_sent"),
    );
  });

  it("logs a warn line when the IPC invoke rejects", async () => {
    mockState.telemetryUsageEnabled = true;
    invoke.mockImplementationOnce(() => Promise.reject(new Error("command not found")));
    track("feature_used", { feature: "focus_mode" });
    await flush();
    expect(logMock.warn).toHaveBeenCalledWith(
      "telemetry",
      expect.stringContaining("feature_used"),
      expect.anything(),
    );
  });
});

describe("block_inserted / setting_changed", () => {
  it("emits block_inserted with the kind", async () => {
    mockState.telemetryUsageEnabled = true;
    track("block_inserted", { kind: "drawing" });
    await flush();
    expect(invoke).toHaveBeenCalledWith(TRACK_CMD, {
      name: "block_inserted",
      props: { kind: "drawing" },
    });
  });

  it("trackSettingToggle maps true → on, false → off", async () => {
    mockState.telemetryUsageEnabled = true;
    trackSettingToggle("tool_calling", true);
    trackSettingToggle("print_layout", false);
    await flush();
    expect(invoke).toHaveBeenCalledWith(TRACK_CMD, {
      name: "setting_changed",
      props: { setting: "tool_calling", value: "on" },
    });
    expect(invoke).toHaveBeenCalledWith(TRACK_CMD, {
      name: "setting_changed",
      props: { setting: "print_layout", value: "off" },
    });
  });

  it("setting_changed carries enum values verbatim", async () => {
    mockState.telemetryUsageEnabled = true;
    track("setting_changed", { setting: "theme", value: "dark" });
    await flush();
    expect(invoke).toHaveBeenCalledWith(TRACK_CMD, {
      name: "setting_changed",
      props: { setting: "theme", value: "dark" },
    });
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

describe("coarseOs", () => {
  const stub = (userAgent: string, platform: string) =>
    vi.stubGlobal("navigator", { userAgent, platform } as Navigator);
  afterEach(() => vi.unstubAllGlobals());

  it("buckets the three desktop OSes and never returns a raw UA", () => {
    stub("Mozilla/5.0 (Macintosh; …)", "MacIntel");
    expect(coarseOs()).toBe("macos");
    stub("Mozilla/5.0 (Windows NT 10.0; …)", "Win32");
    expect(coarseOs()).toBe("windows");
    stub("Mozilla/5.0 (X11; Linux x86_64)", "Linux x86_64");
    expect(coarseOs()).toBe("linux");
  });

  it("falls back to 'other' for unknown/empty navigator", () => {
    stub("SomethingElse/1.0", "");
    expect(coarseOs()).toBe("other");
  });

  it("only ever returns one of the four closed buckets", () => {
    stub("Mozilla/5.0 (Macintosh)", "MacIntel");
    expect(["macos", "windows", "linux", "other"]).toContain(coarseOs());
  });
});

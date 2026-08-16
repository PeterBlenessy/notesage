// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import type { FlagId } from "@/lib/flags";

const tracked: Array<{ event: string; props: Record<string, unknown> }> = [];

import { useFlagStore, setFlagReporter } from "@/stores/flag-store";
import {
  useSettingsStore,
  selectEffectiveTelemetryUsage,
  selectEffectiveTelemetryCrash,
} from "@/stores/settings-store";

beforeEach(() => {
  tracked.length = 0;
  // The store REPORTS through an injected function rather than importing
  // `lib/telemetry` — that import would make telemetry reachable from the iOS
  // shell and break its telemetry-free guarantee. Desktop registers the real
  // reporter in `useAppLifecycle`; here we register a recorder.
  setFlagReporter((flag, enabled) =>
    tracked.push({ event: "labs_flag_changed", props: { flag, value: enabled ? "on" : "off" } }),
  );
  useFlagStore.setState({ enabled: [] });
  useSettingsStore.setState({ telemetryUsageEnabled: null, telemetryCrashEnabled: null });
});

/**
 * Peter's decision (2026-08-15): with a single binary, telemetry defaults on
 * once any Labs flag is enabled — enabling an experimental feature IS the
 * opt-in, replacing "you installed an alpha build".
 */
describe("telemetry default follows Labs", () => {
  it("is off while no experimental feature is enabled", () => {
    expect(selectEffectiveTelemetryUsage(useSettingsStore.getState())).toBe(false);
    expect(selectEffectiveTelemetryCrash(useSettingsStore.getState())).toBe(false);
  });

  it("turns on once any flag is enabled", () => {
    useFlagStore.getState().setEnabled("demo" as FlagId, true);
    expect(selectEffectiveTelemetryUsage(useSettingsStore.getState())).toBe(true);
    expect(selectEffectiveTelemetryCrash(useSettingsStore.getState())).toBe(true);
  });

  it("turns back off when the last flag is switched off", () => {
    useFlagStore.getState().setEnabled("demo" as FlagId, true);
    useFlagStore.getState().setEnabled("demo" as FlagId, false);
    expect(selectEffectiveTelemetryUsage(useSettingsStore.getState())).toBe(false);
  });

  it("an explicit user choice wins in BOTH directions", () => {
    // Off while Labs is on — the user opted out and that must stick, or the
    // Labs coupling becomes a way to silently re-enable collection.
    useFlagStore.getState().setEnabled("demo" as FlagId, true);
    useSettingsStore.setState({ telemetryUsageEnabled: false, telemetryCrashEnabled: false });
    expect(selectEffectiveTelemetryUsage(useSettingsStore.getState())).toBe(false);
    expect(selectEffectiveTelemetryCrash(useSettingsStore.getState())).toBe(false);

    // On while Labs is off.
    useFlagStore.setState({ enabled: [] });
    useSettingsStore.setState({ telemetryUsageEnabled: true, telemetryCrashEnabled: true });
    expect(selectEffectiveTelemetryUsage(useSettingsStore.getState())).toBe(true);
    expect(selectEffectiveTelemetryCrash(useSettingsStore.getState())).toBe(true);
  });
});

describe("graduation signal", () => {
  it("reports both directions — the OFF event is the valuable half", () => {
    const { setEnabled } = useFlagStore.getState();
    setEnabled("demo" as FlagId, true);
    setEnabled("demo" as FlagId, false);
    expect(tracked).toEqual([
      { event: "labs_flag_changed", props: { flag: "demo", value: "on" } },
      { event: "labs_flag_changed", props: { flag: "demo", value: "off" } },
    ]);
  });

  it("does not report a no-op toggle", () => {
    useFlagStore.getState().setEnabled("demo" as FlagId, true);
    tracked.length = 0;
    useFlagStore.getState().setEnabled("demo" as FlagId, true);
    expect(tracked).toEqual([]);
  });

  it("reports every flag individually on reset, not one collapsed event", () => {
    useFlagStore.setState({ enabled: ["a", "b"] as unknown as FlagId[] });
    tracked.length = 0;
    useFlagStore.getState().resetAll();
    expect(tracked.map((t) => t.props.flag)).toEqual(["a", "b"]);
    expect(tracked.every((t) => t.props.value === "off")).toBe(true);
  });
});

// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { renderWithProviders, screen } from "@/test/component-harness";
import { LabsSettings } from "@/components/settings/v2/LabsSettings";
import { useFlagStore } from "@/stores/flag-store";
import type { FlagId, FlagSpec } from "@/lib/flags";

// The live registry is empty between features, so the panel's behaviour is
// exercised against a stub. Testing against the real registry would make
// these tests pass or fail depending on what happens to be in flight.
const DEMO: Array<[string, FlagSpec]> = [
  {
    stage: "experimental",
    summary: "Relations panel",
    introducedIn: "0.49.0",
    default: false,
  },
  {
    stage: "beta",
    summary: "Inline translations",
    introducedIn: "0.49.0",
    default: false,
  },
].map((spec, i) => [`demo-${i}`, spec as FlagSpec]);

vi.mock("@/lib/flags", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/flags")>();
  return { ...actual, flagEntries: () => DEMO };
});

beforeEach(() => useFlagStore.setState({ enabled: [] }));

describe("Labs panel", () => {
  it("lists each flag with its stage and the version it arrived in", () => {
    renderWithProviders(<LabsSettings />);
    expect(screen.getByText("Relations panel")).toBeTruthy();
    expect(screen.getByText("experimental")).toBeTruthy();
    expect(screen.getByText("Inline translations")).toBeTruthy();
    expect(screen.getByText("beta")).toBeTruthy();
    expect(screen.getAllByText(/Added in 0\.49\.0/)).toHaveLength(2);
  });

  it("promises no reporting, because turning a flag on now reports nothing", () => {
    // This test used to assert the OPPOSITE: Labs had to disclose, before the
    // user acted, that enabling a feature also switched on usage and crash
    // reporting. That bargain is gone with the telemetry itself, so the copy
    // that sold it has to go too — stale consent language is worse than none,
    // because it describes collection the app no longer performs.
    renderWithProviders(<LabsSettings />);
    const intro = screen.getByText(/Features still being worked on/i);
    expect(intro.textContent).toMatch(/nothing is reported anywhere/i);
    expect(intro.textContent).not.toMatch(/crash reporting/i);
    expect(useFlagStore.getState().enabled).toEqual([]);
  });

  it("toggling a row enables exactly that flag", () => {
    renderWithProviders(<LabsSettings />);
    fireEvent.click(screen.getAllByRole("switch")[0]);
    expect(useFlagStore.getState().enabled).toEqual(["demo-0"]);
    fireEvent.click(screen.getAllByRole("switch")[0]);
    expect(useFlagStore.getState().enabled).toEqual([]);
  });

  it("offers the reset only once something is on, and it clears everything", () => {
    const { rerender } = renderWithProviders(<LabsSettings />);
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();

    useFlagStore.setState({ enabled: ["demo-0", "demo-1"] as unknown as FlagId[] });
    rerender(<LabsSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(useFlagStore.getState().enabled).toEqual([]);
  });
});

describe("Labs panel with an empty registry", () => {
  it("explains the empty state rather than showing a bare heading", async () => {
    vi.resetModules();
    vi.doMock("@/lib/flags", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/flags")>();
      return { ...actual, flagEntries: () => [] };
    });
    const { LabsSettings: Empty } = await import(
      "@/components/settings/v2/LabsSettings"
    );
    renderWithProviders(<Empty />);
    expect(screen.getByText(/Nothing experimental is in flight/i)).toBeTruthy();
    expect(screen.queryByRole("switch")).toBeNull();
  });
});

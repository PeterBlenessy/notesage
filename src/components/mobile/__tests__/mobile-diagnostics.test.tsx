// @vitest-environment jsdom
import "@/test/tauri-mock";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderWithProviders, waitFor } from "@/test/component-harness";

// MobileApp mounts the app-level Toaster; the shared sonner mock exposes only
// `toast`, so stub the UI component (irrelevant to these tests).
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));
import { log } from "@/lib/logger";
import { useMobileStore } from "@/stores/mobile-store";
import { MobileApp } from "@/MobileApp";

// matchMedia for ThemeProvider (MobileApp mounts it, unlike the Shell used in
// mobile-app.test.tsx).
beforeEach(() => {
  window.matchMedia = window.matchMedia ?? (((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia);
  useMobileStore.getState().reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("mobile on-device JS diagnostics (#587)", () => {
  it("logs unhandled window errors and promise rejections to the local logger", async () => {
    const errorSpy = vi.spyOn(log, "error").mockImplementation(() => {});
    renderWithProviders(<MobileApp />);

    window.dispatchEvent(
      new ErrorEvent("error", { message: "boom", filename: "app.js", lineno: 42 }),
    );
    await waitFor(() =>
      expect(errorSpy).toHaveBeenCalledWith(
        "mobile-js",
        expect.stringContaining("boom"),
      ),
    );

    // PromiseRejectionEvent isn't constructable in jsdom — a plain Event with
    // the field grafted on exercises the same listener path.
    const rejection = new Event("unhandledrejection") as Event & { reason?: unknown };
    rejection.reason = new Error("lost promise");
    window.dispatchEvent(rejection);
    await waitFor(() =>
      expect(errorSpy).toHaveBeenCalledWith(
        "mobile-js",
        expect.stringContaining("lost promise"),
      ),
    );
  });

  it("caps the diagnostics volume so an error loop cannot flood the log", async () => {
    const errorSpy = vi.spyOn(log, "error").mockImplementation(() => {});
    renderWithProviders(<MobileApp />);

    for (let i = 0; i < 120; i++) {
      window.dispatchEvent(new ErrorEvent("error", { message: `e${i}` }));
    }
    await waitFor(() => expect(errorSpy.mock.calls.length).toBeGreaterThan(0));
    expect(errorSpy.mock.calls.length).toBeLessThanOrEqual(50);
  });
});

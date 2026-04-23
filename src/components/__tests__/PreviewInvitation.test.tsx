// @vitest-environment jsdom

import "@/test/tauri-mock";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderWithProviders, screen, fireEvent } from "@/test/component-harness";
import { PreviewInvitation } from "@/components/PreviewInvitation";
import {
  useSettingsStore,
  PREVIEW_INVITATION_REAPPEAR_MS,
} from "@/stores/settings-store";

// ---------------------------------------------------------------------------
// Mock useReducedMotion — tests toggle this directly. Default false (no
// reduced-motion preference) so the entrance animation classes render.
// ---------------------------------------------------------------------------

const reducedMotionRef = { current: false };

vi.mock("@/hooks/useReducedMotion", () => ({
  useReducedMotion: () => reducedMotionRef.current,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetSettings(overrides: Partial<{
  uiPreview: "legacy" | "quiet-composer";
  previewInvitationShownAt: number | null;
  previewInvitationDismissedAt: number | null;
}> = {}) {
  useSettingsStore.setState({
    uiPreview: "legacy",
    previewInvitationShownAt: null,
    previewInvitationDismissedAt: null,
    ...overrides,
  });
}

beforeEach(() => {
  reducedMotionRef.current = false;
  resetSettings();
});

afterEach(() => {
  reducedMotionRef.current = false;
});

// ===========================================================================
// Visibility / gating
// ===========================================================================

describe("PreviewInvitation visibility", () => {
  it("renders when never shown and user is on legacy UI", () => {
    resetSettings({ uiPreview: "legacy", previewInvitationShownAt: null });

    renderWithProviders(<PreviewInvitation />);

    expect(screen.getByText(/Try the new UI/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Try it$/ })).toBeTruthy();
  });

  it("renders nothing when user is already on quiet-composer", () => {
    resetSettings({
      uiPreview: "quiet-composer",
      previewInvitationShownAt: null,
    });

    const { container } = renderWithProviders(<PreviewInvitation />);

    expect(container.querySelector("[data-preview-invitation]")).toBeNull();
  });

  it("does not render when shown < 30 days ago and previously dismissed", () => {
    const now = Date.now();
    resetSettings({
      previewInvitationShownAt: now - 1000,
      previewInvitationDismissedAt: now - 1000,
    });

    const { container } = renderWithProviders(<PreviewInvitation />);

    expect(container.querySelector("[data-preview-invitation]")).toBeNull();
  });

  it("re-appears once dismissed > 30 days ago", () => {
    const now = Date.now();
    const longAgo = now - PREVIEW_INVITATION_REAPPEAR_MS - 60_000;
    resetSettings({
      previewInvitationShownAt: longAgo,
      previewInvitationDismissedAt: longAgo,
    });

    renderWithProviders(<PreviewInvitation />);

    expect(screen.getByRole("button", { name: /^Try it$/ })).toBeTruthy();
  });

  it("keeps showing when previously shown but never dismissed", () => {
    const now = Date.now();
    resetSettings({
      previewInvitationShownAt: now - 1000,
      previewInvitationDismissedAt: null,
    });

    renderWithProviders(<PreviewInvitation />);

    expect(screen.getByRole("button", { name: /^Try it$/ })).toBeTruthy();
  });
});

// ===========================================================================
// Side effects on mount
// ===========================================================================

describe("PreviewInvitation marks shown on first appearance", () => {
  it("calls markPreviewInvitationShown when shownAt is null and the banner mounts visible", () => {
    resetSettings({ previewInvitationShownAt: null });
    renderWithProviders(<PreviewInvitation />);

    const next = useSettingsStore.getState().previewInvitationShownAt;
    expect(typeof next).toBe("number");
    expect(next).toBeGreaterThan(0);
  });

  it("does NOT update shownAt when the banner is hidden (already on quiet-composer)", () => {
    resetSettings({
      uiPreview: "quiet-composer",
      previewInvitationShownAt: null,
    });
    renderWithProviders(<PreviewInvitation />);

    expect(useSettingsStore.getState().previewInvitationShownAt).toBeNull();
  });

  it("does NOT clobber shownAt when already set", () => {
    const original = Date.now() - 5_000;
    resetSettings({
      previewInvitationShownAt: original,
      previewInvitationDismissedAt: null,
    });

    renderWithProviders(<PreviewInvitation />);

    // Banner re-mounts but shownAt should remain at its original value because
    // the marker only fires when shownAt is null.
    expect(useSettingsStore.getState().previewInvitationShownAt).toBe(original);
  });
});

// ===========================================================================
// Try-it button
// ===========================================================================

describe("PreviewInvitation Try it action", () => {
  it("flips uiPreview to quiet-composer and hides the banner", () => {
    resetSettings({ uiPreview: "legacy" });

    renderWithProviders(<PreviewInvitation />);

    fireEvent.click(screen.getByRole("button", { name: /^Try it$/ }));

    expect(useSettingsStore.getState().uiPreview).toBe("quiet-composer");
    expect(document.querySelector("[data-preview-invitation]")).toBeNull();
  });
});

// ===========================================================================
// Dismiss button
// ===========================================================================

describe("PreviewInvitation dismiss action", () => {
  it("sets previewInvitationDismissedAt and hides the banner", () => {
    resetSettings({ uiPreview: "legacy" });
    renderWithProviders(<PreviewInvitation />);

    const before = useSettingsStore.getState().previewInvitationDismissedAt;
    expect(before).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: /Dismiss preview invitation/i }),
    );

    const after = useSettingsStore.getState().previewInvitationDismissedAt;
    expect(typeof after).toBe("number");
    expect(after).toBeGreaterThan(0);
    expect(document.querySelector("[data-preview-invitation]")).toBeNull();
  });

  it("dismiss button has an aria-label", () => {
    resetSettings();
    renderWithProviders(<PreviewInvitation />);

    const btn = screen.getByRole("button", {
      name: /Dismiss preview invitation/i,
    });
    expect(btn.getAttribute("aria-label")).toBe("Dismiss preview invitation");
  });

  it("does not flip uiPreview when dismissed", () => {
    resetSettings({ uiPreview: "legacy" });
    renderWithProviders(<PreviewInvitation />);

    fireEvent.click(
      screen.getByRole("button", { name: /Dismiss preview invitation/i }),
    );

    expect(useSettingsStore.getState().uiPreview).toBe("legacy");
  });
});

// ===========================================================================
// Reduced motion
// ===========================================================================

describe("PreviewInvitation reduced motion", () => {
  it("includes animation classes when reduced motion is OFF", () => {
    reducedMotionRef.current = false;
    resetSettings();

    renderWithProviders(<PreviewInvitation />);

    const root = document.querySelector("[data-preview-invitation]");
    expect(root).toBeTruthy();
    expect(root!.className).toContain("animate-in");
    expect(root!.className).toContain("slide-in-from-bottom-2");
  });

  it("omits animation classes when reduced motion is ON", () => {
    reducedMotionRef.current = true;
    resetSettings();

    renderWithProviders(<PreviewInvitation />);

    const root = document.querySelector("[data-preview-invitation]");
    expect(root).toBeTruthy();
    expect(root!.className).not.toContain("animate-in");
    expect(root!.className).not.toContain("slide-in-from-bottom-2");
  });
});

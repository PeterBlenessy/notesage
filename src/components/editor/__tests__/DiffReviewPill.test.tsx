// @vitest-environment jsdom

import "@/test/tauri-mock";
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen } from "@/test/component-harness";
import userEvent from "@testing-library/user-event";
import { DiffReviewPill } from "../DiffReviewPill";

/**
 * Branch-diff-review re-wire — the persistent in-editor affordance shown
 * while a review session is active.
 */

describe("DiffReviewPill", () => {
  it("announces the branch under review", () => {
    renderWithProviders(
      <DiffReviewPill
        compareBranch="feature/x"
        onAcceptAll={() => {}}
        onEnd={() => {}}
      />,
    );
    expect(
      screen.getByLabelText("Reviewing branch feature/x"),
    ).toBeTruthy();
    expect(screen.getByText("feature/x")).toBeTruthy();
  });

  it("routes Accept all to the handler", async () => {
    const onAcceptAll = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <DiffReviewPill
        compareBranch="feature/x"
        onAcceptAll={onAcceptAll}
        onEnd={() => {}}
      />,
    );
    await user.click(screen.getByText("Accept all"));
    expect(onAcceptAll).toHaveBeenCalledTimes(1);
  });

  it("routes End branch review to the handler", async () => {
    const onEnd = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <DiffReviewPill
        compareBranch="feature/x"
        onAcceptAll={() => {}}
        onEnd={onEnd}
      />,
    );
    await user.click(screen.getByLabelText("End branch review"));
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});

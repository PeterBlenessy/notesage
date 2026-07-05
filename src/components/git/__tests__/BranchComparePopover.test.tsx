// @vitest-environment jsdom

// cmdk (Command) observes its list size via ResizeObserver and scrolls the
// selected item into view — neither exists in jsdom. Polyfill both.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = () => {};
}

import "@/test/tauri-mock";
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  renderWithProviders,
  screen,
  waitFor,
  setMockInvokeHandler,
  clearMockInvokeHandlers,
} from "@/test/component-harness";
import userEvent from "@testing-library/user-event";
import { BranchComparePopover } from "../BranchComparePopover";
import { useDiffReviewStore } from "@/stores/diff-review-store";
import { useGitStore } from "@/stores/git-store";

/**
 * Branch-diff-review re-wire — the sidebar branch picker. Verifies the
 * picker lists local branches minus the checked-out one and that selecting
 * a branch calls `startReview(repoPath, currentBranch, selectedBranch)`
 * (current branch = BASE, picked branch = COMPARE) against the real store
 * with mocked git IPC.
 */

function resetStores() {
  useGitStore.setState({ repos: {} });
  useDiffReviewStore.setState({
    compareBranch: null,
    baseBranch: null,
    changedFiles: [],
    reviewActive: false,
    isLoading: false,
    error: null,
  });
}

describe("BranchComparePopover", () => {
  beforeEach(() => {
    resetStores();
    clearMockInvokeHandlers();
    setMockInvokeHandler("git_branch_list", () => [
      "feature/x",
      "main",
      "release",
    ]);
    setMockInvokeHandler("git_branch_current", () => "main");
    setMockInvokeHandler("git_diff_files", () => ["notes/a.md"]);
    setMockInvokeHandler("git_diff_file", () => [
      {
        old_start: 1,
        old_lines: 1,
        new_start: 1,
        new_lines: 1,
        delete_text: "old",
        insert_text: "new",
      },
    ]);
  });

  it("lists local branches minus the current branch", async () => {
    renderWithProviders(
      <BranchComparePopover repoPath="/repo" open onOpenChange={() => {}}>
        <div>row</div>
      </BranchComparePopover>,
    );

    await waitFor(() => {
      expect(screen.getByText("feature/x")).toBeTruthy();
    });
    expect(screen.getByText("release")).toBeTruthy();
    // Checked-out branch is excluded — comparing a branch to itself is a
    // no-op.
    expect(screen.queryByText("main")).toBeNull();
  });

  it("prefers the git-store branch over a fresh git_branch_current fetch", async () => {
    const branchCurrentSpy = vi.fn(() => "main");
    setMockInvokeHandler("git_branch_current", branchCurrentSpy);
    useGitStore.getState().setIsGitRepo("/repo", true);
    useGitStore.getState().setCurrentBranch("/repo", "release");

    renderWithProviders(
      <BranchComparePopover repoPath="/repo" open onOpenChange={() => {}}>
        <div>row</div>
      </BranchComparePopover>,
    );

    await waitFor(() => {
      expect(screen.getByText("main")).toBeTruthy();
    });
    // Stored branch (release) is the excluded one; no IPC fetch happened.
    expect(screen.queryByText("release")).toBeNull();
    expect(branchCurrentSpy).not.toHaveBeenCalled();
  });

  it("selecting a branch starts a review with (repoPath, currentBranch, selectedBranch)", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    renderWithProviders(
      <BranchComparePopover repoPath="/repo" open onOpenChange={onOpenChange}>
        <div>row</div>
      </BranchComparePopover>,
    );

    await waitFor(() => {
      expect(screen.getByText("feature/x")).toBeTruthy();
    });
    await user.click(screen.getByText("feature/x"));

    // Picker closes immediately…
    expect(onOpenChange).toHaveBeenCalledWith(false);

    // …and the review loads via the real store against the mocked git IPC.
    await waitFor(() => {
      const state = useDiffReviewStore.getState();
      expect(state.reviewActive).toBe(true);
      expect(state.baseBranch).toBe("main");
      expect(state.compareBranch).toBe("feature/x");
      expect(state.changedFiles).toHaveLength(1);
      expect(state.changedFiles[0].filePath).toBe("notes/a.md");
    });
  });

  it("shows the empty state when the repo has no other branches", async () => {
    setMockInvokeHandler("git_branch_list", () => ["main"]);

    renderWithProviders(
      <BranchComparePopover repoPath="/repo" open onOpenChange={() => {}}>
        <div>row</div>
      </BranchComparePopover>,
    );

    await waitFor(() => {
      expect(screen.getByText("No other branches")).toBeTruthy();
    });
  });
});

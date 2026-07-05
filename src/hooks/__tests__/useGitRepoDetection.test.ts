/**
 * Tests for the git repo detection that populates git-store for sidebar
 * roots (branch-diff-review re-wire). Covers: population of isGitRepo +
 * status + branch, once-per-session probe dedup, non-repo handling, and
 * retry-after-failure.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const mockGitIsRepo = vi.fn();
const mockGitStatus = vi.fn();
const mockGitBranchCurrent = vi.fn();

vi.mock("@/lib/tauri", () => ({
  tauriApi: {
    gitIsRepo: (...args: unknown[]) => mockGitIsRepo(...args),
    gitStatus: (...args: unknown[]) => mockGitStatus(...args),
    gitBranchCurrent: (...args: unknown[]) => mockGitBranchCurrent(...args),
  },
}));

import {
  detectGitRepoRoots,
  __resetGitRepoDetectionForTests,
} from "../useGitRepoDetection";
import { useGitStore } from "@/stores/git-store";

describe("detectGitRepoRoots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetGitRepoDetectionForTests();
    useGitStore.setState({ repos: {} });
    mockGitIsRepo.mockResolvedValue(false);
    mockGitStatus.mockResolvedValue([]);
    mockGitBranchCurrent.mockResolvedValue("main");
  });

  it("registers a repo root with status and current branch", async () => {
    mockGitIsRepo.mockResolvedValue(true);
    mockGitStatus.mockResolvedValue([
      { path: "/p/a.md", status: "modified", staged: false },
    ]);
    mockGitBranchCurrent.mockResolvedValue("feature/x");

    await detectGitRepoRoots(["/p"]);

    const repo = useGitStore.getState().repos["/p"];
    expect(repo.isGitRepo).toBe(true);
    expect(repo.currentBranch).toBe("feature/x");
    expect(repo.fileStatuses).toHaveLength(1);
    expect(repo.fileStatusMap.has("/p/a.md")).toBe(true);
  });

  it("registers non-repo roots as isGitRepo=false without fetching status", async () => {
    mockGitIsRepo.mockResolvedValue(false);

    await detectGitRepoRoots(["/not-a-repo"]);

    expect(useGitStore.getState().repos["/not-a-repo"].isGitRepo).toBe(false);
    expect(mockGitStatus).not.toHaveBeenCalled();
    expect(mockGitBranchCurrent).not.toHaveBeenCalled();
  });

  it("probes each root only once per session", async () => {
    mockGitIsRepo.mockResolvedValue(true);

    await detectGitRepoRoots(["/p"]);
    await detectGitRepoRoots(["/p"]);
    await detectGitRepoRoots(["/p", "/q"]);

    expect(mockGitIsRepo).toHaveBeenCalledTimes(2);
    expect(mockGitIsRepo).toHaveBeenCalledWith("/p");
    expect(mockGitIsRepo).toHaveBeenCalledWith("/q");
  });

  it("allows a retry after a failed probe", async () => {
    mockGitIsRepo.mockRejectedValueOnce(new Error("boom"));
    mockGitIsRepo.mockResolvedValue(true);

    await detectGitRepoRoots(["/p"]);
    expect(useGitStore.getState().repos["/p"]).toBeUndefined();

    await detectGitRepoRoots(["/p"]);
    expect(useGitStore.getState().repos["/p"].isGitRepo).toBe(true);
  });

  it("ignores empty root paths", async () => {
    await detectGitRepoRoots([""]);
    expect(mockGitIsRepo).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- store mocks — use vi.hoisted so variables are available inside vi.mock factories ---
const { mockEditorGetState, mockWorkspaceGetState } = vi.hoisted(() => ({
  mockEditorGetState: vi.fn(),
  mockWorkspaceGetState: vi.fn(),
}));

vi.mock("@/stores/editor-store", () => ({
  useEditorStore: { getState: mockEditorGetState },
}));

vi.mock("@/stores/workspace-store", () => ({
  useWorkspaceStore: { getState: mockWorkspaceGetState },
}));

// --- infrastructure mocks ---
vi.mock("@/lib/tauri", () => ({
  tauriApi: {
    readFile: vi.fn(),
  },
}));

vi.mock("@/lib/markdown-worker", () => ({
  parseInWorker: vi.fn(),
}));

vi.mock("@/lib/frontmatter", () => ({
  parseFrontmatter: vi.fn((raw: string) => ({ content: raw, frontmatter: null })),
}));

// Import AFTER mocks are registered
import { getPrewarmCandidates, prewarmParseCache } from "@/lib/prewarm-parse-cache";
import { tauriApi } from "@/lib/tauri";
import { parseInWorker } from "@/lib/markdown-worker";
import { parsedDocCache } from "@/lib/parsed-doc-cache";

const mockReadFile = vi.mocked(tauriApi.readFile);
const mockParseInWorker = vi.mocked(parseInWorker);

// Minimal ParseResult fixture
function makeResult(path: string) {
  return {
    type: "result" as const,
    id: path,
    doc: { type: "doc", content: [] },
    annotationsEntries: [] as Array<[number, string]>,
    nodeIdsEntries: [] as Array<[number, string]>,
    tableMetadataEntries: [] as Array<[number, Array<[number, { colType?: string; colCurrency?: string; colAggregation?: string }]>]>,
    timings: { preprocess: 0, parse: 0, total: 0 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  parsedDocCache.clear();

  mockEditorGetState.mockReturnValue({ recentFiles: [] });
  mockWorkspaceGetState.mockReturnValue({ pinnedFiles: [], projects: [] });
  mockReadFile.mockResolvedValue("# content");
  mockParseInWorker.mockImplementation((md, root) =>
    Promise.resolve(makeResult(`${root ?? ""}/${md}`))
  );
});

afterEach(() => {
  parsedDocCache.clear();
});

// ---------------------------------------------------------------------------
// getPrewarmCandidates
// ---------------------------------------------------------------------------

describe("getPrewarmCandidates", () => {
  it("returns recent .md files (up to 5)", () => {
    mockEditorGetState.mockReturnValue({
      recentFiles: [
        { path: "/p/a.md", name: "a.md" },
        { path: "/p/b.md", name: "b.md" },
      ],
    });
    mockWorkspaceGetState.mockReturnValue({ pinnedFiles: [], projects: [] });

    const result = getPrewarmCandidates();
    expect(result).toContain("/p/a.md");
    expect(result).toContain("/p/b.md");
  });

  it("includes pinned .md files", () => {
    mockEditorGetState.mockReturnValue({ recentFiles: [] });
    mockWorkspaceGetState.mockReturnValue({
      pinnedFiles: ["/p/pinned.md"],
      projects: [],
    });

    const result = getPrewarmCandidates();
    expect(result).toContain("/p/pinned.md");
  });

  it("deduplicates files that are both recent and pinned, keeping them once", () => {
    mockEditorGetState.mockReturnValue({
      recentFiles: [{ path: "/p/both.md", name: "both.md" }],
    });
    mockWorkspaceGetState.mockReturnValue({
      pinnedFiles: ["/p/both.md"],
      projects: [],
    });

    const result = getPrewarmCandidates();
    const count = result.filter((p) => p === "/p/both.md").length;
    expect(count).toBe(1);
  });

  it("places recent files before pinned-only files", () => {
    mockEditorGetState.mockReturnValue({
      recentFiles: [{ path: "/p/recent.md", name: "recent.md" }],
    });
    mockWorkspaceGetState.mockReturnValue({
      pinnedFiles: ["/p/pinned-only.md"],
      projects: [],
    });

    const result = getPrewarmCandidates();
    expect(result.indexOf("/p/recent.md")).toBeLessThan(
      result.indexOf("/p/pinned-only.md")
    );
  });

  it("excludes non-.md files from recent list", () => {
    mockEditorGetState.mockReturnValue({
      recentFiles: [
        { path: "/p/note.md", name: "note.md" },
        { path: "/p/image.png", name: "image.png" },
        { path: "/p/data.json", name: "data.json" },
      ],
    });
    mockWorkspaceGetState.mockReturnValue({ pinnedFiles: [], projects: [] });

    const result = getPrewarmCandidates();
    expect(result).toContain("/p/note.md");
    expect(result).not.toContain("/p/image.png");
    expect(result).not.toContain("/p/data.json");
  });

  it("excludes non-.md files from pinned list", () => {
    mockEditorGetState.mockReturnValue({ recentFiles: [] });
    mockWorkspaceGetState.mockReturnValue({
      pinnedFiles: ["/p/note.md", "/p/doc.pdf"],
      projects: [],
    });

    const result = getPrewarmCandidates();
    expect(result).toContain("/p/note.md");
    expect(result).not.toContain("/p/doc.pdf");
  });

  it("returns at most 5 recent entries even when more exist", () => {
    mockEditorGetState.mockReturnValue({
      recentFiles: [
        { path: "/p/1.md", name: "1.md" },
        { path: "/p/2.md", name: "2.md" },
        { path: "/p/3.md", name: "3.md" },
        { path: "/p/4.md", name: "4.md" },
        { path: "/p/5.md", name: "5.md" },
        { path: "/p/6.md", name: "6.md" },
      ],
    });
    mockWorkspaceGetState.mockReturnValue({ pinnedFiles: [], projects: [] });

    const result = getPrewarmCandidates();
    const recentInResult = result.filter((p) => p.startsWith("/p/"));
    expect(recentInResult.length).toBeLessThanOrEqual(5);
  });

  it("returns empty array when there are no recent or pinned .md files", () => {
    mockEditorGetState.mockReturnValue({ recentFiles: [] });
    mockWorkspaceGetState.mockReturnValue({ pinnedFiles: [], projects: [] });

    expect(getPrewarmCandidates()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// prewarmParseCache — concurrency
// ---------------------------------------------------------------------------

describe("prewarmParseCache", () => {
  it("resolves without throwing for an empty candidate list", async () => {
    await expect(prewarmParseCache([])).resolves.toBeUndefined();
  });

  it("populates the cache for each resolved file", async () => {
    const paths = ["/p/a.md", "/p/b.md"];
    mockReadFile.mockResolvedValue("# body");
    mockParseInWorker.mockImplementation(() =>
      Promise.resolve(makeResult(paths[0]))
    );

    await prewarmParseCache(paths);

    for (const p of paths) {
      expect(parsedDocCache.has(p)).toBe(true);
    }
  });

  it("never runs more than 2 worker parses concurrently", async () => {
    const paths = ["/p/1.md", "/p/2.md", "/p/3.md", "/p/4.md", "/p/5.md"];
    let currentConcurrent = 0;
    let maxConcurrent = 0;

    // Resolvers kept so we can unblock parses one-by-one
    const resolvers: Array<() => void> = [];

    mockReadFile.mockResolvedValue("# body");
    mockParseInWorker.mockImplementation(() =>
      new Promise<ReturnType<typeof makeResult>>((resolve) => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        resolvers.push(() => {
          currentConcurrent--;
          resolve(makeResult("file"));
        });
      })
    );

    const prewarmPromise = prewarmParseCache(paths);

    // Drain the microtask queue so the first batch of workers starts
    await Promise.resolve();
    await Promise.resolve();

    // Unblock workers one at a time, checking the in-flight count never exceeds 2
    while (resolvers.length > 0) {
      expect(maxConcurrent).toBeLessThanOrEqual(2);
      resolvers.shift()!();
      await Promise.resolve();
      await Promise.resolve();
    }

    await prewarmPromise;
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it("skips files already in the cache", async () => {
    const path = "/p/already.md";
    parsedDocCache.set(path, makeResult(path));

    await prewarmParseCache([path]);

    expect(mockReadFile).not.toHaveBeenCalledWith(path);
    expect(mockParseInWorker).not.toHaveBeenCalled();
  });

  it("does not reject when readFile fails for one file", async () => {
    mockReadFile.mockRejectedValueOnce(new Error("file not found"));
    mockReadFile.mockResolvedValue("# ok");
    mockParseInWorker.mockResolvedValue(makeResult("/p/b.md"));

    await expect(prewarmParseCache(["/p/missing.md", "/p/b.md"])).resolves.toBeUndefined();
  });

  it("does not reject when parseInWorker fails for one file", async () => {
    mockReadFile.mockResolvedValue("# body");
    mockParseInWorker
      .mockRejectedValueOnce(new Error("worker crashed"))
      .mockResolvedValue(makeResult("/p/b.md"));

    await expect(prewarmParseCache(["/p/crash.md", "/p/b.md"])).resolves.toBeUndefined();
  });
});

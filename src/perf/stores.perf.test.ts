/**
 * Performance benchmarks for Zustand store operations and command palette filtering.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from "vitest";
import { benchmark } from "./harness";
import { useEditorStore } from "@/stores/editor-store";
import type { Tab } from "@/stores/editor-store";

interface FileEntry {
  name: string;
  path: string;
  is_directory: boolean;
  children?: FileEntry[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create N tabs and populate the editor store. Returns the tab IDs. */
function populateStore(count: number): string[] {
  const store = useEditorStore;
  // Reset to empty state
  store.setState({ tabs: [], activeTabId: null, recentFiles: [], persistedTabs: [] });

  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = `tab-${i}`;
    const tab: Tab = {
      id,
      filePath: `/project/notes/note-${i}.md`,
      fileName: `note-${i}.md`,
      isDirty: false,
      content: `# Note ${i}\n\nSome content for note number ${i}.`,
      frontmatter: null,
      fileType: "markdown",
      contentLoaded: true,
    };
    ids.push(id);
    // Build tabs array directly for speed — avoids N individual set() calls
    store.setState((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: id,
    }));
  }
  return ids;
}

/** Generate a flat array of FileEntry objects simulating list_directory results. */
function generateFileEntries(count: number): FileEntry[] {
  const entries: FileEntry[] = [];
  const dirs = ["src", "docs", "tests", "lib", "components", "hooks", "stores", "utils", "config", "assets"];
  const exts = [".md", ".ts", ".tsx", ".json", ".css", ".yml"];

  for (let i = 0; i < count; i++) {
    const dir = dirs[i % dirs.length];
    const ext = exts[i % exts.length];
    entries.push({
      name: `file-${i}${ext}`,
      path: `/project/${dir}/file-${i}${ext}`,
      is_directory: false,
    });
  }
  return entries;
}

/** Flatten a nested FileEntry tree into a flat array (simulates tree → list processing). */
function flattenEntries(entries: FileEntry[]): FileEntry[] {
  const result: FileEntry[] = [];
  const stack = [...entries];
  while (stack.length > 0) {
    const entry = stack.pop()!;
    result.push(entry);
    if (entry.children) {
      for (const child of entry.children) {
        stack.push(child);
      }
    }
  }
  return result;
}

/** Build a nested tree from flat entries (simulates list processing). */
function buildTree(flatEntries: FileEntry[]): FileEntry[] {
  const root: FileEntry[] = [];
  const dirMap = new Map<string, FileEntry>();

  for (const entry of flatEntries) {
    const parts = entry.path.split("/").filter(Boolean);
    const parentPath = "/" + parts.slice(0, -1).join("/");

    if (entry.is_directory) {
      const dirEntry: FileEntry = { ...entry, children: [] };
      dirMap.set(entry.path, dirEntry);
      const parent = dirMap.get(parentPath);
      if (parent && parent.children) {
        parent.children.push(dirEntry);
      } else {
        root.push(dirEntry);
      }
    } else {
      const parent = dirMap.get(parentPath);
      if (parent && parent.children) {
        parent.children.push(entry);
      } else {
        root.push(entry);
      }
    }
  }

  return root;
}

/** Generate entries with a realistic nested directory structure. */
function generateNestedEntries(fileCount: number): FileEntry[] {
  const entries: FileEntry[] = [];
  const dirs = ["src", "docs", "tests", "lib", "components", "hooks", "stores"];
  const exts = [".md", ".ts", ".tsx", ".json", ".css"];

  // Create directory entries
  entries.push({ name: "project", path: "/project", is_directory: true });
  for (const dir of dirs) {
    entries.push({ name: dir, path: `/project/${dir}`, is_directory: true });
  }

  // Create file entries distributed across directories
  for (let i = 0; i < fileCount; i++) {
    const dir = dirs[i % dirs.length];
    const ext = exts[i % exts.length];
    entries.push({
      name: `file-${i}${ext}`,
      path: `/project/${dir}/file-${i}${ext}`,
      is_directory: false,
    });
  }

  return entries;
}

/** Simulate command palette filtering: substring match on filename, case-insensitive. */
function filterEntries(entries: FileEntry[], query: string): FileEntry[] {
  const lowerQuery = query.toLowerCase();
  return entries.filter((entry) => {
    if (entry.is_directory) return false;
    return entry.name.toLowerCase().includes(lowerQuery);
  });
}

// ---------------------------------------------------------------------------
// (a) editor-store.updateTabContent() with varying tab counts
// ---------------------------------------------------------------------------

describe("editor-store updateTabContent", () => {
  for (const tabCount of [10, 50, 100]) {
    it(`updateTabContent with ${tabCount} tabs completes within budget`, async () => {
      const ids = populateStore(tabCount);
      const targetId = ids[Math.floor(tabCount / 2)]; // update a tab in the middle

      const result = await benchmark(
        `updateTabContent (${tabCount} tabs)`,
        () => {
          useEditorStore.getState().updateTabContent(
            targetId,
            `# Updated\n\nNew content at ${Date.now()}`,
            true
          );
        },
        5,
        10
      );

      expect(result.passed).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// (b) Workspace listDirectory result processing
// ---------------------------------------------------------------------------

describe("workspace listDirectory processing", () => {
  for (const fileCount of [100, 500, 1000]) {
    it(`process ${fileCount} file entries within budget`, async () => {
      const nested = generateNestedEntries(fileCount);

      const result = await benchmark(
        `listDirectory processing (${fileCount} entries)`,
        () => {
          // Simulate the two main operations done on list_directory results:
          // 1. Build a tree structure from flat entries
          const tree = buildTree(nested);
          // 2. Flatten it back for search/filtering
          const flat = flattenEntries(tree);
          // 3. Sort by name (common operation in sidebar)
          flat.sort((a, b) => a.name.localeCompare(b.name));
        },
        10,
        10
      );

      expect(result.passed).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// (c) Command palette filtering with 500 entries
// ---------------------------------------------------------------------------

describe("command palette filtering", () => {
  it("filter 500 entries with 3-char query within budget", async () => {
    const entries = generateFileEntries(500);

    const result = await benchmark(
      "command palette filter (500 entries, 3-char query)",
      () => {
        // Simulate typical command palette usage: type "fil" to filter
        const matches = filterEntries(entries, "fil");
        // Access results to prevent dead-code elimination
        if (matches.length < 0) throw new Error("unreachable");
      },
      20,
      10
    );

    expect(result.passed).toBe(true);
  });

  it("filter 500 entries with varying queries within budget", async () => {
    const entries = generateFileEntries(500);
    const queries = ["not", "tes", "com", "doc", "fil", "css", "tsx", "json"];

    const result = await benchmark(
      "command palette filter (500 entries, 8 queries)",
      () => {
        for (const query of queries) {
          const matches = filterEntries(entries, query);
          if (matches.length < 0) throw new Error("unreachable");
        }
      },
      20,
      10
    );

    expect(result.passed).toBe(true);
  });
});

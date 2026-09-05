// @vitest-environment jsdom
import "@/test/tauri-mock";
import { describe, it, expect, beforeEach } from "vitest";
import { setMockInvokeHandler } from "@/test/tauri-mock";
import { clearFolderAppearanceCache, folderAppearanceFor, folderAppearanceReadsInFlight } from "@/lib/folder-appearance-cache";

describe("folder-appearance-cache (the Mac's folder icon and colour, on the phone)", () => {
  let reads: string[];
  beforeEach(() => {
    clearFolderAppearanceCache();
    reads = [];
    setMockInvokeHandler("ios_read_file", (args) => {
      const rel = (args as { relPath: string }).relPath;
      reads.push(rel);
      if (rel === "Ideas/.notesage/project.json") return JSON.stringify({ version: 1, appearance: { iconName: "Star", colorIndex: 5 } });
      if (rel === "Odd/.notesage/project.json") return JSON.stringify({ appearance: { iconName: 7, colorIndex: 42 } });
      if (rel === "Broken/.notesage/project.json") return "{ not json";
      throw new Error("not found");
    });
  });

  it("reads the project file once per folder version and returns its appearance", async () => {
    expect(await folderAppearanceFor("Ideas", 10)).toEqual({ iconName: "Star", colorIndex: 5 });
    expect(await folderAppearanceFor("Ideas", 10)).toEqual({ iconName: "Star", colorIndex: 5 });
    expect(reads).toEqual(["Ideas/.notesage/project.json"]);
    // A change on the Mac moves the folder's mtime: read again.
    await folderAppearanceFor("Ideas", 11);
    expect(reads).toHaveLength(2);
  });

  it("is null, and cached, for a plain folder, a broken file, or junk values", async () => {
    expect(await folderAppearanceFor("Plain", 1)).toBeNull();
    expect(await folderAppearanceFor("Plain", 1)).toBeNull();
    expect(await folderAppearanceFor("Broken", 1)).toBeNull();
    expect(await folderAppearanceFor("Odd", 1)).toBeNull();
    expect(reads.filter((r) => r.startsWith("Plain"))).toHaveLength(1);
  });

  it("reads at most four folders at a time — fifty rows mounting is not fifty concurrent reads", async () => {
    const resolvers: Array<(v: string) => void> = [];
    setMockInvokeHandler("ios_read_file", () => new Promise<string>((resolve) => resolvers.push(resolve)));
    const all = Array.from({ length: 12 }, (_, i) => folderAppearanceFor(`F${i}`, 1));
    await new Promise((r) => setTimeout(r, 0));
    expect(resolvers).toHaveLength(4);
    expect(folderAppearanceReadsInFlight()).toBe(4);
    resolvers.splice(0, 4).forEach((r) => r("{}"));
    await new Promise((r) => setTimeout(r, 0));
    expect(resolvers).toHaveLength(4); // the next four started, no more
    resolvers.splice(0).forEach((r) => r("{}"));
    await new Promise((r) => setTimeout(r, 0));
    resolvers.splice(0).forEach((r) => r("{}"));
    await Promise.all(all);
    expect(folderAppearanceReadsInFlight()).toBe(0);
  });

  it("keeps at most 500 folder versions, dropping the oldest", async () => {
    for (let i = 0; i < 505; i++) await folderAppearanceFor(`P${i}`, 1);
    reads.length = 0;
    await folderAppearanceFor("P0", 1); // evicted: read again
    await folderAppearanceFor("P504", 1); // kept: from the cache
    expect(reads).toEqual(["P0/.notesage/project.json"]);
  });
});

import { describe, it, expect, vi } from "vitest";
import {
  dedupeName,
  oldRootIsEmpty,
  planLibraryMigration,
  runLibraryMigration,
  type MigrationDeps,
  type MigrationListing,
} from "@/lib/library-migration";
import type { FileEntry } from "@/lib/tauri";

function entry(name: string, dir = false): FileEntry {
  return { name, path: name, is_directory: dir, hidden: name.startsWith("."), children: undefined };
}

function listing(over: Partial<MigrationListing> = {}): MigrationListing {
  return { entries: [], inbox: [], projectDirs: new Set(), ...over };
}

describe("planning the library migration (2026-09-06)", () => {
  it("moves a project the destination has never seen", () => {
    const plan = planLibraryMigration(
      listing({ entries: [entry("Research", true)], projectDirs: new Set(["Research"]) }),
      listing(),
    );
    expect(plan.steps).toEqual([{ kind: "move", from: "Research", to: "Research" }]);
    expect(plan.counts.projects).toBe(1);
  });

  it("keeps both when a project of the same name exists on each side", () => {
    // Two projects carry two sets of metadata — settings, comments, an AI
    // lock. Merging them would silently combine things that were never meant
    // to meet, so both are kept and the collision is reported.
    const plan = planLibraryMigration(
      listing({ entries: [entry("Research", true)], projectDirs: new Set(["Research"]) }),
      listing({ entries: [entry("Research", true)], projectDirs: new Set(["Research"]) }),
    );
    expect(plan.steps[0]).toMatchObject({
      kind: "rename-conflicting-project",
      from: "Research",
      to: "Research (from iCloud Drive)",
    });
    expect(plan.leftBehind[0].name).toBe("Research");
  });

  it("merges a project into a plain folder the phone made of the same name", () => {
    const plan = planLibraryMigration(
      listing({ entries: [entry("Notes", true)], projectDirs: new Set(["Notes"]) }),
      listing({ entries: [entry("Notes", true)] }), // no .notesage on the far side
    );
    expect(plan.steps[0]).toMatchObject({ kind: "move", from: "Notes", to: "Notes" });
    expect(plan.steps[0].note).toContain("merged into");
  });

  it("dedupes an Inbox item whose name is already taken", () => {
    const plan = planLibraryMigration(
      listing({ inbox: [entry("Article.html")] }),
      listing({ inbox: [entry("Article.html")] }),
    );
    expect(plan.steps[0]).toMatchObject({
      kind: "merge-inbox-item",
      from: "Inbox/Article.html",
      to: "Inbox/Article-1.html",
    });
  });

  it("merges read state rather than replacing it", () => {
    const plan = planLibraryMigration(listing({ inbox: [entry(".notesage", true)] }), listing());
    expect(plan.steps).toEqual([
      expect.objectContaining({ kind: "merge-reading-progress" }),
    ]);
  });

  it("unions the pins and drops the per-device sync settings", () => {
    const plan = planLibraryMigration(listing({ entries: [entry(".notesage", true)] }), listing());
    expect(plan.steps.map((s) => s.kind)).toEqual(["merge-pins", "drop"]);
    expect(plan.steps[1].from).toBe(".notesage/sync-settings.json");
  });

  it("ignores .DS_Store entirely", () => {
    const plan = planLibraryMigration(
      listing({ entries: [entry(".DS_Store")], inbox: [entry(".DS_Store")] }),
      listing(),
    );
    expect(plan.steps).toEqual([]);
  });

  it("never deletes anything before its destination exists", () => {
    // The invariant the whole design rests on. A drop is the one exception,
    // and it is a file deliberately not carried across.
    const plan = planLibraryMigration(
      listing({
        entries: [entry(".notesage", true), entry("A", true), entry("loose.md")],
        inbox: [entry("x.html"), entry(".notesage", true)],
        projectDirs: new Set(["A"]),
      }),
      listing(),
    );
    for (const step of plan.steps) {
      if (step.kind === "drop") continue;
      expect(step.to, `${step.kind} ${step.from} has no destination`).toBeTruthy();
    }
  });
});

describe("dedupe", () => {
  it("appends before the extension, and keeps counting", () => {
    expect(dedupeName("a.md", new Set())).toBe("a.md");
    expect(dedupeName("a.md", new Set(["a.md"]))).toBe("a-1.md");
    expect(dedupeName("a.md", new Set(["a.md", "a-1.md"]))).toBe("a-2.md");
    expect(dedupeName("folder", new Set(["folder"]))).toBe("folder-1");
    expect(dedupeName(".hidden", new Set([".hidden"]))).toBe(".hidden-1");
  });
});

describe("running the migration", () => {
  function deps(over: Partial<MigrationDeps> = {}): MigrationDeps {
    return {
      moveEntry: vi.fn(async (_s: string, d: string) => d),
      readFile: vi.fn(async () => "{}"),
      writeFile: vi.fn(async () => {}),
      deletePath: vi.fn(async () => {}),
      exists: vi.fn(async () => true),
      mergeReadingProgress: vi.fn(() => "merged-progress"),
      mergePins: vi.fn(() => "merged-pins"),
      ...over,
    };
  }

  it("treats a step whose source is gone as already done", async () => {
    // What makes a run resumable: re-planning after an interruption yields
    // steps that were already carried out, and they must be no-ops rather
    // than failures.
    const moveEntry = vi.fn(async (_s: string, d: string) => d);
    const plan = planLibraryMigration(
      listing({ entries: [entry("A", true)], projectDirs: new Set(["A"]) }),
      listing(),
    );
    const report = await runLibraryMigration(plan, "/old", "/new", deps({
      exists: vi.fn(async () => false),
      moveEntry,
    }));
    expect(moveEntry).not.toHaveBeenCalled();
    expect(report.failed).toEqual([]);
  });

  it("finishes the rest when one step fails, and says which failed", async () => {
    // Aborting would leave the library half in each place with no record of
    // which half — worse than finishing and reporting the gap.
    const plan = planLibraryMigration(
      listing({ entries: [entry("A", true), entry("B", true)], projectDirs: new Set(["A", "B"]) }),
      listing(),
    );
    const moveEntry = vi.fn(async (s: string, d: string) => {
      if (s.endsWith("/A")) throw new Error("disk full");
      return d;
    });
    const report = await runLibraryMigration(plan, "/old", "/new", deps({ moveEntry }));
    expect(moveEntry).toHaveBeenCalledTimes(2);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0].step.from).toBe("A");
    expect(report.failed[0].error).toContain("disk full");
  });

  it("merges the sidecar with what is already there, then removes the source", async () => {
    const plan = planLibraryMigration(listing({ inbox: [entry(".notesage", true)] }), listing());
    const writeFile = vi.fn(async () => {});
    const deletePath = vi.fn(async () => {});
    const mergeReadingProgress = vi.fn(() => "merged-progress");
    await runLibraryMigration(plan, "/old", "/new", deps({ writeFile, deletePath, mergeReadingProgress }));
    expect(mergeReadingProgress).toHaveBeenCalledWith("{}", "{}");
    expect(writeFile).toHaveBeenCalledWith(
      "/new/Inbox/.notesage/reading-progress.json",
      "merged-progress",
    );
    expect(deletePath).toHaveBeenCalledWith("/old/Inbox/.notesage/reading-progress.json");
  });

  it("reports progress once per step", async () => {
    const plan = planLibraryMigration(
      listing({ entries: [entry("A", true), entry("b.md")], projectDirs: new Set(["A"]) }),
      listing(),
    );
    const onStep = vi.fn();
    await runLibraryMigration(plan, "/old", "/new", deps({ onStep }));
    expect(onStep).toHaveBeenCalledTimes(2);
    expect(onStep).toHaveBeenLastCalledWith(2, 2, expect.anything());
  });
});

describe("removing the old root", () => {
  it("is empty when only debris remains, and not otherwise", () => {
    expect(oldRootIsEmpty([entry(".DS_Store")])).toBe(true);
    expect(oldRootIsEmpty([])).toBe(true);
    expect(oldRootIsEmpty([entry(".DS_Store"), entry("Leftover", true)])).toBe(false);
  });
});

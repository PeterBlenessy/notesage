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
    expect(plan.steps).toEqual([
      { kind: "move", unit: "project", from: "Research", to: "Research" },
    ]);
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
    expect(plan.steps[0]).toMatchObject({ kind: "merge-folder", from: "Notes", to: "Notes" });
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

  it("reports an evicted file instead of moving its placeholder", () => {
    // On disk it is `.note.md.icloud` with the bytes still in the cloud.
    // Copying that and deleting the source deletes the real item from
    // iCloud. It stays put, and — unlike before, when the default listing
    // hid it — it is named in the report.
    const plan = planLibraryMigration(
      listing({ entries: [entry(".note.md.icloud")] }),
      listing(),
    );
    expect(plan.steps).toEqual([]);
    expect(plan.leftBehind).toEqual([
      { name: "note.md", reason: expect.stringContaining("not been downloaded") },
    ]);
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

describe("a destination that has not finished downloading", () => {
  it("treats an .icloud placeholder as the name it stands for", () => {
    // The container holds `notes.md`, not yet downloaded, so on disk it is
    // only `.notes.md.icloud`. Read literally, `destTop` never contains
    // `notes.md`, the collision is invisible, and the incoming file is moved
    // straight onto the name a DIFFERENT file is still waiting to
    // materialise into. `migrate_library_entry`'s `dest.exists()` misses it
    // for the same reason. This is the normal state of a Mac joining a
    // library the phone made.
    const plan = planLibraryMigration(
      listing({ entries: [entry("notes.md")] }),
      listing({ entries: [entry(".notes.md.icloud")] }),
    );
    const move = plan.steps.find((s) => s.from === "notes.md");
    expect(move?.to, "the incoming file must not take the placeholder's name").toBe("notes-1.md");
  });

  it("does the same for an Inbox item", () => {
    const plan = planLibraryMigration(
      listing({ inbox: [entry("a.html")] }),
      listing({ inbox: [entry(".a.html.icloud")] }),
    );
    const move = plan.steps.find((s) => s.from === "Inbox/a.html");
    expect(move?.to).toBe("Inbox/a-1.html");
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
      listNames: vi.fn(async () => []),
      readFile: vi.fn(async () => "{}"),
      writeFile: vi.fn(async () => {}),
      deletePath: vi.fn(async () => {}),
      exists: vi.fn(async () => true),
      mergeReadingProgress: vi.fn(() => "merged-progress"),
      mergePins: vi.fn(() => "merged-pins"),
      ...over,
    };
  }

  it("records every rename it made, because the path rewriter cannot infer them", async () => {
    // Stored paths are absolute, and rewriting them is a rebase — correct
    // only while the name survived. A project kept as "X (from iCloud
    // Drive)" that is rebased to `<new>/X` points at the OTHER project.
    const plan = planLibraryMigration(
      listing({
        entries: [entry("note.md"), entry("Research", true)],
        projectDirs: new Set(["Research"]),
      }),
      listing({
        entries: [entry("note.md"), entry("Research", true)],
        projectDirs: new Set(["Research"]),
      }),
    );
    const report = await runLibraryMigration(plan, "/old", "/new", deps());

    expect(report.renames).toEqual(
      expect.arrayContaining([
        { from: "note.md", to: "note-1.md" },
        { from: "Research", to: "Research (from iCloud Drive)" },
      ]),
    );
  });

  it("records a merged folder's child renames too, which only the run knows", async () => {
    const plan = planLibraryMigration(
      listing({ entries: [entry("Notes", true)] }),
      listing({ entries: [entry("Notes", true)] }),
    );
    const report = await runLibraryMigration(
      plan,
      "/old",
      "/new",
      deps({
        listNames: vi.fn(async (dir: string) =>
          dir.startsWith("/old") ? ["a.md"] : ["a.md"],
        ),
      }),
    );

    expect(report.renames).toEqual([{ from: "Notes/a.md", to: "Notes/a-1.md" }]);
  });

  it("removes the emptied folder after a merge, so the old root can read as empty", async () => {
    // Left behind, an empty husk is not just debris: startup asks "does the
    // old folder still have content?" to decide which root is the library,
    // and an empty directory answers yes.
    const plan = planLibraryMigration(
      listing({ entries: [entry("Notes", true)] }),
      listing({ entries: [entry("Notes", true)] }),
    );
    const listNames = vi
      .fn<(dir: string) => Promise<string[]>>()
      .mockResolvedValueOnce(["x.md"]) // destination, for the dedupe set
      .mockResolvedValueOnce(["b.md"]) // source children
      .mockResolvedValueOnce([".DS_Store"]); // what is left afterwards
    const deleted: string[] = [];
    await runLibraryMigration(
      plan,
      "/old",
      "/new",
      deps({ listNames, deletePath: vi.fn(async (p: string) => void deleted.push(p)) }),
    );

    expect(deleted).toEqual(["/old/Notes"]);
  });

  it("keeps a folder whose children did not all move", async () => {
    // The other half of the rule: never a blind delete of what did not move.
    const plan = planLibraryMigration(
      listing({ entries: [entry("Notes", true)] }),
      listing({ entries: [entry("Notes", true)] }),
    );
    const listNames = vi
      .fn<(dir: string) => Promise<string[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(["b.md"])
      .mockResolvedValueOnce(["stuck.md"]); // something is still there
    const deleted: string[] = [];
    await runLibraryMigration(
      plan,
      "/old",
      "/new",
      deps({ listNames, deletePath: vi.fn(async (p: string) => void deleted.push(p)) }),
    );

    expect(deleted).toEqual([]);
  });

  it("refuses an evicted child inside a merged folder, and says which", async () => {
    // The top-level planner refuses these; nothing refused them HERE, where
    // children are reached by name from a hidden-inclusive listing. Moving
    // the stub out of the container holding its bytes is the unrecoverable
    // case the whole check exists for.
    const plan = planLibraryMigration(
      listing({ entries: [entry("Notes", true)] }),
      listing({ entries: [entry("Notes", true)] }),
    );
    const moved: string[] = [];
    const deleted: string[] = [];
    const report = await runLibraryMigration(
      plan,
      "/old",
      "/new",
      deps({
        listNames: vi.fn(async (dir: string) =>
          dir.startsWith("/old") ? [".old.md.icloud", "fine.md"] : [],
        ),
        moveEntry: vi.fn(async (src: string, dst: string) => {
          moved.push(src);
          return dst;
        }),
        deletePath: vi.fn(async (p: string) => void deleted.push(p)),
      }),
    );

    expect(moved).toEqual(["/old/Notes/fine.md"]);
    expect(report.leftBehind).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Notes/old.md" }),
      ]),
    );
    // And the folder stays: something of the user's is still in it.
    expect(deleted).toEqual([]);
  });

  it("merges a folder by moving its children, because a move onto it is refused", () => {
    // The step used to be a plain `move` onto a destination that exists by
    // definition — which the move primitive refuses, so this collision shape
    // failed every time and the promised merge never happened. Nothing was
    // lost; nothing arrived either.
    const plan = planLibraryMigration(
      listing({ entries: [entry("Notes", true)] }),
      listing({ entries: [entry("Notes", true)] }),
    );
    expect(plan.steps[0].kind).toBe("merge-folder");

    const moves: string[][] = [];
    const d = deps({
      listNames: vi.fn(async (dir: string) =>
        dir.endsWith("/Notes") && dir.startsWith("/old") ? ["a.md", "b.md"] : ["a.md"],
      ),
      moveEntry: vi.fn(async (s: string, dst: string) => {
        moves.push([s, dst]);
        return dst;
      }),
    });
    return runLibraryMigration(plan, "/old", "/new", d).then(() => {
      // `a.md` is taken on the far side, so it is deduped; `b.md` is not.
      expect(moves).toEqual([
        ["/old/Notes/a.md", "/new/Notes/a-1.md"],
        ["/old/Notes/b.md", "/new/Notes/b.md"],
      ]);
    });
  });

  it("counts placeholders when merging a folder's children too", async () => {
    const plan = planLibraryMigration(
      listing({ entries: [entry("Notes", true)] }),
      listing({ entries: [entry("Notes", true)] }),
    );
    const moved: { from: string; to: string }[] = [];
    await runLibraryMigration(plan, "/old", "/new", deps({
      listNames: vi.fn(async (dir: string) =>
        dir.startsWith("/old") ? ["child.md"] : [".child.md.icloud"],
      ),
      moveEntry: vi.fn(async (src: string, dst: string) => {
        moved.push({ from: src, to: dst });
        return dst;
      }),
    }));
    expect(moved).toEqual([{ from: "/old/Notes/child.md", to: "/new/Notes/child-1.md" }]);
  });

  it("fails the merge rather than deduping against nothing when the destination cannot be listed", async () => {
    // An empty `mine` would mean every child planned straight onto whatever
    // is already there. The folder exists by construction, so a listing
    // failure is a fault, not an absence.
    const plan = planLibraryMigration(
      listing({ entries: [entry("Notes", true)] }),
      listing({ entries: [entry("Notes", true)] }),
    );
    const report = await runLibraryMigration(plan, "/old", "/new", deps({
      listNames: vi.fn(async (dir: string) => {
        if (dir.startsWith("/new")) throw new Error("iCloud is not responding");
        return ["child.md"];
      }),
    }));
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0].error).toContain("iCloud is not responding");
  });
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

  it("a re-plan after a partial run does not dedupe an already-deduped name again", async () => {
    // Resumability's sharp edge. First run: source `a.md` collides and lands
    // as `a-1.md`. If the source is then gone, the re-plan must not see
    // `a-1.md` at the destination, dedupe against it, and produce `a-2.md`
    // — the file would move twice under two names. It does not, because the
    // source entry is what drives planning and it is no longer there.
    const first = planLibraryMigration(
      listing({ inbox: [entry("a.html")] }),
      listing({ inbox: [entry("a.html")] }),
    );
    expect(first.steps[0].to).toBe("Inbox/a-1.html");

    // After the move: the source Inbox is empty, the destination holds both.
    const second = planLibraryMigration(
      listing({ inbox: [] }),
      listing({ inbox: [entry("a.html"), entry("a-1.html")] }),
    );
    expect(second.steps).toEqual([]);
  });

  it("counts what actually moved, by kind", async () => {
    // The report is the one screen someone judges the move by. It used to
    // count every project as a loose file, then back-fill projects by
    // subtracting the TOTAL failure count — so a failed inbox merge was
    // blamed on a project that had moved perfectly well.
    const plan = planLibraryMigration(
      listing({
        entries: [entry("Proj", true), entry("loose.md")],
        inbox: [entry("a.html")],
        projectDirs: new Set(["Proj"]),
      }),
      listing(),
    );
    const report = await runLibraryMigration(plan, "/old", "/new", deps());
    expect(report.moved).toEqual({ projects: 1, inboxItems: 1, looseFiles: 1 });
  });

  it("does not blame a project for someone else's failure", async () => {
    const plan = planLibraryMigration(
      listing({
        entries: [entry("Proj", true), entry("a.md"), entry("b.md")],
        projectDirs: new Set(["Proj"]),
      }),
      listing(),
    );
    const moveEntry = vi.fn(async (s: string, d: string) => {
      if (s.endsWith(".md")) throw new Error("nope");
      return d;
    });
    const report = await runLibraryMigration(plan, "/old", "/new", deps({ moveEntry }));
    expect(report.failed).toHaveLength(2);
    expect(report.moved.projects).toBe(1); // the project moved, and says so
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

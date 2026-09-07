// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, renameSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

import {
  planLibraryMigration,
  runLibraryMigration,
  type MigrationDeps,
  type MigrationListing,
} from "@/lib/library-migration";
import { planPathRewrites, applyPathRewrites } from "@/lib/library-migration-paths";
import type { FileEntry } from "@/lib/tauri";

/**
 * The rehearsal: the whole migration, against a real filesystem.
 *
 * Every other test in this feature injects `MigrationDeps` fakes, which prove
 * the plan/run LOGIC and nothing about what happens to actual files. For a
 * feature that moves every file someone owns, re-uploads them through iCloud
 * and has no undo, that gap is the one that matters — so this builds a real
 * library in a temp directory, with the shapes that have historically gone
 * wrong, runs the real planner and runner over it, and then asserts on the
 * bytes.
 *
 * The deps here are node `fs` rather than Tauri, which is the one seam: the
 * Rust `migrate_library_entry` is covered by its own tests in `sync.rs`. What
 * this covers is everything above it — ordering, dedupe, collisions,
 * resumability, partial failure, and that no content is ever destroyed.
 *
 * `moveEntry` deliberately mirrors the Rust command's contract, refusing an
 * existing destination, so a plan that would have overwritten something fails
 * here exactly as it would on a real machine.
 */

let root: string;

function listing(dir: string): MigrationListing {
  const read = (p: string): FileEntry[] =>
    existsSync(p)
      ? readdirSync(p).map((name) => ({
          name,
          path: join(p, name),
          is_directory: statSync(join(p, name)).isDirectory(),
          hidden: name.startsWith("."),
          children: undefined,
        }))
      : [];
  const entries = read(dir);
  const projectDirs = new Set<string>();
  for (const e of entries) {
    if (e.is_directory && existsSync(join(dir, e.name, ".notesage"))) projectDirs.add(e.name);
  }
  return { entries, inbox: read(join(dir, "Inbox")), projectDirs };
}

function realDeps(over: Partial<MigrationDeps> = {}): MigrationDeps {
  return {
    moveEntry: async (src, dst) => {
      // The Rust command's contract: never overwrite.
      if (existsSync(dst)) throw new Error(`${dst} already exists`);
      if (!existsSync(src)) throw new Error(`Nothing to move at ${src}`);
      mkdirSync(dirname(dst), { recursive: true });
      renameSync(src, dst);
      return dst;
    },
    listNames: async (dir) => (existsSync(dir) ? readdirSync(dir) : []),
    readFile: async (p) => readFileSync(p, "utf8"),
    writeFile: async (p, c) => {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, c);
    },
    deletePath: async (p) => rmSync(p, { recursive: true, force: true }),
    exists: async (p) => existsSync(p),
    mergeReadingProgress: (mine, theirs) => {
      const a = mine ? (JSON.parse(mine) as { items?: Record<string, unknown> }) : { items: {} };
      const b = theirs ? (JSON.parse(theirs) as { items?: Record<string, unknown> }) : { items: {} };
      return JSON.stringify({ version: 1, items: { ...(a.items ?? {}), ...(b.items ?? {}) } });
    },
    mergePins: (mine, theirs) => {
      const read = (t: string | null) => (t ? ((JSON.parse(t) as { pins?: string[] }).pins ?? []) : []);
      return JSON.stringify({ pins: Array.from(new Set([...read(mine), ...read(theirs)])).sort() });
    },
    ...over,
  };
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

/** Every file under `dir`, relative, with its content — the thing to compare. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (p: string, rel: string) => {
    if (!existsSync(p)) return;
    for (const name of readdirSync(p)) {
      const full = join(p, name);
      const r = rel ? `${rel}/${name}` : name;
      if (statSync(full).isDirectory()) walk(full, r);
      else out[r] = readFileSync(full, "utf8");
    }
  };
  walk(dir, "");
  return out;
}

async function migrate(oldRoot: string, newRoot: string, deps = realDeps()) {
  const plan = planLibraryMigration(listing(oldRoot), listing(newRoot));
  return { plan, report: await runLibraryMigration(plan, oldRoot, newRoot, deps) };
}

describe("rehearsal: the migration against a real filesystem", () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "notesage-rehearsal-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("moves a whole library and loses not one byte", async () => {
    const oldRoot = join(root, "CloudDocs");
    const newRoot = join(root, "Container");
    write(join(oldRoot, "loose.md"), "loose");
    write(join(oldRoot, "Research", ".notesage", "project.json"), "{}");
    write(join(oldRoot, "Research", "paper.md"), "paper");
    write(join(oldRoot, "Research", "deep", "nested.md"), "nested");
    write(join(oldRoot, "Inbox", "article.html"), "<p>a</p>");
    write(join(oldRoot, ".notesage", "pins.json"), JSON.stringify({ pins: ["Research/paper.md"] }));
    mkdirSync(newRoot, { recursive: true });

    const before = snapshot(oldRoot);
    const { report } = await migrate(oldRoot, newRoot);

    expect(report.failed).toEqual([]);
    const after = snapshot(newRoot);
    // Every file that was there is here, with its content.
    for (const [rel, content] of Object.entries(before)) {
      if (rel === ".notesage/sync-settings.json") continue; // deliberately dropped
      expect(after[rel], `${rel} did not survive the move`).toBe(content);
    }
    expect(report.moved.projects).toBe(1);
    expect(report.moved.looseFiles).toBe(1);
    expect(report.moved.inboxItems).toBe(1);
  });

  it("keeps two same-named projects side by side, both intact", async () => {
    const oldRoot = join(root, "CloudDocs");
    const newRoot = join(root, "Container");
    write(join(oldRoot, "Notes", ".notesage", "project.json"), '{"from":"mac"}');
    write(join(oldRoot, "Notes", "a.md"), "mac copy");
    write(join(newRoot, "Notes", ".notesage", "project.json"), '{"from":"phone"}');
    write(join(newRoot, "Notes", "a.md"), "phone copy");

    const { report } = await migrate(oldRoot, newRoot);

    expect(report.failed).toEqual([]);
    // Neither one overwrote the other.
    expect(readFileSync(join(newRoot, "Notes", "a.md"), "utf8")).toBe("phone copy");
    expect(readFileSync(join(newRoot, "Notes (from iCloud Drive)", "a.md"), "utf8")).toBe("mac copy");
    expect(readFileSync(join(newRoot, "Notes (from iCloud Drive)", ".notesage", "project.json"), "utf8"))
      .toBe('{"from":"mac"}');
  });

  it("merges a plain folder child by child without clobbering", async () => {
    const oldRoot = join(root, "CloudDocs");
    const newRoot = join(root, "Container");
    write(join(oldRoot, "Shared", "mine.md"), "mine");
    write(join(oldRoot, "Shared", "both.md"), "mac version");
    write(join(newRoot, "Shared", "theirs.md"), "theirs");
    write(join(newRoot, "Shared", "both.md"), "phone version");

    const { report } = await migrate(oldRoot, newRoot);

    expect(report.failed).toEqual([]);
    const after = snapshot(join(newRoot, "Shared"));
    expect(after["mine.md"]).toBe("mine");
    expect(after["theirs.md"]).toBe("theirs");
    expect(after["both.md"], "the destination's file must not be replaced").toBe("phone version");
    expect(after["both-1.md"], "the incoming file must be kept beside it").toBe("mac version");
    // And the emptied source folder is gone, so the old root can read as empty.
    expect(existsSync(join(oldRoot, "Shared"))).toBe(false);
  });

  it("refuses to move an undownloaded file, and says which", async () => {
    const oldRoot = join(root, "CloudDocs");
    const newRoot = join(root, "Container");
    // On a real machine the bytes are in the cloud and only the stub is here.
    write(join(oldRoot, ".holiday.md.icloud"), "");
    write(join(oldRoot, "real.md"), "real");
    mkdirSync(newRoot, { recursive: true });

    const { report } = await migrate(oldRoot, newRoot);

    expect(existsSync(join(oldRoot, ".holiday.md.icloud")), "the stub must stay put").toBe(true);
    expect(existsSync(join(newRoot, "real.md"))).toBe(true);
    expect(report.leftBehind.map((l) => l.name)).toContain("holiday.md");
  });

  it("does not take a name a placeholder is waiting to materialise into", async () => {
    const oldRoot = join(root, "CloudDocs");
    const newRoot = join(root, "Container");
    write(join(oldRoot, "notes.md"), "mac notes");
    // The container's own `notes.md` has not come down yet.
    write(join(newRoot, ".notes.md.icloud"), "");

    const { report } = await migrate(oldRoot, newRoot);

    expect(report.failed).toEqual([]);
    expect(readFileSync(join(newRoot, "notes-1.md"), "utf8")).toBe("mac notes");
    expect(existsSync(join(newRoot, ".notes.md.icloud")), "the placeholder is untouched").toBe(true);
    expect(existsSync(join(newRoot, "notes.md")), "the name stays free for its real file").toBe(false);
  });

  it("finishes the rest when one step fails, and never destroys what did not move", async () => {
    const oldRoot = join(root, "CloudDocs");
    const newRoot = join(root, "Container");
    write(join(oldRoot, "a.md"), "a");
    write(join(oldRoot, "b.md"), "b");
    write(join(oldRoot, "c.md"), "c");
    mkdirSync(newRoot, { recursive: true });

    const deps = realDeps({
      moveEntry: async (src, dst) => {
        if (src.endsWith("b.md")) throw new Error("iCloud went away");
        if (existsSync(dst)) throw new Error(`${dst} already exists`);
        mkdirSync(dirname(dst), { recursive: true });
        renameSync(src, dst);
        return dst;
      },
    });
    const { report } = await migrate(oldRoot, newRoot, deps);

    expect(report.failed).toHaveLength(1);
    expect(readFileSync(join(oldRoot, "b.md"), "utf8"), "the failed file is untouched").toBe("b");
    expect(readFileSync(join(newRoot, "a.md"), "utf8")).toBe("a");
    expect(readFileSync(join(newRoot, "c.md"), "utf8")).toBe("c");
  });

  it("resumes an interrupted run and reaches the same place, without duplicating", async () => {
    const oldRoot = join(root, "CloudDocs");
    const newRoot = join(root, "Container");
    write(join(oldRoot, "a.md"), "a");
    write(join(oldRoot, "b.md"), "b");
    mkdirSync(newRoot, { recursive: true });

    // First run dies after the first file.
    let moves = 0;
    await migrate(
      oldRoot,
      newRoot,
      realDeps({
        moveEntry: async (src, dst) => {
          if (moves++ >= 1) throw new Error("interrupted");
          mkdirSync(dirname(dst), { recursive: true });
          renameSync(src, dst);
          return dst;
        },
      }),
    );

    // Re-plan over what is left, and run again.
    const { report } = await migrate(oldRoot, newRoot);

    expect(report.failed).toEqual([]);
    expect(snapshot(newRoot)).toEqual({ "a.md": "a", "b.md": "b" });
    // No `a-1.md`: the completed move must not be redone as a collision.
    expect(existsSync(join(newRoot, "a-1.md"))).toBe(false);
  });

  it("merges read state and pins rather than replacing either", async () => {
    const oldRoot = join(root, "CloudDocs");
    const newRoot = join(root, "Container");
    write(
      join(oldRoot, "Inbox", ".notesage", "reading-progress.json"),
      JSON.stringify({ version: 1, items: { "a.html": { read: true } } }),
    );
    write(
      join(newRoot, "Inbox", ".notesage", "reading-progress.json"),
      JSON.stringify({ version: 1, items: { "b.html": { read: true } } }),
    );
    write(join(oldRoot, ".notesage", "pins.json"), JSON.stringify({ pins: ["x.md"] }));
    write(join(newRoot, ".notesage", "pins.json"), JSON.stringify({ pins: ["y.md"] }));

    const { report } = await migrate(oldRoot, newRoot);

    expect(report.failed).toEqual([]);
    const progress = JSON.parse(
      readFileSync(join(newRoot, "Inbox", ".notesage", "reading-progress.json"), "utf8"),
    ) as { items: Record<string, unknown> };
    expect(Object.keys(progress.items).sort()).toEqual(["a.html", "b.html"]);
    const pins = JSON.parse(readFileSync(join(newRoot, ".notesage", "pins.json"), "utf8")) as {
      pins: string[];
    };
    expect(pins.pins).toEqual(["x.md", "y.md"]);
  });

  it("rewrites the stored paths to where the files actually landed", async () => {
    const oldRoot = join(root, "CloudDocs");
    const newRoot = join(root, "Container");
    write(join(oldRoot, "Notes", ".notesage", "project.json"), "{}");
    write(join(oldRoot, "Notes", "a.md"), "mac");
    write(join(newRoot, "Notes", ".notesage", "project.json"), "{}");

    const { report } = await migrate(oldRoot, newRoot);
    // The project collided, so it is at "Notes (from iCloud Drive)".
    expect(report.renames).toContainEqual({ from: "Notes", to: "Notes (from iCloud Drive)" });

    const rewrites = planPathRewrites({
      oldRoot,
      newRoot,
      projectPaths: [join(oldRoot, "Notes")],
      documentPaths: [join(oldRoot, "Notes", "a.md")],
      sidecarFilePaths: [],
      commentsDir: join(root, "comments"),
      renames: report.renames,
    });
    const projects: string[] = [];
    const documents: string[] = [];
    await applyPathRewrites(rewrites, {
      updateProjectPath: (_f, to) => void projects.push(to),
      renameOpenDocument: (_f, to) => void documents.push(to),
      updateFilePaths: () => {},
      migrateSidecars: async () => {},
    });

    // The critical assertion: the rewritten paths point at files that EXIST.
    // A plain rebase would have sent both to `<newRoot>/Notes`, which is a
    // different project — the one that was already there.
    expect(projects).toEqual([join(newRoot, "Notes (from iCloud Drive)")]);
    expect(documents).toEqual([join(newRoot, "Notes (from iCloud Drive)", "a.md")]);
    for (const p of [...projects, ...documents]) {
      expect(existsSync(p), `${p} does not exist after the rewrite`).toBe(true);
    }
  });
});

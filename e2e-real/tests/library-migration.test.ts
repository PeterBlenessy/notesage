import { browser } from "@wdio/globals";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync, statSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir, homedir } from "node:os";

/**
 * The iCloud container migration, driven end to end through the REAL app.
 *
 * Everything else covering this feature stops at a seam. The rehearsal suite
 * runs the planner and runner over real files, but through node `fs`.
 * `sync.rs`'s tests cover the Rust primitive on its own. Nothing exercised
 * the join — the actual Tauri IPC, `migrate_library_entry`, `write_file`,
 * `delete_path`, `list_directory`, `path_exists` — and a migration that moves
 * every file somebody owns should not first meet that boundary on a real
 * library.
 *
 * So it meets it here, on a throwaway one built in a temp directory. The
 * assertions are made from THIS process, reading the disk directly, rather
 * than from anything the app reports about itself: the whole question is
 * whether the files really moved.
 *
 * NOTHING in this spec may point at a real library. `guardTestRoot` refuses
 * any path inside `~/Notesage` or either iCloud root, and it runs before a
 * single file is written.
 */

let lab: string;
let oldRoot: string;
let newRoot: string;

function guardTestRoot(path: string): void {
  const home = homedir();
  const mobile = join(home, "Library", "Mobile Documents");
  const forbidden = [
    join(home, "Notesage"),
    join(mobile, "com~apple~CloudDocs"),
    join(mobile, "iCloud~com~notesage~app"),
  ];
  for (const root of forbidden) {
    if (path === root || path.startsWith(`${root}/`) || root.startsWith(`${path}/`)) {
      throw new Error(`Refusing to run a migration test at ${path}: it can reach ${root}`);
    }
  }
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

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

/**
 * Run the whole migration inside the app, against the two test roots.
 *
 * `executeAsync`, not `execute`: WebDriver's synchronous script execution
 * returns a Promise as `null`, so an async body silently produces nothing.
 * `helpers/actions.ts` documents the same trap for Tauri invokes.
 */
async function migrateInApp(from: string, to: string) {
  const result = (await browser.executeAsync(
    (oldR: string, newR: string, done: (r: unknown) => void) => {
      const w = window as unknown as { __E2E_LIBRARY_MIGRATION__: Record<string, any> };
      const m = w.__E2E_LIBRARY_MIGRATION__;
      if (!m) {
        done({ ok: false, error: "__E2E_LIBRARY_MIGRATION__ missing — not a dev build?" });
        return;
      }
      m.lockLibraryRoots([oldR, newR]);
      void (async () => {
        try {
          const [source, dest] = await Promise.all([
            m.buildMigrationListing(oldR),
            m.buildMigrationListing(newR),
          ]);
          const plan = m.planLibraryMigration(source, dest);
          const report = await m.runLibraryMigration(plan, oldR, newR, m.migrationDeps());
          await m.recordMigrationInMarker(newR, m.markerWriteDeps());
          const remaining = await m.buildMigrationListing(oldR);
          done({
            ok: true,
            value: {
              steps: plan.steps.length,
              moved: report.moved,
              failed: report.failed.map((f: { error: string }) => f.error),
              leftBehind: report.leftBehind.map((l: { name: string }) => l.name),
              renames: report.renames,
              unaccounted: m
                .unaccountedInOldRoot(remaining.entries, report, remaining.inbox)
                .map((u: { name: string }) => u.name),
            },
          });
        } catch (err) {
          done({ ok: false, error: String(err) });
        } finally {
          m.unlockLibraryRoots();
        }
      })();
    },
    from,
    to,
  )) as { ok: boolean; error?: string; value?: any };

  if (!result.ok) throw new Error(`migration failed in the app: ${result.error}`);
  return result.value;
}

describe("iCloud container migration, through the real app", () => {
  beforeEach(() => {
    lab = mkdtempSync(join(tmpdir(), "notesage-e2e-migration-"));
    guardTestRoot(lab);
    oldRoot = join(lab, "CloudDocs", "Notesage");
    newRoot = join(lab, "Container", "Documents");
    guardTestRoot(oldRoot);
    guardTestRoot(newRoot);
  });

  afterEach(() => {
    rmSync(lab, { recursive: true, force: true });
  });

  it("moves a whole library across the IPC boundary without losing a byte", async () => {
    write(join(oldRoot, "Welcome.md"), "# Welcome\n");
    write(join(oldRoot, "Research", ".notesage", "project.json"), '{"name":"Research"}');
    write(join(oldRoot, "Research", "paper.md"), "# Paper\n");
    write(join(oldRoot, "Research", "sources", "deep.md"), "nested\n");
    write(join(oldRoot, "Inbox", "article.html"), "<h1>One</h1>");
    write(join(oldRoot, ".notesage", "pins.json"), '{"pins":["Welcome.md"]}');
    write(join(oldRoot, ".DS_Store"), "");
    mkdirSync(newRoot, { recursive: true });

    const before = snapshot(oldRoot);
    const result = await migrateInApp(oldRoot, newRoot);

    expect(result.failed).toEqual([]);
    const after = snapshot(newRoot);
    // Documents must arrive byte for byte. The two sidecars are MERGED and
    // re-serialised by design, so they are asserted on meaning below rather
    // than on bytes, and `sync-settings.json` is deliberately dropped.
    const merged = new Set([".notesage/pins.json", "Inbox/.notesage/reading-progress.json"]);
    for (const [rel, content] of Object.entries(before)) {
      if (rel === ".DS_Store" || rel === ".notesage/sync-settings.json") continue;
      if (merged.has(rel)) {
        expect(existsSync(join(newRoot, rel))).toBe(true);
        continue;
      }
      expect(after[rel]).toBe(content);
    }
    // The pins survived the merge, whatever shape the file took.
    const pins = JSON.parse(readFileSync(join(newRoot, ".notesage", "pins.json"), "utf8"));
    expect(pins.pins).toEqual(["Welcome.md"]);
    expect(result.unaccounted).toEqual([]);
    // The marker is what makes the move stick across a restart.
    const marker = JSON.parse(readFileSync(join(newRoot, ".notesage", "library.json"), "utf8"));
    expect(marker.migratedFrom).toBeTruthy();
  });

  it("keeps two same-named projects side by side, through the real move command", async () => {
    write(join(oldRoot, "Notes", ".notesage", "project.json"), '{"from":"mac"}');
    write(join(oldRoot, "Notes", "journal.md"), "the Mac's journal");
    write(join(newRoot, "Notes", ".notesage", "project.json"), '{"from":"phone"}');
    write(join(newRoot, "Notes", "journal.md"), "the phone's journal");

    const result = await migrateInApp(oldRoot, newRoot);

    expect(result.failed).toEqual([]);
    expect(readFileSync(join(newRoot, "Notes", "journal.md"), "utf8")).toBe("the phone's journal");
    expect(readFileSync(join(newRoot, "Notes (from iCloud Drive)", "journal.md"), "utf8")).toBe(
      "the Mac's journal",
    );
  });

  it("refuses an undownloaded file rather than moving its placeholder", async () => {
    // The unrecoverable case: the bytes are in the cloud, so moving the stub
    // out of the container holding them and deleting the source can take the
    // real item with it. The Rust guard is what has to catch this, and this
    // is the only test that reaches the Rust guard through the app.
    write(join(oldRoot, ".holiday.md.icloud"), "");
    write(join(oldRoot, "real.md"), "real");
    write(join(oldRoot, "Project", ".notesage", "project.json"), "{}");
    write(join(oldRoot, "Project", "deep", ".archived.md.icloud"), "");
    mkdirSync(newRoot, { recursive: true });

    const result = await migrateInApp(oldRoot, newRoot);

    expect(existsSync(join(oldRoot, ".holiday.md.icloud"))).toBe(true);
    expect(result.leftBehind).toContain("holiday.md");
    expect(readFileSync(join(newRoot, "real.md"), "utf8")).toBe("real");
    // The nested one is refused by the Rust walk, so the project does not move
    // and — critically — is not destroyed either.
    expect(existsSync(join(oldRoot, "Project", "deep", ".archived.md.icloud"))).toBe(true);
    expect(result.failed.join(" ")).toContain("not been downloaded");
  });

  it("does not take a name a placeholder is waiting to materialise into", async () => {
    write(join(oldRoot, "notes.md"), "mac notes");
    write(join(newRoot, ".notes.md.icloud"), "");

    const result = await migrateInApp(oldRoot, newRoot);

    expect(result.failed).toEqual([]);
    expect(readFileSync(join(newRoot, "notes-1.md"), "utf8")).toBe("mac notes");
    expect(existsSync(join(newRoot, "notes.md"))).toBe(false);
  });

  it("merges an Inbox and its read state rather than replacing either", async () => {
    write(join(oldRoot, "Inbox", "shared.html"), "the Mac's copy");
    write(
      join(oldRoot, "Inbox", ".notesage", "reading-progress.json"),
      JSON.stringify({ version: 1, items: { "a.html": { openedAt: 1 } } }),
    );
    write(join(newRoot, "Inbox", "shared.html"), "the phone's copy");
    write(
      join(newRoot, "Inbox", ".notesage", "reading-progress.json"),
      JSON.stringify({ version: 1, items: { "b.html": { openedAt: 2 } } }),
    );

    const result = await migrateInApp(oldRoot, newRoot);

    expect(result.failed).toEqual([]);
    expect(readFileSync(join(newRoot, "Inbox", "shared.html"), "utf8")).toBe("the phone's copy");
    expect(readFileSync(join(newRoot, "Inbox", "shared-1.html"), "utf8")).toBe("the Mac's copy");
    const progress = JSON.parse(
      readFileSync(join(newRoot, "Inbox", ".notesage", "reading-progress.json"), "utf8"),
    );
    expect(Object.keys(progress.items).sort()).toEqual(["a.html", "b.html"]);
  });

  it("holds the library while it moves, so a save cannot land in the tree", async () => {
    write(join(oldRoot, "note.md"), "original");
    mkdirSync(newRoot, { recursive: true });

    const refused = (await browser.executeAsync(
      (oldR: string, newR: string, done: (r: unknown) => void) => {
        const w = window as unknown as { __E2E_LIBRARY_MIGRATION__: Record<string, any> };
        const m = w.__E2E_LIBRARY_MIGRATION__;
        m.lockLibraryRoots([oldR, newR]);
        void (async () => {
          try {
            // What an autosave would do mid-migration. `write_file` CREATES a
            // missing file, so unrefused this recreates a note at a root the
            // app is abandoning, with the newest edit in it.
            const mod = await import("/src/lib/tauri.ts");
            await mod.tauriApi.writeFile(`${oldR}/note.md`, "an autosave mid-migration");
            done("allowed");
          } catch (err) {
            done(String(err));
          } finally {
            m.unlockLibraryRoots();
          }
        })();
      },
      oldRoot,
      newRoot,
    )) as string;

    expect(refused).toContain("being moved");
    expect(readFileSync(join(oldRoot, "note.md"), "utf8")).toBe("original");
  });
});

#!/usr/bin/env node
/**
 * Build a throwaway Notesage library to rehearse the iCloud container
 * migration against.
 *
 * The migration moves every file someone owns and has no undo, so it must
 * never be rehearsed on a real library — not even a copy, because a copy
 * still lives beside the original and one wrong path argument is all it
 * takes. This makes a synthetic one instead, with the shapes that have
 * actually gone wrong, and REFUSES to write anywhere near a real library.
 *
 *   node scripts/make-test-library.mjs            # into a temp directory
 *   node scripts/make-test-library.mjs /tmp/lab   # or somewhere you name
 *
 * It writes two roots:
 *
 *   <out>/CloudDocs/Notesage    the "old" library, shaped like today's
 *   <out>/Container/Documents   the "new" one, shaped like the phone's
 *
 * Point the app's two roots at those (or run the rehearsal suite, which
 * builds the same shapes in-process) and migrate. Nothing here is precious,
 * so a run that eats it has told you something useful.
 */

import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir, tmpdir } from "node:os";

/** Roots a test library must never be created inside. */
function forbiddenRoots() {
  const home = homedir();
  const mobile = join(home, "Library", "Mobile Documents");
  return [
    join(home, "Notesage"),
    join(mobile, "com~apple~CloudDocs"),
    join(mobile, "iCloud~com~notesage~app"),
  ];
}

function refuseIfNearRealLibrary(out) {
  for (const root of forbiddenRoots()) {
    // Either direction is fatal: inside a real library, or containing one.
    if (out === root || out.startsWith(`${root}/`) || root.startsWith(`${out}/`)) {
      console.error(
        `Refusing to build a test library at ${out}: that is inside (or contains) ${root}.\n` +
          `A migration rehearsal must not be able to reach a real library.`,
      );
      process.exit(1);
    }
  }
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function buildLibrary(out) {
  const old = join(out, "CloudDocs", "Notesage");
  const container = join(out, "Container", "Documents");
  rmSync(out, { recursive: true, force: true });

  // --- the old library: an ordinary Mac's, with the awkward bits ----------
  write(join(old, "Welcome.md"), "# Welcome\n\nA loose note at the top level.\n");
  write(join(old, "shopping.md"), "milk\neggs\n");

  // A project only this Mac has.
  write(join(old, "Research", ".notesage", "project.json"), JSON.stringify({ name: "Research" }));
  write(join(old, "Research", "paper.md"), "# Paper\n");
  write(join(old, "Research", "sources", "deep.md"), "nested, to prove the walk\n");

  // A project the container ALSO has, under the same name: the collision
  // that must keep both, because two projects carry two sets of settings,
  // comments and AI locks that were never meant to meet.
  write(join(old, "Notes", ".notesage", "project.json"), JSON.stringify({ from: "mac" }));
  write(join(old, "Notes", "journal.md"), "the Mac's journal\n");

  // A plain folder that exists on both sides: merged child by child.
  write(join(old, "Shared", "mine.md"), "only on the Mac\n");
  write(join(old, "Shared", "both.md"), "the Mac's version\n");

  // An evicted file: on disk ONLY as the placeholder, bytes still in iCloud.
  // Moving this and deleting the source can take the real item with it, so
  // the migration must refuse it and say so.
  write(join(old, ".holiday-photos.md.icloud"), "");
  // And one nested inside a folder that WILL be merged, which is the case
  // that used to slip past the planner's top-level check.
  write(join(old, "Shared", ".archived.md.icloud"), "");

  // Inbox: shared captures, one name colliding, plus the read-state sidecar
  // both devices have been writing.
  write(join(old, "Inbox", "article-one.html"), "<h1>One</h1>");
  write(join(old, "Inbox", "shared-name.html"), "<h1>the Mac's copy</h1>");
  write(
    join(old, "Inbox", ".notesage", "reading-progress.json"),
    JSON.stringify({ version: 1, items: { "article-one.html": { openedAt: 1 } } }, null, 2),
  );

  // Library metadata: pins are unioned, sync settings are per-device and dropped.
  write(
    join(old, ".notesage", "pins.json"),
    JSON.stringify({ pins: ["Research/paper.md", "Welcome.md"] }, null, 2),
  );
  write(join(old, ".notesage", "sync-settings.json"), JSON.stringify({ device: "this Mac" }));

  // Debris Finder leaves in anything anyone opened. Never content.
  write(join(old, ".DS_Store"), "");

  // --- the container: what the phone made, partly still downloading -------
  write(
    join(container, ".notesage", "library.json"),
    JSON.stringify({ version: 1, createdBy: "ios", createdAt: new Date().toISOString() }, null, 2),
  );
  write(join(container, "Notes", ".notesage", "project.json"), JSON.stringify({ from: "phone" }));
  write(join(container, "Notes", "journal.md"), "the phone's journal\n");
  write(join(container, "Shared", "theirs.md"), "only on the phone\n");
  write(join(container, "Shared", "both.md"), "the phone's version\n");
  write(join(container, "Inbox", "shared-name.html"), "<h1>the phone's copy</h1>");
  write(
    join(container, "Inbox", ".notesage", "reading-progress.json"),
    JSON.stringify({ version: 1, items: { "phone-only.html": { openedAt: 2 } } }, null, 2),
  );
  write(join(container, ".notesage", "pins.json"), JSON.stringify({ pins: ["Notes/journal.md"] }));

  // A file the container owns that this machine has NOT downloaded. It is a
  // name already taken even though the real name is nowhere on disk — the
  // case that silently shadowed a file until it was fixed.
  write(join(container, ".Welcome.md.icloud"), "");

  return { old, container };
}

function tree(dir, prefix = "") {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const isDir = statSync(full).isDirectory();
    out.push(`${prefix}${name}${isDir ? "/" : ""}`);
    if (isDir) out.push(...tree(full, `${prefix}  `));
  }
  return out;
}

const target = process.argv[2]
  ? resolve(process.argv[2])
  : join(tmpdir(), `notesage-test-library-${Date.now()}`);

refuseIfNearRealLibrary(target);
const { old, container } = buildLibrary(target);

console.log(`Test library built at ${target}\n`);
console.log(`OLD  (today's iCloud Drive/Notesage)  ${old}`);
for (const line of tree(old)) console.log(`  ${line}`);
console.log(`\nNEW  (Notesage's own container)      ${container}`);
for (const line of tree(container)) console.log(`  ${line}`);
console.log(`
What it is set up to exercise:
  · "Notes" is a project on BOTH sides      -> both kept, source renamed
  · "Shared" is a plain folder on both      -> merged child by child, "both.md" deduped
  · "Inbox/shared-name.html" collides       -> deduped, neither overwritten
  · reading-progress and pins exist on both -> merged, not replaced
  · sync-settings.json                      -> dropped, it is per-device
  · .holiday-photos.md.icloud (old root)    -> refused and reported, never moved
  · Shared/.archived.md.icloud              -> the nested case, refused inside a merge
  · .Welcome.md.icloud (container)          -> a name already taken by a file still downloading

Nothing here is precious. Delete it with:  rm -rf ${target}`);

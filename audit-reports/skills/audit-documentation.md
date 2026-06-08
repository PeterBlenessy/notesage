# Proposal — improvements to `audit-documentation`

Source of evidence: `audit-reports/06-tests-docs.md` (Part B). Every change below is traceable to a finding. Frontmatter and section structure of the SKILL.md are preserved; only the content noted here changes.

---

## 1. Stale / incorrect guidance to fix

### 1a. Version check is a single comparison; it missed an alpha pre-release channel and multi-file duplication

The audit found docs at 0.39.1 while `package.json` is `0.46.0-alpha.12` — seven minor versions and an undocumented alpha channel behind, with the stale string duplicated across CLAUDE.md and product-description.md (x2). The current bullet checks "version numbers match" but doesn't say to grep ALL occurrences or to flag a pre-release channel the docs never mention.

**Current text (lines 56–59):**
```
### Version References

- Check that version numbers in docs match `package.json`
- Check that technology versions (React, Tiptap, Tailwind) are accurate
```

**Replacement:**
```
### Version References

- Read the canonical version once: `node -p "require('./package.json').version"`.
- Grep EVERY hardcoded version string in docs (`rg -n "[Vv]ersion:?\s*\d+\.\d+" CLAUDE.md docs/`)
  — the same stale string is usually duplicated across CLAUDE.md and product-description.md;
  report each occurrence with its file:line, not just "docs are stale".
- If `package.json` carries a pre-release suffix (`-alpha`, `-beta`, `-rc`), check the
  docs acknowledge the pre-release channel AND that any channel-specific command module
  exists in the docs (e.g. an alpha update command). A docs set that names no channel
  while the build ships one is a HIGH drift.
- Check technology versions (React, Tiptap, Tailwind) against the installed versions in
  `package.json` dependencies, not against prose memory.
[B1 — CLAUDE.md "0.39.1" and product-description.md "0.39.1" (x2) vs package.json
0.46.0-alpha.12; alpha channel + alpha_update.rs never mentioned in docs]
```

### 1b. "Tauri command signatures" check doesn't say to confirm the documented command actually EXISTS or to find new command MODULES

The current API-signature check assumes the command exists and only compares params/returns. The audit found the inverse problem: two whole command MODULES (`alpha_update.rs`, `preview.rs`) exist with zero doc coverage, and the architecture.md module inventory omits them. The check needs to enumerate command modules from the filesystem and diff against the docs.

**Current text (lines 26–32):**
```
### API Signatures

Compare documented Tauri command signatures in `docs/tauri-commands.md` with actual Rust code:
- Are parameter names and types correct?
- Are return types correct?
- Are there commands in the code that aren't documented?
- Are there documented commands that no longer exist?
```

**Replacement:**
```
### API Signatures (verify existence first, then signature)

Build the command surface from code, then diff against the docs — do not trust the docs
as the index.
- Enumerate command MODULES: `ls src-tauri/src/commands/*.rs`. Cross-check each against
  the `commands/` inventory in architecture.md AND against tauri-commands.md. A module
  present in code but absent from both docs is a MEDIUM drift (the IPC reference is
  incomplete). [B6 — alpha_update.rs and preview.rs exist; documented in neither
  tauri-commands.md nor the architecture.md module inventory]
- Enumerate commands: `rg -n "#\[tauri::command\]" src-tauri/src/commands` and list the
  fn names. For each command that tauri-commands.md DOES document, confirm:
  - the fn still exists (documented command not removed),
  - parameter names and types match the doc signature,
  - the return type matches.
- For each documented command, verify the Rust fn it claims to describe is actually
  present — a documented command with no matching `#[tauri::command]` fn is stale.
```

---

## 2. New checks to add

Add a new subsection after "Architecture Accuracy" (before "Version References").

```markdown
### Detect Doc-vs-Code Drift Mechanically (repeatable method)

Do not eyeball the docs — run these existence/identity checks so the audit is
repeatable and every claim is traceable to a path or a grep:

1. **Every documented file path must exist.** Extract paths from each doc and stat them:
   `rg -o "[\w./-]+\.(ts|tsx|rs|json|md)" docs/ CLAUDE.md | sort -u` → for each, `test -e`.
   Report dead paths AND newly-significant files the docs omit.
   - A doc that lists a deleted component/store/perf-category is HIGH if it would lead an
     engineer to wire something a guard test now forbids.
     [B2 — architecture.md/design-system.md/editor.md/workspace.md still document
     TreeOverlay.tsx, tree-overlay-store, useTreeOverlayStore, [perf:tree-overlay], all
     deleted by sidebar task #20; a no-tree-overlay.test.ts guard now blocks
     re-introduction]
   - A store listed in the architecture store table must have a real `src/stores/*.ts`
     file. A documented store with no file points the "map of state ownership" at a void.
     [B4 — architecture.md store table lists `sync-store`; no src/stores/sync-store.ts
     exists (sync settings live in commands/sync.rs + settings JSON)]
   - Newly-added stores/components that ARE rendered but undocumented are also drift.
     [B3 — FoldersSection.tsx is rendered (QuietSidebar.tsx:203-215) and
     folder-appearance-store.ts exists, but neither appears in the docs]

2. **Counts and inventories must be re-measured, never copied.** Any doc line with a
   hardcoded test/file count or an "as of <date>" inventory must be re-derived from the
   tree. If a count is off by more than ~20%, report it and prefer replacing the hardcoded
   number with a pointer to the generating command.
   [B5 — architecture.md "99 unit files, 5 Playwright, 7 real-e2e, ~2160 cases
   (2026-04-07)" vs measured 298 unit files / ~5016 cases / 18 Playwright / 11 real-e2e —
   off ~3x]

3. **Rendered structure must match documented structure.** For ordered/enumerated UI
   lists (sidebar sections, toolbar buttons, tabs), read the component that renders them
   and compare item-by-item, including count words ("five sections").
   [B3 — design-system.md/architecture.md/workspace.md say "Pinned → Projects → Recent →
   Tags → Mentions" (five); QuietSidebar.tsx:203-215 renders six, adding FoldersSection;
   the component's own docstring at QuietSidebar.tsx:19-20 is also stale]

### Cross-Document Consistency (same fact, two docs)

A single fact (a keyboard chord, a component's existence, a version) is often stated in
multiple docs; when only some are updated, the doc set self-contradicts. After resolving
each drift against CODE, grep the asserted value across ALL docs and confirm they agree.
- Keyboard chords are the highest-frequency offender: confirm a chord maps to ONE action
  across keyboard-shortcuts.md and every feature/design doc, and that code routes it
  there.
  [B7 — ⌘⇧E documented as "Export" in keyboard-shortcuts.md but as "Tree Overlay" in
  design-system.md / editor.md / workspace.md; only keyboard-shortcuts.md was updated
  post-#20, and the chord-conflict note now contradicts itself. Verify
  useKeyboardShortcuts.ts actually routes ⌘⇧E to Export]
- When a removal/rename lands, search the whole docs tree for the OLD term — partial
  updates (one doc fixed, four stale) are the common failure mode.
  [B2/B3/B7 all stem from sidebar task #20 being applied to some docs but not others]
```

---

## 3. Modern-judgment additions (Output Format + severity)

The current Output Format groups findings by document but gives no guidance on
*which root cause to surface first*. The audit shows most B-findings share one root
cause (an incomplete migration — sidebar #20 + the 0.46 version bump). Add a note so the
auditor surfaces the systemic cause, not eight disconnected line-edits.

**Add after "Group findings by document for easier correction." (line 76):**
```
When multiple findings share a single root cause (an incomplete refactor applied to some
docs but not others, or a version bump not propagated), call out the root cause once at
the top and list the affected docs under it. Order findings so the docs most likely to
mislead an engineer TODAY come first — version (B1) and live-vs-deleted component/section
mismatches (B2/B3/B7) outrank inventory-count staleness (B5) and store-table omissions
(B4/B6), because a contributor following a stale component reference hits a guard test or
wires a nonexistent store, whereas a stale count only misleads estimation.

Always verify the drift direction against CODE: state "doc says X, code at <file:line>
does Y" with both citations. A finding without a code-side file:line anchor is not
actionable.
```

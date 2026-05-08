# Large File Instant Load — Phase 3 Tasks

|  |  |
| --- | --- |
| **Date** | 2026-05-06 |
| **Status** | Not started |
| **PRD** | [large-file-instant-load](../prds/2026-05-03-large-file-instant-load.md) |
| **Phase** | 3 of 4 — Parsed-state disk cache (Layer 3) |
| **Total** | 19 tasks across 6 milestones |
| **Complexity mix** | \~9 S, \~9 M, 0 L |
| **Suggested order** | M3.1 Hashing (#1 → #2 → #3) → M3.2 Backend (#4 → #5 → #6 → #7) → M3.3 Frontend integration (#8 → #11 → #9 → #10) → M3.4 UX + discipline (#12 → #13) → M3.5 Tests (#14 → #15 → #16) → M3.6 Measurement gate (#17 → #18 → #19) |

## Scope

Phase 3 of the three-layer architecture. Phase 1 made first-paint instant. Phase 2 moved the parse off the main thread. Phase 3 makes **repeat opens** of any file effectively instant by caching the parsed ProseMirror JSON on disk.

Cache key is the SHA-256 of the markdown body (post-frontmatter-strip, pre-preprocessing). On hit, the editor calls `loadParsedJsonIntoEditor(cached.doc)` directly — no Rust preview render, no worker parse. On miss, the existing Phase 1+2 path runs and writes the result to cache for next time.

Targets **Quiet Composer**. Single-document semantics make the lookup point simple: one cache check per `useEditorTabSwitch` activation.

## Honest expectation note (read first)

Phase 3 is a **lopsided win**:

- **Small / medium files (10-100 KB):** repeat opens go to <100 ms. The PRD's "instant" promise lands here.
- **506 KB book:** repeat opens still pay the 4.4 s DOM materialization that `setContent(json)` triggers — that's main-thread DOM work, not parse work, and no cache can help. Click → editable on the book goes from ~5 s (Phase 2) to ~4.5 s (Phase 3 warm). Better, not transformative.

If "instant repeat open of the 506 KB book" is the actual user-facing goal, Phase 3 doesn't deliver it — that needs virtual scrolling or streaming `setContent`, both significant Tiptap-side changes outside this PRD's scope. Phase 3 nails the common-case fast.

## Execution notes

- **Kill-switch first.** Land `parsedCacheEnabled` (#11) early in the integration milestone so we can disable the cache via Settings if it misbehaves in production. The flag has NO UI surface (PRD: diagnostic-only); it's set via `localStorage`/Zustand directly during dev or a future debug menu.
- **Schema discipline.** `CACHE_SCHEMA_VERSION` in `worker-extensions.ts` is bumped manually whenever the worker extension list changes. Forgetting to bump → cached entries silently strip unknown attrs (Tiptap's `setContent` validates against the live schema). Add a checklist note to the file's top doc-comment.
- **Atomic writes.** `write_parsed_cache` writes to a temp file then renames. Two tabs of the same file racing to write produces the same hash → identical content → idempotent. No locking needed.
- **Don't block on I/O.** Cache writes are fire-and-forget after hydration. Cache reads happen synchronously on tab switch BUT against a small `<sha>.json` file; bounded latency, well under the existing tab-switch overhead.
- **Eviction is a follow-up.** PRD mentions ring-buffer eviction at 500 MB total cache size. Defer to Phase 4 — directory size monitoring is straightforward but not blocking.

## Risks and open questions

- **JSON envelope size.** A 506 KB markdown produces ~750 KB JSON. 1000 cached files at 50 KB avg → ~75 MB. Acceptable. If users hit the disk-space ceiling, ring-buffer eviction (Phase 4 or follow-up) caps it.
- **UniqueID stability.** Cached entries have baked-in random UUIDs from the original parse. Reloading from cache preserves them — good, comments and per-block features stay anchored. If user edits the file externally, hash changes → cache miss → fresh parse → new UUIDs. Same as today's external-change reload behaviour, no regression.
- **iCloud sync.** Cache files are device-local by design (mirrors the SQLite `index.db` pattern). Excluded from iCloud via xattr. Each device builds its own from scratch on first open of each file post-install.
- **Schema-hash discipline.** Forgotten bump on a Tiptap-extension change → cached entries strip unknown attrs silently. Mitigation: a checklist note in `worker-extensions.ts` + a regression-watch test that hashes the extension list and fails if names changed without a version bump.
- **Concurrent writes (multi-tab).** Two tabs racing to write the same hash → atomic temp+rename guarantees one survives. Same hash means same content; idempotent. No locking required.
- **Cache poisoning.** A bad cache entry could corrupt the user's editor on every open. Mitigation: per-entry hash check on read — if anything is malformed (JSON parse error, schema-hash mismatch, missing fields), backend returns `None` and frontend falls back to fresh parse. Worst case is one slow open while the bad entry is overwritten.

---

## M3.1 Hashing infrastructure (3 tasks)

### #1 — Markdown content hash

| Field | Value |
| --- | --- |
| Description | Compute SHA-256 of the post-frontmatter-strip body in `src-tauri/src/commands/preview.rs` (or a new sibling `cache.rs`). Reuse the same `sha2::Sha256` crate the SQLite document index already uses. Returned alongside the existing preview render OR as a standalone `compute_markdown_hash(path)` command — pick whichever lets the cache lookup happen with minimal IPC chatter. |
| Complexity | S |
| Category | backend |
| Depends on | none |
| Files | `src-tauri/src/commands/preview.rs` or new `cache.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs` |

### #2 — Tiptap schema hash

| Field | Value |
| --- | --- |
| Description | New `CACHE_SCHEMA_VERSION` constant (integer) in `src/workers/worker-extensions.ts`. Frontend reads it + `extensions.map(e => e.name).sort().join("\|")` and SHA-256s the result via `crypto.subtle.digest`. Result is a hex string, used as `tiptapSchemaHash` in cache entries. Bump the constant manually whenever extension shapes change — discipline note in the file's top doc-comment. |
| Complexity | S |
| Category | frontend |
| Depends on | none |
| Files | `src/workers/worker-extensions.ts`, new `src/lib/cache-hash.ts` helper |

### #3 — Cache key + path helpers

| Field | Value |
| --- | --- |
| Description | `getCachePath(filePath, projectRoot, markdownHash)` resolves to `<project>/.notesage/cache/parsed/<sha>.json` for project files, or `~/Notesage/.notesage/cache/parsed/<sha>.json` for global notes. Mirrors the existing `index.db` location convention so the gitignore + iCloud xattr already cover this directory. |
| Complexity | S |
| Category | frontend |
| Depends on | #1 |
| Files | `src/lib/cache-hash.ts` |

---

## M3.2 Backend Tauri commands (4 tasks)

### #4 — `read_parsed_cache` Tauri command

| Field | Value |
| --- | --- |
| Description | `read_parsed_cache(cache_path: String, expected_md_hash: String, expected_schema_hash: String) -> Result<Option<ParsedCacheEntry>, String>`. Reads the JSON file, validates `markdownHash` and `tiptapSchemaHash` match the expected values, returns the parsed entry on hit or `None` on any mismatch / missing / malformed. Caller treats `None` as "fall through to fresh parse" — no explicit invalidation step needed. |
| Complexity | M |
| Category | backend |
| Depends on | none |
| Files | `src-tauri/src/commands/cache.rs` (new), `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs` |

### #5 — `write_parsed_cache` Tauri command

| Field | Value |
| --- | --- |
| Description | `write_parsed_cache(cache_path: String, entry: ParsedCacheEntry) -> Result<(), String>`. Writes JSON atomically: temp file alongside the target + rename. Auto-creates the parent directory chain (`mkdir -p`-style). Sets the iCloud-exclude xattr on the parent `cache/` directory once (idempotent — `setxattr` on existing attr is a no-op). |
| Complexity | M |
| Category | backend |
| Depends on | #4 (shared struct) |
| Files | `src-tauri/src/commands/cache.rs` |

### #6 — `clear_parsed_cache` Tauri command

| Field | Value |
| --- | --- |
| Description | `clear_parsed_cache(scope: String) -> Result<u64, String>`. `scope` is either `"all"` (every project's `cache/parsed/` + `~/Notesage/.notesage/cache/parsed/`) or an absolute project path (just that project's cache). Returns the count of `*.json` files deleted for UI feedback. |
| Complexity | S |
| Category | backend |
| Depends on | #4 |
| Files | `src-tauri/src/commands/cache.rs` |

### #7 — Cargo unit tests

| Field | Value |
| --- | --- |
| Description | Round-trip read/write a known entry. Hash mismatch returns `None`. Malformed JSON returns `None`. Scope filtering works (clearing a project doesn't touch global notes cache). Atomic write doesn't leak temp files on success or failure. Use `tempfile` crate for test directories — already a workspace dep. |
| Complexity | S |
| Category | backend |
| Depends on | #4, #5, #6 |
| Files | `src-tauri/src/commands/cache.rs` (inline `#[cfg(test)] mod tests`) |

---

## M3.3 Frontend integration (4 tasks)

### #8 — TS types + tauriApi bridge

| Field | Value |
| --- | --- |
| Description | `ParsedCacheEntry` interface mirroring the Rust struct (`schemaVersion`, `tiptapSchemaHash`, `markdownHash`, `createdAt`, `doc`, `tableMetadataEntries`, `nodeIdsEntries`, `annotationsEntries`). Typed `tauriApi.readParsedCache / writeParsedCache / clearParsedCache` wrappers. Reuses the entries-array shape from Phase 2 #19 so the side-channel maps round-trip cleanly through both the worker boundary AND the cache file. |
| Complexity | S |
| Category | frontend |
| Depends on | #4, #5, #6 |
| Files | `src/lib/tauri.ts`, `src/lib/cache-hash.ts` (or a new `src/lib/parsed-cache.ts`) |

### #11 — `parsedCacheEnabled` kill-switch (early)

| Field | Value |
| --- | --- |
| Description | Boolean field on `settings-store`, default `true`. Persisted via the existing Zustand persist middleware. NO UI surface — diagnostic-only per PRD ("kill-switch for diagnostic purposes"). Both cache lookup AND cache write check the flag — when `false`, the cache layer is fully bypassed and behaviour is identical to Phase 1+2. Lands BEFORE the integration in #9 so we can disable from devtools localStorage if anything goes wrong post-merge. |
| Complexity | S |
| Category | frontend |
| Depends on | none |
| Files | `src/stores/settings-store.ts` |

### #9 — Cache lookup in `useEditorTabSwitch`

| Field | Value |
| --- | --- |
| Description | Before kicking off the Phase 1 preview / Phase 2 worker, attempt a cache read. Path graph becomes: external change > cached EditorState > `parsedCacheDisk` cache > preview+worker. On disk-cache hit, call `loadParsedJsonIntoEditor(editor, entry.doc, sideMaps)` directly + flip `previewState` to `"hydrated"` (skipping the preview surface entirely — there's no need for it when hydration is <100 ms). Log `[perf:tab-switch]` with `restore: "disk-cache"`. |
| Complexity | M |
| Category | frontend |
| Depends on | #8, #11 |
| Files | `src/hooks/useEditorTabSwitch.ts` |

### #10 — Cache write after successful hydration

| Field | Value |
| --- | --- |
| Description | When the worker resolves and `loadParsedJsonIntoEditor` runs successfully, fire-and-forget `tauriApi.writeParsedCache(...)` with the doc JSON + side maps + current `markdownHash` + `tiptapSchemaHash` + ISO `createdAt`. No `await` — never block the user on cache I/O. Errors are logged but not surfaced. Skip the write entirely when `parsedCacheEnabled === false`. |
| Complexity | M |
| Category | frontend |
| Depends on | #8, #9 |
| Files | `src/hooks/useEditorTabSwitch.ts`, `src/lib/markdown-worker.ts` |

---

## M3.4 Settings + invalidation UX (2 tasks)

### #12 — "Clear parse cache" button

| Field | Value |
| --- | --- |
| Description | Settings > Advanced. Destructive variant (`Button variant="destructive"`). Confirmation dialog: *"This will require re-parsing the next time each file is opened. Continue?"*. On click, calls `clear_parsed_cache("all")`, shows toast with deleted count (`Cleared 42 cached parses`). Disabled when `parsedCacheEnabled === false` with a tooltip ("Parsed cache is disabled in settings"). |
| Complexity | M |
| Category | frontend |
| Depends on | #6, #8, #11 |
| Files | `src/components/settings/AdvancedSettings.tsx` (or wherever the v2 advanced settings live), `src/components/settings/v2/AdvancedSettings.tsx` |

### #13 — Schema-version-change discipline note

| Field | Value |
| --- | --- |
| Description | Top doc-comment in `src/workers/worker-extensions.ts` calls out: "If you add / remove / re-attribute any extension in this file, bump `CACHE_SCHEMA_VERSION` so existing on-disk caches invalidate automatically." Per-entry hash mismatch (#4) handles invalidation per access — no migration step needed. Add a regression-watch unit test that hashes the extension list and fails if a name changes without a version bump. |
| Complexity | S |
| Category | infrastructure |
| Depends on | #2 |
| Files | `src/workers/worker-extensions.ts`, `src/workers/__tests__/worker-extensions.test.ts` (new — schema-hash regression watch) |

---

## M3.5 Tests (3 tasks)

### #14 — Cache hit/miss unit tests

| Field | Value |
| --- | --- |
| Description | Vitest unit tests for the integration layer. Mock `tauriApi.readParsedCache` to return `null` (miss) — verify Phase 1+2 path runs. Mock to return a valid entry (hit) — verify `loadParsedJsonIntoEditor` is called with the entry's doc + side maps, `setContent(html)` is NOT called, preview surface is not mounted. Cover the kill-switch path: when `parsedCacheEnabled === false`, lookup is skipped (no `readParsedCache` call). |
| Complexity | M |
| Category | test |
| Depends on | #9, #10, #11 |
| Files | `src/hooks/__tests__/useEditorTabSwitch.cache.test.ts` (new) |

### #15 — Schema-hash invalidation integration test

| Field | Value |
| --- | --- |
| Description | Bump `CACHE_SCHEMA_VERSION` in a test fixture, write a cache entry with the OLD hash, attempt a read with the NEW expected hash → backend returns `None`, frontend falls back to fresh parse. Verifies the auto-invalidation discipline holds without a migration step. |
| Complexity | S |
| Category | test |
| Depends on | #4, #14 |
| Files | `src-tauri/src/commands/cache.rs` (cargo integration) OR `src/hooks/__tests__/useEditorTabSwitch.cache.test.ts` (frontend) — pick whichever has the test fixtures |

### #16 — E2E: second open hits cache

| Field | Value |
| --- | --- |
| Description | Extend `e2e/tests/preview-fidelity.spec.ts`. Open the fixture file → wait for hydration → close (Cmd+W) → re-open. On the second open, assert NO `render_markdown_preview` IPC call AND NO worker parse fired (proxy: the second open's click → editor visible time is <500 ms). Detect via the existing IPC log inspection pattern. |
| Complexity | M |
| Category | test |
| Depends on | #9, #10 |
| Files | `e2e/tests/preview-fidelity.spec.ts` |

---

## M3.6 Measurement gate + rollout (3 tasks)

### #17 — DevTools Timeline cold + warm capture

| Field | Value |
| --- | --- |
| Description | Two recordings on the user's 506 KB book: (a) cold cache (after `clear_parsed_cache` or fresh install) — verify Phase 2 numbers reproduce; (b) warm cache (second open after a successful first hydration). Save filenames per existing convention. USER ACTION — runs on real hardware. |
| Complexity | S |
| Category | perf (USER) |
| Depends on | #10 |
| Files | user-local recordings (NOT committed) |

### #18 — Update `docs/performance-baseline.md`

| Field | Value |
| --- | --- |
| Description | New "2026-MM-DD — Phase 3 (Parsed-state disk cache), Book 506 KB" entry. Per-file-size table: cold open (Phase 2 numbers) vs warm cache hit. Honest commentary: small/medium files hit the <100 ms target; the 506 KB book still pays the 4.4 s DOM materialization on warm hits — that cost is unaddressable without virtual scrolling or streaming setContent (out of scope for this PRD). |
| Complexity | S |
| Category | docs |
| Depends on | #17 |
| Files | `docs/performance-baseline.md` |

### #19 — Tick PRD gates + status updates

| Field | Value |
| --- | --- |
| Description | In `docs/prds/2026-05-03-large-file-instant-load.md`: tick Layer 3 functional gate (warm-cache <100 ms p95 met for small files; partially met for 506 KB book — note caveat). Tick Layer 3 invalidation + schema invalidation gates. Add "Phase 3 — landed" marker with commit refs. Update this task file's status row. Update `project_large_file_instant_load.md` memory entry. |
| Complexity | S |
| Category | docs |
| Depends on | #18 |
| Files | `docs/prds/2026-05-03-large-file-instant-load.md`, this task file, memory |

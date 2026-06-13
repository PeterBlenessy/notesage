# Tasks: Ambient Action-Refinement Engine

|  |  |
| --- | --- |
| **Date** | 2026-06-13 |
| **Status** | Not started |
| **PRD** | [ambient-action-refinement](../prds/2026-06-13-ambient-action-refinement.md) |
| **Total** | 18 tasks: 4S, 12M, 2L |
| **Suggested order** | Foundations (#1–#5) → Engine (#6–#7) → Detection & Apply (#8–#10) → Surfacing (#11–#14) → Wire-up (#15) → Tests (#16–#18) |

All tasks are **frontend** — the PRD adds no Tauri commands and no Rust structs. Inference reuses the existing `ai_chat_stream` (via `generateStructured`) and the ACP session path in `useAIOperations`.

**Cross-cutting risks**
- **#9 and #10 are the high-blast-radius tasks.** The watcher hooks the editor transaction stream and the apply extension mutates the document — both must respect "ProseMirror is the single source of truth" and must not regress `[perf:typing]`.
- **Routing slot decision (PRD Open Q#2):** these tasks default to reading a refinement slot that **falls back to `agent_tasks`** (no `AICapability` union change — avoids the capabilities-frozen-at-creation migration). If a dedicated `refinement` slot is later approved, only #5 and #14 change.
- **GBNF guarantee is path-dependent (PRD Open Q#3):** #6 (direct-API) is schema-guaranteed; #7 (ACP) is best-effort JSON. Keep the dispatch seam clean so the slot could later be constrained to GBNF-capable connections.

---

## Foundations

### 1. Refinement types + JSON schema
- **Description:** Create `src/lib/ai/refinement.ts` with `RefinementVerdict` (`keep | sharpen | split | defer | drop`), `RefinementStep`, `RefinementResult`, and `RefinementEntry` interfaces exactly as in the PRD Data Model. Add the JSON Schema mirror of `RefinementResult` (verdict as enum, `strict: true`) for `generateStructured`. Types only — no logic. Acceptance: `pnpm typecheck` green; schema validates a sample object.
- **Complexity:** S
- **Category:** frontend
- **Dependencies:** —
- **Files:** `src/lib/ai/refinement.ts`

### 2. Content hashing + LRU seen-set
- **Description:** Add a stable content-hash helper (normalize whitespace, hash line text) and a bounded LRU seen-set (~2000 entries, not persisted) used to skip clean lines. Acceptance: same text → same hash; LRU evicts oldest past cap; unit-tested in #17.
- **Complexity:** S
- **Category:** frontend
- **Files:** `src/lib/ai/refinement-hash.ts` (or co-locate in `refinement.ts`)

### 3. `ns-refine` comment encode/parse + watermark helpers
- **Description:** Implement read/write of the line-trailing HTML comment `<!-- ns-refine:v1 verdict=… src=… out="…" -->`. Functions: `serializeRefineComment(result, srcHash)`, `parseRefineComment(lineText)`, `stripRefineComment(lineText)`, and `isLineRefined(lineText, currentHash)` (watermark check — true unless `src` diverges from current hash). Must survive markdown round-trip and be ignored by the index parser (comments already are). Acceptance: round-trip parse→serialize is lossless (covered in #17).
- **Complexity:** M
- **Category:** frontend
- **Files:** `src/lib/ai/refine-comment.ts`
- **Note:** Reference the comment-mark/HTML-comment handling already in the markdown pipeline; do not invent a new comment syntax.

### 4. `refinement-store` (Zustand)
- **Description:** New non-persisted store holding `RefinementEntry[]` keyed by docPath + anchor, plus `seen` set wiring and a `hasPending` selector (any non-`keep`, `status==='pending'`). Actions: `upsertEntry`, `setStatus`, `dismiss`, `markSeen`, `rebuildForDoc(entries)`, `clearDoc(docPath)`. Rebuilt from document comments on open (#15), not localStorage. Acceptance: actions produce new references (selector cache invalidation); unit-tested in #17.
- **Complexity:** M
- **Category:** frontend
- **Files:** `src/stores/refinement-store.ts`
- **Note:** Deliberately **not** `activity-store` (PRD: refinements are document-anchored suggestions, not lifecycle tasks).

### 5. Provider resolver
- **Description:** `resolveRefinementConnection()` reads `routing-store` — the refinement slot if present, else the `agent_tasks` slot — and returns the `Connection` (or null). Single seam so the slot source is swappable. Returns enough to let the engine pick its dispatch path (connection `authMethod`/`provider`). Acceptance: returns the agent_tasks connection when no dedicated slot set; null when both empty; test asserts it consults `routing-store` and hardcodes nothing.
- **Complexity:** S
- **Category:** frontend
- **Files:** `src/lib/ai/refinement-routing.ts`
- **Dependencies:** —

---

## Engine

### 6. `refineAction` — direct-API path
- **Description:** In `refinement.ts`, `refineAction(line, context)` for direct-API connections (`local_bundled`, `openai_compatible`, `ollama`, `api_key`): build the shared system prompt (verdict taxonomy + "sharpen, don't pad") and minimal context (line + heading ancestry, not whole doc), call `generateStructured<RefinementResult>()` with the #1 schema. GBNF-capable subset is schema-guaranteed; `api_key` falls back to parse+retry. Acceptance: returns a valid `RefinementResult`; tested in #16.
- **Complexity:** M
- **Category:** frontend
- **Dependencies:** #1, #5
- **Files:** `src/lib/ai/refinement.ts`

### 7. `refineAction` — `agent_managed` (ACP) path
- **Description:** Dispatch fork for ACP connections: send the schema-shaped prompt through the ACP session (reuse the `useAIOperations`/ACP prompt path), collect the text reply, extract+parse a fenced JSON block as `RefinementResult` with **one** reparse-on-failure retry. On unparseable reply, surface a per-entry error (no crash). ACP has no mid-prompt cancel here → best-effort abandon. Acceptance: valid reply parses; malformed reply after retry yields a clean error entry; tested in #16.
- **Complexity:** M
- **Category:** frontend
- **Dependencies:** #6
- **Files:** `src/lib/ai/refinement.ts`

---

## Detection & Apply

### 8. Candidate action-item pre-filter
- **Description:** `isActionCandidate(lineText)` — cheap client-side gate so prose never reaches a model call: task-list items (`- [ ]`) and imperative-leading paragraphs. Combined with #2/#3 watermarks, decides whether a committed block is dispatched. Acceptance: checkboxes and imperative lines pass; plain prose/headings fail; unit-tested.
- **Complexity:** M
- **Category:** frontend
- **Dependencies:** #2
- **Files:** `src/lib/ai/refinement-detect.ts`

### 9. `useRefinementWatcher` hook
- **Description:** Mounted from QuietLayout (#15). Subscribes to editor transactions; fires on **block exit / paragraph commit** with a ~1500 ms trailing debounce — **never per keystroke** (DOM-read path, no per-keystroke React render). For each newly-committed block: gate through `isActionCandidate` (#8) + watermark/seen-set (#2/#3), enqueue into a **FIFO single-in-flight** queue, call `refineAction` (#6/#7), write results to `refinement-store` (#4). `keep` verdict → seed seen-set, no entry. Backoff after repeated provider failures (mirror `useLocalCompletion`'s 5-failure backoff); recover on connection/slot change. Emit `[perf:refine]` (dispatch, model latency, skip/hit ratio); add `PERF.refine` constant. Inert under `prefers-reduced-motion`? No — only the orb animation is; the watcher still runs.
- **Complexity:** L
- **Category:** frontend
- **Dependencies:** #3, #4, #6, #7, #8
- **Files:** `src/hooks/useRefinementWatcher.ts`, `src/lib/logger.ts` (add `PERF.refine`)
- **Note:** High blast radius — guard against stale-closure capture of the editor/connection; re-resolve provider live.

### 10. Refinement apply extension (editor)
- **Description:** A Tiptap/ProseMirror extension: a lightweight **decoration** (not a full node-view) on lines carrying an unapplied `ns-refine` comment, rendering a hover/focus-revealed ✦ apply affordance at line end. Apply = one transaction that swaps the visible action text for the comment's `out=` value, inserts any `steps[]` as a **nested task list** under the line, and rewrites the comment to `verdict=applied`. Dismiss removes the entry (#4) and seeds the seen-set. Reuse the `AISuggestion` accept/reject mental model but lighter (no diff decoration). Acceptance: apply swaps text + adds nested steps in one undoable step; markdown round-trips losslessly (#18).
- **Complexity:** L
- **Category:** frontend
- **Dependencies:** #3, #4
- **Files:** `src/components/editor/extensions/refinement-apply.ts` (+ register in the editor extension set)
- **Note:** Follow `decoration-factory.ts` and the comment-mark hover-affordance pattern; tooltip must be wrapped in `TooltipProvider`.

---

## Surfacing

### 11. Orb pending flash + count
- **Description:** `AgentOrb` reads `refinement-store.hasPending` → one `.orb-pulsing` cycle on arrival, then a steady count badge (reuse running-count badge styling). Honor `useReducedMotion()` (no pulse; badge only). Acceptance: pending → flash+count; reduced-motion → badge only; hidden when cmd bar pinned (existing behavior unchanged).
- **Complexity:** S
- **Category:** frontend
- **Dependencies:** #4
- **Files:** `src/components/activity/AgentOrb.tsx`

### 12. AgentPanel Refinements section
- **Description:** New section in `AgentPanel` listing pending `RefinementEntry` cards: neutral verdict badge, original line (muted strikethrough) → sharpened outcome, collapsed steps preview, and `Jump` (focus editor at anchor) / `Apply` (drives #10) / `Dismiss` actions. Empty state "No refinements right now — keep writing"; loading skeleton for the in-flight entry; per-entry error state. Additive to existing agent/transcription/recording sections. Acceptance: renders all states; jump focuses correct line; light/dark/soft-contrast pass.
- **Complexity:** M
- **Category:** frontend
- **Dependencies:** #4, #10
- **Files:** `src/components/activity/AgentPanel.tsx`, `src/components/activity/RefinementCard.tsx`

### 13. Top 5 per-document view
- **Description:** Rank the active document's pending refinements by verdict priority (`sharpen`/`split` > `defer` > `keep`) + recency, surface the top five (in the AgentPanel Refinements header and/or a `>`-palette entry "Show Top 5 actions"). Each row jumps to its line. v1 = active document only (project-wide is roadmap). Acceptance: correct ordering; each jumps correctly.
- **Complexity:** M
- **Category:** frontend
- **Dependencies:** #4
- **Files:** `src/lib/ai/refinement-rank.ts`, `src/components/activity/AgentPanel.tsx`

### 14. Settings toggle + provider line + CTA
- **Description:** Settings → AI: "Ambient action refinement" switch (default **off**). Show which connection the refinement slot resolves to (#5) with a "fires continuously — a local connection is recommended for privacy and cost" note; warn when the resolved connection is not local. When the slot is unset, show a "Configure refinement provider" CTA that deep-links to routing / the Local AI model picker (zero-config path = download a local model; reuse existing UX, build no new download flow). Acceptance: toggle persists in settings-store; CTA appears only when slot unresolved; non-local warning shows.
- **Complexity:** M
- **Category:** frontend
- **Dependencies:** #5
- **Files:** `src/components/settings/v2/` (AI panel), `src/stores/settings-store.ts` (add `ambientRefinementEnabled`)

---

## Wire-up

### 15. Mount, gating, and store rebuild on doc open
- **Description:** Mount `useRefinementWatcher` from `QuietLayout`, inert unless (a) `ambientRefinementEnabled` is on and (b) the refinement slot resolves (#5). On document open, parse existing `ns-refine` comments (#3) and `rebuildForDoc` (#4) so prior refinements repopulate the queue/decorations without re-analysis. Clear/swap store on document switch (single-doc shell). Acceptance: feature fully inert when off or unconfigured; reopening a doc with prior refinements shows them without new model calls.
- **Complexity:** M
- **Category:** frontend
- **Dependencies:** #9, #3, #14
- **Files:** `src/components/QuietLayout.tsx`

---

## Tests

### 16. Unit — engine dispatch fork
- **Description:** Test both `refineAction` paths with mocked transports: direct-API path (mocked `ai_chat_stream` stream → valid/invalid JSON), ACP path (mocked session reply → valid, malformed-then-retry, unparseable→error entry). Assert provider is resolved, never hardcoded. Acceptance: both paths covered incl. failure modes.
- **Complexity:** M
- **Category:** frontend
- **Dependencies:** #6, #7
- **Files:** `src/lib/ai/__tests__/refinement.test.ts`

### 17. Unit — hashing, watermark, comment round-trip, store
- **Description:** Tests for #2 (hash stability, LRU eviction), #3 (`serialize`→`parse` lossless, watermark divergence on edit, `strip`), and #4 (store actions produce new references, `rebuildForDoc`, `dismiss`/`markSeen`). Acceptance: full coverage of the foundation utilities.
- **Complexity:** M
- **Category:** frontend
- **Dependencies:** #2, #3, #4
- **Files:** `src/lib/ai/__tests__/refine-comment.test.ts`, `src/stores/__tests__/refinement-store.test.ts`

### 18. Tests — watcher gating + apply round-trip + perf
- **Description:** (a) Watcher behavior: typing within a block fires **no** analysis; block-commit fires **one** debounced call; clean line not re-analyzed (seen-set), edited line re-analyzed (hash divergence); backoff after repeated failures. (b) Apply round-trip: apply swaps text + inserts nested steps; parse→serialize→compare lossless. (c) Perf benchmark in `src/perf/` asserting per-keystroke cost is unchanged with the watcher mounted (no `[perf:typing]` regression). Acceptance: all green; `pnpm test:perf` within budget.
- **Complexity:** M
- **Category:** frontend
- **Dependencies:** #9, #15, #10
- **Files:** `src/hooks/__tests__/useRefinementWatcher.test.ts`, `src/lib/markdown/__tests__/` (round-trip), `src/perf/refinement.perf.test.ts`

---

## Open questions carried from the PRD

1. **Verdict taxonomy** (`keep/sharpen/split/defer/drop`) — reviewer-owned; affects #1, #6 prompt.
2. **Refinement routing slot** — reuse `agent_tasks` (assumed here) vs dedicated `refinement` slot. A dedicated slot would expand #5 and #14 and require an `AICapability` migration.
3. **Constrain slot to GBNF-capable connections?** — if yes, #5 filters out `agent_managed` and #7 becomes unnecessary for v1.

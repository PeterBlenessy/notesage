# PRD: Ambient Action-Refinement Engine

|  |  |
| --- | --- |
| **Date** | 2026-06-13 |
| **Status** | Draft |
| **Priority** | Medium |
| **Impact** | A local-only background AI quietly sharpens your action items as you write, surfaced on demand — never interrupting the flow. |
| **Tasks** | — (not yet planned) |
| **Phase** | Productivity Features |

## Problem

Notesage already extracts tasks from documents into a SQLite index (`type: goal` frontmatter, `- [ ]` task lists, parsed via comrak AST). But the tasks people actually write are vague: "follow up with the team", "fix the onboarding thing", "look into the perf issue". They capture intent, not a next action. The gap between *writing something down* and *having something you can do* is exactly where personal task systems leak.

Existing AI features can help, but every one of them is **pull-and-interrupt**: you stop writing, open the command bar, type a prompt, read a wall of suggestions, decide. That tax is high enough that nobody pays it mid-flow — so notes stay vague. There is no surface in Notesage where the AI *notices* a weak action item and offers, without being asked, a sharper version you can take or leave.

Why now: the three pieces needed to do this *without* violating Notesage's local-first ethos all exist. `local_bundled` (bundled llama-server) gives free, private, always-on inference. `generateStructured()` gives GBNF-grammar-guaranteed JSON on that path. The `AgentOrb` + `activity-store` already model "background work happened, here's a queue." This PRD assembles them into one ambient loop.

## Goals / Non-Goals

### Goals

1. **Ambient detection.** A background watcher analyzes action items *as the user writes* (on paragraph commit), incrementally — only new or changed lines, never re-scanning settled text — with zero per-keystroke cost.
2. **Sharper actions.** For each detected action item, produce a triaged verdict + a sharpened outcome + optional concrete sub-steps, with schema-guaranteed structure.
3. **Pull, never push.** The engine never injects content inline. It raises a single quiet availability signal (orb flash); the user chooses when to look. Reviewing and applying is one click.
4. **Local-only, private, free.** The engine runs exclusively on `local_bundled`. Nothing the user writes leaves the machine. No marginal cost per analysis. No cloud path exists.
5. **Top 5.** Surface the highest-priority refined actions across the document so the user can see, at a glance, what matters most — ranked by the engine's own verdicts.

### Non-Goals

- **No cloud inference.** Not even as an opt-in. (See Open Questions for the deferred reconsideration.)
- **No inline injection / autocomplete-style rewriting.** The engine does not edit the document on its own; apply is always an explicit user action.
- **No per-row gutter indicator in v1.** Precise per-line affordances need the unified left-gutter design that the editor docs have deferred twice. Orb-only for now.
- **No goal-alignment scoring** (against project frontmatter goals) in v1 — roadmap.
- **No scheduling / calendar view** in v1 — roadmap.
- **No new model download infrastructure.** v1 reuses the existing Local AI download UX; it does not build its own.

## User Stories

- As a writer drafting a planning note, I want the app to notice when I've written a vague to-do and quietly offer a sharper version, so that my notes become actionable without me stopping to ask.
- As someone in flow, I want refinements to wait silently until I'm ready, so that I'm never interrupted mid-sentence.
- As a reviewer of my own notes, I want to open one panel and see every pending suggestion, jump to its line, and accept or dismiss it in one click.
- As a privacy-conscious user, I want certainty that this analysis never leaves my machine, so that I can enable it on sensitive documents.
- As someone with a long task list, I want to see the top 5 things that matter most across this document, ranked by the AI's read, so that I know where to start.
- As a user without a local model, I want a clear, one-time prompt to download one (and the feature to stay silent otherwise), so that I'm not nagged or confused.

## Technical Approach

### Overview

```
 ┌─────────────┐   Enter/commit    ┌──────────────────┐  new/changed lines  ┌─────────────────┐
 │  Editor      │ ───(debounced)──▶ │ Refinement       │ ───────────────────▶ │ generateStructured │
 │ (ProseMirror)│                   │ Watcher          │   (skip watermarked) │ (local_bundled)  │
 └─────────────┘                    └──────────────────┘                      └─────────────────┘
        ▲                                   │                                          │
        │ apply (swap text)                 │ verdict+outcome+steps                    │ schema-valid JSON
        │                                   ▼                                          │
 ┌─────────────┐   click→jump      ┌──────────────────┐ ◀───────────────────────────────┘
 │ Refinement  │ ◀──────────────── │ refinement-store │
 │ NodeView /  │                   │  (queue, by line) │ ──flash──▶ AgentOrb / AgentPanel queue
 │ apply button│                   └──────────────────┘
 └─────────────┘                            │ persist (HTML comment on line + seen-set)
                                            ▼
                                     document markdown
```

### Detection — the watcher

A new hook `useRefinementWatcher` (mounted from `QuietLayout`, gated on the feature being enabled + a local model being ready) subscribes to the editor's transactions. It does **not** fire per keystroke. It fires on **paragraph commit** — a heuristic equivalent to "the user pressed Enter or moved off the block": the watcher tracks the block the cursor sits in and enqueues the *previous* block for analysis when the cursor leaves it, plus a trailing debounce (~1500 ms, tunable) so a fast typist crossing several blocks batches cleanly. This mirrors the existing `[perf:typing]` sampling discipline (DOM-read path, no React re-render per keystroke).

**Incremental processing.** Every candidate line is keyed by a content hash. Before dispatching to the engine the watcher checks two watermarks:

1. **Refined watermark** — an HTML comment already attached to the line (see Encoding) means it's been refined; skip unless the visible text no longer matches the comment's `src` hash (i.e. the user edited it since).
2. **Seen-set** — a content-hash set (`refinement-store.seen`) of lines the engine *looked at and had nothing to refine*. Without this, every Enter would re-analyze every clean line. Bounded LRU (e.g. 2000 entries), not persisted across restart (cheap to rebuild).

Only lines that pass both gates **and** look like action items reach the engine. Candidate detection reuses the index's task notion plus a lightweight client-side pre-filter (task-list items, imperative-leading paragraphs) so we don't spend a model call on prose.

### Running — the engine

The engine is a thin module `src/lib/ai/refinement.ts` exporting `refineAction(line, context)`. It calls `generateStructured<RefinementResult>()` with:

- `provider: 'local_bundled'` — **hard-coded, not routed.** The engine ignores `routing-store` entirely. This is the enforcement point for the local-only rule.
- a JSON schema for `RefinementResult` (see Data Model), `strict: true` → GBNF guarantees a schema-valid object on llama-server.
- a compact system prompt defining the verdict taxonomy and the "sharpen, don't pad" directive, plus minimal surrounding context (the line + its heading ancestry, not the whole doc, to keep the local context window cheap; reuses the `[perf:context]` trimming mindset).

Concurrency: one in-flight refinement at a time (a queue, FIFO), so the watcher can't stampede the single local server. Reuses the existing `ai_chat_stream` cancellation (`ai_chat_stream_cancel`) when the source line is deleted before its refinement returns.

### Surfacing — orb + queue

Results land in a new **`refinement-store`** (Zustand). Each entry is keyed by document path + line anchor. When a refinement with a non-`keep` verdict arrives, the store sets a `hasPending` flag that the `AgentOrb` reads to add its existing `.orb-pulsing` class (one flash cycle, then steady "has items" state) — no new animation code, reuses the CSS keyframe + `useReducedMotion` guard.

Clicking the orb opens `AgentPanel`, which gains a **Refinements** section listing pending entries: original text (struck) → sharpened outcome, verdict badge, and a "Jump to line" affordance that focuses the editor at the anchor. This is additive to the panel's existing agent/transcription/recording sections — it does **not** reuse `activity-store` (refinements are document-anchored suggestions, not lifecycle tasks; conflating them would muddy both models). The panel imports both stores.

### Encoding & persistence

Per the ledger's encoding split:

- **Sub-steps** render as a **nested task list** under the parent action line — standard markdown, round-trips losslessly through `prosemirror-markdown`, editable like any task list.
- **Refinement metadata** is an **HTML comment appended to the parent line**:

  ```markdown
  - [ ] Follow up with the team <!-- ns-refine:v1 verdict=sharpen src=a1b2c3 out="Email Priya by Fri to confirm Q3 scope" -->
  ```

  The comment is the durable record of the refinement (so it survives restart and is visible in raw markdown) **and** the "already analyzed" watermark. `src` is the content hash of the line at analysis time; if the visible text diverges from `src`, the line is re-analyzable. Markdown comments are already stripped from rendered output and ignored by the index parser, so this is invisible in the editor and safe in exports.

### Applying

A small ProseMirror decoration (not a full node-view) on lines carrying an unapplied `ns-refine` comment renders an inline **apply** affordance (✦ button at the line end, revealed on hover/focus — same restraint as the existing comment/close-doc hover affordances). Clicking swaps the visible action text for the comment's `out=` value via a single transaction, then rewrites the comment to `verdict=applied` so it won't re-offer. Reject/dismiss removes the entry from the queue and seeds the seen-set so it isn't re-raised. This reuses the established `AISuggestion` accept/reject mental model but is lighter (no diff decoration — the change is a one-line text swap).

### Top 5

A read-only view (rendered in the `AgentPanel` Refinements header, or a dedicated command-bar `>` palette entry "Show Top 5 actions") queries `refinement-store` across the active document, ranks by verdict priority (e.g. `sharpen`/`split` > `defer` > `keep`) and recency, and lists the five highest. Each row jumps to its line. v1 ranks within the **active document**; project-wide ranking via the SQLite index is a fast-follow once the per-document loop is proven.

### Gating & local-model readiness

The whole watcher is inert unless: (a) the feature toggle is on (Settings → AI, default **off** for v1 — opt-in while we tune), and (b) `local-ai-store` reports a downloaded, loadable model. When the toggle is on but no model is ready, the Settings row shows a "Download a local model" CTA that deep-links to the existing Local AI model picker (mirrors that panel's UX; builds no new download flow). No nagging elsewhere.

## UI/UX

- **Orb (idle):** unchanged — static neutral circle.
- **Orb (refinement pending):** one pulse cycle on arrival, then a steady count badge (reuses the running-count badge styling). Honors `prefers-reduced-motion` (no pulse; badge only).
- **AgentPanel → Refinements section:** list of cards. Each card: verdict badge (neutral grey pill — verdicts are not chromatic), original line in muted strikethrough, sharpened outcome in foreground, nested steps preview (collapsed), and `Jump` + `Apply` + `Dismiss` actions. Empty state: "No refinements right now — keep writing." Loading: a single in-flight card shows a subtle skeleton.
- **Inline apply affordance:** hover/focus-revealed ✦ button at line end; `--color-accent-primary` glyph, neutral otherwise. Tooltip ("Apply suggestion") wrapped in `TooltipProvider` per the mandatory rule.
- **Settings (AI):** "Ambient action refinement" switch (default off) + helper text naming the local-only guarantee, with the download CTA when no model is ready.
- **States:** loading (skeleton card), empty (copy above), error (per-entry: "Couldn't refine this line" with a retry; the watcher backs off after repeated local-server failures, mirroring `useLocalCompletion`'s 5-failure backoff).

All colors via tokens; verdict badges are neutral greys (no new chromatic tokens). Both light/dark + soft-contrast must pass.

## Data Model

```typescript
// src/lib/ai/refinement.ts
export type RefinementVerdict =
  | 'keep'     // already a clear, actionable next step — no change
  | 'sharpen'  // same task, made specific (owner / deadline / concrete outcome)
  | 'split'    // compound task → parent + nested sub-steps
  | 'defer'    // not actionable now — needs a precondition; flag it
  | 'drop';    // not an action at all (note/observation) — suggest removing the checkbox

export interface RefinementStep { text: string }

export interface RefinementResult {
  verdict: RefinementVerdict;
  /** Sharpened single-line outcome. Empty when verdict === 'keep'. */
  outcome: string;
  /** Concrete sub-steps; non-empty mainly for 'split'. */
  steps: RefinementStep[];
  /** One short clause explaining the verdict (shown on hover). */
  rationale: string;
}

// refinement-store (Zustand, not persisted — rebuilt from doc comments on open)
export interface RefinementEntry {
  id: string;
  docPath: string;
  /** ProseMirror anchor + source content hash for divergence detection. */
  anchor: { from: number; to: number };
  srcHash: string;
  originalText: string;
  result: RefinementResult;
  status: 'pending' | 'applied' | 'dismissed';
  createdAt: number;
}
```

- **Schema for `generateStructured`:** a JSON Schema mirror of `RefinementResult` with `verdict` as an enum, `strict: true`.
- **No new Tauri commands.** Detection, hashing, store, and apply are all frontend. Inference goes through the existing `ai_chat_stream` via `generateStructured()`. Persistence is via the existing `write_file` save path (the comment is part of the markdown).
- **No new Rust structs.** (The candidate pre-filter may later consult the existing index `tasks` query, but v1's pre-filter is client-side.)

## Dependencies

- **Existing, reused:** `generateStructured()` / `ai_chat_stream` (+ `ai_chat_stream_cancel`), `local-ai-store` + `local_bundled` server lifecycle, `AgentOrb` + `AgentPanel` + `.orb-pulsing` keyframe, `useReducedMotion`, the markdown round-trip pipeline, `prosemirror-markdown`, the SQLite index task parser (for the future project-wide Top 5).
- **New:** `useRefinementWatcher` hook, `src/lib/ai/refinement.ts`, `refinement-store`, a refinement decoration/apply extension, the Refinements section in `AgentPanel`, the Settings toggle.
- **No new third-party libraries.**
- **Prerequisite:** a downloaded `local_bundled` model — surfaced via existing Local AI UX, not built here.

## Quality Gates

### Functional

- [ ] With the toggle off, the watcher installs no listeners and makes zero model calls (verified by a no-op test).
- [ ] With the toggle on but no local model ready, the feature stays silent and Settings shows the download CTA.
- [ ] Typing within a block fires **no** analysis; committing/leaving a block fires **one** debounced analysis for that block.
- [ ] A clean line analyzed once is **not** re-analyzed on subsequent Enters (seen-set holds); an edited line **is** re-analyzed (src-hash divergence).
- [ ] The engine **only** ever calls `local_bundled` — a test asserts the provider argument is hard-coded and `routing-store` is never consulted.
- [ ] `generateStructured` output always parses to a valid `RefinementResult` (GBNF guarantee; covered by a schema test on llama-server, and a frontend test with a mocked valid/invalid stream).
- [ ] A non-`keep` result flashes the orb once and adds a queue entry; `keep` adds nothing and seeds the seen-set.
- [ ] Apply swaps the line text in one transaction, marks the comment `applied`, and removes the queue entry; the markdown round-trips losslessly (parse → serialize → compare).
- [ ] Sub-steps render as a nested task list and survive a save/reopen cycle unchanged.
- [ ] Deleting a source line before its refinement returns cancels the in-flight stream and drops the entry.
- [ ] Top 5 lists the five highest-ranked pending refinements for the active document; each jumps to its line.
- [ ] Repeated local-server failures back the watcher off (no infinite retry); it recovers on model/connection change.

### Design

- [ ] Orb pulse honors `prefers-reduced-motion` (badge-only fallback).
- [ ] Verdict badges and all chrome use neutral tokens — no new chromatic colors.
- [ ] Inline apply affordance is hover/focus-revealed, not always-on; tooltip wrapped in `TooltipProvider`.
- [ ] Refinements section looks at home next to the existing AgentPanel sections in both light/dark + soft contrast.
- [ ] Empty, loading, and error states are all designed (no raw/blank states).

### Engineering

- [ ] `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` green.
- [ ] `pnpm test:perf` within budget — the watcher must not regress `[perf:typing]`; add a benchmark asserting per-keystroke cost is unchanged with the watcher mounted.
- [ ] No coverage regressions in changed files.
- [ ] New `[perf:refine]` instrumentation category logs analysis dispatch, model latency, and skip/hit ratio.

## Out of Scope

Deferred to future phases (documented roadmap, not built in v1):

- **Per-row left-gutter indicator** — precise "this line has a suggestion" affordance. Blocked on the unified-gutter design already deferred for block drag handles and item annotations; will ride that work.
- **Goal-alignment scoring** — score each action against the project's `type: goal` frontmatter and flag misalignment. Reuses goals infra; adds a scoring field + UI.
- **Scheduling / calendar view** — surface dated refined actions on a timeline. Largest scope; needs date parsing + a new view.
- **Project-wide Top 5** — rank across all documents via the SQLite index (v1 ranks within the active document only).
- **Cloud provider for the engine** — explicitly excluded by the local-only rule; revisit only if a future privacy-preserving remote path is designed (see Open Questions).
- **Auto-apply / inline injection** — the engine will always remain pull-and-confirm.

## Open Questions

1. **Verdict taxonomy (proposed, reviewable).** Starter set: `keep` / `sharpen` / `split` / `defer` / `drop`. This covers "it's fine", "make it specific", "break it up", "blocked", and "this isn't a task". Open to collapsing `defer`+`drop` or adding `merge` (combine duplicate actions) after dogfooding. **Decision owner: reviewer of this PRD.**
2. **Commit heuristic tuning.** "Block exit + 1500 ms" is a starting point; the debounce and whether to also fire on explicit Enter-at-end-of-block should be tuned during implementation against real typing traces.
3. **Top 5 ranking weights.** Verdict-priority + recency is the v1 heuristic; may need a small learned/weighted scheme once project-wide ranking lands.

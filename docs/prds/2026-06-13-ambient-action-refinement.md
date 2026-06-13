# PRD: Ambient Action-Refinement Engine

|  |  |
| --- | --- |
| **Date** | 2026-06-13 |
| **Status** | Draft |
| **Priority** | Medium |
| **Impact** | A background AI quietly sharpens your action items as you write, surfaced on demand — never interrupting the flow. |
| **Tasks** | — (not yet planned) |
| **Phase** | Productivity Features |

> **Revision (2026-06-13):** the engine is no longer hard-pinned to `local_bundled`. It now **routes to whatever the user selected in the use-case mapping** (agent-agnostic — any direct-API local connection or an ACP agent backed by a local model server). Locality is the user's responsibility, **not** enforced by Notesage. This supersedes the original "local-only, hard rule" framing throughout. The privacy default is still *expected* to be a local connection, but it is a default, not a guarantee.

## Problem

Notesage already extracts tasks from documents into a SQLite index (`type: goal` frontmatter, `- [ ]` task lists, parsed via comrak AST). But the tasks people actually write are vague: "follow up with the team", "fix the onboarding thing", "look into the perf issue". They capture intent, not a next action. The gap between *writing something down* and *having something you can do* is exactly where personal task systems leak.

Existing AI features can help, but every one of them is **pull-and-interrupt**: you stop writing, open the command bar, type a prompt, read a wall of suggestions, decide. That tax is high enough that nobody pays it mid-flow — so notes stay vague. There is no surface in Notesage where the AI *notices* a weak action item and offers, without being asked, a sharper version you can take or leave.

Why now: the pieces needed to do this all exist. The connection/routing system (`routing-store` + capability-driven slots) already lets the user select *any* provider — a direct-API local connection or a local ACP agent — so the engine can stay agent-agnostic. `generateStructured()` gives GBNF-grammar-guaranteed JSON on the direct-API paths (`local_bundled` / `openai_compatible` / `ollama`). The `AgentOrb` + `activity-store` already model "background work happened, here's a queue." This PRD assembles them into one ambient loop. The privacy posture is local-*first* by default (we expect users to point the slot at a local connection) but not enforced — see the Revision note above.

## Goals / Non-Goals

### Goals

1. **Ambient detection.** A background watcher analyzes action items *as the user writes* (on paragraph commit), incrementally — only new or changed lines, never re-scanning settled text — with zero per-keystroke cost.
2. **Sharper actions.** For each detected action item, produce a triaged verdict + a sharpened outcome + optional concrete sub-steps, with schema-guaranteed structure.
3. **Pull, never push.** The engine never injects content inline. It raises a single quiet availability signal (orb flash); the user chooses when to look. Reviewing and applying is one click.
4. **Agent-agnostic, routed by selection.** The engine runs on whatever connection the user assigns to the refinement use-case slot — it never hardcodes a specific agent or binary. Local-first is the *expected* default (free, private), but not enforced; if the user points the slot at a cloud connection, that is their choice.
5. **Top 5.** Surface the highest-priority refined actions across the document so the user can see, at a glance, what matters most — ranked by the engine's own verdicts.

### Non-Goals

- **No hardcoded agent.** The engine must not assume a specific binary or provider — it reads the use-case selection, whatever it points at.
- **No Notesage-enforced locality.** The engine will not police whether the selected provider is on-device. Locality is a user responsibility (see Risks).
- **No inline injection / autocomplete-style rewriting.** The engine does not edit the document on its own; apply is always an explicit user action.
- **No per-row gutter indicator in v1.** Precise per-line affordances need the unified left-gutter design that the editor docs have deferred twice. Orb-only for now.
- **No goal-alignment scoring** (against project frontmatter goals) in v1 — roadmap.
- **No scheduling / calendar view** in v1 — roadmap.
- **No new model download infrastructure.** v1 reuses the existing Local AI download UX; it does not build its own.

## User Stories

- As a writer drafting a planning note, I want the app to notice when I've written a vague to-do and quietly offer a sharper version, so that my notes become actionable without me stopping to ask.
- As someone in flow, I want refinements to wait silently until I'm ready, so that I'm never interrupted mid-sentence.
- As a reviewer of my own notes, I want to open one panel and see every pending suggestion, jump to its line, and accept or dismiss it in one click.
- As a privacy-conscious user, I want to point the refinement engine at my own local provider so that my notes stay on my machine — and I accept that keeping it local is my choice of provider, not something the app enforces.
- As someone with a long task list, I want to see the top 5 things that matter most across this document, ranked by the AI's read, so that I know where to start.
- As a user with no AI configured, I want a clear, one-time prompt to set up a provider (defaulting to a local model), and the feature to stay silent otherwise, so that I'm not nagged or confused.

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

A new hook `useRefinementWatcher` (mounted from `QuietLayout`, gated on the feature being enabled + a connection resolvable from the refinement slot) subscribes to the editor's transactions. It does **not** fire per keystroke. It fires on **paragraph commit** — a heuristic equivalent to "the user pressed Enter or moved off the block": the watcher tracks the block the cursor sits in and enqueues the *previous* block for analysis when the cursor leaves it, plus a trailing debounce (~1500 ms, tunable) so a fast typist crossing several blocks batches cleanly. This mirrors the existing `[perf:typing]` sampling discipline (DOM-read path, no React re-render per keystroke).

**Incremental processing.** Every candidate line is keyed by a content hash. Before dispatching to the engine the watcher checks two watermarks:

1. **Refined watermark** — an HTML comment already attached to the line (see Encoding) means it's been refined; skip unless the visible text no longer matches the comment's `src` hash (i.e. the user edited it since).
2. **Seen-set** — a content-hash set (`refinement-store.seen`) of lines the engine *looked at and had nothing to refine*. Without this, every Enter would re-analyze every clean line. Bounded LRU (e.g. 2000 entries), not persisted across restart (cheap to rebuild).

Only lines that pass both gates **and** look like action items reach the engine. Candidate detection reuses the index's task notion plus a lightweight client-side pre-filter (task-list items, imperative-leading paragraphs) so we don't spend a model call on prose.

### Running — the engine

The engine is a thin module `src/lib/ai/refinement.ts` exporting `refineAction(line, context)`. It **reads the connection from the refinement use-case slot** (`routing-store`) — never a hardcoded provider — and dispatches by connection *shape*, mirroring how `useAIOperations` already routes the rest of the app:

- **Direct-API connections** (`local_bundled`, `openai_compatible`, `ollama`, `api_key`) → `generateStructured<RefinementResult>()` with the `RefinementResult` JSON schema and `strict: true`. On the GBNF-capable subset (`local_bundled` / `openai_compatible` / `ollama`) the grammar **guarantees** a schema-valid object; `api_key` cloud providers ignore the grammar and fall back to best-effort parse + retry.
- **`agent_managed` connections** (any ACP agent) → there is **no `ai_chat_stream`/`response_format` path** for ACP. The engine sends the refinement prompt through the ACP session and parses the agent's text reply as best-effort JSON (prompt asks for a fenced JSON block matching the schema; one reparse-on-failure retry). The hard GBNF guarantee does **not** hold here — this is the cost of agent-agnosticism. *(See Open Questions: which slot, and whether to constrain it to GBNF-capable connections for a stronger guarantee.)*

The system prompt (shared across both paths) defines the verdict taxonomy and the "sharpen, don't pad" directive, with minimal surrounding context (the line + its heading ancestry, not the whole doc — reuses the `[perf:context]` trimming mindset).

Concurrency: one in-flight refinement at a time (FIFO queue), so the watcher can't stampede the backing server/agent. Direct-API in-flight calls are cancelled via `ai_chat_stream_cancel`; ACP refinements are best-effort-abandoned (the source line was deleted) since ACP has no mid-prompt cancel primitive here.

**Default routing.** If the refinement slot is empty, the engine falls back to the `agent_tasks` slot (semantically the closest existing slot — delegated background analysis), and is inert if that is also empty. Whether refinement deserves its own first-class use-case slot vs. reusing `agent_tasks` is an Open Question.

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

The whole watcher is inert unless: (a) the feature toggle is on (Settings → AI, default **off** for v1 — opt-in while we tune), and (b) the refinement slot resolves to a usable connection (the assigned slot, falling back to `agent_tasks`). When the toggle is on but the slot is empty, the Settings row shows a "Configure refinement provider" CTA — for users with no AI set up at all, it deep-links to the Local AI model picker so the zero-config path is "download a local model" (mirrors that panel's UX; builds no new download flow). No nagging elsewhere.

## UI/UX

- **Orb (idle):** unchanged — static neutral circle.
- **Orb (refinement pending):** one pulse cycle on arrival, then a steady count badge (reuses the running-count badge styling). Honors `prefers-reduced-motion` (no pulse; badge only).
- **AgentPanel → Refinements section:** list of cards. Each card: verdict badge (neutral grey pill — verdicts are not chromatic), original line in muted strikethrough, sharpened outcome in foreground, nested steps preview (collapsed), and `Jump` + `Apply` + `Dismiss` actions. Empty state: "No refinements right now — keep writing." Loading: a single in-flight card shows a subtle skeleton.
- **Inline apply affordance:** hover/focus-revealed ✦ button at line end; `--color-accent-primary` glyph, neutral otherwise. Tooltip ("Apply suggestion") wrapped in `TooltipProvider` per the mandatory rule.
- **Settings (AI):** "Ambient action refinement" switch (default off) + a provider line showing which connection the refinement slot resolves to (with a "this fires continuously — a local connection is recommended for privacy and cost" note), and a CTA to configure the slot / download a local model when none is assigned.
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

- **Existing, reused:** `routing-store` / `connections-store` (provider selection), `generateStructured()` / `ai_chat_stream` (+ `ai_chat_stream_cancel`), the ACP session path in `useAIOperations` (for `agent_managed` selections), `AgentOrb` + `AgentPanel` + `.orb-pulsing` keyframe, `useReducedMotion`, the markdown round-trip pipeline, `prosemirror-markdown`, the SQLite index task parser (for the future project-wide Top 5).
- **New:** `useRefinementWatcher` hook, `src/lib/ai/refinement.ts` (with the direct-API vs ACP dispatch fork), `refinement-store`, a refinement decoration/apply extension, the Refinements section in `AgentPanel`, the Settings toggle + slot resolver display.
- **No new third-party libraries.**
- **Prerequisite:** a connection assigned to the refinement slot — any local ACP agent connection the user has registered, or a downloaded `local_bundled` model surfaced via existing Local AI UX.

## Quality Gates

### Functional

- [ ] With the toggle off, the watcher installs no listeners and makes zero model calls (verified by a no-op test).
- [ ] With the toggle on but no connection assigned to the refinement slot (and no `agent_tasks` fallback), the feature stays silent and Settings shows the configure CTA.
- [ ] Typing within a block fires **no** analysis; committing/leaving a block fires **one** debounced analysis for that block.
- [ ] A clean line analyzed once is **not** re-analyzed on subsequent Enters (seen-set holds); an edited line **is** re-analyzed (src-hash divergence).
- [ ] The engine resolves its provider from the refinement use-case slot (falling back to `agent_tasks`) — a test asserts it reads `routing-store` and hardcodes no binary/provider.
- [ ] Dispatch fork: a direct-API (GBNF-capable) selection produces a guaranteed-valid `RefinementResult`; an `agent_managed` selection parses the ACP text reply as best-effort JSON with one reparse retry, and surfaces a per-entry error (not a crash) when the reply is unparseable.
- [ ] A non-`keep` result flashes the orb once and adds a queue entry; `keep` adds nothing and seeds the seen-set.
- [ ] Apply swaps the line text in one transaction, marks the comment `applied`, and removes the queue entry; the markdown round-trips losslessly (parse → serialize → compare).
- [ ] Sub-steps render as a nested task list and survive a save/reopen cycle unchanged.
- [ ] Deleting a source line before its refinement returns cancels the in-flight stream and drops the entry.
- [ ] Top 5 lists the five highest-ranked pending refinements for the active document; each jumps to its line.
- [ ] Repeated backing-provider failures back the watcher off (no infinite retry); it recovers on model/connection/slot change.
- [ ] Changing the refinement slot's connection at runtime re-points the engine without a restart (no stale-provider capture).

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
- **Notesage-enforced locality** — kernel/sandbox enforcement that the selected refinement provider stays on-device is *not* in v1. It remains a possible future hardening (see Risks); v1 trusts the user's slot choice.
- **Auto-apply / inline injection** — the engine will always remain pull-and-confirm.

## Related Work

If a user wants to drive refinement with a **local ACP agent** (rather than a direct-API local connection), registering that agent is **separate, out-of-scope work** — provider/capability/option entries in `connections.ts`, binary resolution + versioning, the Seatbelt read-policy entry for the agent's config dir, and a network-sandbox allow for its local model endpoint. This PRD does not include that registration; the refinement engine simply consumes whatever connection is assigned to its slot, agnostically. Direct-API local connections (`local_bundled`, `ollama`, `openai_compatible`) need no such registration and work out of the box.

## Risks

- **No locality guarantee.** Because the engine routes to the user's selection and Notesage cannot introspect an ACP agent's model endpoint (the agent's model config is agent-side), the app cannot promise that ambient analysis stays on-device. Mitigation: a clear Settings note + local-first default; a future option could *enforce* locality via the network sandbox (deny-all-except-localhost) for the refinement connection, which would kernel-guarantee it — deferred.
- **Continuous-fire cost on a cloud selection.** If a user assigns a paid cloud connection to a slot that fires on every paragraph commit, cost accrues silently. Mitigation: the Settings provider line warns when the resolved connection is not local.
- **Degraded output guarantee on ACP.** `agent_managed` selections lose the GBNF schema guarantee (best-effort JSON parse). Mitigation: schema-shaped prompt + one reparse retry + per-entry error surfacing; consider constraining the slot to GBNF-capable connections (Open Question).

## Open Questions

1. **Verdict taxonomy (proposed, reviewable).** Starter set: `keep` / `sharpen` / `split` / `defer` / `drop`. This covers "it's fine", "make it specific", "break it up", "blocked", and "this isn't a task". Open to collapsing `defer`+`drop` or adding `merge` (combine duplicate actions) after dogfooding. **Decision owner: reviewer of this PRD.**
2. **Refinement routing slot.** Reuse `agent_tasks`, or add a dedicated `refinement` use-case slot/capability so users can point refinement at a different (cheaper/faster) agent than their heavy delegated-task agent? Default in this PRD: read a refinement slot, fall back to `agent_tasks`. **Reviewable.**
3. **Constrain the slot to GBNF-capable connections?** Restricting the refinement slot to `local_bundled`/`openai_compatible`/`ollama` would preserve the hard schema guarantee but exclude `agent_managed` ACP agents. Allowing `agent_managed` keeps it fully agent-agnostic at the cost of best-effort JSON. **Reviewable** — current PRD allows both.
4. **Commit heuristic tuning.** "Block exit + 1500 ms" is a starting point; the debounce and whether to also fire on explicit Enter-at-end-of-block should be tuned during implementation against real typing traces.
5. **Top 5 ranking weights.** Verdict-priority + recency is the v1 heuristic; may need a small learned/weighted scheme once project-wide ranking lands.

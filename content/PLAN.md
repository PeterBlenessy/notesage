# Content atoms — coverage & web-journey plan

Companion to [`content/README.md`](README.md). Defines the full set of feature
atoms, the marketing category taxonomy, and how the three-tier web journey maps
onto the atoms.

## Web journey (progressive disclosure)

Value-first hook at the top, then three tiers of feature depth:

1. **Landing** — value/outcome hero (the persona-value page), with a category grid as the "explore features" path.
2. **Category page** — each feature in the category, high-level (one paragraph). Grid of cards, not a wall of text.
3. **Feature deep-dive** — one page per feature: what it does, examples, when to use it, best practices, shortcuts, screenshot.

Each tier has a distinct job — deep-dive = persuasion + examples; in-app help = task steps; `docs/features/*` = engineering reference. Never duplicate across them.

## Atom schema (proposed growth)

Add to frontmatter:

```yaml
category: write            # which marketing group this feature belongs to
summary: "One line — the category-page card and meta description."
order: 10                  # sort within the category (optional)
```

Add an optional body section for tier 3:

```md
## [deep]
### What it does
...
### Example
...
### When to use it
...
### Tips
...
```

`[web]` stays the tier-2 high-level paragraph; `[deep]` is the tier-3 page.
Category intros live in `content/categories/<category>.md` (same frontmatter/section
convention). The facts-check's `KNOWN_SECTIONS` gains `deep`.

## Category taxonomy

| Category | The promise | Feature atoms |
|---|---|---|
| **Write** | A calm surface for words | `editor` · `focus-mode` · `find-replace` · `typography` |
| **Collaborate with AI** | Think alongside your notes | `ai-chat` · `ai-connections` · `comments` · `skills-agents` · `research` |
| **Organize** | Everything one glance away | `sidebar` · `search-index` · `tasks` · `tags-mentions` · `relations-backlinks` · `sync-workspace` · `git` |
| **Documents** | Read anything, deliver anything | `document-viewers` · `export` |
| **Voice** | Turn talking into notes | `voice` |
| **Automate** | Let Notesage do the routine | `automations` |

**Privacy & trust** is cross-cutting — it stays a **composed page**, not a feature atom (it pulls proof points from many atoms).

## Atom inventory & status

Legend: ✅ done · ▫️ to create · ⭐ flagship (full deep-dive first)

| Category | Atom | Status | Deep-dive | Screenshot |
|---|---|---|---|---|
| Write | `editor` | ✅ | ⭐ | editor-light/dark |
| Write | `focus-mode` | ▫️ | ⭐ | (needs one) |
| Write | `find-replace` | ▫️ | later | (reuse editor) |
| Write | `typography` | ▫️ | later | (settings preview) |
| AI | `ai-chat` | ✅ | ⭐ | ai-chat, quiet-composer-light/dark |
| AI | `ai-connections` | ▫️ | ⭐ | (needs one) |
| AI | `comments` | ✅ | later | (needs one) |
| AI | `skills-agents` | ▫️ | later | (needs one) |
| AI | `research` | ▫️ | later | (needs one) |
| Organize | `sidebar` | ✅ | ⭐ | sidebar |
| Organize | `search-index` | ▫️ | ⭐ | (needs one) |
| Organize | `tags-mentions` | ▫️ | later | (needs one) |
| Organize | `relations-backlinks` | ▫️ | later | (needs one) |
| Organize | `sync-workspace` | ▫️ | later | (needs one) |
| Organize | `git` | ▫️ | later | (needs one) |
| Documents | `document-viewers` | ✅ | later | document-viewer |
| Documents | `export` | ✅ | ⭐ | export-dialog |
| Voice | `voice` | ✅ | ⭐ | voice-transcription |
| Automate | `automations` | ▫️ | ⭐ | (needs one) |

**Status (updated):** **20 atoms** at tier-2 + **6 category intros** + **10 `[deep]` dives** (editor, focus-mode, ai-chat, ai-connections, sidebar, search-index, tasks, export, voice, automations). Every category page assembles; both suites green (181 assertions).

**Tidy done:** the two per-feature marketing files (`feature-tour.md`, `ai-connections.md`) were dropped (superseded by the atoms), and all composed pages + screenshots were moved out of `docs/marketing/` into `content/` — **`docs/marketing/` no longer exists**. Tests updated + renamed to `content-pages.test.ts`.

**Content layout now (single root under `content/`):**

- `content/features/*.md` — 20 feature atoms (source of feature pages, in-app, social).
- `content/categories/*.md` — 6 category intros.
- `content/pages/*.md` — 6 **composed pages** (pitch · use-cases/persona-value · privacy · getting-started · about-copy · shortcuts-highlights).
- `content/screenshots/*.png` — shared screenshots (+ capture `README.md`).
- `docs/help/connecting-ai.md` — in-app connection setup guidance (stays — it's in-app help, not site content).

**Optional next:** add deep-dives to the non-flagship atoms as demand warrants.

## Sequencing

1. **Agree** the taxonomy + the `category`/`summary`/`[deep]` schema growth.
2. **Backfill facts** on the 7 existing atoms (add `category` + `summary`).
3. **Category intros** — `content/categories/*.md` (6 short files).
4. **Fill remaining atoms** category by category (tier-2 `[web]` first — cheap, unlocks the category pages).
5. **Deep-dives** for the 9 flagships (tier-3 `[deep]`), then the rest as needed.
6. **Composed pages** — pitch, getting-started, the persona-value page, privacy — reference atoms; drop the redundant `feature-tour.md`.

Screenshots are tracked separately — many features still need a real capture (the current PNGs are placeholders).

# Dependency Health Report — 2026-07-05

**App version:** 0.48.0-alpha.12 (was 0.36.0 at last audit, `2026-04-18-dependencies.md`)
**Node:** v22.22.2 · **pnpm:** 10.33.0 · **Rust:** 1.94.1 (cargo 1.94.1) · **cargo-audit:** 0.22.2 (installed during this run; advisory-db 1,156 advisories)

## Summary

| Metric | Value | vs 2026-04-18 |
| --- | --- | --- |
| npm direct deps (prod) | 92 | 94 (−2) |
| npm dev deps | 22 | 21 (+1) |
| npm total direct | 114 | 115 |
| npm transitive (pnpm audit scope) | 1,212 | ~1,313 |
| `node_modules` size | 838 MB | 1.3 GB (−36%) |
| Cargo direct deps (Cargo.toml) | ~64 (61 prod incl. 2 macOS-only + 1 build + 2 dev) | 57 |
| Cargo transitive (Cargo.lock) | 1,035 crate deps | 944 |
| **npm vulnerabilities** | **0** | 3 (all fixed) |
| **Cargo vulnerabilities** | **0** | 2 (rustls-webpki — fixed) |
| Cargo advisory *warnings* (unmaintained/unsound) | 22 | 24 |
| Major upgrades available | 1 npm (pdfjs-dist 5→6) + several Rust (see §5) | 2 |
| Stale packages (12mo+) | 4 npm | 2 |
| License concerns | 2 prod (khroma, duck) + 1 dev (css-value) | 3 (LGPL sharp now gone) |

### Headline: both ecosystems are vulnerability-clean

- **`pnpm audit`: 0 vulnerabilities found (ran 2026-07-05).** All 3 npm findings from April (dompurify, hono, basic-ftp) are resolved — dompurify is now `3.4.11`, and the `hono >=4.12.14` + `basic-ftp >=5.3.1` overrides are in place.
- **`cargo audit`: 0 vulnerabilities, 22 warnings (ran 2026-07-05).** Both `rustls-webpki` CVEs (RUSTSEC-2026-0098/0099) are fixed — the crate resolves to `0.103.13` (patched ≥0.103.12). The `rand` unsoundness (RUSTSEC-2026-0097) no longer appears at all: the old `rand 0.7.3` is gone and the tree is now on `rand 0.8.6`/`0.9.4`.

## Recommendations

1. **Immediate (security):** None. No open CVEs in either ecosystem.
2. **Short-term (quality/hygiene):**
   - Batch-bump the 25 `@tiptap/*` packages `3.23.6 → 3.27.1` (4 minors behind — the single largest staleness cluster).
   - Evaluate `pdfjs-dist 5.7.284 → 6.1.200` (the only npm major; PDF parsers are a real attack surface — see §5).
   - Align the two Rust `reqwest` versions (0.12.28 + 0.13.3) — persisting duplicate TLS stack.
   - **Extend CI** (see the MEDIUM CI finding): the `cargo-audit` job is `continue-on-error: true` and there is no npm-side `pnpm audit` gate and no license/outdated gate anywhere. Now that both trees are vulnerability-clean, this is the moment to flip the Rust job to blocking and add a `pnpm audit` step.
3. **Monitor (no action needed now):**
   - 22 Rust unmaintained/unsound *warnings*, all deep-transitive (gtk-rs Linux stack, typst/syntect, tauri build macros). One is new since April: `ttf-parser 0.25.1` (RUSTSEC-2026-0192, dated 2026-06-28).
   - Persisting stale npm shims (`diff-match-patch`, `markdown-it-sub`/`-sup`) plus one newly-flagged (`markdown-it-task-lists`).
   - Pre-1.0 / deliberately-pinned Rust majors (`agent-client-protocol` 0.14→1.0, `typst` 0.14→0.15, `keyring` 3→4, `dirs` 5→6, `sysinfo` 0.35→0.39).

---

## Findings

### INFO: Both dependency trees are vulnerability-free
**File:** `package.json` / `src-tauri/Cargo.lock`
`pnpm audit` reports 0 vulnerabilities across 1,212 dependencies; `cargo audit` reports 0 vulnerabilities across 1,035 crate dependencies. Every finding from the 2026-04-18 audit (dompurify GHSA-39q2-94rc-95cp, hono GHSA-458j-xx4x-4375, basic-ftp GHSA-rp42-5vxx-qpwr, rustls-webpki RUSTSEC-2026-0098/0099, rand RUSTSEC-2026-0097) is now closed.
**Fix:** None required. Preserve the pnpm overrides that hold these fixes (`hono >=4.12.14`, `basic-ftp >=5.3.1`) and keep `rustls-webpki` from regressing below 0.103.12 on the next `cargo update`.

### MEDIUM: CI Rust dependency audit is non-blocking and npm side is ungated
**File:** `.github/workflows/test.yml:240-261` (`cargo-audit` job) and the whole `frontend-tests` job
The `Rust Dependency Audit (advisory)` job installs `cargo-audit --locked` and runs `cargo audit`, but is `continue-on-error: true` (line 249) — its own comment says to "flip `continue-on-error` to false once the tree is confirmed clean." As of this run the Rust tree **is** confirmed clean (0 vulns). Separately, there is **no** `pnpm audit` step anywhere in CI — the npm tree is only audited manually. There is also no `cargo-outdated`, `cargo-deny`, or license check in CI.
**Fix:** (1) Set `continue-on-error: false` on the `cargo-audit` job now that vulns are 0 — advisories will still be *warnings* (not failures) because cargo audit only fails on actual vulnerabilities, not the 22 `unmaintained` warnings, so this won't cause false CI reds. Optionally add `[advisories] ignore = [...]` in `src-tauri/audit.toml` if warnings should later gate too. (2) Add a `pnpm audit --audit-level=high` step to the `frontend-tests` job. (3) Consider `cargo-deny` for a combined license + advisory + duplicate-version gate, extending (not duplicating) the existing job.

### LOW: New Rust unmaintained advisory — `ttf-parser` (since last audit)
**File:** `ttf-parser@0.25.1` — path: `fontdb 0.23 → krilla-svg 0.3 → typst-pdf 0.14.2` (and `fontdb` directly)
RUSTSEC-2026-0192 (published 2026-06-28, i.e. after the April audit) marks `ttf-parser 0.25.1` unmaintained. Reached via the Typst PDF-export font stack and `fontdb`. Unmaintained ≠ vulnerable; no CVE. This is one of the 22 warnings.
**Fix:** Not directly actionable at the Cargo.toml level (transitive under `typst-pdf`/`fontdb`). Bumping `fontdb 0.23 → newer` and `typst 0.14.2 → 0.15.0` may pull a maintained fork later. Monitor; no exposure today.

### LOW: 22 Rust unmaintained/unsound advisory warnings (persisting, mostly Linux-only)
**File:** `src-tauri/Cargo.lock` (see per-crate paths below)
`cargo audit` emits 22 `warning:` advisories (down from 24 — `fxhash` is gone after `scraper 0.23 → 0.27`). None are vulnerabilities. Breakdown:

| Crate | Version | Advisory | Kind | Reached via |
| --- | --- | --- | --- | --- |
| atk, atk-sys, gdk, gdk-sys, gdkwayland-sys, gdkx11, gdkx11-sys, gtk, gtk-sys, gtk3-macros (10) | 0.18.2 | RUSTSEC-2024-0411…0420 | unmaintained | gtk-rs GTK3 bindings — Linux-only via `tray-icon`/`muda`/`tao`/`webkit2gtk` |
| glib | 0.18.5 | RUSTSEC-2024-0429 | unsound | same Linux gtk stack |
| proc-macro-error | 1.0.4 | RUSTSEC-2024-0370 | unmaintained | `glib-macros` (Linux gtk stack) |
| bincode | 1.3.3 | RUSTSEC-2025-0141 | unmaintained | `syntect` → `comrak` / `ppt-rs` / `two-face` → `typst-library` |
| yaml-rust | 0.4.5 | RUSTSEC-2024-0320 | unmaintained | `syntect` → `comrak` / `ppt-rs` / `typst-library` |
| ttf-parser | 0.25.1 | RUSTSEC-2026-0192 | unmaintained | `fontdb` / `krilla-svg` → `typst-pdf` |
| paste | 1.0.15 | RUSTSEC-2024-0436 | unmaintained | `biblatex` → `hayagriva` → `typst-library` |
| instant | 0.1.13 | RUSTSEC-2024-0384 | unmaintained | `notify-types` → `notify` / `notify-debouncer-full` (cross-platform, actually used) |
| unic-char-property, unic-char-range, unic-common, unic-ucd-ident, unic-ucd-version (5) | 0.9.0 | RUSTSEC-2025-0075/0080/0081/0098/0100 | unmaintained | `urlpattern` → `tauri-plugin-http`; `tauri-utils` build path |

The gtk-rs cluster (10) + glib + proc-macro-error = 12 of the 22 are **Linux-target-only** — Notesage is macOS-first (metal whisper, `apple-native` keyring, objc2), so these compile only in a Linux build. The remainder are in the Typst/comrak/syntect export stack and Tauri's own build/runtime crates.
**Fix:** None actionable at the direct-dep edge. The typst-stack warnings (`bincode`, `yaml-rust`, `ttf-parser`, `paste`) would clear if `typst 0.14.2 → 0.15.0` / `comrak 0.52 → 0.53` pull maintained deps. `instant` clears when `notify 7 → 8+` (currently only RC). Track upstream; keep the advisory job green for *vulns* only.

### MEDIUM: 25 Tiptap packages are 4 minor versions behind
**File:** `package.json` — `@tiptap/* 3.23.6` → `3.27.1`
The entire Tiptap suite (core, pm, react, starter-kit, suggestion, and 20 extensions) is pinned at `3.23.6` while `3.27.1` is published. Non-breaking (same major), but this is the largest single staleness cluster and drifts every audit.
**Fix:** Single coordinated bump of all 25 `@tiptap/*` entries to `^3.27.1`, then run `pnpm test` + the markdown round-trip suite (Tiptap schema changes ride these minors).

### MEDIUM: `pdfjs-dist` major upgrade available (5 → 6) — security-relevant parser
**File:** `package.json` — `pdfjs-dist ^5.7.284` → `6.1.200`
The only npm major upgrade pending. PDF parsers are a recurring source of memory-safety / DoS CVEs, so staying current on the major line matters more here than for a typical dep. v6 drops older browser targets and changes the worker/module entry points.
**Fix:** Plan a scoped upgrade: verify the `pdfjs-dist` worker import path and any `GlobalWorkerOptions` usage in the PDF preview/render code, then bump to `^6.1.200`. Migration effort S–M.

### LOW: `agent-client-protocol` 1.0 released — Rust ACP crates deliberately pinned pre-1.0
**File:** `src-tauri/Cargo.toml` — `agent-client-protocol 0.14.0` → `1.0.1`, `agent-client-protocol-schema =0.13.6` → `1.2.0`
The Rust ACP crates hit 1.0. The manifest pins `0.14.0` (with three `unstable_*` features) and the schema crate to exactly `=0.13.6` because 0.14.0 requires them to move in lockstep. The 1.0 line very likely stabilizes / renames those `unstable_*` features. This is a deliberate pin, not neglect.
**Fix:** Defer to a focused ACP-upgrade task. Bump both crates to the 1.x line together, drop the now-stabilized `unstable_session_fork`/`unstable_auth_methods`/`unstable_end_turn_token_usage` feature flags if they've graduated, and re-verify session fork/resume + per-turn token-usage handling in `acp/`. Effort M.

### LOW: Persisting Rust `reqwest` version duplication (0.12 + 0.13)
**File:** `src-tauri/Cargo.lock` — `reqwest 0.12.28` (direct + tauri-plugin-http) and `reqwest 0.13.3` (tauri-plugin-updater)
Same split as April — two reqwest majors pull two rustls chains, roughly doubling the TLS footprint. `reqwest` latest is `0.13.4`, so the direct `reqwest = "0.12"` is now a major behind the plugin's line.
**Fix:** When convenient, bump the direct dep to `reqwest = "0.13"` to align with `tauri-plugin-updater` and collapse the duplicate. Requires checking the `stream`/`json` feature usage and the `reqwest::Client` call sites (minor API deltas 0.12→0.13). Not urgent.

### INFO: Rust staleness / minor-behind direct crates
**File:** `src-tauri/Cargo.toml`
Beyond the majors called out above, these direct crates trail crates.io latest (all pre-1.0 "minor" = potentially breaking): `sysinfo 0.35 → 0.39`, `cpal 0.17 → 0.18`, `usvg`/`resvg 0.45 → 0.47`, `rusqlite 0.39 → 0.40`, `comrak 0.52 → 0.53`, `typst* 0.14.2 → 0.15.0`, plus stable-major `dirs 5 → 6` and `keyring 3 → 4`, and patches `tauri 2.11.1 → 2.11.5`, `ppt-rs 0.2.14 → 0.2.19`. `sentry 0.42` is intentionally pinned (Cargo.toml comment) to match `tauri-plugin-sentry 0.5`'s internal version — do **not** bump it standalone.
**Fix:** Opportunistic minor bumps during a maintenance window; none are security-driven. See §5 for the major-upgrade evaluations.

### INFO: npm staleness — persisting shims plus one new flag
**File:** `package.json` — `diff-match-patch`, `markdown-it-sub`, `markdown-it-sup`, `markdown-it-task-lists`
`markdown-it-task-lists@2.1.1` (added since April) last published **2022-06-19 (~49 months)** — newly stale. `diff-match-patch@1.0.5` (2022-06-15, ~49mo) and `markdown-it-sub`/`-sup@2.0.0` (2023-12-05, ~31mo) persist from April. `tippy.js@6.3.7` (2025-06-09) is now ~13 months — just over the 12-month line, borderline. All are small, feature-complete, single-purpose, CVE-free.
**Fix:** No action — these are "finished," not "broken" (matches April's documented rationale). `markdown-it-task-lists` is a ~50-LOC plugin; keep as-is unless a bug surfaces. Note `@tippyjs/react` from April is now fully removed; `tippy.js` is used directly.

### INFO: License concerns — two undeclared-license packages ship in prod
**File:** `khroma@2.1.0` (prod, via `mermaid`), `duck@0.1.12` (prod, via `mammoth → lop`)
Production tree (572 unique packages) is overwhelmingly permissive (475 MIT, 44 ISC, 13 Apache-2.0). Two flagged: `khroma` declares no `license` field (persisting from April; bundled LICENSE is MIT in practice) and `duck` declares bare `BSD` with no clause count. `css-value@0.0.1` (Unknown) is **dev-only** (via `webdriverio`), so it does not ship. `jszip` is `(MIT OR GPL-3.0-or-later)` — pick MIT, no risk. **The April LGPL concern (`@img/sharp-libvips-darwin-arm64`) is gone** — no LGPL/GPL/AGPL anywhere in the prod tree now.
**Fix:** No legal blocker. For a clean SBOM, record `khroma`=MIT and `duck`=BSD (verify 2/3-clause in its repo) as manually-resolved. `cargo-license` is still not installed for the Rust side — install it (`cargo install cargo-license`) to close the Rust SBOM gap; manual read of `Cargo.toml` shows the app is MIT and direct crates are permissive (Tauri/serde/tokio dual MIT-OR-Apache; resvg/usvg/fontdb MPL-2.0 file-level; comrak BSD-2-Clause).

---

## Section 1: npm Dependency Inventory (SBOM)

Run 2026-07-05. Sources: `pnpm ls --depth=0`, `pnpm outdated --format=json`, `pnpm audit --json`. **0 packages are Vulnerable.** Packages not listed below are **Current**.

### Production dependencies (92) — outdated subset (all others Current)

| Package | Current | Latest | Type | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| @codemirror/commands | 6.10.3 | 6.10.4 | dep | Patch available | — |
| @codemirror/language | 6.12.3 | 6.12.4 | dep | Patch available | — |
| @codemirror/search | 6.7.0 | 6.7.1 | dep | Patch available | — |
| @codemirror/state | 6.6.0 | 6.7.1 | dep | Minor available | — |
| @codemirror/view | 6.43.0 | 6.43.5 | dep | Patch available | — |
| @lezer/markdown | 1.6.3 | 1.6.4 | dep | Patch available | — |
| @radix-ui/react-visually-hidden | 1.2.4 | 1.2.7 | dep | Patch available | — |
| @sentry/browser | 10.56.0 | 10.63.0 | dep | Minor available | New dep since April (telemetry). |
| @tauri-apps/api | 2.11.0 | 2.11.1 | dep | Patch available | — |
| @tiptap/* (25 packages) | 3.23.6 | 3.27.1 | dep | Minor available | 4 minors behind; batch bump — see finding. |
| lucide-react | 1.16.0 | 1.23.0 | dep | Minor available | — |
| markdown-it | 14.2.0 | 14.3.0 | dep | Minor available | New dep since April. |
| mermaid | 11.15.0 | 11.16.0 | dep | Minor available | Under `mermaid >=10.9.4` override. |
| picomatch | 4.0.4 | 4.0.5 | dep | Patch available | Also a pinned override. |
| pdfjs-dist | 5.7.284 | 6.1.200 | dep | **Major available** | Security-relevant parser — see finding. |
| radix-ui | 1.4.3 | 1.6.1 | dep | Minor available | Meta-package. |
| react | 19.2.6 | 19.2.7 | dep | Patch available | — |
| react-dom | 19.2.6 | 19.2.7 | dep | Patch available | — |
| react-resizable-panels | 4.11.1 | 4.12.1 | dep | Minor available | — |
| recharts | 3.8.1 | 3.9.2 | dep | Minor available | Pinned exactly to `3.8.1` in package.json. |
| zustand | 5.0.13 | 5.0.14 | dep | Patch available | — |

New prod deps since April: `@sentry/browser`, `@tauri-apps/plugin-clipboard-manager`, `@tauri-apps/plugin-deep-link`, `linkedom` (0.18.12, current), `markdown-it`, `markdown-it-task-lists`. Removed: `@agentclientprotocol/claude-agent-acp`, `@tippyjs/react`. `react-day-picker` bumped 9→10 (major, done). All `@codemirror/lang-*`, `@tauri-apps/plugin-*`, and remaining prod deps are **Current**.

### Dev dependencies (22) — outdated subset

| Package | Current | Latest | Type | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| @playwright/test | 1.60.0 | 1.61.1 | dev | Minor available | — |
| @tailwindcss/vite | 4.3.0 | 4.3.2 | dev | Patch available | — |
| @tauri-apps/cli | 2.11.1 | 2.11.4 | dev | Patch available | — |
| @types/react | 19.2.14 | 19.2.17 | dev | Patch available | — |
| @vitejs/plugin-react | 6.0.2 | 6.0.3 | dev | Patch available | — |
| @vitest/coverage-istanbul | 4.1.6 | 4.1.9 | dev | Patch available | Pinned exactly. |
| @wdio/cli, @wdio/local-runner, @wdio/mocha-framework, @wdio/spec-reporter, webdriverio | 9.27.1 | 9.29.1 | dev | Minor available | Bump the WDIO suite together. |
| jsdom | 29.0.2 | 29.1.1 | dev | Minor available | — |
| tailwindcss | 4.3.0 | 4.3.2 | dev | Patch available | — |
| vite | 8.0.16 | 8.1.3 | dev | Minor available | — |
| vitest | 4.1.6 | 4.1.9 | dev | Patch available | — |

### Active pnpm overrides (20 total)

`yaml >=2.9.0`, `picomatch >=4.0.4`, `serialize-javascript >=7.0.5`, `@xmldom/xmldom >=0.9.10`, `nanoid >=5.0.9`, `mermaid >=10.9.4`, `lodash >=4.18.0`, `lodash-es >=4.18.0`, `basic-ftp >=5.3.1`, `@anthropic-ai/sdk >=0.81.0`, `hono >=4.12.14`, `uuid >=14.0.0`, `postcss >=8.5.10`, `fast-xml-parser >=5.5.10`, `ws >=8.20.1`, `esbuild >=0.28.1`, `undici@^6 >=6.27.0 <7`, `undici@^7 >=7.28.0 <8`, `js-yaml >=4.2.0`, `@babel/core >=7.29.6 <8`.

**Note:** April flagged `lodash`/`lodash-es >=4.18.0` as a no-op typo. This is now **naturally resolved** — the npm registry reports `lodash@4.18.1`/`lodash-es@4.18.1` as latest, and the tree resolves both to `4.18.1`. Likewise `uuid >=14.0.0` resolves to the real `uuid@14.0.0`. Both overrides are now valid (no action).

---

## Section 2: Cargo Dependency Inventory

Run 2026-07-05. Sources: `cargo tree --depth=1`, `cargo audit`, `cargo search <crate>` for latest (cargo-outdated not installed — building it needs the same long compile as cargo-audit; `cargo search` against crates.io was used instead). Crates not listed are Current.

| Crate | Declared | Resolved (Cargo.lock) | Latest (crates.io) | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| tauri | 2 | 2.11.1 | 2.11.5 | Patch available | Tracks plugin versions. |
| reqwest | 0.12 | 0.12.28 (+0.13.3 via updater) | 0.13.4 | Major available | Duplicate with plugin — see finding. |
| comrak | 0.52.0 | 0.52.0 | 0.53.0 | Minor available | Pinned. |
| rusqlite | 0.39 | 0.39.0 | 0.40.1 | Minor available | `bundled`. Bumped 0.34→0.39 since April. |
| scraper | 0.27 | 0.27.0 | 0.27.0 | Current | Bumped 0.23→0.27; dropped `fxhash`. |
| whisper-rs | 0.16 | 0.16.0 | 0.16.0 | Current | `metal` on macOS. |
| cpal | 0.17 | 0.17.3 | 0.18.1 | Minor available | Pre-1.0 = breaking. |
| typst / typst-pdf / typst-syntax | 0.14.2 | 0.14.2 | 0.15.0 | Minor available | Pre-1.0; would clear several transitive warnings. |
| sysinfo | 0.35 | 0.35.2 | 0.39.5 | Minor available (×4) | Pre-1.0. |
| dirs | 5 | 5.0.1 | 6.0.0 | Major available | Low priority. |
| keyring | 3 | 3.6.3 | 4.1.3 | Major available | `apple-native`. |
| agent-client-protocol | 0.14.0 | 0.14.0 | 1.0.1 | Major available | Pinned w/ unstable features — see finding. |
| agent-client-protocol-schema | =0.13.6 | 0.13.6 | 1.2.0 | Major available | Locked to acp crate. |
| usvg / resvg | 0.45 | 0.45.1 | 0.47.0 | Minor available | — |
| ppt-rs | 0.2 | 0.2.14 | 0.2.19 | Patch available | Pre-1.0. |
| sentry | 0.42 | 0.42.0 | 0.48.3 | Pinned (do not bump) | Must match tauri-plugin-sentry 0.5. |
| notify | 7 | 7.0.0 | 8.x (9.0-rc) | Minor available | Latest stable trails RCs. Carries `instant` warning. |
| fontdb | 0.23 | 0.23.0 | 0.23.0 | Current | Carries `ttf-parser` warning transitively. |
| font-kit | 0.14 | 0.14.3 | 0.14.3 | Current | — |
| docx-rs | 0.4 | 0.4.20 | 0.4.20 | Current | — |
| saffron | 0.1 | 0.1.0 | 0.1.0 | Current | **New niche dep** (cron parser), pre-1.0, single 0.1.0 release — low surface, monitor. |
| tauri-plugin-sentry | 0.5.0 | 0.5.0 | 0.5.0 | Current | New. |
| tauri-plugin-aptabase | 1.0.0 | 1.0.0 | 1.0.0 | Current | New (telemetry). |
| objc2 / objc2-app-kit | 0.6 / 0.3 | (macOS target) | 0.6.4 | ~Current | New macOS-only. |
| chrono-tz (dev) | 0.10 | 0.10.4 | 0.10.4 | Current | New dev dep. |

New Cargo direct deps since April: `saffron`, `url`, `time`, `sentry`, `tauri-plugin-sentry`, `tauri-plugin-aptabase`, `tauri-plugin-clipboard-manager`, `tauri-plugin-deep-link`, `objc2`, `objc2-app-kit`, `chrono-tz` (dev). **Removed from Cargo.toml as direct deps (deep-review batch 2): `async-trait`, `typst-library`, `typst-utils`** — note both `async-trait 0.1` and `typst-library 0.14.2` still appear in Cargo.lock as *transitive* deps (typst-library via `typst`, `typst-eval`, etc.), so their trees are unchanged; only the direct edges were dropped.

---

## Section 3: Security Vulnerabilities

**pnpm audit: 0 vulnerabilities found (ran 2026-07-05).** (1,212 deps scanned.)

**cargo audit: 0 vulnerabilities found (ran 2026-07-05).** 1,035 crate deps scanned against 1,156 advisories; 22 informational `warning` advisories (unmaintained/unsound), fully enumerated above. cargo-audit was **not** pre-installed — it was installed during this run (`cargo install cargo-audit --locked`, v0.22.2), so this section is authoritative, not a gap (unlike April).

Comparison to 2026-04-18:

| April finding | Status now |
| --- | --- |
| basic-ftp GHSA-rp42-5vxx-qpwr (high, dev) | **Fixed** — override `basic-ftp >=5.3.1` |
| dompurify GHSA-39q2-94rc-95cp (moderate) | **Fixed** — now 3.4.11 |
| hono GHSA-458j-xx4x-4375 (moderate) | **Fixed** — override `hono >=4.12.14` |
| rustls-webpki RUSTSEC-2026-0098 (moderate) | **Fixed** — now 0.103.13 |
| rustls-webpki RUSTSEC-2026-0099 (moderate) | **Fixed** — now 0.103.13 |
| rand RUSTSEC-2026-0097 (unsound) | **Fixed/gone** — old rand 0.7.3 removed; tree on 0.8.6/0.9.4 |

---

## Section 4: Staleness Analysis

| Package | Last Release | Age | Risk | Alternative |
| --- | --- | --- | --- | --- |
| diff-match-patch (npm) | 2022-06-15 | ~49 mo | Low — algorithmically stable, CVE-free, used in editor/diff | `jsdiff` (changes hunk output) — optional |
| markdown-it-task-lists (npm) | 2022-06-19 | ~49 mo | Low — ~50 LOC plugin, **newly flagged** (added since April) | Inline or keep as-is |
| markdown-it-sub (npm) | 2023-12-05 | ~31 mo | Low — frozen spec | Keep |
| markdown-it-sup (npm) | 2023-12-05 | ~31 mo | Low — frozen spec | Keep |
| tippy.js (npm) | 2025-06-09 | ~13 mo | Low — just crossed 12-mo line | Monitor; Radix Tooltip if it decays |
| saffron (Cargo) | pre-1.0, single 0.1.0 | — | Low — new niche cron crate, single maintainer | Monitor; `cron`/`croner` if abandoned |

All other direct npm and Cargo deps have released within 12 months or are widely-used ecosystem staples. `linkedom` (2025-08), `docx-preview` (2025-09), `tiptap-markdown` (2025-09) are all current.

---

## Section 5: Major Upgrade Opportunities

### pdfjs-dist — v5.7.284 → v6.1.200
**Breaking changes:** Dropped older browser targets; worker entry-point / module structure changes; some deprecated API removals.
**Migration effort:** S–M. **Benefit:** Stays current on a security-sensitive PDF parser; upstream fuzzing/CVE fixes land on the 6.x line. **Risk:** Worker import path + `GlobalWorkerOptions.workerSrc` wiring must be re-verified in the PDF preview code. **Recommendation:** Upgrade — schedule a scoped task.

### agent-client-protocol (Rust) — v0.14.0 → v1.0.1 (+ schema 0.13.6 → 1.2.0)
**Breaking changes:** 1.0 stabilization likely graduates/renames the three pinned `unstable_*` features; schema crate no longer needs the exact `=0.13.6` lockstep pin. **Migration effort:** M. **Benefit:** Off the pre-1.0 churn treadmill; stable feature surface. **Risk:** ACP session fork/resume + per-turn token usage behavior in `acp/`; must bump both crates together. **Recommendation:** Defer to a dedicated ACP task.

### keyring (Rust) — v3.6.3 → v4.1.3
**Breaking changes:** v4 reworks the credential-store API and feature flags. **Migration effort:** M (touches OS-keychain credential code + `apple-native` feature). **Benefit:** Active maintenance line. **Risk:** Secret storage is security-critical — thorough testing required. **Recommendation:** Defer; not urgent (3.x is maintained).

### dirs (Rust) — v5.0.1 → v6.0.0
**Breaking changes:** Minor path-resolution semantics tweaks. **Migration effort:** S. **Recommendation:** Low priority; bump opportunistically.

### reqwest (Rust) — direct 0.12 → 0.13
Already evaluated in the duplication finding — aligns with `tauri-plugin-updater`'s 0.13 and removes the double TLS stack. **Effort:** S–M. **Recommendation:** Do it during the next Rust maintenance pass.

Pre-1.0 "minor = breaking" bumps (`typst 0.14→0.15`, `sysinfo 0.35→0.39`, `cpal 0.17→0.18`, `usvg`/`resvg 0.45→0.47`) are lower-value; `typst 0.15` is the most worthwhile because it may clear the `ttf-parser`/`paste`/`bincode`/`yaml-rust` transitive warnings.

No other npm major upgrades pending (pdfjs-dist is the only one).

---

## Section 6: Heavy Transitive Dependencies

`node_modules` is **838 MB** (down from 1.3 GB in April — the ACP-SDK removal and de-duplication paid off).

| Package | Direct? | Footprint | Duplicate Versions | Notes |
| --- | --- | --- | --- | --- |
| webdriverio + @wdio/* | Yes (dev) | 400+ transitive | — | Puppeteer/proxy stack; pulls `css-value` (Unknown license, dev-only). |
| @excalidraw/excalidraw | Yes | ~150 transitive | — | Now single `@excalidraw/mermaid-to-excalidraw@2.2.2` — the April 1.1.2/2.2.2 duplicate is **resolved**. |
| mermaid | Yes | ~120 transitive | — | d3-*, cytoscape, chevrotain, khroma, katex, roughjs. |
| jsdom / vitest / vite | Yes (dev) | Significant | — | Dev-only. |
| pdfjs-dist | Yes | Minimal | — | Single-package, ~7 MB. |

### Duplicate versions
- **npm:** No direct-dep duplicates of concern. Minor internal multiples remain (`lru-cache` ×4, `commander` ×4, some `@radix-ui/*` internals ×3–4 from the `radix-ui` meta-package co-existing with the standalone `@radix-ui/react-visually-hidden`). Low impact.
- **Rust:** `reqwest 0.12.28` + `0.13.3` (two rustls chains) — persisting; see finding. `rand 0.8.6` + `0.9.4` co-exist (down from the old 0.7.3 + 0.8.5), now all on maintained lines.

---

## Section 7: License Inventory

### License Distribution — production tree (572 unique packages)

| License | Count |
| --- | --- |
| MIT | 475 |
| ISC | 44 |
| Apache-2.0 | 13 |
| BSD-2-Clause | 11 |
| MIT OR Apache-2.0 | 9 |
| BSD-3-Clause | 9 |
| Apache-2.0 OR MIT | 1 |
| Python-2.0 | 1 |
| (MPL-2.0 OR Apache-2.0) | 1 |
| (MIT OR GPL-3.0-or-later) | 1 |
| (MIT AND Zlib) | 1 |
| MIT AND ISC | 1 |
| CC0-1.0 | 1 |
| Unlicense | 1 |
| 0BSD | 1 |
| BSD (unspecified) | 1 |
| Unknown | 1 |

(Full tree incl. dev = 998 packages: 805 MIT, 70 ISC, 43 Apache-2.0, etc. — 2 Unknown, no copyleft.)

### License Concerns

| Package | License | Shipped? | Concern |
| --- | --- | --- | --- |
| khroma@2.1.0 | Unknown | Yes (prod, via mermaid) | No `license` field; bundled LICENSE is MIT in practice. Persisting from April. |
| duck@0.1.12 | BSD (unspecified) | Yes (prod, via mammoth→lop) | Bare "BSD" — verify 2/3-clause (not 4-clause). Persisting from April. |
| css-value@0.0.1 | Unknown | **No** (dev-only, via webdriverio) | Does not ship in the app; no distribution risk. |
| jszip@3.10.1 | (MIT OR GPL-3.0-or-later) | Yes | Pick MIT — no concern. |

**Fixed since April:** the LGPL-3.0 `@img/sharp-libvips-darwin-arm64` is **gone** from the tree (fell out with the ACP-SDK removal). There is now **no LGPL/GPL/AGPL** in the production tree.

**Gaps:** `cargo-license` is still not installed — the Rust SBOM was verified by manual `Cargo.toml` inspection (app = MIT; Tauri/serde/tokio dual MIT-OR-Apache; `resvg`/`usvg`/`fontdb` = MPL-2.0 file-level copyleft, compliant since unmodified; `comrak` = BSD-2-Clause; no LGPL/GPL in the direct Rust tree). Install `cargo-license` (or `cargo-deny`) to make this authoritative.

---

## Notes & Gaps

1. **cargo-audit was installed during this run** (v0.22.2) and executed successfully — Section 3 for Rust is authoritative, not a gap (unlike April).
2. **cargo-outdated not installed** — building it needs the same multi-minute compile as cargo-audit. Compensated with per-crate `cargo search` latest-version lookups cross-referenced against `cargo tree` resolved versions. For a fully authoritative table, run `cargo outdated --root-deps-only` in a session where the build cost is acceptable.
3. **cargo-license not installed** — Rust license inventory done manually.
4. **CI extension opportunity:** the existing `cargo-audit` advisory job (test.yml:240-261) can now be flipped to blocking (0 vulns confirmed); add a `pnpm audit` step (no npm audit runs in CI today); consider `cargo-deny` to cover licenses + advisories + duplicate-versions in one job.
5. **Two Rust `reqwest` versions** persist (0.12 + 0.13) — see finding.

---

## Confirmed Good Patterns

- **Zero known vulnerabilities in both ecosystems** — every April CVE (dompurify, hono, basic-ftp, rustls-webpki ×2, rand) is verifiably closed; the pnpm overrides holding the JS fixes (`hono >=4.12.14`, `basic-ftp >=5.3.1`) are intact.
- **Overrides self-healed:** the April `lodash`/`lodash-es >=4.18.0` "no-op typo" now resolves to real `4.18.1` releases, and `uuid >=14.0.0` resolves to real `uuid@14.0.0` — no stale/unsatisfiable overrides remain.
- **Dependency surface shrank meaningfully:** `node_modules` 1.3 GB → 838 MB; the April `@excalidraw/mermaid-to-excalidraw` 1.1.2/2.2.2 duplicate is gone (single 2.2.2); the LGPL `@img/sharp-libvips` transitive is gone; the old `rand 0.7.3` and `fxhash` warnings dropped out.
- **Cargo advisory count improved** 24 → 22 warnings, and all remaining are `unmaintained`/`unsound` informational — not vulnerabilities — mostly Linux-only gtk-rs and deep Typst/syntect transitives outside direct control.
- **Deliberate, well-documented pins** are correct and should be preserved: `sentry 0.42` ↔ `tauri-plugin-sentry 0.5`, `agent-client-protocol 0.14.0` ↔ `agent-client-protocol-schema =0.13.6` lockstep, and the `recharts`/`@vitest/coverage-istanbul` exact pins.
- **CI already runs a Rust dependency audit** (advisory job with `cargo install cargo-audit --locked`) — the scaffolding to make it blocking is in place; only the `continue-on-error` flag needs flipping.
- **App is cleanly MIT-licensed** with a permissive-only shipped tree (no copyleft in prod after the sharp removal).

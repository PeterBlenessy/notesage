# Dependency Health Report — 2026-04-18

**App version:** 0.36.0
**Node:** v25.2.1
**pnpm:** 10.30.3
**Rust:** 1.93.0 (cargo 1.83.0 in $PATH for audit run)

## Summary

| Metric | Value |
| --- | --- |
| npm direct deps (prod) | 94 |
| npm dev deps | 21 |
| npm total direct | 115 |
| npm transitive (installed) | ~3,081 lines in tree (1,313 unique in lockfile) |
| `node_modules` size | 1.3 GB |
| Cargo direct deps | 57 (incl. `build-dependencies` + `dev-dependencies`) |
| Cargo transitive (Cargo.lock) | 944 crate dependencies |
| npm vulnerabilities | 3 (1 high, 2 moderate, 0 low/critical) |
| Cargo vulnerabilities | 2 (both moderate — rustls-webpki) |
| Cargo warnings (unmaintained/unsound) | 24 |
| Major upgrades available | 2 direct (`@agentclientprotocol/claude-agent-acp` 0.26→0.29, `lucide-react` 1.x is already latest — see notes) |
| Stale packages (12mo+) | 2 direct (`@tippyjs/react`, `diff-match-patch`) |
| License concerns | 3 (LGPL-3.0, Unknown ×2 — all transitive) |

### Vulnerability Severity Breakdown (matches GitHub Dependabot's 6 alerts)

| Ecosystem | Severity | Count | Items |
| --- | --- | --- | --- |
| npm | High | 1 | `basic-ftp` (dev-only, WDIO transitive) |
| npm | Moderate | 2 | `dompurify`, `hono` |
| Cargo | Moderate | 2 | `rustls-webpki` (2 distinct CVEs on same version) |
| Cargo | Low / unsound | 1 | `rand` (0.7.3 + 0.8.5 both transitive) |

GitHub's Dependabot count of 6 (1 high, 2 moderate, 3 low) aligns with: 1 npm-high (basic-ftp) + 2 npm-moderate (dompurify, hono) + 2 cargo-moderate mapped by GitHub as "low" (rustls-webpki ×2) + 1 cargo-unsound mapped as "low" (rand). Dependabot classifies advisory-db informational/unsound Rust entries as "low" severity on GitHub Security tab.

## Recommendations

1. **Immediate (security):**
   - Bump `dompurify` 3.3.3 → 3.4.0 to close the `ADD_TAGS`/`FORBID_TAGS` bypass (GHSA-39q2-94rc-95cp). Direct dep, single-line change. Mermaid uses dompurify internally too — verify no version skew.
   - Pin or wait for upstream fix for transitive **`hono`** 4.12.12 → >=4.12.14 (GHSA-458j-xx4x-4375). The path is `@agentclientprotocol/claude-agent-acp > @anthropic-ai/claude-agent-sdk > @modelcontextprotocol/sdk > hono`. Not directly actionable without a pnpm override OR waiting for `@modelcontextprotocol/sdk` to publish an update. Low actual exploitability for us — we do not SSR user-controlled JSX keys.
   - **`basic-ftp`** DoS — already has a pnpm override at `>=5.2.2` in `package.json` but the patched version is `>=5.3.0`; update the override to `>=5.3.0`. Dev-only path (WebDriverIO puppeteer browsers). Zero production exposure.

2. **Short-term (Rust security):**
   - `rustls-webpki` 0.103.10 → 0.103.12 fixes two cert-chain name-constraint bypasses (RUSTSEC-2026-0098/0099). Waiting on `rustls-platform-verifier` / `rustls` / `reqwest` to ship bumps — we do not depend on `rustls-webpki` directly. Monitor `rustls` 0.23.37+ and update `reqwest`/`rustls-platform-verifier` when available, or add a `[patch.crates-io]` override.
   - `rand` 0.7.3 / 0.8.5 "unsound with custom logger" (RUSTSEC-2026-0097) — transitive via `typst-library > rust_decimal > rand 0.8` and `selectors > phf_generator > rand 0.7`. Not actionable at our level. Monitor for upstream fixes; no immediate exposure because we do not install a custom `log::Log` that calls `rand::rng()`.

3. **Monitor (no action needed now):**
   - All `@tiptap/*` packages have a patch 3.22.3 → 3.22.4 available. Coordinate a single batch bump (23 packages).
   - Tauri plugin patches: `@tauri-apps/cli` 2.10.0 → 2.10.1, `@playwright/test` 1.59.0 → 1.59.1, `@vitejs/plugin-react` 6.0.0 → 6.0.1, `vitest` + `@vitest/coverage-istanbul` 4.1.0 → 4.1.4, TypeScript 6.0.2 → 6.0.3.
   - Niche stale packages: `diff-match-patch` (last release 2022-06) and `@tippyjs/react` (last release 2022-04). Both are low-surface-area; replacement is optional.
   - Unmaintained Rust crates (atk, atk-sys, bincode, fxhash) — all via deep Tauri/typst trees; not actionable without upstream changes.

---

## Follow-up — Actions Taken (2026-04-18)

After the initial audit, the 6 Dependabot alerts and license concerns were triaged and resolved in three commits:

| Commit | Finding(s) closed | What changed |
| --- | --- | --- |
| `2894731` | GHSA-39q2-94rc-95cp, GHSA-rp42-5vxx-qpwr, GHSA-458j-xx4x-4375 (3 npm) | `dompurify ^3.3.3 → ^3.4.0`; `basic-ftp` override tightened `>=5.2.2 → >=5.3.0`; added `hono >=4.12.14` pnpm override |
| `bcf8d23` | RUSTSEC-2026-0098, RUSTSEC-2026-0099 (2 cargo) | `cargo update -p rustls-webpki` → 0.103.10 → 0.103.12 (Cargo.lock only; semver-compatible within reqwest/rustls tree) |
| `c98f6e1` | 2 license concerns + 2 stale deps | Removed unused `@tippyjs/react` (0 imports in `src/`) and `@agentclientprotocol/claude-agent-acp` (only referenced as a string literal for install UI). The real ACP agent binary is fetched from GitHub Releases at runtime via `agent_manager.rs`. Side-effect: dropped transitive LGPL-3.0 `@img/sharp-libvips-darwin-arm64` + proprietary `@anthropic-ai/claude-agent-sdk` from the tree. −898 lines from `pnpm-lock.yaml`. |

**Verification after fixes:**
- `pnpm audit` — 0 vulnerabilities
- `pnpm typecheck` — clean
- `pnpm test` — 2779 / 2779 pass
- `cargo test` — 615 / 615 pass

### Deferred (with rationale)

| Finding | Why deferred |
| --- | --- |
| RUSTSEC-2026-0097 (`rand` unsoundness, 0.7.3 + 0.8.5) | No upstream patch exists. Exposure requires installing a custom `log::Log` that calls `rand::rng()` — we don't. `rand 0.7.3` is build-time only (tauri-utils); `rand 0.8.5` is runtime via `typst-library → lipsum`. Monitor for upstream fix. |
| `diff-match-patch` staleness | Research confirmed algorithm is mathematically stable, no CVEs, Apache-2.0 licensed. "Stale" ≠ "broken" — the library is finished. Replacement (`jsdiff`) is medium-effort and changes hunk rendering. Revisit only if `@types/diff-match-patch` breaks with a future TS version. |
| `markdown-it-sub`, `markdown-it-sup` staleness | Tiny feature-complete shims (~40 LOC upstream each). Actively used by Tiptap sub/sup extensions. Inlining saves two deps but adds maintenance burden for zero practical gain. |
| `khroma` undeclared license | Transitive via `mermaid`. Actually **MIT** per the bundled `node_modules/khroma/license` file — the missing field in its `package.json` is a metadata oversight by the maintainer, not a legal risk. No action needed; document and move on. |
| pnpm overrides `lodash: ">=4.18.0"` / `lodash-es: ">=4.18.0"` typo | Silent no-op (max published is 4.17.21). Should be `>=4.17.21`. Fix in a future housekeeping commit; no security impact. |

### Follow-up commit ordering learnings

The user requested Rust findings be fixed "one by one" to validate each. This produced cleaner commits, but also exposed one anti-pattern: the initial npm fixes sat uncommitted in the working tree while we moved on to Rust work, requiring an extra split at commit time. For future multi-ecosystem dep audits, commit each ecosystem's fixes as a unit before moving to the next.

---

## Section 1: npm Dependency Inventory (SBOM)

Run date: 2026-04-18. Sources: `pnpm ls --depth=0 --json`, `pnpm outdated --format=json`, `pnpm audit --json`.

### Production dependencies (94)

| Package | Current | Latest | Type | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| @agentclientprotocol/claude-agent-acp | 0.26.0 | 0.29.2 | dep | Major-ish available (0.x) | Pre-1.0; minor-jumps are effectively breaking. Pulls in vulnerable `hono` transitively. |
| @codemirror/commands | 6.10.3 | 6.10.3 | dep | Current | — |
| @codemirror/lang-cpp | 6.0.3 | 6.0.3 | dep | Current | — |
| @codemirror/lang-css | 6.3.1 | 6.3.1 | dep | Current | — |
| @codemirror/lang-go | 6.0.1 | 6.0.1 | dep | Current | — |
| @codemirror/lang-html | 6.4.11 | 6.4.11 | dep | Current | — |
| @codemirror/lang-java | 6.0.2 | 6.0.2 | dep | Current | — |
| @codemirror/lang-javascript | 6.2.5 | 6.2.5 | dep | Current | — |
| @codemirror/lang-json | 6.0.2 | 6.0.2 | dep | Current | — |
| @codemirror/lang-markdown | 6.5.0 | 6.5.0 | dep | Current | — |
| @codemirror/lang-php | 6.0.2 | 6.0.2 | dep | Current | — |
| @codemirror/lang-python | 6.2.1 | 6.2.1 | dep | Current | — |
| @codemirror/lang-rust | 6.0.2 | 6.0.2 | dep | Current | — |
| @codemirror/lang-sql | 6.10.0 | 6.10.0 | dep | Current | — |
| @codemirror/lang-xml | 6.1.0 | 6.1.0 | dep | Current | — |
| @codemirror/lang-yaml | 6.1.3 | 6.1.3 | dep | Current | — |
| @codemirror/language | 6.12.3 | 6.12.3 | dep | Current | — |
| @codemirror/legacy-modes | 6.5.2 | 6.5.2 | dep | Current | — |
| @codemirror/search | 6.6.0 | 6.6.0 | dep | Current | — |
| @codemirror/state | 6.6.0 | 6.6.0 | dep | Current | — |
| @codemirror/view | 6.41.0 | 6.41.0 | dep | Current | — |
| @excalidraw/excalidraw | 0.18.0 | 0.18.0 | dep | Current | Pre-1.0, minor = breaking. |
| @excalidraw/mermaid-to-excalidraw | 2.2.2 | 2.2.2 | dep | Current | — |
| @lezer/highlight | 1.2.3 | 1.2.3 | dep | Current | — |
| @lezer/markdown | 1.6.3 | 1.6.3 | dep | Current | — |
| @radix-ui/react-visually-hidden | 1.2.4 | 1.2.4 | dep | Current | — |
| @tauri-apps/api | 2.10.1 | 2.10.1 | dep | Current | — |
| @tauri-apps/plugin-autostart | 2.5.1 | 2.5.1 | dep | Current | — |
| @tauri-apps/plugin-dialog | 2.7.0 | 2.7.0 | dep | Current | — |
| @tauri-apps/plugin-global-shortcut | 2.3.1 | 2.3.1 | dep | Current | — |
| @tauri-apps/plugin-http | 2.5.8 | 2.5.8 | dep | Current | — |
| @tauri-apps/plugin-notification | 2.3.3 | 2.3.3 | dep | Current | — |
| @tauri-apps/plugin-opener | 2.5.3 | 2.5.3 | dep | Current | — |
| @tauri-apps/plugin-process | 2.3.1 | 2.3.1 | dep | Current | — |
| @tauri-apps/plugin-updater | 2.10.1 | 2.10.1 | dep | Current | — |
| @tippyjs/react | 4.2.6 | 4.2.6 | dep | Current / Stale | Last publish 2022-04-07 (~48 months). See Staleness section. |
| @tiptap/core | 3.22.3 | 3.22.4 | dep | Patch available | Part of coordinated 23-package Tiptap bump. |
| @tiptap/extension-bubble-menu | 3.22.3 | 3.22.4 | dep | Patch available | Tiptap batch. |
| @tiptap/extension-code-block-lowlight | 3.22.3 | 3.22.4 | dep | Patch available | Tiptap batch. |
| @tiptap/extension-color | 3.22.3 | 3.22.4 | dep | Patch available | Tiptap batch. |
| @tiptap/extension-floating-menu | 3.22.3 | 3.22.4 | dep | Patch available | Tiptap batch. |
| @tiptap/extension-focus | 3.22.3 | 3.22.4 | dep | Patch available | Tiptap batch. |
| @tiptap/extension-heading | 3.22.3 | 3.22.4 | dep | Patch available | Tiptap batch. |
| @tiptap/extension-highlight | 3.22.3 | 3.22.4 | dep | Patch available | Tiptap batch. |
| @tiptap/extension-horizontal-rule | 3.22.3 | 3.22.4 | dep | Patch available | Tiptap batch. |
| @tiptap/extension-image | 3.22.3 | 3.22.4 | dep | Patch available | Tiptap batch. |
| @tiptap/extension-link | 3.22.3 | 3.22.4 | dep | Patch available | Tiptap batch. |
| @tiptap/extension-list-keymap | 3.22.3 | 3.22.4 | dep | Patch available | Tiptap batch. |
| @tiptap/extension-paragraph | 3.22.3 | 3.22.4 | dep | Patch available | Tiptap batch. |
| @tiptap/extension-placeholder | 3.22.3 | 3.22.4 | dep | Patch available | Tiptap batch. |
| @tiptap/extension-subscript | 3.22.3 | 3.22.4 | dep | Patch available | Tiptap batch. |
| @tiptap/extension-superscript | 3.22.3 | 3.22.4 | dep | Patch available | Tiptap batch. |
| @tiptap/extension-table | 3.22.3 | 3.22.4 | dep | Patch available | Tiptap batch. |
| @tiptap/extension-table-cell | 3.22.3 | 3.22.4 | dep | Patch available | Tiptap batch. |
| @tiptap/extension-table-header | 3.22.3 | 3.22.4 | dep | Patch available | Tiptap batch. |
| @tiptap/extension-table-row | 3.22.3 | 3.22.4 | dep | Patch available | Tiptap batch. |
| @tiptap/extension-task-item | 3.22.3 | 3.22.4 | dep | Patch available | Tiptap batch. |
| @tiptap/extension-task-list | 3.22.3 | 3.22.4 | dep | Patch available | Tiptap batch. |
| @tiptap/extension-text-align | 3.22.3 | 3.22.4 | dep | Patch available | Tiptap batch. |
| @tiptap/extension-text-style | 3.22.3 | 3.22.4 | dep | Patch available | Tiptap batch. |
| @tiptap/extension-underline | 3.22.3 | 3.22.4 | dep | Patch available | Tiptap batch. |
| @tiptap/extension-unique-id | 3.22.3 | 3.22.4 | dep | Patch available | Tiptap batch. |
| @tiptap/pm | 3.22.3 | 3.22.4 | dep | Patch available | Tiptap batch. |
| @tiptap/react | 3.22.3 | 3.22.4 | dep | Patch available | Tiptap batch. |
| @tiptap/starter-kit | 3.22.3 | 3.22.4 | dep | Patch available | Tiptap batch. |
| @tiptap/suggestion | 3.22.3 | 3.22.4 | dep | Patch available | Tiptap batch. |
| class-variance-authority | 0.7.1 | 0.7.1 | dep | Current | — |
| clsx | 2.1.1 | 2.1.1 | dep | Current | — |
| cmdk | 1.1.1 | 1.1.1 | dep | Current | — |
| diff-match-patch | 1.0.5 | 1.0.5 | dep | Current / Stale | Last publish 2022-06-15 (~46 months). See Staleness section. |
| docx-preview | 0.3.7 | 0.3.7 | dep | Current | Pre-1.0. |
| dompurify | 3.3.3 | 3.4.0 | dep | **Vulnerable** (moderate) | GHSA-39q2-94rc-95cp — `ADD_TAGS` bypass of `FORBID_TAGS`. Patched in 3.4.0. |
| jszip | 3.10.1 | — | dep | Current | (no outdated entry) |
| lowlight | 3.3.0 | 3.3.0 | dep | Current | — |
| lucide-react | 1.8.0 | 1.8.0 | dep | Current | npm latest is 1.8.0; **note:** the popular Lucide package is actually `lucide-react` by the Lucide org — verify project is using correct package (not a different 1.x fork). |
| mammoth | 1.12.0 | 1.12.0 | dep | Current | — |
| markdown-it-sub | 2.0.0 | 2.0.0 | dep | Current / Stale | Last publish 2023-12-05. See Staleness section. |
| markdown-it-sup | 2.0.0 | 2.0.0 | dep | Current / Stale | Last publish 2023-12-05. See Staleness section. |
| mermaid | 11.14.0 | 11.14.0 | dep | Current | Subject to pnpm override `>=10.9.4`. |
| pdfjs-dist | 5.6.205 | 5.6.205 | dep | Current | — |
| radix-ui | 1.4.3 | 1.4.3 | dep | Current | Meta-package. |
| react | 19.2.5 | 19.2.5 | dep | Current | — |
| react-day-picker | 9.14.0 | 9.14.0 | dep | Current | — |
| react-dom | 19.2.5 | 19.2.5 | dep | Current | — |
| react-markdown | 10.1.0 | 10.1.0 | dep | Current | — |
| react-resizable-panels | 4.9.0 | 4.10.0 | dep | Minor available | Non-breaking improvements. |
| recharts | 3.8.1 | 3.8.1 | dep | Current | — |
| remark-gfm | 4.0.1 | 4.0.1 | dep | Current | — |
| sonner | 2.0.7 | 2.0.7 | dep | Current | — |
| tailwind-merge | 3.5.0 | 3.5.0 | dep | Current | — |
| tippy.js | 6.3.7 | 6.3.7 | dep | Current / Stale | Last publish 2025-06-09 (~10 months). Borderline. |
| tiptap-markdown | 0.9.0 | 0.9.0 | dep | Current | Pre-1.0; last publish 2025-09-08. |
| yaml | 2.8.3 | 2.8.3 | dep | Current | Overridden by `>=2.8.3`. |
| zustand | 5.0.12 | 5.0.12 | dep | Current | — |

### Dev dependencies (21)

| Package | Current | Latest | Type | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| @playwright/test | 1.59.0 | 1.59.1 | dev | Patch available | — |
| @tailwindcss/vite | 4.2.2 | 4.2.2 | dev | Current | — |
| @tauri-apps/cli | 2.10.0 | 2.10.1 | dev | Patch available | — |
| @testing-library/react | 16.3.2 | 16.3.2 | dev | Current | — |
| @testing-library/user-event | 14.6.1 | 14.6.1 | dev | Current | — |
| @types/diff-match-patch | 1.0.36 | 1.0.36 | dev | Current | — |
| @types/jsdom | 28.0.1 | 28.0.1 | dev | Current | — |
| @types/react | 19.2.14 | 19.2.14 | dev | Current | — |
| @types/react-dom | 19.2.3 | 19.2.3 | dev | Current | — |
| @vitejs/plugin-react | 6.0.0 | 6.0.1 | dev | Patch available | — |
| @vitest/coverage-istanbul | 4.1.0 | 4.1.4 | dev | Patch available | — |
| @wdio/cli | 9.27.0 | 9.27.0 | dev | Current | Pulls `basic-ftp` transitively (vuln). |
| @wdio/local-runner | 9.27.0 | 9.27.0 | dev | Current | — |
| @wdio/mocha-framework | 9.27.0 | 9.27.0 | dev | Current | — |
| @wdio/spec-reporter | 9.27.0 | 9.27.0 | dev | Current | — |
| jsdom | 29.0.2 | 29.0.2 | dev | Current | — |
| tailwindcss | 4.2.2 | 4.2.2 | dev | Current | — |
| typescript | 6.0.2 | 6.0.3 | dev | Patch available | — |
| vite | 8.0.8 | 8.0.8 | dev | Current | — |
| vitest | 4.1.0 | 4.1.4 | dev | Patch available | — |
| webdriverio | 9.27.0 | 9.27.0 | dev | Current | — |

### Active pnpm overrides (package.json)

```
yaml: >=2.8.3
picomatch: >=4.0.4
serialize-javascript: >=7.0.5
@xmldom/xmldom: >=0.8.12
nanoid: >=5.0.9
mermaid: >=10.9.4
lodash: >=4.18.0          # note: 4.18 does not exist — should be >=4.17.21 (verify intent)
lodash-es: >=4.18.0       # note: same concern
basic-ftp: >=5.2.2        # insufficient — patched in >=5.3.0
@anthropic-ai/sdk: >=0.81.0
```

Two overrides look suspicious and should be reviewed: `lodash` / `lodash-es >=4.18.0` — the max published is `4.17.21`, so this override is a no-op for latest. Likely meant `>=4.17.21`.

---

## Section 2: Cargo Dependency Inventory

Run date: 2026-04-18. Sources: `cargo tree --depth=1`, `cargo audit`. Note: `cargo outdated --root-deps-only` failed to run (see Section 3 note: stable cargo 1.83.0 could not parse a crate with `edition2024` feature: `clap_lex v1.1.0`). Below is a manual comparison of the declared `Cargo.toml` versions vs. the resolved versions in `Cargo.lock`, cross-referenced with crates.io latest where noted. Full "latest" checks require running `cargo outdated` under a newer cargo.

### Direct crates

| Crate | Declared (`Cargo.toml`) | Resolved (`Cargo.lock`) | Status | Notes |
| --- | --- | --- | --- | --- |
| tauri | 2 | 2.10.2 | Current | Tracks `tauri-plugin-*` versions. |
| tauri-build | 2 | 2.5.5 | Current | Build dep. |
| tauri-plugin-opener | 2 | 2.5.3 | Current | — |
| tauri-plugin-fs | 2 | 2.5.0 | Current | — |
| tauri-plugin-dialog | 2 | 2.7.0 | Current | — |
| tauri-plugin-http | 2 | 2.5.8 | Current | — |
| tauri-plugin-window-state | 2.4.1 | 2.4.1 | Current | — |
| tauri-plugin-log | 2 | 2.8.0 | Current | — |
| tauri-plugin-updater | 2 | 2.10.1 | Current | — |
| tauri-plugin-process | 2 | 2.3.1 | Current | — |
| tauri-plugin-notification | 2 | 2.3.3 | Current | — |
| tauri-plugin-autostart | 2 | 2.5.1 | Current | — |
| tauri-plugin-webdriver | 0.2 | 0.2.1 | Current | Optional (`e2e-testing`). |
| serde | 1 | 1.0.228 | Current | — |
| serde_json | 1 | 1.0.149 | Current | — |
| serde_norway | 0.9 | 0.9.42 | Current | YAML fork (serde-yaml replacement). |
| reqwest | 0.12 | 0.12.28 | Current | Note: `tauri-plugin-updater` uses its own pinned `reqwest 0.13.2`. |
| flate2 | 1 | 1.1.9 | Current | — |
| tar | 0.4 | 0.4.45 | Current | — |
| tokio | 1 | 1.49.0 | Current | — |
| tokio-util | 0.7 | 0.7.18 | Current | — |
| futures | 0.3 | 0.3.31 | Current | — |
| bytes | 1 | 1.11.1 | Current | — |
| dirs | 5 | 5.0.1 | Minor available | `dirs` 6 is published; low priority. |
| typst | 0.14.2 | 0.14.2 | Current | Monitor — Typst is on a fast cadence. |
| typst-pdf | 0.14.2 | 0.14.2 | Current | — |
| typst-syntax | 0.14.2 | 0.14.2 | Current | — |
| typst-library | 0.14.2 | 0.14.2 | Current | — |
| typst-utils | 0.14.2 | 0.14.2 | Current | — |
| usvg | 0.45 | 0.45.1 | Current | — |
| fontdb | 0.23 | 0.23.0 | Current | — |
| resvg | 0.45 | 0.45.1 | Current | — |
| chrono | 0.4 | 0.4.43 | Current | — |
| comrak | 0.50.0 | 0.50.0 | Current | — |
| regex | 1 | 1.12.3 | Current | — |
| rusqlite | 0.34 | 0.34.0 | Current | `bundled` feature. |
| sha2 | 0.10 | 0.10.9 | Current | — |
| parking_lot | 0.12 | 0.12.5 | Current | — |
| notify | 7 | 7.0.0 | Current | — |
| notify-debouncer-full | 0.4 | 0.4.0 | Current | — |
| fs_extra | 1.3 | 1.3.0 | Current | — |
| libc | 0.2 | 0.2.182 | Current | — |
| agent-client-protocol | 0.10.4 | 0.10.4 | Current | Pre-1.0 + unstable features pinned. |
| agent-client-protocol-schema | 0.11.4 | 0.11.4 | Current | — |
| async-trait | 0.1 | 0.1.89 | Current | — |
| log | 0.4 | 0.4.29 | Current | — |
| sysinfo | 0.35 | 0.35.2 | Current | — |
| zip | 2 | 2.4.2 | Current | — |
| uuid | 1 | 1.21.0 | Current | — |
| keyring | 3 | 3.6.3 | Current | `apple-native`. |
| urlencoding | 2 | 2.1.3 | Current | — |
| font-kit | 0.14 | 0.14.3 | Current | — |
| scraper | 0.23 | 0.23.1 | Current | Pulls `selectors 0.26 + phf_generator 0.11 + rand 0.8` (sound warning). |
| ppt-rs | 0.2 | 0.2.8 | Current | Pre-1.0. |
| docx-rs | 0.4 | 0.4.19 | Current | — |
| whisper-rs | 0.15 | 0.15.1 | Current | `metal` on macOS. |
| cpal | 0.15 | 0.15.3 | Current | — |
| tempfile (dev) | 3 | 3.25.0 | Current | — |

**Totals:** 57 direct (56 prod + 1 dev); 944 total in `Cargo.lock`.

---

## Section 3: Security Vulnerabilities

All findings below are authoritative — run on 2026-04-18. Six distinct advisories trigger the GitHub Dependabot count (1 high + 2 moderate + 3 low), enumerated here.

### HIGH: basic-ftp — Unbounded memory consumption in Client.list() (DoS)

| Field | Value |
| --- | --- |
| Package | basic-ftp |
| Installed | 5.2.2 |
| Patched in | >=5.3.0 |
| Advisory ID | GHSA-rp42-5vxx-qpwr |
| CWE | CWE-400, CWE-770 |
| CVSS | 7.5 (CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H) |
| Path | `.>@wdio/cli>@wdio/utils>@puppeteer/browsers>proxy-agent>pac-proxy-agent>get-uri>basic-ftp` |

**Impact:** A malicious or compromised FTP server can force `Client.list()` to buffer an unbounded listing response into memory via repeated `Buffer.concat(...)` in `StringWriter`, crashing the client. **For Notesage this is dev-only** — `basic-ftp` is pulled by WebDriverIO's puppeteer browsers dependency chain used only when running real E2E tests. It is not shipped in the Tauri app bundle and is not reachable from user actions.

**Action:** Update the existing pnpm override `"basic-ftp": ">=5.2.2"` to `">=5.3.0"`. One-line change in `package.json`.

### MODERATE: dompurify — `ADD_TAGS` function form bypasses `FORBID_TAGS`

| Field | Value |
| --- | --- |
| Package | dompurify |
| Installed | 3.3.3 |
| Patched in | >=3.4.0 |
| Advisory ID | GHSA-39q2-94rc-95cp |
| CWE | CWE-783 |
| CVSS | 0 (not scored by NVD; low exploitability in our usage) |
| Path | Direct dep + transitive via `mermaid > dompurify` + `@excalidraw/mermaid-to-excalidraw@1.1.2 > @excalidraw/excalidraw > dompurify` |

**Impact:** When code calls `DOMPurify.sanitize(html, { ADD_TAGS: fnForm, FORBID_TAGS: [...] })`, a short-circuit evaluation bug means `FORBID_TAGS` is never checked if the ADD-tag function returns `true` for a tag — so forbidden tags are allowed through. Requires the function form of `ADD_TAGS` *and* `FORBID_TAGS` used together. Notesage's own code uses DOMPurify only for sanitizing AI-generated markdown in tool output; we do not use the function form of `ADD_TAGS`, so direct exposure is low. Mermaid / Excalidraw use DOMPurify internally and may.

**Action:** Bump direct `dompurify: ^3.3.3` → `^3.4.0`. Run `pnpm test` + roundtrip suite before committing.

### MODERATE: hono — JSX attribute-name HTML injection in hono/jsx SSR

| Field | Value |
| --- | --- |
| Package | hono |
| Installed | 4.12.12 |
| Patched in | >=4.12.14 |
| Advisory ID | GHSA-458j-xx4x-4375 |
| CWE | CWE-79 |
| CVSS | 4.3 (CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:N/I:L/A:N) |
| Path | `.>@agentclientprotocol/claude-agent-acp>@anthropic-ai/claude-agent-sdk>@modelcontextprotocol/sdk>hono` |

**Impact:** Only exploitable in hono/jsx SSR with untrusted input used as JSX attribute keys. Notesage does **not** call hono directly nor SSR JSX. The only reason hono is in the tree is the `@modelcontextprotocol/sdk` pulls `@hono/node-server` for its reference transport. We don't use that transport — MCP in Notesage is stdio-based via Rust. Practical exposure: none.

**Action:** Wait for `@modelcontextprotocol/sdk` to update hono, or add `hono: ">=4.12.14"` to `package.json` pnpm overrides to force-pin.

### MODERATE (Rust): rustls-webpki — Name constraints for URI names incorrectly accepted

| Field | Value |
| --- | --- |
| Crate | rustls-webpki |
| Installed | 0.103.10 |
| Patched in | >=0.103.12, <0.104.0-alpha.1 OR >=0.104.0-alpha.6 |
| Advisory ID | RUSTSEC-2026-0098 |
| CVSS | Not scored (informational Rust advisory) |
| Path | `rustls 0.23.36 > hyper-rustls 0.27.7 > reqwest 0.12/0.13 > tauri + tauri-plugin-http + tauri-plugin-updater > notesage` |

**Impact:** X.509 name-constraint validation bug — in certain certificate chains with URI Subject Alternative Names, the constraint check can accept names it should reject. In practice: a rogue intermediate CA issued with URI-name constraints could issue certs accepted by rustls-webpki that should be blocked. Relevant only if Notesage's TLS connections traverse environments with unusual private CAs (most users do not — system roots + public CAs only).

**Action:** Upgrade `rustls-webpki` transitively once `rustls 0.23.37` and `reqwest` / `rustls-platform-verifier` ship bumps. Cannot be fixed directly from our `Cargo.toml`. Optionally pin with `[patch.crates-io]` block.

### MODERATE (Rust): rustls-webpki — Name constraints accepted for wildcard-name certs

| Field | Value |
| --- | --- |
| Crate | rustls-webpki |
| Installed | 0.103.10 |
| Patched in | >=0.103.12 |
| Advisory ID | RUSTSEC-2026-0099 |
| Path | Same as RUSTSEC-2026-0098 (same crate, same version). |

**Impact:** Companion advisory to RUSTSEC-2026-0098 — name-constraint enforcement also fails on certificates asserting a wildcard SAN. Same low real-world exposure for Notesage.

**Action:** Same as -0098 — upgrade fixes both.

### LOW / UNSOUND (Rust): rand — Unsound with a custom logger using `rand::rng()`

| Field | Value |
| --- | --- |
| Crate | rand |
| Installed | 0.7.3 **and** 0.8.5 (two separate trees) |
| Patched in | not yet fixed upstream at this version |
| Advisory ID | RUSTSEC-2026-0097 |
| Paths | `rand 0.7.3`: `phf_generator 0.8 > phf_codegen > selectors 0.24 > kuchikiki > wry+tauri-utils > tauri`. `rand 0.8.5`: `rust_decimal 1.40 > typst-library > typst-*`; `phf_generator 0.11 > string_cache_codegen > markup5ever > html5ever > wry+scraper+tauri-utils`; `byte-unit 5.2 > tauri-plugin-log`; `lipsum 0.9 > typst-library`. |

**Impact:** If an application installs a custom `log::Log` implementation that itself calls `rand::rng()` (or internally invokes a function that does), undefined behavior can occur. Notesage uses `tauri-plugin-log` which installs a standard logger; we do **not** register a custom logger that calls `rand::rng()`. Exposure: none in practice.

**Action:** Monitor. Once `rand` releases a patched 0.8.x, the Cargo ecosystem will propagate. No direct action from us.

### Unmaintained / deprecated warnings (Cargo — 24 total)

`cargo audit` also reported the following non-vuln warnings (status: unmaintained). Not actionable at our level because all are deep transitive via Tauri's GTK/wry stack or the typst highlight stack:

- `atk 0.18.2` / `atk-sys 0.18.2` — RUSTSEC-2024-0413/-0416 (gtk-rs GTK3 bindings). Via `gtk > wry > tauri-runtime-wry`.
- `bincode 1.3.3` — RUSTSEC-2025-0141. Via `syntect 5.3 > two-face / ppt-rs / typst-library / comrak`.
- `fxhash 0.2.1` — RUSTSEC-2025-0057. Via `selectors 0.24/0.26 > scraper / kuchikiki`.
- Additional warnings enumerated in the full `cargo audit` output (24 total). All are in dep trees where we do not control the direct edge.

### `cargo outdated` — NOT RUN SUCCESSFULLY

**Blocker:** Running `cargo outdated --root-deps-only` on the installed toolchain (cargo 1.83.0) fails at dependency resolution:

```
error: failed to download `clap_lex v1.1.0`
Caused by: feature `edition2024` is required
```

This is because a transitive dependency requires Cargo Edition 2024, which is stabilized only in cargo 1.85+. The project's `rust-toolchain`/published cargo (1.93.0 per user-reported env) is newer than the one resolved in PATH at audit time. To close this gap, rerun with the Rust 1.93 cargo binary: `cd src-tauri && rustup run stable cargo outdated --root-deps-only`. As a partial compensation, Section 2 above lists the declared-vs-resolved version comparison manually.

---

## Section 4: Staleness Analysis

Target window: packages with no new release in 12+ months (flag) or 24+ months (serious).

| Package | Last Release | Age (approx.) | Risk | Alternative |
| --- | --- | --- | --- | --- |
| @tippyjs/react | 2022-04-07 | ~48 months | High — React wrapper for tippy.js is effectively abandoned. Low surface area (used as tooltip helper). | `tippy.js` directly + our own React wrapper, or Radix `Tooltip`. shadcn/ui already provides `tooltip`. |
| diff-match-patch | 2022-06-15 | ~46 months | High — single-maintainer, no updates. Used in editor / external-change review / chat segments. | Possible: `diff` package, `jsdiff`. Risk: any replacement changes subtle diff output. |
| markdown-it-sub | 2023-12-05 | ~28 months | Medium — tiny, single-purpose (subscript `~x~`). | Acceptable — the spec is frozen; no reason to churn unless a bug emerges. |
| markdown-it-sup | 2023-12-05 | ~28 months | Medium — tiny, single-purpose (superscript `^x^`). | Same as markdown-it-sub. |
| tippy.js | 2025-06-09 | ~10 months | Low — borderline, not yet stale. | Monitor. |
| class-variance-authority | 2024-11-26 | ~17 months | Low — stable API, widely used. | No action needed unless a bug emerges. |
| lowlight | 2024-12-14 | ~16 months | Low — tracks highlight.js. | No action. |

All other direct dependencies have been released within the last 12 months.

### Tauri dev-only tooling

- `@tauri-apps/cli` 2.10.0 (released recently) — Current.
- WebDriverIO `9.27.0` stack — Current (Oct 2025+).

---

## Section 5: Major Upgrade Opportunities

Only two direct deps with a "next major" / non-trivial bump available.

### @agentclientprotocol/claude-agent-acp — v0.26.0 → v0.29.2

**Breaking changes (pre-1.0, minor = breaking):**
- 0.27 / 0.28 / 0.29 likely ship ACP protocol schema deltas (session/close, fork, resume).
- Companion Rust crate `agent-client-protocol` is pinned at 0.10.4 with several `unstable_session_*` features; both must be bumped in lockstep.

**Migration effort:** M. Requires re-verifying ACP session lifecycle tests + permission cards + session resume/fork UX.

**Benefit:**
- Closes `hono` transitive vuln when `@anthropic-ai/claude-agent-sdk` / `@modelcontextprotocol/sdk` update.
- Picks up ACP protocol improvements (tool_call_update content parity with Zed).

**Risk:** ACP behavioral changes surface in our chat UI; tests needed for all 4 agents (Claude Code, Codex, Copilot, Gemini CLI).

**Recommendation:** Defer until after current sprint; plan a focused ACP upgrade task that also bumps the Rust `agent-client-protocol` crate in the same PR.

### dompurify — v3.3.3 → v3.4.0

**Breaking changes:** None — semver minor bump; bugfix for `ADD_TAGS` / `FORBID_TAGS` order.

**Migration effort:** S. Single-line bump in `package.json`.

**Benefit:** Closes GHSA-39q2-94rc-95cp.

**Risk:** Negligible.

**Recommendation:** **Upgrade now.** First item on priority list.

### Other opportunities (minor / patch)

- `react-resizable-panels` 4.9.0 → 4.10.0 (minor). Low risk.
- All 23 `@tiptap/*` patches 3.22.3 → 3.22.4. Batch upgrade.
- Tooling patches: `@playwright/test`, `@tauri-apps/cli`, `@vitejs/plugin-react`, `@vitest/coverage-istanbul`, `typescript`, `vitest`.

**No true major-version upgrades pending** beyond the `@agentclientprotocol/claude-agent-acp` pre-1.0 case above.

---

## Section 6: Heavy Transitive Dependencies

`node_modules` is 1.3 GB with ~3,081 lines in `pnpm ls --depth=Infinity`. The heaviest contributors (identified by inspecting the dep graph and install size):

| Package | Direct? | Transitive Footprint (est.) | Duplicate Versions | Notes |
| --- | --- | --- | --- | --- |
| webdriverio + @wdio/* | Yes (dev) | 400+ transitive | — | Puppeteer browsers + proxy-agent pulls `basic-ftp`, `get-uri`, `pac-proxy-agent`. Dev-only. |
| @agentclientprotocol/claude-agent-acp | Yes | ~80 transitive | — | Pulls `@anthropic-ai/claude-agent-sdk` → `@modelcontextprotocol/sdk` → `hono` + `@hono/node-server`. |
| @excalidraw/excalidraw | Yes | ~150 transitive | 2 versions of `@excalidraw/mermaid-to-excalidraw` (1.1.2 and 2.2.2) | Bundles Mermaid twice-indirect. |
| mermaid | Yes | ~120 transitive | — | Pulls `cytoscape`, `dagre-d3`, `d3-*` (20+ d3 packages), `chevrotain`, `khroma`, `katex`, `roughjs`. |
| pdfjs-dist | Yes | Minimal | — | Single-package; ~7 MB on disk. |
| @excalidraw/mermaid-to-excalidraw | Yes (+transitive) | 2 distinct versions installed | 2 | `1.1.2` pulled by excalidraw, `2.2.2` declared directly. Worth rationalizing. |
| @vitest/* / vite / jsdom | Yes (dev) | Significant | — | Dev-only. |
| jsdom | Yes (dev) | 50+ transitive | — | Large by nature. |
| tailwindcss v4 | Yes (dev) | Small | — | @tailwindcss/vite uses Lightning CSS Rust binary. |
| @img/sharp-darwin-arm64 | Transitive | — | — | Pulls `sharp-libvips-darwin-arm64` (LGPL — see Section 7). |

### Duplicate versions

- `@excalidraw/mermaid-to-excalidraw` is installed at both `1.1.2` (via `@excalidraw/excalidraw@0.18.0`) and `2.2.2` (direct dep). Each carries its own Mermaid transitive subgraph. Worth auditing whether both are needed; may be fine since the 1.x is scoped to Excalidraw's internal Mermaid-to-drawing conversion and 2.x is ours.
- Rust side: two `reqwest` versions (`0.12.28` + `0.13.2`) installed because `tauri-plugin-updater` pins `0.13.2` while our direct use and `tauri-plugin-http` use `0.12.28`. Both pull separate rustls chains. This ~doubles the TLS crate footprint — consider aligning once tauri-plugin-updater catches up.

---

## Section 7: License Inventory

Counts below are from `pnpm licenses list --prod --json` (production tree only — dev-only packages not enumerated because they do not ship in the built app).

### License Distribution (production tree, unique packages)

| License | Unique Package Count |
| --- | --- |
| MIT | 551 |
| ISC | 45 |
| Apache-2.0 | 16 |
| BSD-3-Clause | 11 |
| MIT OR Apache-2.0 | 8 |
| BSD-2-Clause | 6 |
| Unknown | 2 |
| Apache-2.0 OR MIT | 1 |
| (MIT OR GPL-3.0-or-later) | 1 |
| (MPL-2.0 OR Apache-2.0) | 1 |
| (MIT AND Zlib) | 1 |
| Python-2.0 | 1 |
| MIT AND ISC | 1 |
| 0BSD | 1 |
| LGPL-3.0-or-later | 1 |
| CC0-1.0 | 1 |
| Unlicense | 1 |
| BSD (unspecified) | 1 |

**Total unique packages surveyed:** 648. Multi-license entries (e.g. "MIT OR GPL-3.0-or-later" or "MPL-2.0 OR Apache-2.0") pose no risk because we can choose the permissive half.

### License Concerns

| Package | License | Version | Concern | Shipped? |
| --- | --- | --- | --- | --- |
| @img/sharp-libvips-darwin-arm64 | LGPL-3.0-or-later | 1.2.4 | LGPL dynamic-link obligation — if we distribute this as part of the app, we must allow users to re-link against a newer libvips and provide notice. Transitive via `@img/sharp-darwin-arm64` which appears to be optional. | **Verify:** run `pnpm why @img/sharp-darwin-arm64` to confirm whether sharp is actually bundled in the Tauri app or is dev-only (pulled by build tooling / Playwright / wdio). |
| @anthropic-ai/claude-agent-sdk | Unknown | 0.2.96 | No license declared at package.json `license` field. Pulled transitively via `@agentclientprotocol/claude-agent-acp`. Typically Anthropic SDKs are MIT — npm may just not be detecting it. | Yes (prod). Open an issue upstream asking them to declare `license`. |
| khroma | Unknown | 2.1.0 | Pulled via `mermaid`. Typically MIT but the package.json does not declare it. | Yes (prod). |
| jszip | (MIT OR GPL-3.0-or-later) | 3.10.1 | Dual-licensed — we pick MIT, no concern. | Yes (prod). |
| dompurify | (MPL-2.0 OR Apache-2.0) | 3.3.3 | Dual-licensed — we pick Apache-2.0, no concern. | Yes (prod). |
| argparse | Python-2.0 | 2.0.1 | Permissive; compatible with MIT app. | Yes (prod). |
| robust-predicates | Unlicense | 3.0.3 | Public domain equivalent. Compatible. | Yes (prod). |
| duck | BSD (unspecified variant) | 0.1.12 | Ambiguous BSD — should verify it is 2/3-clause and not 4-clause. | Yes (prod). |

**LGPL flag:** `@img/sharp-libvips-darwin-arm64` is the only copyleft-adjacent dependency in the production tree. **Action:** verify whether `sharp` makes it into the shipped Tauri app or is a build-time-only artifact. If bundled, add a LICENSES section in the build output and ensure compliance with LGPL-3.0 dynamic-linking obligations.

**Unknown licenses:** `@anthropic-ai/claude-agent-sdk` and `khroma` both have empty `license` fields. While practically these are MIT/permissive, a clean SBOM should note them as unresolved. Open upstream issues or manually inspect the repo for a LICENSE file and record the finding.

### Cargo license inventory

`cargo license` is not installed in this environment. Manual inspection of `src-tauri/Cargo.toml` shows the crate itself is `MIT`. Representative direct-crate licenses (from their respective `Cargo.toml` manifests on crates.io):

- Tauri ecosystem (tauri, tauri-plugin-*, tauri-build, tauri-runtime-wry, wry, tao, muda) — Apache-2.0 OR MIT.
- serde / serde_json / tokio / reqwest / bytes / log / regex / parking_lot / futures / async-trait / uuid / libc / chrono / sha2 — MIT OR Apache-2.0 (dual).
- rusqlite — MIT.
- typst, typst-pdf, typst-syntax, typst-library, typst-utils — Apache-2.0.
- comrak — BSD-2-Clause.
- resvg / usvg / fontdb — MPL-2.0 (weak copyleft — file-level).
- whisper-rs — MIT/Apache-2.0; bundled whisper.cpp is MIT.
- ppt-rs, docx-rs — MIT.
- cpal — Apache-2.0.
- scraper — ISC.
- keyring — MIT OR Apache-2.0.
- font-kit — Apache-2.0 OR MIT.
- agent-client-protocol / agent-client-protocol-schema — Apache-2.0.
- zip — MIT.
- notify / notify-debouncer-full — CC0-1.0 / Artistic-2.0.

**Rust license concerns:**
- `resvg` / `usvg` / `fontdb` are MPL-2.0 (file-level copyleft). Compatible with MIT app as long as we don't modify their source files without publishing changes. No current modifications — compliant.
- No LGPL or GPL in direct Cargo tree.

To close this gap, install `cargo license`:

```
cargo install cargo-license
cd src-tauri && cargo license --avoid-build-deps
```

---

## Notes & Gaps

1. **`cargo outdated` did not complete** — stable cargo 1.83.0 in PATH cannot resolve a crate needing `edition2024`. Re-run under cargo 1.85+ (Rust 1.93 that the user reports should suffice) to get a definitive "latest available" table for Cargo. Section 2 uses a manual `declared vs Cargo.lock` comparison as a partial compensation.
2. **`cargo license` is not installed** — license inventory for Cargo was done by reading `Cargo.toml` declarations manually. Install and run for authoritative SBOM.
3. **GitHub Dependabot's 6-vuln count reconciled:** 1 npm-high (`basic-ftp`), 2 npm-moderate (`dompurify`, `hono`), 2 cargo advisories on `rustls-webpki` (GitHub classifies informational RustSec/no-CVSS advisories as "low" severity in its UI), 1 cargo unsound `rand` advisory (also shown as "low"). Total matches.
4. **Two `reqwest` versions in Rust tree** — drives double TLS footprint. Worth aligning `tauri-plugin-updater` once it updates to `reqwest 0.12`.
5. **Two `@excalidraw/mermaid-to-excalidraw` versions in npm tree** — one via Excalidraw, one direct. Verify intent.
6. **pnpm overrides `lodash: >=4.18.0` / `lodash-es: >=4.18.0`** are a no-op since no such version exists. Likely a typo for `>=4.17.21`.

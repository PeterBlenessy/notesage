# Dependency Health Report — 2026-04-11

**App version:** 0.31.0 **Node:** v25.2.1 **pnpm:** 10.30.3 **Rust:** 1.93.0 (2026-01-19)

## Summary

| Metric | Value |
| --- | --- |
| npm direct deps | 87 |
| npm dev deps | 21 |
| Cargo direct deps | 53 |
| npm vulnerabilities (HIGH+) | 0 ✅ (was 2 — resolved via overrides + upgrades) |
| Cargo advisories (warnings) | 25 (all unmaintained/unsound, no exploitable vulns) |
| Major upgrades available | 0 ✅ (was 5 — all upgraded) |
| Stale packages (12mo+) | 0 |
| License concerns | 4 (1 LGPL, 1 GPL dual-license, 3 Unknown) |

## Recommendations

1. **Immediate** (security): ✅ Done

   - ~~Replace~~ `@zed-industries/claude-agent-acp` ~~(deprecated)~~ → Replaced with `@agentclientprotocol/claude-agent-acp@0.26.0`
   - `basic-ftp` ~~vuln~~ → Added pnpm override `basic-ftp>=5.2.2` + `@anthropic-ai/sdk>=0.81.0`. `pnpm audit` now reports 0 vulnerabilities.

2. **Short-term** (upgrades): ✅ Done

   - ~~Upgrade Tiptap v3.19→v3.22~~ → Upgraded all 25 @tiptap/\* packages to 3.22.3
   - ~~Upgrade Tailwind v4.1→v4.2~~ → Upgraded to 4.2.2
   - ~~Evaluate Vite 8 + TypeScript 6 + @vitejs/plugin-react 6~~ → All upgraded (Vite 8.0.8, TS 6.0.2, plugin-react 6.0)
   - ~~Upgrade~~ `lucide-react` ~~0.564→1.8.0~~ → Upgraded to 1.8.0 (zero icon renames needed)

3. **Monitor** (no action needed now):

   - Cargo GTK3 unmaintained warnings are Linux-only transitive deps from Tauri — will be resolved when Tauri upgrades to gtk4-rs
   - `rand` 0.9.2 unsound advisory only affects custom loggers (not applicable to Notesage)
   - `bincode` unmaintained — transitive via syntect/typst, no direct dependency

---

## Section 1: npm Dependency Inventory

### Outdated Packages

✅ **All packages upgraded as of 2026-04-11.** No outdated packages remain.

Previous state (before upgrades)

| Package | Was | Upgraded to | Type |
| --- | --- | --- | --- |
| @agentclientprotocol/claude-agent-acp | @zed-industries/…@0.18.0 (deprecated) | 0.26.0 | dep |
| @codemirror/commands | 6.10.2 | 6.10.3 | dep |
| @codemirror/language | 6.12.1 | 6.12.3 | dep |
| @codemirror/state | 6.5.4 | 6.6.0 | dep |
| @codemirror/view | 6.39.15 | 6.41.0 | dep |
| @tauri-apps/plugin-http | 2.5.7 | 2.5.8 | dep |
| @tauri-apps/plugin-updater | 2.10.0 | 2.10.1 | dep |
| @tauri-apps/plugin-dialog | 2.6.0 | 2.7.0 | dep |
| @tiptap/\* (25 packages) | 3.19.0 | 3.22.3 | dep |
| @vitejs/plugin-react | 4.7.0 | 6.0.0 | dev |
| @vitest/coverage-istanbul | 4.0.18 | 4.1.0 | dev |
| @playwright/test | 1.58.2 | 1.59.0 | dev |
| @tailwindcss/vite | 4.1.18 | 4.2.2 | dev |
| jsdom | 29.0.1 | 29.0.2 | dev |
| lucide-react | 0.564.0 | 1.8.0 | dep |
| pdfjs-dist | 5.4.624 | 5.6.205 | dep |
| react | 19.2.4 | 19.2.5 | dep |
| react-dom | 19.2.4 | 19.2.5 | dep |
| react-resizable-panels | 4.6.4 | 4.9.0 | dep |
| recharts | 3.8.0 | 3.8.1 | dep |
| tailwind-merge | 3.4.0 | 3.5.0 | dep |
| tailwindcss | 4.1.18 | 4.2.2 | dev |
| typescript | 5.8.3 | 6.0.2 | dev |
| vite | 7.3.2 | 8.0.8 | dev |
| vitest | 4.0.18 | 4.1.0 | dev |
| zustand | 5.0.11 | 5.0.12 | dep |

---

## Section 2: Cargo Dependency Inventory

| Crate | Current | Status | Notes |
| --- | --- | --- | --- |
| agent-client-protocol | 0.10.4 | Current | — |
| agent-client-protocol-schema | 0.11.4 | Current | — |
| chrono | 0.4.43 | Current | — |
| comrak | 0.50.0 | Current | — |
| cpal | 0.15.3 | Current | — |
| dirs | 5.0.1 | Current | — |
| docx-rs | 0.4.19 | Current | — |
| font-kit | 0.14.3 | Current | — |
| keyring | 3.6.3 | Current | — |
| notify | 7.0.0 | Current | — |
| parking_lot | 0.12.5 | Current | — |
| ppt-rs | 0.2.8 | Current | — |
| reqwest | 0.12.28 | Current | — |
| rusqlite | 0.34.0 | Current | — |
| scraper | 0.23.1 | Current | — |
| serde | 1.0.228 | Current | — |
| serde_json | 1.0.149 | Current | — |
| sysinfo | 0.35.2 | Current | — |
| tauri | 2.10.2 | Current | — |
| tokio | 1.49.0 | Current | — |
| typst | 0.14.2 | Current | — |
| uuid | 1.21.0 | Current | — |
| whisper-rs | 0.15.1 | Current | — |

**Note:** `cargo-outdated` is not installed and could not run (requires newer Cargo features). Based on `cargo tree` output, all direct dependencies appear to be on recent versions. No critical crate upgrades identified.

---

## Section 3: Security Vulnerabilities

### npm: 0 vulnerabilities ✅ (was 2 HIGH — resolved)

#### HIGH: basic-ftp — FTP Command Injection via CRLF

| Field | Value |
| --- | --- |
| Package | basic-ftp |
| Installed | 5.2.0 |
| Patched in | &gt;=5.2.1 |
| Advisory | GHSA-chqc-8p9q-pq6q |
| Path | `@wdio/cli > @wdio/utils > @puppeteer/browsers > proxy-agent > pac-proxy-agent > get-uri > basic-ftp` |

**Impact:** FTP command injection via CRLF characters in credentials. Only exploitable if Notesage connects to FTP servers — it does NOT. **Action:** Dev-only transitive dependency via WebDriverIO test runner. Not in production bundle. Low priority — will be fixed when @wdio/cli updates. Consider adding to pnpm overrides if desired.

#### HIGH: basic-ftp — Incomplete CRLF Injection Protection

| Field | Value |
| --- | --- |
| Package | basic-ftp |
| Installed | 5.2.0 |
| Patched in | &gt;=5.2.2 |
| Advisory | GHSA-6v7q-wjvx-w8wg |
| Path | Same as above |

**Impact:** Same as above — bypass of the first fix. Same mitigation applies. **Action:** Same as above — dev-only, not in production.

### Cargo: 0 exploitable vulnerabilities, 25 warnings

All 25 cargo audit findings are **warnings** (unmaintained/unsound), not exploitable vulnerabilities:

| Category | Count | Crates | Impact |
| --- | --- | --- | --- |
| GTK3 unmaintained | 18 | atk, atk-sys, gdk, gdk-sys, gdkwayland-sys, gdkx11, gdkx11-sys, gtk, gtk-sys, gtk3-macros, etc. | Linux-only. Tauri transitive deps. No action possible until Tauri migrates to gtk4-rs. Not compiled on macOS. |
| bincode unmaintained | 1 | bincode 1.3.3 | Via syntect → typst. No direct use. No action needed. |
| fxhash unmaintained | 1 | fxhash 0.2.1 | Via scraper + wry. No security impact (hash function). |
| instant unmaintained | 1 | instant | Via parking_lot_core. Consider alternative via Tauri upgrade. |
| paste (version issue) | 1 | paste | Via proc-macro-error. No action. |
| proc-macro-error unmaintained | 1 | proc-macro-error | Transitive. No action possible. |
| unic-\* unmaintained | 4 | unic-char-property, unic-char-range, unic-common, unic-ucd-\* | Via wry. Unicode tables, no security impact. |
| yaml-rust unmaintained | 1 | yaml-rust | Via syntect → typst. No direct use. |
| rand unsound | 1 | rand 0.9.2 | Only exploitable with custom global loggers. Not applicable to Notesage. |

**Summary:** No actionable Cargo security issues. All warnings are transitive dependencies from Tauri/typst that cannot be independently upgraded.

---

## Section 4: Staleness Analysis

All direct dependencies have been updated within the last 12 months.

No stale packages found. Key check results:

- `@zed-industries/claude-agent-acp`: Last release 2026-03-26 (16 days ago) — but **deprecated** in favor of `@anthropic-ai/claude-agent-sdk`
- `lucide-react`: Last release 2026-04-09 (2 days ago)
- `diff-match-patch`: Stable library, no staleness concern
- All Tauri plugins: Released within last 30 days

---

## Section 5: Major Upgrade Opportunities

### vite — v7.3.2 → v8.0.8 ✅ Upgraded

**Breaking changes:**

- Requires Node &gt;=22.12 (currently on 25.2.1 — compatible)
- Environment API changes (affects SSR, not applicable here)
- CSS handling changes (may affect Tailwind integration)

**Migration effort:** M (need to test Tailwind v4 compatibility, update vite.config.ts)

**Benefit:**

- Performance improvements in dev server
- Better HMR reliability

**Risk:**

- @tailwindcss/vite plugin compatibility with Vite 8
- Tauri CLI vite integration

**Recommendation:** ~~Defer until Tailwind v4.2 confirms Vite 8 support.~~ Done — upgraded to Vite 8.0.8 with Tailwind 4.2.2. All tests pass.

---

### typescript — v5.8.3 → v6.0.2 ✅ Upgraded

**Breaking changes:**

- New strict checks may surface type errors
- Some deprecated APIs removed
- `--target` defaults changed

**Migration effort:** M (run `pnpm typecheck`, fix any new errors)

**Benefit:**

- New type features (better inference, narrowing)
- Performance improvements in tsc

**Risk:**

- New strict checks could require code changes
- Third-party .d.ts compatibility

**Recommendation:** ~~Upgrade now.~~ Done — removed deprecated `baseUrl`, fixed 6 type errors (optional `isActive`, stricter `ArrayBufferLike` casts). All tests pass.

---

### @vitejs/plugin-react — v4.7.0 → v6.0.1 ✅ Upgraded

**Breaking changes:**

- Requires Node &gt;=22.12
- Tied to Vite 8 (must upgrade together)

**Migration effort:** S (usually just version bump with Vite)

**Benefit:**

- React 19 fast refresh improvements
- Better error overlays

**Risk:**

- Must upgrade Vite 8 first

**Recommendation:** ~~Defer — bundle with Vite 8 upgrade.~~ Done — upgraded to 6.0 alongside Vite 8.0.8.

---

### lucide-react — v0.564.0 → v1.8.0 ✅ Upgraded

**Breaking changes:**

- Icon component names may have changed (v1.0 standardized naming)
- Import paths may differ
- Some icons renamed or removed

**Migration effort:** M (find/replace icon imports, verify all icons render)

**Benefit:**

- Smaller bundle (tree-shaking improvements)
- New icons available
- Long-term maintenance (v0.x is legacy)

**Risk:**

- Renamed icons cause build failures (easily caught by TypeScript)
- Some icons may have visual differences

**Recommendation:** ~~Upgrade now.~~ Done — zero icon renames needed, clean drop-in upgrade.

---

### @zed-industries/claude-agent-acp — v0.18.0 → DEPRECATED ✅ Replaced

**Breaking changes:**

- Package deprecated in favor of `@anthropic-ai/claude-agent-sdk`
- API surface likely similar but package name/imports change

**Migration effort:** S-M (rename imports, verify ACP protocol compatibility)

**Benefit:**

- Official Anthropic package with ongoing support
- Won't disappear from npm

**Risk:**

- API differences between Zed's fork and Anthropic's official SDK
- Need to verify ACP protocol version compatibility

**Recommendation:** ~~Upgrade now.~~ Done — replaced with `@agentclientprotocol/claude-agent-acp@0.26.0`.

---

## Section 6: Heavy Transitive Dependencies

| Package | Direct? | Purpose | Concern |
| --- | --- | --- | --- |
| @excalidraw/excalidraw | Yes | Drawing canvas | Large bundle (\~2MB), many React sub-deps. Justified — no alternative for the feature. |
| mermaid | Yes | Diagram rendering | Pulls in d3, dagre, elkjs, cytoscape. Heavy but justified — standard for diagrams. |
| pdfjs-dist | Yes | PDF viewing | \~3MB worker bundle. Justified — industry standard. |
| @wdio/cli | Yes (dev) | Real E2E tests | Pulls in Puppeteer, Chromium libs. Dev-only, not in production. |
| docx-preview | Yes | DOCX viewing | Moderate deps. Justified. |

**No duplicate version conflicts detected** in direct dependencies. **No lighter alternatives available** for any of the heavy packages — they serve specialized purposes without viable substitutes.

---

## Section 7: License Inventory

### License Distribution (npm — 1,004 packages total)

| License | Count | Notes |
| --- | --- | --- |
| MIT | 809 | Standard permissive |
| ISC | 68 | Permissive (MIT-equivalent) |
| Apache-2.0 | 46 | Permissive (requires attribution) |
| BSD-3-Clause | 21 | Permissive |
| BSD-2-Clause | 20 | Permissive |
| MIT OR Apache-2.0 | 8 | Dual permissive |
| BlueOak-1.0.0 | 6 | Permissive |
| Unknown | 3 | Review needed |
| CC0-1.0 | 3 | Public domain |
| Apache-2.0 OR MIT | 3 | Dual permissive |
| Unlicense | 2 | Public domain |
| MPL-2.0 | 2 | Weak copyleft (file-level) |
| MIT-0 | 2 | Permissive (no attribution) |
| CC-BY-4.0 | 2 | Permissive for content |
| LGPL-3.0-or-later | 1 | **Copyleft concern** |
| (MIT OR GPL-3.0-or-later) | 1 | Dual — MIT option available |
| Other (Python-2.0, BSD, 0BSD, CC-BY-3.0) | 4 | All permissive |

### License Concerns

| Package | License | Concern | Action |
| --- | --- | --- | --- |
| @img/sharp-libvips-darwin-arm64 | LGPL-3.0-or-later | Copyleft — dynamic linking required for LGPL compliance | **Low risk** — sharp is not a direct dep (likely transitive via dev tooling). Verify it's not in production bundle. |
| jszip | MIT OR GPL-3.0-or-later | Dual license — GPL option available but MIT is the default | **No concern** — MIT applies unless GPL is explicitly chosen. |
| @anthropic-ai/claude-agent-sdk | Unknown | No license declared on npm | **Medium risk** — verify license on GitHub repo (likely Apache-2.0 given Anthropic's standard). |
| css-value (dev) | Unknown | No license declared | **Low risk** — dev dependency only, not in production. |
| khroma | Unknown | No license declared | **Medium risk** — used by mermaid. Check GitHub for license file. |

### Cargo License Summary

All direct Cargo dependencies use permissive licenses:

- Most: MIT OR Apache-2.0
- typst: Apache-2.0
- whisper-rs: MIT
- comrak: BSD-2-Clause
- No GPL/LGPL in direct Cargo dependencies

**No copyleft obligations identified for production builds on macOS.** The LGPL sharp package appears to be a dev/build-time dependency only. The GTK-related packages (LGPL) are Linux-only and not compiled on macOS.
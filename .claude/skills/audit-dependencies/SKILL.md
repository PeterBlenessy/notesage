---
name: audit-dependencies
description: Produce a full dependency health report (SBOM, vulnerabilities, staleness, upgrades, licenses)
user-invocable: true
---

# Audit: Dependency Health & SBOM

Produce a comprehensive Software Bill of Materials and dependency health report. This is a research-only audit — do not modify any code.

## CRITICAL: Completeness Requirement

**Every section below is MANDATORY. Do not skip, abbreviate, or summarize any section.**

- You MUST run every command listed. If a command fails, report the failure and try an alternative.
- You MUST produce output for every table. An empty table with "None found" is acceptable; omitting the table is NOT.
- Do NOT say "skipping due to time" or "this would take too long." Run it. Wait for it. Report the results.
- If a command produces large output, process ALL of it and report the findings. Do not truncate or sample.
- Partial reports are UNACCEPTABLE. If you cannot complete a section, explain exactly what failed and why.

The user is depending on this report for security decisions. Incomplete data is worse than no data.

---

## Section 1: npm Dependency Inventory (SBOM)

Run these commands and process the FULL output:

```bash
# Current versions of all direct dependencies
pnpm ls --depth=0 --json

# Check for outdated packages
pnpm outdated --format=json 2>/dev/null || pnpm outdated

# Security audit
pnpm audit --json 2>/dev/null || pnpm audit
```

**Produce this table for ALL direct dependencies** (from `package.json` dependencies + devDependencies):

```markdown
| Package | Current | Latest | Type | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| react | 19.0.0 | 19.1.0 | dep | Minor available | — |
| vite | 5.2.0 | 6.0.0 | dev | Major available | Breaking changes |
```

**Status values:**
- `Current` — on latest version
- `Patch available` — bug fix update
- `Minor available` — new features, non-breaking
- `Major available` — breaking changes, needs evaluation
- `Vulnerable` — has known CVE (always flag severity)
- `Unmaintained` — no release in 12+ months

For packages with `Major available` or `Vulnerable` status, add a **Notes** column entry explaining the impact.

---

## Section 2: Cargo Dependency Inventory

Run these commands:

```bash
# List direct dependencies with versions
cd src-tauri && cargo tree --depth=1 --prefix=none 2>/dev/null

# Check for outdated crates (if cargo-outdated is installed)
cargo outdated --root-deps-only 2>/dev/null || echo "cargo-outdated not installed — check Cargo.toml manually"

# Security audit (if cargo-audit is installed)
cargo audit 2>/dev/null || echo "cargo-audit not installed �� check advisories manually"
```

**Produce this table for ALL direct Cargo dependencies** (from `Cargo.toml` [dependencies]):

```markdown
| Crate | Current | Latest | Status | Notes |
| --- | --- | --- | --- | --- |
| tauri | 2.2.0 | 2.3.0 | Minor available | — |
| rusqlite | 0.34.0 | 0.34.0 | Current | — |
```

If `cargo-outdated` is not installed, manually check the top 10 most important crates by visiting their crates.io pages or checking the version in Cargo.lock vs Cargo.toml.

---

## Section 3: Security Vulnerabilities

**This section requires ZERO tolerance for skipping.**

Report ALL findings from `pnpm audit` and `cargo audit`. For each vulnerability:

```markdown
### <SEVERITY>: <Package> — <Vulnerability title>

| Field | Value |
| --- | --- |
| Package | <name> |
| Installed | <version> |
| Patched in | <version> |
| CVE | <CVE-ID if available> |
| CVSS | <score if available> |
| Path | <dependency path if transitive> |

**Impact:** <What could be exploited and how>
**Action:** <Upgrade path or mitigation>
```

If `pnpm audit` reports 0 vulnerabilities, state: "pnpm audit: 0 vulnerabilities found (ran on YYYY-MM-DD)."
If `cargo audit` is unavailable, state that explicitly and note it as a gap.

---

## Section 4: Staleness Analysis

**Goal:** Identify dependencies that may be unmaintained or abandoned.

For each direct dependency, check when the last version was published. Flag any package with:
- **No release in 12+ months** — potential maintenance risk
- **No release in 24+ months** — likely unmaintained, evaluate alternatives

Run:
```bash
# Check npm package ages (run for each concerning package)
npm view <package> time --json 2>/dev/null | tail -5
```

Focus on packages that are NOT widely-used ecosystem staples (React, TypeScript, etc. are fine even if their release cadence slows). Flag niche or single-maintainer packages.

Produce a table:

```markdown
### Staleness Flags

| Package | Last Release | Age | Risk | Alternative |
| --- | --- | --- | --- | --- |
| some-package | 2024-01-15 | 26 months | High | consider-alternative |
```

If no packages are stale, state: "All direct dependencies have been updated within the last 12 months."

---

## Section 5: Major Upgrade Opportunities

For each dependency where a major version upgrade is available, evaluate:

```markdown
### <Package> — v<current> → v<latest>

**Breaking changes:**
- <List key breaking changes from changelog/release notes>

**Migration effort:** S / M / L

**Benefit:**
- <What you gain from upgrading — performance, features, security>

**Risk:**
- <What could break — API changes, peer dep conflicts>

**Recommendation:** Upgrade now / Defer / Skip (with reason)
```

If no major upgrades are available, state: "No major version upgrades pending."

---

## Section 6: Heavy Transitive Dependencies

Identify packages that pull in disproportionately large dependency trees:

```bash
# Show dependency tree depth and count
pnpm ls --depth=2 --json | head -500

# Or count transitive deps per direct dependency
pnpm why <package> 2>/dev/null
```

Flag any direct dependency that:
- Pulls in 50+ transitive packages
- Adds 10MB+ to node_modules
- Has multiple versions installed (version conflicts)

```markdown
### Heavy Dependencies

| Package | Direct? | Transitive Count | Duplicate Versions | Notes |
| --- | --- | --- | --- | --- |
| some-heavy-pkg | Yes | 87 | 2 versions | Consider lighter alternative |
```

---

## Section 7: License Inventory

**Important for desktop apps distributed to users.**

```bash
# Generate license list
pnpm licenses list --json 2>/dev/null || npx license-checker --json --production 2>/dev/null
```

Produce a summary:

```markdown
### License Distribution

| License | Count | Packages |
| --- | --- | --- |
| MIT | 150 | (most packages) |
| Apache-2.0 | 25 | ... |
| ISC | 12 | ... |
| BSD-2-Clause | 5 | ... |

### License Concerns

| Package | License | Concern |
| --- | --- | --- |
| some-pkg | GPL-3.0 | Copyleft — may require source disclosure |
| other-pkg | UNKNOWN | No license declared — legal risk |
```

Flag:
- **GPL/LGPL/AGPL** — copyleft obligations for desktop distribution
- **UNKNOWN/UNLICENSED** — legal risk, no permission granted
- **Custom/proprietary** — may restrict distribution

For Cargo dependencies, check `Cargo.toml` license fields or run `cargo license` if available.

---

## Output Format

Save the full report with this structure:

```markdown
# Dependency Health Report — YYYY-MM-DD

**App version:** <from package.json>
**Node:** <version>
**pnpm:** <version>
**Rust:** <version>

## Summary

| Metric | Value |
| --- | --- |
| npm direct deps | N |
| npm dev deps | N |
| Cargo direct deps | N |
| Vulnerabilities (HIGH+) | N |
| Major upgrades available | N |
| Stale packages (12mo+) | N |
| License concerns | N |

## Recommendations

1. **Immediate** (security): ...
2. **Short-term** (staleness/upgrades): ...
3. **Monitor** (no action needed now): ...

---

<Full sections 1-7 below>
```

## Example Commands That MUST Be Run

These are not suggestions. Run ALL of them:

1. `pnpm outdated` — version comparison
2. `pnpm audit` — vulnerability scan
3. `pnpm ls --depth=0` — current installed versions
4. `cd src-tauri && cargo tree --depth=1` — Rust dependency tree
5. `cargo audit` (or note if unavailable)
6. `cargo outdated` (or note if unavailable)
7. `pnpm licenses list` (or alternative)

If any command is not available, install it first (`pnpm add -g <tool>`) or use an alternative. Do NOT skip the section.

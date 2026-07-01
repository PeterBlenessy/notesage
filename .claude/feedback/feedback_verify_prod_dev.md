---
name: Triple-check prod and dev before committing
description: Always verify changes work in BOTH production builds and dev mode before saying they're safe
type: feedback
aw_applies: with-modification
aw_applies_to: [aw-tdd]
aw_note: "AW can't run prod builds — modified rule: avoid changes that obviously break the prod path (e.g., dev-only imports, `import.meta.env.DEV` gates without a prod fallback)."
---

Before confirming a change is production-safe, trace through ALL code paths for both environments. The user was burned by a lib/ directory check that broke production while fixing dev mode. Don't rely on assumptions — read the actual code paths.

**Why:** A previous "no production behavior change" assurance turned out to be wrong — the `lib_dir.exists()` check broke prod builds where the binary is static.
**How to apply:** For any change touching binary resolution, sidecar paths, or platform-specific code: explicitly trace the prod path (app bundle) AND the dev path (target/debug/) through the code. State what happens in each case before confirming.

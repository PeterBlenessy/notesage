---
name: Don't apply special-case workarounds without explicit approval
description: When a feature gap forces a choice between two options, surface the choice to the user — don't pick a workaround silently. The "obvious safe default" often isn't what the user wants.
type: feedback
originSessionId: e0a9c6e6-c7bb-4748-a54a-f7fbc33596a2
aw_applies: with-modification
aw_applies_to: [aw-tdd, aw-iterate]
aw_note: "AW flips to `hitl` label + posts a comment with the choice instead of asking interactively."
---
When a feature gap or compatibility constraint forces a choice between two reasonable options, **ask the user first**. Do not pick the "obviously safer" workaround silently.

**Why:** The user knows the operational context I don't see — who the actual current users are, what the next release will fix, what's acceptable to ship as one-time degraded UX. My "obviously safer" choice is often based on an audience that doesn't actually exist (e.g. "old users will see asterisks" when there are zero old users on that path).

**How to apply:**
- When I notice a constraint that pushes toward a specific implementation (compatibility, edge case, runner variance, version drift), state the constraint + the two options + my best guess + ask.
- Don't trade quality of the primary user experience for compatibility with a hypothetical audience.
- The user can always overrule with "do option A" — that's the right shape. Me unilaterally picking option A and only revealing it after the fact wastes their time when they wanted option B.

**Real incident — 2026-05-15, v0.45.0-alpha.0 release notes:**

The release notes dialog supports markdown rendering on v0.45.0+ (via #208) but NOT on v0.44.0. I prepared the manifest `notes` field as **plain text** to "be compatible with v0.44.0 users." Pushed that without asking.

Result: the actual user (on v0.44.0 doing the update test) saw plain-text-formatted notes when they would have preferred markdown. The "compatibility audience" I was protecting consisted of literally one person — them — for one single dialog. Switching to markdown means that one dialog shows literal asterisks; from then on, every future dialog renders markdown properly.

User's response: "don't do special solution unless you check with me! use markdown!"

The right pattern: surface the two options (plain text for backwards-compat vs markdown for forward-quality), state which way I'd lean and why, and let them choose.

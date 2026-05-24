---
name: Full coverage required — no deferred gaps
description: When implementing a feature, cover ALL touch points completely. Never leave known gaps as "follow-ups" unless the user explicitly says so.
type: feedback
aw_applies: yes
aw_applies_to: [aw-tdd, aw-review]
---

When a feature is planned and scoped (PRD, task breakdown), implement it to full coverage. Do not leave known gaps, inconsistencies, or half-wired UI paths as "future iterations" or "follow-ups."

**Why:** The user found that the Copilot LSP connection config dialog still showed ACP model IDs instead of Copilot-specific model IDs, meaning users could select a model that would be silently ignored or rejected. Deferring this as a "follow-up" was unacceptable — if we claim to add "full support" for something, every surface where the user interacts with it must work correctly.

**How to apply:** Before marking a feature complete, audit every UI surface, config path, and code path that touches the feature. If a model picker, settings dialog, routing dropdown, or any other control exposes the feature, it must work correctly end-to-end. Don't ship a feature where some paths work and others silently fail or show wrong data. If something truly can't be done in scope, flag it to the user and get explicit approval to defer — don't decide unilaterally.

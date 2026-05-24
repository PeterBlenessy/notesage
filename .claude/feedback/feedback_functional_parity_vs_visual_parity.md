---
name: Functional parity ≠ visual mockup parity (two separate gates)
description: When wrapping existing functionality in a new UI shell, functional parity and visual parity are distinct gates — both mandatory, neither substitutes for the other.
type: feedback
originSessionId: e5c215b2-1927-4a03-adb4-ded445ecea6e
aw_applies: yes
aw_applies_to: [aw-tdd, aw-review]
---
When a refactor wraps existing functionality in a new UI shell (e.g., the Quiet Composer refresh rewrapping the legacy `ChatPanel` + `ActivityStrip` + `Sidebar`), correctness is bounded by TWO independent gates, not one:

1. **Functional parity** — every user-reachable action in the legacy shell must be reachable through the new shell. E.g., ⌘K opens the chat, provider switch surfaces context warning, history is browsable, chat send renders a streaming response.
2. **Visual parity** — the new shell looks like the mockups. E.g., spacing, typography, orb animation, DocHead layout.

**Why:** during the 2026-04-23 trial of the Quiet Composer Preview, the user flagged five functional regressions (⌘K dead, double-tap ⌘ dead, send shows bubble no response, `AgentSwitchCard` missing, history missing). I incorrectly framed the "mockup audit #111" as the gate that would have caught these. The user corrected me: "the mockups are not functional they are visual. the functionality is already implemented, we are developing a new look and feel and behaviour basing this on existing functionality." #111 measures pixel/layout fidelity only; functional parity is a separate task.

**How to apply:**

- **For any UI refresh / refactor that reuses existing functionality, plan both gates explicitly**: one functional-parity task (inventory legacy actions, prove reachability) and one visual-parity / mockup task. Neither substitutes for the other.
- **The functional-parity task produces an artifact**: `surface | legacy path | new-shell path | status` — one row per user-reachable action. Action = keyboard shortcut, button click, context menu item, etc.
- **Every action with no new-shell path = blocker**, filed as its own fix task with outcome-shaped acceptance criteria and a composition test.
- **Do not conflate the two audits.** Functional issues (dead bus, unmounted hook, missing render) are NOT mockup drift. Visual issues (orb pulse missing, wrong spacing, wrong font) are NOT functional regressions.
- **Composition tests** (render real parent, fire real gesture, assert observable outcome) are the automatable enforcement layer for functional parity — add them to every task wiring a new surface.

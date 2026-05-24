---
name: Persist through UI challenges — don't give up on the right solution
description: When a UI component doesn't work as expected, research and fix it instead of falling back to inferior alternatives
type: feedback
aw_applies: yes
aw_applies_to: [aw-tdd, aw-iterate]
---

Don't give up when a UI approach fails on first attempt. Example: Radix Tooltip didn't fire inside cmdk CommandItems — instead of researching how others solve this (wrapping, portals, pointer-events workarounds), I immediately fell back to native `title` attribute which is visually inconsistent with the rest of the app.

**Why:** The user expects consistent UI. Falling back to a worse solution without exhausting options is lazy.

**How to apply:** When a third-party component interaction fails, research the issue (GitHub issues, Stack Overflow, source code) before giving up. Try at least 2-3 different approaches. If truly unsolvable, explain WHY with evidence, not just "it doesn't work."

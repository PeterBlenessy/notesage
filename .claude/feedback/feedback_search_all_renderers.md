---
name: Search ALL renderers of a UI pattern before refactoring
description: When a visual bug appears in a UI element, grep the whole codebase for every renderer of that element before assuming one file is "the" implementation. Especially in apps with multiple layout shells.
type: feedback
originSessionId: 74f153e5-da3e-44b1-8a5b-8f88983357c3
aw_applies: yes
aw_applies_to: [aw-tdd]
---
When fixing a visual bug in a shared UI pattern (picker, button, badge, etc.), grep the WHOLE codebase for every renderer of that pattern before touching code. Do not assume the most obvious file is "the" file.

**Why:** Notesage has two parallel layout shells — Classic Layout (`Layout.tsx` → `ChatFooter.tsx`) and Quiet Composer Layout (`QuietLayout.tsx` → `cmd/CommandBarContext.tsx`). Each shell renders its own copy of the chat footer / connection picker / project picker. I refactored `ChatFooter.tsx` for hours, ran the dev server, and the user reported the visual bug was still 100% present. I defended my changes ("the code is correct, the dev server is serving the right module, Tailwind is compiling the right CSS, here are three Notesage processes — maybe you're looking at the wrong window"). I was wrong on every level. The user is on Quiet Composer. That layout's pickers come from `CommandBarContext.tsx`, which I never opened. The full-accent-fill bug was at `CommandBarContext.tsx:552` — `isActive && "bg-[var(--color-accent-primary)] text-[oklch(100%_0_0)]"` — exactly what the user kept screenshotting.

**How to apply:**

1. When the user reports a visual bug in a UI pattern, before opening ANY file run `grep -rln "<distinctive-prop>\|<distinctive-css-class>" src/components --include="*.tsx"` to enumerate every renderer of that pattern.
2. For any feature that exists in both the Classic and Quiet Composer shells (chat footer, sidebar, settings, command bar, status bar, etc.), there are likely TWO independent implementations — `ChatFooter.tsx` and `cmd/CommandBarContext.tsx` are a common pair. Check both.
3. If the user repeats "it still looks the same" after a restart with verified-correct code, the answer is almost never "the user is looking at the wrong window" — it's that the renderer they're looking at lives in a different file than the one I edited.
4. Stop defending the code path. Re-grep with broader search terms (e.g. `bg-\[var\(--color-accent-primary\)\]` to find every place the bug-pattern is hard-coded).

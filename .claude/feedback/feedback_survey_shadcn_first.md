---
name: When asked "is there a shadcn for this?", survey ALL relevant primitives — not the first one that comes to mind
description: Notesage's design system says "use shadcn first." When the user asks whether a shadcn component fits, the right answer is a structured survey of every relevant primitive (CommandItem, DropdownMenuRadioItem, DropdownMenuCheckboxItem, SelectItem, etc.), not "no, only X exists, build custom." Surveying first prevents recommending tailor-made components when shadcn already covers the pattern.
originSessionId: 74f153e5-da3e-44b1-8a5b-8f88983357c3
aw_applies: yes
aw_applies_to: [aw-tdd]
---
When the user asks "is there a shadcn component for this?" or "or shadcn?" or "are these using shadcn?", the answer requires a structured survey of EVERY shadcn primitive that could fit the use case — not just the first one that comes to mind.

**Why:** During the picker-uniformity work in May 2026, the user asked "Are these using shadcn components?" I answered honestly that 3 of 4 weren't — they used plain `<button>` in `<Popover>`. Then the user asked about alternatives, and I surfaced only `<Command>`/`<CommandItem>` (the cmdk wrapper). I recommended a tailor-made `<PickerRow>` component as the right call.

The user then asked: "So you are saying there is no other shadcn component we can use?" — calling me out for not surveying all options. I'd missed `<DropdownMenuRadioGroup>`/`<DropdownMenuRadioItem>` (single-select) and `<DropdownMenuCheckboxItem>` (multi-select) — the family literally designed for "popover with selectable items" with built-in `ItemIndicator` slots. Already installed in the codebase. Would have been the obvious answer.

The user said "Now you are being helpful" once I did the proper survey. The implicit feedback: do the survey FIRST.

**How to apply:**
- When the question is "is shadcn enough?" or "do we need custom?", build a comparison table of every relevant shadcn primitive before recommending. Include: `Command`/`CommandItem` (searchable lists), `DropdownMenu*` family (radio + checkbox items with built-in indicators), `Select*` family (inline-anchored selects), `RadioGroup`/`RadioGroupItem`, `ContextMenu*` family.
- Check what's already installed in `src/components/ui/` before claiming "X isn't available."
- Read the actual exports of installed components — they often have variants (`RadioItem`, `CheckboxItem`, etc.) that solve exactly the problem.
- Recommend tailor-made ONLY when the survey shows shadcn would require enough overrides that we'd be fighting the framework rather than using it.
- The design-system rule "shadcn first" means giving shadcn the benefit of the doubt — and the only way to honour that is to know what shadcn provides.

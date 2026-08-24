# Release v0.53.1

**Date:** 2026-08-24
**Previous version:** 0.53.0

More of the app speaks Swedish, and a text field stops showing gibberish.

## Changes

### Improvements

- **Automations and Connections are translated.** Two settings areas that were
  still entirely in English now follow your chosen language — the automation
  builder (triggers, steps, scheduling) and the connection forms (sandbox,
  writable paths, allowed domains, model selection).

### Fixes

- **The model search field showed `…` instead of `…`.** A literal escape
  sequence was rendering as visible text in the connection settings.

## Under the hood

- 83 new dictionary keys in both languages, shape-verified by the existing i18n
  test. `settings/connection` is now at zero untranslated strings;
  `settings/v2/automations` at five.
- The escape bug is worth recording because the shape recurs: JSX does **not**
  process backslash escapes in attribute values — they are literal strings. So
  `placeholder="Search or type model name…"` rendered the characters
  `…` on screen. Routing it through the dictionary fixed display and
  translation together. The tree was swept for the same shape; this was the
  only instance.
- Found by an audit script that flags user-visible English (JSX text, text
  bearing props, toasts) and ignores anything already inside `t()`. The
  companion script that applies replacements treats a non-match as a
  **failure** rather than a skip — a partial pass that looks complete is the
  real hazard, since the leftover renders in English and nobody notices until a
  Swedish user opens that panel. Both defects above surfaced that way rather
  than by reading code.

## Known

- **697 user-visible strings across 121 files remain untranslated.** Projects,
  Skills, Voice and most dialogs are still English regardless of the chosen
  language. Work is ongoing; this release covers the two areas reported as
  worst.
- The Swedish here has not been reviewed by a native speaker. Terms worth a
  second opinion: *Kärnnivåspärr* (kernel enforcement), *Extra skrivbara
  sökvägar* (extra writable paths), *Svarslängd* (response length).
- X posts saved as HTML still get no gallery thumbnail — X capture remains
  unreachable, enforced by the capture pipeline contract test.

## Files Changed

- The i18n dictionary, the automations builder, and the connection forms.

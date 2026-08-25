# Release v0.54.0

**Date:** 2026-08-25
**Previous version:** 0.53.1

Every settings panel now speaks your language.

## Changes

### Improvements

- **Settings is fully translated.** Projects, Connections, Local AI, Skills,
  Agents, Voice, MCP, Automations, Privacy and System — every panel, dialog,
  button, placeholder and confirmation message now follows the language you
  picked, instead of switching back to English partway down a page.
- **Notifications are translated too.** The confirmations and error messages
  that appear when you rename a project, move one to iCloud, sign out of a
  provider or set up a local agent no longer arrive in English.
- **Language switching is complete where it matters most.** Settings was the
  worst offender because it is the one place you go when something needs
  explaining — reading half of it in a second language made it harder, not
  easier.

## Under the hood

- 295 user-visible strings across 35 files routed through the dictionary, in
  five batches. `src/components/settings` now audits at **zero** untranslated
  strings, down from 276.
- A new test ratchets the count so it can only fall: a ceiling at today's
  number, a hard zero for the finished area, and a staleness check that fails
  if the ceiling drifts more than 25 above reality. A hard zero everywhere
  would fail on `main` for as long as the remaining work takes, which teaches
  people to ignore the job; a ceiling fails only when someone *adds*
  untranslated text. Verified it bites by reverting a single `t()` call.
- The audit script (`scripts/i18n-audit.mjs`) moved into the repo so the test
  and the CLI share one definition of "user-visible English".
- Two tooling defects surfaced by doing the work rather than by reading code.
  The apply script only added `import { t }` when a file had *no* `@/lib/i18n`
  import at all — one file already imported `getFormatLocale` from there, so
  the guard passed while `t` stayed undefined. And the audit counted
  `() => Promise<void>` as a JSX text node containing "Promise", inflating the
  count by five.

## Known

- **376 strings across 74 files remain untranslated** outside Settings — chart
  settings, the document viewers, the skill and agent wizards, the actions
  bar. Work is ongoing; Settings was done first because it is where a
  half-translated UI hurts most.
- The Swedish has not been reviewed by a native speaker.

## Files Changed

- 3 commits since v0.53.1; the desktop-facing one is the translation work.
  The other two are iOS-only (X post capture, shipped separately as
  TestFlight build 15) and do not affect this build.

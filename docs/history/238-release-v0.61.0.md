# Release v0.61.0

**Date:** 2026-09-24
**Previous version:** 0.60.4

Notesage now collects nothing at all. The usage and crash reporting that could
be switched on is gone from the app entirely, and the two settings that governed
it are gone with it.

## Changes

### Improvements

- Notesage no longer collects anything — no usage analytics, no crash reports,
  on either the Mac app or the iPhone app. This is not a new default you could
  change back: the code that did it has been removed, and the two switches for
  it have left Settings → System because there is nothing left to switch. The
  privacy policy at notesage.io/privacy now says so in plain language.
- The third-party licence list shows the full licence text for every
  component, including the ones whose projects ship no licence file of their
  own.

### Fixes

- Skills could fail to appear and then stay missing for the rest of the
  session. Opening the command bar in the first moments after launch, before
  the app had finished starting, could leave it permanently empty with no way
  back short of restarting.
- Opening the command bar that early could also start a second, redundant scan
  of your skills immediately after the first — making startup slower at exactly
  the moment it was meant to be faster.

## Under the hood

The telemetry removal is #1063: two opt-out streams that shipped between
2026-06 and 2026-09 and produced, in their whole life, zero commits and zero
issues. Nobody read the dashboards, so it was 907 lines across 78 files of cost
with no benefit — and the only thing the privacy policy had to explain. The
accounts at both processors have been closed. The dependency tree lost 63
components; the crash SDK was pulling in a whole HTTP server via its minidump
handler.

Three guards replace the old ones and all three name the published policy on
purpose, so that reinstating either SDK fails as a policy decision in review
rather than sliding through as a dependency bump: a Rust test asserting neither
crate appears in `Cargo.toml` on any target, a capability test asserting no
file grants a telemetry permission, and settings persist v29, which drops the
three consent keys rather than letting them round-trip through every save where
they would read as a live privacy setting long after the thing they governed
stopped existing.

Three review passes ran over it. The first caught a scripted-removal slip that
left a `#[cfg(not(target_os = "ios"))]` attached to the wrong item — inert
today, but a silent iOS-only change to the module's public surface. The third
audited the docs and the legal text against the code and found **two more
copies of the privacy policy**, one of them the site generator, where a run
would have republished "telemetry is opt-out, alpha builds collect by default".
Neither the alpha channel nor the telemetry exists. The same audit turned up
three factual errors in the published policy that predate this work, including
its strongest promise about note content: inline completions send as you type,
which "only happens when you invoke it" did not cover.

The perf harness was measuring itself. Eight benchmark files ran concurrently
while each timed wall-clock against a fixed budget, so they competed for cores
and the harness blamed whichever test lost. Forced sequential, it is 45/45
three runs running. Three separate budget-multiplier bumps had treated that
symptom; this release fixes the cause.

Also: a real MCP server on stdio so protocol-era detection can be tested
against something other than a mock (#1060), and the A/B measurement that
settled the startup question and corrected the v0.60.2 claim (#1051).

## Files Changed

82 files across 14 commits (+341 / −3,838)

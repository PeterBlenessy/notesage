# Release v0.48.0-alpha.8

**Date:** 2026-07-01
**Previous version:** 0.48.0-alpha.7
**Channel:** Alpha

Auto-cut by `aw-alpha-cut`. Sections below are auto-classified from merged PRs; refine the prose before promoting to stable.

## Changes

### Features
- feat(automations): scheduled & event-triggered task automation engine (#505)
- feat(sidebar): discoverable Settings button + relocate status strip to sidebar footer (#506)

## Under the hood

Auto-generated from merged PRs + commits since `v0.48.0-alpha.7`. Alpha builds list commit-level detail for technical users.

- Bump rollup from 4.57.1 to 4.59.0 in the npm_and_yarn group across 1 directory (#1)
- Fix Copilot LSP sign-in: handle server→client signIn request for device code (#2)
- Refactor Copilot LSP sign-in flow to handle three-phase auth (#3)
- Add configurable debug logging and fix Copilot LSP issues (#4)
- Bump @mozilla/readability from 0.5.0 to 0.6.0 in /bundled-skills/download-webpage/scripts in the npm_and_yarn group across 1 directory (#5)
- Add hardcoded values audit research (#6)
- Bump quinn-proto from 0.11.13 to 0.11.14 in /src-tauri in the cargo group across 1 directory (#7)
- Add 6 PRDs for local AI agentic features and productivity enhancements (#8)
- Add PRD for always-on memory agent (ported from Google Cloud Platform) (#9)
- Add CLI/ACP vs Agent SDK analysis document (#10)
- Add App Store launch readiness research document (#11)
- Add sandbox-runtime comparison research with identified gaps (#12)
- Claude/analyze notesage competitors pe7w6 (#13)
- feat(sidebar): discoverable Settings button + relocate status strip to sidebar footer
- docs(automations): reword Agent Tasks routing description
- docs(automations): feature doc + agent-step provider/permissions guidance
- ci: re-trigger run for the Playwright scan-crash fix
- fix(automations): don't crash the startup scan when list_automations is empty
- fix(ci): sync pnpm-lock with the picomatch override specifier
- feat(automations): interactive pills, folder picker, removable conditions; drop skill step
- fix(automations): make clicking an "Insert variable" pill actually insert
- feat(automations): magic-variable pills in step fields (redesign Pass 2)
- feat(automations): intuitive dialog — recipe gallery + When/Do framing
- feat(automations): rework the New/Edit automation dialog UX
- feat(automations): Phase 4 Track A — per-step conditional `if`
- refactor(automations): harden foundation per 3-reviewer audit (pre-Phase-4)
- docs(automations): Phase 4 task breakdown (3 optional tracks)
- feat(automations): Phase 3 — workflow/app-event triggers
- docs(automations): Phase 3 task breakdown + cross-links
- feat(automations): Phase 2 — file-event triggers + skill step
- docs(automations): Phase 2 task breakdown + cross-links
- fix(automations): address design-review findings
- fix(automations): address security-review findings (SEC-1/3/4/5)
- docs(automations): mark Phase 1 complete (tasks + PRD)
- test(automations): automation-store + restart-mode coverage (Task #13)
- feat(automations): runs history view + AgentOrb branch (Task #12)
- feat(automations): arm dialog + missed-runs chooser (Task #11)
- feat(automations): form builder (Task #10)
- feat(automations): Settings -> Automations list panel (Task #9)
- feat(automations): approve-to-arm (Task #8)
- feat(automations): pipeline executor + always-mounted runner (Task #7)
- feat(automations): template renderer for {{ }} tokens (Task #6)
- feat(automations): settings master toggle + failure-notify + flag sync (Task #5)
- feat(automations): activity-store kind + durable runs history (Task #4)
- feat(automations): TS types, automation-store, discovery hook (Task #3)
- feat(automations): tokio scheduler + catch-up reconciliation (Task #2)
- feat(automations): add automations command module (Task #1)
- docs(automations): PRD, Phase-1 tasks, and format research

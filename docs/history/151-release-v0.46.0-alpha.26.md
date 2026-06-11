# Release v0.46.0-alpha.26

**Date:** 2026-06-11
**Previous version:** 0.46.0-alpha.25
**Channel:** Alpha

Auto-cut by `aw-alpha-cut`. Sections below are auto-classified from merged PRs; refine the prose before promoting to stable.

## Changes

### Fixes
- fix(html-viewer): render under production CSP, keep shortcuts in the sandboxed iframe, animate find bar (#451)
- fix(html-viewer): re-apply find query on iframe load (fixes find-in-frame flake) (#454)

## Under the hood

Auto-generated from merged PRs + commits since `v0.46.0-alpha.25`. Alpha builds list commit-level detail for technical users.

- security: harden skill/MCP execution, link-preview beacons, CSP, asset scope (#444)
- fix(html-viewer): re-apply the find query on iframe load (fixes find-in-frame flake)
- feat(html-viewer): animate the find-bar morph open and closed
- fix(html-viewer): keep app keyboard shortcuts working when the sandboxed iframe has focus
- fix(html-viewer): serve sandboxed iframe from htmlpreview:// so it renders under the production CSP

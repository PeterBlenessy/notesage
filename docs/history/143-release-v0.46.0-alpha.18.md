# Release v0.46.0-alpha.18

**Date:** 2026-06-08
**Previous version:** 0.46.0-alpha.17
**Channel:** Alpha

> ⚠️ **Broken build — does not launch.** Inherits the alpha.16 startup crash. Fixed in alpha.19; the auto-updater no longer serves it. See #432.

Primary button labels are now legible on the accent fill.

## Changes

### Fixes
- Primary and destructive buttons now keep a legible **white label + icon on the accent fill** in both light and dark mode (matching macOS System Settings), including a readable disabled state (#430).

## Under the hood
- New `--color-on-accent` token: white on a chromatic accent in both themes, falling back to `--color-primary-foreground` on the neutral no-accent button (#430)
- Default `Button` label uses `--color-on-accent` instead of `--color-primary-foreground` (which was dark-on-accent in dark mode) (#430)
- Disabled buttons keep their label and dim via `opacity-70` instead of the unreadable grey `disabled:text-muted-foreground` (#430)

## Known issues
- **Crashes on launch** — inherits the alpha.16 telemetry-plugin runtime panic. Fixed in alpha.19 (#432).

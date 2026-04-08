# Release v0.30.2

**Date:** 2026-04-08
**Previous version:** 0.30.1

## Changes

### Features
- **PPTX generation tier 1-4** — 17 tasks implementing rich presentation generation: hyperlinks, metadata, slide numbers API, subscript/superscript, title shadows, chart YAML parser + rendering (bar, line, pie, doughnut, area, scatter, radar, bubble), slide master definitions, two-column layout, callout/highlight accent shapes, auto-page tables, content overflow with continuation slides, background images, image enhancements (alt text, shadow, cover/round sizing), table enhancements (per-side borders, colspan, alternating rows), YouTube embedding, HTML table import
- **PPTX viewer v2** — 21 tasks implementing viewer quality improvements: color transforms (lumMod/lumOff/tint/shade), slide master/layout inheritance, body properties (autofit, anchoring, margins), line/paragraph spacing, auto-numbered bullets, table cell borders/margins, chart titles/legends/axes, shape shadows, image crop, hyperlinks, 44 preset geometries, strikethrough/superscript/subscript, flip transforms, dash styles, radar/bubble charts

### Fixes
- **Fix exponential shadow value growth** — PptxGenJS mutates shadow option objects in place during XML generation; passing the same theme.titleShadow reference caused values to grow exponentially across slides (38100 → 483870000 → 6.1e12), corrupting the PPTX. Fixed by spreading fresh copies.
- **Fix bundled skill/agent deployment** — write_bundled_file had a debug_assertions guard that skipped writing if files existed in dev builds, causing deployed skills at ~/.notesage/skills/ to go stale after source changes. Removed the guard so bundled files always overwrite on startup.
- **Fix all tools available to all agents** — allowed-tools frontmatter in agent files was filtering which tools the AI model could see and call, causing agents like general-assistant to hide most skill tools. Removed filtering from three call sites; user permission system remains the access control mechanism.

### Documentation
- PRDs for PPTX generation polish (26 features) and viewer polish (23 features)
- Task breakdowns for both polish PRDs
- Research docs updated with cross-references to completed and planned work

## Files Changed
- 18 commits, spanning generate-presentation skill, PPTX viewer, Rust backend, and documentation

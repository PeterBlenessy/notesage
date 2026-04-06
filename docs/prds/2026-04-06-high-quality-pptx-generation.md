# PRD: High-Quality PPTX Slide Deck Generation

|  |  |
| --- | --- |
| **Date** | 2026-04-06 |
| **Status** | Draft |
| **Priority** | High |
| **Impact** | Presentations generated from Notesage documents look professional and respect user-provided branded templates |

## Problem

The current PPTX exporter (`ppt-rs` via `markdown_to_pptx.rs`) produces low-quality output. Regardless of which built-in template is selected or whether a user-provided `.pptx` template is used, the generated slides are plain white pages with basic text — no visual hierarchy, no color, no layout variety, no use of the template's slide masters or layouts.

Specific issues:

1. **Templates are ignored.** User-provided branded `.pptx` templates with custom slide masters, color schemes, fonts, and layouts are not read or applied. All output looks identical regardless of template selection.

2. **No slide layout variety.** Every slide uses the same text-on-white layout. Real presentations use title slides, section headers, two-column layouts, image-with-caption layouts, blank layouts with positioned shapes, etc.

3. **No visual design.** No background colors, no accent lines, no shapes, no visual hierarchy beyond font size. The output would not be accepted in any professional context.

4. **Agent-generated content isn't optimized for the exporter.** The `generate-presentation` skill teaches agents to structure markdown for slides, but the exporter doesn't use the mechanical rules (H1 = title, `---` = break, `> [!notes]` = speaker notes) reliably enough to produce good results.

## Goals

- **G1:** User-provided `.pptx`/`.potx` templates are read and respected — slide masters, layouts, color themes, fonts, and backgrounds are applied to generated slides.
- **G2:** Built-in templates produce visually polished output comparable to Keynote/Google Slides/PowerPoint defaults — with proper backgrounds, color schemes, typography, and layout variety.
- **G3:** The agent-generated markdown maps cleanly to slide layouts — the exporter correctly handles H1 titles, H2 subtitles, bullet lists, tables, images, speaker notes, and slide breaks.
- **G4:** The `generate-presentation` skill includes mechanical formatting rules so agents produce markdown that the exporter handles optimally.

## Non-Goals

- **Real-time preview** of slides in the editor (future feature)
- **Slide animations and transitions** (basic support acceptable, not a priority)
- **Keynote or Google Slides export** — PowerPoint only
- **PPTX template creation** — users provide templates, we don't design them
- **Replacing PowerPoint** — the output should be a solid starting point that users refine in PowerPoint

## Technical Approach

### Option A: Improve ppt-rs Integration (Recommended)

`ppt-rs` v0.2.8 already supports reading and modifying existing PPTX files, 100+ shape types, charts, SmartArt, gradient fills, and built-in templates. The current `markdown_to_pptx.rs` implementation only uses a fraction of these capabilities.

**What needs to change:**

1. **Template reading:** When a user-provided `.pptx` template is selected, open it with `ppt-rs`, enumerate its slide layouts (Title, Title and Content, Section Header, Two Content, Blank, etc.), and use the appropriate layout for each generated slide based on content type.

2. **Layout selection logic:**
   - Title slide (first H1 or document title) → "Title Slide" layout
   - Section headers (H1 after content) → "Section Header" layout
   - Content with title → "Title and Content" layout
   - Two-column content → "Two Content" layout
   - Full-bleed image → "Blank" layout with positioned image
   - Default fallback → "Title and Content"

3. **Theme application:** Read the template's theme (colors, fonts) and apply them to generated content. Text should use the theme's body font, headings should use the heading font, accent colors should come from the theme palette.

4. **Built-in template improvements:** The three built-in templates (Simple, Business, Report) should define proper slide masters with:
   - Background fills (not just white)
   - Title formatting with accent colors
   - Footer/page number styling
   - Consistent typography scale

5. **Content mapping improvements:**
   - Tables → native PPTX tables with theme-colored headers
   - Code blocks → monospace text box with background fill
   - Images → properly sized and centered, respecting aspect ratio
   - Charts → native PPTX charts (already partially supported by ppt-rs)
   - Callout blocks → styled text boxes with accent background

### Option B: python-pptx Script Skill (Alternative)

Add a `scripts/generate.py` to the `generate-presentation` skill that uses `python-pptx` to generate slides. The agent writes the markdown, calls `execute_skill_script` to run the Python script with the markdown file and template path as arguments.

**Advantages:**
- `python-pptx` has 10+ years of maturity and deep OOXML compliance
- Can read any `.pptx` template and clone slide layouts
- Large community with well-documented patterns
- Agent can iterate on the output by re-running the script

**Disadvantages:**
- Requires Python installed (available on most macOS, but not guaranteed)
- Adds runtime dependency outside the Rust binary
- Two PPTX generation paths (Rust built-in + Python skill) to maintain
- `execute_skill_script` permission required for each run

### Option C: Hybrid — Improved Built-in + python-pptx Fallback

Use the improved ppt-rs exporter (Option A) for the built-in export dialog (Cmd+Shift+E), and offer the python-pptx script skill as a higher-quality option for agent-driven generation when Python is available.

## Recommendation

**Start with Option A** — improve the built-in ppt-rs exporter. This benefits all users (not just those with Python) and improves the existing export flow. The key work is in `markdown_to_pptx.rs`: reading template slide layouts, applying themes, and selecting appropriate layouts per slide.

If the ppt-rs capabilities prove insufficient for reading complex branded templates, pivot to Option C and add the python-pptx script as a complement.

## Quality Gates

### Functional

- [ ] Built-in "Business" template produces slides with background color, accent line, and slide numbers
- [ ] Built-in "Report" template produces a dark title slide with white text
- [ ] User-provided `.pptx` template's slide masters are used for generated slides
- [ ] User-provided template's theme colors and fonts are applied to text
- [ ] H1 headings create proper title slides (using "Title Slide" layout from template)
- [ ] H1 headings after content create section header slides
- [ ] Bullet lists render with proper indentation and bullet styling from template
- [ ] Tables render as native PPTX tables with header row styling
- [ ] Images are properly sized and positioned
- [ ] Speaker notes (`> [!notes]`) appear in the notes pane
- [ ] `---` horizontal rules create slide breaks
- [ ] Code blocks render in monospace with background fill

### Design

- [ ] Generated slides look professional — comparable to a human-made deck
- [ ] Built-in templates are visually distinct from each other
- [ ] User-provided branded templates are recognizable in the output
- [ ] Text hierarchy is clear (title > subtitle > body > notes)

### Agent Integration

- [ ] `generate-presentation` skill includes mechanical formatting rules for the exporter
- [ ] Agent-structured markdown produces well-formatted slides
- [ ] Agent can iterate on content after seeing export results

## Dependencies

- `ppt-rs` v0.2.8+ (already in `Cargo.toml`)
- No new runtime dependencies for Option A

## References

- `ppt-rs` docs: https://docs.rs/ppt-rs
- `ppt-rs` repo: https://github.com/yingkitw/ppt-rs
- Current exporter: `src-tauri/src/export/markdown_to_pptx.rs`
- Current templates: `src-tauri/src/export/templates.rs`
- Anthropic PPTX skill (reference only, proprietary license): https://github.com/anthropics/skills/tree/main/skills/pptx
- python-pptx (MIT, for Option B/C): https://python-pptx.readthedocs.io

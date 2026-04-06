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

4. **Agent-generated content isn't optimized for the exporter.** The `generate-presentation` skill teaches agents to structure markdown for slides, but the exporter doesn't use the mechanical rules reliably enough to produce good results.

## Goals

- **G1:** User-provided `.pptx`/`.potx` templates are read and respected — slide masters, layouts, color themes, fonts, and backgrounds are applied to generated slides.
- **G2:** Built-in templates produce visually polished output comparable to Keynote/Google Slides/PowerPoint defaults — with proper backgrounds, color schemes, typography, and layout variety.
- **G3:** The agent-generated markdown maps cleanly to slide layouts — the script correctly handles H1 titles, H2 subtitles, bullet lists, tables, images, speaker notes, and slide breaks.
- **G4:** The `generate-presentation` skill includes mechanical formatting rules so agents produce markdown that the script handles optimally.

## Non-Goals

- **Real-time preview** of slides in the editor (future feature)
- **Slide animations and transitions** (basic support acceptable, not a priority)
- **Keynote or Google Slides export** — PowerPoint only
- **PPTX template creation** — users provide templates, we don't design them
- **Replacing PowerPoint** — the output should be a solid starting point that users refine in PowerPoint

## Technical Approach

### Option A: python-pptx Script Skill (Recommended)

Add a `scripts/generate.py` to the `generate-presentation` skill that uses `python-pptx` to generate slides. The agent writes a presentation-structured markdown file, then calls `execute_skill_script` to run the Python script with the markdown file and template path as arguments.

**Why python-pptx:**

- 10+ years of maturity, deep OOXML compliance
- Reads any `.pptx` template and clones slide layouts — branded templates just work
- Theme-aware: inherits colors, fonts, backgrounds from the template
- Large community with well-documented patterns for every slide type
- MIT license
- Python ships with macOS, widely available

**Architecture:**

```
Agent → structures markdown → writes presentation.md
Agent → calls execute_skill_script("generate-presentation", "scripts/generate.py", [
  "<input.md>",
  "<output.pptx>",
  "--template", "<template.pptx>"   // optional
])
Script → reads markdown, parses into slide model
Script → opens template (or creates from scratch with built-in defaults)
Script → maps content to slide layouts from the template
Script → writes .pptx
```

**Script responsibilities:**

1. **Parse markdown into a slide model:**
   - H1 → new slide (title)
   - H2 → subtitle on same slide
   - `---` → explicit slide break
   - Bullet/numbered lists → content placeholders
   - Tables → native PPTX tables
   - Images → embedded images
   - `> [!notes]` → speaker notes pane
   - Code blocks → monospace text box with background

2. **Template handling:**
   - If template provided: open it, enumerate slide layouts by name
   - Map content types to layouts: "Title Slide", "Title and Content", "Section Header", "Two Content", "Blank"
   - Fall back gracefully if a layout name doesn't exist
   - If no template: create with sensible defaults (not plain white)

3. **Built-in defaults (no template):**
   - Three built-in styles matching our current Simple/Business/Report names
   - Each with proper background, accent colors, font hierarchy
   - Passed via `--style simple|business|report` flag

4. **Content quality:**
   - Tables with themed header row
   - Code blocks with light grey background, monospace font
   - Images properly sized (max 80% slide width, centered)
   - Bullet indentation matching template's placeholder formatting
   - Speaker notes in the notes pane

**Skill directory structure:**

```
bundled-skills/generate-presentation/
├── SKILL.md                    # Agent instructions (already exists)
├── references/
│   └── TEMPLATES.md            # Template descriptions (already exists)
└── scripts/
    ├── generate.py             # Main generation script
    └── requirements.txt        # python-pptx dependency
```

**Installation:** The script checks for `python-pptx` on first run and installs via `pip install python-pptx` if missing (into user site-packages). Or agent runs `pip install python-pptx` first.

### Option B: Improve ppt-rs Built-in Exporter (Future)

Keep the existing Rust-based exporter for the Cmd+Shift+E quick export flow, but improve it separately:

- Read template slide layouts
- Apply theme colors and fonts
- Better built-in template designs

This is higher effort (deep Rust/OOXML work) and can be done later. The python-pptx skill provides the high-quality path immediately.

## Recommendation

**Implement Option A now.** The python-pptx script skill gives us high-quality, template-aware PPTX generation with minimal implementation effort. The built-in exporter continues to work as a quick-and-dirty option via Cmd+Shift+E. Option B can improve the built-in exporter later.

## Quality Gates

### Functional

- [ ] Script generates slides from markdown with proper title/content separation
- [ ] User-provided `.pptx` template's slide masters and layouts are used
- [ ] User-provided template's theme colors and fonts are applied
- [ ] H1 headings create proper title slides (using template's "Title Slide" layout)
- [ ] Section breaks (`---`) create new slides
- [ ] Bullet lists render with proper indentation and styling from template
- [ ] Tables render as native PPTX tables with header row styling
- [ ] Images are properly sized and positioned
- [ ] Speaker notes (`> [!notes]`) appear in the notes pane
- [ ] Code blocks render in monospace with background fill
- [ ] Works without a template (sensible built-in defaults)
- [ ] Three built-in styles (simple, business, report) produce visually distinct results

### Design

- [ ] Generated slides look professional — comparable to a human-made deck
- [ ] Built-in styles are visually distinct from each other
- [ ] User-provided branded templates are recognizable in the output
- [ ] Text hierarchy is clear (title > subtitle > body > notes)

### Agent Integration

- [ ] `generate-presentation` skill documents the `execute_skill_script` call for the Python script
- [ ] Agent-structured markdown produces well-formatted slides
- [ ] Agent can iterate by re-running the script after adjustments
- [ ] Skill works with Claude Code, Codex, Copilot, and Gemini CLI ACP agents

## Dependencies

- `python-pptx` (MIT license, pip install)
- Python 3 (ships with macOS, widely available)

## References

- python-pptx docs: https://python-pptx.readthedocs.io
- python-pptx repo: https://github.com/scanny/python-pptx
- Current exporter: `src-tauri/src/export/markdown_to_pptx.rs`
- Current skill: `bundled-skills/generate-presentation/`
- Anthropic PPTX skill (reference patterns only, proprietary license): https://github.com/anthropics/skills/tree/main/skills/pptx

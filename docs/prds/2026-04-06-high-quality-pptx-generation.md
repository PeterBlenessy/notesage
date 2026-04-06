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

2. **No slide layout variety.** Every slide uses the same text-on-white layout. Real presentations use title slides, section headers, two-column layouts, image-with-caption layouts, etc.

3. **No visual design.** No background colors, no accent lines, no shapes, no visual hierarchy beyond font size. The output would not be accepted in any professional context.

4. **The built-in exporter (Cmd+Shift+E) is a quick-and-dirty path.** It stays as-is for now. This PRD focuses on the agent-driven high-quality path.

## Goals

- **G1:** A PptxGenJS-based script skill produces visually polished slides with proper backgrounds, color schemes, typography, and layout variety.
- **G2:** User-provided `.pptx`/`.potx` templates are read and their theme (colors, fonts, backgrounds) is extracted and applied to the generated slides.
- **G3:** The agent distills source material (documents, transcripts, notes, folders) into a well-structured presentation, then generates the PPTX via the script.
- **G4:** The workflow is fully agent-driven — works with all ACP agents (Claude Code, Codex, Copilot, Gemini CLI) and direct API connections.

## Non-Goals

- **Improving the built-in Rust exporter** — separate future work (Option B in earlier drafts)
- **Real-time slide preview** in the editor
- **Slide animations and transitions**
- **Keynote or Google Slides export**
- **Replacing PowerPoint** — the output is a solid starting point for refinement

## Technical Approach

### PptxGenJS Script Skill

The `generate-presentation` skill gets a `scripts/generate.mjs` Node.js script that uses PptxGenJS to produce high-quality slides. The agent writes a presentation-structured markdown file, then calls `execute_skill_script` to generate the PPTX.

**Why PptxGenJS:**

- Both Anthropic and OpenAI chose PptxGenJS for their official presentation skills
- Flat, declarative API that LLMs generate reliably (`slide.addText({...})`)
- Zero dependencies, Node.js only
- Produces clean OOXML with proper placeholder structure
- Supports Slide Masters, charts, tables, images, shapes
- MIT license
- Slides can be re-themed in PowerPoint after generation (proper placeholder structure enables "Apply Layout")

### Architecture

```
Agent reads source material (docs, transcripts, folders)
  → Agent writes presentation.md (structured for slides)
  → Agent calls execute_skill_script("generate-presentation", "scripts/generate.mjs", [
      "presentation.md",
      "output.pptx",
      "--template", "template.pptx"    // optional user template
      "--style", "business"            // or: simple, report (built-in)
    ])
  → Script reads markdown, parses into slide model
  → If template provided: extracts theme (colors, fonts, backgrounds) from the .pptx ZIP
  → Generates slides with PptxGenJS using the theme
  → Writes .pptx
  → Agent reports result to user
```

### Template Theme Extraction

A `.pptx` file is a ZIP archive. The script reads the user's template directly (no Rust involvement):

1. Unzip the `.pptx` in memory
2. Parse `ppt/theme/theme1.xml` → extract color scheme (`a:clrScheme`: dk1, dk2, lt1, lt2, accent1-6, hlink, folHlink) and font scheme (`a:fontScheme`: major/minor fonts)
3. Parse `ppt/slideMasters/slideMaster1.xml` → extract background fill
4. Parse `ppt/slideLayouts/*.xml` → enumerate layout names and placeholder positions

The extracted theme drives PptxGenJS Slide Master definitions — same colors, fonts, and backgrounds as the user's branded template.

### Markdown-to-Slide Parsing

The script parses the agent's markdown into a slide model:

| Markdown | Slide Result |
|----------|-------------|
| `# Heading` | New slide — title |
| `## Subheading` | Subtitle on same slide |
| `### Lower headings` | Bold body text |
| `---` | Force new slide |
| Bullet list | Content placeholder bullets |
| Numbered list | Numbered content |
| GFM table | Native PPTX table |
| Code block | Monospace text box with background |
| `![image](path)` | Embedded image |
| `> [!notes]` callout | Speaker notes pane |
| Other callouts | Styled text box |

### Layout Selection

Based on slide content, the script selects appropriate layouts:

| Content Pattern | Layout |
|----------------|--------|
| Title only (first slide or after `---`) | Title Slide |
| H1 after content | Section Header |
| Title + bullets/text | Title and Content |
| Title + image | Picture with Caption |
| Title + two lists | Two Content |
| Image only | Blank with centered image |
| Default | Title and Content |

### Built-in Styles (No Template)

Three built-in styles when no user template is provided:

**Simple:**
- White background, dark text
- Clean sans-serif font (Calibri)
- No slide numbers, no footer
- Minimal visual chrome

**Business:**
- Light grey background with dark header accent bar
- Slide numbers in footer
- Professional sans-serif (Calibri)
- Accent color on titles

**Report:**
- Dark title area with white text, light content area
- Title + date on title slide
- Headers and footers throughout
- Formal serif option (Cambria headings, Calibri body)

### Skill Directory Structure

```
bundled-skills/generate-presentation/
├── SKILL.md                     # Agent instructions
├── references/
│   └── TEMPLATES.md             # Template descriptions
└── scripts/
    ├── generate.mjs             # Main PptxGenJS generation script
    └── package.json             # pptxgenjs + jszip dependencies
```

### Script Dependencies

- `pptxgenjs` — slide generation (MIT, zero-dependency at runtime)
- `jszip` — reading user template ZIP (MIT, for theme extraction)
- Both installed in the skill's `scripts/` directory

## User Workflow

### With Custom Template

```
User: Create a presentation from this document. Use my company template.
Agent: Which template? I'll check for available templates.
       [lists .pptx files in ~/.notesage/pptx-templates/ and project templates]
User: Use the Acme-Corp.pptx template.
Agent: [reads document, structures for slides, writes presentation.md]
       [calls generate.mjs with --template Acme-Corp.pptx]
       Presentation saved to document-slides.pptx using your Acme Corp branding.
```

### Without Template

```
User: Turn this meeting transcript into slides.
Agent: Which style? Simple (minimal), Business (professional), or Report (formal)?
User: Business.
Agent: [reads transcript, distills key points, writes presentation.md]
       [calls generate.mjs with --style business]
       Created a 12-slide deck from the meeting. Saved to meeting-slides.pptx.
```

## Quality Gates

### Functional

- [ ] Script generates slides from markdown with proper title/content separation
- [ ] Built-in "simple" style produces clean, minimal slides (not plain white)
- [ ] Built-in "business" style produces slides with accent bar, slide numbers
- [ ] Built-in "report" style produces dark-title slides with formal typography
- [ ] Three built-in styles are visually distinct from each other
- [ ] User-provided `.pptx` template's color scheme is extracted and applied
- [ ] User-provided template's fonts are extracted and applied
- [ ] User-provided template's background is extracted and applied
- [ ] H1 headings create title slides
- [ ] H1 after content creates section header slides
- [ ] Bullet lists render with proper indentation
- [ ] Tables render as native PPTX tables with header styling
- [ ] Images are properly sized and positioned
- [ ] Code blocks render in monospace with background fill
- [ ] Speaker notes (`> [!notes]`) appear in notes pane
- [ ] `---` creates slide breaks

### Design

- [ ] Generated slides look professional — a user would present these
- [ ] User-provided branded templates are recognizable in the output
- [ ] Text hierarchy is clear (title > subtitle > body)
- [ ] Content doesn't overflow slide boundaries

### Agent Integration

- [ ] `generate-presentation` SKILL.md documents the script call with all flags
- [ ] Works with Claude Code, Codex, Copilot, Gemini CLI ACP agents
- [ ] Agent can iterate by modifying markdown and re-running the script
- [ ] Script provides clear error messages when generation fails

## Dependencies

- `pptxgenjs` (MIT) — slide generation
- `jszip` (MIT) — template ZIP reading for theme extraction
- Node.js (required by ACP agents anyway)

## References

- PptxGenJS docs: https://gitbrent.github.io/PptxGenJS/
- PptxGenJS repo: https://github.com/gitbrent/PptxGenJS
- OOXML theme spec: `a:clrScheme`, `a:fontScheme` in `ppt/theme/theme1.xml`
- Anthropic PPTX skill (reference patterns, proprietary license): https://github.com/anthropics/skills/tree/main/skills/pptx
- OpenAI slides skill (reference patterns): https://github.com/openai/skills/tree/main/skills/.curated/slides
- Current skill: `bundled-skills/generate-presentation/`

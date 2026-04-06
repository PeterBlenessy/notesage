# High-Quality PPTX Slide Deck Generation — Task Breakdown

|  |  |
| --- | --- |
| **Date** | 2026-04-06 |
| **Status** | Not started |
| **PRD** | [high-quality-pptx-generation](../prds/2026-04-06-high-quality-pptx-generation.md) |
| **Total** | 9 tasks: 2S, 4M, 3L |
| **Suggested order** | Script foundation (#1-#3) → Template support (#4-#5) → Built-in styles (#6) → Skill update (#7) → Bundling (#8) → Testing (#9) |

**Risks:**

- PptxGenJS Slide Master API may not support all theme properties extracted from user templates (e.g., gradient backgrounds, complex fills). Verify during #5.
- Markdown parsing needs to handle edge cases: nested lists, tables with merged cells, images with relative paths. Task #3 should cover common cases first, iterate later.
- Node.js dependency install (`npm install` in scripts/) may fail in sandboxed agent environments. The script should detect missing deps and give a clear error.

---

### #1 — Create package.json and scaffold generate.mjs

**Description:** Create `bundled-skills/generate-presentation/scripts/package.json` with `pptxgenjs` and `jszip` dependencies. Create `scripts/generate.mjs` with CLI argument parsing, help text, and the basic flow skeleton (read markdown → parse → generate → write). No actual slide generation yet — just the entry point that validates inputs and exits cleanly.

**Acceptance criteria:**

- `node generate.mjs --help` prints usage
- `node generate.mjs input.md output.pptx` reads the markdown file and creates an empty `.pptx`
- `node generate.mjs input.md output.pptx --style business` accepts the style flag
- `node generate.mjs input.md output.pptx --template template.pptx` accepts the template flag
- Missing input file produces a clear error message
- Missing npm dependencies produce a clear "run npm install" error

**Complexity:** S
**Category:** frontend
**Dependencies:** None
**Files:**

- Create: `bundled-skills/generate-presentation/scripts/generate.mjs`
- Create: `bundled-skills/generate-presentation/scripts/package.json`

---

### #2 — Markdown-to-slide parser

**Description:** Implement the markdown parser in `generate.mjs` that converts the agent's markdown into a slide data model. Use a simple line-by-line parser (no heavy markdown AST library needed).

Parsing rules:
- `# Heading` → new slide with title
- `## Subheading` → subtitle on current slide
- `### Lower` → bold body text line
- `---` → force new slide (next content starts a fresh slide)
- `- item` / `* item` → bullet list items (track nesting via indentation)
- `1. item` → numbered list items
- `| col | col |` → table (collect rows until non-table line)
- `` ```lang `` → code block (collect until closing ``` )
- `![alt](path)` → image reference
- `> [!notes]` → speaker notes (collect until end of blockquote)
- Other `> ` lines → blockquote/callout text
- Plain paragraphs → body text

Output: array of slide objects, each with `{ title?, subtitle?, content: ContentItem[], notes?, layout }` where `ContentItem` is `{ type: 'bullets' | 'numbered' | 'text' | 'table' | 'code' | 'image' | 'callout', data }`.

**Acceptance criteria:**

- Parses H1 into separate slides
- Parses H2 as subtitle on same slide
- Bullet lists with nesting preserved
- Tables parsed into row/col arrays
- Code blocks captured with language tag
- Speaker notes extracted from `> [!notes]` callouts
- `---` creates slide breaks
- Images captured with path and alt text

**Complexity:** L
**Category:** frontend
**Dependencies:** Depends on #1
**Files:**

- Modify: `bundled-skills/generate-presentation/scripts/generate.mjs`

---

### #3 — PptxGenJS slide generation (core)

**Description:** Implement the core slide generation: take the parsed slide model and produce a `.pptx` using PptxGenJS. This task handles the default style (no template, no built-in styles yet — just clean, well-structured output).

For each slide:
- Select layout based on content (title-only → title slide, title+content → standard, image-only → blank with image, etc.)
- Render title in the title placeholder area
- Render subtitle below title
- Render bullets/numbered lists in content area with proper indentation
- Render tables as native PptxGenJS tables
- Render code blocks as monospace text boxes with grey background
- Render images (read from disk, embed)
- Add speaker notes to the notes pane
- Handle text that might overflow (basic truncation or font size reduction)

Default styling: Calibri font, dark text on white, 44pt titles, 24pt body, 18pt code.

**Acceptance criteria:**

- Generates a valid `.pptx` that opens in PowerPoint/Keynote/Google Slides
- Title slides have large centered title text
- Content slides have title + body content
- Bullet lists render with proper indentation levels
- Tables render as native PPTX tables with header row
- Code blocks have monospace font and grey background
- Images are embedded and properly sized (max 80% slide width)
- Speaker notes appear in notes pane
- Slides are correctly separated by H1 and `---`

**Complexity:** L
**Category:** frontend
**Dependencies:** Depends on #2
**Files:**

- Modify: `bundled-skills/generate-presentation/scripts/generate.mjs`

---

### #4 — Template theme extraction

**Description:** Implement reading a user-provided `.pptx` template to extract the theme. Use `jszip` to open the ZIP, then parse the XML files.

Extract from the template:
- `ppt/theme/theme1.xml` → color scheme (`a:clrScheme` children: dk1, dk2, lt1, lt2, accent1-6, hlink, folHlink — each has `a:srgbClr` or `a:sysClr` with a hex value) and font scheme (`a:fontScheme` → `a:majorFont`/`a:minorFont` → `a:latin` typeface)
- `ppt/slideMasters/slideMaster1.xml` → background fill (solid color, gradient, or image)
- `ppt/slideLayouts/*.xml` → layout names (from `p:cSld` name attribute or relationship type) and placeholder positions

Output: a theme object `{ colors: { dk1, dk2, lt1, lt2, accent1-6 }, fonts: { heading, body }, background: { type, color?, gradient? }, layouts: [{ name, placeholders }] }`.

**Acceptance criteria:**

- Reads a standard `.pptx` template file
- Extracts all 12 theme colors correctly
- Extracts heading and body font names
- Extracts slide master background (at least solid color fills)
- Lists available slide layouts with names
- Returns a clean theme object usable by the generator
- Handles missing/malformed theme files gracefully (falls back to defaults)

**Complexity:** M
**Category:** frontend
**Dependencies:** Depends on #1
**Files:**

- Modify: `bundled-skills/generate-presentation/scripts/generate.mjs`

---

### #5 — Apply extracted theme to generated slides

**Description:** Wire the theme extraction (#4) into the slide generation (#3). When `--template` is provided:

1. Extract theme from the template
2. Define a PptxGenJS Slide Master using the extracted colors, fonts, and background
3. Apply the theme to all generated slides: title font = heading font from theme, body font = body font, accent colors on title backgrounds, table headers use accent1, etc.

Map the 12 OOXML theme colors to PptxGenJS usage:
- `dk1` → primary text color
- `lt1` → slide background (or extracted background)
- `accent1` → title accent, table headers, section headers
- `accent2-6` → chart colors, bullet colors
- Heading font → slide titles
- Body font → all body text, bullets, tables

**Acceptance criteria:**

- Slides generated with `--template` use the template's colors
- Slides use the template's heading and body fonts
- Slide background matches the template's master background
- Title slides use accent color
- Tables use accent-colored header row
- Falls back to defaults if theme extraction fails partially

**Complexity:** M
**Category:** frontend
**Dependencies:** Depends on #3, #4
**Files:**

- Modify: `bundled-skills/generate-presentation/scripts/generate.mjs`

---

### #6 — Built-in styles (simple, business, report)

**Description:** Implement the three built-in styles as hardcoded theme configurations (same shape as the extracted theme object). Selected via `--style simple|business|report`.

**Simple:**
- Background: white (`FFFFFF`)
- Text: dark grey (`333333`)
- Accent: medium grey (`666666`)
- Font: Calibri for everything
- No slide numbers, no footer

**Business:**
- Background: light grey (`F2F2F2`)
- Title area: dark accent bar (`2D2D2D`) with white title text
- Body text: dark (`333333`)
- Accent: dark grey for headers/emphasis
- Font: Calibri
- Slide numbers bottom-right

**Report:**
- Title slide: dark background (`1A1A1A`), white text
- Content slides: white background, dark text
- Accent: medium dark (`404040`)
- Heading font: Cambria, Body font: Calibri
- Slide numbers + title in footer

**Acceptance criteria:**

- `--style simple` produces minimal, clean slides
- `--style business` produces slides with accent bar and slide numbers
- `--style report` produces dark-title, formal slides
- All three styles are visually distinct when opened in PowerPoint
- Default (no --style, no --template) uses `simple`
- Styles produce slides a user would actually present (not plain white)

**Complexity:** M
**Category:** frontend
**Dependencies:** Depends on #3
**Files:**

- Modify: `bundled-skills/generate-presentation/scripts/generate.mjs`

---

### #7 — Update SKILL.md with script usage

**Description:** Update the `generate-presentation` SKILL.md to document the `execute_skill_script` call for the `generate.mjs` script. Include:

- The exact call syntax with all flags
- How to list available custom templates (check directories)
- The markdown formatting rules the agent should follow for best results
- How to iterate (modify markdown, re-run script)
- Error handling guidance

Also update `references/TEMPLATES.md` to describe the built-in styles and custom template usage.

**Acceptance criteria:**

- SKILL.md documents the exact `execute_skill_script` call with all flags
- Markdown formatting rules are explicit (H1 = new slide, etc.)
- Template discovery workflow is clear
- Agent can follow instructions to produce slides end-to-end
- Works for ACP agents (no built-in tool references)

**Complexity:** S
**Category:** frontend
**Dependencies:** Depends on #3, #6
**Files:**

- Modify: `bundled-skills/generate-presentation/SKILL.md`
- Modify: `bundled-skills/generate-presentation/references/TEMPLATES.md`

---

### #8 — Bundle scripts in Rust extraction

**Description:** Add the new script files (`generate.mjs`, `package.json`) to the `extract_bundled_skills()` function in `src-tauri/src/commands/skills.rs` via `include_str!()`. Delete the old deployed copies at `~/.notesage/skills/generate-presentation/` so the new version gets extracted on restart.

**Acceptance criteria:**

- `generate.mjs` and `package.json` appear in `~/.notesage/skills/generate-presentation/scripts/` after app restart
- Skill appears in Settings > Skills & Agents with the scripts directory listed
- `execute_skill_script` can run the script

**Complexity:** S
**Category:** backend
**Dependencies:** Depends on #1, #7
**Files:**

- Modify: `src-tauri/src/commands/skills.rs`

---

### #9 — End-to-end testing with ACP agents

**Description:** Test the full workflow with at least two ACP agents (Claude Code + one other). Create test cases:

1. **Basic generation:** Ask agent to create a presentation from a structured markdown document. Verify slides are generated, well-structured, and visually acceptable.
2. **Transcript distillation:** Give agent an unstructured meeting transcript. Verify it distills key points into a coherent slide deck.
3. **Custom template:** Provide a branded `.pptx` template. Verify the output uses the template's colors and fonts.
4. **Style selection:** Test each built-in style (simple, business, report). Verify they're visually distinct.
5. **Error handling:** Test with missing files, missing npm dependencies, invalid markdown.
6. **Iteration:** Ask agent to modify slides and regenerate. Verify the script can be re-run.

**Acceptance criteria:**

- All 6 test cases produce expected results
- Script works when called via `execute_skill_script` from ACP agents
- Error messages are clear and actionable
- Generated `.pptx` files open correctly in PowerPoint, Keynote, and Google Slides

**Complexity:** L
**Category:** frontend
**Dependencies:** Depends on #6, #7, #8
**Files:**

- No file changes — manual testing with verification

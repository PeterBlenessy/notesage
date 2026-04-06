---
name: generate-presentation
description: Generate PowerPoint presentations from documents
user-invocable: true
---

# Generate Presentation

Create professional PowerPoint presentations from any source material — structured notes, meeting transcripts, research, reports, or raw ideas. You analyze the content, distill key points, write a presentation-structured markdown file, then generate the PPTX via a script.

## Your Task

1. **Read the source material.** This could be one file, multiple files, or an entire folder. The input may have no structure at all (e.g., a meeting transcript), or it may be a detailed report. Don't assume headings exist.

2. **Analyze and distill.** Identify the narrative arc, key messages, supporting data, and conclusions. Decide what belongs on slides vs. speaker notes vs. what should be cut entirely.

3. **Ask about style preference.** Built-in options:
   - **Simple** — clean and minimal, white background, no slide numbers
   - **Business** — professional with dark header accent bar, slide numbers
   - **Report** — formal with dark title slides, serif headings, slide numbers

   Also check for **custom branded templates** (`.pptx` files) in:
   - `~/.notesage/pptx-templates/` (global)
   - `<project>/.notesage/pptx-templates/` (project-specific)

   List any custom templates you find as options.

4. **Write a presentation markdown file.** Create a new file (e.g., `presentation.md` or a name the user suggests) following the Slide Format Reference below.

5. **Generate the PPTX.** Run the generation script:

   ```
   execute_skill_script("generate-presentation", "scripts/generate.mjs", [
     "presentation.md",
     "output.pptx",
     "--style", "business"
   ])
   ```

   With a custom template:
   ```
   execute_skill_script("generate-presentation", "scripts/generate.mjs", [
     "presentation.md",
     "output.pptx",
     "--template", "/path/to/template.pptx"
   ])
   ```

   **Important:** The script requires Node.js dependencies. If you get a "pptxgenjs not installed" error, run:
   ```
   execute_skill_script("generate-presentation", "scripts/install-deps.sh", [])
   ```
   Or ask the user to run `npm install` in the skill's `scripts/` directory.

6. **Report the result.** Tell the user the PPTX has been generated and where to find it.

## Script Flags

| Flag | Values | Default | Description |
|------|--------|---------|-------------|
| `--style` | `simple`, `business`, `report` | `simple` | Built-in style preset |
| `--template` | path to `.pptx`/`.potx` | none | Custom template — extracts colors, fonts, backgrounds |
| `--help` | — | — | Show usage |

`--template` overrides `--style`. If neither is provided, `simple` is used.

## Slide Format Reference

When writing the markdown file, these rules control how the script converts it to slides:

| Markdown | Slide Result |
|----------|-------------|
| `# Heading` | New slide — heading becomes the slide title |
| `## Subheading` | Subtitle on the same slide |
| `### Lower headings` | Bold body text |
| `---` | Force a new slide (even without a heading) |
| `- item` / `* item` | Bullet points (indent with spaces for nesting) |
| `1. item` | Numbered points |
| GFM table (`\| col \| col \|`) | Native PowerPoint table with styled header row |
| Code block (triple backticks) | Monospace text with grey background |
| `![alt](path)` | Embedded image (local paths only) |
| `> [!notes]` callout | Speaker notes (not visible on the slide) |
| `> [!tip]`, `> [!warning]`, etc. | Styled callout text |
| `> plain quote` | Italic body text |

### Example Markdown Structure

```markdown
# Quarterly Review

## Q4 2026 Results

---

# Revenue Growth

- Total revenue: **$12.5M** (+18% YoY)
- Recurring revenue: $8.2M
- New customers: 142

> [!notes]
> Emphasize the growth trend. Compare with Q3 board deck.

---

# Key Metrics

| Metric | Q3 | Q4 | Change |
|--------|----|----|--------|
| NPS | 62 | 71 | +9 |
| CSAT | 4.2 | 4.5 | +0.3 |
```

## Guidelines

- **Tell a story.** Slides should have a narrative flow, not just a bullet dump.
- **One idea per slide.** Two topics = two slides.
- **Less is more.** Aim for 4-6 bullet points per slide, each under 10 words. Move detail to speaker notes.
- **Speaker notes are powerful.** Use `> [!notes]` callouts for talking points, context, and data sources.
- **Don't just reorganize — synthesize.** A 1-hour meeting transcript should become 8-12 slides, not 40.
- **Title slide matters.** The first `# Heading` becomes the title slide. Make it compelling.
- **Iterate freely.** Modify the markdown and re-run the script to regenerate.

## References

- `references/TEMPLATES.md` — Template descriptions and when to use each style

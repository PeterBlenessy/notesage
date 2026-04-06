---
name: generate-presentation
description: Generate PowerPoint presentations from documents
user-invocable: true
---

# Generate Presentation

Generate a PowerPoint presentation from a Notesage markdown document using the `generate_pptx` tool. The tool converts structured markdown into professionally styled slides with native PowerPoint elements.

## How It Works

The `generate_pptx` tool takes markdown content and a template name, then produces a `.pptx` file. The markdown structure determines how content is split into slides:

- **H1 headings** create new slides with the heading as the slide title
- **H2 headings** appear as the subtitle on the same slide
- **H3-H6 headings** render as bold body text within the current slide
- **`---` horizontal rules** force explicit slide breaks
- Content before the first heading becomes the title slide subtitle
- The first slide is always a title slide with the document title and date

## Workflow

1. **Ask for the template preference** if the user hasn't specified one. Describe the three built-in templates briefly:
   - **Simple** — clean and minimal, no slide numbers
   - **Business** — professional with header line and slide numbers
   - **Report** — formal with dark title styling and slide numbers

   See `references/TEMPLATES.md` for detailed template descriptions and guidance on choosing one.

2. **Prepare the markdown content.** If the document isn't already structured for slides, restructure it:
   - Add H1 headings to define slide boundaries
   - Break long sections into multiple slides
   - Convert prose paragraphs into bullet points
   - Move detailed content to speaker notes using `> [!notes]` callouts

3. **Check content density.** Each slide should have:
   - Maximum **8 bullet points** (fewer is better — aim for 4-6)
   - Maximum **300 words** of body text
   - Slides exceeding these limits are automatically split into continuation slides with a "(cont.)" suffix, but it's better to split them intentionally

4. **Call `generate_pptx`** with the template name. The tool reads the currently active document automatically (or you can pass `markdown` content directly):
   ```json
   { "template": "business" }
   ```
   Or with explicit content:
   ```json
   { "template": "business", "markdown": "# Slide 1\n\nContent..." }
   ```
   The title is extracted automatically from the first H1 heading. The output `.pptx` file is saved next to the source document (or specify `output_path`).

5. **Report the result.** Tell the user where the file was saved.

## Content Mapping

| Markdown Element | PowerPoint Result |
|------------------|-------------------|
| H1 heading | New slide with title |
| H2 heading | Subtitle on same slide |
| H3-H6 heading | Bold body text |
| Bullet list | Bullet points with nesting |
| Numbered list | Numbered points |
| Task list | Checkbox symbols |
| `---` horizontal rule | Explicit slide break |
| GFM table | Native PowerPoint table |
| Code block | Monospace text (14pt) |
| Image | Embedded image |
| Excalidraw drawing | Embedded SVG |
| Inline chart | Native PowerPoint chart |
| `> [!notes]` callout | Speaker notes (not on slide) |
| Other callouts (note, tip, warning) | Styled text with label prefix |
| `> [!link](url)` | Text with URL |

## Tips

- **Structure content for scanning.** Presentation slides are not documents — the audience reads them in seconds. Use short phrases, not full sentences. Put details in speaker notes.
- **Use speaker notes generously.** Any content that the presenter should say aloud but shouldn't be on the slide belongs in a `> [!notes]` callout block directly after the relevant content.
- **One idea per slide.** If a slide covers two distinct topics, split it with `---` or a new H1 heading.
- **Tables work well** for comparison slides. Keep tables to 4-5 rows and 3-4 columns for readability on screen.
- **Code blocks are monospace** but not syntax-highlighted in PowerPoint. Keep code snippets short (5-10 lines maximum).
- **Images and drawings are embedded** directly into the presentation. Make sure image files exist at the referenced paths before generating.
- **Don't overcrowd.** A 10-slide deck with clear points beats a 30-slide deck that nobody reads. Aim for 1-2 minutes of speaking time per slide.

## Troubleshooting

- **Slides look empty:** Check that the markdown has H1 headings to create slide boundaries. Content without any headings all lands on the title slide.
- **Too many continuation slides:** Break long sections manually with H1 headings or `---` rules. The auto-split at 8 bullets / 300 words is a safety net, not a layout strategy.
- **Images missing from slides:** Images must be accessible at the file path referenced in the markdown. Relative paths are resolved from the project root.
- **Speaker notes not appearing:** Ensure the `> [!notes]` callout syntax is correct — it must use the exact `[!notes]` label (case-insensitive). Other callout types (note, tip, warning) render as visible slide content.

## References

- `references/TEMPLATES.md` — Detailed description of each built-in template with guidance on choosing one

---
name: generate-presentation
description: Generate PowerPoint presentations from documents
user-invocable: true
---

# Generate Presentation

Create a presentation-ready markdown document from any source material — structured notes, meeting transcripts, research, reports, or raw ideas. Your job is to analyze the content, extract the key points, and produce a well-structured slide deck as a markdown file.

## Your Task

1. **Read the source material.** This could be one file, multiple files, or an entire folder. The input may have no structure at all (e.g., a meeting transcript), or it may be a detailed report. Don't assume headings exist.

2. **Analyze and distill.** Identify the narrative arc, key messages, supporting data, and conclusions. Decide what belongs on slides vs. what belongs in speaker notes vs. what should be cut entirely.

3. **Write a presentation markdown file.** Create a new file (e.g., `presentation.md` or a name the user suggests) with your slides. Use your judgment on structure, flow, and content density. A good presentation tells a story — it's not a copy-paste of the source material.

4. **Ask about template preference.** Built-in options:
   - **Simple** — clean and minimal, no slide numbers
   - **Business** — professional with header line and slide numbers
   - **Report** — formal with dark title styling and slide numbers

   Also check for **custom branded templates** in:
   - `~/.notesage/pptx-templates/` (global)
   - `<project>/.notesage/pptx-templates/` (project-specific)

   List any custom templates you find as options.

5. **Tell the user to export:** "Your presentation is ready. Export with **Cmd+Shift+E**, select **PowerPoint**, and choose the **{template}** template."

## Slide Format Reference

When writing the markdown, these rules control how Notesage converts it to slides:

| Markdown | Slide Result |
|----------|-------------|
| `# Heading` | New slide — heading becomes the slide title |
| `## Subheading` | Subtitle on the same slide |
| `### Lower headings` | Bold body text |
| `---` | Force a new slide (even without a heading) |
| Bullet list | Bullet points |
| Numbered list | Numbered points |
| GFM table | Native PowerPoint table |
| Code block | Monospace text |
| Image / drawing | Embedded visual |
| `> [!notes]` callout | Speaker notes (not visible on the slide) |

## Guidelines

- **Tell a story.** Slides should have a narrative flow, not just be a bullet dump. Think: what does the audience need to understand, in what order?
- **One idea per slide.** If you're covering two topics, make two slides.
- **Less is more.** Aim for 4-6 bullet points per slide, each under 10 words. Move detail to speaker notes.
- **Speaker notes are powerful.** Use `> [!notes]` callouts for talking points, context, data sources, and things the presenter should say but the audience shouldn't read.
- **Don't just reorganize — synthesize.** A transcript of a 1-hour meeting should become 8-12 slides, not 40. Extract insights, don't transcribe.
- **Visuals over text.** If the source has data, consider suggesting charts or diagrams instead of text-heavy slides.
- **Title slide matters.** The first `# Heading` becomes the title slide. Make it compelling — not just the filename.

## References

- `references/TEMPLATES.md` — Template descriptions and when to use each

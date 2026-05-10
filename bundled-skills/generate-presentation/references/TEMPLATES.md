# Presentation Templates

Three built-in styles are available via `--style`. Users can also provide custom branded templates via `--template`.

---

## Simple

**Style:** Clean and minimal. No visual clutter.

| Property | Value |
|----------|-------|
| Title font | Calibri, 44pt |
| Body font | Calibri, 20pt |
| Background | White (`FFFFFF`) |
| Text color | Dark grey (`333333`) |
| Slide numbers | No |
| Header/footer | No |

**Best for:**
- Informal presentations and drafts
- Internal team updates
- Brainstorming sessions
- Image-heavy slides (no competing chrome)

**Flag:** `--style simple` (default)

---

## Business

**Style:** Professional with subtle visual structure.

| Property | Value |
|----------|-------|
| Title font | Calibri, 36pt |
| Body font | Calibri, 20pt |
| Background | Light grey (`F2F2F2`) |
| Title slide | Dark accent background (`2D2D2D`), white text |
| Accent bar | Dark horizontal line below title area |
| Slide numbers | Yes (bottom right) |

**Best for:**
- Client presentations
- Corporate meetings
- Project status updates
- Quarterly reviews

**Flag:** `--style business`

---

## Report

**Style:** Formal with strong title presence.

| Property | Value |
|----------|-------|
| Title font | Cambria, 36pt |
| Body font | Calibri, 20pt |
| Title slide | Dark background (`1A1A1A`), white text |
| Content slides | White background, dark text |
| Accent | Medium dark (`404040`) |
| Slide numbers | Yes (bottom right) |
| Footer | Document title (bottom left) |

**Best for:**
- Executive summaries
- Board presentations
- Formal reports and findings
- Academic presentations

**Flag:** `--style report`

---

## Choosing a Style

| Situation | Recommended |
|-----------|-------------|
| "I just need slides quickly" | Simple |
| "This is for stakeholders" | Business |
| "This is a formal deliverable" | Report |
| "Presenting to my team" | Simple or Business |
| "Heavy on images" | Simple |
| "Heavy on data and text" | Report |

When in doubt, ask about the audience and formality level.

---

## Custom Templates

Users can provide their own branded `.pptx` or `.potx` template via the `--template` flag. The script extracts the template's:

- **Color scheme** — 12 OOXML theme colors (dk1, dk2, lt1, lt2, accent1-6)
- **Fonts** — heading and body typefaces
- **Background** — slide master background fill

These are applied to all generated slides, preserving the brand's visual identity.

**Template locations:**
- **Global:** `~/Notesage/templates/`
- **Project:** `<project>/templates/`

Templates can be added by placing `.pptx`/`.potx` files in these directories.

When listing options for the user, check both directories and offer custom templates first if they exist.

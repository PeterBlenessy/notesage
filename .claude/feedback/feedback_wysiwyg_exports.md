---
name: WYSIWYG exports — no export-time templates
description: Export styling must come from the editor, not template pickers. Templates are for document creation, not export.
type: feedback
aw_applies: yes
aw_applies_to: [aw-tdd]
---

Export-time template selection (Clean/Academic/Report) is the wrong pattern for a WYSIWYG editor. What users see in the editor is what they should get in exports (PDF, DOCX, PPTX, HTML).

**Why:** Notesage is WYSIWYG — users already configure typography in the editor. Asking them to pick a template at export time contradicts the visual editing promise and adds unnecessary cognitive overhead. Templates make sense for text-only editors, not WYSIWYG.

**How to apply:**
- Typography presets are per-block-type (H1-H6, paragraph, code, blockquote) with Google Docs-style "Update to match" / "Reset"
- All export pipelines read block-type presets from the editor and apply them directly
- Templates are a document creation concept (pre-populating presets), not an export concept
- Headers/footers are editable directly in the paged view, not configured at export time
- PRD: `docs/prds/2026-03-30-wysiwyg-typography.md`

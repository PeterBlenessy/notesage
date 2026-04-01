# Release v0.28.0

**Date:** 2026-04-01
**Previous version:** 0.27.0

## Changes

### Features
- Code file editing — editable CodeMirror 6 editor for 22+ programming languages with lazy-loaded language packages, line numbers, code folding, bracket matching, full editing (save, dirty indicator, auto-save), and CodeMirror search
- Muted chromatic syntax highlighting for code files and WYSIWYG code blocks — keywords purple, strings green, comments olive italic, numbers orange, functions blue, types teal, HTML tags red — via `--ns-code-*` CSS variables with light/dark mode support
- Language registry (`codemirror-languages.ts`) mapping file extensions to CodeMirror languages with `isCodeFile()`, `getLanguageName()`, and `loadLanguage()` utilities
- Link URL tooltip on hover in editor
- WYSIWYG typography — per-block-type presets, page breaks, export alignment
- Page constructs — editable headers/footers with variable support and export integration
- Three-decoration architecture for page headers/footers

### Fixes
- Fix header/footer zone alignment, stale content, and chevron dropdown
- Fix FrontmatterBlock displaying [object Object] for nested values
- Fix closeHfEditor closing editor immediately after opening
- Fix header/footer zones — fill full margin area, portal editor into zone
- Block clipboard and drag events from reaching ProseMirror in HF editor
- Restore pointer-events:none on margin containers to prevent stray cursor

### Improvements
- Upgrade transitive dependencies to fix security vulnerabilities
- Design system updated to explicitly include syntax highlighting in the editor content color exception
- PlainTextViewer now routes code files to CodeEditor, plain text files to `<pre>` fallback

### Documentation
- Updated architecture, design system, editor, editor-architecture, document-formats, and product-description docs
- Code file highlighting PRD and task breakdown marked complete

## Files Changed
- 74 files changed across 20 commits

# Release v0.39.1

**Date:** 2026-04-26
**Previous version:** 0.39.0

Security patch. No behavioural changes.

## Changes

### Fixes

- DOCX viewer's "Convert to Markdown" path now uses `@xmldom/xmldom` 0.9.10+ — closes four advisories (XML injection through DocumentType / processing-instruction / comment serialization, plus uncontrolled recursion) flagged when opening hostile DOCX content
- Inline Excalidraw drawings bumped to `@excalidraw/excalidraw` 0.18.1, closing the Mermaid sequence-diagram XSS via KaTeX label rendering

## Under the hood

Bundles housekeeping bumps: `uuid >=14`, `postcss >=8.5.10`, `fast-xml-parser >=5.5.10` (none reachable in shipped paths but kept the audit clean), and `openssl` 0.10.78 / `openssl-sys` 0.9.114 on the Rust side. macOS doesn't link the openssl callsites — these are for the Linux target.

Verification: `pnpm audit` 0 vulnerabilities, `cargo audit` 0 vulnerabilities, full test suite green.

## Files Changed

3 files changed across 2 commits — `package.json` overrides + `pnpm-lock.yaml` + `src-tauri/Cargo.lock`. No source code changes.

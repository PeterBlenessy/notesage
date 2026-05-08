# Release v0.39.1

**Date:** 2026-04-26
**Previous version:** 0.39.0

Security patch. Closes five third-party advisories that affect file-content rendering. No behavioural changes — just safer.

## Changes

### Fixes

- **DOCX viewer is safer when reading content from untrusted sources.** The XML library used to convert .docx files to markdown was patched to close four advisories around how XML metadata gets serialised. If you open or convert a malicious .docx, the path is no longer exploitable.
- **Inline Excalidraw drawings are safer.** The drawing component was patched to close a cross-site-scripting issue in how math labels render inside Mermaid sequence diagrams.

## Under the hood

Bundles housekeeping bumps: `uuid >=14`, `postcss >=8.5.10`, `fast-xml-parser >=5.5.10` (none reachable in shipped paths but kept the audit clean), and `openssl` 0.10.78 / `openssl-sys` 0.9.114 on the Rust side. macOS doesn't link the openssl callsites — these are for the Linux target.

Specific advisories closed:

- `@xmldom/xmldom` 0.9.10+ — XML injection via `DocumentType` / processing-instruction / comment serialization, plus an uncontrolled-recursion DoS. Reached via the DOCX viewer's "Convert to Markdown" code path.
- `@excalidraw/excalidraw` 0.18.1 — Mermaid sequence-diagram XSS via KaTeX label rendering.

Verification: `pnpm audit` 0 vulnerabilities, `cargo audit` 0 vulnerabilities, full test suite green.

## Files Changed

3 files changed across 2 commits — `package.json` overrides + `pnpm-lock.yaml` + `src-tauri/Cargo.lock`. No source code changes.

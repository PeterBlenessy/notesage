---
name: Reduce Rust weight — prefer browser-side solutions
description: Project has too much Rust complexity. Prefer browser/frontend solutions over Rust backends when the browser can do the job.
type: feedback
originSessionId: ba64b0dd-a8ca-4f9f-93a2-5a61c4e0c5b1
aw_applies: yes
aw_applies_to: [aw-tdd]
---
The project has accumulated too much Rust-side complexity. When the browser already has an API or capability (e.g., Excalidraw's exportToSvg, WKWebView's createPDF, CSS @media print), use that instead of reimplementing in Rust.

**Why:** The Typst PDF export required bridging two rendering worlds (browser CSS ↔ Typst markup), causing font mismatches, color gaps, SVG text issues, and constant workarounds. Using the browser's own rendering avoids all of this.

**How to apply:** Before adding Rust-side processing for any rendering/export feature, ask: "Can the browser/WebView do this natively?" If yes, use the browser path. Reserve Rust for I/O, security boundaries, and things the browser genuinely can't do.

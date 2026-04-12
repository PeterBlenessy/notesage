/**
 * Generate print-specific CSS for WebKit PDF export.
 *
 * Controls page layout via `@page` rules and adds break/orphan
 * handling so content renders cleanly when WKWebView prints to PDF.
 *
 * NOTE: Safari/WKWebView has limited CSS Paged Media support.
 * `@page { @bottom-center }` with `content: counter(page)` may not
 * render page numbers — this is a known WebKit limitation. The basic
 * `@page { size; margin }` rules do work reliably.
 */

interface PrintCSSOptions {
  pageSize: string; // "a4" | "letter" | "a5"
  includePageNumbers: boolean;
  margin?: string; // default "1in"
}

const PAGE_SIZE_MAP: Record<string, string> = {
  a4: "A4",
  letter: "letter",
  a5: "A5",
};

export function generatePrintCSS(options: PrintCSSOptions): string {
  const size = PAGE_SIZE_MAP[options.pageSize] || "A4";
  const margin = options.margin || "1in";

  // WebKit may ignore @bottom-center — included as best-effort
  const pageNumberRule = options.includePageNumbers
    ? `
    @bottom-center {
      content: counter(page);
      font-size: 9pt;
      color: #888;
    }`
    : "";

  return `
@media print {
  @page {
    size: ${size};
    margin: ${margin};${pageNumberRule}
  }

  /* Prevent breaking inside content blocks */
  pre, table, .chart-block, .drawing-block, .mermaid-block,
  .mermaid-svg-container, blockquote, .callout, figure {
    break-inside: avoid;
  }

  /* Don't strand headings at page bottom */
  h1, h2, h3, h4, h5, h6 {
    page-break-after: avoid;
    break-after: avoid;
  }

  /* Orphan/widow control */
  p {
    orphans: 3;
    widows: 3;
  }

  /* Hide interactive/editor-only elements */
  .toc-header { display: none; }
}`;
}

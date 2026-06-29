import type { Components } from "react-markdown";

/**
 * Tailwind-styled element map for the mobile reader's `react-markdown` render.
 * Keeps a clean reading column without pulling in a typography plugin. Covers
 * headings, lists, tables, code, blockquotes, links, images, and rules.
 *
 * v1 limitation: Notesage-specific blocks (callouts `> [!type]`, charts,
 * drawings, sparklines) are NOT specially rendered here — callouts fall back to
 * plain blockquotes and embedded code blocks render as code. Full-fidelity
 * rendering is a follow-up (would reuse the desktop comrak `render_html` path).
 */
export const markdownComponents: Components = {
  h1: ({ children }) => <h1 className="mb-3 mt-6 text-2xl font-semibold text-foreground first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-3 mt-6 text-xl font-semibold text-foreground first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-2 mt-5 text-lg font-semibold text-foreground first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="mb-2 mt-4 text-base font-semibold text-foreground first:mt-0">{children}</h4>,
  h5: ({ children }) => <h5 className="mb-2 mt-4 text-sm font-semibold text-foreground first:mt-0">{children}</h5>,
  h6: ({ children }) => <h6 className="mb-2 mt-4 text-sm font-semibold text-muted-foreground first:mt-0">{children}</h6>,
  p: ({ children }) => <p className="my-3 text-[15px] leading-7 text-foreground">{children}</p>,
  a: ({ href, children }) => (
    <a href={href} className="text-[var(--color-accent-primary)] underline underline-offset-2" target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="my-3 list-disc space-y-1 pl-6 text-[15px] leading-7 text-foreground">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 list-decimal space-y-1 pl-6 text-[15px] leading-7 text-foreground">{children}</ol>,
  li: ({ children }) => <li className="marker:text-muted-foreground">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-[3px] border-border pl-4 text-[15px] italic text-muted-foreground">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-6 border-border" />,
  code: ({ className, children }) => {
    const isBlock = (className ?? "").includes("language-");
    if (isBlock) {
      return <code className={className}>{children}</code>;
    }
    return (
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">{children}</code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-4 overflow-x-auto rounded-lg bg-muted p-4 font-mono text-sm leading-relaxed text-foreground">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border bg-muted px-3 py-2 text-left font-medium text-foreground">{children}</th>
  ),
  td: ({ children }) => <td className="border border-border px-3 py-2 text-foreground">{children}</td>,
  img: ({ src, alt }) => (
    <img src={typeof src === "string" ? src : undefined} alt={alt ?? ""} className="my-4 max-w-full rounded-md" />
  ),
};

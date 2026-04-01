import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

/**
 * Notesage CodeMirror theme — neutral greyscale, no chromatic accent.
 * Reads CSS variables from globals.css so it follows light/dark mode.
 */
export const notesageTheme = EditorView.theme(
  {
    "&": {
      fontSize: "14px",
      fontFamily: '"JetBrains Mono", "SF Mono", "Fira Code", ui-monospace, monospace',
      backgroundColor: "var(--color-background)",
      color: "var(--color-foreground)",
      height: "100%",
    },
    ".cm-scroller": {
      overflow: "auto",
    },
    ".cm-content": {
      caretColor: "var(--color-foreground)",
      lineHeight: "1.7",
      padding: "16px 0 0 0",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--color-foreground)",
      borderLeftWidth: "1.5px",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      {
        backgroundColor: "oklch(88% 0 0)",
      },
    // Highlight other occurrences of selected text
    ".cm-selectionMatch": {
      backgroundColor: "oklch(92% 0 0)",
      borderRadius: "2px",
    },
    ".cm-panels": {
      backgroundColor: "var(--color-muted)",
      color: "var(--color-foreground)",
    },
    ".cm-panels.cm-panels-top": {
      borderBottom: "1px solid var(--color-border)",
    },
    ".cm-panels.cm-panels-bottom": {
      borderTop: "1px solid var(--color-border)",
    },
    // Search panel
    ".cm-search label": {
      fontSize: "13px",
    },
    ".cm-textfield": {
      backgroundColor: "var(--color-background)",
      border: "1px solid var(--color-border)",
      borderRadius: "4px",
      fontSize: "13px",
      padding: "2px 6px",
    },
    ".cm-button": {
      backgroundImage: "none",
      backgroundColor: "var(--color-muted)",
      border: "1px solid var(--color-border)",
      borderRadius: "4px",
      fontSize: "13px",
      padding: "2px 8px",
    },
    // Search match highlights
    ".cm-searchMatch": {
      backgroundColor: "oklch(85% 0 0)",
      borderRadius: "2px",
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "oklch(75% 0 0)",
    },
    // Gutters — subtle, de-emphasized meta info
    ".cm-gutters": {
      backgroundColor: "var(--color-muted)",
      color: "oklch(72% 0 0)",
      border: "none",
      borderRight: "1px solid var(--color-border)",
      paddingRight: "8px",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      fontSize: "11px",
      minWidth: "3ch",
      padding: "0 4px 0 0",
    },
    // Active line
    ".cm-activeLine": {
      backgroundColor: "var(--color-accent)",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "transparent",
      color: "oklch(45% 0 0)",
    },
    // Fold gutter
    ".cm-foldGutter .cm-gutterElement": {
      fontSize: "12px",
      color: "var(--color-muted-foreground)",
      transition: "color 150ms ease",
    },
    ".cm-foldGutter .cm-gutterElement:hover": {
      color: "var(--color-foreground)",
    },
    // Matching brackets
    "&.cm-focused .cm-matchingBracket": {
      backgroundColor: "var(--color-accent)",
      outline: "1px solid var(--color-border)",
    },
    // Tooltip
    ".cm-tooltip": {
      backgroundColor: "var(--color-popover)",
      color: "var(--color-popover-foreground)",
      border: "1px solid var(--color-border)",
      borderRadius: "6px",
      boxShadow: "0 2px 8px oklch(0% 0 0 / 0.08)",
    },
    ".cm-tooltip-autocomplete ul li[aria-selected]": {
      backgroundColor: "var(--color-accent)",
      color: "var(--color-accent-foreground)",
    },
    // Scrollbar
    "&::-webkit-scrollbar": {
      width: "6px",
      height: "6px",
    },
    "&::-webkit-scrollbar-thumb": {
      backgroundColor: "var(--color-border)",
      borderRadius: "3px",
    },
  },
);

/**
 * Monochrome highlight style for markdown source editing.
 * Uses weight, style, and opacity to differentiate syntax — no hue.
 */
export const notesageHighlightStyle = syntaxHighlighting(
  HighlightStyle.define([
    // Headings — bold
    { tag: tags.heading1, fontWeight: "700", fontSize: "1.25em" },
    { tag: tags.heading2, fontWeight: "700", fontSize: "1.15em" },
    { tag: tags.heading3, fontWeight: "600", fontSize: "1.05em" },
    { tag: [tags.heading4, tags.heading5, tags.heading6], fontWeight: "600" },
    // Emphasis
    { tag: tags.emphasis, fontStyle: "italic" },
    { tag: tags.strong, fontWeight: "700" },
    { tag: tags.strikethrough, textDecoration: "line-through", color: "var(--color-muted-foreground)" },
    // Code
    { tag: tags.monospace, color: "var(--color-foreground)", backgroundColor: "var(--color-muted)", borderRadius: "3px", padding: "1px 4px" },
    // Links
    { tag: tags.link, textDecoration: "underline", textUnderlineOffset: "2px" },
    { tag: tags.url, color: "var(--color-muted-foreground)", textDecoration: "underline", textUnderlineOffset: "2px" },
    // Markdown syntax characters (# * - > ``` etc.)
    { tag: tags.processingInstruction, color: "var(--color-muted-foreground)" },
    { tag: tags.meta, color: "var(--color-muted-foreground)" },
    // Quotes
    { tag: tags.quote, color: "var(--color-muted-foreground)", fontStyle: "italic" },
    // List markers
    { tag: tags.list, color: "var(--color-muted-foreground)" },
    // Comments / HTML
    { tag: tags.comment, color: "var(--color-muted-foreground)" },
    // Content inside code blocks
    { tag: tags.contentSeparator, color: "var(--color-muted-foreground)" },
    // Catch-all for any remaining syntax punctuation
    { tag: tags.punctuation, color: "var(--color-muted-foreground)" },
  ]),
);

/**
 * Syntax highlight style for code files (non-markdown).
 * Uses a muted chromatic palette — code content is a semantic exception
 * to the UI-chrome greyscale rule (same as diff colors, highlights, etc.).
 *
 * Colors use CSS custom properties (--ns-code-*) defined in globals.css
 * so light/dark mode switches automatically.
 */
export const notesageCodeHighlightStyle = syntaxHighlighting(
  HighlightStyle.define([
    // Keywords — purple
    { tag: [tags.keyword, tags.operatorKeyword, tags.modifier, tags.controlKeyword], color: "var(--ns-code-keyword)", fontWeight: "600" },
    // Strings — green
    { tag: [tags.string, tags.special(tags.string), tags.attributeValue], color: "var(--ns-code-string)" },
    // Comments — muted olive, italic
    { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "var(--ns-code-comment)", fontStyle: "italic" },
    // Numbers, booleans, null — orange
    { tag: [tags.number, tags.integer, tags.float, tags.bool, tags.null], color: "var(--ns-code-number)" },
    // Functions, definitions — blue
    { tag: [tags.function(tags.variableName), tags.function(tags.definition(tags.variableName)), tags.definition(tags.function(tags.variableName))], color: "var(--ns-code-function)" },
    // Types, class names — teal
    { tag: [tags.typeName, tags.className, tags.namespace], color: "var(--ns-code-type)" },
    // Operators, punctuation — subtle
    { tag: [tags.operator, tags.punctuation, tags.separator], color: "var(--ns-code-operator)" },
    // Property names
    { tag: [tags.propertyName, tags.attributeName], color: "inherit" },
    // Meta, preprocessor
    { tag: [tags.meta, tags.processingInstruction], color: "var(--ns-code-operator)" },
    // Tags (HTML/XML) — red
    { tag: tags.tagName, color: "var(--ns-code-tag)" },
  ]),
);

/** Dark mode overrides for selection, search matches, gutters, etc. */
const darkOverrides = EditorView.theme(
  {
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      {
        backgroundColor: "oklch(38% 0 0)",
      },
    ".cm-selectionMatch": {
      backgroundColor: "oklch(32% 0 0)",
    },
    ".cm-searchMatch": {
      backgroundColor: "oklch(35% 0 0)",
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "oklch(45% 0 0)",
    },
    ".cm-gutters": {
      color: "oklch(45% 0 0)",
    },
    ".cm-activeLineGutter": {
      color: "oklch(65% 0 0)",
    },
  },
  { dark: true },
);

/**
 * Combined extensions for Notesage CodeMirror styling (markdown source mode).
 */
export const notesageExtensions = [
  notesageTheme,
  notesageHighlightStyle,
  darkOverrides,
];

/**
 * Combined extensions for Notesage CodeMirror code file styling.
 * Uses code-specific highlight styles instead of markdown ones.
 */
export const notesageCodeExtensions = [
  notesageTheme,
  notesageCodeHighlightStyle,
  darkOverrides,
];

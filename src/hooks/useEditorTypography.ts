import { useEffect, useMemo } from "react";
import { useEditorStylesStore, fontFamilyCSS } from "@/stores/editor-styles-store";
import { parseDocumentStyle, documentStyleToPresets, type Frontmatter } from "@/lib/frontmatter";
import { mergePresets, type BlockTypeStyle } from "@/lib/typography-presets";

interface Tab {
  id: string;
  fileType: string;
  frontmatter: Frontmatter | null;
}

/**
 * Typography controller for the editor content surface.
 *
 * Owns the editor-styles-store reads and:
 *  1. Computes the per-block-type CSS custom properties applied to the editor
 *     container (paragraph / headings / code / blockquote font + spacing).
 *  2. Applies per-document typography presets from the frontmatter `style:`
 *     block on tab switch (or clears them for non-markdown / no-style tabs).
 *
 * Extracted from Editor.tsx — encapsulates its own store subscriptions.
 */
export function useEditorTypography(activeTab: Tab | undefined): Record<`--${string}`, string> {
  const editorStylesPresets = useEditorStylesStore((s) => s.presets);
  const editorStylesDocPresets = useEditorStylesStore((s) => s.documentPresets);
  const editorStylesSetDocPresets = useEditorStylesStore((s) => s.setDocumentPresets);

  // Compute per-block-type CSS variables from typography presets
  const typographyCssVars = useMemo(() => {
    const p = editorStylesDocPresets ?? editorStylesPresets;
    const fc = fontFamilyCSS;
    return {
      // Legacy variables (backwards compat — other CSS rules reference these)
      '--editor-font-family': fc(p.paragraph.fontFamily),
      '--editor-font-size': `${p.paragraph.fontSize}px`,
      '--editor-line-height': String(p.paragraph.lineHeight),
      '--editor-paragraph-spacing': `${p.paragraph.spacingAfter}em`,

      // Paragraph
      '--ns-paragraph-font-family': fc(p.paragraph.fontFamily),
      '--ns-paragraph-font-size': `${p.paragraph.fontSize}px`,
      '--ns-paragraph-font-weight': String(p.paragraph.fontWeight),
      '--ns-paragraph-line-height': String(p.paragraph.lineHeight),
      '--ns-paragraph-spacing-after': `${p.paragraph.spacingAfter}em`,

      // Heading 1
      '--ns-h1-font-family': fc(p.heading1.fontFamily),
      '--ns-h1-font-size': `${p.heading1.fontSize}px`,
      '--ns-h1-font-weight': String(p.heading1.fontWeight),
      '--ns-h1-line-height': String(p.heading1.lineHeight),
      '--ns-h1-spacing-before': `${p.heading1.spacingBefore}em`,
      '--ns-h1-spacing-after': `${p.heading1.spacingAfter}em`,

      // Heading 2
      '--ns-h2-font-family': fc(p.heading2.fontFamily),
      '--ns-h2-font-size': `${p.heading2.fontSize}px`,
      '--ns-h2-font-weight': String(p.heading2.fontWeight),
      '--ns-h2-line-height': String(p.heading2.lineHeight),
      '--ns-h2-spacing-before': `${p.heading2.spacingBefore}em`,
      '--ns-h2-spacing-after': `${p.heading2.spacingAfter}em`,

      // Heading 3
      '--ns-h3-font-family': fc(p.heading3.fontFamily),
      '--ns-h3-font-size': `${p.heading3.fontSize}px`,
      '--ns-h3-font-weight': String(p.heading3.fontWeight),
      '--ns-h3-line-height': String(p.heading3.lineHeight),
      '--ns-h3-spacing-before': `${p.heading3.spacingBefore}em`,
      '--ns-h3-spacing-after': `${p.heading3.spacingAfter}em`,

      // Heading 4
      '--ns-h4-font-family': fc(p.heading4.fontFamily),
      '--ns-h4-font-size': `${p.heading4.fontSize}px`,
      '--ns-h4-font-weight': String(p.heading4.fontWeight),
      '--ns-h4-line-height': String(p.heading4.lineHeight),
      '--ns-h4-spacing-before': `${p.heading4.spacingBefore}em`,
      '--ns-h4-spacing-after': `${p.heading4.spacingAfter}em`,

      // Heading 5
      '--ns-h5-font-family': fc(p.heading5.fontFamily),
      '--ns-h5-font-size': `${p.heading5.fontSize}px`,
      '--ns-h5-font-weight': String(p.heading5.fontWeight),
      '--ns-h5-line-height': String(p.heading5.lineHeight),
      '--ns-h5-spacing-before': `${p.heading5.spacingBefore}em`,
      '--ns-h5-spacing-after': `${p.heading5.spacingAfter}em`,

      // Heading 6
      '--ns-h6-font-family': fc(p.heading6.fontFamily),
      '--ns-h6-font-size': `${p.heading6.fontSize}px`,
      '--ns-h6-font-weight': String(p.heading6.fontWeight),
      '--ns-h6-line-height': String(p.heading6.lineHeight),
      '--ns-h6-spacing-before': `${p.heading6.spacingBefore}em`,
      '--ns-h6-spacing-after': `${p.heading6.spacingAfter}em`,

      // Code block
      '--ns-code-font-family': fc(p.codeBlock.fontFamily),
      '--ns-code-font-size': `${p.codeBlock.fontSize}px`,

      // Blockquote
      '--ns-blockquote-font-family': fc(p.blockquote.fontFamily),
      '--ns-blockquote-font-size': `${p.blockquote.fontSize}px`,
      '--ns-blockquote-font-weight': String(p.blockquote.fontWeight),
    } as Record<`--${string}`, string>;
  }, [editorStylesPresets, editorStylesDocPresets]);

  // Apply per-document typography presets from frontmatter `style:` on tab switch
  useEffect(() => {
    if (!activeTab || activeTab.fileType !== 'markdown') {
      editorStylesSetDocPresets(null);
      return;
    }
    const docStyle = parseDocumentStyle(activeTab.frontmatter);
    if (!docStyle) {
      editorStylesSetDocPresets(null);
      return;
    }
    const partial = documentStyleToPresets(docStyle);
    if (!partial) {
      editorStylesSetDocPresets(null);
      return;
    }
    const merged = mergePresets(partial as Record<string, Partial<BlockTypeStyle>>, editorStylesPresets);
    editorStylesSetDocPresets(merged);
  }, [activeTab?.id, activeTab?.frontmatter]);

  return typographyCssVars;
}

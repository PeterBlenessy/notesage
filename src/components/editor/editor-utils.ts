import type { Editor as TiptapEditor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import type { MutableRefObject } from "react";
import type { ContentWidth } from "@/stores/settings-store";

// 1 CSS px = 1/96 inch, 1 inch = 2.54 cm
export const PX_PER_CM = 96 / 2.54;

// Full page widths at 96 CSS DPI (1 CSS px = 1/96 inch)
// ProseMirror padding acts as page margins
export const CONTENT_WIDTHS: Record<ContentWidth, number | undefined> = {
  full: undefined,
  auto: 720,
  a4: 794,
  a5: 559,
  letter: 816,
};

// Full page heights at 96 CSS DPI (1 CSS px = 1/96 inch)
export const CONTENT_HEIGHTS: Record<string, number> = {
  a4: 1123,
  a5: 794,
  letter: 1056,
};

/**
 * Strip common markdown inline formatting markers from text.
 * Converts raw markdown like `Buy **groceries** and \`code\`` into
 * plain text like `Buy groceries and code` to match ProseMirror's textContent.
 */
export function stripMarkdownInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')   // **bold**
    .replace(/__(.+?)__/g, '$1')         // __bold__
    .replace(/\*(.+?)\*/g, '$1')         // *italic*
    .replace(/_(.+?)_/g, '$1')           // _italic_
    .replace(/~~(.+?)~~/g, '$1')         // ~~strikethrough~~
    .replace(/`(.+?)`/g, '$1')           // `code`
    .replace(/\[(.+?)\]\(.+?\)/g, '$1'); // [link](url)
}

/**
 * Find the ProseMirror position of `searchText` in the document.
 *
 * Builds the full text and position map in a SINGLE PASS through the document
 * tree, so they're always in sync. This correctly handles non-text leaf nodes
 * (e.g. hardBreak → "\n") that contribute to textContent but aren't text nodes.
 */
export function findTextPositionInDoc(
  doc: PMNode,
  searchText: string,
): number | null {
  let fullText = '';
  const posMap: number[] = []; // posMap[i] = PM position of the i-th character in fullText

  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i++) {
        posMap.push(pos + i);
        fullText += node.text[i];
      }
    } else if (node.isLeaf && !node.isText) {
      // Non-text leaves (hardBreak, image, etc.) may contribute to textContent
      const leafText = node.type.spec.leafText?.(node) ?? '';
      for (let i = 0; i < leafText.length; i++) {
        posMap.push(pos);
        fullText += leafText[i];
      }
    }
  });

  // Parse occurrence index if encoded as "searchText\0N"
  let needle: string;
  let nth = 0;
  const nullIdx = searchText.indexOf('\0');
  if (nullIdx !== -1) {
    needle = searchText.slice(0, nullIdx).toLowerCase();
    nth = parseInt(searchText.slice(nullIdx + 1), 10) || 0;
  } else {
    needle = searchText.toLowerCase();
  }

  const lowerText = fullText.toLowerCase();
  let strippedNeedle: string | null = null;

  // Find the Nth occurrence
  let found = 0;
  let startFrom = 0;
  while (startFrom < lowerText.length) {
    let textOffset = lowerText.indexOf(needle, startFrom);
    // Fallback: try stripped markdown
    if (textOffset === -1 && !strippedNeedle) {
      strippedNeedle = stripMarkdownInline(needle);
      if (strippedNeedle !== needle) {
        textOffset = lowerText.indexOf(strippedNeedle, startFrom);
      }
    }
    if (textOffset === -1) return null;

    if (found === nth) {
      return posMap[textOffset] ?? null;
    }
    found++;
    startFrom = textOffset + 1;
  }

  return null;
}

/**
 * Scroll a ProseMirror position to the vertical center of the scroll container
 * and place the cursor there.
 *
 * Uses the simplest reliable approach:
 * 1. Get the DOM element at the position via view.domAtPos
 * 2. Call scrollIntoView({ block: "center" }) — lets the browser handle the math
 * 3. Set the ProseMirror selection (element is already in view, no auto-scroll)
 */
export function scrollPosToCenter(editor: TiptapEditor, pos: number, _scrollContainer: HTMLElement, programmaticScrollRef?: MutableRefObject<boolean>) {
  // Guard: prevent ResizeObserver and scroll-save from interfering
  if (programmaticScrollRef) programmaticScrollRef.current = true;

  try {
    // 1. Find the DOM element at this position
    const domInfo = editor.view.domAtPos(pos);
    const el: Element | null = domInfo.node instanceof Element
      ? domInfo.node
      : domInfo.node.parentElement;

    // 2. Scroll into view — browser handles all the container math
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "instant" });
    }
  } catch {
    // Position not in DOM
  }

  // 3. Set cursor AFTER scroll — element is visible, browser won't fight us
  try {
    const tr = editor.view.state.tr.setSelection(
      TextSelection.create(editor.view.state.doc, pos)
    );
    editor.view.dispatch(tr);
  } catch {
    // Invalid position
  }

  // Clear guard after scroll settles
  if (programmaticScrollRef) {
    setTimeout(() => { programmaticScrollRef.current = false; }, 500);
  }
}

/**
 * Find text in the ProseMirror document, move the cursor there, and scroll to center it.
 */
export function scrollToTextInEditor(editor: TiptapEditor, searchText: string, scrollContainer?: HTMLElement | null, programmaticScrollRef?: MutableRefObject<boolean>) {
  const pos = findTextPositionInDoc(editor.state.doc, searchText);
  if (pos !== null && scrollContainer) {
    scrollPosToCenter(editor, pos, scrollContainer, programmaticScrollRef);
  }
}

/**
 * Find the ProseMirror position of the Nth occurrence (0-based) of `#tag` in the document.
 * Walks all text nodes and searches for the tag pattern.
 */
export function findNthTagInDoc(doc: { descendants: (fn: (node: { isText: boolean; text?: string }, pos: number) => boolean | void) => void }, tag: string, occurrence: number): number | null {
  const needle = `#${tag}`;
  // Characters that can follow a tag name (i.e., the tag ends here)
  const tagTerminators = new Set([' ', '\t', '\n', ',', '.', ';', ':', '!', '?', ')', ']', '}', '"', "'", '`']);
  let found = 0;
  let result: number | null = null;
  doc.descendants((node, pos) => {
    if (result !== null) return false;
    if (!node.isText || !node.text) return;
    let searchFrom = 0;
    while (searchFrom < node.text.length) {
      const idx = node.text.indexOf(needle, searchFrom);
      if (idx === -1) break;
      // Verify the character after the tag name is a terminator or end-of-text
      const afterIdx = idx + needle.length;
      const isEnd = afterIdx >= node.text.length || tagTerminators.has(node.text[afterIdx]) || !/[a-zA-Z0-9_-]/.test(node.text[afterIdx]);
      if (isEnd) {
        if (found === occurrence) {
          result = pos + idx;
          return false;
        }
        found++;
      }
      searchFrom = idx + 1;
    }
  });
  return result;
}

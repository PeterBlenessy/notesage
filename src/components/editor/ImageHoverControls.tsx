import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { BlockSizeControls } from "@/components/editor/BlockSizeControls";

/**
 * Hover-revealed width + alignment controls for images.
 *
 * Why a SINGLE editor-level component instead of a React NodeView per image:
 * an earlier attempt (commit 408f1894) wrapped each `LocalImage` in a React
 * NodeView with embedded BlockSizeControls. On the user's 494 KB book this
 * pushed `streamingHydrate` from ~3 s → ~12 s because every image paid a
 * React mount cost during chunked `setContent`. This file restores the hover
 * controls without that cost: vanilla DOM event listeners on the editor view
 * detect which `<img>` is hovered, and a single React component renders the
 * BlockSizeControls floating near it. One React tree per editor, not one per
 * image.
 *
 * Mounted in `Editor.tsx` alongside `BubbleMenu` and `TableHeaderMenu`.
 */

const HIDE_GRACE_MS = 150;

interface HoverState {
  pos: number;
  rect: DOMRect;
  blockWidth: number | null;
  align: string | null;
  node: ProseMirrorNode;
}

interface ImageHoverControlsProps {
  editor: Editor;
}

export function ImageHoverControls({ editor }: ImageHoverControlsProps) {
  const [state, setState] = useState<HoverState | null>(null);
  const stateRef = useRef<HoverState | null>(null);
  stateRef.current = state;

  const graceTimerRef = useRef<number | null>(null);

  const cancelGrace = useCallback(() => {
    if (graceTimerRef.current != null) {
      window.clearTimeout(graceTimerRef.current);
      graceTimerRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    cancelGrace();
    graceTimerRef.current = window.setTimeout(() => {
      setState(null);
      graceTimerRef.current = null;
    }, HIDE_GRACE_MS);
  }, [cancelGrace]);

  useEffect(() => {
    const editorDom = editor.view.dom as HTMLElement | undefined;
    if (!editorDom) return;

    const showFor = (img: HTMLElement) => {
      cancelGrace();
      let pos: number | null = null;
      try {
        pos = editor.view.posAtDOM(img, 0);
      } catch {
        return;
      }
      if (pos == null || pos < 0) return;

      const $pos = editor.state.doc.resolve(pos);
      for (let depth = $pos.depth; depth >= 0; depth--) {
        const n = $pos.node(depth);
        if (n.type.name === "image") {
          const nodePos = depth === 0 ? 0 : $pos.before(depth);
          setState({
            pos: nodePos,
            rect: img.getBoundingClientRect(),
            blockWidth: (n.attrs.blockWidth as number | null) ?? null,
            align: (n.attrs.align as string | null) ?? null,
            node: n,
          });
          return;
        }
      }
    };

    const onMouseOver = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      // Find the closest <img> inside the editor surface.
      const img = target.closest("img");
      if (!img || !editorDom.contains(img)) return;
      showFor(img);
    };

    const onMouseOut = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const fromImg = target.closest("img");
      if (!fromImg) return;
      const related = e.relatedTarget;
      if (related instanceof HTMLElement) {
        // Still inside the same image — ignore.
        if (related.closest("img") === fromImg) return;
        // Moving onto the controls overlay — keep open.
        if (related.closest("[data-image-hover-controls]")) return;
      }
      scheduleHide();
    };

    editorDom.addEventListener("mouseover", onMouseOver);
    editorDom.addEventListener("mouseout", onMouseOut);

    return () => {
      editorDom.removeEventListener("mouseover", onMouseOver);
      editorDom.removeEventListener("mouseout", onMouseOut);
      cancelGrace();
    };
  }, [editor, cancelGrace, scheduleHide]);

  // Hide on document change — image positions / sizes go stale immediately.
  useEffect(() => {
    const onDocChange = () => {
      if (stateRef.current) setState(null);
    };
    editor.on("update", onDocChange);
    return () => {
      editor.off("update", onDocChange);
    };
  }, [editor]);

  if (!state) return null;

  const { rect, pos, blockWidth, align, node } = state;

  return (
    <div
      data-image-hover-controls=""
      style={{
        position: "fixed",
        top: Math.max(rect.bottom - 36, 4),
        left: Math.max(rect.right - 220, 4),
        zIndex: 50,
      }}
      // Don't blur the editor / select the image when interacting.
      onMouseDown={(e) => e.preventDefault()}
      onMouseEnter={cancelGrace}
      onMouseLeave={scheduleHide}
    >
      <BlockSizeControls
        editor={editor}
        pos={pos}
        node={node}
        blockWidth={blockWidth}
        align={align}
      />
    </div>
  );
}

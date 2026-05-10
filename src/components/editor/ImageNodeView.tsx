import { useEffect, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { resolveImageSrc } from "@/lib/image-utils";
import { BlockSizeControls } from "@/components/editor/BlockSizeControls";
import { cn } from "@/lib/utils";

/**
 * React NodeView for the LocalImage extension. Wraps the `<img>` in a
 * relative-positioned container so the BlockSizeControls hover overlay can
 * sit at bottom-right (consistent with chart, drawing, and link-preview).
 *
 * Replaces the vanilla DOM NodeView that previously lived inline in
 * `local-image.ts`. We preserved its responsibilities:
 *   - Resolve `src` via `resolveImageSrc(src, documentDir)` so relative paths
 *     load via the Tauri asset protocol.
 *   - React to attribute updates (alt / title / src) — this is implicit when
 *     using a React NodeView since `node.attrs` triggers a re-render.
 */
export function ImageNodeView({
  node,
  editor,
  getPos,
  selected,
}: NodeViewProps) {
  const src = (node.attrs.src as string | null) ?? "";
  const alt = (node.attrs.alt as string | null) ?? "";
  const title = (node.attrs.title as string | null) ?? "";
  const blockWidth = (node.attrs.blockWidth as number | null) ?? null;
  const align = (node.attrs.align as string | null) ?? null;

  const [isHovered, setIsHovered] = useState(false);
  const [resolvedSrc, setResolvedSrc] = useState(src);

  useEffect(() => {
    const docDir = (
      editor.storage as unknown as Record<string, { documentDir?: string } | undefined>
    ).image?.documentDir;
    setResolvedSrc(resolveImageSrc(src, docDir));
  }, [src, editor.storage]);

  // Width/align are persisted in `node.attrs` and applied via inline CSS so
  // the rendered image visibly reflects the user's choice. The same attrs
  // round-trip through markdown via the LocalImage serializer.
  const wrapperStyle: React.CSSProperties = {
    width: blockWidth != null ? `${blockWidth}%` : undefined,
    marginLeft:
      align === "center" || align === "right" ? "auto" : undefined,
    marginRight: align === "center" ? "auto" : undefined,
  };

  return (
    <NodeViewWrapper
      as="div"
      className={cn(
        "relative group inline-block max-w-full",
        selected && "ring-2 ring-primary/40 rounded-lg",
      )}
      style={wrapperStyle}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      data-image-block=""
      data-block-width={blockWidth ?? undefined}
      data-align={align ?? undefined}
    >
      <img
        src={resolvedSrc}
        alt={alt}
        title={title || undefined}
        className="rounded-lg w-full h-auto block"
        draggable={false}
      />

      {isHovered && (() => {
        const pos = getPos();
        if (typeof pos !== "number") return null;
        return (
          <div className="absolute bottom-2 right-2 z-10">
            <BlockSizeControls
              editor={editor}
              pos={pos}
              node={node}
              blockWidth={blockWidth}
              align={align}
            />
          </div>
        );
      })()}
    </NodeViewWrapper>
  );
}

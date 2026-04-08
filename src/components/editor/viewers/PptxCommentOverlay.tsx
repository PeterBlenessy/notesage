import { useState } from "react";
import type { PptxComment } from "@/lib/pptx-types";

interface PptxCommentOverlayProps {
  comments: PptxComment[];
  px: (emu: number) => number;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

export function PptxCommentOverlay({ comments, px }: PptxCommentOverlayProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  if (comments.length === 0) return null;

  return (
    <>
      {comments.map((comment, i) => {
        // Comment positions in PPTX are in EMUs
        const left = px(comment.x);
        const top = px(comment.y);
        const isActive = activeIndex === i;

        return (
          <div key={i} style={{ position: "absolute", left, top, zIndex: 100 }}>
            {/* Marker */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setActiveIndex(isActive ? null : i);
              }}
              style={{
                width: 18,
                height: 18,
                borderRadius: "50%",
                backgroundColor: isActive
                  ? "var(--color-foreground, #333)"
                  : "var(--color-muted-foreground, #666)",
                color: isActive
                  ? "var(--color-background, #fff)"
                  : "var(--color-background, #fff)",
                fontSize: 10,
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1.5px solid var(--color-background, #fff)",
                cursor: "pointer",
                padding: 0,
                lineHeight: 1,
                boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
              }}
              title={`${comment.author}: ${comment.text}`}
            >
              {i + 1}
            </button>

            {/* Tooltip */}
            {isActive && (
              <div
                style={{
                  position: "absolute",
                  top: 22,
                  left: 0,
                  width: 200,
                  backgroundColor: "var(--color-background, #fff)",
                  border: "1px solid var(--color-border, #e5e5e5)",
                  borderRadius: 6,
                  padding: "8px 10px",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
                  zIndex: 101,
                  fontSize: 11,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div
                  style={{
                    fontWeight: 600,
                    color: "var(--color-foreground, #333)",
                    marginBottom: 2,
                  }}
                >
                  {comment.author}
                </div>
                {comment.date && (
                  <div
                    style={{
                      fontSize: 10,
                      color: "var(--color-muted-foreground, #999)",
                      marginBottom: 4,
                    }}
                  >
                    {formatDate(comment.date)}
                  </div>
                )}
                <div
                  style={{
                    color: "var(--color-foreground, #333)",
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.4,
                  }}
                >
                  {comment.text}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

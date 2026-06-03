import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useEffect, useState, useRef, useCallback } from "react";
import { Code, Eye, Pencil } from "lucide-react";
import { toast } from "sonner";
import { useSettingsStore } from "@/stores/settings-store";
import { cn } from "@/lib/utils";
import { convertMermaidToExcalidraw } from "@/lib/mermaid-to-drawing";

let mermaidInstance: typeof import("mermaid").default | null = null;
let mermaidInitialized = false;
let renderCounter = 0;

async function getMermaid() {
  if (!mermaidInstance) {
    const mod = await import("mermaid");
    mermaidInstance = mod.default;
  }
  return mermaidInstance;
}

async function initMermaid(isDark: boolean) {
  const mermaid = await getMermaid();
  mermaid.initialize({
    startOnLoad: false,
    theme: isDark ? "dark" : "default",
    fontFamily: "var(--font-sans, system-ui, sans-serif)",
    securityLevel: "strict",
    flowchart: { useMaxWidth: true },
    sequence: { useMaxWidth: true },
  });
  mermaidInitialized = true;
}

export function MermaidPreview({ node, selected, updateAttributes, editor, getPos }: NodeViewProps) {
  const source = (node.attrs.source as string) || "";
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [editSource, setEditSource] = useState(source);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const theme = useSettingsStore((s) => s.theme);
  const isDark =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : theme === "dark";

  // Render mermaid diagram
  useEffect(() => {
    if (!source.trim() || isEditing) return;

    let cancelled = false;

    (async () => {
      try {
        await initMermaid(isDark);
        const mermaid = await getMermaid();
        const id = `mermaid-${++renderCounter}`;
        const { svg } = await mermaid.render(id, source);
        if (!cancelled) {
          setSvgContent(svg);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setSvgContent(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => { cancelled = true; };
  }, [source, isDark, isEditing]);

  // Re-init mermaid when theme changes
  useEffect(() => {
    if (mermaidInitialized) {
      mermaidInitialized = false; // Force re-init with new theme
    }
  }, [isDark]);

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      // Move cursor to end
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
    }
  }, [isEditing]);

  const handleSave = useCallback(() => {
    const trimmed = editSource.trim();
    if (trimmed !== source) {
      updateAttributes({ source: trimmed });
    }
    setIsEditing(false);
  }, [editSource, source, updateAttributes]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        setEditSource(source);
        setIsEditing(false);
      }
    },
    [source]
  );

  const handleConvertToDrawing = useCallback(async () => {
    if (!source.trim() || !editor || typeof getPos !== "function") return;
    setIsConverting(true);
    try {
      const drawingJson = await convertMermaidToExcalidraw(source);
      const pos = getPos();
      if (typeof pos !== "number") return;

      // Replace this mermaid block with a drawing node
      editor.chain().command(({ tr }) => {
        const node = tr.doc.nodeAt(pos);
        if (!node) return false;
        tr.replaceWith(pos, pos + node.nodeSize, editor.schema.nodes.drawing.create({
          drawingId: crypto.randomUUID(),
          drawingJson,
        }));
        return true;
      }).run();

      toast.success("Converted to drawing");
    } catch (err) {
      toast.error(`Conversion failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsConverting(false);
    }
  }, [source, editor, getPos]);

  return (
    <NodeViewWrapper className="mermaid-node-view" contentEditable={false}>
      {isEditing ? (
        <div className="mermaid-editor">
          <div className="mermaid-editor-header">
            <span className="mermaid-editor-label">Mermaid</span>
            <button
              type="button"
              className="mermaid-editor-btn"
              onClick={handleSave}
              title="Preview diagram"
            >
              <Eye size={14} strokeWidth={1.5} />
              <span>Preview</span>
            </button>
          </div>
          <textarea
            ref={textareaRef}
            className="mermaid-editor-textarea"
            aria-label="Mermaid diagram source"
            value={editSource}
            onChange={(e) => setEditSource(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            rows={Math.max(5, editSource.split("\n").length + 1)}
          />
        </div>
      ) : (
        <div
          className={cn(
            "mermaid-preview",
            selected && "mermaid-preview-selected"
          )}
          onDoubleClick={() => {
            setEditSource(source);
            setIsEditing(true);
          }}
        >
          {svgContent ? (
            <div
              className="mermaid-svg-container"
              dangerouslySetInnerHTML={{ __html: svgContent }}
            />
          ) : error ? (
            <div className="mermaid-error">
              <div className="mermaid-error-title">Mermaid syntax error</div>
              <pre className="mermaid-error-detail">{error}</pre>
              <pre className="mermaid-error-source">{source}</pre>
            </div>
          ) : (
            <div className="mermaid-loading">Rendering diagram...</div>
          )}
          <div className="mermaid-action-buttons">
            <button
              type="button"
              className="mermaid-edit-btn mermaid-convert-btn"
              onClick={handleConvertToDrawing}
              disabled={isConverting}
              title="Convert to Excalidraw drawing"
            >
              <Pencil size={14} strokeWidth={1.5} />
            </button>
            <button
              type="button"
              className="mermaid-edit-btn"
              onClick={() => {
                setEditSource(source);
                setIsEditing(true);
              }}
              title="Edit source"
            >
              <Code size={14} strokeWidth={1.5} />
            </button>
          </div>
        </div>
      )}
    </NodeViewWrapper>
  );
}

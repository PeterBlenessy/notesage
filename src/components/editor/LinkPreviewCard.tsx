import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import React, { useEffect, useRef, useState } from "react";
import { Globe, ExternalLink } from "lucide-react";
import { tauriApi } from "@/lib/tauri";
import { cn } from "@/lib/utils";

type CardState = "input" | "loading" | "loaded" | "error";

export function LinkPreviewCard({ node, selected, editor, getPos }: NodeViewProps) {
  const url = node.attrs.url as string;
  const title = node.attrs.title as string | null;
  const description = node.attrs.description as string | null;
  const siteName = node.attrs.siteName as string | null;
  const imageUrl = node.attrs.imageUrl as string | null;
  const faviconUrl = node.attrs.faviconUrl as string | null;
  const blockWidth = node.attrs.blockWidth as number | null;
  const align = node.attrs.align as string | null;

  const initialState: CardState = !url ? "input" : title ? "loaded" : "loading";
  const [state, setState] = useState<CardState>(initialState);
  const [imgError, setImgError] = useState(false);
  const [faviconError, setFaviconError] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus the input when in input state
  useEffect(() => {
    if (state === "input") {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [state]);

  // Fetch metadata when URL is set but metadata not populated
  useEffect(() => {
    if (!url || title || state !== "loading") return;

    let cancelled = false;
    tauriApi
      .fetchLinkMetadata(url)
      .then((meta) => {
        if (cancelled) return;
        const pos = getPos();
        if (pos === undefined) return;
        editor.commands.updateLinkPreview(pos, {
          title: meta.title,
          description: meta.description,
          siteName: meta.site_name,
          imageUrl: meta.image_url,
          faviconUrl: meta.favicon_url,
        });
        setState("loaded");
      })
      .catch(() => {
        if (cancelled) return;
        setState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [url, title, state, editor, getPos]);

  const handleInputSubmit = () => {
    const trimmed = inputValue.trim();
    if (!trimmed || (!trimmed.startsWith("http://") && !trimmed.startsWith("https://"))) return;

    const pos = getPos();
    if (pos === undefined) return;
    editor.commands.updateLinkPreview(pos, {
      title: null,
      description: null,
      siteName: null,
      imageUrl: null,
      faviconUrl: null,
    });
    // Set the URL attr — this triggers the fetch useEffect
    const { tr } = editor.state;
    tr.setNodeAttribute(pos, "url", trimmed);
    editor.view.dispatch(tr);
    setState("loading");
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleInputSubmit();
    }
    if (e.key === "Escape") {
      // Delete the empty node on escape
      const pos = getPos();
      if (pos === undefined) return;
      editor.commands.deleteRange({ from: pos, to: pos + node.nodeSize });
      editor.commands.focus();
    }
  };

  const handleClick = () => {
    if (url) window.open(url, "_blank");
  };

  const displaySiteName = siteName || (url ? extractDomain(url) : "");
  const showImage = imageUrl && !imgError;

  const blockStyle: React.CSSProperties = {};
  if (blockWidth != null) {
    blockStyle.width = `${blockWidth}%`;
    if (align === "center") {
      blockStyle.marginLeft = "auto";
      blockStyle.marginRight = "auto";
    } else if (align === "right") {
      blockStyle.marginLeft = "auto";
      blockStyle.marginRight = "0";
    } else {
      blockStyle.marginRight = "auto";
    }
  }

  return (
    <NodeViewWrapper
      style={blockStyle}
      className={cn(
        "link-preview-wrapper my-2 rounded-lg",
        selected && "ring-1 ring-ring"
      )}
    >
      {/* URL input mode (from /embed slash command) */}
      {state === "input" && (
        <div className="border border-border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Globe className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
            <span className="text-xs text-muted-foreground">Embed link preview</span>
          </div>
          <input
            ref={inputRef}
            type="url"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Paste or type a URL and press Enter..."
            className="w-full bg-transparent border border-border rounded px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      )}

      {/* Loading skeleton */}
      {state === "loading" && (
        <div
          className="border border-border rounded-lg p-4 cursor-pointer transition-colors duration-150 hover:bg-muted/50"
          onClick={handleClick}
        >
          <div className="text-xs text-muted-foreground truncate mb-3">
            {url}
          </div>
          <div className="flex gap-4">
            <div className="flex-1 space-y-2">
              <div className="h-4 w-3/4 bg-muted rounded animate-pulse" />
              <div className="h-3 w-full bg-muted rounded animate-pulse" />
              <div className="h-3 w-2/3 bg-muted rounded animate-pulse" />
            </div>
            <div className="w-[120px] h-[80px] bg-muted rounded animate-pulse shrink-0" />
          </div>
        </div>
      )}

      {/* Loaded card */}
      {state === "loaded" && (
        <div
          className="border border-border rounded-lg p-4 cursor-pointer transition-colors duration-150 hover:bg-muted/50 group"
          onClick={handleClick}
        >
          {/* Site name + favicon */}
          <div className="flex items-center gap-1.5 mb-2">
            {faviconUrl && !faviconError ? (
              <img
                src={faviconUrl}
                alt=""
                className="w-4 h-4 rounded-sm"
                onError={() => setFaviconError(true)}
              />
            ) : (
              <Globe className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
            )}
            <span className="text-xs text-muted-foreground truncate">
              {displaySiteName}
            </span>
            <ExternalLink
              className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity ml-auto shrink-0"
              strokeWidth={1.5}
            />
          </div>

          <div className="flex gap-4">
            <div className="flex-1 min-w-0">
              {/* Title */}
              {title && (
                <div className="text-sm font-semibold text-foreground line-clamp-2 mb-1">
                  {title}
                </div>
              )}
              {/* Description */}
              {description && (
                <div className="text-xs text-muted-foreground line-clamp-2 mb-1">
                  {description}
                </div>
              )}
              {/* URL */}
              <div className="text-xs text-muted-foreground/70 truncate">
                {url}
              </div>
            </div>

            {/* Preview image */}
            {showImage && (
              <img
                src={imageUrl}
                alt=""
                className="w-[120px] h-[80px] rounded object-cover shrink-0"
                onError={() => setImgError(true)}
              />
            )}
          </div>
        </div>
      )}

      {/* Error state */}
      {state === "error" && (
        <div
          className="border border-border rounded-lg p-4 cursor-pointer transition-colors duration-150 hover:bg-muted/50"
          onClick={handleClick}
        >
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
            <span className="text-sm text-foreground truncate">{url}</span>
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Preview unavailable
          </div>
          <div className="text-xs text-muted-foreground/70 truncate mt-0.5">
            {displaySiteName}
          </div>
        </div>
      )}
    </NodeViewWrapper>
  );
}

function extractDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

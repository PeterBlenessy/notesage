import Image from "@tiptap/extension-image";
import { resolveImageSrc } from "@/lib/image-utils";
import { tauriApi } from "@/lib/tauri";

/**
 * The filesystem directory of an `asset.localhost` URL (`convertFileSrc` output),
 * e.g. `http://asset.localhost/Users/me/proj/images/a.png` → `/Users/me/proj/images`.
 * Used by the image self-heal to grant the asset scope for exactly the failing
 * image's directory. Returns `null` if the URL isn't a parseable asset path.
 */
export function assetDirFromUrl(assetUrl: string): string | null {
  try {
    const path = decodeURIComponent(new URL(assetUrl).pathname);
    const slash = path.lastIndexOf("/");
    return slash > 0 ? path.slice(0, slash) : null;
  } catch {
    return null;
  }
}

/**
 * Extends the Tiptap Image extension with:
 *  - `documentDir` storage (used for resolving relative paths via the Tauri
 *    asset protocol).
 *  - `blockWidth` attribute for sizing the image.
 *  - `textAlign` is provided globally by the TextAlign extension (configured
 *    in `useEditor.ts` to cover this node type) — toolbar align button writes
 *    the same attribute that gets serialised to markdown.
 *  - A vanilla DOM NodeView. We tried a React NodeView (with hover-revealed
 *    BlockSizeControls) but the per-image React-mount cost made large
 *    image-heavy markdown files 2–3x slower to open. Hover controls for image
 *    are deferred to a follow-up; sizing/aligning still works via the
 *    toolbar's TextAlign command.
 *  - A markdown serializer that writes `<!--blockWidth:N,align:X-->` after
 *    the image when those attrs are set. Matching parser lives in
 *    `markdown.ts` (`convertImagesWithMetaToHtml`).
 *
 * Set the document directory on the editor after creation or on tab switch:
 *   editor.storage.image.documentDir = getDocumentDir(filePath)
 */
export const LocalImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      blockWidth: {
        default: null as number | null,
        parseHTML: (element: HTMLElement) => {
          const v = element.getAttribute("data-block-width");
          return v ? Number(v) : null;
        },
        renderHTML: (attributes: Record<string, unknown>) => {
          if (attributes.blockWidth == null) return {};
          return { "data-block-width": String(attributes.blockWidth) };
        },
      },
      align: {
        default: null as string | null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-align") || null,
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.align) return {};
          return { "data-align": attributes.align as string };
        },
      },
    };
  },

  addStorage() {
    return {
      documentDir: "",
      /** Callback set by Editor.tsx — opens the image insert dialog. */
      openInsertDialog: null as (() => void) | null,
      markdown: {
        serialize(
          state: { write: (text: string) => void },
          node: {
            attrs: {
              src: string;
              alt: string | null;
              title: string | null;
              blockWidth: number | null;
              align: string | null;
            };
          },
        ) {
          const { src, alt, title, blockWidth, align } = node.attrs;
          if (!src) return;

          const safeAlt = (alt ?? "").replace(/[\[\]]/g, "\\$&");
          const titlePart = title ? ` "${title.replace(/"/g, '\\"')}"` : "";

          const meta: string[] = [];
          if (blockWidth != null) meta.push(`blockWidth:${blockWidth}`);
          if (align != null) meta.push(`align:${align}`);
          const metaSuffix =
            meta.length > 0 ? ` <!--${meta.join(",")}-->` : "";

          // Trailing `\n\n` closes the block — without it, the next
          // top-level node (heading, paragraph) gets concatenated to the
          // same line and the `#` of a following heading gets backslash-
          // escaped, corrupting the markdown. Matches the pattern in the
          // chart and drawing serializers.
          state.write(`![${safeAlt}](${src}${titlePart})${metaSuffix}\n\n`);
        },
        parse: {
          // Parsing is handled by the preprocessor in markdown.ts
          // (`convertImagesWithMetaToHtml`).
        },
      },
    };
  },

  addNodeView() {
    return ({
      node,
      editor,
      getPos,
    }: {
      node: { type: { name: string }; attrs: Record<string, unknown> };
      editor: {
        chain: () => {
          command: (
            fn: (ctx: {
              tr: {
                setNodeMarkup: (
                  pos: number,
                  type: undefined,
                  attrs: Record<string, unknown>
                ) => void;
              };
            }) => boolean
          ) => { run: () => boolean };
        };
        storage: unknown;
      };
      getPos: (() => number | undefined) | boolean;
    }) => {
      // Vanilla DOM NodeView — much cheaper than React per-image mount on
      // image-heavy documents (revert from React NodeView in 408f1894 after
      // it caused a 2-3x slowdown on the user's 494 KB book).
      //
      // The hover toolbar uses direct addEventListener on the wrapper div so
      // that it fires in production WebKit/Tauri builds. An earlier attempt
      // used an editor-level mouseover plugin which fired in JSDOM/dev but
      // not in production (event-listener target divergence).
      let currentNode = node;

      const wrapper = document.createElement("div");
      wrapper.className = "image-block-wrapper";
      wrapper.style.cssText = "position: relative; display: block; line-height: 0;";

      const img = document.createElement("img");
      img.className = "rounded-lg max-w-full block";

      const getDocDir = () =>
        (
          editor.storage as unknown as Record<
            string,
            { documentDir?: string } | undefined
          >
        ).image?.documentDir;
      const resolve = (src: string) => resolveImageSrc(src, getDocDir());

      // Self-heal the startup asset-scope race (failure-only — zero cost on the
      // happy path). On a fresh restart the WebView can paint this <img> before
      // `allow_asset_dir` has granted read scope for the file, so the asset
      // request is refused and the image shows a broken placeholder until a
      // manual refresh. On an asset-URL load error we grant the image's OWN
      // directory (derived from the failed URL, so it's covered regardless of
      // where the doc lives — the previous version granted only `documentDir`,
      // missing images in sibling dirs) and reload. Retries with backoff so a
      // slow (iCloud) startup grant lands within the window; bounded to avoid a
      // loop on genuinely-missing files. Remote/data URLs are left alone.
      let assetHealAttempts = 0;
      img.addEventListener("error", () => {
        const failedSrc = img.src;
        if (assetHealAttempts >= 4 || !failedSrc.includes("asset.localhost")) return;
        assetHealAttempts++;
        const reload = () => {
          // Force a fresh request — re-assigning the same URL alone may not
          // re-fetch a previously-refused asset.
          img.src = "";
          img.src = failedSrc;
        };
        const dir = assetDirFromUrl(failedSrc) ?? getDocDir();
        const delay = 60 * assetHealAttempts;
        if (dir) {
          void tauriApi.allowAssetDir(dir).then(
            () => setTimeout(reload, delay),
            () => setTimeout(reload, delay),
          );
        } else {
          setTimeout(reload, delay);
        }
      });

      // Build the hover toolbar -----------------------------------------------
      // Matches BlockSizeControls.tsx visually: same sizing, CSS-variable tokens
      // only (no hex fallbacks), and lucide-react-equivalent SVG align icons.
      const WIDTH_PRESETS = [25, 50, 75, 100] as const;
      const ALIGNS = ["left", "center", "right"] as const;

      // Lucide-react icon path data (AlignLeft/Center/Right from lucide v1.16.0).
      // Using programmatic SVG creation avoids a React mount per image block
      // (the React NodeView was reverted in 19b9fdb5 due to 2-3x slowdown on
      // 494 KB image-heavy documents).  One shared set of paths is fine because
      // the SVG element is created once per align button, not shared.
      const SVG_NS = "http://www.w3.org/2000/svg";
      const ALIGN_ICON_PATHS: Record<string, string[]> = {
        left:   ["M21 5H3", "M15 12H3", "M17 19H3"],
        center: ["M21 5H3", "M17 12H7", "M19 19H5"],
        right:  ["M21 5H3", "M21 12H9", "M21 19H7"],
      };

      function makeLucideAlignSvg(align: string): SVGElement {
        const svg = document.createElementNS(SVG_NS, "svg");
        svg.setAttribute("xmlns", SVG_NS);
        svg.setAttribute("width", "12");
        svg.setAttribute("height", "12");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("fill", "none");
        svg.setAttribute("stroke", "currentColor");
        svg.setAttribute("stroke-width", "1.5");
        svg.setAttribute("stroke-linecap", "round");
        svg.setAttribute("stroke-linejoin", "round");
        svg.setAttribute("aria-hidden", "true");
        for (const d of (ALIGN_ICON_PATHS[align] ?? [])) {
          const path = document.createElementNS(SVG_NS, "path");
          path.setAttribute("d", d);
          svg.appendChild(path);
        }
        return svg;
      }

      const toolbar = document.createElement("div");
      toolbar.setAttribute("data-testid", "image-block-size-toolbar");
      toolbar.style.cssText = [
        "display: none",
        "position: absolute",
        "bottom: 8px",
        "right: 8px",
        "z-index: 10",
        "align-items: center",
        "gap: 2px",
        "border-radius: 6px",
        "background: var(--color-popover)",
        "border: 1px solid var(--color-border)",
        "padding: 2px 4px",
        "backdrop-filter: blur(4px)",
        "-webkit-backdrop-filter: blur(4px)",
        "box-shadow: 0 2px 8px rgba(0,0,0,0.12)",
      ].join(";");

      const widthBtns: HTMLButtonElement[] = [];
      for (const w of WIDTH_PRESETS) {
        const btn = document.createElement("button");
        btn.setAttribute("data-width", String(w));
        btn.type = "button";
        btn.textContent = `${w}%`;
        btn.style.cssText =
          "background:none;border:none;cursor:pointer;padding:2px 4px;border-radius:2px;font-size:10px;font-family:monospace;min-width:28px;color:var(--color-muted-foreground)";
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const pos =
            typeof getPos === "function" ? getPos() : undefined;
          if (pos == null) return;
          const current = currentNode.attrs.blockWidth as number | null;
          const next = current === w ? null : w;
          editor
            .chain()
            .command(({ tr }) => {
              tr.setNodeMarkup(pos, undefined, {
                ...currentNode.attrs,
                blockWidth: next,
              });
              return true;
            })
            .run();
        });
        widthBtns.push(btn);
        toolbar.appendChild(btn);
      }

      const sep = document.createElement("span");
      sep.style.cssText =
        "display:inline-block;width:1px;height:14px;background:var(--color-border);margin:0 2px";
      toolbar.appendChild(sep);

      const alignBtns: HTMLButtonElement[] = [];
      for (const a of ALIGNS) {
        const btn = document.createElement("button");
        btn.setAttribute("data-align", a);
        btn.type = "button";
        btn.title = `Align ${a}`;
        // SVG icon matching lucide-react AlignLeft / AlignCenter / AlignRight
        // (same paths as BlockSizeControls.tsx uses via the React component).
        btn.appendChild(makeLucideAlignSvg(a));
        btn.style.cssText =
          "background:none;border:none;cursor:pointer;padding:0;height:20px;width:20px;display:inline-flex;align-items:center;justify-content:center;border-radius:2px;color:var(--color-muted-foreground)";
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const pos =
            typeof getPos === "function" ? getPos() : undefined;
          if (pos == null) return;
          const nextBlockWidth =
            (currentNode.attrs.blockWidth as number | null) ?? 75;
          editor
            .chain()
            .command(({ tr }) => {
              tr.setNodeMarkup(pos, undefined, {
                ...currentNode.attrs,
                blockWidth: nextBlockWidth,
                align: a,
              });
              return true;
            })
            .run();
        });
        alignBtns.push(btn);
        toolbar.appendChild(btn);
      }

      wrapper.appendChild(img);
      wrapper.appendChild(toolbar);

      // Direct DOM listeners — not a plugin-level listener so they fire in
      // production WebKit builds where delegated editor events may not reach
      // the img element.
      wrapper.addEventListener("mouseenter", () => {
        toolbar.style.display = "flex";
      });
      wrapper.addEventListener("mouseleave", () => {
        toolbar.style.display = "none";
      });

      const applyAttrs = (attrs: Record<string, unknown>) => {
        img.src = resolve(attrs.src as string);
        if (attrs.alt) img.alt = attrs.alt as string;
        else img.removeAttribute("alt");
        if (attrs.title) img.title = attrs.title as string;
        else img.removeAttribute("title");

        const blockWidth = attrs.blockWidth as number | null;
        const align = attrs.align as string | null;

        if (blockWidth != null) {
          img.style.width = `${blockWidth}%`;
          img.style.height = "auto";
          if (align === "center") {
            img.style.marginLeft = "auto";
            img.style.marginRight = "auto";
            img.style.display = "block";
          } else if (align === "right") {
            img.style.marginLeft = "auto";
            img.style.marginRight = "0";
            img.style.display = "block";
          } else {
            img.style.marginLeft = "0";
            img.style.marginRight = "auto";
            img.style.display = "block";
          }
        } else {
          img.style.removeProperty("width");
          img.style.removeProperty("margin-left");
          img.style.removeProperty("margin-right");
        }

        // Update active state on width buttons — use --color-accent-primary
        // (the correct chromatic token) instead of the wrong --color-accent.
        for (const btn of widthBtns) {
          const w = Number(btn.getAttribute("data-width"));
          if (w === blockWidth) {
            btn.classList.add("active");
            btn.style.background = "var(--color-accent-primary)";
            btn.style.color = "var(--color-accent-foreground)";
          } else {
            btn.classList.remove("active");
            btn.style.background = "none";
            btn.style.color = "var(--color-muted-foreground)";
          }
        }

        // Update active state on align buttons
        for (const btn of alignBtns) {
          const a = btn.getAttribute("data-align");
          if (a === align) {
            btn.classList.add("active");
            btn.style.background = "var(--color-accent-primary)";
            btn.style.color = "var(--color-accent-foreground)";
          } else {
            btn.classList.remove("active");
            btn.style.background = "none";
            btn.style.color = "var(--color-muted-foreground)";
          }
        }
      };

      applyAttrs(node.attrs);

      return {
        dom: wrapper,
        update: (updatedNode: { type: { name: string }; attrs: Record<string, unknown> }) => {
          if (updatedNode.type.name !== "image") return false;
          currentNode = updatedNode;
          applyAttrs(updatedNode.attrs);
          return true;
        },
      };
    };
  },
});

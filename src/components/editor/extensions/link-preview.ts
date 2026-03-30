import { Node, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { LinkPreviewCard } from "../LinkPreviewCard";

const URL_RE = /^https?:\/\/\S+$/;
const linkPreviewPasteKey = new PluginKey("linkPreviewPaste");

/** Show a small floating prompt below the pasted URL offering to convert to a preview card. */
function showPastePrompt(
  coords: { left: number; bottom: number },
  _url: string,
  onAccept: () => void
) {
  // Remove any existing prompt
  document.querySelector(".link-preview-paste-prompt")?.remove();

  const prompt = document.createElement("div");
  prompt.className = "link-preview-paste-prompt";
  prompt.style.cssText = `
    position: fixed;
    left: ${coords.left}px;
    top: ${coords.bottom + 4}px;
    z-index: 9999;
    background: var(--color-popover);
    color: var(--color-popover-foreground);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    padding: 4px 10px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.2);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    font-size: 13px;
    display: flex;
    align-items: center;
    gap: 8px;
  `;

  const label = document.createElement("span");
  label.textContent = "Create link preview?";
  label.style.color = "var(--color-muted-foreground)";

  const acceptBtn = document.createElement("button");
  acceptBtn.textContent = "\u2713";
  acceptBtn.title = "Convert to preview card";
  acceptBtn.style.cssText = `
    background: none; border: none; cursor: pointer; padding: 2px 6px;
    border-radius: 4px; font-size: 14px; color: var(--color-foreground);
    transition: background 150ms;
  `;
  acceptBtn.addEventListener("mouseenter", () => { acceptBtn.style.background = "var(--color-accent)"; });
  acceptBtn.addEventListener("mouseleave", () => { acceptBtn.style.background = "transparent"; });

  const dismissBtn = document.createElement("button");
  dismissBtn.textContent = "\u2715";
  dismissBtn.title = "Keep as text";
  dismissBtn.style.cssText = acceptBtn.style.cssText;
  dismissBtn.addEventListener("mouseenter", () => { dismissBtn.style.background = "var(--color-accent)"; });
  dismissBtn.addEventListener("mouseleave", () => { dismissBtn.style.background = "transparent"; });

  prompt.appendChild(label);
  prompt.appendChild(acceptBtn);
  prompt.appendChild(dismissBtn);
  document.body.appendChild(prompt);

  const dismiss = () => prompt.remove();

  acceptBtn.addEventListener("click", () => {
    dismiss();
    onAccept();
  });
  dismissBtn.addEventListener("click", dismiss);

  // Auto-dismiss after 5 seconds
  setTimeout(dismiss, 5000);
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    linkPreview: {
      insertLinkPreview: (attrs: {
        url: string;
        title?: string | null;
        description?: string | null;
        siteName?: string | null;
        imageUrl?: string | null;
        faviconUrl?: string | null;
      }) => ReturnType;
      updateLinkPreview: (
        pos: number,
        attrs: Partial<{
          title: string | null;
          description: string | null;
          siteName: string | null;
          imageUrl: string | null;
          faviconUrl: string | null;
        }>
      ) => ReturnType;
    };
  }
}

export const LinkPreview = Node.create({
  name: "linkPreview",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      url: { default: "" },
      title: { default: null },
      description: { default: null },
      siteName: { default: null },
      imageUrl: { default: null },
      faviconUrl: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-link-preview]",
        getAttrs: (element: HTMLElement) => ({
          url: element.getAttribute("data-link-preview") || "",
          title: element.getAttribute("data-title") || null,
          description: element.getAttribute("data-description") || null,
          siteName: element.getAttribute("data-site-name") || null,
          imageUrl: element.getAttribute("data-image-url") || null,
          faviconUrl: element.getAttribute("data-favicon-url") || null,
        }),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-link-preview": (HTMLAttributes.url as string) || "",
        class: "link-preview-card",
      }),
      (HTMLAttributes.title as string) ||
        (HTMLAttributes.url as string) ||
        "Link Preview",
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: unknown, node: unknown) {
          const s = state as {
            write: (text: string) => void;
            flushClose: (size?: number) => void;
            out: string;
            closed: unknown;
          };
          const n = node as {
            attrs: {
              url: string;
              title: string | null;
              description: string | null;
              siteName: string | null;
              imageUrl: string | null;
              faviconUrl: string | null;
            };
          };

          const { url, title, description, siteName, imageUrl, faviconUrl } = n.attrs;
          const lines: string[] = [`> [!link](${url})`];
          if (title) lines.push(`> **${title}**`);
          if (description) lines.push(`> ${description}`);
          if (siteName) lines.push(`> ${siteName}`);
          // Persist image/favicon URLs as hidden metadata lines
          if (imageUrl) lines.push(`> <!--image:${imageUrl}-->`);
          if (faviconUrl) lines.push(`> <!--favicon:${faviconUrl}-->`);

          s.write(lines.join("\n") + "\n\n");
        },
        parse: {
          // Parsing is handled by the preprocessor in markdown.ts
        },
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(LinkPreviewCard);
  },

  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => {
        const { state } = editor;
        const { selection } = state;
        if (!selection.empty) return false;
        const node = state.doc.nodeAt(selection.from - 1);
        if (!node || node.type.name !== this.name) return false;

        // Replace link preview with a paragraph containing the URL as text
        const url = node.attrs.url as string;
        const pos = selection.from - 1;
        const { tr } = state;
        tr.replaceWith(pos, pos + node.nodeSize, state.schema.nodes.paragraph.create(
          null,
          url ? [state.schema.text(url)] : []
        ));
        editor.view.dispatch(tr);
        return true;
      },
      Delete: ({ editor }) => {
        const { state } = editor;
        const { selection } = state;
        if (!selection.empty) return false;
        const node = state.doc.nodeAt(selection.from);
        if (!node || node.type.name !== this.name) return false;

        const url = node.attrs.url as string;
        const { tr } = state;
        tr.replaceWith(selection.from, selection.from + node.nodeSize, state.schema.nodes.paragraph.create(
          null,
          url ? [state.schema.text(url)] : []
        ));
        editor.view.dispatch(tr);
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    const extensionThis = this;
    return [
      new Plugin({
        key: linkPreviewPasteKey,
        props: {
          handlePaste(view, event) {
            const text = event.clipboardData?.getData("text/plain")?.trim();
            if (!text || !URL_RE.test(text)) return false;

            // Check if pasting into an empty paragraph
            const { state } = view;
            const { $from } = state.selection;
            const parent = $from.parent;
            if (parent.type.name !== "paragraph" || parent.content.size !== 0) return false;

            // Show floating prompt below the cursor
            const coords = view.coordsAtPos($from.pos);
            showPastePrompt(coords, text, () => {
              // Accept: replace paragraph with link preview
              extensionThis.editor.commands.insertLinkPreview({ url: text });
            });

            // Don't prevent default — let the URL paste normally.
            // The prompt appears below offering conversion.
            return false;
          },
        },
      }),
    ];
  },

  addCommands() {
    return {
      insertLinkPreview:
        (attrs) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs,
          });
        },
      updateLinkPreview:
        (pos, attrs) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            Object.entries(attrs).forEach(([key, value]) => {
              tr.setNodeAttribute(pos, key, value);
            });
          }
          return true;
        },
    };
  },
});

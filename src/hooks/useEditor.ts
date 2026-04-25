import { useEditor as useTiptapEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import UniqueID from "@tiptap/extension-unique-id";
import { LocalImage } from "@/components/editor/extensions/local-image";
import { Table } from "@tiptap/extension-table";
import { serializeTable } from "@/components/editor/extensions/table-markdown";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeaderWithAttrs } from "@/components/editor/extensions/table-header-attrs";
import { TableFilter } from "@/components/editor/extensions/table-filter";
import { TableAggregation } from "@/components/editor/extensions/table-aggregation";
import { TableSort } from "@/components/editor/extensions/table-sort";
import { TableSparkline } from "@/components/editor/extensions/table-sparkline";
import { TableHeaderMenu } from "@/components/editor/extensions/table-header-menu";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import { ThemedHighlight } from "@/components/editor/extensions/themed-highlight";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import { Markdown } from "tiptap-markdown";
import { SlashCommand } from "@/components/editor/extensions/slash-command";
import { AISuggestion, InlineDiff, CommentMark, GhostText, TagHighlight, TagSuggestion, MentionHighlight, MentionSuggestion, DateHighlight, DateSuggestion, SearchHighlight, Drawing, Chart, MermaidBlock, LinkPreview, TableOfContents } from "@/components/editor/extensions";
import { PageBreaks } from "@/components/editor/extensions/page-breaks";
import { LinkClick } from "@/components/editor/extensions/link-click";
import { SendToAI } from "@/components/editor/extensions/send-to-ai";
import { Callout } from "@/components/editor/extensions/callout";
import { PasteHandler } from "@/components/editor/extensions/paste-handler";
import Focus from "@tiptap/extension-focus";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import markdownitSub from "markdown-it-sub";
import markdownitSup from "markdown-it-sup";
import { HeadingWithOverrides, ParagraphWithOverrides, TypographyOverrides } from "@/components/editor/extensions/typography-overrides";
import { getMarkdownFromEditor } from "@/lib/markdown";
import { getEditorStorage, type EditorStorageImage } from "@/lib/editor-storage";

const lowlight = createLowlight(common);

interface UseEditorOptions {
  content: string;
  onUpdate?: (content: string) => void;
  editable?: boolean;
  /** Document directory for resolving relative image paths on initial load. */
  documentDir?: string;
}

let serializeTimer: ReturnType<typeof setTimeout> | null = null;

export function useEditor({ content, onUpdate, editable = true, documentDir }: UseEditorOptions): Editor | null {
  const editor = useTiptapEditor({
    onCreate: ({ editor }) => {
      // Set documentDir early so image nodes created during initial parse resolve correctly
      if (documentDir) {
        const imageStorage = getEditorStorage<EditorStorageImage>(editor, 'image');
        if (imageStorage) {
          imageStorage.documentDir = documentDir;
        }
      }
    },
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        // Disable built-in heading and paragraph — replaced by extended
        // versions with typography override attributes (fontFamily, fontSize,
        // fontWeight, lineHeight, color).
        heading: false,
        paragraph: false,
        link: {
          openOnClick: false,
          HTMLAttributes: {
            class: "text-primary underline cursor-pointer",
          },
        },
      }),
      HeadingWithOverrides.configure({
        levels: [1, 2, 3, 4, 5, 6],
      }),
      ParagraphWithOverrides,
      TypographyOverrides,
      Placeholder.configure({
        placeholder: "Start typing or press '/' for commands...",
      }),
      TextAlign.configure({
        types: ["heading", "paragraph"],
      }),
      TextStyle,
      Color,
      ThemedHighlight.configure({
        multicolor: true,
      }),
      Subscript.extend({
        addStorage() {
          return {
            ...this.parent?.(),
            markdown: {
              serialize: { open: "~", close: "~", expelEnclosingWhitespace: true },
              parse: {
                setup(md: { use: (plugin: unknown) => void }) {
                  md.use(markdownitSub);
                },
              },
            },
          };
        },
      }),
      Superscript.extend({
        addStorage() {
          return {
            ...this.parent?.(),
            markdown: {
              serialize: { open: "^", close: "^", expelEnclosingWhitespace: true },
              parse: {
                setup(md: { use: (plugin: unknown) => void }) {
                  md.use(markdownitSup);
                },
              },
            },
          };
        },
      }),
      LocalImage.configure({
        allowBase64: true,
        HTMLAttributes: {
          class: "rounded-lg max-w-full",
        },
      }),
      CodeBlockLowlight.configure({
        lowlight,
        HTMLAttributes: {
          class: "bg-muted rounded-lg p-4 font-mono text-sm",
        },
      }),
      Table.extend({
        addStorage() {
          return {
            ...this.parent?.(),
            markdown: {
              serialize: serializeTable,
              parse: {},
            },
          };
        },
      }).configure({
        resizable: true,
        HTMLAttributes: {
          class: "border-collapse table-auto w-full",
        },
      }),
      TableRow,
      TableCell.configure({
        HTMLAttributes: {
          class: "border border-border p-2",
        },
      }),
      TableHeaderWithAttrs.configure({
        HTMLAttributes: {
          class: "border border-border p-2 bg-muted font-semibold",
        },
      }),
      TaskList.configure({
        HTMLAttributes: {
          class: "list-none pl-0",
        },
      }),
      TaskItem.configure({
        HTMLAttributes: {
          class: "flex items-start gap-2",
        },
        nested: true,
      }),
      // Live-test 2026-04-25 — PasteHandler MUST be listed before
      // `Markdown` so its `handlePaste` plugin runs first in ProseMirror's
      // plugin pipeline. The Markdown extension transforms every pasted
      // `text/plain` payload through markdown-it, which we want to bypass
      // for file paths (`com~apple~CloudDocs` → `<sub>apple</sub>`),
      // box-drawn terminal tables (loses column alignment), etc. See
      // `src/lib/editor/paste-rules.ts` for rule definitions.
      PasteHandler,
      Markdown.configure({
        html: true,
        transformPastedText: true,
        transformCopiedText: false,
        // Prevent duplicate extensions
        linkify: false,
      }),
      DateHighlight,
      SlashCommand,
      DateSuggestion,
      AISuggestion,
      InlineDiff,
      CommentMark,
      PageBreaks,
      GhostText,
      TagHighlight,
      TagSuggestion,
      MentionHighlight,
      MentionSuggestion,
      SearchHighlight,
      LinkClick,
      Callout,
      Drawing,
      Chart,
      MermaidBlock,
      LinkPreview,
      TableFilter,
      TableAggregation,
      TableSort,
      TableSparkline,
      TableHeaderMenu,
      SendToAI,
      TableOfContents,
      UniqueID.configure({
        attributeName: 'id',
        types: [
          'paragraph',
          'heading',
          'listItem',
          'taskItem',
          'codeBlock',
          'blockquote',
          'table',
          'image',
          'drawing',
          'chart',
          'callout',
          'linkPreview',
          'mermaidBlock',
          'horizontalRule',
        ],
        generateID: () => crypto.randomUUID(),
      }),
      Focus.configure({
        className: 'has-focus',
        mode: 'all',
      }),
    ],
    content,
    editable,
    editorProps: {
      attributes: {
        class: "prose prose-slate dark:prose-invert max-w-none focus:outline-none",
      },
      handleKeyDown: (_view, event) => {
        // Prevent ProseMirror/Tiptap from handling Cmd+K (link toggle) —
        // Cmd+K is reserved for the command palette at the app level.
        if ((event.metaKey || event.ctrlKey) && event.key === "k") {
          return true; // Returning true tells PM to NOT handle the event
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      if (onUpdate) {
        // Debounce serialization — for large documents (3000+ nodes),
        // serializing on every keystroke is expensive. Mark dirty immediately
        // via a lightweight check, serialize after a brief pause.
        if (serializeTimer) clearTimeout(serializeTimer);
        serializeTimer = setTimeout(() => {
          const markdown = getMarkdownFromEditor(editor);
          onUpdate(markdown);
          serializeTimer = null;
        }, 150);
      }
    },
  });

  return editor;
}

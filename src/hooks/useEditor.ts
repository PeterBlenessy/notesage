import { useEditor as useTiptapEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { LocalImage } from "@/components/editor/extensions/local-image";
import { Table } from "@tiptap/extension-table";
import { serializeTable } from "@/components/editor/extensions/table-markdown";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
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
import { AISuggestion, InlineDiff, CommentMark, GhostText, TagHighlight, TagSuggestion, MentionHighlight, MentionSuggestion, DateHighlight, DateSuggestion, SearchHighlight } from "@/components/editor/extensions";
import { PageBreaks } from "@/components/editor/extensions/page-breaks";
import { getMarkdownFromEditor } from "@/lib/markdown";

const lowlight = createLowlight(common);

interface UseEditorOptions {
  content: string;
  onUpdate?: (content: string) => void;
  editable?: boolean;
  /** Document directory for resolving relative image paths on initial load. */
  documentDir?: string;
}

export function useEditor({ content, onUpdate, editable = true, documentDir }: UseEditorOptions) {
  const editor = useTiptapEditor({
    onCreate: ({ editor }) => {
      // Set documentDir early so image nodes created during initial parse resolve correctly
      if (documentDir) {
        const imageStorage = (editor.storage as unknown as Record<string, Record<string, unknown> | undefined>).image;
        if (imageStorage) {
          imageStorage.documentDir = documentDir;
        }
      }
    },
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        heading: {
          levels: [1, 2, 3, 4, 5, 6],
        },
        link: {
          openOnClick: false,
          HTMLAttributes: {
            class: "text-primary underline cursor-pointer",
          },
        },
      }),
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
      LocalImage.configure({
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
      TableHeader.configure({
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
      Markdown.configure({
        html: true,
        transformPastedText: true,
        transformCopiedText: true,
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
    ],
    content,
    editable,
    editorProps: {
      attributes: {
        class: "prose prose-slate dark:prose-invert max-w-none focus:outline-none",
      },
    },
    onUpdate: ({ editor }) => {
      if (onUpdate) {
        const markdown = getMarkdownFromEditor(editor);
        onUpdate(markdown);
      }
    },
  });

  return editor;
}

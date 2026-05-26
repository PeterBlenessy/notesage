import { Suspense, lazy, useState, useCallback } from "react";
import { PlainTextViewer } from "./viewers/PlainTextViewer";
import { StatusBar } from "./StatusBar";
import { toast } from "sonner";
import { isHtmlViewerFile } from "@/lib/codemirror-languages";

// Lazy-load heavy viewers — their libraries (pdfjs-dist, docx-preview, foliate-js)
// are only fetched when the user actually opens that file type.
const ImageViewer = lazy(() => import("./viewers/ImageViewer").then(m => ({ default: m.ImageViewer })));
const PdfViewer = lazy(() => import("./viewers/PdfViewer").then(m => ({ default: m.PdfViewer })));
const DocxViewer = lazy(() => import("./viewers/DocxViewer").then(m => ({ default: m.DocxViewer })));
const EpubViewer = lazy(() => import("./viewers/EpubViewer").then(m => ({ default: m.EpubViewer })));
const PptxViewer = lazy(() => import("./viewers/PptxViewer").then(m => ({ default: m.PptxViewer })));

interface ViewerTab {
  id: string;
  filePath: string;
  fileName: string;
  fileType: string;
  content: string;
  isDirty: boolean;
}

interface EditorViewerContainerProps {
  activeTab: ViewerTab;
  focusMode: boolean;
  onOpenFile?: (path: string, name: string) => void;
  onShortcutsOpen?: () => void;
  onOpenActions?: () => void;
  /** Update tab content (for code file editing) */
  updateTabContent?: (tabId: string, content: string, isDirty: boolean) => void;
  /** Save file to disk (for code file editing) */
  saveFile?: (filePath: string, content: string, tabId: string) => Promise<boolean>;
  /**
   * Which StatusBar variant to mount below the viewer. The app
   * exclusively uses `"quiet"`; the `"full"` variant is retained as a
   * fallback. `"quiet"` renders the same minimal status strip viewers
   * (PDF, EPUB, DOCX, code, plain-text) share with the markdown editor.
   */
  statusBarVariant?: "full" | "quiet";
}

export function EditorViewerContainer({ activeTab, focusMode, onOpenFile, onShortcutsOpen, onOpenActions, updateTabContent, saveFile, statusBarVariant = "full" }: EditorViewerContainerProps) {
  const isHtml = isHtmlViewerFile(activeTab.fileName);
  const [htmlSourceMode, setHtmlSourceMode] = useState(false);
  const toggleHtmlSourceMode = useCallback(() => setHtmlSourceMode((v) => !v), []);

  let viewer: React.ReactNode = null;
  switch (activeTab.fileType) {
    case "image":
      viewer = <ImageViewer filePath={activeTab.filePath} />;
      break;
    case "pdf":
      viewer = <PdfViewer filePath={activeTab.filePath} fileName={activeTab.fileName} />;
      break;
    case "docx":
      viewer = (
        <DocxViewer
          filePath={activeTab.filePath}
          fileName={activeTab.fileName}
          onConvertToMarkdown={async (name) => {
            try {
              const { docxToMarkdown } = await import("@/lib/import-utils");
              const { getBinaryData } = await import("@/lib/binary-cache");
              const data = getBinaryData(activeTab.filePath);
              if (!data) { toast.error("No DOCX data available"); return; }
              const md = await docxToMarkdown(data);
              const mdName = name.replace(/\.docx$/i, ".md");
              const dir = activeTab.filePath.slice(0, activeTab.filePath.lastIndexOf("/"));
              const mdPath = `${dir}/${mdName}`;
              const { tauriApi } = await import("@/lib/tauri");
              await tauriApi.writeFile(mdPath, md);
              onOpenFile?.(mdPath, mdName);
              toast.success(`Saved ${mdName}`);
            } catch (err) {
              toast.error(`Import failed: ${err}`);
            }
          }}
        />
      );
      break;
    case "epub":
      viewer = <EpubViewer filePath={activeTab.filePath} fileName={activeTab.fileName} />;
      break;
    case "pptx":
      viewer = <PptxViewer filePath={activeTab.filePath} fileName={activeTab.fileName} />;
      break;
    case "other":
      viewer = (
        <PlainTextViewer
          content={activeTab.content}
          fileName={activeTab.fileName}
          filePath={activeTab.filePath}
          tabId={activeTab.id}
          isDirty={activeTab.isDirty}
          updateTabContent={
            updateTabContent
              ? (content: string) => updateTabContent(activeTab.id, content, true)
              : undefined
          }
          saveFileWithContent={
            saveFile
              ? (content: string) => { saveFile(activeTab.filePath, content, activeTab.id); }
              : undefined
          }
          sourceMode={isHtml ? htmlSourceMode : undefined}
          onToggleSourceMode={isHtml ? toggleHtmlSourceMode : undefined}
        />
      );
      break;
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 overflow-hidden">
        <Suspense fallback={<div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading viewer...</div>}>
          {viewer}
        </Suspense>
      </div>
      {!focusMode && (
        <StatusBar
          editor={null}
          variant={statusBarVariant}
          onShortcutsOpen={onShortcutsOpen}
          onOpenActions={onOpenActions}
          viewMode={isHtml ? (htmlSourceMode ? "source" : "wysiwyg") : undefined}
          onToggleViewMode={isHtml ? toggleHtmlSourceMode : undefined}
        />
      )}
    </div>
  );
}

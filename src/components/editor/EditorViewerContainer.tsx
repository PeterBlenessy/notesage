import { Suspense, lazy } from "react";
import { PlainTextViewer } from "./viewers/PlainTextViewer";
import { StatusBar } from "./StatusBar";
import { toast } from "sonner";

// Lazy-load heavy viewers — their libraries (pdfjs-dist, docx-preview, foliate-js)
// are only fetched when the user actually opens that file type.
const ImageViewer = lazy(() => import("./viewers/ImageViewer").then(m => ({ default: m.ImageViewer })));
const PdfViewer = lazy(() => import("./viewers/PdfViewer").then(m => ({ default: m.PdfViewer })));
const DocxViewer = lazy(() => import("./viewers/DocxViewer").then(m => ({ default: m.DocxViewer })));
const EpubViewer = lazy(() => import("./viewers/EpubViewer").then(m => ({ default: m.EpubViewer })));
const PptxViewer = lazy(() => import("./viewers/PptxViewer").then(m => ({ default: m.PptxViewer })));

interface ViewerTab {
  filePath: string;
  fileName: string;
  fileType: string;
  content: string;
}

interface EditorViewerContainerProps {
  activeTab: ViewerTab;
  focusMode: boolean;
  onOpenFile?: (path: string, name: string) => void;
  onShortcutsOpen?: () => void;
  onOpenActions?: () => void;
}

export function EditorViewerContainer({ activeTab, focusMode, onOpenFile, onShortcutsOpen, onOpenActions }: EditorViewerContainerProps) {
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
      viewer = <PlainTextViewer content={activeTab.content} fileName={activeTab.fileName} />;
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
          onShortcutsOpen={onShortcutsOpen}
          onOpenActions={onOpenActions}
        />
      )}
    </div>
  );
}

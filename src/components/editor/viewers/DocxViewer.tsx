import { useEffect, useState } from "react";
import { FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getBinaryData } from "@/lib/binary-cache";
import mammoth from "mammoth";

interface DocxViewerProps {
  filePath: string;
  fileName: string;
  onConvertToMarkdown?: (html: string, fileName: string) => void;
}

export function DocxViewer({ filePath, fileName, onConvertToMarkdown }: DocxViewerProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const data = getBinaryData(filePath);
    if (!data) {
      setError("No DOCX data available");
      return;
    }

    mammoth
      .convertToHtml({ arrayBuffer: data.buffer })
      .then((result) => {
        setHtml(result.value);
        if (result.messages.length > 0) {
          console.warn("mammoth warnings:", result.messages);
        }
      })
      .catch((err) => {
        setError(`Failed to render DOCX: ${err.message}`);
      });
  }, [filePath]);

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 text-muted-foreground">
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  if (html === null) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 text-muted-foreground">
        <p className="text-sm">Loading document...</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="h-9 border-b border-border px-3 flex items-center gap-2 shrink-0 bg-background">
        <span className="text-xs text-muted-foreground truncate max-w-[200px]">
          {fileName}
        </span>
        <span className="flex-1" />
        {onConvertToMarkdown && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
            onClick={() => onConvertToMarkdown(html, fileName)}
          >
            <FileDown className="h-3 w-3" strokeWidth={1.5} />
            Convert to Markdown
          </Button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-[720px] mx-auto py-10 px-8">
          <div
            className="docx-content prose prose-slate dark:prose-invert max-w-none text-sm leading-relaxed"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { FileDown, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useSettingsStore,
  type ExportTemplate,
  type ExportPageSize,
} from "@/stores/settings-store";
import { cn } from "@/lib/utils";

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExport: (options: ExportOptions) => void;
  isExporting: boolean;
}

export interface ExportOptions {
  template: ExportTemplate;
  includeToc: boolean;
  includePageNumbers: boolean;
  pageSize: ExportPageSize;
}

const TEMPLATES: {
  id: ExportTemplate;
  label: string;
  description: string;
  defaultToc: boolean;
  defaultPageNumbers: boolean;
}[] = [
  {
    id: "clean",
    label: "Clean",
    description: "Minimal, generous whitespace",
    defaultToc: false,
    defaultPageNumbers: false,
  },
  {
    id: "academic",
    label: "Academic",
    description: "Serif, numbered headings",
    defaultToc: true,
    defaultPageNumbers: true,
  },
  {
    id: "report",
    label: "Report",
    description: "Title page, header/footer",
    defaultToc: true,
    defaultPageNumbers: true,
  },
];

export function ExportDialog({
  open,
  onOpenChange,
  onExport,
  isExporting,
}: ExportDialogProps) {
  const {
    lastExportTemplate,
    lastExportPageSize,
    lastExportIncludeToC,
    lastExportIncludePageNumbers,
  } = useSettingsStore();

  const [template, setTemplate] = useState<ExportTemplate>(lastExportTemplate);
  const [includeToc, setIncludeToc] = useState(lastExportIncludeToC);
  const [includePageNumbers, setIncludePageNumbers] = useState(
    lastExportIncludePageNumbers
  );
  const [pageSize, setPageSize] = useState<ExportPageSize>(lastExportPageSize);

  // Reset to last-used settings when dialog opens
  useEffect(() => {
    if (open) {
      setTemplate(lastExportTemplate);
      setIncludeToc(lastExportIncludeToC);
      setIncludePageNumbers(lastExportIncludePageNumbers);
      setPageSize(lastExportPageSize);
    }
  }, [
    open,
    lastExportTemplate,
    lastExportPageSize,
    lastExportIncludeToC,
    lastExportIncludePageNumbers,
  ]);

  const handleTemplateChange = (id: ExportTemplate) => {
    setTemplate(id);
    // Apply template defaults when switching
    const tmpl = TEMPLATES.find((t) => t.id === id);
    if (tmpl) {
      setIncludeToc(tmpl.defaultToc);
      setIncludePageNumbers(tmpl.defaultPageNumbers);
    }
  };

  const handleExport = () => {
    onExport({ template, includeToc, includePageNumbers, pageSize });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileDown className="h-4 w-4" strokeWidth={1.5} />
            Export as PDF
          </DialogTitle>
          <DialogDescription className="sr-only">Configure PDF export options</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Template selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Style</label>
            <div className="grid grid-cols-3 gap-2">
              {TEMPLATES.map((tmpl) => (
                <button
                  key={tmpl.id}
                  onClick={() => handleTemplateChange(tmpl.id)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-md border p-3 text-center transition-colors",
                    template === tmpl.id
                      ? "border-foreground/30 bg-accent"
                      : "border-border hover:bg-accent/50"
                  )}
                >
                  <span className="text-sm font-medium">{tmpl.label}</span>
                  <span className="text-[11px] leading-tight text-muted-foreground">
                    {tmpl.description}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Options */}
          <div className="space-y-3">
            <label
              className="flex cursor-pointer items-center gap-2.5"
              htmlFor="export-toc"
            >
              <Checkbox
                id="export-toc"
                checked={includeToc}
                onCheckedChange={(checked) =>
                  setIncludeToc(checked === true)
                }
              />
              <span className="text-sm">Include table of contents</span>
            </label>

            <label
              className="flex cursor-pointer items-center gap-2.5"
              htmlFor="export-page-numbers"
            >
              <Checkbox
                id="export-page-numbers"
                checked={includePageNumbers}
                onCheckedChange={(checked) =>
                  setIncludePageNumbers(checked === true)
                }
              />
              <span className="text-sm">Include page numbers</span>
            </label>
          </div>

          {/* Page size */}
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Page size</label>
            <Select
              value={pageSize}
              onValueChange={(v) => setPageSize(v as ExportPageSize)}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="a4">A4</SelectItem>
                <SelectItem value="letter">Letter</SelectItem>
                <SelectItem value="a5">A5</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleExport} disabled={isExporting}>
            {isExporting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Exporting...
              </>
            ) : (
              "Export PDF"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useState } from "react";
import { FileDown, Loader2, Plus } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  type ExportPageSize,
  type ExportFormat,
  type PptxTemplate,
} from "@/stores/settings-store";
import { tauriApi, type PptxTemplateInfo } from "@/lib/tauri";
import { cn } from "@/lib/utils";

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExport: (options: ExportOptions) => void;
  isExporting: boolean;
}

export interface ExportOptions {
  format: ExportFormat;
  /** @deprecated PDF/DOCX always use "clean". Only meaningful for PPTX via pptxTemplate. */
  template: "clean";
  includeToc: boolean;
  includePageNumbers: boolean;
  pageSize: ExportPageSize;
  pptxTemplate: string;
}

const PPTX_TEMPLATES: {
  id: PptxTemplate;
  label: string;
  description: string;
}[] = [
  {
    id: "simple",
    label: "Simple",
    description: "Clean, minimal slides",
  },
  {
    id: "business",
    label: "Business",
    description: "Professional layout",
  },
  {
    id: "report",
    label: "Report",
    description: "Detailed, structured",
  },
];

export function ExportDialog({
  open: isOpen,
  onOpenChange,
  onExport,
  isExporting,
}: ExportDialogProps) {
  const {
    lastExportPageSize,
    lastExportIncludeToC,
    lastExportIncludePageNumbers,
    lastExportFormat,
    lastPptxTemplate,
  } = useSettingsStore();

  const [format, setFormat] = useState<ExportFormat>(lastExportFormat);
  const [includeToc, setIncludeToc] = useState(lastExportIncludeToC);
  const [includePageNumbers, setIncludePageNumbers] = useState(
    lastExportIncludePageNumbers
  );
  const [pageSize, setPageSize] = useState<ExportPageSize>(lastExportPageSize);
  const [pptxTemplate, setPptxTemplate] = useState<string>(lastPptxTemplate);
  const [userTemplates, setUserTemplates] = useState<PptxTemplateInfo[]>([]);
  const [pendingDeleteTemplate, setPendingDeleteTemplate] =
    useState<PptxTemplateInfo | null>(null);

  // Reset to last-used settings when dialog opens
  useEffect(() => {
    if (isOpen) {
      setFormat(lastExportFormat);
      setIncludeToc(lastExportIncludeToC);
      setIncludePageNumbers(lastExportIncludePageNumbers);
      setPageSize(lastExportPageSize);
      setPptxTemplate(lastPptxTemplate);
    }
  }, [
    isOpen,
    lastExportFormat,
    lastExportPageSize,
    lastExportIncludeToC,
    lastExportIncludePageNumbers,
    lastPptxTemplate,
  ]);

  // Load user PPTX templates when dialog opens
  useEffect(() => {
    if (isOpen) {
      tauriApi
        .listPptxTemplates()
        .then((templates) => {
          setUserTemplates(templates.filter((t) => t.scope !== "builtin"));
        })
        .catch(() => {
          // Backend command may not exist yet — silently ignore
        });
    }
  }, [isOpen]);

  const handleExport = () => {
    onExport({
      format,
      template: "clean",
      includeToc,
      includePageNumbers,
      pageSize,
      pptxTemplate,
    });
  };

  const handleImportTemplate = async () => {
    try {
      const selected = await open({
        title: "Import PPTX Template",
        filters: [{ name: "PowerPoint", extensions: ["pptx", "potx"] }],
      });
      if (selected) {
        const info = await tauriApi.importPptxTemplate({
          sourcePath: selected as string,
          scope: "global",
        });
        setUserTemplates((prev) => [...prev, info]);
        setPptxTemplate(info.id);
        toast.success(`Template "${info.name}" imported`);
      }
    } catch (err) {
      toast.error(`Failed to import template: ${err}`);
    }
  };

  const handleConfirmDeleteTemplate = async () => {
    if (pendingDeleteTemplate) {
      await handleDeleteTemplate(pendingDeleteTemplate);
      setPendingDeleteTemplate(null);
    }
  };

  const handleDeleteTemplate = async (tmpl: PptxTemplateInfo) => {
    try {
      await tauriApi.deletePptxTemplate({
        templateId: tmpl.id,
        scope: tmpl.scope,
      });
      setUserTemplates((prev) => prev.filter((t) => t.id !== tmpl.id));
      if (pptxTemplate === tmpl.id) setPptxTemplate("simple");
      toast.success("Template removed");
    } catch (err) {
      toast.error(`Failed to remove template: ${err}`);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileDown className="h-4 w-4" strokeWidth={1.5} />
            Export
          </DialogTitle>
          <DialogDescription className="sr-only">
            Configure export options
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Format selector */}
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Format</label>
            <Select
              value={format}
              onValueChange={(v) => setFormat(v as ExportFormat)}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pdf">PDF</SelectItem>
                <SelectItem value="docx">Word (.docx)</SelectItem>
                <SelectItem value="pptx">PowerPoint</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {(format === "pdf" || format === "docx") && (
            <>
              {/* Document options */}
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
            </>
          )}

          {format === "pptx" && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Style</label>

              {/* Built-in PPTX templates */}
              <div className="grid grid-cols-3 gap-2">
                {PPTX_TEMPLATES.map((tmpl) => (
                  <button
                    key={tmpl.id}
                    onClick={() => setPptxTemplate(tmpl.id)}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-md border p-3 text-center transition-colors",
                      pptxTemplate === tmpl.id
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

              {/* User templates */}
              {userTemplates.length > 0 && (
                <>
                  <div className="flex items-center gap-2 pt-2">
                    <div className="h-px flex-1 bg-border" />
                    <span className="text-xs text-muted-foreground">
                      Custom
                    </span>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {userTemplates.map((tmpl) => (
                      <div key={tmpl.id} className="relative group">
                        <button
                          onClick={() => setPptxTemplate(tmpl.id)}
                          className={cn(
                            "flex w-full flex-col items-center gap-1 rounded-md border p-3 text-center transition-colors",
                            pptxTemplate === tmpl.id
                              ? "border-foreground/30 bg-accent"
                              : "border-border hover:bg-accent/50"
                          )}
                        >
                          <span className="text-sm font-medium truncate w-full">
                            {tmpl.name}
                          </span>
                          <span className="text-[11px] leading-tight text-muted-foreground">
                            {tmpl.scope === "project" ? "Project" : "Global"}
                          </span>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setPendingDeleteTemplate(tmpl);
                          }}
                          className="absolute -top-1.5 -right-1.5 hidden group-hover:flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground text-xs transition-opacity"
                        >
                          &times;
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Add Template button */}
              <Button
                variant="outline"
                size="sm"
                className="w-full mt-2"
                onClick={handleImportTemplate}
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} />
                Add Template
              </Button>
            </div>
          )}
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
            ) : format === "pdf" ? (
              "Export PDF"
            ) : format === "docx" ? (
              "Export DOCX"
            ) : (
              "Export PPTX"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>

      <AlertDialog
        open={pendingDeleteTemplate !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteTemplate(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove template?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove &ldquo;{pendingDeleteTemplate?.name}&rdquo;? This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDeleteTemplate}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

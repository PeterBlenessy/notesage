import type { LocalModelInfo } from '@/lib/tauri';
import type { ModelMetadata, ModelFitResult, GgufCapabilities } from '@/lib/tauri';
import { ModelMetadataTooltip } from './ModelMetadataTooltip';
import { fitSummary } from '@/lib/ai/model-fit';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Download, Trash2, X, Star } from 'lucide-react';

function formatBytes(bytes: number): string {
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(0)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

/**
 * A capability chip. `verified` chips (read from the GGUF header) use the
 * solid `bg-muted` treatment; unverified-fallback chips (catalog flag, header
 * not read yet / read failed) dim to `opacity-60` and carry a "unverified"
 * title so the distinction is legible without adding chrome colour.
 */
function CapabilityBadge({
  label,
  verified = true,
}: {
  label: string;
  verified?: boolean;
}) {
  return (
    <span
      title={verified ? undefined : 'Unverified — from catalog metadata, not the model header'}
      className={`text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground ${
        verified ? '' : 'opacity-60 border border-dotted border-border-strong'
      }`}
    >
      {label}
    </span>
  );
}

interface ModelCardProps {
  model: LocalModelInfo;
  isActive: boolean;
  isRecommendedDefault: boolean;
  download: { progress: number } | undefined;
  metadata: ModelMetadata | null | undefined;
  fit?: ModelFitResult;
  caps?: GgufCapabilities;
  capsLoading?: boolean;
  onSetActive: () => void;
  onDownload: () => void;
  onCancelDownload: () => void;
  onDelete: () => void;
  onRemoveCustom: () => void;
  onHide: () => void;
}

export function ModelCard({
  model,
  isActive,
  isRecommendedDefault,
  download,
  metadata,
  fit,
  caps,
  capsLoading,
  onSetActive,
  onDownload,
  onCancelDownload,
  onDelete,
  onRemoveCustom,
  onHide,
}: ModelCardProps) {
  const verdict = fitSummary(fit);
  // Disable only undownloaded models that the engine says won't run.
  const blocked = !model.downloaded && fit != null && !fit.runnable;
  // Verified flags from the GGUF header (when present) supersede catalog flags.
  const toolsCap = caps ? caps.has_tool_template : model.supports_tool_calling;
  const thinkCap = caps ? caps.has_thinking : model.supports_thinking;
  const fimCap = caps ? caps.has_fim_tokens : model.supports_fim;
  const capsVerified = caps != null;
  // While the hardware profile / capability read is still pending we show a
  // subtle "Checking…" line instead of a (possibly misleading) verdict.
  const checking = !fit && capsLoading;

  return (
    <ModelMetadataTooltip metadata={metadata} modelType="llm" side="left">
      <div
        className={`relative rounded-md border px-3 py-2.5 ${
          blocked ? 'opacity-60' : ''
        }`}
      >
        {/* Action buttons — top right */}
        <div className="absolute top-2 right-2 flex items-center gap-1">
          {download ? (
            <div className="flex items-center gap-2">
              <div className="w-16">
                <Progress value={download.progress} className="h-1.5" />
              </div>
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {Math.round(download.progress)}%
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={onCancelDownload}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Cancel download</TooltipContent>
              </Tooltip>
            </div>
          ) : model.downloaded ? (
            <>
              {!isActive && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-[11px] px-2"
                      onClick={onSetActive}
                    >
                      Use
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Set as active model</TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-destructive"
                    disabled={isActive}
                    onClick={onDelete}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {isActive ? 'Stop the model first' : 'Delete model file'}
                </TooltipContent>
              </Tooltip>
              {model.is_custom && !isActive && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      onClick={onRemoveCustom}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Remove custom model</TooltipContent>
                </Tooltip>
              )}
              {!model.is_custom && !isActive && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      onClick={onHide}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Hide from list</TooltipContent>
                </Tooltip>
              )}
            </>
          ) : (
            <div className="flex items-center gap-0.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-6 w-6"
                      disabled={blocked}
                      onClick={onDownload}
                    >
                      <Download className="h-3 w-3" />
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {blocked
                    ? fit?.reasons[0] ?? "Won't run on this Mac"
                    : 'Download model'}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-destructive"
                    onClick={onHide}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Hide from list</TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="pr-24">
          <div className="flex items-center gap-1.5 flex-wrap">
            {isRecommendedDefault && (
              <Star className="h-3 w-3 text-muted-foreground fill-muted-foreground" strokeWidth={1.5} />
            )}
            <span className="text-sm font-medium">{model.name}</span>
            <span className="text-[10px] text-muted-foreground/50">
              {model.size_bytes > 0 && formatBytes(model.size_bytes + (model.mmproj_size_bytes ?? 0))}
              {model.size_bytes > 0 && model.ram_required_bytes > 0 && ' · '}
              {model.ram_required_bytes > 0 && `~${formatBytes(model.ram_required_bytes)} RAM`}
            </span>
            {isActive && model.downloaded && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                Active
              </span>
            )}
            {model.is_custom && (
              <CapabilityBadge label="Custom" />
            )}
          </div>
          {/* Hardware-fit verdict line — sits just under the size line. */}
          {checking ? (
            <div className="mt-0.5 text-[10px] tabular-nums text-muted-foreground/60">
              Checking…
            </div>
          ) : verdict ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    {verdict}
                  </span>
                  {blocked && (
                    <span
                      className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-destructive/10 text-destructive"
                    >
                      {fit?.reasons[0] ?? "Won't run"}
                    </span>
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[260px]">
                <p className="text-xs">
                  Estimated before download — sharpens once the model runs.
                </p>
                {blocked && fit && fit.reasons.length > 0 && (
                  <ul className="mt-1 text-[11px] text-muted-foreground list-disc pl-3.5 space-y-0.5">
                    {fit.reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                )}
              </TooltipContent>
            </Tooltip>
          ) : null}
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
            {model.description}
          </p>
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            {toolsCap && <CapabilityBadge label="Tools" verified={capsVerified} />}
            {thinkCap && <CapabilityBadge label="Think" verified={capsVerified} />}
            {fimCap && <CapabilityBadge label="FIM" verified={capsVerified} />}
            {model.supports_vision && <CapabilityBadge label="Vision" />}
            {model.multilingual && <CapabilityBadge label="Multi" />}
          </div>
        </div>
      </div>
    </ModelMetadataTooltip>
  );
}

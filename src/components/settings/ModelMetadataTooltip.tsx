import { ExternalLink } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ModelMetadata } from '@/lib/tauri';
import { getFormatLocale, t } from "@/lib/i18n";
import { useFormatLocale } from "@/lib/useLocale";

interface ModelMetadataTooltipProps {
  metadata?: ModelMetadata | null;
  modelType: 'llm' | 'whisper';
  side?: 'top' | 'right' | 'bottom' | 'left';
  children: React.ReactNode;
}

function formatContextLength(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M tokens`;
  if (n >= 1_000) return `${(n / 1_000).toLocaleString(getFormatLocale())}K tokens`;
  return `${n} tokens`;
}

function formatLicense(license: string): string {
  const map: Record<string, string> = {
    'apache-2.0': 'Apache 2.0',
    'mit': 'MIT',
    'llama3.1': 'Llama 3.1',
    'llama3': 'Llama 3',
    'gemma': 'Gemma',
    'cc-by-4.0': 'CC BY 4.0',
    'cc-by-nc-4.0': 'CC BY-NC 4.0',
  };
  return map[license.toLowerCase()] ?? license;
}

function openUrl(url: string) {
  // Use Tauri opener to open in default browser
  import('@tauri-apps/plugin-opener').then(({ openUrl }) => {
    openUrl(url);
  });
}

export function ModelMetadataTooltip({
  metadata,
  modelType,
  side = 'right',
  children,
}: ModelMetadataTooltipProps) {
  // Subscribe to language changes — the date/number helpers used below read
  // the i18n module directly, so without this their output would keep the
  // previous locale until an unrelated re-render.
  useFormatLocale();
  if (!metadata) {
    return <>{children}</>;
  }

  const hasAnyData = metadata.author || metadata.parameters || metadata.architecture ||
    metadata.context_length || metadata.quantization || metadata.license;

  if (!hasAnyData) {
    return <>{children}</>;
  }

  const authorLine = [metadata.author, metadata.organization]
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i) // deduplicate
    .join(' · ');

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {children}
      </TooltipTrigger>
      <TooltipContent
        side={side}
        className="w-[220px] p-3"
      >
        <div className="space-y-2">
          {/* Header */}
          {authorLine && (
            <p className="text-xs text-muted-foreground">by {authorLine}</p>
          )}

          {/* Details grid */}
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            {metadata.parameters && (
              <>
                <span className="text-muted-foreground">{t("model.parameters")}</span>
                <span>{metadata.parameters}</span>
              </>
            )}

            {metadata.context_length && (
              <>
                <span className="text-muted-foreground">{t("model.contextLabel")}</span>
                <span>{formatContextLength(metadata.context_length)}</span>
              </>
            )}

            {modelType === 'llm' && metadata.quantization && (
              <>
                <span className="text-muted-foreground">{t("model.quantization")}</span>
                <span>{metadata.quantization}</span>
              </>
            )}

            {modelType === 'whisper' && metadata.languages && (
              <>
                <span className="text-muted-foreground">{t("model.languages")}</span>
                <span>{metadata.languages.length} supported</span>
              </>
            )}

            {metadata.license && (
              <>
                <span className="text-muted-foreground">{t("model.license")}</span>
                <span>{formatLicense(metadata.license)}</span>
              </>
            )}
          </div>

          {/* HF link */}
          {metadata.hf_repo_url && (
            <button
              className="flex items-center gap-1 text-xs opacity-70 hover:opacity-100 transition-opacity mt-1"
              onClick={(e) => {
                e.stopPropagation();
                openUrl(metadata.hf_repo_url!);
              }}
            >
              <ExternalLink className="h-3 w-3" strokeWidth={1.5} />
              View on Hugging Face
            </button>
          )}

        </div>
      </TooltipContent>
    </Tooltip>
  );
}

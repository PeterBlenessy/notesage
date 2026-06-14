import { openUrl } from '@tauri-apps/plugin-opener';
import { cn } from '@/lib/utils';

/** Canonical Goose project link — single source of truth for the attribution.
 *  Goose was created by Block and donated to the Agentic AI Foundation (AAIF, a
 *  Linux Foundation project); the repo moved from block/goose to aaif-goose. */
export const GOOSE_REPO_URL = 'https://github.com/aaif-goose/goose';

/**
 * Shared attribution for the Local Agent preset. We are deliberately open that
 * the Local Agent is powered by Goose — the Agentic AI Foundation's open-source
 * ACP agent — so the credit (and a link to its repo) is surfaced everywhere the
 * preset appears: the setup dialog, the connection card, and the connection
 * config dialog. Keeping it in one component stops the wording/link from
 * drifting per surface.
 */
export function GooseAttribution({
  className,
  compact,
}: {
  className?: string;
  /** Compact "Powered by Goose" line for tight surfaces (e.g. the connection card). */
  compact?: boolean;
}) {
  const link = (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        openUrl(GOOSE_REPO_URL).catch(() => {});
      }}
      className="underline underline-offset-2 hover:text-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm"
    >
      Goose
    </button>
  );

  if (compact) {
    return (
      <p className={cn('text-xs text-muted-foreground', className)}>
        Powered by {link}, an open-source agent from the Agentic AI Foundation (AAIF)
      </p>
    );
  }

  return (
    <p className={cn('text-xs text-muted-foreground leading-relaxed', className)}>
      The Local Agent is powered by {link}, an open-source agent from the
      Agentic AI Foundation (AAIF). It runs on your device against the bundled
      local model — no cloud account or API key.
    </p>
  );
}

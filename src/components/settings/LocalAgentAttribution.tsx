import { openUrl } from '@tauri-apps/plugin-opener';
import { cn } from '@/lib/utils';
import { GooseAttribution } from './GooseAttribution';

/** Canonical pi project link — single source of truth for the attribution. */
export const PI_REPO_URL = 'https://github.com/earendil-works/pi';

export type LocalAgentEngine = 'goose' | 'pi';

/**
 * Engine-aware attribution for the Local Agent preset. Delegates to the
 * existing `GooseAttribution` for Goose and renders the parallel credit for pi
 * (Mario Zechner / earendil-works). Kept in one place so the wording/link can't
 * drift per surface (setup dialog, connection card, config dialog).
 */
export function LocalAgentAttribution({
  engine,
  className,
  compact,
}: {
  engine: LocalAgentEngine;
  className?: string;
  compact?: boolean;
}) {
  if (engine === 'goose') {
    return <GooseAttribution className={className} compact={compact} />;
  }

  const link = (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        openUrl(PI_REPO_URL).catch(() => {});
      }}
      className="underline underline-offset-2 hover:text-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm"
    >
      pi
    </button>
  );

  if (compact) {
    return (
      <p className={cn('text-xs text-muted-foreground', className)}>
        Powered by {link}, an open-source agent by Mario Zechner
      </p>
    );
  }

  return (
    <p className={cn('text-xs text-muted-foreground leading-relaxed', className)}>
      This Local Agent is powered by {link}, an open-source agent by Mario
      Zechner (earendil-works). It runs on your device against the bundled local
      model — no cloud account or API key.
    </p>
  );
}

import * as React from 'react';
import { Info, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SettingsHintTone = 'info' | 'warning';

export interface SettingsHintProps {
  /**
   * Visual tone. `info` (default) is a soft neutral block; `warning`
   * uses the destructive surface for setup problems the user must
   * resolve (e.g. "Git is not installed").
   */
  tone?: SettingsHintTone;
  /**
   * Optional icon override. Defaults to `Info` / `AlertTriangle` based
   * on `tone`. Pass any Lucide-shaped icon component.
   */
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  /**
   * Optional bold first line — useful when the hint has both a one-line
   * summary and a longer explanation. When omitted, all `children`
   * render at the body weight.
   */
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

/**
 * Inline informational block for settings panels.
 *
 * Replaces several hand-styled "info card" treatments that had drifted
 * apart — the Git-not-installed alert, the Network Sandbox placeholder
 * row, the per-connection sandbox hint. Sits inside `SettingsGroup` or
 * standalone; sized to match `SettingsRow`'s vertical rhythm.
 */
export function SettingsHint({
  tone = 'info',
  icon,
  title,
  children,
  className,
}: SettingsHintProps) {
  const Icon = icon ?? (tone === 'warning' ? AlertTriangle : Info);
  return (
    <div
      className={cn(
        'flex gap-2.5 px-3 py-3 rounded-md',
        tone === 'warning'
          ? 'bg-destructive/10'
          : 'bg-muted/50',
        className,
      )}
    >
      <Icon
        className={cn(
          'h-4 w-4 shrink-0 mt-0.5',
          tone === 'warning' ? 'text-destructive' : 'text-muted-foreground',
        )}
        strokeWidth={1.5}
      />
      <div className="flex-1 min-w-0 space-y-1 text-[12px] text-muted-foreground leading-relaxed">
        {title ? (
          <p
            className={cn(
              'font-medium',
              tone === 'warning' ? 'text-destructive' : 'text-foreground',
            )}
          >
            {title}
          </p>
        ) : null}
        {children}
      </div>
    </div>
  );
}

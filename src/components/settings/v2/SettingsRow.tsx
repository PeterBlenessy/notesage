import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Props for the settings row primitive.
 *
 * One row = one setting. Label and optional description on the left,
 * right-aligned control on the right, optional sublabel below the control.
 * See Mockup E for the visual spec.
 */
export interface SettingsRowProps {
  /** Main row label (13 px, weight 500). */
  label: string;
  /** Optional description line (12 px, muted, max 460 px wide). */
  description?: React.ReactNode;
  /** Right-aligned control (switch, slider, select, button, etc.). */
  control?: React.ReactNode;
  /** Optional sublabel appearing below the control (e.g. "50 chars"). */
  controlSublabel?: React.ReactNode;
  /** htmlFor-style id associated with the label + control for accessibility. */
  htmlFor?: string;
  className?: string;
}

/**
 * A single row in a `SettingsGroup`. Renders label + optional description on
 * the left, right-aligned control on the right. Rows sit inside a group, and
 * the group container paints the 1 px hairline dividers between them via
 * `divide-y` — no border styles are applied here.
 *
 * If `htmlFor` is supplied, the label becomes a real `<label>` bound to a
 * control for assistive tech.
 */
export function SettingsRow({
  label,
  description,
  control,
  controlSublabel,
  htmlFor,
  className,
}: SettingsRowProps) {
  const labelNode = htmlFor ? (
    <label
      htmlFor={htmlFor}
      className="text-[13px] font-medium text-foreground cursor-pointer"
    >
      {label}
    </label>
  ) : (
    <span className="text-[13px] font-medium text-foreground">{label}</span>
  );

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4 px-4 py-3 min-h-[52px]',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        {labelNode}
        {description ? (
          <p className="text-[12px] text-muted-foreground mt-0.5 max-w-[460px] leading-relaxed">
            {description}
          </p>
        ) : null}
      </div>
      {control !== undefined || controlSublabel !== undefined ? (
        <div className="shrink-0 flex flex-col items-end gap-1">
          {control}
          {controlSublabel ? (
            <span className="text-[11px] text-muted-foreground">
              {controlSublabel}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

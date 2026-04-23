import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Props for the settings group primitive.
 *
 * A group is a set of related rows rendered inside a bordered, hairline-
 * divided container with an optional small uppercase label above. Multiple
 * groups stack vertically with ~40 px gap between them.
 * See Mockup E for the visual spec.
 */
export interface SettingsGroupProps {
  /** Short label shown above the group. The component formats it as uppercase. */
  label?: string;
  /** Optional description line below the group label. */
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/**
 * A bordered container that stacks `SettingsRow` children with 1 px hairline
 * dividers between them (`divide-y`). Groups add a 40 px bottom margin so
 * consumers can drop multiple groups in sequence without extra spacing.
 */
export function SettingsGroup({
  label,
  description,
  children,
  className,
}: SettingsGroupProps) {
  return (
    <section className={cn('mb-10 last:mb-0', className)}>
      {label ? (
        <h3 className="text-[10.5px] font-medium tracking-wider uppercase text-muted-foreground mb-3">
          {label}
        </h3>
      ) : null}
      {description ? (
        <p className="text-[12px] text-muted-foreground mb-3 max-w-[460px] leading-relaxed">
          {description}
        </p>
      ) : null}
      <div className="divide-y divide-border rounded-md border border-border bg-background">
        {children}
      </div>
    </section>
  );
}

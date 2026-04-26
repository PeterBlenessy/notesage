import * as React from 'react';
import { cn } from '@/lib/utils';
import { rowMatchesQuery, SettingsRow, type SettingsRowProps } from './SettingsRow';
import { useSettingsSearchQuery } from './SettingsSearch';

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
  /**
   * When true, the rows render naked (no tinted island, no horizontal
   * inset) — useful when the group wraps a legacy component that already
   * owns its own chrome (table, bordered cards) and would otherwise
   * double-up with the island styling.
   */
  bare?: boolean;
  children: React.ReactNode;
  className?: string;
}

/**
 * Walk `SettingsRow` children and return `true` when at least one row matches
 * `query`. Non-`SettingsRow` children (raw JSX, conditionals returning null,
 * etc.) are ignored — they're treated as decorative and don't keep the group
 * visible on their own.
 *
 * This sits next to the row-level filter in `SettingsRow.rowMatchesQuery`
 * (live-test 2026-04-25 #147) so the empty-group case never renders an
 * empty bordered box when the user's query filters out every row.
 */
export function groupHasVisibleRows(
  children: React.ReactNode,
  query: string,
): boolean {
  if (!query) return true;
  let anyVisibleRow = false;
  let hasAnyRow = false;
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type !== SettingsRow) return;
    hasAnyRow = true;
    if (rowMatchesQuery(child.props as SettingsRowProps, query)) {
      anyVisibleRow = true;
    }
  });
  // If the group has no SettingsRow children at all (e.g. a custom panel
  // that only ships JSX), let the parent decide visibility — render so we
  // don't hide non-row content unintentionally.
  if (!hasAnyRow) return true;
  return anyVisibleRow;
}

/**
 * A bordered container that stacks `SettingsRow` children with 1 px hairline
 * dividers between them (`divide-y`). Groups add a 40 px bottom margin so
 * consumers can drop multiple groups in sequence without extra spacing.
 */
export function SettingsGroup({
  label,
  description,
  bare = false,
  children,
  className,
}: SettingsGroupProps) {
  const query = useSettingsSearchQuery();
  if (!groupHasVisibleRows(children, query)) return null;

  return (
    // Live-test 2026-04-26 — tinted-island grouping. Rows now sit on a
    // soft `bg-muted/40` surface with `rounded-xl` corners (no border)
    // so the eye reads each group as a discrete island under its
    // label. Inter-group gap dropped from `mb-8` (32 px) to `mb-6`
    // (24 px) since the tint is now doing the heavy lifting for
    // visual separation. The `bare` opt-out renders rows flat for
    // groups whose inner component already owns its own chrome
    // (legacy tables, bordered card lists).
    <section className={cn('mb-6 last:mb-0', className)}>
      {label ? (
        <h3 className="text-[11px] font-semibold tracking-wider uppercase text-foreground mb-1">
          {label}
        </h3>
      ) : null}
      {description ? (
        <p className="text-[12px] text-muted-foreground mb-2 max-w-[460px] leading-relaxed">
          {description}
        </p>
      ) : null}
      <div
        className={cn(
          'divide-y divide-border/60',
          !bare && 'rounded-xl bg-muted/40 px-4',
        )}
      >
        {children}
      </div>
    </section>
  );
}

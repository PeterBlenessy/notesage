import * as React from 'react';
import { cn } from '@/lib/utils';
import {
  matchesSettingsQuery,
  useSettingsSearchQuery,
} from './SettingsSearch';

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
 *
 * Accessibility:
 *   When both a `description` and a `control` (as a single React element) are
 *   provided, the control is automatically wired with `aria-describedby`
 *   pointing to the description paragraph. Existing `aria-describedby` values
 *   on the control are preserved (the description id is appended). Pass the
 *   control as a non-element node (string, fragment, etc.) to opt out.
 */
/**
 * True when this row's label, description, or controlSublabel contains the
 * query. Used by `SettingsRow` itself to self-filter, and by `SettingsGroup`
 * to decide whether the wrapping group has any visible rows left.
 *
 * `description` and `controlSublabel` are matched only when their value is a
 * plain string — JSX descriptions are common for inline links / icons and
 * we don't try to walk arbitrary React trees. The label is always a string.
 */
export function rowMatchesQuery(
  props: Pick<SettingsRowProps, 'label' | 'description' | 'controlSublabel'>,
  query: string,
): boolean {
  if (!query) return true;
  if (matchesSettingsQuery(props.label, query)) return true;
  if (
    typeof props.description === 'string' &&
    matchesSettingsQuery(props.description, query)
  ) {
    return true;
  }
  if (
    typeof props.controlSublabel === 'string' &&
    matchesSettingsQuery(props.controlSublabel, query)
  ) {
    return true;
  }
  return false;
}

export function SettingsRow({
  label,
  description,
  control,
  controlSublabel,
  htmlFor,
  className,
}: SettingsRowProps) {
  const reactId = React.useId();
  const descriptionId = description ? `${htmlFor ?? reactId}-desc` : undefined;
  // Live-test 2026-04-25 #147 — when the user types into the Settings ⌘F
  // search the dialog narrows the nav but rows inside the active panel
  // stayed put, making the filter feel broken. Each row now self-hides
  // when the query doesn't match its label / description / sublabel.
  // SettingsGroup hides the wrapper when every child row has filtered
  // out, so we don't show empty bordered boxes.
  const query = useSettingsSearchQuery();
  if (!rowMatchesQuery({ label, description, controlSublabel }, query)) {
    return null;
  }

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

  // When we have both a description and a single-element control, inject
  // aria-describedby so assistive tech reads the description alongside the
  // control. Multiple-element / primitive controls are rendered as-is.
  let controlNode: React.ReactNode = control;
  if (descriptionId && React.isValidElement(control)) {
    const existing = (control.props as { 'aria-describedby'?: string })[
      'aria-describedby'
    ];
    const merged = existing
      ? `${existing} ${descriptionId}`
      : descriptionId;
    controlNode = React.cloneElement(
      control as React.ReactElement<{ 'aria-describedby'?: string }>,
      { 'aria-describedby': merged },
    );
  }

  const hasControl = controlNode !== undefined;
  const hasSublabel = controlSublabel !== undefined;

  return (
    // Live-test 2026-04-26 — stacked layout (macOS System Settings
    // pattern). Title + control sit on row 1; description flows
    // full-width on row 2. The previous side-by-side layout squeezed
    // the label/description into whatever width the control left
    // free, so wide controls (4-button segmented pickers, 208 px
    // selects, etc.) caused the description to wrap one word per
    // line. With the control hoisted out, the description always
    // gets the full row width.
    //
    // `controlSublabel` (e.g. "49%" under a slider) sits on row 2
    // right-aligned, opposite the description, so it stays paired
    // with its control visually without taking row 1 height.
    <div className={cn('px-0 py-3', className)}>
      <div className="flex items-center gap-4 min-h-[28px]">
        <div className="min-w-0 flex-1">{labelNode}</div>
        {hasControl ? <div className="shrink-0">{controlNode}</div> : null}
      </div>
      {description || hasSublabel ? (
        <div className="flex items-baseline gap-4 mt-1">
          {description ? (
            <p
              id={descriptionId}
              className="flex-1 min-w-0 text-[12px] text-muted-foreground leading-relaxed"
            >
              {description}
            </p>
          ) : (
            <div className="flex-1" />
          )}
          {hasSublabel ? (
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {controlSublabel}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

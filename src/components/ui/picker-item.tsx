import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The single picker-row primitive used across every picker popover in the app.
 *
 * Built on Radix's `DropdownMenuPrimitive.RadioItem` (single-select) and
 * `CheckboxItem` (multi-select), so we get free keyboard navigation
 * (arrow keys + enter), ARIA roles (`menuitemradio` / `menuitemcheckbox`
 * with `aria-checked`), and focus management — none of which the previous
 * plain-`<button>` picker rolls had.
 *
 * Visual contract — one rule for the whole app:
 *   - Selected = a right-aligned `<Check>` icon in `--color-accent-primary`,
 *     `strokeWidth=2.5`, `h-3.5 w-3.5`. NO row background fill, NO chromatic
 *     border, NO font-weight change.
 *   - Hover/keyboard-focus = subtle `bg-muted/60` (kept neutral, NOT
 *     accent-coloured). Replaces the WebKit native focus ring (which uses
 *     the OS accent colour and looks like an unwanted thick accent border).
 *   - Optional `description` line below the label (smaller, muted).
 *   - Optional `leading` slot (icon before the label) and `trailing` slot
 *     (icon after the label, e.g. a Lock for restricted modes).
 *
 * Usage:
 *
 *   <DropdownMenu>
 *     <DropdownMenuTrigger asChild>...</DropdownMenuTrigger>
 *     <DropdownMenuContent align="start">
 *       <DropdownMenuRadioGroup value={current} onValueChange={setCurrent}>
 *         {options.map((opt) => (
 *           <PickerItem key={opt.id} value={opt.id} label={opt.name} />
 *         ))}
 *       </DropdownMenuRadioGroup>
 *     </DropdownMenuContent>
 *   </DropdownMenu>
 *
 * For multi-select use `PickerCheckboxItem` (no parent RadioGroup needed —
 * each checkbox manages its own checked state via the `checked` prop and
 * `onCheckedChange` callback).
 */

interface CommonPickerProps {
  label: string;
  description?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}

const PICKER_ROW_CLASSES = cn(
  // Layout
  "relative flex w-full cursor-default flex-col gap-0 rounded-md px-3 py-1.5 text-xs",
  // Colour + interactions
  "text-foreground transition-colors duration-150",
  // Hover / keyboard-focus / Radix highlight (arrow-key navigation) — all
  // resolve to the same neutral muted background. No accent / chromatic
  // anywhere on the row itself; the selection state shows ONLY via the
  // right-aligned <Check> icon.
  "hover:bg-muted/60 focus:bg-muted/80 data-[highlighted]:bg-muted/80",
  // Suppress the native focus outline that WebKit paints in the OS accent
  // colour (the "thick accent border" complaint).
  "outline-none focus:outline-none focus-visible:outline-none",
  // Disabled
  "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
);

function PickerItemBody({ label, description, leading, trailing }: Omit<CommonPickerProps, "className">) {
  return (
    <>
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          {leading}
          <span className="truncate">{label}</span>
          {trailing}
        </div>
        <DropdownMenuPrimitive.ItemIndicator>
          <Check
            data-picker-check
            className="h-3.5 w-3.5 shrink-0 text-[var(--color-accent-primary)]"
            strokeWidth={2.5}
          />
        </DropdownMenuPrimitive.ItemIndicator>
      </div>
      {description && (
        <div className="mt-0.5 text-[10px] leading-tight text-muted-foreground">
          {description}
        </div>
      )}
    </>
  );
}

export interface PickerItemProps
  extends Omit<React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>, "children">,
    CommonPickerProps {}

/**
 * Single-select picker row. Wrap in a `<DropdownMenuRadioGroup>` (or use
 * Radix `RadioGroup` directly) and pass the `value` prop to identify which
 * option this row represents. The parent's `value` prop determines which
 * row is shown as selected.
 */
export function PickerItem({
  label,
  description,
  leading,
  trailing,
  className,
  ...props
}: PickerItemProps) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="picker-item"
      className={cn(PICKER_ROW_CLASSES, className)}
      {...props}
    >
      <PickerItemBody
        label={label}
        description={description}
        leading={leading}
        trailing={trailing}
      />
    </DropdownMenuPrimitive.RadioItem>
  );
}

export interface PickerCheckboxItemProps
  extends Omit<React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>, "children">,
    CommonPickerProps {}

/**
 * Multi-select picker row. Manages its own checked state via the `checked`
 * prop and `onCheckedChange` callback (same shape as Radix CheckboxItem).
 */
export function PickerCheckboxItem({
  label,
  description,
  leading,
  trailing,
  className,
  ...props
}: PickerCheckboxItemProps) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="picker-checkbox-item"
      className={cn(PICKER_ROW_CLASSES, className)}
      {...props}
    >
      <PickerItemBody
        label={label}
        description={description}
        leading={leading}
        trailing={trailing}
      />
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

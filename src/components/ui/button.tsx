import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // Base: focus indicator is a 2px solid outline OUTSIDE the button
  // (offset 2px) so it doesn't depend on the button having a real
  // border AND doesn't take layout space. Color resolves through
  // `--accent` (the user-picked chromatic accent) when set, falling
  // back to `--color-foreground` (near-black light / near-white
  // dark) instead of the previous `--color-primary` fallback —
  // foreground is consistently high-contrast against any surface
  // including the muted/30 chrome AgentSwitchCard / dialogs use.
  // Live-test 2026-04-28: the previous `ring-[3px] ring-…/50`
  // setup rendered medium-grey at 50 % opacity on light-grey
  // backgrounds, near-invisible. The destructive variant overrides
  // the outline color further down. Using `outline-*` (CSS
  // outline) instead of `ring-*` (box-shadow) so the indicator
  // tracks the button's exact shape and never clips against
  // sibling elements.
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent,var(--color-foreground))] disabled:pointer-events-none disabled:text-muted-foreground disabled:opacity-70 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Default (primary) variant: bg + hover go through --color-accent-primary.
        // Hover uses CSS color-mix to mimic the previous bg-primary/90 (10% darker).
        default:
          "bg-[var(--color-accent-primary)] text-primary-foreground hover:bg-[color-mix(in_oklab,var(--color-accent-primary),black_10%)]",
        destructive:
          // Override the base outline color so destructive buttons
          // keep their red focus indicator instead of inheriting the
          // accent/foreground.
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:outline-destructive dark:bg-destructive/60",
        // Outline variant: the border IS the primary visual cue (no filled
        // background). Uses --color-border-strong to clear WCAG 1.4.11 (3:1).
        outline:
          "border border-border-strong bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-border-strong dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        // Link variant: text colour reaches the accent token (links are an affordance).
        link: "text-[var(--color-accent-primary)] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }

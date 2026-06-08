import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // Base: focus ring + border resolve through --color-accent-primary so keyboard
  // focus picks up the user's chosen accent. Falls back to --color-ring/--color-primary
  // when no accent is set (today's neutral default). The destructive variant overrides
  // the focus ring further down to keep destructive red, not accent.
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-[var(--color-accent-primary)] focus-visible:ring-[3px] focus-visible:ring-[var(--color-accent-primary)]/50 disabled:pointer-events-none disabled:text-muted-foreground disabled:opacity-70 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Default (primary) variant: bg + hover go through --color-accent-primary.
        // Hover uses CSS color-mix to mimic the previous bg-primary/90 (10% darker).
        // Label uses --color-on-accent: white on a chromatic accent (macOS
        // System Settings style, matching the white glyph) in BOTH themes, and
        // --color-primary-foreground on the neutral no-accent button. Using
        // --color-primary-foreground directly here gave DARK text on the accent
        // in dark mode (the icon stayed white → mismatch).
        //
        // Disabled: the shared base sets `disabled:text-muted-foreground`, which
        // is grey-on-accent and unreadable on the filled button. macOS dims the
        // whole button via opacity but KEEPS the white label, so override the
        // disabled text back to --color-on-accent (the base `disabled:opacity-70`
        // still fades the button to signal the disabled state).
        default:
          "bg-[var(--color-accent-primary)] text-[var(--color-on-accent)] disabled:text-[var(--color-on-accent)] hover:bg-[color-mix(in_oklab,var(--color-accent-primary),black_10%)]",
        // Disabled: same as the default variant — keep the white label and dim
        // via the base `disabled:opacity-70`, instead of the base's grey
        // `disabled:text-muted-foreground` (unreadable on the red fill).
        destructive:
          "bg-destructive text-white disabled:text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 focus-visible:border-destructive dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
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

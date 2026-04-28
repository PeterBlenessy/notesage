"use client"

import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  const [checked, setInternalChecked] = React.useState(props.checked ?? props.defaultChecked ?? false)

  React.useEffect(() => {
    if (props.checked !== undefined) {
      setInternalChecked(props.checked)
    }
  }, [props.checked])

  const handleCheckedChange = (value: boolean) => {
    setInternalChecked(value)
    props.onCheckedChange?.(value)
  }

  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex shrink-0 items-center rounded-full h-[18px] w-[34px] cursor-pointer transition-colors outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      style={{
        // ON state goes through --accent so the toggle picks up the user's accent.
        // Fallback resolves to today's --color-foreground when no accent class is set.
        // OFF state uses --color-border-strong because the track fill IS the
        // only visual cue when off — must clear WCAG 1.4.11 (3:1).
        backgroundColor: checked ? 'var(--accent, var(--color-foreground))' : 'var(--color-border-strong)',
      }}
      {...props}
      onCheckedChange={handleCheckedChange}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block h-[14px] w-[14px] rounded-full shadow-sm transition-transform data-[state=checked]:translate-x-[18px] data-[state=unchecked]:translate-x-[2px]"
        style={{
          backgroundColor: checked ? 'var(--color-background)' : 'var(--color-background)',
        }}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }

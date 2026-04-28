"use client"

import * as React from "react"
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function ScrollArea({
  className,
  children,
  viewportTabIndex,
  viewportClassName,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  /**
   * Forwarded to the inner `<ScrollAreaPrimitive.Viewport>`. Radix's
   * default exposes the viewport with `tabIndex={0}` so keyboard users
   * can scroll a long region without a mouse. That's the right default
   * for content panes — but for surfaces with their own roving-tabindex
   * keyboard model (e.g. settings nav columns where Tab should land on
   * a nav button, not the viewport), pass `viewportTabIndex={-1}` to
   * remove the viewport from the Tab order. Verified 2026-04-28: the
   * Settings v2 dialog had a Tab dead-zone because the viewport
   * captured Tab before the nav buttons inside it.
   */
  viewportTabIndex?: number;
  /** Additional classes for the inner viewport (rare; usually only
   *  needed when the viewport itself needs layout tweaks separate from
   *  the root). */
  viewportClassName?: string;
}) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("relative", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        tabIndex={viewportTabIndex}
        className={cn(
          "focus-visible:ring-ring/50 size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:outline-1",
          viewportClassName,
        )}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        "flex touch-none p-px transition-colors select-none",
        orientation === "vertical" &&
          "h-full w-2.5 border-l border-l-transparent",
        orientation === "horizontal" &&
          "h-2.5 flex-col border-t border-t-transparent",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="bg-border relative flex-1 rounded-full"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  )
}

export { ScrollArea, ScrollBar }

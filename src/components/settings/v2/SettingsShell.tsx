import * as React from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { XIcon } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

/**
 * A single selectable item in the settings nav column.
 */
export interface SettingsShellNavItem {
  /** Stable id (e.g. "appearance"). Must be unique within the shell. */
  id: string;
  /** Human-readable label. */
  label: string;
  /** Lucide icon component. Rendered at 14 px with strokeWidth 1.6. */
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  /** Optional small numeric/text hint shown on the right (e.g. unread count). */
  hint?: React.ReactNode;
}

/**
 * A titled group of nav items.
 */
export interface SettingsShellNavGroup {
  /** Stable id (e.g. "notesage"). */
  id: string;
  /** Uppercase label shown above the group (e.g. "Notesage"). */
  label: string;
  items: SettingsShellNavItem[];
}

export interface SettingsShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nav: SettingsShellNavGroup[];
  activeItem: string;
  onActiveItemChange: (id: string) => void;
  /** Optional element rendered at the top of the nav column (e.g. search input). */
  navHeader?: React.ReactNode;
  /** Current panel content. */
  children: React.ReactNode;
}

/**
 * Flatten nav groups into a single ordered list of item ids for keyboard
 * navigation (↑/↓ cycle between items, skipping group headers).
 */
function flattenItems(nav: SettingsShellNavGroup[]): string[] {
  const ids: string[] = [];
  for (const group of nav) {
    for (const item of group.items) {
      ids.push(item.id);
    }
  }
  return ids;
}

/**
 * Two-pane settings dialog shell per Mockup E. The shell owns the dialog
 * chrome, the nav column (with optional header slot), and the content scroll
 * area. Panel content is passed as `children`.
 *
 * Keyboard:
 *   - ↑ / ↓ cycle through nav items (wrap at ends)
 *   - Enter / Space on a nav item activates it
 *   - Esc closes the dialog (inherited from Radix Dialog)
 */
export function SettingsShell({
  open,
  onOpenChange,
  nav,
  activeItem,
  onActiveItemChange,
  navHeader,
  children,
}: SettingsShellProps) {
  const navRef = React.useRef<HTMLDivElement | null>(null);
  const orderedIds = React.useMemo(() => flattenItems(nav), [nav]);

  const moveSelection = React.useCallback(
    (delta: 1 | -1) => {
      if (orderedIds.length === 0) return;
      const currentIndex = orderedIds.indexOf(activeItem);
      const nextIndex =
        currentIndex === -1
          ? delta === 1
            ? 0
            : orderedIds.length - 1
          : (currentIndex + delta + orderedIds.length) % orderedIds.length;
      const nextId = orderedIds[nextIndex];
      onActiveItemChange(nextId);
      // Move focus to the newly-active button so focus visibly follows selection.
      queueMicrotask(() => {
        const el = navRef.current?.querySelector<HTMLButtonElement>(
          `[data-nav-item-id="${nextId}"]`,
        );
        el?.focus();
      });
    },
    [orderedIds, activeItem, onActiveItemChange],
  );

  const handleNavKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveSelection(1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveSelection(-1);
      }
    },
    [moveSelection],
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            // #86 reduced-motion sweep: disable Radix entrance/exit animations
            // entirely under reduce — `motion-reduce:` maps to
            // `prefers-reduced-motion: reduce`.
            'motion-reduce:!animate-none motion-reduce:!duration-0',
            'fixed inset-0 z-50 bg-black/60 backdrop-blur-sm',
          )}
        />
        <DialogPrimitive.Content
          data-slot="settings-shell-content"
          className={cn(
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            // #86 reduced-motion sweep — see overlay above.
            'motion-reduce:!animate-none motion-reduce:!duration-0',
            'fixed top-[50%] left-[50%] z-50 translate-x-[-50%] translate-y-[-50%]',
            // Live-test 2026-04-26 — narrowed from 1040 → 780 (-25%).
            // The right content column was too wide and accumulated
            // empty space on the right edge of forms / pickers. The
            // 236 px nav stays unchanged.
            'w-[calc(100vw-48px)] max-w-[780px]',
            'h-[min(720px,calc(100vh-48px))]',
            'overflow-hidden rounded-[14px] border border-border bg-background',
            'shadow-[0_28px_60px_-20px_hsl(0_0%_0%/0.35)]',
            'outline-none grid grid-cols-[236px_1fr]',
          )}
        >
          {/* Required for Radix a11y — visually hidden title/description. */}
          <DialogPrimitive.Title className="sr-only">Settings</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Configure Notesage preferences.
          </DialogPrimitive.Description>

          {/* Left: nav column */}
          <aside className="flex min-h-0 flex-col border-r border-border bg-muted/30">
            {navHeader ? (
              <div className="px-3 pt-3 pb-2 border-b border-border/60">
                {navHeader}
              </div>
            ) : null}
            <ScrollArea className="flex-1">
              <nav
                ref={navRef}
                aria-label="Settings sections"
                onKeyDown={handleNavKeyDown}
                className="p-3"
              >
                {nav.map((group) => (
                  <div key={group.id} className="mb-4 last:mb-0">
                    <h4 className="px-2 mb-1.5 text-[10.5px] font-medium tracking-wider uppercase text-muted-foreground">
                      {group.label}
                    </h4>
                    <div className="flex flex-col gap-0.5">
                      {group.items.map((item) => {
                        const active = item.id === activeItem;
                        const Icon = item.icon;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            data-nav-item-id={item.id}
                            aria-current={active ? 'page' : undefined}
                            onClick={() => onActiveItemChange(item.id)}
                            className={cn(
                              'group relative flex w-full items-center gap-2.5 rounded-md',
                              'px-2 py-1.5 text-left text-[13px]',
                              'transition-colors duration-150 ease-in-out',
                              'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0',
                              active
                                ? 'bg-[var(--color-accent-primary)] text-[oklch(100%_0_0)] font-medium'
                                : 'text-foreground hover:bg-muted',
                            )}
                          >
                            <Icon
                              strokeWidth={1.6}
                              className={cn(
                                'h-3.5 w-3.5 shrink-0',
                                active
                                  ? 'text-accent-foreground'
                                  : 'text-muted-foreground group-hover:text-foreground',
                              )}
                            />
                            <span className="flex-1 truncate">{item.label}</span>
                            {item.hint !== undefined && item.hint !== null ? (
                              <span className="text-[11px] text-muted-foreground">
                                {item.hint}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </nav>
            </ScrollArea>
          </aside>

          {/* Right: content column. `min-h-0` releases the default
              `min-height: auto` on flex children so the ScrollArea
              inside actually clips and scrolls instead of growing past
              the dialog. The previous setup had the right column
              sometimes sized to its content (no scroll) — multi-panel
              user feedback 2026-04-25. */}
          <div className="relative flex min-h-0 flex-col overflow-hidden">
            <ScrollArea className="h-full">
              {/* Live-test 2026-04-25 — dropped the inner
                  `max-w-[640px] mx-auto` centering. With the dialog
                  itself max-w-[1040px] and the nav at 236 px, the
                  right column is ~800 px wide. Constraining content
                  to 640 px and centering it left ~80 px of empty
                  margin on each side (visible as orange in dev-tools
                  — the user spotted the gap explicitly). Letting
                  content fill the column gives forms / sliders /
                  segmented controls room to breathe and matches
                  mockup-e (no inner max-width on the content
                  column). Top padding stays at `pt-8` for breathing
                  room from the dialog's top edge. */}
              <div className="w-full px-12 pt-8 pb-6">
                {children}
              </div>
            </ScrollArea>

            {/* Close button floats in the top-right of the content pane */}
            <DialogPrimitive.Close
              className={cn(
                'absolute top-3 right-3 inline-flex h-8 w-8 items-center justify-center',
                'rounded-full border border-border bg-background text-muted-foreground',
                'transition-colors duration-150 hover:text-foreground hover:bg-muted',
                'outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
              aria-label="Close settings"
            >
              <XIcon className="h-3.5 w-3.5" strokeWidth={1.6} />
            </DialogPrimitive.Close>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

# Design System

## Core Mandate

**This is not optional. Every component, every view, every interaction must look polished and professional. Do not write "functional but ugly" code. If a component doesn't look good, it's not done.**

## Component Strategy — USE SHADCN/UI FIRST

**RULE: Never build a custom component if shadcn/ui already has one.** Check the shadcn/ui docs before creating anything. This is non-negotiable.

shadcn/ui components to install and use (not an exhaustive list — check docs for more):

| Need | shadcn/ui component | DON'T build custom |
| --- | --- | --- |
| Buttons | `button` | ❌ custom `<MyButton>` |
| Dropdowns | `dropdown-menu` | ❌ custom dropdown |
| Right-click menus | `context-menu` | ❌ custom context menu |
| Modals/dialogs | `dialog` + `alert-dialog` | ❌ custom modal |
| Tab bar | `tabs` | ❌ custom tab component |
| File/folder tree | `collapsible` + custom tree | ❌ fully custom tree |
| Tooltips | `tooltip` | ❌ custom tooltip |
| Toasts/notifications | `sonner` | ❌ custom toast |
| Text inputs | `input` | ❌ custom input |
| Search/filter | `command` (cmdk) | ❌ custom search |
| Keyboard shortcut display | `kbd` (custom, tiny) | — |
| Toggle switches | `switch` | ❌ custom toggle |
| Select/combobox | `select` or `combobox` | ❌ custom select |
| Separators | `separator` | ❌ custom `<hr>` |
| Scroll areas | `scroll-area` | ❌ custom scrollbar |
| Resizable panels | `resizable` | ❌ custom splitter |
| Popovers | `popover` | ❌ custom floating div |
| Progress indicators | `progress` | ❌ custom progress bar |
| Skeleton loaders | `skeleton` | ❌ custom loading state |
| Breadcrumbs | `breadcrumb` | ❌ custom breadcrumb |

**Install components as needed:**

```bash
pnpm dlx shadcn@latest add button dropdown-menu context-menu dialog alert-dialog tabs tooltip sonner input command switch select separator scroll-area resizable popover progress skeleton collapsible breadcrumb
```

**Rules:**

1. Before writing ANY UI component, ask: "Does shadcn/ui have this?" If yes, use it.
2. Only build custom components for app-specific things that shadcn/ui doesn't cover (the editor itself, AI diff decorations, etc.)
3. When extending shadcn/ui components, compose them — don't fork and rewrite.
4. Use shadcn/ui's `cn()` utility for conditional classnames — don't install `clsx` separately.
5. If you need a component shadcn/ui doesn't have, check Radix UI primitives first before building from scratch.

## Design Philosophy

Notesage should feel like a premium native macOS application. Think: Linear, Raycast, Things 3, Bear, Craft. Not: generic Electron app with default HTML buttons.

### Visual Identity

- **Aesthetic**: Clean, refined, minimal but warm. Not cold/corporate, not playful/toy-like.
- **Inspiration apps**: Linear (layout, polish), Bear (editor warmth), Craft (document feel), Things 3 (sidebar elegance)
- **The feel**: When someone opens Notesage, the first reaction should be "this looks premium"

## Typography

- **UI font**: Use `"SF Pro Display", "SF Pro Text", system-ui` for interface elements (labels, buttons, sidebar). This gives native macOS feel.
- **Editor font**: Use a beautiful serif or sans-serif reading font for the editor content area. Consider `"iA Writer Quattro"`, `"Literata"`, `"Source Serif Pro"`, or `"Charter"`. Load via Google Fonts or bundle.
- **Monospace**: `"JetBrains Mono"`, `"SF Mono"`, or `"Fira Code"` for code blocks.
- **Font sizes**: Establish a clear type scale. Don't use arbitrary pixel values. Use Tailwind's scale: text-xs, text-sm, text-base, text-lg, text-xl, text-2xl.
- **Font weight**: Use weight deliberately. Sidebar items: medium (500). Headings: semibold (600). Body: regular (400). Never use bold (700) for UI elements unless it's a primary action label.

## Color Palette

**STRICTLY NEUTRAL — NO CHROMATIC ACCENT COLOR.**

The entire palette is black, white, and greys. No blue, indigo, teal, or any hue. All CSS variables in globals.css use `oklch(L% 0 0)` — zero chroma, zero hue. This gives a polished, monochrome aesthetic similar to Linear or Things 3.

Define the palette using CSS variables in globals.css. All colors must come from this palette — no hardcoded hex values in components. **No color with chroma &gt; 0 except destructive (red) and editor content colors (see below).**

**Editor content color exception:** Text colors, highlight marks, and diff decorations use chromatic colors because they convey semantic meaning in document content (e.g., red/green for diffs, colored highlights for user annotation). These are defined as CSS variables in `globals.css` (e.g., `--color-diff-delete-bg`, `--color-highlight-yellow`) with light/dark variants, and are NOT part of the UI chrome palette. Comment highlights and date badges use neutral greys.

**Light mode:**

- Background: white `oklch(100% 0 0)`
- Text/foreground: near-black `oklch(14% 0 0)`
- Primary (buttons, active states): dark grey `oklch(20% 0 0)`
- Muted: light grey `oklch(95.5% 0 0)`
- Borders: subtle grey `oklch(90% 0 0)`
- Focus ring: medium grey `oklch(50% 0 0)` — never blue
- Hover states: gentle background shifts, not color changes

**Dark mode:**

- Background: dark grey `oklch(18% 0 0)` — not pure black
- Text/foreground: near-white `oklch(98% 0 0)`
- Primary (buttons, active states): light grey `oklch(90% 0 0)`
- Muted: `oklch(28% 0 0)`
- Borders: `oklch(32% 0 0)`
- Focus ring: `oklch(60% 0 0)` — never blue

**Contrast slider:**

A "Contrast" slider (Settings > Appearance, range 0–100) continuously interpolates between full contrast (0) and soft contrast (100) for both light and dark themes. The `ThemeProvider` computes intermediate oklch lightness values via `src/lib/contrast.ts` and applies them as inline CSS variables on `<html>`. At level 0, no overrides are applied (base CSS values). The `.soft` / `.dark.soft` classes in `globals.css` are preserved as reference documentation for the soft endpoints.

- Full contrast (0): Light `oklch(100% 0 0)` bg / `oklch(14% 0 0)` fg; Dark `oklch(18% 0 0)` bg / `oklch(98% 0 0)` fg
- Soft contrast (100): Light `oklch(96% 0 0)` bg / `oklch(20% 0 0)` fg; Dark `oklch(25% 0 0)` bg / `oklch(90% 0 0)` fg
- Intermediate values are linearly interpolated between these endpoints

**Forbidden colors:**

- No blue, indigo, teal, violet, or any chromatic accent anywhere in the UI
- The only non-grey color allowed is destructive red for errors/deletions
- Links in the editor use `--color-primary` (grey) with underline on hover for distinction

## Spacing & Layout

- **Generous whitespace**: Don't cram elements together. When in doubt, add more padding.
- **Consistent spacing**: Use Tailwind's spacing scale consistently. Sidebar padding, editor margins, toolbar spacing should all follow the same rhythm.
- **Sidebar width**: 240-280px, resizable. Not too narrow, not too wide.
- **Editor content width**: Max 720px centered, like a well-typeset document. Don't let text span the full window width.
- **Visual hierarchy**: Use spacing (not just font size) to create hierarchy. Sections separated by generous gaps.

## Components — Specific Requirements

### Sidebar

- Smooth hover transitions (150ms ease)
- Active file: subtle background highlight + left accent border (2-3px)
- Folder expand/collapse: smooth rotation animation on chevron icon
- File icons: use lucide-react icons, muted color, consistent size
- Section labels (if any): uppercase, text-xs, tracking-wider, muted color
- Scrollbar: thin, only visible on hover (use custom CSS)

### Tab Bar

- Tabs should feel like browser tabs or VS Code tabs — not flat buttons
- Active tab clearly distinguished (background, bottom border, or elevation)
- Close button: only visible on hover over the tab
- Dirty indicator: small dot, accent color, positioned consistently
- Smooth transitions when switching, adding, removing tabs
- Max tab width, truncate long filenames with ellipsis

### Editor Area

- Content area should feel like a clean writing surface
- Heading styles: clear visual hierarchy with size AND weight AND spacing
- Block quotes: left border (accent color, 3px), slightly muted text, padding-left
- Code blocks: distinct background (#F5F5F5 light, #2D2D2D dark), rounded corners (8px), proper padding, syntax highlighting with a tasteful theme (One Light / One Dark or similar)
- Task lists: custom checkbox styling (not browser default), smooth check animation
- Tables: clean borders, header row styling, alternating row backgrounds optional
- Links: accent color, subtle underline on hover
- Images: rounded corners, subtle shadow, max-width contained

### Floating Toolbar

- Appears with smooth fade+slide animation (150ms)
- Rounded, slight shadow/elevation
- Frosted glass effect (backdrop-blur) if possible
- Compact but not cramped — proper icon spacing
- Active formatting indicated clearly (background or color change)
- Disappears smoothly when selection is lost

### Slash Command Menu

- Appears below cursor with smooth animation
- Search/filter at top
- Icons for each block type
- Keyboard navigation with highlighted current item
- Rounded corners, elevation/shadow, consistent with toolbar style

### Context Menus (Right-click)

- Use shadcn/ui ContextMenu — don't build custom
- Consistent padding, icon alignment, keyboard shortcut display
- Smooth open animation

### Dialogs/Modals

- Overlay with backdrop blur
- Centered, max-width 480px for simple dialogs
- Smooth scale-in animation
- Focus trap and keyboard handling (shadcn/ui handles this)

## Animations & Transitions

- **Everything interactive should have a transition.** No instant state changes.
- Default transition: `transition-all duration-150 ease-in-out`
- Sidebar folder expand: height animation with easing
- Tab switching: no jarring content flash
- Theme toggle: smooth color transitions on all elements (use `transition-colors duration-200`)
- Hover states: background color shifts, not border additions
- Never use `transition-all` on large containers — be specific (transition-colors, transition-opacity, etc.)

## Icons

- **Library**: lucide-react (already included with shadcn/ui)
- **Size**: 16px for inline/sidebar, 18-20px for toolbar, 24px for empty states
- **Weight**: Use strokeWidth={1.5} for a refined look (default is 2, which feels heavy)
- **Color**: Muted by default (text-muted-foreground), accent on active/hover

## Anti-patterns — NEVER DO THESE

- ❌ Default browser checkboxes, radio buttons, or selects
- ❌ Unstyled scrollbars
- ❌ Pure black (#000000) or pure white (#FFFFFF) backgrounds
- ❌ Borders thicker than 1px on UI elements
- ❌ Box shadows that look like 2010 (large, dark, obvious). Use subtle, layered shadows.
- ❌ Inconsistent border-radius (pick 6px or 8px and use it everywhere)
- ❌ Text that spans more than 80ch wide in the editor
- ❌ Abrupt state changes without transitions
- ❌ Generic gray (#808080) for anything — use the defined palette
- ❌ Placeholder content or "Lorem ipsum" left in the UI
- ❌ Unaligned elements — everything should snap to a consistent grid
- ❌ Default focus rings — replace with custom, on-brand focus indicators
- ❌ Any blue, indigo, teal, violet, or chromatic accent colors — the palette is strictly neutral greyscale
- ❌ Using `text-blue-*`, `bg-blue-*`, `border-blue-*`, or any Tailwind color class with a hue
- ❌ CSS variables with chroma &gt; 0 (except `--color-destructive` red)

## Quality Check — Ask Yourself Before Every Component

1. Would this look out of place in Linear or Craft? If yes, redo it.
2. Does every interactive element have a hover/active/focus state?
3. Are colors from the defined palette (CSS variables), not hardcoded?
4. Is spacing consistent with the rest of the app?
5. Does it look good in BOTH light and dark mode?
6. Are transitions smooth and intentional?
7. Would a designer approve this, or would they say "it works but it's ugly"?

## Implementation Notes

### Dark Mode & Soft Contrast Support

All components must work in both light and dark modes, and with soft contrast enabled:

- Use CSS variables from `globals.css` for all colors
- Test every component in both themes (and with soft contrast toggled)
- Use `dark:` prefix for dark mode-specific styles
- Logos and images should be visible in both modes (add white background if needed: `bg-white p-0.5`)
- Soft contrast is applied via inline CSS variable overrides on `<html>` by the `ThemeProvider` — no component-level changes needed if CSS variables are used correctly

### Accessibility

- All interactive elements must have focus states
- Use semantic HTML
- Provide alt text for images
- Ensure keyboard navigation works
- ARIA labels where needed
- Sufficient color contrast (WCAG AA minimum)